import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { io } from 'socket.io-client';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createAuthorityServer } from '../server.mjs';

const caps = ['spatial-v2', 'spatial-direction-v1', 'spatial-timed-trail-v1'];
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
test('D66-SUP-01：真实Socket显式同步读取在途时，publisher等待并从其真实发送头续读', { timeout: 15000 }, async () => {
  const db = await startTestPostgres('supply-order', { outputSubdirectory: 'direction-server' });
  let server, client, response; const publisher = deferred(), entered = deferred(), read = deferred();
  const calls = [], pushes = [];
  try {
    server = await createAuthorityServer({ pool: db.pool, now: () => Date.parse('2026-11-15T00:00:00Z'), spatialDirection: { checkpointMs: 50 } });
    const runtime = server.runtime, originalPublish = runtime.publishPending.bind(runtime), originalSync = runtime.sync.bind(runtime);
    runtime.publishPending = async (...args) => { await publisher.promise; return originalPublish(...args); };
    let gate = false;
    runtime.sync = async (...args) => {
      const request = JSON.parse(args[1]); calls.push(request);
      const result = await originalSync(...args);
      if (gate) { gate = false; entered.resolve(); await read.promise; }
      return result;
    };
    const user = await runtime.guest({ name: '同步供给回归' });
    const { sessionId } = await runtime.create(user.token, { nonce: crypto.randomUUID(), contentVersion: 'spatial-graybox-v2', capabilities: caps });
    const address = await server.listen(0);
    client = io(`http://127.0.0.1:${address.port}`, { transports: ['websocket'], auth: { token: user.token, capabilities: caps }, reconnection: false });
    client.on('world.batch', batch => pushes.push(batch)); await once(client, 'connect');
    const snapshot = await client.timeout(2000).emitWithAck('session.subscribe', { sessionId });
    await runtime.locked(sessionId, { kind: 'supply-fixture' }, async tx => { tx.emit('spatial.clock', { sceneTimeMs: tx.state.sceneTimeMs, wallAnchorMs: tx.state.wallAnchorMs, paused: tx.state.paused }); });
    gate = true;
    response = client.timeout(3000).emitWithAck('sync.request', JSON.stringify({ schemaVersion: 2, type: 'sync.request', sessionId, viewId: snapshot.viewId, cursor: snapshot.snapshotSeq }));
    response.catch(() => {});
    await entered.promise; publisher.resolve();
    // 真实PG已完成第一读，保留其发送门；给予另一发布入口一次完整调度机会。
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(calls.length, 1, '同绑定RPC未发送前不能再发起publisher锁读');
    read.resolve(); const batch = await response;
    assert.ok(BigInt(batch.throughSeq) > BigInt(snapshot.snapshotSeq));
    const nextPush = once(client, 'world.batch', { signal: AbortSignal.timeout(3000) });
    await runtime.locked(sessionId, { kind: 'supply-fixture-next' }, async tx => { tx.emit('spatial.clock', { sceneTimeMs: tx.state.sceneTimeMs, wallAnchorMs: tx.state.wallAnchorMs, paused: tx.state.paused }); });
    const [pushed] = await nextPush;
    assert.equal(pushed.fromExclusive, batch.throughSeq, '推送起点必须来自已入队ACK的连续发送头');
    assert.ok(pushes.every(value => BigInt(value.fromExclusive) >= BigInt(batch.throughSeq)), '不能再发送40→48型部分重叠');
  } finally {
    read.resolve(); publisher.resolve(); await response?.catch(() => {}); client?.close(); await server?.close(); await db.stop();
  }
});

test('D66-SUP-01/02：真实PG旧cursor截止已发完整事务，原安装下界和空deliver Pending不丢', { timeout: 15000 }, async () => {
  const db = await startTestPostgres('supply-ceiling', { outputSubdirectory: 'direction-server' }), publisher = deferred();
  let server, client;
  try {
    server = await createAuthorityServer({ pool: db.pool, now: () => Date.parse('2026-11-15T00:00:00Z'), spatialDirection: { checkpointMs: 50 } });
    const runtime = server.runtime, originalPublish = runtime.publishPending.bind(runtime), open = runtime.openConnection.bind(runtime);
    runtime.publishPending = async (...args) => { await publisher.promise; return originalPublish(...args); };
    let handle; runtime.openConnection = async (...args) => { handle = await open(...args); return handle; };
    const user = await runtime.guest({ name: '完整事务发送前缀' });
    const { sessionId } = await runtime.create(user.token, { nonce: crypto.randomUUID(), contentVersion: 'spatial-graybox-v2', capabilities: caps });
    const address = await server.listen(0);
    client = io(`http://127.0.0.1:${address.port}`, { transports: ['websocket'], auth: { token: user.token, capabilities: caps }, reconnection: false });
    await once(client, 'connect');
    const snapshot = await client.timeout(2000).emitWithAck('session.subscribe', { sessionId }), view = runtime.connectionView(handle);
    assert.equal(runtime.spatialSupply.cursor(view), snapshot.snapshotSeq, '真实snapshot ACK已建立本binding发送基线');
    for (let group = 0; group < 3; group++) await runtime.locked(sessionId, { kind: 'supply-pages' }, async tx => {
      for (let at = 0; at < 128; at++) tx.emit('spatial.clock', { sceneTimeMs: tx.state.sceneTimeMs, wallAnchorMs: tx.state.wallAnchorMs, paused: tx.state.paused });
    });
    const query = cursor => client.timeout(2000).emitWithAck('sync.request', JSON.stringify({ schemaVersion: 2, type: 'sync.request', sessionId, viewId: snapshot.viewId, cursor }));
    const persisted = async () => (await db.pool.query('SELECT session_seq,state FROM sessions WHERE session_id=$1', [sessionId])).rows[0];
    const before = await persisted(), first = await query(snapshot.snapshotSeq);
    assert.equal(first.throughSeq, String(BigInt(snapshot.snapshotSeq) + 256n)); assert.equal(first.syncFrontierSeq, before.session_seq);
    const old = await query(String(BigInt(snapshot.snapshotSeq) + 128n));
    assert.equal(old.throughSeq, first.throughSeq, '旧cursor不得越过进入本项时可信sentThrough');
    assert.equal(old.syncFrontierSeq, before.session_seq, '内部读取截止不能伪造当前事务frontier');
    assert.equal(runtime.spatialSupply.cursor(view), first.throughSeq); assert.equal(view.cursor, snapshot.snapshotSeq);
    assert.deepEqual(await persisted(), before, '读取发送不追加权威事件');
    assert.equal(runtime.canInstallConnectionView(handle, { ...view, cursor: snapshot.snapshotSeq }, view.scope), false, '原较旧snapshot守卫须覆盖真实已发头');
    assert.equal(runtime.canInstallConnectionView(handle, { ...view, cursor: first.throughSeq }, view.scope), true);
    await assert.rejects(originalPublish(() => true), error => error.code === 'RESYNC_REQUIRED' && error.keepSpatialPending === true);
    assert.equal(view.cursor, snapshot.snapshotSeq); assert.equal(view.active, false);
    assert.ok((await db.pool.query("SELECT 1 FROM outbox WHERE session_id=$1 AND status='Pending'", [sessionId])).rowCount > 0, '失败当前轮不能提交Published');
  } finally { publisher.resolve(); client?.close(); await server?.close(); await db.stop(); }
});
