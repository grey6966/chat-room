/** Read-receipt end-to-end test (channel read counts + readers list). */
import { io, type Socket } from 'socket.io-client';

const URL = process.env.SMOKE_URL ?? 'http://localhost:3003';
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
  const tag = `receipt_${Date.now()}`;
  const a = connect();
  const b = connect();
  const c = connect();
  await Promise.all([a, b, c].map((s) => new Promise<void>((r) => s.on('connect', r))));

  const ackA = await join(a, `alice_${tag}`);
  const ackB = await join(b, `bob_${tag}`);
  const ackC = await join(c, `carol_${tag}`);
  check('three users join', ackA.ok && ackB.ok && ackC.ok);
  const nameA = ackA.session.username;
  const nameB = ackB.session.username;
  const nameC = ackC.session.username;

  // History delivered to later joiners (B, C) already carries read counts and
  // includes the joining user themselves only for pre-existing messages.
  const sentByOthers = ackC.history.filter(
    (m: any) => m.type === 'channel' && m.sender !== nameC
  );
  check(
    'join history includes readBy counts',
    sentByOthers.length === 0 || typeof sentByOthers[0].readBy === 'number',
    `sample readBy=${sentByOthers[0]?.readBy}`
  );

  // A sends a message; echo carries readBy=1 (sender counts).
  const echoP = new Promise<any>((resolve) => a.once('channel:message', resolve));
  const toBP = new Promise<any>((r) => b.once('channel:message', r));
  const toCP = new Promise<any>((r) => c.once('channel:message', r));
  a.emit('channel:message', { content: `receipt marker ${tag}` });
  const echo = await echoP;
  check('echo has readBy=1 (sender)', echo.readBy === 1, `readBy=${echo.readBy}`);
  const msgId = echo.id as number;

  // B and C receive it with readBy=1.
  const toB = await toBP;
  const toC = await toCP;
  check('delivery readBy=1', toB.readBy === 1 && toC.readBy === 1);

  // Receipts fan-out: after B marks read, all three get a channel:receipts update.
  const updateA = new Promise<Record<string, number>>((res) =>
    a.once('channel:receipts', (u: any) => res(u.counts))
  );
  const updateC = new Promise<Record<string, number>>((res) =>
    c.once('channel:receipts', (u: any) => res(u.counts))
  );
  b.emit('channel:read', { lastId: msgId });
  const [countsA, countsC] = await Promise.all([updateA, updateC]);
  check('receipt broadcast shows 2 readers', countsA[String(msgId)] === 2, JSON.stringify(countsA[String(msgId)]));
  check('third client receives receipt broadcast', countsC[String(msgId)] === 2);

  // Reader list for the message includes A (sender) and B, not C.
  const readersAck = (await a
    .timeout(5000)
    .emitWithAck('channel:readers', { messageId: msgId })) as any;
  check(
    'readers list contains sender + B only',
    readersAck.ok &&
      readersAck.readers.includes(nameA) &&
      readersAck.readers.includes(nameB) &&
      !readersAck.readers.includes(nameC),
    JSON.stringify(readersAck.readers)
  );

  // C marks read too -> 3 readers.
  const updateB = new Promise<number>((res) =>
    b.once('channel:receipts', (u: any) => res(u.counts[String(msgId)]))
  );
  c.emit('channel:read', { lastId: msgId });
  check('after C reads, count is 3', (await updateB) === 3);

  // Invalid payloads ignored (no crash, no ack needed).
  b.emit('channel:read', { lastId: -5 });
  b.emit('channel:read', {});
  const badAck = (await b
    .timeout(3000)
    .emitWithAck('channel:readers', { messageId: 'x' })
    .catch(() => ({ ok: false }))) as any;
  check('invalid messageId rejected', badAck.ok === false);

  await sleep(200);
  a.disconnect();
  b.disconnect();
  c.disconnect();

  console.log('---------------------------');
  console.log(failures === 0 ? 'RECEIPT TESTS PASSED' : `${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
