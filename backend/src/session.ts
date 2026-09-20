import { randomUUID } from 'node:crypto';
import { config } from './config.js';

/** Sessions are in-memory only: a login/refresh issues a new token. */
export interface Session {
  token: string;
  username: string;
}

const sessions = new Map<string, Session>();

export function createSession(username: string): Session {
  const session: Session = { token: randomUUID(), username };
  sessions.set(session.token, session);
  return session;
}

export function getSession(token: string | undefined): Session | undefined {
  return token ? sessions.get(token) : undefined;
}

export function revokeSession(token: string | undefined): void {
  if (token) sessions.delete(token);
}

const USERNAME_RE = /^[\p{L}\p{N}_.\-一-鿿]+$/u;

export function normalizeUsername(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().slice(0, config.username.max);
}

export function isValidUsername(name: string): boolean {
  return (
    name.length >= config.username.min &&
    name.length <= config.username.max &&
    USERNAME_RE.test(name)
  );
}

export function parseBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}
