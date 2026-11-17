import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ConfirmedMotion } from '../src/domain/spatial-motion.ts';
import { spatialSnapshot, selfRef } from './spatial-fixture.mjs';

const trace = JSON.parse(await readFile(new URL('./fixtures/motion-clock-anchor.json', import.meta.url), 'utf8'));

function snapshot(entry) {
  const snapshot = spatialSnapshot(); snapshot.snapshotSeq = entry.seq;
  const p = snapshot.projection; p.sceneTimeMs = entry.scene;
  Object.assign(p.self, { position: { ...entry.position }, facing: entry.facing });
  p.movement = entry.movementStatus ? { movementId: `plan-${entry.seq}`, sceneId: p.self.sceneId, status: entry.movementStatus,
    path: [entry.position, entry.position] } : null;
  Object.assign(p.entities[0], { position: { ...entry.position }, facing: entry.facing });
  const person = { ...p.entities[0], ...(entry.person ?? {}), position: { ...entry.position }, facing: entry.facing };
  p.sceneOverview = { entities: [person], items: [], targets: [] };
  return snapshot;
}

function replay(updates) {
  const motion = new ConfirmedMotion();
  motion.update(snapshot(trace.baseline), trace.baseline.at);
  for (const entry of updates) motion.update(snapshot(entry), entry.at);
  return motion;
}

test('显示时钟锚定不等于已播放：无呈现证据时保留首批193ms hold与15ms motion', () => {
  const motion = replay(trace.updates.slice(0, 1));
  const at = trace.updates[0].at;
  assert.deepEqual(motion.pose(selfRef, at).position, trace.baseline.position);
  assert.equal(motion.pose(selfRef, at + 192).moving, false);
  assert.equal(motion.pose(selfRef, at + 193 + 7.5).position.x, 951.5);
  assert.equal(motion.settled(selfRef, at + 207), false);
  assert.deepEqual(motion.pose(selfRef, at + 208).position, trace.updates[0].position);
  assert.equal(motion.settled(selfRef, at + 208), true);
  assert.equal(motion.presentationCreditMs, 0, '查询不能补造此前193ms的实际呈现');
});

test('历史DOWN反例按因果顺序回放：不以未来输入或瞬移掩盖150–450ms仍超过4的余段', () => {
  const motion = replay([]); let next = 0;
  const observed = [150, 291, 450].map(offset => {
    const at = trace.phaseDownStart + offset;
    while (next < trace.updates.length && trace.updates[next].at <= at) {
      const entry = trace.updates[next++], before = motion.pose(selfRef, entry.at);
      motion.update(snapshot(entry), entry.at);
      assert.deepEqual(motion.pose(selfRef, entry.at).position, before.position, `${entry.seq}不能吞掉尚未播完的横向余段`);
    }
    const authority = trace.updates[next - 1], pose = motion.pose(selfRef, at);
    assert.equal(authority.position.x, 1111);
    return pose.position.x;
  });
  // 该摘录没有原初始化/呈现账本，不能替代真实浏览器验收。保留其未达标反例，
  // 正式DOWN<4仍由 client-experience-browser.mjs 在真实150–450ms窗口强制检查。
  assert.ok(Math.abs(observed[2] - observed[0]) > 4, '该历史输入不足以证明DOWN门槛，不能改成伪造通过');
  assert.equal(observed[1], 1111); assert.equal(observed[2], 1111);
});

test('权威时钟超前客户端时保留余段原时长，不把新确认区间压成收包后的剩余时间', () => {
  const motion = new ConfirmedMotion();
  const first = spatialSnapshot(); first.projection.self.position = { x: 0, y: 0 }; first.projection.entities[0].position = { x: 0, y: 0 };
  first.projection.sceneTimeMs = 0; first.snapshotSeq = '1'; motion.update(first, 0);
  const second = structuredClone(first); second.snapshotSeq = '2'; second.projection.sceneTimeMs = 100;
  Object.assign(second.projection.self, { position: { x: 60, y: 0 }, facing: 'E' });
  second.projection.movement = { movementId: 'p1', sceneId: second.projection.self.sceneId, status: 'moving', path: [{ x: 0, y: 0 }, { x: 60, y: 0 }] };
  const trail1 = [{ x: 0, y: 0 }, { x: 60, y: 0 }];
  Object.assign(second.projection.entities[0], { position: { x: 60, y: 0 }, facing: 'E', motionTrail: trail1,
    motionFromSceneTimeMs: 0, motionThroughSceneTimeMs: 100,
    motionTimeline: [{ kind: 'motion', fromSceneTimeMs: 0, throughSceneTimeMs: 40, fromTrailIndex: 0, throughTrailIndex: 0 },
      { kind: 'motion', fromSceneTimeMs: 40, throughSceneTimeMs: 100, fromTrailIndex: 0, throughTrailIndex: 1 }] });
  second.projection.sceneOverview = { entities: [{ ...second.projection.entities[0] }], items: [], targets: [] };
  motion.update(second, 20);
  assert.deepEqual(motion.pose(selfRef, 20).position, { x: 0, y: 0 }, '权威100ms不代表在客户端已播100ms');

  const third = structuredClone(second); third.snapshotSeq = '3'; third.projection.sceneTimeMs = 180;
  Object.assign(third.projection.self, { position: { x: 108, y: 0 } });
  third.projection.movement = { movementId: 'p2', sceneId: third.projection.self.sceneId, status: 'moving', path: [{ x: 60, y: 0 }, { x: 108, y: 0 }] };
  const trail2 = [{ x: 60, y: 0 }, { x: 108, y: 0 }];
  Object.assign(third.projection.entities[0], { position: { x: 108, y: 0 }, motionTrail: trail2,
    motionFromSceneTimeMs: 100, motionThroughSceneTimeMs: 180,
    motionTimeline: [{ kind: 'motion', fromSceneTimeMs: 100, throughSceneTimeMs: 180, fromTrailIndex: 0, throughTrailIndex: 1 }] });
  third.projection.sceneOverview = { entities: [{ ...third.projection.entities[0] }], items: [], targets: [] };
  motion.update(third, 30);
  assert.deepEqual(motion.pose(selfRef, 30).position, { x: 0, y: 0 }, '未播40ms零几何motion不能被新段吞掉');
  assert.deepEqual(motion.pose(selfRef, 60).position, { x: 0, y: 0 });
  assert.deepEqual(motion.pose(selfRef, 90).position, { x: 30, y: 0 });
  assert.deepEqual(motion.pose(selfRef, 120).position, { x: 60, y: 0 });
  assert.deepEqual(motion.pose(selfRef, 160).position, { x: 84, y: 0 }, '后段保留完整80ms，无重叠或压缩');
  assert.deepEqual(motion.pose(selfRef, 200).position, { x: 108, y: 0 });
  assert.equal(motion.settled(selfRef, 199), false);
  assert.equal(motion.settled(selfRef, 200), true);
});
