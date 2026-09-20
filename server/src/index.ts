import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { Server as IOServer } from 'socket.io';
import { config, ensureDataDirs } from './config.js';
import { closeDb, openDb } from './db.js';
import { registerChat } from './chat.js';
import { uploadRouter } from './upload.js';

ensureDataDirs();
const db = openDb();

const app = express();
app.use(express.json({ limit: '1mb' }));

// 图片上传接口（无需登录态的演示聊天室；文件名校验 + 魔数校验 + 大小限制已在路由内完成）
app.use('/api/upload', uploadRouter);

// 用户上传的图片
app.use(
  '/uploads',
  express.static(config.uploadDir, {
    maxAge: '7d',
    index: false,
    fallthrough: false,
  })
);

// 生产环境托管前端构建产物；开发环境由 Vite 提供页面
if (fs.existsSync(config.publicDir)) {
  app.use(express.static(config.publicDir, { maxAge: '1h' }));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(config.publicDir, 'index.html'));
  });
}

const server = http.createServer(app);
const io = new IOServer(server, {
  maxHttpBufferSize: 1_000_000, // 1MB，图片走 HTTP 上传，socket 仅传 HTML
  cors: { origin: true },
});

registerChat(io, db);

server.listen(config.port, () => {
  console.log(`[chat-room] 服务已启动: http://localhost:${config.port}`);
  console.log(`[chat-room] 数据库: ${config.dbPath}`);
});

function shutdown(signal: string): void {
  console.log(`\n[chat-room] 收到 ${signal}，正在关闭...`);
  io.close();
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  // 强制兜底
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
