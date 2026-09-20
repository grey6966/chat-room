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

  -- Channel read receipts: one row per (message, reader). WITHOUT ROWID keeps
  -- the composite primary key clustered by message_id for cheap count queries.
  CREATE TABLE IF NOT EXISTS message_receipts (
    message_id  INTEGER NOT NULL,
    reader      TEXT NOT NULL,
    read_at     INTEGER NOT NULL,
    PRIMARY KEY (message_id, reader)
  ) WITHOUT ROWID;
`);

// One-time migration for databases created before receipts existed: treat the
// sender of every historical channel message as having read their own message,
// so read counts are not inflated by traffic from earlier versions.
const userVersion = Number(db.pragma('user_version', { simple: true }));
if (userVersion < 1) {
  db.exec(
    `INSERT OR IGNORE INTO message_receipts (message_id, reader, read_at)
     SELECT id, sender, created_at FROM messages WHERE type = 'channel'`
  );
  db.pragma('user_version = 1');
}

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

const markChannelReadStmt = db.prepare(
  `INSERT OR IGNORE INTO message_receipts (message_id, reader, read_at)
   SELECT id, @reader, @read_at FROM messages
    WHERE type = 'channel' AND id <= @lastId`
);

/**
 * Record that `reader` has read channel messages up to and including
 * `lastId`. Idempotent thanks to the primary key.
 */
export function markChannelRead(reader: string, lastId: number): void {
  markChannelReadStmt.run({ reader, lastId, read_at: Date.now() });
}

/** Read counts keyed by message id for a batch of messages. */
export function getChannelReadCounts(messageIds: number[]): Map<number, number> {
  const result = new Map<number, number>();
  if (messageIds.length === 0) return result;
  const placeholders = messageIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT message_id AS id, COUNT(*) AS n
         FROM message_receipts
        WHERE message_id IN (${placeholders})
        GROUP BY message_id`
    )
    .all(...messageIds) as Array<{ id: number; n: number }>;
  for (const row of rows) result.set(row.id, row.n);
  return result;
}

/** Readers of a single channel message, sorted by username. */
export function getChannelReaders(messageId: number): string[] {
  const rows = db
    .prepare(`SELECT reader FROM message_receipts WHERE message_id = ? ORDER BY reader`)
    .all(messageId) as Array<{ reader: string }>;
  return rows.map((r) => r.reader);
}

/** Newest channel message ids, ascending (for receipt fan-out after a mark). */
export function getRecentChannelMessageIds(limit: number): number[] {
  const rows = db
    .prepare(
      `SELECT id FROM messages WHERE type = 'channel' ORDER BY id DESC LIMIT ?`
    )
    .all(limit) as Array<{ id: number }>;
  return rows.map((r) => r.id).reverse();
}

/** Drop receipts belonging to messages older than the newest 1000 channel msgs. */
export function pruneOldReceipts(keep = 1000): void {
  db.prepare(
    `DELETE FROM message_receipts
      WHERE message_id < (
        SELECT MIN(id) FROM (
          SELECT id FROM messages WHERE type = 'channel' ORDER BY id DESC LIMIT ?
        )
      )`
  ).run(keep);
}

if (isFresh) {
  console.log('[db] initialized fresh SQLite database at', dbPath);
}
