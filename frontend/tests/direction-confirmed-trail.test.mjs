import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfirmedMotion } from '../src/domain/spatial-motion.ts';
import { SpatialView } from '../src/domain/spatial-view.ts';
import { spatialSnapshot, spatialBatch, selfRef } from './spatial-fixture.mjs';

test('DIR-CLIENT：按batch游标只消费一次已执行折线，跨计划保转角、不回放未来尾', () => {
  const initial = spatialSnapshot(), view = new SpatialView(), generation = view.begin(initial.sessionId), motion = new ConfirmedMotion();
  assert.equal(view.acceptSnapshot(initial, generation), 'applied'); motion.update(view.snapshot, 0);
  const first = structuredClone(initial), p = first.projection;
  p.sceneTimeMs = 1100; p.self.position = { x: 118, y: 100 }; p.entities[0].position = { ...p.self.position };
  Object.assign(p.entities[0], { motionTrail: [{ x: 100, y: 100 }, { x: 118, y: 100 }], motionFromSceneTimeMs: 1000, motionThroughSceneTimeMs: 1100 });
  p.movement = { movementId: 'move_0000000000000000000000000000001', planVersion: '1', movementCommandSeq: '1', sceneId: 'yard', mapVersion: p.mapVersion, goal: { x: 136, y: 100 }, path: [{ x: 100, y: 100 }, { x: 136, y: 100 }], acceptedAtSceneTime: 1000, status: 'moving' };
  const batch1 = spatialBatch(first, '20');
  assert.equal(view.applyBatch(batch1, generation), 'applied'); motion.update(view.snapshot, 100);
  const before = motion.pose(selfRef, 150); assert.deepEqual(before.position, { x: 109, y: 100 });
  assert.equal(view.applyBatch(batch1, generation), 'duplicate'); assert.equal(view.applyBatch(spatialBatch(initial, '11'), generation), 'duplicate');
  assert.deepEqual(motion.pose(selfRef, 150), before);
  const second = structuredClone(view.snapshot), q = second.projection;
  q.sceneTimeMs = 1150; q.self.position = { x: 118, y: 109 }; q.entities[0].position = { ...q.self.position };
  Object.assign(q.entities[0], { motionTrail: [{ x: 118, y: 100 }, { x: 118, y: 109 }], motionFromSceneTimeMs: 1100, motionThroughSceneTimeMs: 1150 });
  q.movement = { ...p.movement, movementId: 'move_0000000000000000000000000000008', planVersion: '8', movementCommandSeq: '9', goal: { x: 118, y: 136 }, path: [{ x: 118, y: 100 }, { x: 118, y: 136 }], acceptedAtSceneTime: 1100 };
  assert.equal(view.applyBatch(spatialBatch(second, '30'), generation), 'applied'); motion.update(view.snapshot, 160);
  let previous = motion.pose(selfRef, 160);
  for (let at = 170; at <= 270; at += 10) {
    const pose = motion.pose(selfRef, at);
    assert.ok(Math.hypot(pose.position.x - previous.position.x, pose.position.y - previous.position.y) <= 1.8 + 1e-8);
    assert.ok(pose.distance >= previous.distance);
    assert.ok(pose.position.y === 100 || pose.position.x === 118, '不把两个确认端点直连穿过转角');
    previous = pose;
  }
  assert.deepEqual(previous.position, { x: 118, y: 109 }, '只到已确认端点，不能走到旧136x或新136y目标');
  assert.equal(previous.distance, 27);
  assert.equal(view.applyBatch({ ...spatialBatch(second, '31'), fromExclusive: '20' }, generation), 'refetch', '部分重叠不追加显示轨迹');
});
