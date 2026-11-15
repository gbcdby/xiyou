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
  assert.equal(motion.pose(first.projection.self.entityRef, 350).distance, 20);
  assert.equal(motion.pose(first.projection.self.entityRef, 400).moving, true, '等待下一确认段时保留正在走的姿势，不插idle');
  const stopped = structuredClone(third); stopped.projection.movement.status = 'cancelled'; stopped.projection.sceneOverview.entities[0].moving = false;
  motion.update(stopped, 410); const idle = motion.pose(first.projection.self.entityRef, 410);
  assert.equal(idle.moving, false); assert.equal(idle.distance, 30); assert.deepEqual(idle.position, { x: 30, y: 0 });
});
