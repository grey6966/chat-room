/**
 * Lightweight load test: spins up N virtual users that join the hall,
 * each sends M messages, then verifies broadcast fan-out and persistence.
 *
 * Run with the server already listening:
 *   node --import tsx scripts/loadtest.ts [users] [messagesPerUser]
 */
import { io, type Socket } from 'socket.io-client';

const URL = process.env.LOADTEST_URL ?? 'http://localhost:3001';
const USERS = Number(process.argv[2] ?? 200);
const MESSAGES_PER_USER = Number(process.argv[3] ?? 20);
const SEND_INTERVAL_MS = Number(process.env.SEND_INTERVAL_MS ?? 120);

interface JoinAck {
  ok: boolean;
  error?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function join(socket: Socket, username: string): Promise<void> {
  const ack = (await socket.timeout(10_000).emitWithAck('join', { username })) as JoinAck;
  if (!ack.ok) throw new Error(`join failed for ${username}: ${ack.error}`);
}

async function main(): Promise<void> {
  console.log(`[loadtest] ${USERS} users × ${MESSAGES_PER_USER} messages against ${URL}`);
  const expected = USERS * MESSAGES_PER_USER;
  const sockets: Socket[] = [];
  const counters = new Map<string, number>();
  const started = Date.now();

  // Connect + join in staggered waves to avoid a thundering handshake.
  for (let i = 0; i < USERS; i++) {
    const username = `load_${i}_${started.toString(36)}`;
    const socket = io(URL, { reconnection: false });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect_error', reject);
      socket.on('connect', () => resolve());
    });
    await join(socket, username);
    socket.on('channel:message', (msg: { sender: string }) => {
      counters.set(msg.sender, (counters.get(msg.sender) ?? 0) + 1);
    });
    sockets.push(socket);
    if (i % 50 === 0) process.stdout.write(`\r[loadtest] joined ${i + 1}/${USERS}`);
    await sleep(2);
  }
  console.log(`\n[loadtest] all ${USERS} users joined in ${Date.now() - started} ms`);

  // Every user broadcasts MESSAGES_PER_USER messages.
  const sendStart = Date.now();
  await Promise.all(
    sockets.map(async (socket, i) => {
      for (let m = 0; m < MESSAGES_PER_USER; m++) {
        socket.emit('channel:message', { content: `loadtest msg ${m} from user ${i}` });
        await sleep(SEND_INTERVAL_MS);
      }
    })
  );
  console.log(`[loadtest] all ${expected} messages sent in ${Date.now() - sendStart} ms`);

  // Give the loop time to flush the final fan-out, then tally.
  await sleep(3000);

  let receivedFrom = 0;
  let totalReceived = 0;
  for (const [, count] of counters) {
    receivedFrom++;
    totalReceived += count;
  }

  // Persistence check: a fresh user should see the last 100 stored messages.
  const probe = io(URL, { reconnection: false });
  await new Promise<void>((resolve) => probe.on('connect', resolve));
  const historyAck = (await probe
    .timeout(10_000)
    .emitWithAck('join', { username: `probe_${started.toString(36)}` })) as JoinAck & {
    history?: unknown[];
  };
  const persisted = historyAck.history?.length ?? 0;
  probe.disconnect();

  for (const socket of sockets) socket.disconnect();

  console.log('---------------------------');
  console.log(`distinct senders observed by listeners : ${receivedFrom}/${USERS}`);
  console.log(`messages received by listeners (sum)    : ${totalReceived}`);
  console.log(`probe sees persisted history rows       : ${persisted}`);
  console.log(`total wall time                         : ${Date.now() - started} ms`);

  if (receivedFrom !== USERS) {
    console.error('[loadtest] FAIL: not every user was observed broadcasting');
    process.exit(1);
  }
  if (persisted === 0) {
    console.error('[loadtest] FAIL: no persisted history visible to a fresh user');
    process.exit(1);
  }
  console.log('[loadtest] PASS');
  process.exit(0);
}

main().catch((error) => {
  console.error('[loadtest] error:', error);
  process.exit(1);
});
