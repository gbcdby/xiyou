import test from 'node:test';
import assert from 'node:assert/strict';
import { SpatialView } from '../src/domain/spatial-view.ts';
import { spatialSnapshot, spatialBatch } from './spatial-fixture.mjs';

test('空间批次整批校验、连续应用，缺口与倒序不改变授权位置', () => {
  const view = new SpatialView(); const generation = view.begin('spatial-room');
  const initial = spatialSnapshot(); assert.equal(view.acceptSnapshot(initial, generation), 'applied');
  const next = structuredClone(initial.projection); next.self.position = { x: 140, y: 100 };
  const future = spatialBatch(initial, '12', next); future.fromExclusive = '11';
  assert.equal(view.applyBatch(future, generation), 'refetch');
  assert.deepEqual(view.snapshot.projection.self.position, { x: 100, y: 100 });
  assert.equal(view.applyBatch(spatialBatch(initial, '11', next), generation), 'applied');
  assert.equal(view.applyBatch(spatialBatch(initial, '11'), generation), 'duplicate');
  assert.deepEqual(view.snapshot.projection.self.position, { x: 140, y: 100 });
  const invalid = spatialBatch(view.snapshot, '12'); invalid.events[0].payload.projection.self.actorId = '禁止内部身份';
  assert.equal(view.applyBatch(invalid, generation), 'refetch'); assert.equal(view.snapshot.snapshotSeq, '11');
});

test('控制换视图废弃旧批次，隐藏事件空区间与大整数游标保持准确', () => {
  const view = new SpatialView(); const oldGeneration = view.begin('spatial-room');
  const old = spatialSnapshot(); view.acceptSnapshot(old, oldGeneration);
  const generation = view.begin('spatial-room'); const current = spatialSnapshot();
  current.viewId = 'new-view'; current.projection.self.entityRef = 'new_00000000000000000000000000000000'; current.projection.entities[0].entityRef = current.projection.self.entityRef; current.snapshotSeq = '9007199254740993';
  assert.equal(view.acceptSnapshot(old, oldGeneration), 'stale');
  assert.equal(view.acceptSnapshot(current, generation), 'applied');
  assert.equal(view.applyBatch(spatialBatch(old), generation), 'stale');
  const empty = spatialBatch(current, '9007199254740994'); empty.events = [];
  assert.equal(view.applyBatch(empty, generation), 'applied'); assert.equal(view.snapshot.snapshotSeq, '9007199254740994');
  const broken = spatialBatch(view.snapshot, '9007199254740996'); broken.events[0].sessionSeq = '1';
  assert.equal(view.applyBatch(broken, generation), 'refetch');
});
