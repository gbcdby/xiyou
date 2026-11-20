import test from 'node:test';
import assert from 'node:assert/strict';
import { SpatialView } from '../src/domain/spatial-view.ts';
import { SpatialSessionClient } from '../src/network/spatial-session.ts';
import { spatialSnapshot, spatialBatch } from './spatial-fixture.mjs';

function initialized() {
  const input = spatialSnapshot(), view = new SpatialView();
  const generation = view.begin(input.sessionId);
  assert.equal(view.acceptSnapshot(input, generation), 'applied');
  return { view, generation, initial: view.snapshot };
}

/** 在真实规范遍历的输入反射中重入，随后恢复普通数据供原生clone处理。 */
function duringBatchValidation(batch, reenter) {
  const projection = batch.events[0].payload.projection;
  let calls = 0;
  projection.targets = new Proxy([], {
    ownKeys(array) {
      calls++;
      projection.targets = [];
      reenter();
      return Reflect.ownKeys(array);
    },
  });
  return () => calls;
}

function assertFrozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.ok(Object.isFrozen(value));
  for (const child of Object.values(value)) assertFrozen(child, seen);
}

test('SV02-01：输入反射中重新开始，同会话或新会话均不能安装旧批次', async t => {
  for (const sessionId of ['spatial-room', 'other-room']) await t.test(sessionId, () => {
    const { view, generation, initial } = initialized(), batch = spatialBatch(initial);
    let currentGeneration;
    const calls = duringBatchValidation(batch, () => { currentGeneration = view.begin(sessionId); });
    assert.equal(view.applyBatch(batch, generation), 'stale');
    assert.equal(calls(), 1); assert.equal(view.generation, currentGeneration);
    assert.equal(view.snapshot, null); assert.equal(view.syncRequest(), null);
    const replacement = spatialSnapshot(); replacement.sessionId = sessionId; replacement.viewId = 'new-view';
    assert.equal(view.acceptSnapshot(replacement, currentGeneration), 'applied');
    assert.deepEqual(view.snapshot, replacement);
  });
});

test('SV02-01：重入换代并安装新快照后，外层保持该快照和同步游标', async t => {
  for (const sessionId of ['spatial-room', 'other-room']) await t.test(sessionId, () => {
    const { view, generation, initial } = initialized(), batch = spatialBatch(initial);
    const replacement = spatialSnapshot(); replacement.sessionId = sessionId;
    replacement.viewId = 'new-view'; replacement.snapshotSeq = '9007199254740993';
    let currentGeneration, installed, innerResult;
    const calls = duringBatchValidation(batch, () => {
      currentGeneration = view.begin(sessionId);
      innerResult = view.acceptSnapshot(replacement, currentGeneration); installed = view.snapshot;
    });
    assert.equal(view.applyBatch(batch, generation), 'stale');
    assert.equal(calls(), 1); assert.equal(innerResult, 'applied'); assert.equal(view.generation, currentGeneration);
    assert.equal(view.snapshot, installed); assert.deepEqual(view.snapshot, replacement);
    assert.deepEqual(view.syncRequest(), { schemaVersion: 2, type: 'sync.request', sessionId, viewId: 'new-view', cursor: '9007199254740993' });
    assertFrozen(view.snapshot);
  });
});

test('SV02-02：同代次内层批次已覆盖外层区间时，外层按重复忽略', () => {
  const { view, generation, initial } = initialized(), batch = spatialBatch(initial, '11');
  const inner = spatialBatch(initial, '12'); inner.events[0].payload.projection.self.name = '内层已确认';
  let innerResult, installed;
  const calls = duringBatchValidation(batch, () => {
    innerResult = view.applyBatch(inner, generation); installed = view.snapshot;
  });
  assert.equal(view.applyBatch(batch, generation), 'duplicate');
  assert.equal(calls(), 1); assert.equal(innerResult, 'applied'); assert.equal(view.generation, generation);
  assert.equal(view.snapshot, installed); assert.equal(view.snapshot.snapshotSeq, '12');
  assert.equal(view.snapshot.projection.self.name, '内层已确认'); assert.equal(view.syncRequest().cursor, '12');
  assertFrozen(view.snapshot);
});

test('SV02-02：重入只覆盖部分区间时，外层refetch并从当前游标补取', () => {
  const { view, generation, initial } = initialized(), batch = spatialBatch(initial, '13');
  const inner = spatialBatch(initial, '11'); let installed;
  const calls = duringBatchValidation(batch, () => {
    assert.equal(view.applyBatch(inner, generation), 'applied'); installed = view.snapshot;
  });
  assert.equal(view.applyBatch(batch, generation), 'refetch');
  assert.equal(calls(), 1); assert.equal(view.snapshot, installed);
  assert.equal(view.snapshot.snapshotSeq, '11'); assert.equal(view.syncRequest().cursor, '11');
});

test('SV02-02：真实Session消费者接到重叠结果后请求当前游标，不丢补取', async () => {
  const initial = spatialSnapshot(), requests = []; let handlers;
  const client = new SpatialSessionClient({ receipt: async () => null }, (_token, listeners) => {
    handlers = listeners;
    return { connected: true, close() {}, async request(event, value) {
      if (event === 'session.subscribe') return structuredClone(initial);
      assert.equal(event, 'sync.request'); const request = JSON.parse(value); requests.push(request);
      return { schemaVersion: 2, type: 'world.batch', sessionId: request.sessionId, viewId: request.viewId,
        fromExclusive: request.cursor, throughSeq: request.cursor, events: [] };
    } };
  }, { heartbeatMs: 0, reconnectDelayMs: 0 });
  try {
    client.open(initial.sessionId, 'token'); handlers.connected();
    await new Promise(resolve => setImmediate(resolve));
    requests.length = 0;
    const outer = spatialBatch(initial, '13'), inner = spatialBatch(initial, '11');
    const projection = outer.events[0].payload.projection; let calls = 0, installed;
    projection.targets = new Proxy([], { get(array, key, receiver) {
      if (key === 'forEach') {
        calls++; projection.targets = [];
        handlers.batch(inner); installed = client.state.snapshot;
      }
      return Reflect.get(array, key, receiver);
    } });
    handlers.batch(outer);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1); assert.equal(client.state.snapshot, installed);
    assert.equal(client.state.snapshot.snapshotSeq, '11');
    assert.deepEqual(requests.map(request => request.cursor), ['11']);
  } finally { client.close(); }
});

test('SV02-02：内层duplicate或refetch没有换快照时，外层仍可正常提交', async t => {
  for (const expected of ['duplicate', 'refetch']) await t.test(expected, () => {
    const { view, generation, initial } = initialized(), batch = spatialBatch(initial, '11');
    const inner = expected === 'duplicate'
      ? spatialBatch({ ...initial, snapshotSeq: '9' }, '10')
      : spatialBatch({ ...initial, snapshotSeq: '8' }, '12');
    let innerResult, held;
    const calls = duringBatchValidation(batch, () => {
      innerResult = view.applyBatch(inner, generation); held = view.snapshot;
    });
    assert.equal(view.applyBatch(batch, generation), 'applied');
    assert.equal(calls(), 1); assert.equal(innerResult, expected); assert.equal(held, initial);
    assert.equal(view.snapshot.snapshotSeq, '11'); assert.notEqual(view.snapshot, initial);
    assertFrozen(view.snapshot);
  });
});

test('SV02-03：原非法批次仍优先refetch，失败不改变重入新快照', () => {
  const { view, generation, initial } = initialized(), batch = spatialBatch(initial);
  const replacement = spatialSnapshot(); replacement.viewId = 'new-view';
  let installed;
  const calls = duringBatchValidation(batch, () => {
    batch.throughSeq = 'invalid-sequence';
    view.begin(initial.sessionId);
    assert.equal(view.acceptSnapshot(replacement, view.generation), 'applied');
    installed = view.snapshot;
  });
  assert.equal(view.applyBatch(batch, generation), 'refetch');
  assert.equal(calls(), 1); assert.equal(view.snapshot, installed); assert.equal(view.snapshot.viewId, 'new-view');
});

test('SV02-03：入口stale仍在读取旧输入之前返回', () => {
  const { view, generation } = initialized();
  view.begin('other-room'); let reads = 0;
  const input = new Proxy({}, { getPrototypeOf() { reads++; throw new Error('过期输入不可读取'); } });
  assert.equal(view.applyBatch(input, generation), 'stale');
  assert.equal(view.applyBatch(input, view.generation), 'stale');
  assert.equal(reads, 0); assert.equal(view.snapshot, null);
});

test('SV02-03：原生clone内才换代安装新快照，最终守卫仍保留新归属', () => {
  const { view, generation, initial } = initialized(), batch = spatialBatch(initial);
  const projection = batch.events[0].payload.projection;
  const replacement = spatialSnapshot(); replacement.viewId = 'clone-reentrant-view';
  let reflected = 0, clonedReads = 0, installed;
  projection.targets = new Proxy([], { get(array, key, receiver) {
    if (key === Symbol.iterator) {
      reflected++; projection.targets = [];
      // Snapshot关系读取已到targets；name后续只由真实原生clone读取。
      Object.defineProperty(projection.self, 'name', { enumerable: true, configurable: true, get() {
        clonedReads++; view.begin(initial.sessionId);
        assert.equal(view.acceptSnapshot(replacement, view.generation), 'applied'); installed = view.snapshot;
        return '合法旧名字';
      } });
    }
    return Reflect.get(array, key, receiver);
  } });
  assert.equal(view.applyBatch(batch, generation), 'stale');
  assert.equal(reflected, 1); assert.equal(clonedReads, 1);
  assert.equal(view.snapshot, installed); assert.equal(view.snapshot.viewId, 'clone-reentrant-view');
});

test('SV02-03：早期换代仍保留原生clone失败优先级，不提前返回stale', () => {
  const { view, generation, initial } = initialized(), batch = spatialBatch(initial);
  const projection = batch.events[0].payload.projection; let calls = 0;
  projection.targets = new Proxy([], { ownKeys(array) {
    if (calls++ === 0) view.begin(initial.sessionId);
    return Reflect.ownKeys(array);
  } });
  assert.equal(view.applyBatch(batch, generation), 'refetch');
  assert.ok(calls >= 1); assert.equal(view.snapshot, null); assert.equal(view.generation, generation + 1);
});

test('SV02-04：普通大整数批次和空批保留值、私有引用与完整冻结', () => {
  const view = new SpatialView(), input = spatialSnapshot(); input.snapshotSeq = '9007199254740993';
  const generation = view.begin(input.sessionId); assert.equal(view.acceptSnapshot(input, generation), 'applied');
  const batch = spatialBatch(view.snapshot, '9007199254740994');
  batch.events[0].payload.projection.self.name = '新确认名字';
  assert.equal(view.applyBatch(batch, generation), 'applied');
  const held = view.snapshot;
  assert.equal(held.snapshotSeq, '9007199254740994'); assert.equal(held.projection.self.name, '新确认名字');
  assert.notEqual(held.projection, batch.events[0].payload.projection); assertFrozen(held);
  batch.events[0].payload.projection.self.name = '外部后来修改';
  assert.equal(held.projection.self.name, '新确认名字');
  const empty = spatialBatch(held, '9007199254740995'); empty.events = [];
  assert.equal(view.applyBatch(empty, generation), 'applied');
  assert.equal(view.snapshot.snapshotSeq, '9007199254740995');
  assert.deepEqual(view.snapshot.projection, held.projection); assertFrozen(view.snapshot);
});
