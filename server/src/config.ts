import path from 'node:path';
import fs from 'node:fs';

export interface AppConfig {
  port: number;
  dataDir: string;
  dbPath: string;
  uploadDir: string;
  publicDir: string;
  maxImageBytes: number;
}

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), 'data');

export const config: AppConfig = {
  port: Number(process.env.PORT ?? 3000),
  dataDir,
  dbPath: path.join(dataDir, 'chat.db'),
  uploadDir: path.join(dataDir, 'uploads'),
  publicDir: path.resolve(process.cwd(), 'public'),
  maxImageBytes: 5 * 1024 * 1024,
};

/** 确保数据目录存在（SQLite 文件目录、图片上传目录） */
export function ensureDataDirs(): void {
  fs.mkdirSync(config.uploadDir, { recursive: true });
}
