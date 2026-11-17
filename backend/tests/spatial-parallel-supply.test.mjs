import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Server } from 'socket.io';
import { io } from 'socket.io-client';
import { AuthorityRuntime, createRuntime } from '../runtime.mjs';
import { createAuthorityServer } from '../server.mjs';
import { errorResponse } from '../errors.mjs';
import { enqueueSocketPacket } from '../socket-enqueue.mjs';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { validateSpatial } from '../../protocol/spatial.mjs';

const capabilities = ['spatial-v2', 'spatial-direction-v1', 'spatial-timed-trail-v1'];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message, timeout = 1000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (check()) return; await pause(5); }
  assert.fail(message);
}

function holdNextInstallation(runtime) {
  const entered = Promise.withResolvers(), release = Promise.withResolvers(), original = runtime.stageSpatialView;
  let claimed = false, candidate;
  runtime.stageSpatialView = function (tx, handle, view, scope, ...rest) {
    original.call(this, tx, handle, view, scope, ...rest);
    if (claimed) return;
    claimed = true; candidate = { handle, view, scope };
    const index = tx.afterCommit.length - 1, install = tx.afterCommit[index];
    tx.afterCommit[index] = async () => { entered.resolve(); await release.promise; return install(); };
  };
  return { entered: entered.promise, release: release.resolve, candidate: () => candidate,
    restore() { release.resolve(); runtime.stageSpatialView = original; } };
}

/** 真实PG与Socket.IO；只隔离后台定时器，授权、共享lane、完整DTO入队仍调用生产实现。 */
async function room(t, { count = 2, mixed = false } = {}) {
  const database = await startTestPostgres('parallel-supply', { outputSubdirectory: 'supply-implement' });
  const runtime = await createRuntime({ pool: database.pool, now: () => Date.parse('2026-11-17T09:00:00Z'), spatialDirection: { checkpointMs: 50 } });
  const http = createServer(), server = new Server(http, { serveClient: false }), sockets = new Map(), peers = [], tasks = new Set();
  const track = promise => { tasks.add(promise); promise.finally(() => tasks.delete(promise)).catch(() => {}); return promise; };
  server.use((socket, next) => { track(runtime.openConnection(socket.handshake.auth.token, socket.handshake.auth.capabilities)
    .then(handle => { socket.data.handle = handle; next(); }, next)); });
  const enqueue = (handle, binding, value, kind, send) => enqueueSocketPacket({ sockets, handle, binding, value, kind, send,
    current: () => runtime.spatialSupply.current(handle, binding) });
  server.on('connection', socket => {
    const handle = socket.data.handle; sockets.set(handle.connectionId, socket);
    for (const event of ['session.subscribe', 'control.resume', 'control.take', 'sync.request']) socket.on(event, (value, ack) => {
      track((async () => {
        const send = (result, binding) => enqueue(handle, binding, result, 'ack', () => ack(result));
        try {
          if (event === 'sync.request' && runtime.spatialSupply.enabled(handle)) return await runtime.spatialSupply.sync(handle, value, send);
          const result = event === 'session.subscribe' ? await runtime.subscribe(handle, value.sessionId)
            : event === 'sync.request' ? await runtime.sync(handle, value) : await runtime.control(handle, value);
          if (runtime.spatialSupply.enabled(handle)) runtime.spatialSupply.snapshot(handle, result, send); else ack(result);
        } catch (error) { ack(errorResponse(error)); }
      })());
    });
    socket.on('disconnect', () => { sockets.delete(handle.connectionId); track(runtime.disconnect(handle)); });
  });
  runtime.on('view-revoked', ({ connectionId }) => sockets.get(connectionId)?.disconnect(true));
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const peer of peers) peer.client.close();
    await new Promise(resolve => server.close(resolve));
    while (tasks.size) await Promise.allSettled([...tasks]);
    await runtime.close(); await database.stop();
  });
  const users = await Promise.all(['甲', '乙'].map(name => runtime.guest({ name })));
  const { sessionId } = await runtime.create(users[0].token, { nonce: crypto.randomUUID(), contentVersion: 'spatial-graybox-v2', capabilities });
  for (const user of users) await runtime.join(user.token, sessionId, { nonce: crypto.randomUUID(), capabilities });
  await runtime.start(users[0].token, sessionId, { nonce: crypto.randomUUID() });
  const rpc = (peer, event, value) => peer.client.timeout(5000).emitWithAck(event, value);
  for (let index = 0; index < count; index++) {
    const connected = once(server, 'connection'), caps = mixed && index === count - 1 ? ['spatial-v2'] : capabilities;
    const client = io(`http://127.0.0.1:${http.address().port}`, { transports: ['websocket'], reconnection: false,
      auth: { token: users[index === 1 ? 1 : 0].token, capabilities: caps } });
    await once(client, 'connect'); const [socket] = await connected;
    const peer = { client, handle: socket.data.handle, socket, batches: [] }; peers.push(peer);
    client.on('world.batch', batch => peer.batches.push(batch));
    peer.snapshot = await rpc(peer, 'session.subscribe', { sessionId }); validateSpatial('SnapshotV2', peer.snapshot);
    if (index < 2) {
      const controlled = await rpc(peer, 'control.resume', JSON.stringify({ schemaVersion: 2, type: 'control.resume', sessionId,
        viewId: peer.snapshot.viewId, actorRef: peer.snapshot.projection.self.entityRef, nonce: crypto.randomUUID() }));
      validateSpatial('ControlResponseV2', controlled); peer.snapshot = controlled.snapshot;
    }
  }
  const deliver = (connectionId, batch, binding) => binding
    ? enqueue(binding.handle, binding, batch, 'push', () => sockets.get(connectionId)?.emit('world.batch', batch))
    : sockets.get(connectionId)?.emit('world.batch', batch);
  const flush = options => runtime.publishPending(deliver, options);
  await flush();
  const append = () => runtime.locked(sessionId, { kind: 'parallel-supply-fixture' }, tx => {
    tx.emit('spatial.clock', { sceneTimeMs: tx.state.sceneTimeMs, wallAnchorMs: tx.state.wallAnchorMs, paused: tx.state.paused });
    return tx.state.sessionSeq;
  });
  const query = peer => rpc(peer, 'sync.request', JSON.stringify({ schemaVersion: 2, type: 'sync.request', sessionId,
    viewId: runtime.connectionView(peer.handle).viewId, cursor: runtime.spatialSupply.cursor(runtime.connectionView(peer.handle)) }));
  const control = peer => rpc(peer, 'control.take', JSON.stringify({ schemaVersion: 2, type: 'control.take', sessionId,
    viewId: runtime.connectionView(peer.handle).viewId, actorRef: peer.snapshot.projection.self.entityRef, nonce: crypto.randomUUID() }));
  const pending = () => database.pool.query("SELECT through_seq,status,attempts FROM outbox WHERE session_id=$1 AND status='Pending' ORDER BY through_seq", [sessionId]).then(result => result.rows);
  return { database, runtime, users, peers, sessionId, rpc, append, query, control, flush, pending, deliver };
}

test('真实PG：不同handle共享授权读可重叠，控制写在两读COMMIT前不能穿越', { timeout: 12000 }, async t => {
  const r = await room(t), gate = Promise.withResolvers(); let readers = 0, writerEntered = false;
  const head = await r.append(), queries = [];
  r.runtime.hooks.beforeCommit = async ({ command }) => {
    if (command === 'spatial-sync') { readers++; await gate.promise; }
    if (command === 'control.take') writerEntered = true;
  };
  let writing;
  try {
    queries.push(r.query(r.peers[0]), r.query(r.peers[1]));
    await until(() => readers === 2, '第一共享读未释放时，另一真实handle必须也进入原授权事务');
    writing = r.control(r.peers[0]); await pause(40);
    assert.equal(writerEntered, false, '排他控制写不能穿过仍持有的共享读');
    gate.resolve();
    for (const batch of await Promise.all(queries)) { validateSpatial('BatchV2', batch); assert.equal(batch.throughSeq, head); }
    validateSpatial('ControlResponseV2', await writing); assert.equal(writerEntered, true);
  } finally { gate.resolve(); await Promise.allSettled([...queries, ...(writing ? [writing] : [])]); delete r.runtime.hooks.beforeCommit; }
});

test('真实PG与六条Socket：同record最多五个不同handle并行，第六个等待整组收束', { timeout: 12000 }, async t => {
  const r = await room(t, { count: 6 }), gates = Array.from({ length: 5 }, () => Promise.withResolvers());
  const original = r.runtime.sync.bind(r.runtime), starts = []; let active = 0, peak = 0;
  r.runtime.sync = async (...args) => {
    const index = starts.length; starts.push(args[0]); active++; peak = Math.max(peak, active);
    try { if (index < 5) await gates[index].promise; return await original(...args); }
    finally { active--; }
  };
  const head = await r.append(); let publishing;
  try {
    publishing = r.flush();
    await until(() => starts.length === 5, '真实不同handle必须按五个工作启动，不能仍逐读者串行');
    assert.equal(new Set(starts).size, 5); assert.equal(peak, 5);
    gates.slice(0, 4).forEach(gate => gate.resolve()); await until(() => active === 1, '已释放的四个真实读者应完成');
    assert.equal(starts.length, 5, '第六条handle不能越过尚未结束的第一组');
    gates[4].resolve(); await publishing;
    assert.equal(starts.length, 6); assert.equal(peak, 5); assert.deepEqual(await r.pending(), []);
    for (const peer of r.peers) assert.equal(r.runtime.spatialSupply.cursor(r.runtime.connectionView(peer.handle)), head);
  } finally { gates.forEach(gate => gate.resolve()); await publishing?.catch(() => {}); r.runtime.sync = original; }
});

test('真实PG：普通写先持锁时后读不能穿越，读到提交后的头且旧控制binding仍拒绝', { timeout: 12000 }, async t => {
  const r = await room(t), entered = Promise.withResolvers(), release = Promise.withResolvers();
  r.runtime.hooks.beforeCommit = async ({ command }) => { if (command === 'parallel-supply-fixture') { entered.resolve(); await release.promise; } };
  const writing = r.append(); let reading, readDone = false;
  try {
    await entered.promise; reading = r.query(r.peers[0]).then(value => { readDone = true; return value; });
    await pause(40); assert.equal(readDone, false);
    release.resolve(); const head = await writing, batch = await reading;
    validateSpatial('BatchV2', batch); assert.equal(batch.throughSeq, head);
    const old = r.runtime.connectionView(r.peers[0].handle);
    validateSpatial('ControlResponseV2', await r.control(r.peers[0]));
    const stale = await r.rpc(r.peers[0], 'sync.request', JSON.stringify({ schemaVersion: 2, type: 'sync.request',
      sessionId: r.sessionId, viewId: old.viewId, cursor: head }));
    assert.equal(stale.code, 'RESYNC_REQUIRED');
  } finally { release.resolve(); await Promise.allSettled([writing, ...(reading ? [reading] : [])]); delete r.runtime.hooks.beforeCommit; }
});

test('真实PG与Socket：一个peer失败时等待其他在途peer，成功者水位保留且重试只补失败者', { timeout: 12000 }, async t => {
  const r = await room(t, { count: 3 }), release = Promise.withResolvers(), original = r.runtime.sync.bind(r.runtime);
  const counts = new Map(); let thirdEntered = false, failedOnce = false, settled = false;
  r.runtime.sync = async (handle, ...args) => {
    counts.set(handle, (counts.get(handle) ?? 0) + 1);
    if (handle === r.peers[1].handle && !failedOnce) { failedOnce = true; throw new Error('受控读取失败'); }
    if (handle === r.peers[2].handle) { thirdEntered = true; await release.promise; }
    return original(handle, ...args);
  };
  const head = await r.append(), publishing = r.flush();
  publishing.then(() => { settled = true; }, () => { settled = true; });
  try {
    await until(() => thirdEntered && r.runtime.spatialSupply.cursor(r.runtime.connectionView(r.peers[0].handle)) === head,
      '成功peer须真正入队，另一个peer须已开始并保持在途');
    assert.equal(settled, false, '单个失败不能提前释放publisher');
    assert.deepEqual(await r.flush(), { busy: true, examined: 0, published: 0 });
    assert.deepEqual((await r.pending()).map(row => row.through_seq), [head]);
    release.resolve(); await assert.rejects(publishing, /受控读取失败/);
    assert.equal(r.runtime.spatialSupply.cursor(r.runtime.connectionView(r.peers[0].handle)), head);
    await r.flush();
    assert.deepEqual(r.peers.map(peer => counts.get(peer.handle)), [1, 2, 1]);
    assert.deepEqual(await r.pending(), []);
  } finally { release.resolve(); await publishing.catch(() => {}); r.runtime.sync = original; }
});

test('真实PG：duringPublish期间新安装pending必须在进度排他锁内重核', { timeout: 12000 }, async t => {
  const r = await room(t), head = await r.append(), hold = holdNextInstallation(r.runtime); let subscribing, hooked = false;
  r.runtime.hooks.duringPublish = async () => {
    if (hooked) return; hooked = true;
    subscribing = r.rpc(r.peers[0], 'session.subscribe', { sessionId: r.sessionId });
    await hold.entered;
  };
  try {
    await r.flush();
    assert.equal(r.runtime.pendingViewInstallation(r.peers[0].handle), true);
    assert((await r.pending()).some(row => row.through_seq === head), '旧枚举覆盖不能抹掉锁内发现的真实新安装pending');
    hold.release(); validateSpatial('SnapshotV2', await subscribing);
    delete r.runtime.hooks.duringPublish; await r.flush(); assert.deepEqual(await r.pending(), []);
  } finally { hold.restore(); delete r.runtime.hooks.duringPublish; await subscribing?.catch(() => {}); }
});

test('真实PG：逐record进度独立提交，第二行回滚不撤销第一行且重试不重记第一行', { timeout: 12000 }, async t => {
  const r = await room(t), first = await r.append(), second = await r.append(); let commits = 0;
  r.runtime.hooks.beforeCommit = ({ command }) => { if (command === 'outbox-progress' && commits === 1) throw new Error('第二行进度提交前故障'); };
  r.runtime.hooks.afterCommit = ({ command }) => { if (command === 'outbox-progress') commits++; };
  const rows = () => r.database.pool.query('SELECT through_seq,status,attempts FROM outbox WHERE session_id=$1 AND through_seq IN ($2,$3) ORDER BY through_seq', [r.sessionId, first, second]).then(result => result.rows);
  try {
    await assert.rejects(r.flush(), /第二行进度提交前故障/);
    assert.deepEqual(await rows(), [{ through_seq: first, status: 'Published', attempts: 1 }, { through_seq: second, status: 'Pending', attempts: 0 }]);
    delete r.runtime.hooks.beforeCommit; await r.flush();
    assert.deepEqual(await rows(), [{ through_seq: first, status: 'Published', attempts: 1 }, { through_seq: second, status: 'Published', attempts: 1 }]);
  } finally { delete r.runtime.hooks.beforeCommit; delete r.runtime.hooks.afterCommit; }
});

test('真实PG：进度COMMIT回应丢失报告未知，重查持久结果且连接正常释放', { timeout: 12000 }, async t => {
  const r = await room(t), head = await r.append(), originalConnect = r.database.pool.connect;
  let loseCommit = false, lost = false;
  r.runtime.hooks.beforeCommit = ({ command }) => { if (command === 'outbox-progress') loseCommit = true; };
  r.database.pool.connect = function (...args) {
    const connecting = originalConnect.apply(this, args);
    if (!connecting?.then) return connecting;
    return connecting.then(client => {
      const query = client.query, release = client.release;
      client.query = async function (sql, ...values) {
        const result = await query.call(this, sql, ...values);
        if (sql === 'COMMIT' && loseCommit) { loseCommit = false; lost = true; throw new Error('受控提交回应丢失'); }
        return result;
      };
      client.release = function (...values) { client.query = query; client.release = release; return release.apply(this, values); };
      return client;
    });
  };
  try {
    await assert.rejects(r.flush(), { code: 'OUTCOME_UNKNOWN' }); assert.equal(lost, true);
  } finally { r.database.pool.connect = originalConnect; delete r.runtime.hooks.beforeCommit; }
  const result = await r.database.pool.query('SELECT status,attempts FROM outbox WHERE session_id=$1 AND through_seq=$2', [r.sessionId, head]);
  assert.deepEqual(result.rows, [{ status: 'Published', attempts: 1 }]);
  assert.equal((await r.flush()).published, 0); assert.equal(r.database.pool.waitingCount, 0);
});

test('真实PG：进度持锁前会话被合法删除，沿SESSION_GONE收束并释放连接', { timeout: 12000 }, async t => {
  const r = await room(t); await r.runtime.abortSession(r.sessionId, '供给删除交错');
  const records = await r.pending(); assert(records.length > 0); let deleted = false;
  r.runtime.hooks.duringPublish = async () => { if (!deleted) { deleted = true; await r.runtime.deleteSession(r.sessionId); } };
  try {
    const result = await r.flush(); assert.equal(deleted, true); assert.equal(result.published, records.length);
    assert.equal((await r.database.pool.query('SELECT 1 FROM sessions WHERE session_id=$1', [r.sessionId])).rowCount, 0);
    assert.deepEqual(await r.pending(), []); assert.equal(r.database.pool.waitingCount, 0);
  } finally { delete r.runtime.hooks.duringPublish; }
});

test('真实PG：共享sync冷暖缓存投影与轨迹相同，命中后仍重核撤权且不写世界', { timeout: 12000 }, async t => {
  const r = await room(t, { count: 3 }), view = r.runtime.connectionView(r.peers[2].handle);
  const raw = JSON.stringify({ schemaVersion: 2, type: 'sync.request', sessionId: r.sessionId, viewId: view.viewId, cursor: view.cursor });
  await r.append();
  // 同一真实数据库的新runtime命名空间，不继承旧PrefixStateCache；只读handle沿持久控制者的同一view订阅。
  const cold = new AuthorityRuntime({ pool: r.database.pool, now: r.runtime.now, spatialDirection: { checkpointMs: 50 } });
  const handle = await cold.openConnection(r.users[0].token, capabilities); t.after(() => cold.close());
  const snapshot = await cold.subscribe(handle, r.sessionId); assert.equal(snapshot.viewId, view.viewId);
  const persisted = () => r.database.pool.query('SELECT state,session_seq,logical_time FROM sessions WHERE session_id=$1', [r.sessionId]).then(result => result.rows);
  const before = await persisted(), reads = [];
  const countReplay = (runtime, label) => {
    const stateAt = runtime.stateAt.bind(runtime);
    runtime.stateAt = async (tx, seq) => {
      const query = tx.client.query;
      tx.client.query = async function (...args) {
        const result = await query.apply(this, args);
        const events = result.rows.filter(row => Object.hasOwn(row, 'event'));
        if (events.length) reads.push({ label, count: events.length });
        return result;
      };
      try { return await stateAt(tx, seq); } finally { tx.client.query = query; }
    };
  };
  countReplay(r.runtime, 'warm'); countReplay(cold, 'cold');
  const warmBatch = await r.runtime.sync(r.peers[2].handle, raw), coldBatch = await cold.sync(handle, raw);
  validateSpatial('BatchV2', coldBatch); assert.deepEqual(coldBatch, warmBatch);
  assert(reads.some(read => read.label === 'cold'), '冷命名空间确实缺少旧游标缓存并走真实历史回退');
  assert.equal(reads.filter(read => read.label === 'warm').length, 0);
  reads.length = 0; assert.deepEqual(await cold.sync(handle, raw), coldBatch);
  assert.deepEqual(reads, [], '相同输入再读命中，不能因FOR SHARE丢掉capture资格');
  assert.deepEqual(await persisted(), before, '共享同步不推进时间、世界事实或状态');
  await r.runtime.revokeAccess(r.sessionId, r.users[0].userId);
  await assert.rejects(cold.sync(handle, raw), { code: 'FORBIDDEN' });
});

test('真实PG与六handle：关闭只停止启动新工作，已开始组必须settle且本行保持Pending', { timeout: 12000 }, async t => {
  const r = await room(t, { count: 6 }), release = Promise.withResolvers(), original = r.runtime.sync.bind(r.runtime);
  let started = 0, stopped = false, settled = false;
  r.runtime.sync = async (...args) => { started++; await release.promise; return original(...args); };
  const head = await r.append(), publishing = r.flush({ isStopped: () => stopped }); publishing.then(() => { settled = true; });
  try {
    await until(() => started === 5, '第一组须已开始'); stopped = true; await pause(20);
    assert.equal(settled, false); assert.equal((await r.flush()).busy, true);
    release.resolve(); await publishing; assert.equal(started, 5, '关闭后不启动第六个工作');
    assert((await r.pending()).some(row => row.through_seq === head));
    r.runtime.sync = original; await r.flush(); assert.deepEqual(await r.pending(), []);
  } finally { release.resolve(); await publishing.catch(() => {}); r.runtime.sync = original; }
});

test('真实PG混合能力：发布仍逐读者串行，不误用新并发分支', { timeout: 12000 }, async t => {
  const r = await room(t, { count: 3, mixed: true }), release = Promise.withResolvers(), original = r.runtime.sync.bind(r.runtime);
  let started = 0, active = 0, peak = 0;
  r.runtime.sync = async (...args) => { started++; active++; peak = Math.max(peak, active);
    try { await release.promise; return await original(...args); } finally { active--; } };
  await r.append(); const publishing = r.flush();
  try { await until(() => started === 1, '首读须开始'); await pause(40); assert.equal(started, 1); release.resolve(); await publishing; assert.equal(peak, 1); }
  finally { release.resolve(); await publishing.catch(() => {}); r.runtime.sync = original; }
});

test('真实生产adapter与PG：进度check后无ACK撤销立即closing，旧pending不因current退休重新可安装', { timeout: 15000 }, async t => {
  const database = await startTestPostgres('parallel-adapter', { outputSubdirectory: 'supply-implement' });
  let server, hold, subscribing; const peers = [], handles = [], release = Promise.withResolvers();
  t.signal.addEventListener('abort', () => { release.resolve(); hold?.restore(); }, { once: true });
  try {
    server = await createAuthorityServer({ pool: database.pool, now: () => Date.parse('2026-11-17T09:00:00Z'), spatialDirection: { checkpointMs: 50 } });
    const runtime = server.runtime, publish = runtime.publishPending.bind(runtime), open = runtime.openConnection.bind(runtime), sync = runtime.sync.bind(runtime);
    // 只冻结后台调度；下方显式调用原publisher，Socket认证、发送证明和disconnect均为实际生产适配器。
    runtime.publishPending = async () => ({ busy: false, examined: 0, published: 0 });
    runtime.openConnection = async (...args) => { const handle = await open(...args); handles.push(handle); return handle; };
    const users = await Promise.all(['甲', '乙'].map(name => runtime.guest({ name })));
    const { sessionId } = await runtime.create(users[0].token, { nonce: crypto.randomUUID(), contentVersion: 'spatial-graybox-v2', capabilities });
    for (const user of users) await runtime.join(user.token, sessionId, { nonce: crypto.randomUUID(), capabilities });
    await runtime.start(users[0].token, sessionId, { nonce: crypto.randomUUID() });
    const { port } = await server.listen(0), rpc = (peer, event, value) => peer.timeout(3000).emitWithAck(event, value);
    for (const user of users) {
      const client = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], reconnection: false, auth: { token: user.token, capabilities } });
      peers.push(client); await once(client, 'connect');
      const snapshot = await rpc(client, 'session.subscribe', { sessionId }); validateSpatial('SnapshotV2', snapshot);
      validateSpatial('ControlResponseV2', await rpc(client, 'control.resume', JSON.stringify({ schemaVersion: 2, type: 'control.resume', sessionId,
        viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, nonce: crypto.randomUUID() })));
    }
    hold = holdNextInstallation(runtime);
    subscribing = rpc(peers[0], 'session.subscribe', { sessionId }); subscribing.catch(() => {});
    await hold.entered;
    validateSpatial('SnapshotV2', await rpc(peers[0], 'session.subscribe', { sessionId }));
    const candidate = hold.candidate(), current = runtime.connectionView(handles[0]);
    assert(BigInt(current.cursor) > BigInt(candidate.view.cursor));
    assert.equal(runtime.connection(handles[0]).pendingViews.size, 1);
    assert.equal(runtime.pendingViewInstallation(handles[0]), false);
    assert.equal(runtime.canInstallConnectionView(handles[0], candidate.view, candidate.scope), false);
    const query = handle => {
      const view = runtime.connectionView(handle);
      return JSON.stringify({ schemaVersion: 2, type: 'sync.request', sessionId, viewId: view.viewId, cursor: runtime.spatialSupply.cursor(view) });
    };
    for (let index = 0; index < peers.length; index++) validateSpatial('BatchV2', await rpc(peers[index], 'sync.request', query(handles[index])));
    const records = (await database.pool.query("SELECT through_seq FROM outbox WHERE session_id=$1 AND status='Pending' ORDER BY through_seq", [sessionId])).rows;
    assert(records.length > 0);
    const read = Promise.withResolvers(), retired = once(runtime, 'view-revoked', { signal: AbortSignal.timeout(5000) });
    retired.catch(() => {}); let intercept = true, checked = false, requestStarted = false;
    runtime.sync = async (...args) => {
      const result = await sync(...args);
      if (args[0] === handles[0] && intercept) { intercept = false; read.resolve(); await release.promise; }
      return result;
    };
    runtime.hooks.duringPublish = async () => {
      if (requestStarted) return; requestStarted = true;
      // peer工作已自然settle，再安排下一次真实RPC，避免同handle lane本身挡在进度之前。
      // 客户端实际不提供ACK；真实PG读完成后停在发送前，不伪造proof或直接调用retire。
      peers[0].emit('sync.request', query(handles[0])); await read.promise;
    };
    runtime.hooks.beforeCommit = async ({ command }) => {
      if (command !== 'outbox-progress' || checked) return;
      checked = true; release.resolve(); await retired;
      assert.equal(runtime.connection(handles[0]).closing, true, '生产断连listener在首个await前封闭连接');
      assert.equal(runtime.pendingViewInstallation(handles[0]), false, 'current退休后旧pending仍不可重新eligible');
      assert.equal(runtime.canInstallConnectionView(handles[0], candidate.view, candidate.scope), false);
    };
    await publish(() => assert.fail('所有当前读者已有真实ACK覆盖，不应新增推送'));
    assert.equal(checked, true);
    for (const { through_seq } of records) {
      const result = await database.pool.query('SELECT status FROM outbox WHERE session_id=$1 AND through_seq=$2', [sessionId, through_seq]);
      assert.deepEqual(result.rows, [{ status: 'Published' }]);
    }
    hold.release(); await subscribing.catch(() => {});
    assert.equal(runtime.connectionView(handles[0]), undefined);
    await until(() => !peers[0].connected, '实际客户端必须收到断连');
    delete runtime.hooks.beforeCommit; delete runtime.hooks.duringPublish; runtime.sync = sync;
  } finally {
    release.resolve(); hold?.restore(); await subscribing?.catch(() => {});
    for (const peer of peers) peer.close(); await server?.close(); await database.stop();
  }
});
