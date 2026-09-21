import type { Server as IOServer, Socket } from 'socket.io';
import type { Database } from 'better-sqlite3';
import type { Ack, ChatMessageDTO, OnlineUserDTO } from './types.js';
import { isContentEmpty, sanitizeContent } from './sanitize.js';

interface UserIdRow {
  id: number;
}

interface MessageRow {
  id: number;
  kind: 'public' | 'dm';
  sendername: string;
  receivername: string | null;
  content: string;
  createdat: number;
}

const MAX_CONTENT_LENGTH = 20_000;
const HISTORY_LIMIT = 100;

/** 用户名 -> 用户信息与该用户当前的全部 socket 连接（多标签页视为同一在线用户） */
interface PresenceEntry {
  id: number;
  sockets: Set<string>;
}
type Presence = Map<string, PresenceEntry>;

function isValidUsername(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.trim().length >= 2 &&
    name.trim().length <= 16 &&
    /^[一-龥a-zA-Z0-9_]+$/.test(name.trim())
  );
}

function toMessageDTO(row: MessageRow): ChatMessageDTO {
  return {
    id: row.id,
    kind: row.kind,
    senderName: row.sendername,
    receiverName: row.receivername,
    content: row.content,
    createdAt: row.createdat,
  };
}

type JoinAck = Ack<{
  user: OnlineUserDTO;
  recentMessages: ChatMessageDTO[];
  lastReadMessageId: number | null;
}>;
type SendAck = Ack<{ message?: ChatMessageDTO }>;
type DmOpenAck = Ack<{ peer: string; messages: ChatMessageDTO[] }>;
type HistoryAck = Ack<{ messages: ChatMessageDTO[] }>;

export function registerChat(io: IOServer, db: Database): void {
  const presence: Presence = new Map();

  const upsertUser = db.prepare(
    `INSERT INTO users (username, createdAt) VALUES (?, ?)
     ON CONFLICT(username) DO UPDATE SET username = username
     RETURNING id`
  );
  const getUserByName = db.prepare(`SELECT id FROM users WHERE username = ?`);
  const insertMessage = db.prepare(
    `INSERT INTO messages (kind, senderId, receiverId, content, createdAt)
     VALUES (?, ?, ?, ?, ?)`
  );
  const publicHistoryStmt = db.prepare(
    `SELECT m.id, m.kind, su.username AS senderName, NULL AS receiverName,
            m.content, m.createdAt
       FROM messages m JOIN users su ON su.id = m.senderId
      WHERE m.kind = 'public' AND (@before IS NULL OR m.id < @before)
      ORDER BY m.id DESC LIMIT @limit`
  );
  const dmHistoryStmt = db.prepare(
    `SELECT m.id, m.kind, su.username AS senderName, ru.username AS receiverName,
            m.content, m.createdAt
       FROM messages m
       JOIN users su ON su.id = m.senderId
       JOIN users ru ON ru.id = m.receiverId
      WHERE m.kind = 'dm' AND (@before IS NULL OR m.id < @before)
        AND ((m.senderId = @me AND ru.username = @peer)
          OR (m.receiverId = @me AND su.username = @peer))
      ORDER BY m.id DESC LIMIT @limit`
  );
  const upsertReadCursor = db.prepare(
    `INSERT INTO public_read_cursors (userId, lastReadId, updatedAt)
     VALUES (@userId, @lastReadId, @ts)
     ON CONFLICT(userId) DO UPDATE SET
       lastReadId = MAX(public_read_cursors.lastReadId, excluded.lastReadId),
       updatedAt = excluded.updatedAt`
  );
  const getReadCursorStmt = db.prepare(
    `SELECT lastReadId FROM public_read_cursors WHERE userId = ?`
  );
  // 最近 READ_WINDOW 条群聊消息的已读数（已读游标 >= 消息 id，且不含发送者）
  const READ_WINDOW = 100;
  const readWindowCountsStmt = db.prepare(
    `SELECT m.id AS messageId, COUNT(c.userId) AS cnt
       FROM messages m
       LEFT JOIN public_read_cursors c
         ON c.lastReadId >= m.id AND c.userId <> m.senderId
      WHERE m.kind = 'public'
        AND m.id >= COALESCE((
          SELECT id FROM messages WHERE kind = 'public'
          ORDER BY id DESC LIMIT 1 OFFSET ${READ_WINDOW - 1}
        ), 0)
      GROUP BY m.id`
  );
  // 按给定消息 id 批量统计已读数（历史分页/最近消息初始值用）
  const readCountsByIds = (ids: number[]) =>
    db
      .prepare(
        `SELECT m.id AS messageId, COUNT(c.userId) AS cnt
           FROM messages m
           LEFT JOIN public_read_cursors c
             ON c.lastReadId >= m.id AND c.userId <> m.senderId
          WHERE m.id IN (${ids.map(() => '?').join(',')})
          GROUP BY m.id`
      )
      .all(...ids) as { messageId: number; cnt: number }[];

  function onlineUsers(): OnlineUserDTO[] {
    return [...presence.entries()]
      .map(([username, entry]) => ({ id: entry.id, username }))
      .sort((a, b) => a.username.localeCompare(b.username, 'zh-Hans-CN'));
  }

  /** 给群聊消息批量附加 readByCount（私聊消息不附加） */
  function withReadCounts(messages: ChatMessageDTO[]): ChatMessageDTO[] {
    const publicIds = messages.filter((m) => m.kind === 'public').map((m) => m.id);
    if (publicIds.length === 0) return messages;
    const rows = readCountsByIds(publicIds);
    const countMap = new Map(rows.map((r) => [r.messageId, Number(r.cnt)]));
    return messages.map((m) =>
      m.kind === 'public' ? { ...m, readByCount: countMap.get(m.id) ?? 0 } : m
    );
  }

  function broadcastPresence(): void {
    io.emit('presence:update', onlineUsers());
  }

  io.on('connection', (socket: Socket) => {
    /* ---------- 进入聊天室 ---------- */
    socket.on('join', (rawName: unknown, cb?: (r: JoinAck) => void) => {
      if (!isValidUsername(rawName)) {
        cb?.({ ok: false, error: '用户名需为 2-16 位中文、字母、数字或下划线' });
        return;
      }
      const username = rawName.trim();

      // 同名用户已在线：允许同一连接复用（断线重连），拒绝其他连接占用
      const existing = presence.get(username);
      if (existing && !existing.sockets.has(socket.id)) {
        cb?.({ ok: false, error: '用户名已被占用，请换一个' });
        return;
      }

      const row = upsertUser.get(username, Date.now()) as UserIdRow;
      socket.data.username = username;
      socket.data.userId = row.id;

      socket.join('public');
      socket.join(`user:${username}`); // 个人房间，私聊定向投递

      if (existing) {
        existing.sockets.add(socket.id);
      } else {
        presence.set(username, { id: row.id, sockets: new Set([socket.id]) });
      }

      const recentRows = publicHistoryStmt.all({ before: null, limit: HISTORY_LIMIT }) as MessageRow[];
      const recent = withReadCounts(recentRows.map(toMessageDTO).reverse());

      // 该用户的已读游标（用于客户端避免把别人的旧游标当成新回执）
      const cursorRow = getReadCursorStmt.get(row.id) as { lastReadId: number } | undefined;

      cb?.({
        ok: true,
        user: { id: row.id, username },
        recentMessages: recent,
        lastReadMessageId: cursorRow?.lastReadId ?? null,
      });
      broadcastPresence();
    });

    /* ---------- 频道消息 ---------- */
    socket.on('public:send', (rawContent: unknown, cb?: (r: SendAck) => void) => {
      const sender = socket.data.username as string | undefined;
      if (!sender) return;

      if (typeof rawContent !== 'string' || rawContent.length > MAX_CONTENT_LENGTH) {
        cb?.({ ok: false, error: '消息长度超出限制' });
        return;
      }
      const content = sanitizeContent(rawContent);
      if (isContentEmpty(content)) {
        cb?.({ ok: false, error: '不能发送空消息' });
        return;
      }

      const now = Date.now();
      const info = insertMessage.run('public', socket.data.userId, null, content, now);
      const messageId = Number(info.lastInsertRowid);
      const message: ChatMessageDTO = {
        id: messageId,
        kind: 'public',
        senderName: sender,
        receiverName: null,
        content,
        createdAt: now,
        readByCount: 0,
      };
      io.to('public').emit('public:message', message);
      cb?.({ ok: true });
    });

    /* ---------- 私聊 ---------- */
    socket.on('dm:send', (payload: unknown, cb?: (r: SendAck) => void) => {
      const sender = socket.data.username as string | undefined;
      if (!sender) return;

      const obj = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : undefined;
      const receiverName = obj?.to;
      const rawContent = obj?.content;

      if (typeof receiverName !== 'string' || typeof rawContent !== 'string') {
        cb?.({ ok: false, error: '参数错误' });
        return;
      }
      if (receiverName === sender) {
        cb?.({ ok: false, error: '不能给自己发私聊' });
        return;
      }
      if (rawContent.length > MAX_CONTENT_LENGTH) {
        cb?.({ ok: false, error: '消息长度超出限制' });
        return;
      }
      const receiverRow = getUserByName.get(receiverName) as UserIdRow | undefined;
      if (!receiverRow) {
        cb?.({ ok: false, error: '用户不存在' });
        return;
      }

      const content = sanitizeContent(rawContent);
      if (isContentEmpty(content)) {
        cb?.({ ok: false, error: '不能发送空消息' });
        return;
      }

      const now = Date.now();
      const info = insertMessage.run('dm', socket.data.userId, receiverRow.id, content, now);
      const message: ChatMessageDTO = {
        id: Number(info.lastInsertRowid),
        kind: 'dm',
        senderName: sender,
        receiverName,
        content,
        createdAt: now,
      };
      // 只投递给收发双方（各自的个人房间覆盖其全部标签页）
      io.to(`user:${sender}`).to(`user:${receiverName}`).emit('dm:message', message);
      cb?.({ ok: true, message });
    });

    /* ---------- 打开私聊会话时拉取历史 ---------- */
    socket.on('dm:open', (peerName: unknown, cb?: (r: DmOpenAck) => void) => {
      const me = socket.data.username as string | undefined;
      if (!me || typeof peerName !== 'string') {
        cb?.({ ok: false, error: '参数错误' });
        return;
      }
      const rows = dmHistoryStmt.all({
        me: socket.data.userId,
        peer: peerName,
        before: null,
        limit: HISTORY_LIMIT,
      }) as MessageRow[];
      cb?.({ ok: true, peer: peerName, messages: rows.map(toMessageDTO).reverse() });
    });

    /* ---------- 上翻加载更早的频道历史 ---------- */
    socket.on('public:history', (before: unknown, cb?: (r: HistoryAck) => void) => {
      if (!socket.data.username) return;
      const rows = publicHistoryStmt.all({
        before: typeof before === 'number' ? before : null,
        limit: HISTORY_LIMIT,
      }) as MessageRow[];
      cb?.({ ok: true, messages: withReadCounts(rows.map(toMessageDTO).reverse()) });
    });

    /* ---------- 群聊已读回执：上报自己读到的最新消息 ---------- */
    socket.on('public:read', (rawId: unknown) => {
      const userId = socket.data.userId as number | undefined;
      const username = socket.data.username as string | undefined;
      if (!userId || !username || typeof rawId !== 'number' || !Number.isFinite(rawId)) return;
      const lastReadId = Math.floor(rawId);

      upsertReadCursor.run({ userId, lastReadId, ts: Date.now() });

      // 广播最近窗口内每条消息的最新已读数（服务端权威，客户端直接合并）
      const rows = readWindowCountsStmt.all() as { messageId: number; cnt: number }[];
      const counts: Record<number, number> = {};
      for (const r of rows) counts[r.messageId] = Number(r.cnt);
      io.to('public').emit('public:read', { upTo: lastReadId, counts });
    });

    /* ---------- 断线：该用户所有标签页都关闭后才判定下线 ---------- */
    socket.on('disconnect', () => {
      const username = socket.data.username as string | undefined;
      if (!username) return;

      const entry = presence.get(username);
      if (!entry) return;
      entry.sockets.delete(socket.id);
      if (entry.sockets.size === 0) {
        presence.delete(username);
        broadcastPresence();
      }
    });
  });
}
