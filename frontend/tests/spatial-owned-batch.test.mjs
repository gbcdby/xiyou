import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSpatial } from '../../protocol/spatial.mjs';
import { SpatialView } from '../src/domain/spatial-view.ts';
import { spatialSnapshot, spatialBatch } from './spatial-fixture.mjs';

const otherRef = 'other_000000000000000000000000000000';
function room(initial = spatialSnapshot()) {
  const view = new SpatialView(), generation = view.begin(initial.sessionId);
  assert.equal(view.acceptSnapshot(initial, generation), 'applied');
  return { view, generation, initial };
}
function batch(initial, count = 1) {
  const through = String(BigInt(initial.snapshotSeq) + BigInt(Math.max(1, count)));
  const value = spatialBatch(initial, through);
  value.events = Array.from({ length: count }, (_, index) => ({
    sessionSeq: String(BigInt(initial.snapshotSeq) + BigInt(index + 1)), eventId: 'owned-event-' + index,
    kind: 'projection.replace', payload: { projection: structuredClone(initial.projection) },
  }));
  value.syncFrontierSeq = through;
  return value;
}
function frozen(value) {
  if (!value || typeof value !== 'object') return;
  assert.ok(Object.isFrozen(value));
  for (const child of Object.values(value)) frozen(child);
}
function heldItem(ownerRef = otherRef) {
  return { entityRef: 'item_0000000000000000000000000000000', name: '木牌', location: { kind: 'held', ownerRef },
    resourceRevision: '0', transferable: true, publicBorrowable: true, fields: [] };
}
function target(entityRef) {
  return { entityRef, name: '门口', sceneId: 'yard', position: { x: 100, y: 100 }, resourceRevision: '0', availableOperations: [], fields: [] };
}

test('SC02-04：单、多、空批只把本次已应用的前沿交给局部容器，原字符串返回不变', async t => {
  for (const count of [1, 2, 0]) await t.test(String(count), () => {
    const { view, generation, initial } = room(), value = batch(initial, count), metadata = { syncFrontierSeq: '旧值' };
    const expected = structuredClone(count ? value.events.at(-1).payload.projection : initial.projection);
    assert.equal(view.applyBatch(value, generation, metadata), 'applied');
    assert.deepEqual(metadata, { syncFrontierSeq: value.syncFrontierSeq });
    assert.equal(view.snapshot.snapshotSeq, value.throughSeq);
    assert.deepEqual(view.snapshot.projection, expected); frozen(view.snapshot);
    if (count) {
      assert.notEqual(view.snapshot.projection, value.events.at(-1).payload.projection);
      value.events.at(-1).payload.projection.self.name = '外部后来修改';
      assert.notEqual(view.snapshot.projection.self.name, '外部后来修改');
    }
  });
});

test('SC02-04：无前沿的合法旧回复与所有非applied出口清除旧metadata', async t => {
  const cases = [
    ['缺前沿', 'applied', h => { const value = batch(h.initial); delete value.syncFrontierSeq; return [value, h.generation]; }],
    ['旧代次', 'stale', h => [batch(h.initial), h.generation - 1]],
    ['旧view', 'stale', h => [{ ...batch(h.initial), viewId: 'old-view' }, h.generation]],
    ['重复', 'duplicate', h => [{ ...batch(h.initial, 0), throughSeq: h.initial.snapshotSeq }, h.generation]],
    ['缺口', 'refetch', h => [{ ...batch(h.initial, 2), fromExclusive: '11', events: [] }, h.generation]],
    ['换本人', 'resync', h => { const value = batch(h.initial); value.events[0].payload.projection.self.entityRef = otherRef; return [value, h.generation]; }],
    ['非法字段', 'refetch', h => { const value = batch(h.initial); value.extra = true; return [value, h.generation]; }],
  ];
  for (const [name, result, build] of cases) await t.test(name, () => {
    const h = room(), before = h.view.snapshot, metadata = { syncFrontierSeq: '残留旧目标' }, args = build(h);
    assert.equal(h.view.applyBatch(...args, metadata), result); assert.deepEqual(metadata, {});
    if (result !== 'applied') assert.equal(h.view.snapshot, before);
  });
});

test('SC02-04：元数据写入失败不能发生在快照安装之后', async t => {
  for (const count of [1, 2, 0]) await t.test(String(count), () => {
    const { view, generation, initial } = room(), before = view.snapshot;
    assert.equal(view.applyBatch(batch(initial, count), generation, Object.preventExtensions({})), 'refetch');
    assert.equal(view.snapshot, before);
  });
});

test('SC02-04：存在的非枚举或访问器前沿不降格为缺字段，任何路径不读getter', async t => {
  for (const count of [1, 2, 0]) for (const mode of ['隐藏非法值', '隐藏合法值', '隐藏getter', '枚举getter']) await t.test(count + ':' + mode, () => {
    const { view, generation, initial } = room(), before = view.snapshot, value = batch(initial, count); let reads = 0;
    delete value.syncFrontierSeq;
    const descriptor = { configurable: true, enumerable: mode === '枚举getter' };
    if (mode.includes('getter')) descriptor.get = () => { reads++; return '11'; };
    else descriptor.value = mode === '隐藏非法值' ? '0' : value.throughSeq;
    Object.defineProperty(value, 'syncFrontierSeq', descriptor);
    assert.equal(view.applyBatch(value, generation), 'refetch'); assert.equal(view.snapshot, before); assert.equal(reads, 0);
  });
});

test('SC02-01：选路不执行events访问器，异常仍保留原视图', () => {
  const { view, generation, initial } = room(), before = view.snapshot, value = batch(initial); let reads = 0;
  Object.defineProperty(value, 'events', { enumerable: true, get() { reads++; return []; } });
  assert.equal(view.applyBatch(value, generation), 'refetch'); assert.equal(reads, 0); assert.equal(view.snapshot, before);
});

test('SC02-05：单事件隐藏属性收紧为拒绝，慢路径保留原无关隐藏属性语义', async t => {
  for (const count of [1, 2]) for (const getter of [false, true]) await t.test(count + ':' + getter, () => {
    const { view, generation, initial } = room(), value = batch(initial, count), before = view.snapshot; let reads = 0;
    const descriptor = getter ? { get() { reads++; return '隐藏'; } } : { value: '隐藏' };
    Object.defineProperty(value.events.at(-1).payload.projection.self, 'hidden', descriptor);
    assert.equal(view.applyBatch(value, generation), count === 1 ? 'refetch' : 'applied'); assert.equal(reads, 0);
    if (count === 1) assert.equal(view.snapshot, before);
  });
});

test('SC02-05：可枚举只读数据、null原型、共享引用和负零不被当作非法或环', () => {
  const { view, generation, initial } = room(), value = batch(initial), p = value.events[0].payload.projection;
  const point = Object.assign(Object.create(null), { x: -0, y: 100 }); p.self.position = point; p.entities[0].position = point;
  Object.defineProperty(p.self, 'name', { value: '旅伴甲', enumerable: true, writable: false, configurable: false });
  assert.equal(view.applyBatch(value, generation), 'applied');
  assert.ok(Object.is(view.snapshot.projection.self.position.x, -0));
  assert.equal(view.snapshot.projection.self.position, view.snapshot.projection.entities[0].position);
  assert.notEqual(view.snapshot.projection.self.position, point); frozen(view.snapshot);
});

test('SC02-05：单事件透明Proxy不被规范串洗成合法自有值', async t => {
  for (const location of ['根', '末投影坐标']) await t.test(location, () => {
    const { view, generation, initial } = room(), before = view.snapshot; let value = batch(initial);
    if (location === '根') value = new Proxy(value, {});
    else { const p = value.events[0].payload.projection; p.self.position = new Proxy(p.self.position, {}); }
    assert.equal(view.applyBatch(value, generation), 'refetch'); assert.equal(view.snapshot, before);
  });
});

test('SC02-01：源canonical检查中Proxy改坏已扫描字段并自消失，owned仍必须重新严格检查', () => {
  const { view, generation, initial } = room(), before = view.snapshot, value = batch(initial), p = value.events[0].payload.projection;
  let calls = 0;
  p.targets = new Proxy([], { ownKeys(array) { calls++; p.self.name = '\ud800'; p.targets = []; return Reflect.ownKeys(array); } });
  assert.equal(view.applyBatch(value, generation), 'refetch'); assert.ok(calls > 0); assert.equal(view.snapshot, before);
});

test('SC02-02：完整Batch结构及三组语义失败，单事件不能靠末Snapshot关系检查放行', async t => {
  const changes = [
    ['额外身份', p => { p.self.actorId = '内部身份'; }],
    ['个人版本错配', p => { p.reducerVersion = 'gaolao-world-v2'; }],
    ['全景没有地图', p => { p.sceneOverview = { entities: [], items: [], targets: [] }; }],
    ['时间线缺轨迹', p => { p.entities[0].motionTimeline = [{ kind: 'motion', fromSceneTimeMs: 0, throughSceneTimeMs: 1, fromTrailIndex: 0, throughTrailIndex: 1 }]; }],
  ];
  for (const [name, mutate] of changes) await t.test(name, () => {
    const { view, generation, initial } = room(), before = view.snapshot, value = batch(initial);
    mutate(value.events[0].payload.projection);
    assert.throws(() => validateSpatial('BatchV2', value), { code: 'INVALID_MESSAGE' });
    assert.equal(view.applyBatch(value, generation), 'refetch'); assert.equal(view.snapshot, before);
  });
});

test('SC02-03：Batch本身可过的所有最终Snapshot专属关系继续拒绝且保原错误路径', async t => {
  const trail = p => Object.assign(p.entities[0], { motionTrail: [{ x: 90, y: 100 }, { x: 100, y: 100 }], motionFromSceneTimeMs: 0, motionThroughSceneTimeMs: 1000 });
  const changes = [
    ['本人缺失', '$.self', p => { p.entities = []; }],
    ['实体重复', '$.entities', p => { p.entities.push(structuredClone(p.entities[0])); }],
    ['跨类引用重复', '$.entities', p => { p.targets.push(target(p.self.entityRef)); }],
    ['终态仍控制', '$.self.canControl', p => { p.phase = 'Finished'; }],
    ['轨迹字段不成组', '$.entities.motionTrail', p => { p.entities[0].motionTrail = [{ x: 100, y: 100 }]; }],
    ['轨迹点不足', '$.entities.motionTrail', p => { trail(p); p.entities[0].motionTrail.pop(); }],
    ['轨迹倒时', '$.entities.motionTrail', p => { trail(p); p.entities[0].motionFromSceneTimeMs = 1001; }],
    ['轨迹越场景时间', '$.entities.motionTrail', p => { trail(p); p.entities[0].motionThroughSceneTimeMs = 1001; }],
    ['轨迹尾点错误', '$.entities.motionTrail', p => { trail(p); p.entities[0].motionTrail[1].x = 101; }],
    ['持有人缺失', '$.items.location', p => { p.items.push(heldItem()); }],
  ];
  for (const [name, path, mutate] of changes) for (const count of [1, 2]) await t.test(name + ':' + count, () => {
    const { view, generation, initial } = room(), before = view.snapshot, value = batch(initial, count);
    mutate(value.events.at(-1).payload.projection);
    assert.equal(validateSpatial('BatchV2', value), value);
    assert.throws(() => validateSpatial('SnapshotV2', { ...initial, snapshotSeq: value.throughSeq, projection: value.events.at(-1).payload.projection }), error => error.code === 'INVALID_MESSAGE' && error.path === path);
    assert.equal(view.applyBatch(value, generation), 'refetch'); assert.equal(view.snapshot, before);
  });
});

test('SC02-02：只坏中间Snapshot专属关系的多事件仍应用，不能静默扩大Batch合同', () => {
  const { view, generation, initial } = room(), value = batch(initial, 2);
  value.events[0].payload.projection.entities = [];
  assert.equal(validateSpatial('BatchV2', value), value);
  assert.equal(view.applyBatch(value, generation), 'applied'); assert.equal(view.snapshot.snapshotSeq, '12');
  assert.deepEqual(view.snapshot.projection, value.events[1].payload.projection);
});

test('SC02-02：整批结构检查与原View守卫的优先级不变', async t => {
  const cases = [
    ['非法重复批', 'refetch', h => { const v = batch(h.initial, 0); v.throughSeq = h.initial.snapshotSeq; v.extra = true; return v; }],
    ['旧view尚未查最后关系', 'stale', h => { const v = batch(h.initial); v.viewId = 'old'; v.events[0].payload.projection.entities = []; return v; }],
    ['换内容', 'resync', h => { const v = batch(h.initial); v.events[0].payload.projection.contentVersion = 'other-content'; return v; }],
    ['epoch倒退', 'resync', h => { const v = batch(h.initial); v.events[0].payload.projection.self.controlEpoch = '1'; return v; }],
    ['eventId重复', 'refetch', h => { const v = batch(h.initial, 2); v.events[1].eventId = v.events[0].eventId; return v; }],
  ];
  for (const [name, result, build] of cases) await t.test(name, () => {
    const h = room(), before = h.view.snapshot;
    assert.equal(h.view.applyBatch(build(h), h.generation), result); assert.equal(h.view.snapshot, before);
  });
  const initial = spatialSnapshot(); initial.projection.phase = 'Finished'; initial.projection.self.canControl = false;
  const h = room(initial), before = h.view.snapshot;
  assert.equal(h.view.applyBatch(batch(initial), h.generation), 'resync'); assert.equal(h.view.snapshot, before);
});

test('SC02-02：空推进保持大整数精确且不把不应用的原输入写入元数据', () => {
  const initial = spatialSnapshot(); initial.snapshotSeq = '9007199254740993';
  const { view, generation } = room(initial), value = batch(initial, 0), metadata = {};
  assert.equal(view.applyBatch(value, generation, metadata), 'applied');
  assert.equal(view.snapshot.snapshotSeq, '9007199254740994'); assert.equal(metadata.syncFrontierSeq, '9007199254740994');
  assert.deepEqual(view.snapshot.projection, initial.projection);
  assert.equal(view.applyBatch(value, generation, metadata), 'duplicate'); assert.deepEqual(metadata, {});
});
