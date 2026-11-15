import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmedSegment, sampleTrail, ConfirmedMotion } from '../src/domain/spatial-motion.ts';
import { spatialSnapshot } from './spatial-fixture.mjs';

test('确认位置间的拐弯保留路径顶点，不沿两端直线穿墙', () => {
  const path = [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }];
  const segment = confirmedSegment(path, { x: 0, y: 5 }, { x: 5, y: 10 });
  assert.deepEqual(segment, [{ x: 0, y: 5 }, { x: 0, y: 10 }, { x: 5, y: 10 }]);
  assert.deepEqual(sampleTrail(segment, 0.5), { x: 0, y: 10 });
  assert.equal(confirmedSegment(path, { x: 5, y: 5 }, { x: 5, y: 10 }), null);
});

test('他人缺少连续可见轨迹、换视图或离开投影时立即回退确认点', () => {
  const motion = new ConfirmedMotion(); const first = spatialSnapshot();
  const person = { entityRef: 'other_00000000000000000000000000000', name: '旅伴乙', appearanceEpoch: '0', sceneId: 'yard', position: { x: 0, y: 0 }, facing: 'E' };
  first.projection.entities.push(person); motion.update(first, 0);
  const second = structuredClone(first); second.projection.sceneTimeMs += 200;
  Object.assign(second.projection.entities[1], { position: { x: 10, y: 10 }, motionTrail: [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }], motionFromSceneTimeMs: 1000, motionThroughSceneTimeMs: 1200 });
  motion.update(second, 200); assert.deepEqual(motion.position(person.entityRef, 300), { x: 0, y: 10 });
  const discontinuity = structuredClone(second); discontinuity.projection.entities = [first.projection.entities[0], { ...person, position: { x: 50, y: 50 } }];
  motion.update(discontinuity, 310); assert.deepEqual(motion.position(person.entityRef, 310), { x: 50, y: 50 });
  const newView = structuredClone(second); newView.viewId = 'another-view'; motion.update(newView, 320);
  assert.deepEqual(motion.position(person.entityRef, 320), { x: 10, y: 10 });
  newView.projection.entities = []; motion.update(newView, 330); assert.equal(motion.position(person.entityRef, 330), null);
});

test('连续短计划播放已确认段，衔接显示余段，不跳点或清空步态', () => {
  const motion = new ConfirmedMotion(), first = spatialSnapshot();
  first.projection.self.position = { x: 0, y: 0 }; first.projection.sceneTimeMs = 0;
  const plan = (id, start, end) => ({ movementId: id, sceneId: 'yard', path: [{ x: start, y: 0 }, { x: end, y: 0 }], status: 'moving' });
  first.projection.movement = plan('first', 0, 100); motion.update(first, 0);
  const second = structuredClone(first); second.projection.sceneTimeMs = 200; second.projection.self.position = { x: 20, y: 0 }; motion.update(second, 200);
  assert.equal(motion.pose(first.projection.self.entityRef, 300).distance, 10);
  const third = structuredClone(second); third.projection.sceneTimeMs = 300; third.projection.self.position = { x: 30, y: 0 }; third.projection.movement = plan('second', 30, 60);
  third.projection.sceneOverview = { items: [], targets: [], entities: [{ ...third.projection.entities[0], position: { x: 30, y: 0 }, resourceRevision: '0', moving: true, motionTrail: [{ x: 20, y: 0 }, { x: 30, y: 0 }], motionFromSceneTimeMs: 200, motionThroughSceneTimeMs: 300 }] };
  motion.update(third, 300);
  const after = motion.pose(first.projection.self.entityRef, 300);
  assert.deepEqual(after.position, { x: 10, y: 0 }); assert.equal(after.moving, true); assert.equal(after.distance, 10);
  assert.equal(motion.pose(first.projection.self.entityRef, 350).distance, 15, '旧余段的100ms与新段的100ms都保留，不压成两倍速度');
  assert.equal(motion.pose(first.projection.self.entityRef, 400).moving, true, '等待下一确认段时保留正在走的姿势，不插idle');
  const stopped = structuredClone(third); stopped.projection.movement.status = 'cancelled'; stopped.projection.sceneOverview.entities[0].moving = false;
  motion.update(stopped, 410); assert.equal(motion.pose(first.projection.self.entityRef, 410).moving, true, '只平顺播完已经确认的余段，不瞬移到停点');
  const idle = motion.pose(first.projection.self.entityRef, 500);
  assert.equal(idle.moving, false); assert.equal(idle.distance, 30); assert.deepEqual(idle.position, { x: 30, y: 0 });
});

function confirmedSnapshot(entry, previous, status = 'moving') {
  const snapshot = spatialSnapshot(), p = snapshot.projection;
  snapshot.snapshotSeq = String(entry.scene + 1); p.sceneTimeMs = entry.scene;
  Object.assign(p.self, { position: { x: entry.x, y: 0 }, facing: 'E', appearanceEpoch: '714320768199457243615' });
  p.movement = { movementId: 'confirmed-plan', sceneId: 'yard', path: [{ x: 0, y: 0 }, { x: 1000, y: 0 }], status };
  p.entities = [{ ...p.entities[0], position: { ...p.self.position }, appearanceEpoch: p.self.appearanceEpoch, facing: 'E' }];
  const person = { ...p.entities[0], resourceRevision: '4356319572419', moving: status === 'moving' };
  if (previous) Object.assign(person, { motionTrail: [{ x: previous.x, y: 0 }, { x: entry.x, y: 0 }], motionFromSceneTimeMs: previous.scene, motionThroughSceneTimeMs: entry.scene });
  p.sceneOverview = { entities: [person], items: [], targets: [] }; return snapshot;
}

const deliveryCases = [
  ['100ms稳态', [{ scene: 0, receive: 0, x: 0 }, { scene: 100, receive: 100, x: 18 }, { scene: 200, receive: 200, x: 36 }]],
  ['200→100ms确认段重叠', [{ scene: 0, receive: 0, x: 0 }, { scene: 200, receive: 200, x: 36 }, { scene: 300, receive: 300, x: 54 }]],
  ['合法到达抖动的余段', [{ scene: 0, receive: 0, x: 0 }, { scene: 200, receive: 300, x: 36 }, { scene: 300, receive: 350, x: 54 }]],
  ['500ms合并确认段', [{ scene: 0, receive: 0, x: 0 }, { scene: 500, receive: 500, x: 90 }]],
];
for (const [name, deliveries] of deliveryCases) test(`${name}在30/60/144Hz均不超过真实180单位每秒、不外推或重置步态`, () => {
  for (const hz of [30, 60, 144]) {
    const motion = new ConfirmedMotion(), first = confirmedSnapshot(deliveries[0]), ref = first.projection.self.entityRef;
    motion.update(first, deliveries[0].receive); let lastAt = deliveries[0].receive, lastPose = motion.pose(ref, lastAt), confirmedX = deliveries[0].x;
    function sample(at) {
      const pose = motion.pose(ref, at), delta = Math.hypot(pose.position.x - lastPose.position.x, pose.position.y - lastPose.position.y);
      assert.ok(delta <= 180 * (at - lastAt) / 1000 + 1e-7, `${name}/${hz}Hz真实播放超速：${delta}单位/${at - lastAt}ms`);
      assert.ok(pose.distance + 1e-7 >= lastPose.distance); assert.ok(pose.position.x <= confirmedX + 1e-7, '不能画到尚未确认的计划点');
      lastAt = at; lastPose = pose;
    }
    for (let i = 1; i < deliveries.length; i++) {
      const entry = deliveries[i], previous = deliveries[i - 1];
      assert.ok((entry.x - previous.x) * 1000 / (entry.scene - previous.scene) <= 180); assert.ok(entry.receive >= entry.scene);
      for (let at = lastAt + 1000 / hz; at < entry.receive; at += 1000 / hz) sample(at);
      sample(entry.receive); motion.update(confirmedSnapshot(entry, previous), entry.receive); confirmedX = entry.x;
      const after = motion.pose(ref, entry.receive); assert.ok(Math.hypot(after.position.x - lastPose.position.x, after.position.y - lastPose.position.y) < 1e-7, '确认更新不能丢旧余段而瞬移');
      assert.ok(Math.abs(after.distance - lastPose.distance) < 1e-7); lastPose = after;
    }
    const end = deliveries.at(-1).receive + deliveries.at(-1).scene + 100;
    for (let at = lastAt + 1000 / hz; at < end; at += 1000 / hz) sample(at);
    sample(end); assert.equal(lastPose.position.x, confirmedX); assert.equal(lastPose.distance, confirmedX); assert.equal(motion.settled(ref, end), true);
  }
});

test('停步仅收尾确认余段，到达后idle；后续同位置投影不重启距离或继续外推', () => {
  const motion = new ConfirmedMotion(), entries = deliveryCases[1][1];
  entries.forEach((entry, index) => motion.update(confirmedSnapshot(entry, entries[index - 1]), entry.receive));
  const ref = spatialSnapshot().projection.self.entityRef, beforeStop = motion.pose(ref, 350);
  const stopped = confirmedSnapshot({ scene: 350, x: 54 }, entries.at(-1), 'cancelled'); motion.update(stopped, 350);
  assert.deepEqual(motion.pose(ref, 350), beforeStop, '服务端停步不能让已确认但未播完的余段瞬移');
  assert.equal(motion.settled(ref, 499), false); assert.equal(motion.settled(ref, 500), true);
  const idle = motion.pose(ref, 500); assert.deepEqual(idle.position, { x: 54, y: 0 }); assert.equal(idle.distance, 54); assert.equal(idle.moving, false);
  const later = structuredClone(stopped); later.projection.sceneTimeMs = 700; motion.update(later, 700);
  assert.deepEqual(motion.pose(ref, 1000), idle); assert.equal(motion.active(1000), false);
});

test('确认路径折返经过旧坐标时仍按已播路程保留余段，不把同坐标误认成终点', () => {
  const motion = new ConfirmedMotion(), entries = [{ scene: 0, receive: 0, x: 0 }, { scene: 200, receive: 200, x: 36 }, { scene: 300, receive: 300, x: 18 }, { scene: 400, receive: 400, x: 0 }];
  const ref = spatialSnapshot().projection.self.entityRef;
  entries.slice(0, 3).forEach((entry, index) => motion.update(confirmedSnapshot(entry, entries[index - 1]), entry.receive));
  const before = motion.pose(ref, 400); assert.deepEqual(before.position, { x: 36, y: 0 });
  motion.update(confirmedSnapshot(entries[3], entries[2], 'arrived'), 400);
  assert.deepEqual(motion.pose(ref, 400).position, before.position, '折返点不得丢失尚未播完的返回路径');
  assert.deepEqual(motion.pose(ref, 450).position, { x: 27, y: 0 });
  assert.deepEqual(motion.pose(ref, 500).position, { x: 18, y: 0 });
  const arrived = motion.pose(ref, 600); assert.deepEqual(arrived.position, { x: 0, y: 0 }); assert.equal(arrived.distance, 72); assert.equal(arrived.moving, false);
});

test('未播完的确认余段在view、控制周期、外观或场景切换时不越界延续', () => {
  for (const change of [
    snapshot => { snapshot.viewId = 'new-view'; },
    snapshot => { snapshot.projection.self.controlEpoch = '3'; },
    snapshot => { snapshot.projection.self.appearanceEpoch = '915637232054768'; },
    snapshot => { snapshot.projection.self.sceneId = 'another-scene'; },
  ]) {
    const motion = new ConfirmedMotion(), entries = deliveryCases[1][1];
    entries.forEach((entry, index) => motion.update(confirmedSnapshot(entry, entries[index - 1]), entry.receive));
    const changed = confirmedSnapshot(entries.at(-1), entries.at(-2)); change(changed); motion.update(changed, 350);
    const ref = changed.projection.self.entityRef, pose = motion.pose(ref, 350);
    assert.deepEqual(pose.position, changed.projection.self.position); assert.equal(pose.moving, false); assert.equal(pose.distance, 0);
    assert.deepEqual(motion.pose(ref, 1000), pose);
  }
});
