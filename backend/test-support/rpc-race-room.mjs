import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createAuthorityServer } from '../server.mjs';
import { SpatialSessionClient } from '../../frontend/src/network/spatial-session.ts';
import { connectSpatialSocket } from '../../frontend/src/network/socket-link.ts';
import { until } from './spatial-supply-room.mjs';

/** 原服务、真实Socket与原会话消费者；仅用原afterCommit hook控制授权读返回。 */
export async function rpcRaceRoom(t, pool) {
  let clock = Date.parse('2026-11-17T14:00:00Z'), origin;
  const reads = [], rpc = [], publications = [], clients = [], handles = new Map(), gates = new Set();
  const readContext = new AsyncLocalStorage();
  const server = await createAuthorityServer({ pool, now: () => clock, spatialDirection: { checkpointMs: 50 } });
  const runtime = server.runtime;
  t.after(async () => {
    for (const gate of gates) gate.release();
    for (const peer of clients) peer.client.close();
    await server.close();
  });
  t.signal.addEventListener('abort', () => { for (const gate of gates) gate.release(); }, { once: true });
  const open = runtime.openConnection.bind(runtime);
  runtime.openConnection = function (token, ...args) {
    const promise = open(token, ...args);
    promise.then(handle => handles.set(token, handle), () => {});
    return promise;
  };
  const sync = runtime.sync.bind(runtime);
  runtime.sync = function (handle, raw, internal) {
    const call = { handle, request: JSON.parse(raw), internal: internal ?? {}, settled: false };
    reads.push(call);
    const promise = readContext.run(call, () => sync(handle, raw, internal));
    promise.then(value => { call.value = value; call.settled = true; }, error => { call.error = error.code; call.settled = true; });
    return promise;
  };
  const suppliedSync = runtime.spatialSupply.sync;
  runtime.spatialSupply.sync = function (handle, raw, send) {
    const view = runtime.connectionView(handle), call = { handle, view, request: JSON.parse(raw), sent: runtime.spatialSupply.cursor(view), settled: false };
    rpc.push(call);
    const promise = suppliedSync.call(this, handle, raw, (value, binding) => {
      const proof = send(value, binding); call.proof = !!proof && typeof proof === 'object'; return proof;
    });
    promise.then(value => { call.value = value; call.sentAfter = runtime.spatialSupply.cursor(view); call.settled = true; }, error => { call.error = error.code; call.settled = true; });
    return promise;
  };
  const publish = runtime.spatialSupply.publish;
  runtime.spatialSupply.publish = function (view, target, send) {
    const call = { handle: view.handle, view, target, settled: false }; publications.push(call);
    const promise = publish.call(this, view, target, (value, binding) => {
      const proof = send(value, binding); call.value = value; call.proof = !!proof && typeof proof === 'object'; return proof;
    });
    promise.then(value => { call.result = value; call.sentAfter = runtime.spatialSupply.cursor(view); call.settled = true; }, error => { call.error = error.code; call.settled = true; });
    return promise;
  };
  runtime.hooks.afterCommit = async ({ command }) => {
    const read = readContext.getStore();
    if (command !== 'spatial-sync' || !read) return;
    const gate = [...gates].find(value => !value.claimed && value.handle === read.handle);
    if (!gate) return;
    gate.claimed = true; gate.read = read; gate.admitted.resolve(read); await gate.released.promise;
  };
  function holdRead(peer) {
    const admitted = Promise.withResolvers(), released = Promise.withResolvers();
    const gate = { handle: peer.handle, admitted, released, claimed: false, entered: admitted.promise, release: released.resolve, fail: released.reject };
    gates.add(gate); return gate;
  }
  const users = await Promise.all(['竞态甲', '竞态乙'].map(name => runtime.guest({ name })));
  const capabilities = ['spatial-v2', 'spatial-direction-v1', 'spatial-timed-trail-v1'];
  const { sessionId } = await runtime.create(users[0].token, { nonce: crypto.randomUUID(), contentVersion: 'spatial-graybox-v2', capabilities });
  await runtime.join(users[1].token, sessionId, { nonce: crypto.randomUUID(), capabilities });
  await runtime.start(users[0].token, sessionId, { nonce: crypto.randomUUID() });
  const address = await server.listen(0); origin = `http://127.0.0.1:${address.port}`;
  for (const user of users) {
    const peer = { user, wire: [], snapshots: [], requests: [] }; let lastSnapshot;
    peer.client = new SpatialSessionClient({ receipt() { throw new Error('同步回归不查询动作收据'); } }, (token, handlers) => {
      const actual = connectSpatialSocket(token, { ...handlers, batch(value) {
        const event = { kind: 'push', value, before: peer.client.state.snapshot?.snapshotSeq }; peer.wire.push(event);
        // 负例可在真实接收后向原校验器注入损坏输入；wire与服务端proof保持原字节。
        try { return handlers.batch(peer.transformPush ? peer.transformPush(value) : value); }
        finally { event.after = peer.client.state.snapshot?.snapshotSeq; }
      } }, origin, { directionHandoff: true, timedTrail: true });
      return {
        get connected() { return actual.connected; },
        get acceptedCapabilities() { return actual.acceptedCapabilities; },
        close() { return actual.close(); },
        request(event, raw, consume) {
          peer.requests.push({ event, request: typeof raw === 'string' ? JSON.parse(raw) : raw });
          return actual.request(event, raw, typeof consume === 'function' ? value => {
            const received = { kind: event === 'sync.request' ? 'ack' : event, value, before: peer.client.state.snapshot?.snapshotSeq }; peer.wire.push(received);
            try { return consume(value); }
            finally { received.after = peer.client.state.snapshot?.snapshotSeq; }
          } : undefined);
        },
      };
    }, { heartbeatMs: 0, reconnectDelayMs: 0, onChange(state) {
      if (state.snapshot && state.snapshot !== lastSnapshot) { lastSnapshot = state.snapshot; peer.snapshots.push(state.snapshot); }
    } });
    clients.push(peer); peer.client.open(sessionId, user.token);
    await until(() => peer.client.state.connection === 'online', '原consumer须完成真实订阅', 5000);
    peer.handle = handles.get(user.token); assert(peer.handle);
    await peer.client.control('resume'); assert.equal(peer.client.state.inputReady, true);
  }
  const head = async () => (await pool.query('SELECT session_seq FROM sessions WHERE session_id=$1', [sessionId])).rows[0].session_seq;
  const sent = peer => runtime.spatialSupply.cursor(runtime.connectionView(peer.handle));
  async function settle() {
    await until(async () => {
      const value = await head();
      return clients.every(peer => sent(peer) === value && peer.client.state.snapshot?.snapshotSeq === value)
        && reads.every(read => read.settled) && rpc.every(call => call.settled)
        && (await pool.query("SELECT 1 FROM outbox WHERE session_id=$1 AND status='Pending'", [sessionId])).rowCount === 0;
    }, '真实发送和原consumer须取得当前完整前缀', 5000);
    await new Promise(resolve => setImmediate(resolve));
  }
  await settle();
  const append = (count = 1) => runtime.locked(sessionId, { kind: 'rpc-race-fixture' }, tx => {
    for (let index = 0; index < count; index++) tx.emit('spatial.clock', { sceneTimeMs: tx.state.sceneTimeMs, wallAnchorMs: tx.state.wallAnchorMs, paused: tx.state.paused });
    return tx.state.sessionSeq;
  });
  return { runtime, server, clients, sessionId, reads, rpc, publications, holdRead, head, sent, settle, append,
    async step(milliseconds) { clock += milliseconds; await runtime.spatialCheckpoint(sessionId); return head(); } };
}
