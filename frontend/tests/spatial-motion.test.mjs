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
