import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Busboy, type BusboyFileStream, type BusboyInstance } from '@fastify/busboy';
import { config } from './config.js';
import { getSession, parseBearer } from './session.js';

interface AllowedImage {
  ext: string;
  magic: Buffer;
  extra?: [number, Buffer];
}

const ALLOWED_IMAGES = new Map<string, AllowedImage>([
  // 89 50 4E 47 0D 0A 1A 0A — the 8-byte PNG signature
  ['image/png', { ext: 'png', magic: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }],
  ['image/jpeg', { ext: 'jpg', magic: Buffer.from([0xff, 0xd8, 0xff]) }],
  ['image/gif', { ext: 'gif', magic: Buffer.from([0x47, 0x49, 0x46, 0x38]) }],
  ['image/webp', { ext: 'webp', magic: Buffer.from('RIFF'), extra: [8, Buffer.from('WEBP')] }],
]);

function isRealImage(mime: string, buffer: Buffer): AllowedImage | undefined {
  const spec = ALLOWED_IMAGES.get(mime);
  if (!spec) return undefined;
  if (!buffer.subarray(0, spec.magic.length).equals(spec.magic)) return undefined;
  if (spec.extra) {
    const [offset, bytes] = spec.extra;
    if (!buffer.subarray(offset, offset + bytes.length).equals(bytes)) return undefined;
  }
  return spec;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(json),
  });
  res.end(json);
}

/**
 * Parse a hijacked multipart image upload from the raw Node request/response
 * streams. Invoked from Fastify's onRequest hook after reply.hijack(), so
 * Fastify's content-type parsing is bypassed entirely (streaming multipart
 * parsing stalled under Node 24 with the plugin-based approach).
 */
export function handleRawUpload(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== 'POST' || !req.url?.startsWith('/api/upload')) return false;

  const session = getSession(parseBearer(req.headers.authorization));
  if (!session) {
    req.resume(); // drain so the client can receive the response
    sendJson(res, 401, { error: '未登录或会话已失效' });
    return true;
  }

  const contentType = req.headers['content-type'] ?? '';
  if (!contentType.startsWith('multipart/form-data')) {
    req.resume();
    sendJson(res, 400, { error: '缺少上传文件' });
    return true;
  }

  let busboy: BusboyInstance;
  try {
    busboy = new Busboy({
      headers: { 'content-type': contentType },
      limits: { files: 1, fileSize: config.maxImageBytes },
    });
  } catch {
    req.resume();
    sendJson(res, 400, { error: 'multipart 格式不合法' });
    return true;
  }

  const chunks: Buffer[] = [];
  let mimetype = '';
  let truncated = false;
  let sawFile = false;
  let settled = false;

  const fail = (status: number, error: string): void => {
    if (settled) return;
    settled = true;
    try {
      req.unpipe(busboy);
      busboy.destroy();
    } catch {
      // ignore
    }
    req.resume();
    sendJson(res, status, { error });
  };

  busboy.on(
    'file',
    (
      _field: string,
      stream: BusboyFileStream,
      _filename: string,
      _transferEncoding: string,
      fileMime: string
    ) => {
      sawFile = true;
      mimetype = (fileMime ?? '').toLowerCase();
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('limit', () => {
        truncated = true;
      });
      stream.on('error', () => fail(413, '图片不能超过 5 MB'));
    }
  );

  busboy.on('error', (err: unknown) => {
    const code = (err as { code?: string } | null)?.code ?? '';
    if (truncated || code.includes('LIMIT')) {
      fail(413, '图片不能超过 5 MB');
    } else {
      fail(400, 'multipart 格式不合法');
    }
  });

  busboy.on('finish', () => {
    if (settled) return;
    if (!sawFile) return fail(400, '缺少上传文件');

    const buffer = Buffer.concat(chunks);
    if (truncated || buffer.length > config.maxImageBytes) {
      return fail(413, '图片不能超过 5 MB');
    }
    const verified = isRealImage(mimetype, buffer);
    if (!verified) return fail(415, '仅支持 PNG / JPEG / GIF / WebP 图片');

    const filename = `${Date.now().toString(36)}-${randomBytes(8).toString('hex')}.${verified.ext}`;
    void writeFile(resolve(config.dataDir, config.uploadDir, filename), buffer)
      .then(() => {
        if (settled) return;
        settled = true;
        sendJson(res, 200, { url: `/uploads/${filename}` });
      })
      .catch(() => fail(500, '图片保存失败'));
  });

  req.pipe(busboy);
  return true;
}
