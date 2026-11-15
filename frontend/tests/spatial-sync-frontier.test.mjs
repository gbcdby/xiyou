import test from 'node:test';
import assert from 'node:assert/strict';
import { SpatialSessionClient } from '../src/network/spatial-session.ts';
import { spatialSnapshot, spatialBatch } from './spatial-fixture.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));
const empty = q => ({ schemaVersion: 2, type: 'world.batch', sessionId: q.sessionId, viewId: q.viewId, fromExclusive: q.cursor, throughSeq: q.cursor, events: [] });
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
async function room(t, { capabilities = ['spatial-direction-v1'], snapshot = spatialSnapshot() } = {}) {
  const requests = [], snapshots = [], active = new Map(), maximum = new Map(), views = new Map([[snapshot.viewId, snapshot]]); let read = q => empty(q), handlers, links = 0, controls = 0;
  const client = new SpatialSessionClient({ receipt: async () => null }, (_token, callbacks) => {
    handlers = callbacks; const link = ++links; let connected = true;
    queueMicrotask(() => { if (connected) callbacks.connected(); });
    return { get connected() { return connected; }, acceptedCapabilities: capabilities, close() { connected = false; }, async request(event, raw) {
      const q = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (event === 'session.subscribe') return structuredClone(snapshot);
      if (event.startsWith('control.')) {
        const next = structuredClone(snapshot); next.viewId = 'new-view-' + ++controls; next.projection.self.controlEpoch = String(2 + controls);
        views.set(next.viewId, next);
        return { schemaVersion: 2, sessionId: q.sessionId, nonce: q.nonce, controlEpoch: next.projection.self.controlEpoch, observedSeq: next.snapshotSeq, snapshot: next };
      }
      assert.equal(event, 'sync.request', '传输前缀不能制造世界动作'); requests.push({ q, link });
      const count = (active.get(link) ?? 0) + 1; active.set(link, count); maximum.set(link, Math.max(maximum.get(link) ?? 0, count));
      try { return await read(q, link); } finally { active.set(link, active.get(link) - 1); }
    } };
  }, { heartbeatMs: 0, reconnectDelayMs: 0, onChange(state) { if (state.snapshot && snapshots.at(-1) !== state.snapshot) snapshots.push(state.snapshot); } });
  t.after(() => client.close()); client.open(snapshot.sessionId, 'token'); await flush(); await flush(); requests.length = 0;
  const page = (q, through, frontier = through) => ({ ...spatialBatch({ ...(views.get(q.viewId) ?? snapshot), viewId: q.viewId, snapshotSeq: q.cursor }, through), ...(frontier === null ? {} : { syncFrontierSeq: frontier }) });
  return { client, snapshot, requests, snapshots, maximum, page, setRead(fn) { read = fn; }, get handlers() { return handlers; } };
}

test('D66 v0.3：已到本轮提交前缀就停，不追逐页间的新提交', async t => {
  const h = await room(t); h.setRead(q => h.page(q, String(BigInt(q.cursor) + 1n)));
  await h.client.sync(); await flush();
  assert.equal(h.requests.length, 1); assert.equal(h.client.state.snapshot.snapshotSeq, '11'); assert.equal(h.maximum.get(1), 1);
});

test('D66 v0.3：首目标不随后页抬高或缺字段清空，越过目标的整批轨迹保持完整', async t => {
  for (const missingLater of [false, true]) await t.test(missingLater ? '后页缺字段' : '后页新前缀', async t => {
    const h = await room(t), pages = [['266', '610'], ['522', missingLater ? null : '660'], ['710', missingLater ? null : '800']];
    const trail = [{ x: 100, y: 100 }, { x: 100, y: 130 }, { x: 140, y: 130 }]; let last;
    h.setRead(q => {
      const [through, frontier] = pages.shift() ?? [String(BigInt(q.cursor) + 1n), '900']; const batch = h.page(q, through, frontier);
      if (through === '710') { const p = batch.events[0].payload.projection; p.sceneTimeMs = 1400; p.self.position = trail.at(-1); Object.assign(p.entities[0], { position: trail.at(-1), motionTrail: trail, motionFromSceneTimeMs: 1000, motionThroughSceneTimeMs: 1400 }); last = batch; }
      return batch;
    });
    await h.client.sync(); await flush();
    assert.deepEqual(h.requests.map(r => r.q.cursor), ['10', '266', '522']); assert.equal(h.client.state.snapshot.snapshotSeq, '710');
    assert.deepEqual(h.client.state.snapshot.projection, last.events[0].payload.projection); assert.deepEqual(h.client.state.snapshot.projection.entities[0].motionTrail, trail);
  });
});

test('D66 v0.3：真实积压仍守8页，缺字段旧服与未协商能力沿原路径', async t => {
  for (const mode of ['积压', '旧服', '未协商']) await t.test(mode, async t => {
    const h = await room(t, { capabilities: mode === '未协商' ? [] : ['spatial-direction-v1'] });
    h.setRead(q => h.page(q, String(BigInt(q.cursor) + 1n), mode === '旧服' ? null : mode === '未协商' ? String(BigInt(q.cursor) + 1n) : '500'));
    await h.client.sync(); await flush();
    assert.equal(h.requests.length, 8); assert.equal(h.client.state.snapshot.snapshotSeq, '18'); assert.equal(h.maximum.get(1), 1);
  });
});

test('D66 v0.3：活动期间fresh需求合并一次，下一轮使用自己的新目标', async t => {
  const h = await room(t), gate = deferred(); let first;
  h.setRead(q => { first = q; return gate.promise; }); const active = h.client.sync(); await flush();
  void h.client.sync(); void h.client.sync(); h.setRead(q => h.page(q, '12', '12')); gate.resolve(h.page(first, '11', '11'));
  await active; await flush(); await flush();
  assert.deepEqual(h.requests.map(r => r.q.cursor), ['10', '11']); assert.equal(h.client.state.snapshot.snapshotSeq, '12'); assert.equal(h.maximum.get(1), 1);
});

test('D66 v0.3：空但推进的Batch按大整数游标完整应用后结束', async t => {
  const snapshot = spatialSnapshot(); snapshot.snapshotSeq = '9007199254740993'; const h = await room(t, { snapshot });
  h.setRead(q => ({ ...h.page(q, '9007199254740994'), events: [] })); await h.client.sync();
  assert.equal(h.requests.length, 1); assert.equal(h.client.state.snapshot.snapshotSeq, '9007199254740994'); assert.deepEqual(h.client.state.snapshot.projection, snapshot.projection);
});

test('D66 v0.3：存在但非法的前缀拒绝整批，不能降格成缺字段旧回复', async t => {
  for (const frontier of ['10', '01', null, 11]) await t.test(String(frontier), async t => {
    const h = await room(t); h.setRead(q => ({ ...h.page(q, '11'), syncFrontierSeq: frontier })); await h.client.sync();
    assert.equal(h.requests.length, 1); assert.equal(h.client.state.snapshot.snapshotSeq, '10');
    h.setRead(q => h.page(q, '11')); await h.client.sync(); assert.equal(h.requests.length, 2); assert.equal(h.client.state.snapshot.snapshotSeq, '11');
  });
});

test('D66 v0.3：推送和部分重叠回复不安装分页目标', async t => {
  const h = await room(t), gate = deferred(); let first;
  h.setRead(q => { first = q; return gate.promise; }); const active = h.client.sync(); await flush();
  h.handlers.batch(h.page(first, '11', '1000')); void h.client.sync();
  h.setRead(q => h.page(q, '12', '12')); gate.resolve(h.page(first, '12', '1000'));
  await active; await flush(); await flush();
  assert.deepEqual(h.requests.map(r => r.q.cursor), ['10', '11']); assert.equal(h.client.state.snapshot.snapshotSeq, '12'); assert.equal(h.maximum.get(1), 1);
});

test('D66 v0.3：新view或新link使旧分页目标失效，旧回复不安装', async t => {
  for (const mode of ['新view', '新link']) await t.test(mode, async t => {
    const h = await room(t), gate = deferred(); let oldRequest;
    h.setRead(q => q.cursor === '10' ? h.page(q, '11', '1000') : (oldRequest = q, gate.promise));
    const oldRound = h.client.sync(); await flush(); await flush(); assert.equal(h.requests.length, 2);
    h.setRead(q => h.page(q, '11', '11'));
    if (mode === '新view') await h.client.control('resume');
    else { h.handlers.disconnected(); h.client.reconnect(); await flush(); await flush(); }
    gate.resolve(h.page(oldRequest, '12', '1000')); await oldRound; await flush(); await flush();
    assert.equal(h.requests.length, 3); assert.equal(h.client.state.snapshot.snapshotSeq, '11');
    assert.equal(h.client.state.snapshot.viewId, mode === '新view' ? 'new-view-1' : h.snapshot.viewId);
    assert.ok([...h.maximum.values()].every(value => value === 1));
  });
});
