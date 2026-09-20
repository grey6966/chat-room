import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { config } from './config.js';
import {
  getChannelHistory,
  getDirectHistory,
  getLatestChannelId,
  getReadCounts,
  getReaders,
  insertMessage,
  markChannelReadThrough,
  type MessageRow,
} from './db.js';
import { rateLimited, resetRateLimit } from './rateLimit.js';
import {
  createSession,
  isValidUsername,
  normalizeUsername,
  revokeSession,
  type Session,
} from './session.js';
import type { ChatMessage } from './types.js';

const CHANNEL = 'channel';
/** Only counts for the recent window are broadcast after a receipt update. */
const RECEIPT_BROADCAST_WINDOW = 50;
/** Coalesce receipt fan-out: a busy room triggers at most ~2 broadcasts/sec. */
const RECEIPT_BROADCAST_DEBOUNCE_MS = 500;
let pruneCounter = 0;

function serialize(row: MessageRow, readBy?: number): ChatMessage {
  return {
    id: row.id,
    type: row.type,
    sender: row.sender,
    recipient: row.recipient,
    content: row.content,
    createdAt: row.created_at,
    ...(readBy !== undefined ? { readBy } : {}),
  };
}

/** Serialize channel messages with their per-message reader counts. */
function serializeChannel(rows: MessageRow[]): ChatMessage[] {
  if (rows.length === 0) return [];
  const counts = getReadCounts(rows.map((r) => r.id));
  return rows.map((row) => {
    const message = serialize(row);
    const count = counts.get(row.id);
    if (count) message.readByCount = count;
    return message;
  });
}

function cleanContent(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const content = raw.trim();
  if (!content || content.length > config.maxMessageLength) return null;
  return content;
}

export function attachRealtime(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    maxHttpBufferSize: 100_000, // messages go through the upload API, not the socket
    pingInterval: 20_000,
    pingTimeout: 20_000,
    // Brief network interruptions resume the same session (rooms + buffered
    // messages) without a re-join. Kept short so an unclean drop still clears
    // presence promptly; clean disconnects fire immediately regardless.
    connectionStateRecovery: {
      maxDisconnectionDuration: 10_000,
      skipMiddlewares: true,
    },
    cors: { origin: true, credentials: true },
  });

  /** username -> socket id. One connection per username (see join handler). */
  const online = new Map<string, string>();

  /** True when the transport behind a socket is genuinely live. */
  function transportIsLive(socketId: string): boolean {
    const s = io.sockets.sockets.get(socketId);
    if (!s) return false;
    // Engine.IO readyState: 'open' | 'closing' | 'closed'. A socket in the
    // recovery grace period has a non-open transport and can be replaced.
    const readyState = (s.conn as { readyState?: string }).readyState;
    return readyState === 'open';
  }

  function broadcastPresence(): void {
    const presence = [...online.keys()].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    io.emit('presence', presence);
  }

  /** Push fresh read counts for the recent window to every channel member. */
  function broadcastReceipts(): void {
    const ids = getRecentChannelMessageIds(RECEIPT_BROADCAST_WINDOW);
    const counts = getChannelReadCounts(ids);
    const payload: Record<string, number> = {};
    for (const id of ids) payload[id] = counts.get(id) ?? 0;
    io.to(CHANNEL).emit('channel:receipts', { counts: payload });
  }

  // Coalesce bursts of marks (a screenful of readers joining at once) into a
  // single broadcast instead of fanning out one per read event.
  let receiptTimer: NodeJS.Timeout | null = null;
  function scheduleReceiptBroadcast(): void {
    if (receiptTimer !== null) return;
    receiptTimer = setTimeout(() => {
      receiptTimer = null;
      broadcastReceipts();
    }, RECEIPT_BROADCAST_DEBOUNCE_MS);
    receiptTimer.unref?.();
  }

  io.on('connection', (socket) => {
    socket.on(
      'join',
      (
        payload: { username?: unknown } | undefined,
        ack?: (response:
          | { ok: true; session: Session; presence: string[]; history: ChatMessage[] }
          | { ok: false; error: string }) => void
      ) => {
        if (typeof ack !== 'function') return;

        // An already-joined socket cannot silently switch identity.
        if (socket.data.session) {
          ack({ ok: false, error: '该连接已经加入了聊天室' });
          return;
        }

        const username = normalizeUsername(payload?.username);
        if (!isValidUsername(username)) {
          ack({ ok: false, error: '用户名不合法（1-24 位，支持中英文、数字、_-.）' });
          return;
        }

        const existingId = online.get(username);
        if (existingId && existingId !== socket.id) {
          if (transportIsLive(existingId)) {
            // A genuinely connected client owns this name.
            ack({ ok: false, error: '用户名已被占用，请换一个' });
            return;
          }
          // The previous socket is in the disconnect/recovery grace period.
          // Reclaim the name: remove it from the hall and invalidate its session.
          const stale = io.sockets.sockets.get(existingId);
          if (stale?.data.session) revokeSession(stale.data.session.token);
          if (stale) {
            stale.data.session = undefined;
            stale.leave(CHANNEL);
            stale.leave(`user:${username}`);
            stale.disconnect(true);
          }
          online.delete(username);
        }

        const session = createSession(username);
        socket.data.session = session;
        online.set(username, socket.id);
        socket.join([CHANNEL, `user:${username}`]);

        // Opening the hall marks existing history as read by the newcomer.
        markChannelReadThrough(username, getLatestChannelId());
        const history = serializeChannel(getChannelHistory(config.defaultHistoryLimit));
        const presence = [...online.keys()].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));

        ack({ ok: true, session, presence, history });

        socket.to(CHANNEL).emit('notice', {
          id: `${Date.now()}-${username}-join`,
          kind: 'join',
          username,
          createdAt: Date.now(),
        });
        broadcastPresence();

        // Refresh reader counts on already-connected clients.
        const counts: Record<string, number> = {};
        for (const message of history) {
          if (message.readByCount) counts[message.id] = message.readByCount;
        }
        io.to(CHANNEL).emit('channel:reads', counts);
      }
    );

    socket.on('channel:message', (payload: { content?: unknown } | undefined) => {
      const session = socket.data.session as Session | undefined;
      if (!session) return;
      if (rateLimited(session.username)) return;

      const content = cleanContent(payload?.content);
      if (!content) return;

      const row = insertMessage('channel', session.username, null, content);
      // The sender has obviously read their own message.
      markChannelRead(session.username, row.id);
      io.to(CHANNEL).emit('channel:message', serialize(row, 1));
    });

    // The client reports the highest channel message id currently visible.
    // New receipts (and only those) are broadcast so senders update counts.
    socket.on('channel:read', (payload: { upTo?: unknown } | undefined) => {
      const session = socket.data.session as Session | undefined;
      if (!session) return;

      const upTo = payload?.upTo;
      if (typeof upTo !== 'number' || !Number.isFinite(upTo)) return;

      const newReads = markChannelReadThrough(session.username, Math.floor(upTo));
      if (newReads.length === 0) return;

      const counts = getReadCounts(newReads);
      const update: Record<string, number> = {};
      for (const [id, count] of counts) update[id] = count;
      io.to(CHANNEL).emit('channel:reads', update);
    });

    socket.on(
      'channel:readers',
      (
        payload: { messageId?: unknown } | undefined,
        ack?: (response: { ok: true; readers: string[] } | { ok: false; error: string }) => void
      ) => {
        if (typeof ack !== 'function') return;
        const session = socket.data.session as Session | undefined;
        if (!session) return ack({ ok: false, error: '未加入聊天室' });

        const messageId = payload?.messageId;
        if (typeof messageId !== 'number' || !Number.isInteger(messageId)) {
          return ack({ ok: false, error: '消息 ID 不合法' });
        }
        ack({ ok: true, readers: getReaders(messageId) });
      }
    );

    socket.on(
      'channel:read',
      (payload: { lastId?: unknown } | undefined) => {
        const session = socket.data.session as Session | undefined;
        if (!session) return;
        const lastId = Number(payload?.lastId);
        if (!Number.isInteger(lastId) || lastId <= 0) return;

        markChannelRead(session.username, lastId);

        // Keep the receipts table bounded; prune at most once per 25 marks.
        if (++pruneCounter % 25 === 0) pruneOldReceipts();

        scheduleReceiptBroadcast();
      }
    );

    socket.on(
      'channel:readers',
      (
        payload: { messageId?: unknown } | undefined,
        ack?: (response: { ok: true; readers: string[] } | { ok: false; error: string }) => void
      ) => {
        if (typeof ack !== 'function') return;
        const session = socket.data.session as Session | undefined;
        if (!session) return ack({ ok: false, error: '未加入聊天室' });
        const messageId = Number(payload?.messageId);
        if (!Number.isInteger(messageId) || messageId <= 0) {
          return ack({ ok: false, error: '消息参数不合法' });
        }
        ack({ ok: true, readers: getChannelReaders(messageId) });
      }
    );

    socket.on(
      'direct:message',
      (payload: { to?: unknown; content?: unknown } | undefined) => {
        const session = socket.data.session as Session | undefined;
        if (!session) return;
        if (rateLimited(session.username)) return;

        const to = normalizeUsername(payload?.to);
        const content = cleanContent(payload?.content);
        if (!isValidUsername(to) || !content || to === session.username) return;
        if (!online.has(to)) return; // only online peers can receive private messages

        const row = insertMessage('direct', session.username, to, content);
        const message = serialize(row);
        io.to(`user:${to}`).emit('direct:message', message);
        socket.emit('direct:message', message); // echo back so the sender gets the persisted id
      }
    );

    socket.on(
      'history:direct',
      (
        payload: { peer?: unknown; limit?: unknown; before?: unknown } | undefined,
        ack?: (response: { ok: true; messages: ChatMessage[] } | { ok: false; error: string }) => void
      ) => {
        if (typeof ack !== 'function') return;
        const session = socket.data.session as Session | undefined;
        if (!session) return ack({ ok: false, error: '未加入聊天室' });

        const peer = normalizeUsername(payload?.peer);
        if (!isValidUsername(peer)) return ack({ ok: false, error: '用户名不合法' });

        const limit = Math.min(
          Math.max(Number(payload?.limit) || config.defaultHistoryLimit, 1),
          config.maxHistoryLimit
        );
        const before = payload?.before == null ? undefined : Number(payload.before);
        if (before !== undefined && !Number.isInteger(before)) {
          return ack({ ok: false, error: '分页参数不合法' });
        }

        const messages = getDirectHistory(session.username, peer, limit, before).map((row) =>
          serialize(row)
        );
        ack({ ok: true, messages });
      }
    );

    const leave = (): void => {
      const session = socket.data.session as Session | undefined;
      if (!session) return;

      // Only treat as offline if this socket still owns the username.
      if (online.get(session.username) === socket.id) {
        online.delete(session.username);
        resetRateLimit(session.username);
        socket.to(CHANNEL).emit('notice', {
          id: `${Date.now()}-${session.username}-leave`,
          kind: 'leave',
          username: session.username,
          createdAt: Date.now(),
        });
        broadcastPresence();
      }
      revokeSession(session.token);
      socket.data.session = undefined;
    };

    socket.on('disconnect', () => leave());
  });

  return io;
}
