import test from 'node:test';
import assert from 'node:assert/strict';
import { SpatialView } from '../src/domain/spatial-view.ts';
import { SpatialSessionClient } from '../src/network/spatial-session.ts';
import { spatialSnapshot, spatialBatch } from './spatial-fixture.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));
const empty = q => ({ schemaVersion: 2, type: 'world.batch', sessionId: q.sessionId, viewId: q.viewId,
  fromExclusive: q.cursor, throughSeq: q.cursor, events: [] });

function room() {
  const view = new SpatialView(), initial = spatialSnapshot(), generation = view.begin(initial.sessionId);
  assert.equal(view.acceptSnapshot(initial, generation), 'applied');
  return { view, generation, initial: view.snapshot };
}
function page(initial, count) {
  const value = { ...spatialBatch(initial, '13'), syncFrontierSeq: '13' };
  if (count === 0) value.events = [];
  if (count === 2) value.events.unshift(spatialBatch(initial, '11').events[0]);
  return value;
}
function advance(h, result) {
  if (result === 'stale') {
    const replacement = spatialSnapshot(); replacement.viewId = 'replacement-view'; replacement.snapshotSeq = '20';
    const next = h.view.begin(replacement.sessionId);
    assert.equal(h.view.acceptSnapshot(replacement, next), 'applied');
  } else {
    assert.equal(h.view.applyBatch(spatialBatch(h.initial, result === 'duplicate' ? '14' : '11'), h.generation), 'applied');
  }
  return h.view.snapshot;
}

test('SV02集成：三条批次路径的输入重入都先拒绝向普通metadata发布候选目标', async t => {
  for (const count of [1, 2, 0]) for (const result of ['stale', 'duplicate', 'refetch']) await t.test(count + ':' + result, () => {
    const h = room(), value = page(h.initial, count), metadata = { syncFrontierSeq: '旧目标' };
    const events = value.events; let calls = 0, installed;
    value.events = new Proxy(events, { ownKeys(array) {
      calls++; value.events = events; installed = advance(h, result);
      return Reflect.ownKeys(array);
    } });
    assert.equal(h.view.applyBatch(value, h.generation, metadata), result);
    assert.equal(calls, 1); assert.equal(h.view.snapshot, installed); assert.deepEqual(metadata, {});
    assert.equal(h.view.syncRequest().cursor, installed.snapshotSeq);
  });
});

test('SV02集成：metadata写入反射重入后再次核资格，不覆盖内层世界', async t => {
  for (const count of [1, 2, 0]) for (const result of ['stale', 'duplicate', 'refetch']) await t.test(count + ':' + result, () => {
    const h = room(), value = page(h.initial, count), sink = {}; let writes = 0, installed;
    const metadata = new Proxy(sink, { set(target, key, frontier) {
      assert.equal(key, 'syncFrontierSeq'); writes++;
      Reflect.set(target, key, frontier); installed = advance(h, result); return true;
    } });
    assert.equal(h.view.applyBatch(value, h.generation, metadata), result);
    assert.equal(writes, 1); assert.equal(h.view.snapshot, installed);
    assert.equal(h.view.syncRequest().cursor, installed.snapshotSeq);
    // 异常外部sink的字段不是applied凭据；不通过再次delete承诺跨对象回滚。
    assert.equal(sink.syncFrontierSeq, '13');
  });
});

test('SV02集成：metadata写入重入后抛错仍优先refetch，已安装内层快照不受损', async t => {
  for (const count of [1, 2, 0]) await t.test(String(count), () => {
    const h = room(); let writes = 0, installed;
    const metadata = new Proxy({}, { set() {
      writes++; installed = advance(h, 'stale'); throw new Error('外部sink写入失败');
    } });
    assert.equal(h.view.applyBatch(page(h.initial, count), h.generation, metadata), 'refetch');
    assert.equal(writes, 1); assert.equal(h.view.snapshot, installed); assert.equal(h.view.snapshot.viewId, 'replacement-view');
  });
});

async function session(t, onChange = () => {}) {
  const initial = spatialSnapshot(), requests = []; let handlers, read = empty, active = 0, maximum = 0;
  const link = { connected: true, acceptedCapabilities: ['spatial-direction-v1'], close() { this.connected = false; }, async request(event, raw) {
    if (event === 'session.subscribe') return structuredClone(initial);
    assert.equal(event, 'sync.request'); const q = JSON.parse(raw); requests.push(q);
    active++; maximum = Math.max(maximum, active);
    try { return await read(q); } finally { active--; }
  } };
  const client = new SpatialSessionClient({ receipt: async () => null }, (_token, value) => { handlers = value; return link; },
    { heartbeatMs: 0, reconnectDelayMs: 0, onChange });
  t.after(() => client.close()); client.open(initial.sessionId, 'token'); handlers.connected(); await flush(); await flush(); requests.length = 0;
  return { client, initial, requests, handlers, setRead(value) { read = value; }, get maximum() { return maximum; } };
}

test('SV02集成：真实Session不采用refetch结果中外部写入的metadata目标', async t => {
  const h = await session(t), original = SpatialView.prototype.applyBatch; let injected = 0;
  SpatialView.prototype.applyBatch = function (...args) {
    const result = Reflect.apply(original, this, args);
    if (result === 'refetch') { assert.ok(args[2]); args[2].syncFrontierSeq = '1000'; injected++; }
    return result;
  };
  t.after(() => { SpatialView.prototype.applyBatch = original; });
  h.setRead(q => {
    if (h.requests.length === 1) return spatialBatch({ ...h.initial, snapshotSeq: '12' }, '13');
    const through = String(BigInt(q.cursor) + 1n);
    return { ...spatialBatch({ ...h.initial, snapshotSeq: q.cursor }, through), syncFrontierSeq: through };
  });
  await h.client.sync(); await flush(); await flush();
  assert.equal(injected, 1); assert.deepEqual(h.requests.map(q => q.cursor), ['10', '10']);
  assert.equal(h.client.state.snapshot.snapshotSeq, '11'); assert.equal(h.maximum, 1);
});

test('SV02集成：applied达到fixed frontier时同页push缺口仍只服务一次轮后fresh', async t => {
  let h, pushed = false;
  h = await session(t, state => {
    if (state.snapshot?.snapshotSeq === '11' && !pushed) {
      pushed = true; h.handlers.batch(spatialBatch({ ...h.initial, snapshotSeq: '12' }, '13'));
    }
  });
  h.setRead(q => {
    const through = String(BigInt(q.cursor) + 1n);
    return { ...spatialBatch({ ...h.initial, snapshotSeq: q.cursor }, through), syncFrontierSeq: through };
  });
  await h.client.sync(); await flush(); await flush();
  assert.equal(pushed, true); assert.deepEqual(h.requests.map(q => q.cursor), ['10', '11']);
  assert.equal(h.client.state.snapshot.snapshotSeq, '12'); assert.equal(h.maximum, 1);
});
