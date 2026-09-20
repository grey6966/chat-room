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

if (isFresh) {
  console.log('[db] initialized fresh SQLite database at', dbPath);
}
