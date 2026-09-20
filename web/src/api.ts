import { io, type Socket } from 'socket.io-client';
import type {
  DmOpenAck,
  HistoryAck,
  JoinAck,
  SendAck,
} from './types';

// 开发环境走 Vite 代理；生产环境同源
export const socket: Socket = io('/', {
  autoConnect: true,
  reconnection: true,
  reconnectionDelay: 500,
  reconnectionAttempts: Infinity,
});

/** 带超时的 ack 封装，避免服务端不响应时 Promise 挂死 */
function emitWithAck<T>(event: string, ...args: unknown[]): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('网络超时，请重试')), 10_000);
    socket
      .timeout(8_000)
      .emit(event, ...args, (err: unknown, response: T) => {
        clearTimeout(timer);
        if (err) reject(new Error('网络错误，请检查连接'));
        else resolve(response);
      });
  });
}

export function joinRoom(username: string): Promise<JoinAck> {
  return emitWithAck<JoinAck>('join', username);
}

export function sendPublic(content: string): Promise<SendAck> {
  return emitWithAck<SendAck>('public:send', content);
}

export function sendDm(to: string, content: string): Promise<SendAck> {
  return emitWithAck<SendAck>('dm:send', { to, content });
}

export function openDm(peer: string): Promise<DmOpenAck> {
  return emitWithAck<DmOpenAck>('dm:open', peer);
}

export function fetchPublicHistory(before?: number): Promise<HistoryAck> {
  return emitWithAck<HistoryAck>('public:history', before ?? null);
}

/** 上传图片，返回可直接放入 <img src> 的同源相对路径 */
export async function uploadImage(file: File): Promise<string> {
  const form = new FormData();
  form.append('image', file);
  const resp = await fetch('/api/upload/image', { method: 'POST', body: form });
  const data = (await resp.json()) as { ok: boolean; url?: string; error?: string };
  if (!resp.ok || !data.ok || !data.url) {
    throw new Error(data.error ?? '图片上传失败');
  }
  return data.url;
}
