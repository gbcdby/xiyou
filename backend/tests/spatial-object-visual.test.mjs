import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createAuthorityServer } from '../server.mjs';
import { gaolaoRoom, accepted, take } from '../test-support/gaolao-room.mjs';
import { until } from '../test-support/ai-room.mjs';
import { validateSpatial } from '../../protocol/spatial.mjs';
import { spatialProjection } from '../../game/spatial-world.mjs';

const combinations = [[], ['spatial-appearance-v1'], ['spatial-object-visual-v1'], ['spatial-appearance-v1', 'spatial-object-visual-v1']].map(extra => ['spatial-v2', ...extra]);
const all = combinations.at(-1), clock = { value: Date.parse('2026-11-13T21:00:00Z') };
let database, server, runtime, origin;
before(async () => {
  database = await startTestPostgres('object-visual', { outputSubdirectory: 'object-visuals' });
  server = await createAuthorityServer({ pool: database.pool, now: () => clock.value }); runtime = server.runtime;
  origin = `http://127.0.0.1:${(await server.listen(0)).port}`;
});
after(async () => { await server?.close(); await database?.stop(); });
const strip = (projection, caps = ['spatial-v2']) => {
  const copy = structuredClone(projection);
  if (!caps.includes('spatial-appearance-v1')) for (const actor of [copy.self, ...copy.entities]) delete actor.appearanceId;
  if (!caps.includes('spatial-object-visual-v1')) for (const object of [...copy.items, ...copy.targets]) delete object.visualKey;
  return copy;
};
function negotiated(projection, caps) {
  assert.equal(Object.hasOwn(projection.self, 'appearanceId'), caps.includes('spatial-appearance-v1'));
  assert.ok(projection.items.some(item => item.name === '公共门撑'), '检查现场确有可见公用工具');
  for (const object of [...projection.items, ...projection.targets]) assert.equal(Object.hasOwn(object, 'visualKey'), caps.includes('spatial-object-visual-v1'));
}
async function roomAtTools() {
  const room = await gaolaoRoom(runtime, clock, 2, 'gaolaozhuang-scene-v2');
  await room.go(0, room.C('C14')); await room.go(1, room.C('C14'));
  await until(() => { const s = server.scenePolicy.status().actors.find(a => a.sessionId === room.sessionId); return s?.phase === 'Idle' && !s.bootstrap && s.pendingSemanticSeq === '0'; }, '场景控制器完成初始投影', 6000);
  return room;
}
async function socketFor(t, token, caps) {
  const socket = io(origin, { autoConnect: false, transports: ['websocket'], reconnection: false, auth: { token, capabilities: caps } });
  t.after(() => socket.disconnect());
  const connected = new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  socket.connect(); await connected;
  return { socket, call: (name, value) => socket.timeout(5000).emitWithAck(name, value) };
}
async function http(room, caps) {
  const response = await fetch(`${origin}/api/sessions/${room.sessionId}`, { headers: { Authorization: `Bearer ${room.users[0].token}`, 'X-Xiyou-Capabilities': caps.join(',') } });
  assert.equal(response.status, 200); const snapshot = await response.json(); validateSpatial('SnapshotV2', snapshot); return snapshot;
}

test('物件协商只增加授权输出，默认内部读取与旧内容不补键', async () => {
  const room = await roomAtTools(), full = await http(room, all);
  assert.equal(full.projection.items.find(item => item.name === '公共门撑').visualKey, 'timber-brace');
  assert.equal(full.projection.items.find(item => item.name === '公共绳索').visualKey, 'hemp-rope');
  assert.equal(full.projection.targets.find(target => target.name === '公共工具借还架').visualKey, 'tool-return-point');
  for (const caps of combinations) {
    const snapshot = await http(room, caps); negotiated(snapshot.projection, caps);
    assert.deepEqual(strip(snapshot.projection), strip(full.projection));
  }
  const internal = await runtime.observeInternal(room.actors.get('cuilan').handle);
  assert.ok(internal.projection.items.length);
  assert.ok([...internal.projection.items, ...internal.projection.targets].every(object => !Object.hasOwn(object, 'visualKey')));
  const old = await gaolaoRoom(runtime, clock, 2);
  await old.go(0, old.C('C14'));
  assert.ok((await http(old, all)).projection.items.every(object => !Object.hasOwn(object, 'visualKey')));
  await take(room, 0, '公共门撑');
  const own = await http(room, all), other = await runtime.snapshot(room.users[1].token, room.sessionId, all);
  const held = own.projection.items.find(item => item.visualKey === 'timber-brace');
  assert.equal(held.location.kind, 'held'); assert.equal(held.location.ownerRef, own.projection.self.entityRef);
  assert.equal(other.projection.items.find(item => item.visualKey === 'timber-brace').location.kind, 'held');
});

test('四能力组合经过真实HTTP/Socket订阅、控制、同步推送、重连与终态', async t => {
  for (const caps of combinations) {
    const room = await roomAtTools(), { socket, call } = await socketFor(t, room.users[0].token, caps);
    negotiated((await http(room, caps)).projection, caps);
    let snapshot = await call('session.subscribe', { sessionId: room.sessionId }); negotiated(snapshot.projection, caps);
    const control = await call('control.take', JSON.stringify({ schemaVersion: 2, type: 'control.take', sessionId: room.sessionId, viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, nonce: crypto.randomUUID() }));
    validateSpatial('ControlResponseV2', control); snapshot = control.snapshot; negotiated(snapshot.projection, caps);
    const pushes = []; socket.on('world.batch', batch => pushes.push(batch));
    accepted(await room.send(1, { kind: 'speak', text: '此处的公用工具仍由各自对象引用。', channel: 'public', recipientRefs: [] }));
    const sync = await call('sync.request', JSON.stringify({ schemaVersion: 2, type: 'sync.request', sessionId: room.sessionId, viewId: snapshot.viewId, cursor: snapshot.snapshotSeq }));
    validateSpatial('BatchV2', sync); assert.ok(sync.events.length); negotiated(sync.events[0].payload.projection, caps);
    await until(() => pushes.some(batch => BigInt(batch.throughSeq) > BigInt(snapshot.snapshotSeq)), '真实世界更新推送', 5000);
    const pushed = pushes.find(batch => BigInt(batch.throughSeq) > BigInt(snapshot.snapshotSeq));
    validateSpatial('BatchV2', pushed); negotiated(pushed.events[0].payload.projection, caps);
    socket.disconnect();
    const fresh = await socketFor(t, room.users[0].token, caps);
    negotiated((await fresh.call('session.subscribe', { sessionId: room.sessionId })).projection, caps);
    await runtime.abortSession(room.sessionId, '物件扩展终态检查');
    const seq = (await runtime.replay(room.sessionId)).sessionSeq;
    const terminal = await fresh.call('session.subscribe', { sessionId: room.sessionId }); negotiated(terminal.projection, caps);
    assert.equal(terminal.projection.self.canControl, false);
    assert.equal((await runtime.replay(room.sessionId)).sessionSeq, seq);
    await runtime.revokeAccess(room.sessionId, room.users[0].userId);
    await assert.rejects(runtime.snapshot(room.users[0].token, room.sessionId, caps), { code: 'FORBIDDEN' });
  }
});

test('历史control nonce按两能力独立裁剪副本，不重写缓存、水位或世界，也不补旧缓存', async t => {
  const room = await roomAtTools(), { call } = await socketFor(t, room.users[0].token, all);
  const start = await call('session.subscribe', { sessionId: room.sessionId }), nonce = crypto.randomUUID();
  const raw = JSON.stringify({ schemaVersion: 2, type: 'control.take', sessionId: room.sessionId, viewId: start.viewId, actorRef: start.projection.self.entityRef, nonce });
  const original = await call('control.take', raw); negotiated(original.snapshot.projection, all);
  const cache = async () => (await database.pool.query('SELECT response,response_text_encoding,semantic_digest FROM command_nonces WHERE session_id=$1 AND nonce=$2', [room.sessionId, nonce])).rows;
  const saved = await cache();
  for (const caps of combinations) {
    const reader = await socketFor(t, room.users[0].token, caps), before = await runtime.replay(room.sessionId);
    const repeated = await reader.call('control.take', raw), expected = structuredClone(original); expected.snapshot.projection = strip(expected.snapshot.projection, caps);
    assert.deepEqual(repeated, expected); negotiated(repeated.snapshot.projection, caps);
    assert.deepEqual(await cache(), saved); assert.deepEqual(await runtime.replay(room.sessionId), before);
  }
  const oldReader = await socketFor(t, room.users[0].token, combinations[0]);
  const oldView = await oldReader.call('session.subscribe', { sessionId: room.sessionId });
  const oldRaw = JSON.stringify({ schemaVersion: 2, type: 'control.take', sessionId: room.sessionId, viewId: oldView.viewId, actorRef: oldView.projection.self.entityRef, nonce: crypto.randomUUID() });
  const oldResult = await oldReader.call('control.take', oldRaw), newReader = await socketFor(t, room.users[0].token, all);
  const replay = await newReader.call('control.take', oldRaw);
  assert.deepEqual(replay, oldResult); negotiated(replay.snapshot.projection, combinations[0]);
});

test('真实远近/墙体与私物许可不扩权：本人持有可见，他人近处持有仍隐藏', async () => {
  const r = await roomAtTools();
  const view = async key => (await runtime.snapshot(r.users[key].token, r.sessionId, all)).projection;
  const equivalent = async key => {
    const full = await view(key), old = (await runtime.snapshot(r.users[key].token, r.sessionId, combinations[0])).projection;
    assert.deepEqual(strip(full), old); return full;
  };
  assert.ok(!(await equivalent(0)).items.some(item => ['cloth-parcel', 'folded-letter', 'farm-rake'].includes(item.visualKey)));
  await r.go(0, r.C('C04'));
  assert.ok(!(await equivalent(0)).items.some(item => ['cloth-parcel', 'folded-letter'].includes(item.visualKey)), '墙外不附门内私物键');
  const ownerPosition = (await r.snapshot('bajie')).projection.self;
  for (const key of [0, 1]) await r.go(key, { sceneId: ownerPosition.sceneId, position: ownerPosition.position });
  const near = await equivalent(0), owner = near.entities.find(entity => entity.name === '猪刚鬣'), item = near.items.find(item => item.visualKey === 'farm-rake');
  assert.ok(owner && item); assert.equal(item.publicBorrowable, false);
  assert.equal((await r.send(0, { kind: 'take_item', itemRef: item.entityRef, expectedItemRevision: item.resourceRevision })).code, 'CONSENT_REQUIRED');
  accepted(await r.interact(0, '猪刚鬣', 'gz-request-private-items', { itemRefs: [item.entityRef], expectedConsentVersion: '0' }));
  for (const key of [0, 1]) await r.go(key, item.location);
  const consent = (await r.snapshot('bajie')).projection.chapter.consents.find(row => row.purpose === 'private_items');
  assert.ok(!(await equivalent(1)).chapter.consents.some(row => row.consentId === consent.consentId));
  accepted(await r.send('bajie', { kind: 'respond_consent', consentId: consent.consentId, expectedConsentVersion: consent.version, response: 'accept' }));
  const outsiderItem = (await equivalent(1)).items.find(row => row.visualKey === 'farm-rake');
  assert.equal((await r.send(1, { kind: 'take_item', itemRef: outsiderItem.entityRef, expectedItemRevision: outsiderItem.resourceRevision })).code, 'CONSENT_REQUIRED');
  await take(r, 0, '私人钉耙');
  const held = (await equivalent(0)).items.find(row => row.visualKey === 'farm-rake');
  assert.equal(held.location.kind, 'held'); assert.equal(held.location.ownerRef, (await view(0)).self.entityRef);
  assert.ok(!(await equivalent(1)).items.some(row => row.visualKey === 'farm-rake'));
  assert.equal((await r.send(1, { kind: 'take_item', itemRef: outsiderItem.entityRef, expectedItemRevision: held.resourceRevision })).code, 'STALE_REFERENCE');
  // 此内容没有消耗工具的合法操作；仅在真实状态副本上核对现有 consumed 过滤，不改权威状态或冒充业务过程。
  const state = structuredClone(await runtime.replay(r.sessionId)), actorId = state.members[0].characterId;
  state.items['gz-rake'].location = { kind: 'consumed' };
  const consumed = spatialProjection(state, r.content, actorId, { includeAppearance: true, includeObjectVisual: true });
  assert.ok(!consumed.items.some(row => row.visualKey === 'farm-rake'));
  assert.equal(JSON.stringify(strip(consumed)), JSON.stringify(spatialProjection(state, r.content, actorId)));
});
