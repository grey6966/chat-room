import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const config = {
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? '0.0.0.0',
  /** Directory containing built frontend assets (relative to compiled dist/). */
  publicDir: resolve(dirname(new URL(import.meta.url).pathname), '../../public'),
  dataDir: process.env.DATA_DIR ?? resolve(process.cwd(), 'data'),
  dbFile: process.env.DB_FILE ?? 'chat.db',
  uploadDir: process.env.UPLOAD_DIR ?? 'uploads',
  maxMessageLength: 8000,
  defaultHistoryLimit: 50,
  maxHistoryLimit: 100,
  maxImageBytes: 5 * 1024 * 1024,
  /** Per-user socket events (messages) allowed per window. */
  rateLimitPerWindow: 20,
  rateWindowMs: 5_000,
  username: {
    min: 1,
    max: 24,
  },
};

mkdirSync(resolve(config.dataDir, config.uploadDir), { recursive: true });
