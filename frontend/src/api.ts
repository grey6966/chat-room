import { io, type Socket } from 'socket.io-client';
import type { ChatMessage, JoinOk } from './types';

/**
 * The server authenticates via the first `join` event and keeps the session
 * in socket memory, so no extra auth middleware is needed on the client.
 */
export function createSocket(): Socket {
  return io({
    autoConnect: true,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: Infinity,
  });
}

export function joinRoom(
  socket: Socket,
  username: string
): Promise<JoinOk | { ok: false; error: string }> {
  return socket.timeout(8000).emitWithAck('join', { username }) as Promise<
    JoinOk | { ok: false; error: string }
  >;
}

export function fetchDirectHistory(
  socket: Socket,
  peer: string,
  limit: number
): Promise<{ ok: true; messages: ChatMessage[] } | { ok: false; error: string }> {
  return socket
    .timeout(8000)
    .emitWithAck('history:direct', { peer, limit }) as Promise<
    { ok: true; messages: ChatMessage[] } | { ok: false; error: string }
  >;
}

/** Tell the server the caller has read channel messages up to `lastId`. */
export function markChannelRead(socket: Socket, lastId: number): void {
  socket.emit('channel:read', { lastId });
}

/** Fetch the usernames who have read one channel message. */
export function fetchChannelReaders(
  socket: Socket,
  messageId: number
): Promise<string[]> {
  return socket
    .timeout(5000)
    .emitWithAck('channel:readers', { messageId })
    .then((res: { ok: true; readers: string[] } | { ok: false; error: string }) =>
      res.ok ? res.readers : []
    )
    .catch(() => []);
}

/** Bearer-authenticated image upload; returns the URL to embed in Markdown. */
export async function uploadImage(token: string, file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch('/api/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `上传失败（${response.status}）`);
  }
  const data = (await response.json()) as { url: string };
  return data.url;
}
