import { config } from './config.js';
import './db.js';
import { createApp } from './app.js';
import { attachRealtime } from './realtime.js';

async function main(): Promise<void> {
  const app = createApp();
  attachRealtime(app.server);

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`chat server listening on http://${config.host}:${config.port}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
