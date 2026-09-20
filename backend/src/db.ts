import { existsSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

const dbPath = resolve(config.dataDir, config.dbFile);
mkdirSync(dirname(dbPath), { recursive: true });
const isFresh = !existsSync(dbPath);

export const db = new Database(dbPath);

// --- High concurrency tuning -------------------------------------------------
// WAL allows multiple readers concurrent with a single writer and dramatically
// reduces lock contention vs the default rollback journal.
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL'); // safe with WAL, much faster fsync cadence
db.pragma('temp_store = MEMORY');
db.pragma('cache_size = -64000'); // 64 MB
db.pragma('busy_timeout = 5000'); // wait rather than throw SQLITE_BUSY
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT NOT NULL CHECK (type IN ('channel', 'direct')),
    sender      TEXT NOT NULL,
    recipient   TEXT,                          -- set for direct messages
    content     TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_channel
    ON messages (type, id) WHERE type = 'channel';
  CREATE INDEX IF NOT EXISTS idx_messages_direct_pair
    ON messages (sender, recipient, id) WHERE type = 'direct';

  -- Read receipts (channel messages). The sender is never counted as a reader.
  CREATE TABLE IF NOT EXISTS message_reads (
    message_id  INTEGER NOT NULL,
    reader      TEXT NOT NULL,
    read_at     INTEGER NOT NULL,
    PRIMARY KEY (message_id, reader),
    FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_message_reads_message
    ON message_reads (message_id);
`);

export interface MessageRow {
  id: number;
  type: 'channel' | 'direct';
  sender: string;
  recipient: string | null;
  content: string;
  created_at: number;
}

const insertStmt = db.prepare(
  `INSERT INTO messages (type, sender, recipient, content, created_at)
   VALUES (@type, @sender, @recipient, @content, @created_at)`
);

export function insertMessage(
  type: 'channel' | 'direct',
  sender: string,
  recipient: string | null,
  content: string
): MessageRow {
  const row = {
    type,
    sender,
    recipient,
    content,
    created_at: Date.now(),
  };
  const info = insertStmt.run(row);
  return { id: Number(info.lastInsertRowid), ...row };
}

const channelHistoryStmt = db.prepare(
  `SELECT id, type, sender, recipient, content, created_at
     FROM messages
    WHERE type = 'channel' AND (@before IS NULL OR id < @before)
    ORDER BY id DESC
    LIMIT @limit`
);

/** Channel messages, ascending, paged with an exclusive `before` message id. */
export function getChannelHistory(limit: number, before?: number): MessageRow[] {
  return (channelHistoryStmt.all({ limit, before: before ?? null }) as MessageRow[]).reverse();
}

// Conversation is the same regardless of which direction a row points in, so
// the pair is queried both ways and then merged.
const directHistoryStmt = db.prepare(
  `SELECT id, type, sender, recipient, content, created_at
     FROM messages
    WHERE type = 'direct'
      AND ( (sender = @user AND recipient = @peer)
         OR (sender = @peer AND recipient = @user) )
      AND (@before IS NULL OR id < @before)
    ORDER BY id DESC
    LIMIT @limit`
);

export function getDirectHistory(user: string, peer: string, limit: number, before?: number): MessageRow[] {
  return (directHistoryStmt.all({ user, peer, limit, before: before ?? null }) as MessageRow[]).reverse();
}

// --- Read receipts -----------------------------------------------------------

const markChannelRangeReadStmt = db.prepare(
  `INSERT OR IGNORE INTO message_reads (message_id, reader, read_at)
   SELECT id, @reader, @read_at
     FROM messages
    WHERE type = 'channel' AND id <= @max_id AND sender != @reader`
);

const newlyReadStmt = db.prepare(
  `SELECT message_id AS id FROM message_reads WHERE reader = ? AND read_at = ?`
);

/** Mark the reader's channel view as caught up. Returns newly-read message ids. */
export function markChannelReadThrough(reader: string, maxId: number): number[] {
  const readAt = Date.now();
  const info = markChannelRangeReadStmt.run({ reader, max_id: maxId, read_at: readAt });
  if (info.changes === 0) return [];
  return (newlyReadStmt.all(reader, readAt) as Array<{ id: number }>).map((r) => r.id);
}

const latestChannelIdStmt = db.prepare(
  `SELECT MAX(id) AS id FROM messages WHERE type = 'channel'`
);

export function getLatestChannelId(): number {
  return (latestChannelIdStmt.get() as { id: number | null }).id ?? 0;
}

const readCountsStmt = db.prepare(
  `SELECT message_id AS messageId, COUNT(*) AS count
     FROM message_reads
    WHERE message_id IN (SELECT value FROM json_each(@ids))
    GROUP BY message_id`
);

/** Reader counts for a batch of message ids (skips ids with no receipts). */
export function getReadCounts(messageIds: number[]): Map<number, number> {
  if (messageIds.length === 0) return new Map();
  const rows = readCountsStmt.all({ ids: JSON.stringify(messageIds) }) as Array<{
    messageId: number;
    count: number;
  }>;
  return new Map(rows.map((r) => [r.messageId, r.count]));
}

/** Usernames that have read a given channel message. */
const readersStmt = db.prepare(
  `SELECT reader FROM message_reads WHERE message_id = ? ORDER BY reader`
);

export function getReaders(messageId: number): string[] {
  return (readersStmt.all(messageId) as Array<{ reader: string }>).map((r) => r.reader);
}

if (isFresh) {
  console.log('[db] initialized fresh SQLite database at', dbPath);
}
