import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config } from './config.js';
import './db.js';
import { createApp } from './app.js';
import { attachRealtime } from './realtime.js';

const MAX_PORT_TRIES = 10;

/**
 * Listen on the configured port; if it is already taken, retry on the next
 * free ports so local development never dies with EADDRINUSE.
 */
async function listenWithFallback(
  server: ReturnType<typeof createApp>,
  port: number,
  host: string
): Promise<number> {
  for (let attempt = 0; attempt < MAX_PORT_TRIES; attempt++) {
    const candidate = port + attempt;
    try {
      await server.listen({ port: candidate, host });
      if (attempt > 0) {
        server.log.warn(
          `port ${port} was busy, server started on http://${host}:${candidate} instead`
        );
      }
      return candidate;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'EADDRINUSE' && attempt < MAX_PORT_TRIES - 1) {
        server.log.warn(`port ${candidate} is in use, trying ${candidate + 1}…`);
        continue;
      }
      throw error;
    }
  }
  throw new Error('no free port found');
}

/**
 * Publish the actual listening port for the Vite dev proxy, which reads
 * backend/.dev-port at startup and auto-restarts when it changes. Only
 * meaningful in local development; a failure (read-only FS) is harmless.
 */
async function publishDevPort(port: number): Promise<void> {
  try {
    await writeFile(resolve(process.cwd(), '.dev-port'), String(port), 'utf8');
  } catch {
    // ignore
  }
}

async function main(): Promise<void> {
  const app = createApp();
  attachRealtime(app.server);

  const actualPort = await listenWithFallback(app, config.port, config.host);
  app.log.info(`chat server listening on http://${config.host}:${actualPort}`);
  await publishDevPort(actualPort);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
