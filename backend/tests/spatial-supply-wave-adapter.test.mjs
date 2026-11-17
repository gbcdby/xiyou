import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { io } from 'socket.io-client';
import { createAuthorityServer } from '../server.mjs';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { capabilities, holdNextInstallation, until } from '../test-support/spatial-supply-room.mjs';
import { validateSpatial } from '../../protocol/spatial.mjs';

test('RG02/RG07/RG08：真实adapter无ACK撤销发生于新W排队和旧G最终check之后，旧pending不能复活', { timeout: 20000 }, async t => {
  const database = await startTestPostgres('supply-wave-adapter', { outputSubdirectory: 'supply-wave-implement' });
  const releaseRead = Promise.withResolvers(), releaseG = Promise.withResolvers(), peers = [], handles = [];
  let server, hold, subscribing, publishing, runtime, originalSync, originalSupply, deliver;
  t.signal.addEventListener('abort', () => { releaseRead.resolve(); releaseG.resolve(); hold?.restore(); }, { once: true });
  try {
    server = await createAuthorityServer({ pool: database.pool, now: () => Date.parse('2026-11-17T09:00:00Z'), spatialDirection: { checkpointMs: 50 } });
    runtime = server.runtime;
    const publish = runtime.publishPending.bind(runtime), open = runtime.openConnection.bind(runtime);
    originalSync = runtime.sync.bind(runtime); originalSupply = runtime.spatialSupply.publish;
    // 只冻结后台publisher入口；保留其实际deliver以及生产Socket/认证/ACK/断连接线。
    runtime.publishPending = async callback => { deliver ??= callback; return { busy: false, examined: 0, published: 0 }; };
    runtime.openConnection = async (...args) => { const handle = await open(...args); handles.push(handle); return handle; };
    const users = await Promise.all(['甲', '乙'].map(name => runtime.guest({ name })));
    const { sessionId } = await runtime.create(users[0].token, { nonce: crypto.randomUUID(), contentVersion: 'spatial-graybox-v2', capabilities });
    for (const user of users) await runtime.join(user.token, sessionId, { nonce: crypto.randomUUID(), capabilities });
    await runtime.start(users[0].token, sessionId, { nonce: crypto.randomUUID() });
    const { port } = await server.listen(0), rpc = (peer, event, value) => peer.timeout(5000).emitWithAck(event, value);
    for (const user of users) {
      const client = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], reconnection: false, auth: { token: user.token, capabilities } });
      peers.push(client); await once(client, 'connect');
      const snapshot = await rpc(client, 'session.subscribe', { sessionId }); validateSpatial('SnapshotV2', snapshot);
      validateSpatial('ControlResponseV2', await rpc(client, 'control.resume', JSON.stringify({ schemaVersion: 2, type: 'control.resume', sessionId,
        viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, nonce: crypto.randomUUID() })));
    }
    await until(() => typeof deliver === 'function', '须取得原后台入口使用的实际Socket deliver');
    hold = holdNextInstallation(runtime);
    subscribing = rpc(peers[0], 'session.subscribe', { sessionId }); subscribing.catch(() => {}); await hold.entered;
    validateSpatial('SnapshotV2', await rpc(peers[0], 'session.subscribe', { sessionId }));
    const candidate = hold.candidate(), current = runtime.connectionView(handles[0]);
    assert(BigInt(current.cursor) > BigInt(candidate.view.cursor));
    assert.equal(runtime.connection(handles[0]).pendingViews.size, 1);
    assert.equal(runtime.pendingViewInstallation(handles[0]), false);
    const query = handle => {
      const view = runtime.connectionView(handle);
      return JSON.stringify({ schemaVersion: 2, type: 'sync.request', sessionId, viewId: view.viewId, cursor: runtime.spatialSupply.cursor(view) });
    };
    const syncAll = async () => { for (let index = 0; index < peers.length; index++) validateSpatial('BatchV2', await rpc(peers[index], 'sync.request', query(handles[index]))); };
    const append = () => runtime.locked(sessionId, { kind: 'supply-wave-adapter-fixture' }, tx => {
      tx.emit('spatial.clock', { sceneTimeMs: tx.state.sceneTimeMs, wallAnchorMs: tx.state.wallAnchorMs, paused: tx.state.paused }); return tx.state.sessionSeq;
    });
    await syncAll(); await publish(deliver);
    const old = await append(); await syncAll();
    const gEntered = Promise.withResolvers(), read = Promise.withResolvers(), starts = [], reads = [];
    const retired = once(runtime, 'view-revoked', { signal: AbortSignal.timeout(5000) }); retired.catch(() => {});
    let intercept = true, checked = false, admitted = false;
    runtime.sync = async (handle, ...args) => {
      reads.push(handle); const result = await originalSync(handle, ...args);
      if (handle === handles[0] && intercept) { intercept = false; read.resolve(); await releaseRead.promise; }
      return result;
    };
    runtime.spatialSupply.publish = function (view, target, ...args) { starts.push({ handle: view.handle, target }); return originalSupply.call(this, view, target, ...args); };
    runtime.hooks.duringPublish = async () => { if (!admitted) { admitted = true; gEntered.resolve(); await releaseG.promise; } };
    runtime.hooks.beforeCommit = async ({ command }) => {
      if (command !== 'outbox-progress' || checked) return;
      checked = true;
      assert.equal(runtime.pendingViewInstallation(handles[0]), false, '旧pending在G最终检查时不具安装资格');
      releaseRead.resolve(); await retired;
      assert.equal(runtime.connection(handles[0]).closing, true, '实际adapter同步disconnect在首个await前置closing');
      assert.equal(runtime.pendingViewInstallation(handles[0]), false, 'current退休后旧pending仍不能重新eligible');
      assert.equal(runtime.canInstallConnectionView(handles[0], candidate.view, candidate.scope), false);
      assert.equal((await publish(deliver)).busy, true, '旧G的真实SQL尚未返回，不能提前释放owner');
    };
    publishing = publish(deliver); await gEntered.promise;
    // 真RPC占据同handle lane；客户端不提供ACK，不调用内部retire或伪造发送证明。
    peers[0].emit('sync.request', query(handles[0])); await read.promise;
    const head = await append();
    await until(() => starts.filter(row => row.target === head).length === 2, '新W须在旧G在途时进入两条原lane');
    await until(() => runtime.spatialSupply.cursor(runtime.connectionView(handles[1])) === head, '空闲peer须真实推送新头');
    assert.equal(reads.filter(handle => handle === handles[0]).length, 1, '已有RPC未结束前publisher不得越过其lane');
    releaseG.resolve(); const result = await publishing; assert.equal(result.examined, 1); assert.equal(result.published, 1); assert.equal(checked, true);
    assert.deepEqual((await database.pool.query('SELECT status,attempts FROM outbox WHERE session_id=$1 AND through_seq=$2', [sessionId, old])).rows, [{ status: 'Published', attempts: 1 }]);
    assert.deepEqual((await database.pool.query('SELECT status,attempts FROM outbox WHERE session_id=$1 AND through_seq=$2', [sessionId, head])).rows, [{ status: 'Pending', attempts: 0 }]);
    assert.equal(runtime.connectionView(handles[0]), undefined); await until(() => !peers[0].connected, '真实客户端须收到disconnect');
    hold.release(); await subscribing.catch(() => {});
  } finally {
    releaseRead.resolve(); releaseG.resolve(); hold?.restore(); await publishing?.catch(() => {}); await subscribing?.catch(() => {});
    if (runtime) { delete runtime.hooks.beforeCommit; delete runtime.hooks.duringPublish; runtime.sync = originalSync; runtime.spatialSupply.publish = originalSupply; }
    for (const peer of peers) peer.close(); await server?.close(); await database.stop();
  }
});
