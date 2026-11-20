import test from 'node:test';
import assert from 'node:assert/strict';
import { SpatialView } from '../src/domain/spatial-view.ts';
import { spatialSnapshot } from './spatial-fixture.mjs';

function emptyAfter(snapshot) {
  const throughSeq = String(BigInt(snapshot.snapshotSeq) + 1n);
  return {
    schemaVersion: 2, type: 'world.batch', sessionId: snapshot.sessionId, viewId: snapshot.viewId,
    fromExclusive: snapshot.snapshotSeq, throughSeq, events: [],
  };
}

function assertFrozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.ok(Object.isFrozen(value));
  for (const child of Object.values(value)) assertFrozen(child, seen);
}

function mutateDuringCanonical(input, mutate) {
  let calls = 0;
  input.projection.targets = new Proxy([], {
    ownKeys(array) {
      calls++;
      input.projection.targets = [];
      mutate();
      return Reflect.ownKeys(array);
    },
  });
  return () => calls;
}

test('SV01-01：反射中改坏已扫描Unicode并移除Proxy，拒绝实际副本且同代次仍可恢复', () => {
  const input = spatialSnapshot(), view = new SpatialView(), generation = view.begin(input.sessionId);
  const calls = mutateDuringCanonical(input, () => { input.projection.self.name = '\ud800'; });
  assert.equal(view.acceptSnapshot(input, generation), 'invalid');
  assert.equal(calls(), 1); assert.equal(input.projection.self.name.charCodeAt(0), 0xd800);
  assert.equal(view.snapshot, null); assert.equal(view.syncRequest(), null);

  const valid = spatialSnapshot();
  assert.equal(view.acceptSnapshot(valid, generation), 'applied');
  const empty = emptyAfter(view.snapshot);
  assert.equal(view.applyBatch(empty, generation), 'applied');
  assert.equal(view.snapshot.snapshotSeq, '11');
  assert.equal(view.snapshot.projection.self.name, valid.projection.self.name);
  assertFrozen(view.snapshot);
});

test('SV01-01：实际副本仍经过完整结构与Snapshot专属关系校验', async t => {
  const cases = [
    // targets在self结构扫描之后；修改值仍可规范编码，但已不符合name的类型。
    ['结构类型', 'forEach', projection => { projection.self.name = 42; }],
    // 关系检查先确认本人存在，再遍历targets；不能让已检查过的entities被移空后安装。
    ['本人关系', Symbol.iterator, projection => { projection.entities = []; }],
  ];
  for (const [name, trigger, mutate] of cases) await t.test(name, () => {
    const input = spatialSnapshot(), projection = input.projection;
    const view = new SpatialView(), generation = view.begin(input.sessionId); let calls = 0;
    projection.targets = new Proxy([], {
      get(array, key, receiver) {
        if (key === trigger) {
          calls++; projection.targets = []; mutate(projection);
        }
        return Reflect.get(array, key, receiver);
      },
    });
    assert.equal(view.acceptSnapshot(input, generation), 'invalid');
    assert.equal(calls, 1); assert.equal(view.snapshot, null); assert.equal(view.syncRequest(), null);
  });
});

test('SV01-02：正常大整数快照保持值、共享子图、独立引用与完整冻结', () => {
  const input = spatialSnapshot(); input.snapshotSeq = '9007199254740993';
  const point = input.projection.self.position;
  input.projection.entities[0].position = point;
  const view = new SpatialView(), generation = view.begin(input.sessionId);
  assert.equal(view.acceptSnapshot(input, generation), 'applied');
  const held = view.snapshot;
  assert.deepEqual(held, input);
  assert.notEqual(held, input); assert.notEqual(held.projection, input.projection);
  assert.notEqual(held.projection.self, input.projection.self);
  assert.notEqual(held.projection.entities, input.projection.entities);
  assert.notEqual(held.projection.self.position, point);
  assert.equal(held.projection.self.position, held.projection.entities[0].position);
  assertFrozen(held);
  input.projection.self.name = '外部后来修改'; point.x = 700;
  assert.equal(held.projection.self.name, '旅伴甲');
  assert.deepEqual(held.projection.self.position, { x: 100, y: 100 });

  assert.equal(view.applyBatch(emptyAfter(held), generation), 'applied');
  assert.equal(view.snapshot.snapshotSeq, '9007199254740994');
  assertFrozen(view.snapshot);
});

test('SV01-03：原raw访问器、数组隐藏额外属性和非法Unicode不能经clone洗白', async t => {
  const cases = [
    ['访问器', (input, read) => Object.defineProperty(input.projection.self, 'name', {
      enumerable: true, configurable: true, get() { read(); return '旅伴甲'; },
    })],
    ['数组隐藏额外属性', input => Object.defineProperty(input.projection.targets, 'hidden', { value: '隐藏' })],
    ['非法Unicode', input => { input.projection.self.name = '\ud800'; }],
  ];
  for (const [name, mutate] of cases) await t.test(name, () => {
    const input = spatialSnapshot(), view = new SpatialView(), generation = view.begin(input.sessionId); let reads = 0;
    mutate(input, () => { reads++; });
    assert.equal(view.acceptSnapshot(input, generation), 'invalid');
    assert.equal(reads, 0); assert.equal(view.snapshot, null); assert.equal(view.syncRequest(), null);
  });
});

test('SV01-03：仍由原生clone拒绝未移除的透明Proxy，失败不安装副本', () => {
  const input = new Proxy(spatialSnapshot(), {}), view = new SpatialView(), generation = view.begin(input.sessionId);
  assert.equal(view.acceptSnapshot(input, generation), 'invalid');
  assert.equal(view.snapshot, null); assert.equal(view.syncRequest(), null);
});

test('SV01-04：旧代次和已有快照仍在任何raw反射前返回stale', () => {
  const view = new SpatialView(), oldGeneration = view.begin('spatial-room');
  const generation = view.begin('spatial-room'); let reads = 0;
  const input = new Proxy({}, { getPrototypeOf() { reads++; throw new Error('不应读取过期输入'); } });
  assert.equal(view.acceptSnapshot(input, oldGeneration), 'stale'); assert.equal(reads, 0);
  assert.equal(view.snapshot, null);
  assert.equal(view.acceptSnapshot(spatialSnapshot(), generation), 'applied');
  const held = view.snapshot;
  assert.equal(view.acceptSnapshot(input, generation), 'stale');
  assert.equal(reads, 0); assert.equal(view.snapshot, held);
});

test('SV01-04：raw验证先于session不符，合法旧session仍在clone前返回stale', () => {
  const view = new SpatialView(), generation = view.begin('spatial-room');
  const invalid = spatialSnapshot(); invalid.sessionId = 'other-room'; invalid.projection.self.name = '\ud800';
  assert.equal(view.acceptSnapshot(invalid, generation), 'invalid'); assert.equal(view.snapshot, null);
  const foreign = spatialSnapshot(); foreign.sessionId = 'other-room';
  // 透明Proxy若走到原生clone会失败，原session早返回必须优先于该失败。
  assert.equal(view.acceptSnapshot(new Proxy(foreign, {}), generation), 'stale');
  assert.equal(view.snapshot, null); assert.equal(view.syncRequest(), null);
});

test('SV01-04：raw反射中切换同session代次，旧调用不能安装到新代次', () => {
  const input = spatialSnapshot(), view = new SpatialView(), generation = view.begin(input.sessionId);
  let nextGeneration;
  const calls = mutateDuringCanonical(input, () => { nextGeneration = view.begin(input.sessionId); });
  assert.equal(view.acceptSnapshot(input, generation), 'stale');
  assert.equal(calls(), 1); assert.equal(view.generation, nextGeneration); assert.equal(view.snapshot, null);
  assert.equal(view.acceptSnapshot(spatialSnapshot(), nextGeneration), 'applied');
});

test('SV01-04：原生clone读取时改变归属，最终守卫核实际owned会话和当前代次', async t => {
  for (const changeGeneration of [false, true]) await t.test(changeGeneration ? 'clone中换代次' : 'clone返回别的session', () => {
    const input = spatialSnapshot(), sessionId = input.sessionId;
    const view = new SpatialView(), generation = view.begin(sessionId); let sessionReads = 0;
    input.projection.targets = new Proxy([], {
      get(array, key, receiver) {
        if (key === 'forEach') {
          input.projection.targets = [];
          // 只在raw规范编码及session结构扫描结束后加入输入副作用，不替换任何内建函数。
          Object.defineProperty(input, 'sessionId', {
            enumerable: true, configurable: true,
            get() {
              sessionReads++;
              if (sessionReads === 1) return sessionId;
              if (changeGeneration) { if (sessionReads === 2) view.begin(sessionId); return sessionId; }
              return 'other-room';
            },
          });
        }
        return Reflect.get(array, key, receiver);
      },
    });
    assert.equal(view.acceptSnapshot(input, generation), 'stale');
    assert.ok(sessionReads >= 2); assert.equal(view.snapshot, null); assert.equal(view.syncRequest(), null);
    assert.equal(view.generation, changeGeneration ? generation + 1 : generation);
    assert.equal(view.acceptSnapshot(spatialSnapshot(), view.generation), 'applied');
  });
});

test('SV01-04：重入安装不被外层覆盖，owned非法仍优先invalid且保留重入快照', async t => {
  for (const invalidOwned of [false, true]) await t.test(invalidOwned ? '非法owned' : '合法owned', () => {
    const input = spatialSnapshot(), replacement = spatialSnapshot(); replacement.viewId = 'reentrant-view';
    const view = new SpatialView(), generation = view.begin(input.sessionId); let innerResult, held;
    const calls = mutateDuringCanonical(input, () => {
      if (invalidOwned) input.projection.self.name = '\ud800';
      innerResult = view.acceptSnapshot(replacement, generation); held = view.snapshot;
    });
    assert.equal(view.acceptSnapshot(input, generation), invalidOwned ? 'invalid' : 'stale');
    assert.equal(calls(), 1); assert.equal(innerResult, 'applied');
    assert.equal(view.snapshot, held); assert.equal(view.snapshot.viewId, 'reentrant-view');
    assert.deepEqual(view.snapshot, replacement); assertFrozen(view.snapshot);
  });
});
