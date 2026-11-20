import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSpatial, parseSpatial, checkSpatialSchema, spatialSchema } from '../spatial.mjs';
import { spatialAISchema } from '../spatial-ai-schema.mjs';

const P = { x: 10, y: 20 }, Q = { x: 15, y: 20 };
const span = (kind, fromSceneTimeMs, throughSceneTimeMs, fromTrailIndex, throughTrailIndex) => ({ kind, fromSceneTimeMs, throughSceneTimeMs, fromTrailIndex, throughTrailIndex });
const entity = () => ({ entityRef: 'R' + 'a'.repeat(32), name: '旅伴', appearanceEpoch: '0', sceneId: 'yard', position: { ...Q }, facing: 'E', motionTrail: [{ ...P }, { ...Q }], motionFromSceneTimeMs: 34, motionThroughSceneTimeMs: 203,
  motionTimeline: [span('hold', 34, 175, 0, 0), span('motion', 175, 203, 0, 1)] });
function projection() {
  const e = entity(), scene = { sceneId: 'yard', name: '庭院', width: 100, height: 100, unitsPerPixel: 1, walkableAreas: [], obstacles: [], anchors: [], exits: [] };
  return { protocolCapability: 'spatial-v2', chapterVersion: 'gray-v1', mapVersion: 'gray-map-v1', variantId: 'two', contentVersion: 'spatial-graybox-v2', reducerVersion: 'spatial-world-v2', phase: 'Running', sceneTimeMs: 203, paused: false,
    self: { entityRef: e.entityRef, name: e.name, appearanceEpoch: '0', sceneId: 'yard', position: e.position, facing: 'E', controlEpoch: '2', canControl: true, capabilities: [], movementCommandHighWater: '1' },
    entities: [e], items: [], targets: [], scene, movement: null, observations: [], claims: [], cooperations: [], objectives: [], ending: null,
    sceneOverview: { entities: [{ ...structuredClone(e), resourceRevision: '0', moving: true }], items: [], targets: [] },
    mapCatalog: [{ sceneId: 'yard', name: '庭院', width: 100, height: 100, unitsPerPixel: 1, walkableAreas: [], anchors: [], exits: [] }] };
}
const batch = p => ({ schemaVersion: 2, type: 'world.batch', sessionId: 'room', viewId: 'view', fromExclusive: '40', throughSeq: '45', events: [{ sessionSeq: '45', eventId: 'event45', kind: 'projection.replace', payload: { projection: p } }] });

test('D66-TIME-02：领先141ms静止与28ms原移动分开且旧字段保持', () => {
  const e = entity(); assert.equal(validateSpatial('EntityViewV2', e), e);
  assert.equal(parseSpatial('EntityViewV2', JSON.stringify(e)).motionTimeline[1].throughSceneTimeMs, 203);
  assert.equal(validateSpatial('SpatialClientCapability', 'spatial-timed-trail-v1'), 'spatial-timed-trail-v1');
  assert.equal(Object.hasOwn(spatialAISchema.$defs.SpatialModelEntityV2.properties, 'motionTimeline'), false, '真人显示时序不进入模型投影合同');
  const old = { ...e }; delete old.motionTimeline; assert.equal(validateSpatial('EntityViewV2', old), old);
  const properties = { ...spatialSchema.$defs.EntityViewV2.properties }; delete properties.motionTimeline;
  assert.throws(() => checkSpatialSchema({ ...spatialSchema.$defs.EntityViewV2, properties }, e), { code: 'INVALID_MESSAGE' });
});
test('D66-TIME-02：纯[P,P]hold消耗重复边，零场景跨度只允许唯一零hold', () => {
  for (const through of [34, 203]) {
    const e = entity(); e.position = { ...P }; e.motionTrail = [{ ...P }, { ...P }]; e.motionThroughSceneTimeMs = through;
    e.motionTimeline = [span('hold', 34, through, 0, 1)]; assert.equal(validateSpatial('EntityViewV2', e), e);
    const bad = structuredClone(e); bad.motionTimeline[0].kind = 'motion';
    if (through === 34) assert.throws(() => validateSpatial('EntityViewV2', bad));
    else assert.equal(validateSpatial('EntityViewV2', bad), bad, '原零几何运动保持正时长，不猜成静止信用');
  }
});
test('D66-TIME-02：同端点折返保留中间非零边，不得伪装hold', () => {
  const e = entity(); e.position = { ...P }; e.motionTrail = [{ ...P }, { ...Q }, { ...P }]; e.motionTimeline = [span('motion', 34, 203, 0, 2)];
  validateSpatial('EntityViewV2', e); e.motionTimeline[0].kind = 'hold'; assert.throws(() => validateSpatial('EntityViewV2', e));
});
test('D66-TIME-02：拒绝跳边、倒序、越界、时间缺口与非零运动零时长', () => {
  const mutations = [e => e.motionTimeline[1].fromTrailIndex = 1, e => e.motionTimeline[1].throughTrailIndex = 0,
    e => e.motionTimeline[1].throughTrailIndex = 2, e => e.motionTimeline[1].fromSceneTimeMs = 176,
    e => e.motionTimeline[1].throughSceneTimeMs = 202, e => e.motionTimeline[1].throughSceneTimeMs = 175,
    e => e.motionTimeline[0].throughSceneTimeMs = 34, e => e.motionTimeline[0].kind = 'hold-extra',
    e => e.motionTimeline[1].fromTrailIndex = 0.5, e => e.motionTimeline[1].throughSceneTimeMs = Number.MAX_SAFE_INTEGER + 1,
    e => e.motionTimeline[1].clientSpeed = 180, e => e.motionTimeline = [], e => { delete e.motionTrail; }, e => e.position = { x: 20, y: 20 }];
  for (const mutate of mutations) { const e = entity(); mutate(e); assert.throws(() => validateSpatial('EntityViewV2', e), { code: 'INVALID_MESSAGE' }); }
  const zero = entity(); zero.motionThroughSceneTimeMs = 34; zero.motionTimeline = [span('motion', 34, 34, 0, 1)]; assert.throws(() => validateSpatial('EntityViewV2', zero));
});
test('D66-TIME-02：4096段为硬上限，不能隐式截断', () => {
  const e = entity(); e.motionTimeline = Array.from({ length: 4097 }, () => span('hold', 34, 175, 0, 0));
  assert.throws(() => validateSpatial('EntityViewV2', e));
});
test('D66-TIME-02：Batch与Control嵌套执行相同语义校验，本人与全景须镜像', () => {
  const p = projection(); validateSpatial('ProjectionV2', p); validateSpatial('BatchV2', batch(p));
  const snapshot = { schemaVersion: 2, type: 'world.snapshot', sessionId: 'room', viewId: 'view', snapshotSeq: '45', projection: p };
  validateSpatial('ControlResponseV2', { schemaVersion: 2, sessionId: 'room', nonce: 'nonce', controlEpoch: '2', observedSeq: '45', snapshot });
  const invalid = projection(); invalid.entities[0].motionTimeline[1].fromSceneTimeMs = 176;
  assert.throws(() => validateSpatial('BatchV2', batch(invalid)));
  const mismatch = projection(); mismatch.sceneOverview.entities[0].motionTimeline[0].throughSceneTimeMs = 174; mismatch.sceneOverview.entities[0].motionTimeline[1].fromSceneTimeMs = 174;
  assert.throws(() => validateSpatial('ProjectionV2', mismatch));
  const missing = projection(); delete missing.sceneOverview.entities[0].motionTimeline; assert.throws(() => validateSpatial('BatchV2', batch(missing)));
  const future = projection(); future.sceneTimeMs = 202; assert.throws(() => validateSpatial('BatchV2', batch(future)));
});
