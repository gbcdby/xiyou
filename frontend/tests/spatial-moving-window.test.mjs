import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ConfirmedMotion } from '../src/domain/spatial-motion.ts';
import { spatialSnapshot } from './spatial-fixture.mjs';

const trace = JSON.parse(await readFile(new URL('./fixtures/motion-moving-window-ci.json', import.meta.url), 'utf8'));
const ref = trace.ref;

function snapshot(entry) {
  const result = spatialSnapshot();
  result.snapshotSeq = entry.snapshotSeq;
  result.viewId = entry.viewId;
  const p = result.projection;
  p.sceneTimeMs = entry.sceneTimeMs;
  p.paused = entry.paused;
  Object.assign(p.self, structuredClone(entry.self));
  p.mapVersion = entry.movement?.mapVersion ?? p.mapVersion;
  p.movement = entry.movement ? structuredClone(entry.movement) : null;
  const person = { ...p.entities[0], ...structuredClone(entry.person) };
  p.entities = [person];
  p.sceneOverview = { entities: [person], items: [], targets: [] };
  return result;
}

/** 按 CI 原件顺序逐条应用快照；paint 只在其对应快照刚应用后采样。 */
function* replay() {
  const motion = new ConfirmedMotion();
  const first = trace.updates[0];
  const baseline = { ...first, snapshotSeq: '46', sceneTimeMs: first.person.motionFromSceneTimeMs, movement: null,
    self: { ...first.self, position: first.person.motionTrail[0], facing: 'S' },
    person: { ...first.person, position: first.person.motionTrail[0], facing: 'S', moving: false,
      motionTrail: undefined, motionFromSceneTimeMs: undefined, motionThroughSceneTimeMs: undefined, motionTimeline: undefined } };
  motion.update(snapshot(baseline), baseline.at);
  for (const entry of trace.updates) {
    motion.update(snapshot(entry), entry.at);
    yield { entry, motion };
  }
}

test('CI 原件回放：真实 paint 使用已确认 motion 段时保持走步，hold 不走步', () => {
  const seen = [];
  for (const { entry, motion } of replay()) {
    for (const paint of trace.paints.filter(row => row.snapshotSeq === entry.snapshotSeq)) {
      const plain = motion.pose(ref, paint.motionAt);
      const painted = motion.pose(ref, paint.motionAt, true);
      assert.ok(painted, '真实绘制必须能取到姿态');
      assert.deepEqual({ position: painted.position, facing: painted.facing, distance: painted.distance },
        { position: plain.position, facing: plain.facing, distance: plain.distance }, 'paint 采样不能改变位置、朝向或累计路程');
      const hasMotion = entry.person.motionTimeline.some(span => span.kind === 'motion');
      assert.equal(painted.moving, hasMotion, `${paint.snapshotSeq} @${paint.motionAt} 的走步必须对应已确认 motion 段`);
      seen.push({ paint, entry, moving: painted.moving });
    }
  }
  assert.equal(seen.length, trace.paints.length, '每个 CI 原件 paint 都必须被回放');
  assert.ok(seen.filter(row => row.moving).length >= 10, 'CI 原件中的真实 paint 至少十次落在已确认 motion 段');

  const frames = [];
  for (let index = 0; index < seen.length - 1; index++) {
    const from = seen[index], to = seen[index + 1];
    for (let at = from.paint.motionAt; at < to.paint.motionAt; at += 16) frames.push({ at, phase: from.entry.phase, moving: from.moving });
  }
  const motionPhases = ['right', 'diagonal', 'down-only'];
  const moving = frames.filter(frame => motionPhases.includes(frame.phase) && frame.moving);
  assert.ok(moving.length >= 10, `连续 paint 保持的走步帧应至少十帧，实际 ${moving.length}`);
  const continuous = frames.filter(frame => frame.at >= moving[0].at && motionPhases.includes(frame.phase));
  assert.ok(continuous.every(frame => frame.moving), '连续短计划之间不插 idle');
});

test('CI 原件 DOWN 阶段：paint 采样仍按权威时间锚定，横向漂移小于 4', () => {
  for (const { entry, motion } of replay()) {
    if (entry.phase !== 'down-only') continue;
    const painted = motion.pose(ref, entry.at, true);
    assert.ok(Math.abs(painted.position.x - entry.self.position.x) < 4, `${entry.snapshotSeq} 的 paint 采样不能回退显示时钟锚定`);
  }
});

test('计划终止后不额外制造走步：cancelled 下 paint 采样与普通采样一致', () => {
  for (const { entry, motion } of replay()) {
    const terminal = snapshot(entry);
    terminal.projection.movement.status = 'cancelled';
    motion.update(terminal, entry.at + 1);
    const plain = motion.pose(ref, entry.at + 1);
    const painted = motion.pose(ref, entry.at + 1, true);
    assert.equal(painted.moving, plain.moving, `${entry.snapshotSeq} 终止计划不能额外输出走步`);
    motion.update(snapshot(entry), entry.at);
  }
});
