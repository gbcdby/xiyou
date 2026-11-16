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

test('显示时钟按权威时间锚定：首个时间线快照不把已过去的hold从收包时刻重播', () => {
  const motion = replay(trace.updates.slice(0, 1));
  const pose = motion.pose(selfRef, trace.updates[0].at);
  assert.deepEqual(pose.position, trace.updates[0].position);
  assert.equal(pose.facing, trace.updates[0].facing);
  assert.equal(pose.moving, false);
  assert.equal(motion.settled(selfRef, trace.updates[0].at), true);
  assert.deepEqual({ drawnX: pose.position.x, authorityX: trace.updates[0].position.x }, { drawnX: 953, authorityX: 953 });
});

test('同一锚点贯穿确认时间线：DOWN后150–450ms绘制x与权威x逐点一致', () => {
  const motion = replay(trace.updates);
  const authorityAt = at => [...trace.updates].reverse().find(entry => entry.at <= at);
  const observed = [150, 291, 450].map(offset => {
    const at = trace.phaseDownStart + offset, authority = authorityAt(at), pose = motion.pose(selfRef, at);
    assert.ok(authority, `${at}ms应有对应权威快照`);
    assert.equal(pose.position.x, authority.position.x, `${offset}ms权威x=${authority.position.x}，绘制x=${pose.position.x}`);
    assert.equal(pose.facing, 'S');
    assert.ok(Math.abs(pose.position.x - authority.position.x) < 4);
    return { offset, at, authorityX: authority.position.x, drawnX: pose.position.x };
  });
  assert.deepEqual(observed, [
    { offset: 150, at: trace.phaseDownStart + 150, authorityX: 1111, drawnX: 1111 },
    { offset: 291, at: trace.phaseDownStart + 291, authorityX: 1111, drawnX: 1111 },
    { offset: 450, at: trace.phaseDownStart + 450, authorityX: 1111, drawnX: 1111 },
  ]);
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
  assert.deepEqual(motion.pose(selfRef, 20).position, { x: 60, y: 0 }, '已过去的权威80ms不从收包时刻重播');

  const third = structuredClone(second); third.snapshotSeq = '3'; third.projection.sceneTimeMs = 180;
  Object.assign(third.projection.self, { position: { x: 108, y: 0 } });
  third.projection.movement = { movementId: 'p2', sceneId: third.projection.self.sceneId, status: 'moving', path: [{ x: 60, y: 0 }, { x: 108, y: 0 }] };
  const trail2 = [{ x: 60, y: 0 }, { x: 108, y: 0 }];
  Object.assign(third.projection.entities[0], { position: { x: 108, y: 0 }, motionTrail: trail2,
    motionFromSceneTimeMs: 100, motionThroughSceneTimeMs: 180,
    motionTimeline: [{ kind: 'motion', fromSceneTimeMs: 100, throughSceneTimeMs: 180, fromTrailIndex: 0, throughTrailIndex: 1 }] });
  third.projection.sceneOverview = { entities: [{ ...third.projection.entities[0] }], items: [], targets: [] };
  motion.update(third, 30);
  assert.deepEqual(motion.pose(selfRef, 30).position, { x: 66, y: 0 }, '新段仍按原80ms走，不压缩成收包后的10ms');
  assert.deepEqual(motion.pose(selfRef, 60).position, { x: 84, y: 0 });
  assert.deepEqual(motion.pose(selfRef, 100).position, { x: 108, y: 0 });
  assert.equal(motion.settled(selfRef, 99), false);
  assert.equal(motion.settled(selfRef, 100), true);
});
