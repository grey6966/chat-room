/** End-to-end smoke test against a running server (dev: npx tsx scripts/smoke.ts). */
import { io, type Socket } from 'socket.io-client';

const URL = process.env.SMOKE_URL ?? 'http://localhost:3001';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function connect(): Socket {
  return io(URL, { reconnection: false, forceNew: true });
}

async function join(socket: Socket, username: string) {
  return socket.timeout(5000).emitWithAck('join', { username });
}

async function main(): Promise<void> {
  // --- health endpoint ---
  const health = await fetch(`${URL}/api/health`).then((r) => r.json());
  check('GET /api/health', health.ok === true);

  // --- two users join ---
  const alice = connect();
  const bob = connect();
  await Promise.all([
    new Promise<void>((res) => alice.on('connect', res)),
    new Promise<void>((res) => bob.on('connect', res)),
  ]);

  const ackA = (await join(alice, `alice_smoke_${Date.now()}`)) as any;
  check('alice joins', ackA.ok === true, `presence=${ackA.presence?.length}`);
  const aliceName = ackA.session.username;

  const ackB = (await join(bob, `bob_smoke_${Date.now()}`)) as any;
  check('bob joins', ackB.ok === true);
  const bobName = ackB.session.username;

  // --- duplicate username rejected ---
  const carol = connect();
  await new Promise<void>((res) => carol.on('connect', res));
  const dup = (await join(carol, aliceName)) as any;
  check('duplicate username rejected', dup.ok === false && /占用/.test(dup.error), dup.error);
  carol.disconnect();

  // --- presence broadcast ---
  await wait(200);
  const seenByAlice = new Promise<string[]>((res) => {
    const handler = (p: string[]) => res(p);
    alice.once('presence', handler);
  });
  const dave = connect();
  await new Promise<void>((res) => dave.on('connect', res));
  const ackD = (await join(dave, `dave_smoke_${Date.now()}`)) as any;
  (dave as any)._smokeName = ackD.session.username;
  const presence = await seenByAlice;
  check('presence updates in real time', presence.length >= 3, `n=${presence.length}`);

  // --- channel broadcast ---
  const gotByBob = new Promise<any>((res) => bob.once('channel:message', res));
  const gotByAlice = new Promise<any>((res) => alice.once('channel:message', res));
  alice.emit('channel:message', { content: '**hello** everyone `code`' });
  const [m1, m2] = await Promise.all([gotByBob, gotByAlice]);
  check('channel message broadcast to bob', m1.sender === aliceName && m1.content.includes('hello'));
  check('channel message echoed to sender', m2.id === m1.id && m2.type === 'channel');

  // --- read receipts ---
  const readsUpdate = new Promise<Record<string, number>>((res) => {
    alice.once('channel:reads', res);
  });
  bob.emit('channel:read', { upTo: m1.id });
  const reads = await readsUpdate;
  check(
    'read receipt updates count for the sender',
    reads[m1.id] === 1,
    JSON.stringify(reads)
  );

  const readersAck = (await alice
    .timeout(5000)
    .emitWithAck('channel:readers', { messageId: m1.id })) as any;
  check(
    'readers list contains bob but not sender',
    readersAck.ok &&
      readersAck.readers.includes(bobName) &&
      !readersAck.readers.includes(aliceName),
    JSON.stringify(readersAck.readers)
  );

  // Reporting the same position again is idempotent (no new rows/events).
  let extraBroadcast = false;
  const onExtra = (): boolean => (extraBroadcast = true);
  alice.on('channel:reads', onExtra);
  bob.emit('channel:read', { upTo: m1.id });
  await wait(300);
  check('duplicate read report is idempotent', extraBroadcast === false);
  alice.off('channel:reads', onExtra);

  // Invalid payloads are ignored rather than crashing the socket.
  bob.emit('channel:read', { upTo: 'not-a-number' });
  bob.emit('channel:read', {});
  await wait(150);
  check('malformed read events ignored', alice.connected && bob.connected);

  // --- direct message only reaches the two peers ---
  let bobGot = false;
  let aliceGot = false;
  let daveGot = false;
  bob.on('direct:message', () => (bobGot = true));
  alice.on('direct:message', () => (aliceGot = true));
  dave.on('direct:message', () => (daveGot = true));
  alice.emit('direct:message', { to: bobName, content: 'secret 🤫' });
  await wait(300);
  check('DM delivered to recipient', bobGot);
  check('DM echoed to sender', aliceGot);
  check('DM not leaked to third user', daveGot === false);

  // DM to offline user silently dropped
  const zoe = connect();
  await new Promise<void>((res) => zoe.on('connect', res));
  await join(zoe, `zoe_smoke_${Date.now()}`);
  zoe.disconnect();
  await wait(300);
  let leaked = false;
  alice.on('direct:message', () => (leaked = true));
  alice.emit('direct:message', { to: 'zoe_smoke_does_not_exist', content: 'hi' });
  await wait(200);
  check('DM to nonexistent user not delivered', leaked === false);

  // --- DM history round-trip ---
  const hist = (await bob
    .timeout(5000)
    .emitWithAck('history:direct', { peer: aliceName, limit: 50 })) as any;
  check(
    'DM history persisted & retrievable',
    hist.ok && hist.messages.some((m: any) => m.content === 'secret 🤫')
  );

  // --- channel history persisted (fresh join sees it) ---
  const erin = connect();
  await new Promise<void>((res) => erin.on('connect', res));
  const ackE = (await join(erin, `erin_smoke_${Date.now()}`)) as any;
  check(
    'new user sees channel history after refresh',
    ackE.ok && ackE.history.some((m: any) => m.content.includes('hello'))
  );

  // --- leave presence + notice ---
  // Let any in-flight join notices (e.g. from erin above) drain first, then
  // register both listeners BEFORE disconnecting so the events can't race.
  await wait(300);
  const leaveNotice = new Promise<any>((res, rej) => {
    const t = setTimeout(() => rej(new Error('timed out waiting for leave notice')), 5000);
    alice.once('notice', (n) => {
      clearTimeout(t);
      res(n);
    });
  });
  const leavePresence = new Promise<string[]>((res, rej) => {
    const t = setTimeout(() => rej(new Error('timed out waiting for presence')), 5000);
    alice.once('presence', (p) => {
      clearTimeout(t);
      res(p);
    });
  });
  const daveName = (dave as any)._smokeName as string;
  dave.disconnect();
  const [notice, afterLeave] = await Promise.all([leaveNotice, leavePresence]);
  check('leave notice broadcast', notice.kind === 'leave', JSON.stringify(notice));
  check(
    'presence shrinks after disconnect',
    !afterLeave.includes(daveName),
    `got ${afterLeave.length} users`
  );

  // --- upload: auth required ---
  const unauth = await fetch(`${URL}/api/upload`, { method: 'POST' });
  check('upload without auth -> 401', unauth.status === 401);

  // --- upload: real 1x1 PNG accepted, fake rejected ---
  const png = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082',
    'hex'
  );
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'pixel.png');
  const up = await fetch(`${URL}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ackA.session.token}` },
    body: form,
  });
  const upBody = (await up.json()) as any;
  const upOk = up.status === 200 && typeof upBody.url === 'string' && /^\/uploads\//.test(upBody.url);
  check('valid PNG upload returns url', upOk, `${up.status} ${JSON.stringify(upBody)}`);

  if (upOk) {
    const fetched = await fetch(`${URL}${upBody.url}`);
    check(
      'uploaded image is served',
      fetched.ok && (await fetched.arrayBuffer()).byteLength === png.length
    );
  }

  const fakeForm = new FormData();
  fakeForm.append('file', new Blob([Buffer.from('MZ\x90\x00not really a png')], { type: 'image/png' }), 'evil.png');
  const fake = await fetch(`${URL}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ackA.session.token}` },
    body: fakeForm,
  });
  check('disguised non-image rejected', fake.status === 415);

  alice.disconnect();
  bob.disconnect();
  erin.disconnect();

  console.log('---------------------------');
  console.log(failures === 0 ? 'ALL SMOKE TESTS PASSED' : `${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
