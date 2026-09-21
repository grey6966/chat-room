import Database, { type Database as DB } from 'better-sqlite3';
import fs from 'node:fs';
import { config } from './config.js';

let db: DB | null = null;

export function openDb(): DB {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const database = new Database(config.dbPath);

  // WAL 模式：多读单写，显著提升高并发读吞吐；NORMAL 同步级别兼顾性能与安全
  database.pragma('journal_mode = WAL');
  database.pragma('synchronous = NORMAL');
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');

  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      username  TEXT NOT NULL UNIQUE,
      createdAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      kind         TEXT NOT NULL CHECK (kind IN ('public', 'dm')),
      senderId     INTEGER NOT NULL REFERENCES users(id),
      receiverId   INTEGER REFERENCES users(id),
      content      TEXT NOT NULL,
      createdAt    INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_public_time
      ON messages (kind, createdAt) WHERE kind = 'public';
    CREATE INDEX IF NOT EXISTS idx_messages_dm_pair
      ON messages (kind, senderId, receiverId, createdAt);

    -- 群消息已读游标：每个用户一行，lastReadId 为其已看到的最大群消息 ID
    CREATE TABLE IF NOT EXISTS message_reads (
      userId      INTEGER PRIMARY KEY REFERENCES users(id),
      lastReadId  INTEGER NOT NULL DEFAULT 0,
      updatedAt   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reads_cursor
      ON message_reads (lastReadId);
  `);


  db = database;
  return database;
}

export function getDb(): DB {
  if (!db) throw new Error('Database is not initialized');
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
