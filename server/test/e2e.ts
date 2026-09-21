/* eslint-disable no-console */
/**
 * 端到端集成测试：真实启动服务（HTTP + Socket.IO + SQLite），
 * 覆盖需求点：用户名查重、群聊广播、在线列表上下线、私聊隔离、
 * 历史持久化、富文本/XSS 净化、图片上传与非法图片拦截。
 * 运行：npx tsx test/e2e.ts
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { io, type Socket } from 'socket.io-client';

const PORT = 3101;
const URL = `http://localhost:${PORT}`;
let failures = 0;

function check(name: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    failures++;
    console.error(`  ❌ ${name}`, extra ?? '');
  }
}

function waitFor<T>(s: Socket, event: string, timeoutMs = 1500): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      s.off(event, handler);
      reject(new Error(`等待事件 ${event} 超时`));
    }, timeoutMs);
    const handler = (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    };
    s.on(event, handler);
  });
}

function expectNoEvent(s: Socket, event: string, timeoutMs = 600): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      s.off(event, handler);
      resolve(true); // 超时未收到 = 符合预期
    }, timeoutMs);
    const handler = () => {
      clearTimeout(timer);
      resolve(false); // 不该收到却收到了
    };
    s.on(event, handler);
  });
}

function connect(): Socket {
  return io(URL, { transports: ['websocket'], forceNew: true });
}

async function waitConnected(s: Socket): Promise<void> {
  if (s.connected) return;
  await new Promise<void>((resolve) => s.once('connect', () => resolve()));
}

async function main(): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-e2e-'));
  console.log(`临时数据目录: ${dataDir}`);

  const server = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', (d) => process.stdout.write(`[server] ${d}`));
  server.stderr?.on('data', (d) => process.stderr.write(`[server] ${d}`));

  // 等待端口就绪
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(URL);
      if (r.ok || r.status === 404) break;
    } catch {
      /* 未就绪，继续等 */
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  try {
    /* ---------- 1. 用户名校验与查重 ---------- */
    console.log('\n[1] 用户名校验 / 查重');
    const alice = connect();
    await waitConnected(alice);
    const a1 = await alice.timeout(3000).emitWithAck('join', 'alice');
    check('alice 进入成功', a1.ok === true);

    const badName = connect();
    await waitConnected(badName);
    const a2 = await badName.timeout(3000).emitWithAck('join', 'a');
    check('过短用户名被拒', a2.ok === false && /2-16/.test(a2.error));
    badName.disconnect();

    const bob = connect();
    const carol = connect();
    await Promise.all([waitConnected(bob), waitConnected(carol)]);
    const [b1, c1] = await Promise.all([
      bob.timeout(3000).emitWithAck('join', 'bob'),
      carol.timeout(3000).emitWithAck('join', 'carol'),
    ]);
    check('bob / carol 进入成功', b1.ok && c1.ok);

    const dup = connect();
    await waitConnected(dup);
    const dupAck = await dup.timeout(3000).emitWithAck('join', 'alice');
    check('重复用户名被拒', dupAck.ok === false && /占用/.test(dupAck.error));
    dup.disconnect();

    /* ---------- 2. 在线列表 ---------- */
    console.log('\n[2] 在线用户列表实时更新');
    await new Promise((r) => setTimeout(r, 300));
    const presenceNow = await new Promise((resolve) => {
      // 用一次新加入触发广播，直接读 bob 侧最近一次更新
      const probe = connect();
      probe.on('presence:update', (users) => resolve(users));
      waitConnected(probe).then(() => probe.timeout(3000).emitWithAck('join', 'probe'));
    });
    const names = (presenceNow as { username: string }[]).map((u) => u.username).sort();
    check('列表包含全部 4 人', JSON.stringify(names) === JSON.stringify(['alice', 'bob', 'carol', 'probe']), names);

    /* ---------- 3. 群聊广播 ---------- */
    console.log('\n[3] 群聊消息实时广播');
    const gotByBob = waitFor(bob, 'public:message');
    const gotByCarol = waitFor(carol, 'public:message');
    await alice.timeout(3000).emitWithAck('public:send', '<p>大家好</p>');
    const mb = await gotByBob;
    const mc = await gotByCarol;
    check('bob 收到群消息', (mb as { content: string }).content.includes('大家好'));
    check('carol 收到群消息', (mc as { content: string }).content.includes('大家好'));

    /* ---------- 4. XSS / 富文本净化 ---------- */
    console.log('\n[4] 富文本白名单净化（防 XSS）');
    const xssPromise = waitFor<{ content: string }>(bob, 'public:message');
    await alice
      .timeout(3000)
      .emitWithAck('public:send', '<p>正常文本</p><script>alert(1)</script><img src=x onerror="alert(1)"><b>粗体</b>');
    const xssMsg = await xssPromise;
    check('<script> 被移除', !xssMsg.content.includes('<script'));
    check('onerror 被移除', !xssMsg.content.includes('onerror'));
    check('合法标签 <b> 保留', xssMsg.content.includes('<b>粗体</b>'), xssMsg.content);

    /* ---------- 5. 私聊隔离 ---------- */
    console.log('\n[5] 私聊仅双方可见');
    const dmToBob = waitFor<{ content: string; senderName: string }>(bob, 'dm:message');
    const carolShouldNot = expectNoEvent(carol, 'dm:message');
    const dmAck = await alice
      .timeout(3000)
      .emitWithAck('dm:send', { to: 'bob', content: '<p>悄悄告诉你</p>' });
    check('私聊发送成功', dmAck.ok === true, dmAck);
    const dmGot = await dmToBob;
    check('bob 收到私聊', dmGot.content.includes('悄悄告诉你') && dmGot.senderName === 'alice');
    check('carol 收不到该私聊', await carolShouldNot);

    const selfDm = await alice.timeout(3000).emitWithAck('dm:send', { to: 'alice', content: 'x' });
    check('不能给自己私聊', selfDm.ok === false);
    const ghostDm = await alice.timeout(3000).emitWithAck('dm:send', { to: 'ghost', content: 'x' });
    check('发给不存在用户被拒', ghostDm.ok === false);

    /* ---------- 6. 下线实时更新 ---------- */
    console.log('\n[6] 用户下线列表实时更新');
    const leavePromise = waitFor<{ username: string }[]>(alice, 'presence:update');
    carol.disconnect();
    const after = await leavePromise;
    check('下线后列表移除该用户', !after.some((u) => u.username === 'carol'), after);

    /* ---------- 7. 历史记录持久化（刷新页面场景） ---------- */
    console.log('\n[7] 聊天记录持久化');
    const reborn = connect();
    await waitConnected(reborn);
    const joinAck = await reborn.timeout(3000).emitWithAck('join', 'newcomer');
    check('新用户进入即拿到历史', joinAck.ok && joinAck.recentMessages.length >= 2);
    check('历史含之前的群消息', joinAck.recentMessages.some((m: { content: string }) => m.content.includes('大家好')));
    check('历史内容为净化后的版本', joinAck.recentMessages.every((m: { content: string }) => !m.content.includes('<script')));

    const dmHistory = await bob.timeout(3000).emitWithAck('dm:open', 'alice');
    check('私聊历史可查', dmHistory.ok && dmHistory.messages.some((m: { content: string }) => m.content.includes('悄悄告诉你')));

    /* ---------- 8. 图片上传 ---------- */
    console.log('\n[8] 图片上传（HTTP multipart）');
    // 1x1 透明 PNG
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==',
      'base64'
    );
    const form = new FormData();
    form.append('image', new Blob([png], { type: 'image/png' }), 'a.png');
    const up = await fetch(`${URL}/api/upload/image`, { method: 'POST', body: form });
    const upJson = await up.json();
    check('PNG 上传成功', up.status === 201 && typeof upJson.url === 'string' && upJson.url.startsWith('/uploads/'), upJson);
    const fetched = await fetch(`${URL}${upJson.url}`);
    check('上传图片可访问', fetched.status === 200 && (await fetched.arrayBuffer()).byteLength === png.byteLength);

    const badForm = new FormData();
    badForm.append('image', new Blob(['not an image'], { type: 'text/plain' }), 'x.txt');
    const badUp = await fetch(`${URL}/api/upload/image`, { method: 'POST', body: badForm });
    check('非图片文件被拒', badUp.status === 400);

    /* ---------- 9. 空消息拦截 ---------- */
    console.log('\n[9] 空消息拦截');
    const empty = await bob.timeout(3000).emitWithAck('public:send', '   ');
    check('空白消息被拒', empty.ok === false);

    /* ---------- 10. 群消息已读回执 ---------- */
    console.log('\n[10] 群消息已读回执');
    const bobGotReadMsg = waitFor<{ id: number }>(bob, 'public:message');
    const aliceGotReceipt = waitFor<{ username: string; lastReadId: number }>(alice, 'read:update');
    await alice.timeout(3000).emitWithAck('public:send', '<p>已读测试</p>');
    const readMsg = await bobGotReadMsg;
    await bob.timeout(3000).emitWithAck('read:report', readMsg.id);
    const receipt = await aliceGotReceipt;
    check(
      '发送者收到 bob 的已读回执',
      receipt.username === 'bob' && receipt.lastReadId === readMsg.id,
      receipt
    );

    // 重复上报旧游标不应产生广播；上报更大的游标应再次广播
    const noDup = expectNoEvent(alice, 'read:update');
    await bob.timeout(3000).emitWithAck('read:report', readMsg.id);
    check('重复旧游标不重复广播', await noDup);

    // 新用户进入：历史消息带 readCount，且其加入即把已读游标推到最新
    const dave = connect();
    await waitConnected(dave);
    // 监听需在 join 之前注册：服务端在 join 处理中就会广播已读游标
    const daveReceiptPromise = waitFor<{ username: string }>(alice, 'read:update');
    const daveJoin = await dave.timeout(3000).emitWithAck('join', 'dave');
    const target = daveJoin.recentMessages.find(
      (m: { content: string }) => m.content.includes('已读测试')
    ) as { readCount?: number } | undefined;
    check(
      '历史消息附带已读人数（bob 已读，>=1）',
      !!target && typeof target.readCount === 'number' && target.readCount >= 1,
      target
    );
    const daveReceipt = await daveReceiptPromise;
    check('新用户进入广播已读游标', daveReceipt.username === 'dave', daveReceipt);
    dave.disconnect();

    alice.disconnect();
    bob.disconnect();
    reborn.disconnect();
  } catch (e) {
    failures++;
    console.error('测试执行异常:', e);
  } finally {
    server.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  console.log(failures === 0 ? '\n🎉 全部测试通过' : `\n💥 ${failures} 项失败`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
