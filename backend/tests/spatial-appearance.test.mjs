import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createAuthorityServer } from '../server.mjs';
import { gaolaoRoom, rescue, disguise, accepted } from '../test-support/gaolao-room.mjs';

const caps = ['spatial-v2', 'spatial-appearance-v1'];
const clock = { value: Date.parse('2026-11-12T21:00:00Z') };
let db, server, runtime, origin;
before(async () => {
  db = await startTestPostgres('appearance', { outputSubdirectory: 'a3-ai-runtime' });
  server = await createAuthorityServer({ pool: db.pool, now: () => clock.value });
  runtime = server.runtime;
  origin = `http://127.0.0.1:${(await server.listen(0)).port}`;
});
after(async () => { await server?.close(); await db?.stop(); });

test('外观协商：旧快照无新增字段，新快照按公开造型返回稳定key', async () => {
  const room = await gaolaoRoom(runtime, clock, 5);
  const expected = ['gaocai', 'courtyard-helper', 'carpenter', 'kitchen-helper', 'woodcutter'];
  for (let index = 0; index < room.users.length; index++) {
    const old = await runtime.snapshot(room.users[index].token, room.sessionId, ['spatial-v2']);
    assert.ok(!JSON.stringify(old).includes('appearanceId'));
    const current = await runtime.snapshot(room.users[index].token, room.sessionId, caps);
    assert.equal(current.projection.self.appearanceId, expected[index]);
    assert.ok(current.projection.entities.every(entity => typeof entity.appearanceId === 'string'));
  }
  const guest = await runtime.guest({ name: '未知造型' });
  const lobby = await runtime.create(guest.token, { nonce: crypto.randomUUID(), contentVersion: 'spatial-graybox-v2', capabilities: caps });
  await runtime.join(guest.token, lobby.sessionId, { nonce: crypto.randomUUID(), capabilities: caps });
  assert.equal((await runtime.snapshot(guest.token, lobby.sessionId, caps)).projection.self.appearanceId, 'neutral');
});

test('当前可见外貌：知情与未知观察者同key，同貌不同实体、撤回及重连保持权限', async () => {
  const room = await gaolaoRoom(runtime, clock, 2);
  await rescue(room); await disguise(room); await room.go('cuilan', room.C('C10'));
  const known = await runtime.snapshot(room.users[0].token, room.sessionId, caps);
  const unknown = await runtime.observeInternal(room.actors.get('bajie').handle);
  const lookalikes = unknown.projection.entities.filter(entity => entity.name === '翠兰');
  assert.equal(lookalikes.length, 2);
  assert.ok(lookalikes.every(entity => entity.appearanceId === 'cuilan'));
  assert.notEqual(lookalikes[0].entityRef, lookalikes[1].entityRef);
  assert.equal(known.projection.entities.find(entity => entity.name === '孙悟空（借貌）').appearanceId, 'cuilan');
  const previous = (await runtime.observeInternal(room.actors.get('wukong').handle)).projection.self;
  const consent = (await room.snapshot('cuilan')).projection.chapter.consents.findLast(value => value.purpose === 'appearance');
  accepted(await room.send('cuilan', { kind: 'withdraw_consent', consentId: consent.consentId, expectedConsentVersion: consent.version }));
  const restored = (await runtime.observeInternal(room.actors.get('wukong').handle)).projection.self;
  assert.equal(restored.appearanceId, 'wukong');
  assert.notEqual(restored.appearanceEpoch, previous.appearanceEpoch);
  assert.notEqual(restored.entityRef, previous.entityRef);
  await runtime.abortSession(room.sessionId, '检查终态外观读取');
  const before = await runtime.replay(room.sessionId);
  const newConnection = await runtime.openConnection(room.users[0].token, caps);
  const terminal = await runtime.subscribe(newConnection, room.sessionId);
  assert.equal(terminal.projection.self.appearanceId, 'gaocai');
  assert.equal(terminal.projection.self.canControl, false);
  assert.equal((await runtime.replay(room.sessionId)).sessionSeq, before.sessionSeq);
  await runtime.revokeAccess(room.sessionId, room.users[0].userId);
  await assert.rejects(runtime.snapshot(room.users[0].token, room.sessionId, caps), { code: 'FORBIDDEN' });
});

test('真实HTTP/Socket：协商经过快照、订阅、control、batch与重连出口', async t => {
  const room = await gaolaoRoom(runtime, clock, 2);
  const request = await fetch(`${origin}/api/sessions/${room.sessionId}`, { headers: { Authorization: `Bearer ${room.users[0].token}`, 'X-Xiyou-Capabilities': caps.join(',') } });
  assert.equal(request.status, 200); assert.equal((await request.json()).projection.self.appearanceId, 'gaocai');
  const socket = io(origin, { autoConnect: false, transports: ['websocket'], auth: { token: room.users[0].token, capabilities: caps } });
  t.after(() => socket.disconnect());
  const connected = new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  socket.connect(); await connected;
  const call = (name, value) => socket.timeout(3000).emitWithAck(name, value);
  let snapshot = await call('session.subscribe', { sessionId: room.sessionId });
  assert.equal(snapshot.projection.self.appearanceId, 'gaocai');
  const controlRaw = JSON.stringify({ schemaVersion: 2, type: 'control.take', sessionId: room.sessionId, viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, nonce: crypto.randomUUID() });
  const control = await call('control.take', controlRaw);
  snapshot = control.snapshot;
  assert.equal(snapshot.projection.self.appearanceId, 'gaocai');
  const oldSnapshot = await room.snapshot(1);
  await room.send(1, { kind: 'speak', text: '请在现场看见我的造型。', channel: 'public', recipientRefs: [] });
  const batch = await call('sync.request', JSON.stringify({ schemaVersion: 2, type: 'sync.request', sessionId: room.sessionId, viewId: snapshot.viewId, cursor: snapshot.snapshotSeq }));
  assert.ok(batch.events.length); assert.equal(batch.events[0].payload.projection.self.appearanceId, 'gaocai');
  assert.ok(!JSON.stringify(oldSnapshot).includes('appearanceId'));
  const oldBatch = await runtime.sync(room.handles[1], JSON.stringify({ schemaVersion: 2, type: 'sync.request', sessionId: room.sessionId, viewId: oldSnapshot.viewId, cursor: oldSnapshot.snapshotSeq }));
  assert.ok(oldBatch.events.length); assert.ok(!JSON.stringify(oldBatch).includes('appearanceId'));
  const oldConnection = await runtime.openConnection(room.users[0].token, ['spatial-v2']);
  const seq = (await runtime.replay(room.sessionId)).sessionSeq;
  const historicalControl = await runtime.control(oldConnection, controlRaw);
  assert.ok(!JSON.stringify(historicalControl).includes('appearanceId'));
  assert.equal((await runtime.replay(room.sessionId)).sessionSeq, seq);
});
