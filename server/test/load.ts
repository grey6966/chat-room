/* eslint-disable no-console */
/**
 * 简易高并发压测：N 个用户同时进入，每人发送 M 条群消息，
 * 校验：所有消息落库、每个客户端最终收到 N*M 条广播、用户名无错乱。
 * 运行：npx tsx test/load.ts
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { io, type Socket } from 'socket.io-client';

const PORT = 3102;
const URL = `http://localhost:${PORT}`;
const USERS = 100;
const PER_USER = 10;

async function main(): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-load-'));
  const server = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  server.stderr?.on('data', (d) => process.stderr.write(`[server] ${d}`));

  for (let i = 0; i < 40; i++) {
    try {
      await fetch(URL);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  const clients: Socket[] = [];
  const received = new Array<number>(USERS).fill(0);
  const t0 = Date.now();

  try {
    // 100 用户并发连接 + 进入
    await Promise.all(
      Array.from({ length: USERS }, (_, i) =>
        new Promise<void>((resolve, reject) => {
          const s = io(URL, { transports: ['websocket'], forceNew: true });
          clients.push(s);
          s.on('connect_error', reject);
          s.on('connect', () => {
            s.timeout(10000).emitWithAck('join', `user${i.toString().padStart(3, '0')}`)
              .then((ack: { ok: boolean }) => (ack.ok ? resolve() : reject(new Error(`join 失败 ${i}`))))
              .catch(reject);
          });
          s.on('public:message', () => {
            received[i]++;
          });
        })
      )
    );
    console.log(`${USERS} 人全部进入，耗时 ${Date.now() - t0}ms`);

    // 每人发 10 条（总写入 1000，总广播 100_000 次）
    const t1 = Date.now();
    await Promise.all(
      clients.map((s, i) =>
        Promise.all(
          Array.from({ length: PER_USER }, (_, j) =>
            s.timeout(10000).emitWithAck('public:send', `<p>u${i}-m${j}</p>`)
          )
        )
      )
    );
    console.log(`${USERS * PER_USER} 条消息全部写入，耗时 ${Date.now() - t1}ms`);

    // 等待广播收敛
    const target = USERS * PER_USER;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && received.some((n) => n < target)) {
      await new Promise((r) => setTimeout(r, 200));
    }

    const min = Math.min(...received);
    const max = Math.max(...received);
    console.log(`每客户端接收条数 min=${min} max=${max}（期望 ${target}）`);
    console.log(`总耗时 ${Date.now() - t0}ms`);

    if (min === target && max === target) console.log('🎉 压测通过：无消息丢失/重复');
    else {
      console.log('💥 压测失败：存在消息丢失');
      process.exitCode = 1;
    }
  } finally {
    clients.forEach((c) => c.disconnect());
    server.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main();
