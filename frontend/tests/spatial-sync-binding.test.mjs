import test from 'node:test';
import assert from 'node:assert/strict';
import { SpatialSessionClient } from '../src/network/spatial-session.ts';
import { spatialSnapshot, spatialBatch } from './spatial-fixture.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));
const empty = q => ({ schemaVersion: 2, type: 'world.batch', sessionId: q.sessionId, viewId: q.viewId, fromExclusive: q.cursor, throughSeq: q.cursor, events: [] });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function room(t) {
  const initial = spatialSnapshot(); initial.projection.self.canControl = false;
  const requests = [], replies = [], controls = new Map(), active = new Map(), maximum = new Map(); let handlers, links = 0;
  const client = new SpatialSessionClient({ receipt: async () => null }, (_token, callbacks) => {
    handlers = callbacks; const link = ++links; let connected = true;
    queueMicrotask(() => { if (connected) callbacks.connected(); });
    return { get connected() { return connected; }, close() { connected = false; }, async request(event, raw) {
      const q = typeof raw === 'string' ? JSON.parse(raw) : raw; requests.push({ event, q, link });
      if (event === 'session.subscribe') return structuredClone(initial);
      if (event.startsWith('control.')) {
        if (!controls.has(q.nonce)) {
          const epoch = String(3 + controls.size), snapshot = spatialSnapshot(); snapshot.viewId = 'controlled-' + epoch; snapshot.projection.self.controlEpoch = epoch;
          controls.set(q.nonce, { schemaVersion: 2, sessionId: q.sessionId, nonce: q.nonce, controlEpoch: epoch, observedSeq: snapshot.snapshotSeq, snapshot });
        }
        return controls.get(q.nonce);
      }
      assert.equal(event, 'sync.request', '同步恢复不能提交世界动作');
      const count = (active.get(link) ?? 0) + 1; active.set(link, count); maximum.set(link, Math.max(maximum.get(link) ?? 0, count));
      try { return await (replies.length ? replies.shift()(q) : empty(q)); }
      finally { active.set(link, active.get(link) - 1); }
    } };
  }, { heartbeatMs: 0, reconnectDelayMs: 0 });
  t.after(() => client.close()); client.open(initial.sessionId, 'token'); await flush(); await flush();
  return { client, initial, replies, active, maximum, get handlers() { return handlers; }, get links() { return links; }, syncs: () => requests.filter(r => r.event === 'sync.request') };
}
function hold(h) { const gate = deferred(); h.replies.push(q => { gate.request = q; return gate.promise; }); return gate; }

test('D66-CLIENT-04：同link多次安装新view只保留最新需求，旧回复不能安装', async t => {
  const h = await room(t), before = h.syncs().length, gate = hold(h); const original = h.client.sync();
  try {
    await flush(); void h.client.sync(); await h.client.control('resume'); await h.client.control('take'); await flush();
    assert.equal(h.client.state.snapshot.viewId, 'controlled-4'); assert.equal(h.maximum.get(1), 1); assert.equal(h.syncs().length - before, 1);
    const stale = spatialBatch(h.initial, '11'); stale.events[0].payload.projection.self.position.x = 900;
    gate.resolve(stale); await original; await flush(); await flush();
    assert.equal(h.syncs().length - before, 2, '旧轮释放后只补读最新view一次');
    assert.equal(h.syncs().at(-1).q.viewId, 'controlled-4'); assert.equal(h.client.state.snapshot.viewId, 'controlled-4');
    assert.equal(h.client.state.snapshot.projection.self.position.x, 100); assert.equal(h.client.state.inputReady, true); assert.equal(h.links, 1);
  } finally { gate.resolve(empty(gate.request)); await original; }
});

test('D66-CLIENT-04：同link旧view的Forbidden仍立即撤权，不消费新view排队需求', async t => {
  const h = await room(t), before = h.syncs().length, gate = hold(h); const original = h.client.sync();
  await flush(); await h.client.control('resume');
  gate.resolve({ schemaVersion: 2, code: 'FORBIDDEN', message: '连接授权已撤销。' }); await original; await flush();
  assert.equal(h.syncs().length - before, 1); assert.equal(h.client.state.connection, 'forbidden'); assert.equal(h.client.state.snapshot, null); assert.equal(h.maximum.get(1), 1);
});

test('D66-CLIENT-04：断线后新link独立恢复，旧link未决请求不复活或撤销新连接', async t => {
  const h = await room(t), gate = hold(h); const original = h.client.sync();
  await flush(); await h.client.control('resume'); h.handlers.disconnected(); h.client.reconnect(); await flush(); await flush();
  assert.equal(h.links, 2); const beforeOldReply = h.syncs().length;
  gate.resolve({ schemaVersion: 2, code: 'FORBIDDEN', message: '旧连接的迟到撤权。' }); await original; await flush();
  assert.equal(h.syncs().length, beforeOldReply); assert.equal(h.client.state.connection, 'online');
  assert.equal(h.client.state.snapshot.viewId, h.initial.viewId); assert.equal(h.client.state.inputReady, false);
  assert.equal(h.maximum.get(1), 1); assert.equal(h.maximum.get(2), 1);
});

test('D66-CLIENT-04：旧view读取超时正常释放link槽，只补读当前合法view', async t => {
  const h = await room(t), before = h.syncs().length, gate = hold(h); const original = h.client.sync();
  await flush(); await h.client.control('resume'); gate.reject(new Error('原读取已超时')); await original; await flush();
  assert.equal(h.syncs().length - before, 2); assert.equal(h.syncs().at(-1).q.viewId, 'controlled-3');
  assert.equal(h.maximum.get(1), 1); assert.equal(h.client.state.inputReady, true);
});
