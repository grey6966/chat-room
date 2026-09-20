/**
 * Reconnection semantics:
 *  1. When a socket drops (enters the recovery grace period), a new connection
 *     using the same username may reclaim it immediately.
 *  2. While the first socket is genuinely live, the name cannot be stolen.
 */
import { io, type Socket } from 'socket.io-client';

const URL = process.env.SMOKE_URL ?? 'http://localhost:3000';
let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function connect(): Socket {
  return io(URL, { reconnection: false, forceNew: true });
}
async function join(socket: Socket, username: string) {
  return socket.timeout(5000).emitWithAck('join', { username }) as Promise<any>;
}

async function main(): Promise<void> {
  const name = `reconnect_${Date.now()}`;

  // First live connection owns the name.
  const a = connect();
  await new Promise<void>((r) => a.on('connect', r));
  const ackA = await join(a, name);
  check('A joins', ackA.ok === true);

  // A genuinely live connection rejects a second client with the same name.
  const b = connect();
  await new Promise<void>((r) => b.on('connect', r));
  const ackB = await join(b, name);
  check('live name cannot be stolen', ackB.ok === false && /占用/.test(ackB.error));

  // A's transport dies abruptly (no clean disconnect) -> recovery grace.
  a.io.engine.close();
  await sleep(500);

  // A new connection reclaims the name immediately.
  const c = connect();
  await new Promise<void>((r) => c.on('connect', r));
  const ackC = await join(c, name);
  check('name reclaimed during grace period', ackC.ok === true, JSON.stringify(ackC).slice(0, 120));

  // Channel message from C broadcasts and lands in history for later joins.
  c.emit('channel:message', { content: 'RECONNECT_MARKER' });
  await sleep(300);

  b.disconnect();
  c.disconnect();

  console.log('---------------------------');
  console.log(failures === 0 ? 'RECONNECT TESTS PASSED' : `${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
