import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { io } from 'socket.io-client';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createAuthorityServer } from '../server.mjs';
import { MovementCommandSource, validateSpatial } from '../../protocol/spatial.mjs';

const until = async (check, message, timeout = 3000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(message);
};

test('真实PG与Socket.IO：收据查询不取会话行锁，并发收据查询中控制恢复仍获ACK', async t => {
  const database = await startTestPostgres('p05-control-priority', { outputSubdirectory: 'p05-control-priority' });
  const receiptContext = new AsyncLocalStorage();
  const sessionSelects = [];
  const originalConnect = database.pool.connect;
  database.pool.connect = (...args) => {
    const connecting = originalConnect.apply(database.pool, args);
    if (typeof connecting?.then !== 'function') return connecting;
    return connecting.then(client => {
      const originalQuery = client.query.bind(client);
      client.query = (...queryArgs) => {
        const sql = typeof queryArgs[0] === 'string' ? queryArgs[0] : queryArgs[0]?.text;
        const sessionSelect = typeof sql === 'string' && /\bFROM sessions\b/i.test(sql);
        const forUpdate = sessionSelect && /\bFOR UPDATE\b/i.test(sql);
        const receipt = receiptContext.getStore()?.receipt === true;
        const record = () => { if (sessionSelect) sessionSelects.push({ command: receipt ? 'receipt' : 'other', forUpdate, completedAt: Date.now() }); };
        const callbackIndex = queryArgs.findIndex(arg => typeof arg === 'function');
        if (callbackIndex >= 0) {
          const callback = queryArgs[callbackIndex];
          queryArgs[callbackIndex] = (error, value) => { try { if (!error) record(); } finally { callback(error, value); } };
          return originalQuery(...queryArgs);
        }
        return originalQuery(...queryArgs).then(value => { record(); return value; });
      };
      return client;
    });
  };
  const sockets = [];
  let server;
  let restoreRuntime;
  let releaseBlocker;
  let releaseReceipts;
  let blockerReleased = false;
  let receiptsReleased = false;
  t.after(async () => {
    releaseBlocker?.();
    releaseReceipts?.();
    restoreRuntime?.();
    database.pool.connect = originalConnect;
    for (const socket of sockets) socket.disconnect();
    await server?.close();
    await database.stop();
  });

  const clock = Date.parse('2026-11-16T12:00:00.000Z');
  server = await createAuthorityServer({ pool: database.pool, now: () => clock });
  const address = await server.listen(0), origin = `http://127.0.0.1:${address.port}`;
  const capabilities = ['spatial-v2'];
  const http = async (path, token, body) => {
    const response = await fetch(origin + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    if (!text) throw new Error(`空响应：${path} status=${response.status}`);
    return { status: response.status, body: JSON.parse(text) };
  };
  const connect = async token => {
    const socket = io(origin, { auth: { token, capabilities }, transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    return socket;
  };
  const rpc = (socket, event, value) => socket.timeout(6000).emitWithAck(event, value);
  const users = [];
  for (let i = 0; i < 2; i++) users.push((await http('/auth/guest', null, { name: `控制优先测试玩家${i + 1}` })).body);
  const { sessionId } = (await http('/sessions', users[0].token, { nonce: 'create', contentVersion: 'spatial-graybox-v2', capabilities })).body;
  for (const [index, user] of users.entries()) assert.deepEqual((await http(`/sessions/${sessionId}/join`, user.token, { nonce: `join-${index}`, capabilities })).body, { sessionId });
  await http(`/sessions/${sessionId}/start`, users[0].token, { nonce: 'start' });

  const socket = await connect(users[0].token);
  const subscribed = await rpc(socket, 'session.subscribe', { sessionId });
  validateSpatial('SnapshotV2', subscribed);
  const baseline = await rpc(socket, 'control.resume', JSON.stringify({ schemaVersion: 2, type: 'control.resume', sessionId, viewId: subscribed.viewId, actorRef: subscribed.projection.self.entityRef, nonce: 'baseline-resume' }));
  validateSpatial('ControlResponseV2', baseline);
  const source = new MovementCommandSource(baseline.controlEpoch);
  const actionId = 'p05-original-wait';
  const originalReceipt = await rpc(socket, 'player.action.request', JSON.stringify({ schemaVersion: 2, sessionId, viewId: baseline.snapshot.viewId, actorRef: baseline.snapshot.projection.self.entityRef, clientActionId: actionId, controlEpoch: baseline.controlEpoch, baseSeq: baseline.observedSeq, action: { kind: 'wait' } }));
  validateSpatial('ReceiptV2', originalReceipt);
  assert.equal(originalReceipt.status, 'Accepted');
  assert.deepEqual((await http(`/sessions/${sessionId}/actions/${actionId}`, users[0].token)).body, originalReceipt);

  const originalMaintenance = server.runtime.maintenance.bind(server.runtime);
  const originalPublish = server.runtime.publishPending.bind(server.runtime);
  const originalReceiptRead = server.runtime.receipt.bind(server.runtime);
  const originalBeforeCommit = server.runtime.hooks.beforeCommit;
  const originalLocked = server.runtime.locked.bind(server.runtime);
  let receiptCompletions = 0;
  const commitOrder = [];
  let controlEntered;
  const controlEnteredPromise = new Promise(resolve => { controlEntered = resolve; });
  const blockerGate = new Promise(resolve => { releaseBlocker = () => { blockerReleased = true; resolve(); }; });
  const receiptGate = new Promise(resolve => { releaseReceipts = () => { receiptsReleased = true; resolve(); }; });

  restoreRuntime = () => {
    server.runtime.maintenance = originalMaintenance;
    server.runtime.publishPending = originalPublish;
    server.runtime.receipt = originalReceiptRead;
    server.runtime.hooks.beforeCommit = originalBeforeCommit;
    server.runtime.locked = originalLocked;
  };
  // 后台脉冲不参与本定向竞争，否则会引入不受控的正常事务。
  server.runtime.maintenance = async () => {};
  server.runtime.publishPending = async () => ({ busy: false, examined: 0, published: 0 });
  // 方法级受控替身：真实 DB 读取完成后才计数，随后暂缓响应，证明控制帧不必等收据批完成。
  server.runtime.receipt = async (...args) => {
    const value = await receiptContext.run({ receipt: true }, () => originalReceiptRead(...args));
    receiptCompletions++;
    await receiptGate;
    return value;
  };
  server.runtime.hooks.beforeCommit = async context => {
    if (context.sessionId === sessionId) commitOrder.push(context.command);
    await originalBeforeCommit?.(context);
  };
  server.runtime.locked = async (id, command, operation) => {
    if (command.kind === 'control.resume') controlEntered();
    return originalLocked(id, command, operation);
  };

  let blockerStarted;
  const blockerStartedPromise = new Promise(resolve => { blockerStarted = resolve; });
  const blocker = server.runtime.locked(sessionId, { kind: 'p05-blocker' }, async () => { blockerStarted(); await blockerGate; });
  await blockerStartedPromise;
  assert.ok(sessionSelects.some(entry => entry.command === 'other' && entry.forUpdate), ' blocker 必须真实持有 sessions 行锁');

  const receiptResponses = Array.from({ length: 6 }, () => server.runtime.receipt(users[0].token, sessionId, actionId));
  const receiptSelects = () => sessionSelects.filter(entry => entry.command === 'receipt');
  await until(() => receiptSelects().length >= 6 && receiptCompletions >= 6, '收据 DB 查询未在行锁持有期间到达并完成', 6000);
  assert.ok(receiptSelects().every(entry => !entry.forUpdate), '收据查询不得对 sessions 取 FOR UPDATE');
  assert.equal(blockerReleased, false, '收据 DB 工作完成时 blocker 行锁仍应持有');

  const resumed = rpc(socket, 'control.resume', JSON.stringify({ schemaVersion: 2, type: 'control.resume', sessionId, viewId: baseline.snapshot.viewId, actorRef: baseline.snapshot.projection.self.entityRef, nonce: 'priority-resume' }));
  await controlEnteredPromise;
  releaseBlocker();
  const response = await resumed;
  validateSpatial('ControlResponseV2', response);
  assert.equal(response.sessionId, sessionId);
  assert.equal(response.nonce, 'priority-resume');
  assert.equal(receiptsReleased, false, '控制 ACK 不得等待收据批响应释放');
  assert.ok(commitOrder.includes('p05-blocker'), '受控阻塞事务仍按真实提交顺序记录');
  assert.ok(!commitOrder.includes('receipt'), '只读收据不得进入写提交顺序');

  releaseReceipts();
  const bodies = await Promise.all(receiptResponses);
  for (const body of bodies) assert.deepEqual(body, originalReceipt);
  await blocker;
  assert.deepEqual(await originalReceiptRead(users[0].token, sessionId, actionId), originalReceipt);
});
