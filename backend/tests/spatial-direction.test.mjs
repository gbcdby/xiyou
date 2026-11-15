import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { AuthorityRuntime, createRuntime } from '../runtime.mjs';
import { decodeJsonbText } from '../jsonb-text.mjs';
import { committedPublisher } from '../spatial-direction-runtime.mjs';

const capabilities = ['spatial-v2', 'spatial-direction-v1', 'spatial-scene-overview-v1'];
let database, runtime, clock = Date.parse('2026-11-15T00:00:00Z');
before(async () => {
  database = await startTestPostgres('direction-authority', { outputSubdirectory: 'direction-server' });
  runtime = await createRuntime({ pool: database.pool, now: () => clock, spatialDirection: { checkpointMs: 50 } });
});
after(async () => { await runtime?.close(); await database?.stop(); });
async function room() {
  const users = [await runtime.guest({ name: '方向玩家甲' }), await runtime.guest({ name: '方向玩家乙' })];
  const { sessionId } = await runtime.create(users[0].token, { nonce: crypto.randomUUID(), contentVersion: 'spatial-graybox-v2', capabilities });
  await runtime.join(users[1].token, sessionId, { nonce: 'join', capabilities });
  await runtime.start(users[0].token, sessionId, { nonce: 'start' });
  const handles = [];
  for (const user of users) {
    const handle = await runtime.openConnection(user.token, capabilities), snapshot = await runtime.subscribe(handle, sessionId);
    await runtime.control(handle, JSON.stringify({ schemaVersion: 2, type: 'control.resume', sessionId, viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, nonce: crypto.randomUUID() }));
    handles.push(handle);
  }
  const snapshot = await runtime.snapshot(users[0].token, sessionId, capabilities);
  assert.equal(snapshot.projection.paused, false);
  await runtime.publishPending();
  return { users, sessionId, handles, snapshot };
}
const request = (r, action) => JSON.stringify({ schemaVersion: 2, sessionId: r.sessionId, viewId: r.snapshot.viewId, actorRef: r.snapshot.projection.self.entityRef, controlEpoch: r.snapshot.projection.self.controlEpoch, baseSeq: r.snapshot.snapshotSeq, clientActionId: crypto.randomUUID(), action });
const direction = (r, seq, facing) => ({ kind: 'move_direction', movementCommandSeq: String(seq), sceneId: r.snapshot.projection.self.sceneId, mapVersion: r.snapshot.projection.mapVersion, direction: facing });
const submit = (r, action) => runtime.submit(r.handles[0], request(r, action));
async function state(r) {
  const row = (await database.pool.query('SELECT state,state_text_encoding FROM sessions WHERE session_id=$1', [r.sessionId])).rows[0];
  return decodeJsonbText(row.state, row.state_text_encoding);
}
const own = s => s.characters[s.members[0].characterId];
const sync = (r, cursor) => runtime.sync(r.handles[0], JSON.stringify({ schemaVersion: 2, type: 'sync.request', sessionId: r.sessionId, viewId: r.snapshot.viewId, cursor }));

test('默认关闭、能力绑定当前连接；旧 move_to/stop_move 继续可用', async () => {
  const r = await room(), disabled = new AuthorityRuntime({ pool: database.pool, now: () => clock });
  assert.equal(disabled.spatialDirection, null);
  assert.throws(() => new AuthorityRuntime({ pool: database.pool, spatialDirection: { checkpointMs: 10 } }), TypeError);
  await assert.rejects(disabled.openConnection(r.users[0].token, capabilities), { code: 'INVALID_MESSAGE' });
  const legacyHandle = await runtime.openConnection(r.users[0].token, ['spatial-v2']);
  await assert.rejects(runtime.submit(legacyHandle, request(r, direction(r, 1, 'S'))), { code: 'INVALID_MESSAGE' });
  assert.equal((await submit(r, { kind: 'move_to', movementCommandSeq: '1', sceneId: 'gray-yard', destination: { x: 180, y: 100 } })).status, 'Accepted');
  assert.equal((await submit(r, { kind: 'stop_move', movementCommandSeq: '2' })).status, 'Accepted');
  assert.equal((await state(r)).characters[(await state(r)).members[0].characterId].movement.status, 'cancelled');
  await disabled.close();
});

test('真实 PG：受理时原点、不插入 stop、领域拒绝水位与原 Receipt 重放', async () => {
  const r = await room();
  const first = await submit(r, { kind: 'move_to', movementCommandSeq: '1', sceneId: 'gray-yard', destination: { x: 220, y: 100 } });
  assert.equal(first.status, 'Accepted');
  clock += 100;
  const raw = request(r, direction(r, 2, 'S')), accepted = await runtime.submit(r.handles[0], raw);
  assert.equal(accepted.status, 'Accepted');
  const turned = own(await state(r));
  assert.ok(turned.position.x > r.snapshot.projection.self.position.x, '必须先结算仍在推进的旧路线');
  assert.equal(turned.movement.goal.x, turned.position.x, '南向目标必须保持受理点的零轴');
  assert.deepEqual(turned.movement.path[0], turned.position);
  assert.ok(Math.hypot(turned.movement.goal.x - turned.position.x, turned.movement.goal.y - turned.position.y) <= 36);
  const events = (await database.pool.query('SELECT event,event_text_encoding FROM world_events WHERE session_id=$1 AND session_seq>$2 AND session_seq<=$3 ORDER BY session_seq', [r.sessionId, first.observedSeq, accepted.observedSeq])).rows.map(row => decodeJsonbText(row.event, row.event_text_encoding));
  assert.ok(!events.some(event => event.kind === 'spatial.actor' && event.payload.actor.movement?.status === 'cancelled'));
  const rejected = await submit(r, { ...direction(r, 4, 'E'), mapVersion: 'stale-map' });
  assert.equal(rejected.code, 'STALE_REFERENCE');
  assert.equal(own(await state(r)).movement.movementCommandSeq, '2');
  assert.equal((await submit(r, direction(r, 3, 'W'))).code, 'STALE_MOVEMENT_COMMAND');
  assert.equal((await submit(r, { kind: 'stop_move', movementCommandSeq: '5' })).status, 'Accepted');
  const stopped = await state(r);
  clock += 100;
  assert.deepEqual(await runtime.submit(r.handles[0], raw), accepted);
  assert.equal((await state(r)).sessionSeq, stopped.sessionSeq, '重放不能重新解释方向或推进新路线');
  assert.deepEqual(await runtime.receipt(r.users[0].token, r.sessionId, JSON.parse(raw).clientActionId), accepted);
  assert.equal((await database.pool.query('SELECT COUNT(*)::int AS count FROM action_receipts WHERE session_id=$1 AND client_action_id=$2', [r.sessionId, JSON.parse(raw).clientActionId])).rows[0].count, 1);
  assert.deepEqual(await runtime.replay(r.sessionId), await state(r));
});

test('真实 PG：游标区间跨计划保留已执行转折，显式旧 cursor 不借用发布游标', async () => {
  const r = await room(), from = r.snapshot.snapshotSeq, origin = r.snapshot.projection.self.position;
  assert.equal((await submit(r, direction(r, 1, 'E'))).status, 'Accepted');
  clock += 50; await runtime.spatialCheckpoint(r.sessionId);
  const cornerState = await state(r), corner = own(cornerState).position;
  assert.equal((await submit(r, direction(r, 2, 'S'))).status, 'Accepted');
  clock += 50; await runtime.spatialCheckpoint(r.sessionId);
  const endState = await state(r), endpoint = own(endState).position;
  await runtime.publishPending();
  const batch = await sync(r, from), projection = batch.events.at(-1).payload.projection;
  const entity = projection.entities.find(entity => entity.entityRef === projection.self.entityRef);
  assert.equal(batch.fromExclusive, from);
  assert.deepEqual(entity.motionTrail, [origin, corner, endpoint]);
  assert.equal(entity.motionFromSceneTimeMs, r.snapshot.projection.sceneTimeMs);
  assert.equal(entity.motionThroughSceneTimeMs, endState.sceneTimeMs);
  assert.notDeepEqual(entity.motionTrail.at(-1), own(endState).movement.goal, '不能把未来短段尾加入已执行轨迹');
  const overview = projection.sceneOverview.entities.find(entity => entity.entityRef === projection.self.entityRef);
  assert.deepEqual(overview.motionTrail, entity.motionTrail);
  const tail = (await sync(r, cornerState.sessionSeq)).events.at(-1).payload.projection;
  assert.deepEqual(tail.entities.find(entity => entity.entityRef === tail.self.entityRef).motionTrail, [corner, endpoint]);
  await submit(r, { kind: 'stop_move', movementCommandSeq: '3' });
  const stopped = await state(r);
  clock += 50;
  assert.equal(await runtime.spatialCheckpoint(r.sessionId), false);
  assert.equal((await state(r)).sessionSeq, stopped.sessionSeq, '没有活动真人移动时不追加高频时钟');
});

test('真实 PG：发布中再次 COMMIT 不丢最后一次唤醒，无需定时兜底', { timeout: 10000 }, async () => {
  const r = await room(), deliveries = [], tasks = new Set();
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; }), released = new Promise(resolve => { release = resolve; });
  let blocked = false;
  runtime.hooks.duringPublish = async () => { if (!blocked) { blocked = true; enter(); await released; } };
  const publisher = committedPublisher({ runtime, deliver: async (connectionId, batch) => deliveries.push({ connectionId, batch }), track: promise => { tasks.add(promise); promise.finally(() => tasks.delete(promise)); } });
  const notify = () => publisher.request();
  runtime.on('commit', notify);
  try {
    assert.equal((await submit(r, direction(r, 1, 'E'))).status, 'Accepted');
    await entered;
    clock += 50;
    await runtime.spatialCheckpoint(r.sessionId);
    const expected = (await state(r)).sessionSeq;
    release();
    const deadline = Date.now() + 3000;
    while (!deliveries.some(item => item.connectionId === r.handles[0].connectionId && BigInt(item.batch.throughSeq) >= BigInt(expected))) {
      assert.ok(Date.now() < deadline, '没有额外 pulse 时也必须发布最后的已提交前缀');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  } finally {
    release(); delete runtime.hooks.duringPublish; runtime.off('commit', notify); publisher.close();
    while (tasks.size) await Promise.allSettled([...tasks]);
  }
});
