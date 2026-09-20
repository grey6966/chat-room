import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { getChannelHistory, getDirectHistory, getReadCounts, type MessageRow } from './db.js';
import {
  getSession,
  isValidUsername,
  normalizeUsername,
  parseBearer,
  type Session,
} from './session.js';
import type { ChatMessage } from './types.js';

declare module 'fastify' {
  interface FastifyRequest {
    session?: Session;
  }
}

function serialize(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    type: row.type,
    sender: row.sender,
    recipient: row.recipient,
    content: row.content,
    createdAt: row.created_at,
  };
}

/** Channel rows with read counts attached in a single query. */
function serializeChannel(rows: MessageRow[]): ChatMessage[] {
  const counts = getChannelReadCounts(rows.map((r) => r.id));
  return rows.map((row) => ({ ...serialize(row), readBy: counts.get(row.id) ?? 0 }));
}

function authenticate(request: FastifyRequest, reply: FastifyReply): void {
  const session = getSession(parseBearer(request.headers.authorization));
  if (!session) {
    reply.code(401).send({ error: '未登录或会话已失效' });
    return;
  }
  request.session = session;
}

function parsePaging(query: { limit?: unknown; before?: unknown }): {
  limit: number;
  before?: number;
} | null {
  const limit = Math.min(
    Math.max(Number(query.limit) || config.defaultHistoryLimit, 1),
    config.maxHistoryLimit
  );
  const before = query.before == null ? undefined : Number(query.before);
  if (before !== undefined && !Number.isInteger(before)) return null;
  return { limit, before };
}

export function registerApiRoutes(app: FastifyInstance): void {
  app.get('/api/health', async () => ({ ok: true }));

  app.get<{ Querystring: { limit?: string; before?: string } }>(
    '/api/history/channel',
    { preHandler: authenticate },
    async (request, reply) => {
      const paging = parsePaging(request.query);
      if (!paging) return reply.code(400).send({ error: '分页参数不合法' });
      const rows = getChannelHistory(paging.limit, paging.before);
      const counts = getReadCounts(rows.map((r) => r.id));
      const messages = rows.map((row) => {
        const message = serialize(row);
        const count = counts.get(row.id);
        if (count) message.readByCount = count;
        return message;
      });
      return { messages };
    }
  );

  app.get<{
    Params: { peer: string };
    Querystring: { limit?: string; before?: string };
  }>(
    '/api/history/direct/:peer',
    { preHandler: authenticate },
    async (request, reply) => {
      const session = request.session!;
      const peer = normalizeUsername(request.params.peer);
      if (!isValidUsername(peer)) return reply.code(400).send({ error: '用户名不合法' });

      const paging = parsePaging(request.query);
      if (!paging) return reply.code(400).send({ error: '分页参数不合法' });

      return {
        messages: getDirectHistory(session.username, peer, paging.limit, paging.before).map(
          serialize
        ),
      };
    }
  );

  // Note: POST /api/upload is handled before Fastify by rawUpload.ts, which
  // parses multipart data directly on the Node HTTP server.
}
