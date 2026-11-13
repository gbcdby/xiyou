import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSpatial, checkSpatialSchema, spatialSchema } from '../spatial.mjs';

const ref = 'R' + 'a'.repeat(32);
const item = { entityRef: ref, name: '可见物件', location: { kind: 'ground', sceneId: 'yard', position: { x: 10, y: 20 } }, resourceRevision: '0', transferable: true, publicBorrowable: false, fields: [] };
const target = { entityRef: ref, name: '可见目标', sceneId: 'yard', position: { x: 10, y: 20 }, resourceRevision: '0', availableOperations: [], fields: [] };

test('物件外观合同：缺字段与未知合法key均可读，非法路径/换行/额外字段仍拒绝', () => {
  for (const [kind, value] of [['ItemViewV2', item], ['TargetViewV2', target]]) {
    assert.equal(JSON.stringify(parseSpatial(kind, JSON.stringify(value))), JSON.stringify(value));
    for (const visualKey of ['hemp-rope', 'future-visible-shape', 'constructor', 'a'.repeat(64)]) assert.equal(parseSpatial(kind, JSON.stringify({ ...value, visualKey })).visualKey, visualKey);
    for (const visualKey of ['', 'a'.repeat(65), '../rope.png', 'https://example.test/a', 'hemp-rope\n', 'hemp-rope\r\n', '0rope', '公开绳索', 1, null]) assert.throws(() => parseSpatial(kind, JSON.stringify({ ...value, visualKey })), { code: 'INVALID_MESSAGE' });
    assert.throws(() => parseSpatial(kind, JSON.stringify({ ...value, visualKey: 'hemp-rope', ownerId: 'secret' })), { code: 'INVALID_MESSAGE' });
  }
});

test('物件外观合同：独立能力与旧闭集reader的边界，不把optional当双向兼容', () => {
  assert.equal(parseSpatial('SpatialClientCapability', '"spatial-object-visual-v1"'), 'spatial-object-visual-v1');
  for (const [kind, value] of [['ItemViewV2', item], ['TargetViewV2', target]]) {
    const old = structuredClone(spatialSchema.$defs[kind]); delete old.properties.visualKey;
    checkSpatialSchema(old, value);
    assert.throws(() => checkSpatialSchema(old, { ...value, visualKey: 'hemp-rope' }), { code: 'INVALID_MESSAGE' });
  }
  assert.throws(() => parseSpatial('ActionV2', JSON.stringify({ kind: 'inspect', targetRef: ref, visualKey: 'hemp-rope' })), { code: 'INVALID_MESSAGE' });
});
