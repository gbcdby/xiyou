import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSpatial, checkSpatialSchema, spatialSchema } from '../spatial.mjs';

const entity = { entityRef: 'R' + 'a'.repeat(32), name: '翠兰', appearanceEpoch: '2', sceneId: 'yard', position: { x: 10, y: 20 }, facing: 'S' };
test('公开造型合同：新 reader 同时接受旧 DTO 与协商后的造型字段', () => {
  assert.equal(parseSpatial('EntityViewV2', JSON.stringify(entity)).appearanceId, undefined);
  assert.equal(parseSpatial('EntityViewV2', JSON.stringify({ ...entity, appearanceId: 'cuilan' })).appearanceId, 'cuilan');
  const self = { ...entity, controlEpoch: '1', canControl: true, capabilities: [], movementCommandHighWater: '0' };
  assert.equal(parseSpatial('SelfViewV2', JSON.stringify({ ...self, appearanceId: 'neutral' })).appearanceId, 'neutral');
  for (const appearanceId of ['gz-wukong', '孙悟空', '../wukong.png', 'cuilan\n']) assert.throws(() => parseSpatial('EntityViewV2', JSON.stringify({ ...entity, appearanceId })), { code: 'INVALID_MESSAGE' });
  assert.throws(() => parseSpatial('EntityViewV2', JSON.stringify({ ...entity, appearanceId: 'cuilan', actorId: 'secret' })), { code: 'INVALID_MESSAGE' });
});

test('公开造型合同：能力及旧闭集 reader 的边界明确，不把 optional 当双向兼容', () => {
  assert.equal(parseSpatial('SpatialClientCapability', '"spatial-appearance-v1"'), 'spatial-appearance-v1');
  assert.throws(() => parseSpatial('SpatialClientCapability', '"spatial-unknown"'), { code: 'INVALID_MESSAGE' });
  const fields = { ...spatialSchema.$defs.EntityViewV2.properties };
  delete fields.appearanceId;
  const legacyReader = { ...spatialSchema.$defs.EntityViewV2, properties: fields };
  checkSpatialSchema(legacyReader, entity);
  assert.throws(() => checkSpatialSchema(legacyReader, { ...entity, appearanceId: 'cuilan' }), { code: 'INVALID_MESSAGE' });
  for (const name of ['翠兰', '孙悟空（借貌）']) assert.equal(parseSpatial('EntityViewV2', JSON.stringify({ ...entity, name, appearanceId: 'cuilan' })).appearanceId, 'cuilan');
});
