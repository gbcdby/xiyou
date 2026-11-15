import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSpatial, validateSpatial, spatialSchema } from '../spatial.mjs';

const batch = (extra = {}) => ({ schemaVersion: 2, type: 'world.batch', sessionId: 'room', viewId: 'view', fromExclusive: '0', throughSeq: '5', events: [], ...extra });

test('D66 v0.3：同步前缀为可选字段，旧包与空包保持有效', () => {
  assert.equal(validateSpatial('BatchV2', batch()).throughSeq, '5');
  const empty = batch({ throughSeq: '0', syncFrontierSeq: '0' });
  assert.equal(JSON.stringify(parseSpatial('BatchV2', JSON.stringify(empty))), JSON.stringify(empty));
  assert.ok(!spatialSchema.$defs.BatchV2.required.includes('syncFrontierSeq'));
});

test('D66 v0.3：前缀允许等于或高于完整Batch末尾', () => {
  for (const syncFrontierSeq of ['5', '600', '9007199254740993']) {
    const value = batch({ syncFrontierSeq });
    assert.deepEqual(validateSpatial('BatchV2', value), value);
  }
});

test('D66 v0.3：前缀必须为规范十进制字符串且不低于throughSeq', () => {
  for (const syncFrontierSeq of ['4', '-1', '01', '1e3', '', 5, null, {}, true])
    assert.throws(() => validateSpatial('BatchV2', batch({ syncFrontierSeq })));
  assert.throws(() => validateSpatial('BatchV2', batch({ fromExclusive: '6', syncFrontierSeq: '10' })));
  assert.throws(() => validateSpatial('BatchV2', batch({ fromExclusive: '9007199254740991', throughSeq: '9007199254740993', syncFrontierSeq: '9007199254740992' })), '不能按Number舍入后接受倒置前缀');
});

test('D66 v0.3：只允许唯一字段，不接受额外分页语义', () => {
  assert.throws(() => validateSpatial('BatchV2', batch({ syncFrontierSeq: '5', hasMore: false })));
  assert.throws(() => validateSpatial('BatchV2', batch({ frontier: '5' })));
});
