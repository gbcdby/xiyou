import test from 'node:test';
import assert from 'node:assert/strict';
import { MovementCommandSource, parseSpatial, validateSpatial } from '../spatial.mjs';

const direction = { kind: 'move_direction', movementCommandSeq: '1', sceneId: 'yard', mapVersion: 'map-v1', direction: 'S' };

test('方向短段只接受已登记八向、场景和地图版本，不接受客户端位置或速度', () => {
  assert.equal(validateSpatial('SpatialClientCapability', 'spatial-direction-v1'), 'spatial-direction-v1');
  for (const facing of ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']) {
    assert.deepEqual({ ...parseSpatial('ActionV2', JSON.stringify({ ...direction, direction: facing })) }, { ...direction, direction: facing });
  }
  for (const changed of [{ direction: 'south' }, { movementCommandSeq: '0' }, { mapVersion: '' }, { destination: { x: 0, y: 0 } }, { position: { x: 0, y: 0 } }, { speed: 180 }, { lookahead: 36 }, { startedAt: 0 }]) {
    assert.throws(() => validateSpatial('ActionV2', { ...direction, ...changed }));
  }
  for (const field of ['sceneId', 'mapVersion', 'direction']) {
    const missing = { ...direction }; delete missing[field];
    assert.throws(() => validateSpatial('ActionV2', missing));
  }
});

test('绝对目标、方向短段与停止共用发出序号，已发动作不可变', () => {
  const source = new MovementCommandSource('3');
  const absolute = source.move('yard', { x: 10, y: 20 });
  const directed = source.direction('yard', 'map-v1', 'SE');
  const stop = source.stop();
  assert.deepEqual([absolute, directed, stop].map(action => action.movementCommandSeq), ['1', '2', '3']);
  assert.deepEqual(directed, { ...direction, movementCommandSeq: '2', direction: 'SE' });
  const original = JSON.stringify(directed);
  assert.throws(() => { directed.direction = 'N'; });
  assert.equal(JSON.stringify(directed), original);
});
