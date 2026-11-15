import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createRuntime } from '../runtime.mjs';
import { gaolaoRoom } from '../test-support/gaolao-room.mjs';
import { spatialProjection, canSee, entityRef, obstacleEnabled } from '../../game/spatial-world.mjs';
import { findPath } from '../../game/spatial-geometry.mjs';
import { buildSpatialContext } from '../ai/spatial-context.mjs';
import { validateSpatial } from '../../protocol/spatial.mjs';

const oldCaps = ['spatial-v2', 'spatial-appearance-v1', 'spatial-object-visual-v1', 'gaolao-personal-consent-v1'];
const caps = [...oldCaps, 'spatial-scene-overview-v1'];
let database, runtime;
const clock = { value: Date.parse('2026-11-15T12:00:00Z') };
before(async () => { database = await startTestPostgres('scene-overview', { outputSubdirectory: 'ux-c-20261115' }); runtime = await createRuntime({ pool: database.pool, now: () => clock.value }); });
after(async () => { await runtime?.close(); await database?.stop(); });
const room = () => gaolaoRoom(runtime, clock, 2, 'gaolaozhuang-scene-v3');

test('GZ-UX-AC-01：真人同场公共实体不按距离/遮挡增删，原感知和旧reader保持', async () => {
  const r = await room();
  const state = await runtime.replay(r.sessionId), id = state.members[0].characterId;
  const full = await runtime.snapshot(r.users[0].token, r.sessionId, caps);
  assert.ok(full.projection.sceneOverview, '已协商真人必须获得公开场景概览');
  const p = full.projection, overview = p.sceneOverview, sceneId = state.characters[id].sceneId;
  assert.equal(overview.entities.length, Object.values(state.characters).filter(c => c.sceneId === sceneId && c.position).length);
  assert.equal(overview.items.length, Object.values(state.items).filter(i => i.location.kind === 'ground' && i.location.sceneId === sceneId).length);
  assert.equal(overview.targets.length, Object.values(state.targets).filter(t => t.sceneId === sceneId).length);
  assert.ok(overview.entities.length + overview.targets.length > p.entities.length + p.targets.length, '样本含真正的远处或隔墙实体');
  assert.ok(overview.targets.some(t => t.visualKey === 'timber-door' && t.visualState === 'closed'));
  const old = await runtime.snapshot(r.users[0].token, r.sessionId, oldCaps);
  assert.equal(old.projection.sceneOverview, undefined); assert.equal(old.projection.mapCatalog, undefined);
  const stripped = structuredClone(p); delete stripped.sceneOverview; delete stripped.mapCatalog;
  assert.deepEqual(stripped, old.projection, '新能力不改原感知字段');
  for (const principalKind of ['core_npc', 'proxy', 'scene_role']) {
    const limited = spatialProjection(state, r.content, id, { principalKind, includeSceneOverview: true });
    assert.equal(limited.sceneOverview, undefined); assert.equal(limited.mapCatalog, undefined);
  }
  validateSpatial('SnapshotV2', full);
});

test('GZ-UX-AC-01：概览只投影物理白名单，目录无远场动态，模型不能接收扩展', async () => {
  const r = await room(), state = await runtime.replay(r.sessionId), id = state.members[0].characterId;
  const secret = '仅属于本人且不可公开的测试正文';
  for (const value of [...Object.values(state.items), ...Object.values(state.targets)]) value.fields.push({ key: 'private-body', label: '正文', value: secret });
  const held = state.items['gz-parcel']; held.location = { kind: 'character', characterId: r.content.chapterRules.people.cuilan };
  const p = spatialProjection(state, r.content, id, { includeAppearance: true, includeObjectVisual: true, includeSceneOverview: true });
  assert.ok(p.sceneOverview);
  assert.ok(!p.sceneOverview.items.some(item => item.entityRef === entityRef(state.views[id], held.itemId)));
  const encoded = JSON.stringify(p.sceneOverview);
  for (const forbidden of [secret, 'fields', 'availableOperations', 'characterId', 'actorId', 'ownerRef', 'personalRequests', 'identityKnowledge']) assert.ok(!encoded.includes(forbidden), forbidden);
  assert.equal(p.mapCatalog.length, r.content.scenes.length);
  for (const scene of p.mapCatalog) {
    assert.deepEqual(Object.keys(scene).sort(), ['sceneId', 'name', 'width', 'height', 'unitsPerPixel', 'walkableAreas', 'anchors', 'exits'].sort());
    for (const exit of scene.exits) assert.deepEqual(Object.keys(exit).sort(), ['exitId', 'anchorId', 'destinationSceneId', 'destination'].sort());
  }
  const snapshot = await runtime.snapshot(r.users[0].token, r.sessionId, caps);
  const context = buildSpatialContext(snapshot);
  assert.equal(context.projection.sceneOverview, undefined); assert.equal(context.projection.mapCatalog, undefined);
});

test('R66-STD-002：未知观察者的同貌概览仅按本视图opaque ref排序，旋转视图不继承真身槽位', async () => {
  const r=await room(),state=await runtime.replay(r.sessionId),id=state.members[0].characterId;
  const {wukong,cuilan}=r.content.chapterRules.people, a=state.characters[wukong], b=state.characters[cuilan];
  state.chapter.disguise={actorId:wukong,consentId:'test-consent',consentVersion:'1'};delete state.chapter.identityKnowledge[id];
  a.appearanceName='翠兰';a.sceneId=b.sceneId=state.characters[id].sceneId;a.position={x:1000,y:650};b.position={x:1100,y:650};
  const refs=[state.views[id].bindings[wukong].ref,state.views[id].bindings[cuilan].ref].sort((x,y)=>x.localeCompare(y));
  const order=[];
  for(const rotation of [false,true]){
    const view=structuredClone(state.views[id]);view.viewId=crypto.randomUUID();
    view.bindings[wukong].ref=refs[rotation?1:0];view.bindings[cuilan].ref=refs[rotation?0:1];
    const p=spatialProjection(state,r.content,id,{view,includeAppearance:true,includeSceneOverview:true});
    for(const entries of Object.values(p.sceneOverview)){const actual=entries.map(value=>value.entityRef);assert.deepEqual(actual,[...actual].sort((x,y)=>x.localeCompare(y)));}
    const pair=p.sceneOverview.entities.filter(person=>refs.includes(person.entityRef));assert.deepEqual(pair.map(person=>person.name),['翠兰','翠兰']);
    assert.equal(new Set(pair.map(person=>person.appearanceId)).size,1);order.push(pair.map(person=>person.position.x));
    const reversed={...state,...Object.fromEntries(['characters','items','targets'].map(key=>[key,Object.fromEntries(Object.entries(state[key]).reverse())]))};
    assert.deepEqual(spatialProjection(reversed,r.content,id,{view,includeAppearance:true,includeSceneOverview:true}).sceneOverview,p.sceneOverview,'内容文件插入顺序不能成为身份信道');
  }
  assert.deepEqual(order[0],[1000,1100]);assert.deepEqual(order[1],[1100,1000]);
});

test('R66-REQ-001：公开地图只列玩家导航地标和合法出口，不带私物、乔装或样例锚点', async () => {
  const r=await room(),state=await runtime.replay(r.sessionId),id=state.members[0].characterId;
  const p=spatialProjection(state,r.content,id,{includeSceneOverview:true}), encoded=JSON.stringify(p.mapCatalog);
  for(const word of ['本人包裹','信件','乔装','样例','脚底','确认区','C07','C22','C23','R14'])assert.ok(!encoded.includes(word),word);
  for(const scene of p.mapCatalog){
    const original=r.content.scenes.find(s=>s.sceneId===scene.sceneId);
    assert.ok(scene.anchors.length>0);for(const exit of scene.exits)assert.ok(scene.anchors.some(a=>a.anchorId===exit.anchorId));
    for(const anchor of scene.anchors)assert.deepEqual(anchor.position,original.anchors.find(a=>a.anchorId===anchor.anchorId).position);
  }
  assert.ok(r.content.scenes[0].anchors.some(a=>a.anchorId==='C07'),'世界合同仍保留原锚点，仅公开目录筛选');
});

test('GZ-UX-AC-01：缓存控制响应按重放连接能力裁剪，不修改已存响应', async () => {
  const r = await room(), h = await runtime.openConnection(r.users[0].token, caps), snapshot = await runtime.subscribe(h, r.sessionId);
  const raw = JSON.stringify({ schemaVersion: 2, type: 'control.take', sessionId: r.sessionId, viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, nonce: crypto.randomUUID() });
  const response = await runtime.control(h, raw); assert.ok(response.snapshot.projection.sceneOverview);
  const old = await runtime.openConnection(r.users[0].token, oldCaps); await runtime.subscribe(old, r.sessionId);
  const replay = await runtime.control(old, raw);
  assert.equal(replay.snapshot.projection.sceneOverview, undefined); assert.equal(replay.snapshot.projection.mapCatalog, undefined);
  assert.ok((await runtime.control(h, raw)).snapshot.projection.sceneOverview, '兼容裁剪不能破坏原缓存结果');
});

test('GZ-UX-AC-01：严格DTO拒绝跨场概览、未授权字段和不连续轨迹端点', async () => {
  const r = await room(), snapshot = await runtime.snapshot(r.users[0].token, r.sessionId, caps);
  const far = structuredClone(snapshot); far.projection.sceneOverview.entities[0].sceneId = 'other-scene';
  assert.throws(() => validateSpatial('SnapshotV2', far));
  const secret = structuredClone(snapshot); secret.projection.sceneOverview.entities[0].availableOperations = ['gz-contact'];
  assert.throws(() => validateSpatial('SnapshotV2', secret));
  const invalid = structuredClone(snapshot), person = invalid.projection.sceneOverview.entities[0];
  Object.assign(person, { motionTrail: [{ x: 0, y: 0 }, { x: 1, y: 1 }], motionFromSceneTimeMs: 0, motionThroughSceneTimeMs: 0 });
  assert.throws(() => validateSpatial('SnapshotV2', invalid));
  assert.throws(() => validateSpatial('BatchV2', { schemaVersion: 2, type: 'world.batch', sessionId: far.sessionId, viewId: far.viewId, fromExclusive: '0', throughSeq: far.snapshotSeq, events: [{ sessionSeq: far.snapshotSeq, eventId: 'bad-overview', kind: 'projection.replace', payload: { projection: far.projection } }] }));
});

test('GZ-UX-AC-01/05：远处公开ref只能合法走近，确认轨迹覆盖换计划前的已发生段', async () => {
  const r = await room(), state = await runtime.replay(r.sessionId), id = state.members[0].characterId, self = state.characters[id];
  const scene = r.content.scenes.find(s => s.sceneId === self.sceneId);
  const target = Object.values(state.targets).find(t => t.sceneId === self.sceneId && !canSee(state, r.content, id, t) && findPath(scene, self.position, t.position, obstacleEnabled(state)));
  assert.ok(target, '样本有可合法走近的远处目标');
  const targetRef = entityRef(state.views[id], target.targetId);
  assert.equal((await r.send(0, { kind: 'inspect', targetRef })).status, 'Rejected');
  assert.equal((await r.send(0, { kind: 'move_to', movementCommandSeq: '1', sceneId: self.sceneId, destination: target.position, targetRef })).status, 'Accepted');
  await r.step(100);
  const before = await runtime.snapshot(r.users[0].token, r.sessionId, caps);
  clock.value += 100;
  assert.equal((await r.send(0, { kind: 'move_to', movementCommandSeq: '2', sceneId: self.sceneId, destination: target.position, targetRef })).status, 'Accepted');
  const after = await runtime.snapshot(r.users[0].token, r.sessionId, caps), actor = after.projection.sceneOverview.entities.find(e => e.entityRef === after.projection.self.entityRef);
  assert.ok(actor.motionTrail?.length >= 2);
  assert.deepEqual(actor.motionTrail[0], before.projection.self.position);
  assert.deepEqual(actor.motionTrail.at(-1), after.projection.self.position);
  assert.equal(actor.motionThroughSceneTimeMs, after.projection.sceneTimeMs);
});
