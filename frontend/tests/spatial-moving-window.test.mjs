import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ConfirmedMotion } from '../src/domain/spatial-motion.ts';
import { spatialSnapshot } from './spatial-fixture.mjs';

const trace = JSON.parse(await readFile(new URL('./fixtures/motion-moving-window-ci.json', import.meta.url), 'utf8'));
const ref = trace.ref;
const mapVersion = trace.updates.find(entry => entry.movement?.mapVersion).movement.mapVersion;

function snapshot(entry) {
  const result = spatialSnapshot();
  result.snapshotSeq = entry.snapshotSeq;
  result.viewId = entry.viewId;
  const p = result.projection;
  p.sceneTimeMs = entry.sceneTimeMs;
  p.paused = entry.paused;
  Object.assign(p.self, structuredClone(entry.self));
  // 空计划不是地图换代；历史基线与后续快照必须使用原件的同一地图身份。
  p.mapVersion = mapVersion;
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

test('CI 原件回放：paint与普通采样同义，仅真实待播motion走步，hold不走步', () => {
  const seen = [];
  for (const { entry, motion } of replay()) {
    for (const paint of trace.paints.filter(row => row.snapshotSeq === entry.snapshotSeq)) {
      const plain = motion.pose(ref, paint.motionAt);
      const painted = motion.pose(ref, paint.motionAt, true);
      assert.ok(painted, '真实绘制必须能取到姿态');
      assert.deepEqual(painted, plain, 'paint采样不能额外制造位置、朝向、路程或走步');
      if (painted.moving) assert.equal(motion.hasPendingMotion(ref, paint.motionAt), true, '活动计划不能代替真实待播段');
      if (entry === trace.updates[0]) assert.equal(painted.moving, false, '领先hold必须静止');
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

test('CI 原件 DOWN 仍有横向余段：保留未达标反例，不能把收包时刻误当150ms验收点', () => {
  let exposesDebt = false;
  for (const { entry, motion } of replay()) {
    if (entry.phase !== 'down-only') continue;
    const painted = motion.pose(ref, entry.at, true);
    assert.deepEqual(painted, motion.pose(ref, entry.at));
    if (Math.abs(painted.position.x - entry.self.position.x) >= 4) exposesDebt = true;
  }
  // 原件无keydown时刻、初始化和完整呈现账本；此断言记录余段，绝非DOWN验收PASS。
  // 真实150–450ms窗口与<4门槛仍保留在client-experience-browser.mjs。
  assert.equal(exposesDebt, true, '不得以错误地图重基线或瞬移把历史余段隐藏');
});

test('相同地图保留未播段，真实地图身份变化才建立当前授权基线', () => {
  const first = trace.updates[0], next = trace.updates[1];
  const sameIdentity = new ConfirmedMotion(), changedIdentity = new ConfirmedMotion();
  for (const motion of [sameIdentity, changedIdentity]) motion.update(snapshot(first), first.at);
  const before = sameIdentity.pose(ref, next.at);
  sameIdentity.update(snapshot(next), next.at);
  assert.deepEqual(sameIdentity.pose(ref, next.at).position, before.position, '同身份不能直接跳到新权威点');
  const changed = snapshot(next); changed.projection.mapVersion = 'controlled-new-map';
  changedIdentity.update(changed, next.at);
  assert.deepEqual(changedIdentity.pose(ref, next.at).position, next.self.position, '换地图后只建立当前授权基线');
  assert.equal(changedIdentity.pose(ref, next.at).moving, false);
  assert.equal(changedIdentity.pose(ref, next.at).distance, 0);
});

test('计划终止后不额外制造走步：cancelled 下 paint 采样与普通采样一致', () => {
  for (const { entry, motion } of replay()) {
    const terminal = snapshot(entry);
    terminal.projection.movement.status = 'cancelled';
    motion.update(terminal, entry.at + 1);
    const plain = motion.pose(ref, entry.at + 1);
    const painted = motion.pose(ref, entry.at + 1, true);
    assert.equal(painted.moving, plain.moving, `${entry.snapshotSeq} 终止计划不能额外输出走步`);
  }
});
