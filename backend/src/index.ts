import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config } from './config.js';
import './db.js';
import { createApp } from './app.js';
import { attachRealtime } from './realtime.js';

const MAX_PORT_TRIES = 10;

/**
 * Record the actual listening port for `vite dev`'s dynamic proxy. Only
 * meaningful in local development; failure (e.g. read-only container FS)
 * is harmless and ignored.
 */
async function publishDevPort(port: number): Promise<void> {
  try {
    await writeFile(resolve(process.cwd(), '.dev-port'), String(port), 'utf8');
  } catch {
    // ignore
  }
}

async function listenWithFallback(
  app: ReturnType<typeof createApp>,
  port: number,
  host: string
): Promise<number> {
  for (let attempt = 0; attempt < MAX_PORT_TRIES; attempt++) {
    const candidate = port + attempt;
    try {
      await app.listen({ port: candidate, host });
      if (attempt > 0) {
        app.log.warn(`端口 ${port} 被占用，已自动切换到 ${candidate}`);
      }
      return candidate;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'EADDRINUSE' && attempt < MAX_PORT_TRIES - 1) {
        app.log.warn(`端口 ${candidate} 被占用，尝试 ${candidate + 1}…`);
        continue;
      }
      throw error;
    }
  }
  return port;
}

async function main(): Promise<void> {
  const app = createApp();
  attachRealtime(app.server);

  const port = await listenWithFallback(app, config.port, config.host);
  app.log.info(`chat server listening on http://${config.host}:${port}`);
  await publishDevPort(port);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
