import type { Server as IOServer, Socket } from 'socket.io';
import type { Database } from 'better-sqlite3';
import type { Ack, ChatMessageDTO, OnlineUserDTO, ReadReceiptDTO } from './types.js';
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

type JoinAck = Ack<{ user: OnlineUserDTO; recentMessages: ChatMessageDTO[] }>;
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
  const maxPublicIdStmt = db.prepare(`SELECT COALESCE(MAX(id), 0) AS id FROM messages WHERE kind = 'public'`);
  const getReadStmt = db.prepare(`SELECT lastReadId FROM message_reads WHERE userId = ?`);
  const insertReadStmt = db.prepare(
    `INSERT INTO message_reads (userId, lastReadId, updatedAt) VALUES (?, ?, ?)`
  );
  const advanceReadStmt = db.prepare(
    `UPDATE message_reads SET lastReadId = ?, updatedAt = ? WHERE userId = ? AND lastReadId < ?`
  );
  // 某条群消息的已读人数：游标 >= 消息 ID，且不是发送者本人
  const countReadersStmt = db.prepare(
    `SELECT COUNT(*) AS n FROM message_reads r
      JOIN users u ON u.id = r.userId
      JOIN messages m ON m.id = @messageId
      WHERE r.lastReadId >= @messageId AND u.id <> m.senderId`
  );

  function onlineUsers(): OnlineUserDTO[] {
    return [...presence.entries()]
      .map(([username, entry]) => ({ id: entry.id, username }))
      .sort((a, b) => a.username.localeCompare(b.username, 'zh-Hans-CN'));
  }

  function broadcastPresence(): void {
    io.emit('presence:update', onlineUsers());
  }

  /** 推进用户的群聊已读游标；返回 true 表示游标实际前进（需要广播） */
  function advanceReadCursor(userId: number, lastReadId: number): boolean {
    const row = getReadStmt.get(userId) as { lastReadId: number } | undefined;
    if (!row) {
      insertReadStmt.run(userId, lastReadId, Date.now());
      return true;
    }
    if (lastReadId <= row.lastReadId) return false;
    advanceReadStmt.run(lastReadId, Date.now(), userId, lastReadId);
    return true;
  }

  /** 群消息已读人数（不含发送者自己） */
  function readCountFor(messageId: number): number {
    const row = countReadersStmt.get({ messageId }) as { n: number };
    return row.n;
  }

  /** 给群消息 DTO 附带当前已读数 */
  function withReadCount(message: ChatMessageDTO): ChatMessageDTO {
    return message.kind === 'public'
      ? { ...message, readCount: readCountFor(message.id) }
      : message;
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

      const recent = (publicHistoryStmt.all({ before: null, limit: HISTORY_LIMIT }) as MessageRow[])
        .map(toMessageDTO)
        .reverse()
        .map(withReadCount);

      cb?.({ ok: true, user: { id: row.id, username }, recentMessages: recent });
      broadcastPresence();

      // 重新进入即把已读游标推进到当前最新群消息；游标前进时广播给其他人
      const maxRow = maxPublicIdStmt.get() as { id: number };
      if (maxRow.id > 0 && advanceReadCursor(row.id, maxRow.id)) {
        io.to('public').emit('read:update', {
          username,
          lastReadId: maxRow.id,
        } satisfies ReadReceiptDTO);
      }
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
      const message: ChatMessageDTO = {
        id: Number(info.lastInsertRowid),
        kind: 'public',
        senderName: sender,
        receiverName: null,
        content,
        createdAt: now,
        readCount: 0,
      };
      // 发送者自己必然已读：推进游标（不计入已读数）
      advanceReadCursor(socket.data.userId as number, message.id);
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

    /* ---------- 已读上报：客户端在群聊底部看到最新消息时上报已读游标 ---------- */
    socket.on('read:report', (rawLastReadId: unknown, cb?: (r: Ack<Record<string, unknown>>) => void) => {
      const username = socket.data.username as string | undefined;
      const userId = socket.data.userId as number | undefined;
      if (!username || !userId) {
        cb?.({ ok: false, error: '未加入聊天室' });
        return;
      }
      if (typeof rawLastReadId !== 'number' || !Number.isFinite(rawLastReadId) || rawLastReadId <= 0) {
        cb?.({ ok: false, error: '参数错误' });
        return;
      }
      const lastReadId = Math.floor(rawLastReadId);

      // 游标没有实际前进（重复上报旧值）时不广播，避免无效流量
      if (advanceReadCursor(userId, lastReadId)) {
        io.to('public').emit('read:update', { username, lastReadId } satisfies ReadReceiptDTO);
      }
      cb?.({ ok: true });
    });

    /* ---------- 上翻加载更早的频道历史 ---------- */
    socket.on('public:history', (before: unknown, cb?: (r: HistoryAck) => void) => {
      if (!socket.data.username) return;
      const rows = publicHistoryStmt.all({
        before: typeof before === 'number' ? before : null,
        limit: HISTORY_LIMIT,
      }) as MessageRow[];
      cb?.({ ok: true, messages: rows.map(toMessageDTO).reverse().map(withReadCount) });
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
