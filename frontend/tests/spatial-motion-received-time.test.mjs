import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ConfirmedMotion } from '../src/domain/spatial-motion.ts';
import { spatialSnapshot } from './spatial-fixture.mjs';

const trace = JSON.parse(await readFile(new URL('./fixtures/motion-late-confirmation-ci.json', import.meta.url), 'utf8'));
const mapVersion = trace.updates.find(entry => entry.movement?.mapVersion).movement.mapVersion;

function snapshot(entry) {
  const result = spatialSnapshot(), p = result.projection;
  Object.assign(result, { snapshotSeq: entry.snapshotSeq, viewId: entry.viewId });
  Object.assign(p, { sceneTimeMs: entry.sceneTimeMs, paused: entry.paused, movement: structuredClone(entry.movement) });
  Object.assign(p.self, structuredClone(entry.self));
  const person = { ...p.entities[0], ...structuredClone(entry.person) };
  p.entities = [person]; p.sceneOverview = { entities: [person], items: [], targets: [] };
  p.mapVersion = mapVersion;
  return result;
}

function begin() {
  const first = trace.updates[0], baseline = snapshot(first), motion = new ConfirmedMotion();
  baseline.snapshotSeq = '46'; baseline.projection.sceneTimeMs = first.person.motionFromSceneTimeMs;
  baseline.projection.movement = null;
  for (const person of [baseline.projection.self, ...baseline.projection.entities, ...baseline.projection.sceneOverview.entities]) {
    person.position = { ...first.person.motionTrail[0] };
    delete person.motionTimeline; delete person.motionTrail; delete person.motionFromSceneTimeMs; delete person.motionThroughSceneTimeMs;
  }
  motion.update(baseline, first.at);
  return { motion, ref: baseline.projection.self.entityRef };
}

test('迟到的确认段不能在 update 瞬间回溯消费：同一采样时刻的位置与路程不变', () => {
  const { motion, ref } = begin();
  for (const entry of trace.updates) {
    const before = motion.pose(ref, entry.at);
    motion.update(snapshot(entry), entry.at);
    const after = motion.pose(ref, entry.at);
    assert.deepEqual(after.position, before.position, `seq${entry.snapshotSeq} 的未播段不能因锚点在过去而跳到终点`);
    assert.ok(Math.abs(after.distance - before.distance) < 1e-8, `seq${entry.snapshotSeq} 的累计距离不能跳增`);
  }
});

test('CI 原时间与路线在30/60/120Hz下保留速度、转角和累计路程，迟到不成为加速许可', () => {
  for (const hz of [30, 60, 120]) {
    const { motion, ref } = begin(); let at = trace.updates[0].at, last = motion.pose(ref, at);
    const sample = now => {
      const pose = motion.pose(ref, now, true), delta = Math.hypot(pose.position.x - last.position.x, pose.position.y - last.position.y);
      assert.ok(delta <= 180 * (now - at) / 1000 + 4, `${hz}Hz：${delta} 超过 ${now - at}ms 的原速度门槛`);
      assert.ok(pose.distance + 1e-8 >= last.distance, '累计路程不回退');
      at = now; last = pose;
    };
    for (const entry of trace.updates) {
      for (let next = at + 1000 / hz; next < entry.at; next += 1000 / hz) sample(next);
      sample(entry.at); motion.update(snapshot(entry), entry.at); sample(entry.at);
    }
    const end = trace.updates.at(-1).at + 5000;
    for (let next = at + 1000 / hz; next < end; next += 1000 / hz) sample(next);
    sample(end);
    const distance = trace.updates.reduce((total, entry) => total + entry.person.motionTrail.slice(1).reduce((sum, point, index) => sum
      + Math.hypot(point.x - entry.person.motionTrail[index].x, point.y - entry.person.motionTrail[index].y), 0), 0);
    assert.deepEqual(last.position, trace.updates.at(-1).self.position);
    assert.ok(Math.abs(last.distance - distance) < 1e-8, '所有已确认折线只播放一次，不能为追赶丢段');
    assert.equal(last.moving, false);
  }
});

test('已确认队列耗尽后真实 paint 也必须静止，Accepted/moving 不制造原地走步', () => {
  const { motion, ref } = begin();
  for (const entry of trace.updates.slice(0, 3)) motion.update(snapshot(entry), entry.at);
  const at = trace.updates[2].at + 2000;
  assert.equal(motion.pose(ref, at).moving, false);
  assert.equal(motion.pose(ref, at, true).moving, false);
  assert.equal(motion.hasPendingMotion(ref, at), false);
});
