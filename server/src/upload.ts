import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxImageBytes },
});

/** 按文件魔数校验真实图片类型，避免伪造扩展名/Content-Type */
function sniffImageExt(buf: Buffer): string | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 6 && buf.toString('ascii', 0, 6) === 'GIF87a') return 'gif';
  if (buf.length >= 6 && buf.toString('ascii', 0, 6) === 'GIF89a') return 'gif';
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) return 'webp';
  return null;
}

export const uploadRouter = Router();

uploadRouter.post('/image', upload.single('image'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ ok: false, error: '未收到图片文件' });
    return;
  }
  const ext = sniffImageExt(req.file.buffer);
  if (!ext) {
    res.status(400).json({ ok: false, error: '仅支持 PNG / JPEG / GIF / WebP 图片' });
    return;
  }

  const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  fs.mkdirSync(config.uploadDir, { recursive: true });
  fs.writeFileSync(path.join(config.uploadDir, filename), req.file.buffer);

  res.status(201).json({ ok: true, url: `/uploads/${filename}` });
});
