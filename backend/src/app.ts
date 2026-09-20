import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import compress from '@fastify/compress';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { registerApiRoutes } from './routes.js';
import { handleRawUpload } from './rawUpload.js';

export function createApp(): FastifyInstance {
  const app = Fastify({
    bodyLimit: 6 * 1024 * 1024,
    trustProxy: true,
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
  });

  // Hijack multipart uploads at the earliest lifecycle hook and handle them
  // directly on the raw Node streams, bypassing Fastify's body parsing
  // (streaming multipart parsing stalled under Node 24). Only POST is hijacked;
  // any other method falls through to Fastify's normal 404/405 handling.
  app.addHook('onRequest', (request, reply, done) => {
    if (request.method === 'POST' && request.url.startsWith('/api/upload')) {
      reply.hijack();
      handleRawUpload(request.raw, reply.raw);
      return;
    }
    done();
  });

  void app.register(compress);

  registerApiRoutes(app);

  // User-uploaded images.
  const uploadsRoot = resolve(config.dataDir, config.uploadDir);
  void app.register(fastifyStatic, {
    root: uploadsRoot,
    prefix: '/uploads/',
    decorateReply: false,
  });

  // Built SPA (produced by the frontend image stage).
  const indexHtml = resolve(config.publicDir, 'index.html');
  if (existsSync(indexHtml)) {
    void app.register(fastifyStatic, {
      root: config.publicDir,
      prefix: '/',
      wildcard: false,
    });

    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/') || request.url.startsWith('/uploads/')) {
        return reply.code(404).send({ error: 'Not Found' });
      }
      return reply.type('text/html').sendFile('index.html');
    });
  }

  return app;
}
