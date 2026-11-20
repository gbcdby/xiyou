import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createRuntime, AuthorityRuntime } from '../runtime.mjs';
import { decodeJsonbText } from '../jsonb-text.mjs';

const directionCaps = ['spatial-v2', 'spatial-direction-v1', 'spatial-scene-overview-v1'];
const caps = [...directionCaps, 'spatial-timed-trail-v1'];
let db, runtime, clock = Date.parse('2026-11-15T00:00:00Z');
before(async () => { db = await startTestPostgres('timed-trail', { outputSubdirectory: 'direction-server' }); runtime = await createRuntime({ pool: db.pool, now: () => clock, spatialDirection: { checkpointMs: 50 } }); });
after(async () => { await runtime?.close(); await db?.stop(); });
test('D66-TIME-01：真实PG原事件区间生成141ms hold和28ms motion，旧reader不输出timing', async () => {
  const users = [await runtime.guest({ name: '计时甲' }), await runtime.guest({ name: '计时乙' })];
  const { sessionId } = await runtime.create(users[0].token, { nonce: crypto.randomUUID(), contentVersion: 'spatial-graybox-v2', capabilities: caps });
  await runtime.join(users[1].token, sessionId, { nonce: 'join', capabilities: caps }); await runtime.start(users[0].token, sessionId, { nonce: 'start' });
  const handles = [];
  for (const user of users) {
    const h = await runtime.openConnection(user.token, caps), s = await runtime.subscribe(h, sessionId);
    await runtime.control(h, JSON.stringify({ schemaVersion: 2, type: 'control.resume', sessionId, viewId: s.viewId, actorRef: s.projection.self.entityRef, nonce: crypto.randomUUID() })); handles.push(h);
  }
  clock += 34; await runtime.maintenance(sessionId);
  const s = await runtime.snapshot(users[0].token, sessionId, caps), from = s.snapshotSeq;
  assert.equal(s.projection.sceneTimeMs, 34); assert.equal(s.projection.movement, null);
  clock += 141;
  const receipt = await runtime.submit(handles[0], JSON.stringify({ schemaVersion: 2, sessionId, viewId: s.viewId, actorRef: s.projection.self.entityRef, clientActionId: crypto.randomUUID(), controlEpoch: s.projection.self.controlEpoch, baseSeq: from,
    action: { kind: 'move_direction', movementCommandSeq: '1', sceneId: s.projection.self.sceneId, mapVersion: s.projection.mapVersion, direction: 'E' } }));
  assert.equal(receipt.status, 'Accepted'); clock += 28; await runtime.spatialCheckpoint(sessionId);
  const sync = h => runtime.sync(h, JSON.stringify({ schemaVersion: 2, type: 'sync.request', sessionId, viewId: s.viewId, cursor: from }));
  const before = (await db.pool.query('SELECT session_seq,state FROM sessions WHERE session_id=$1', [sessionId])).rows[0];
  const value = await sync(handles[0]), p = value.events.at(-1).payload.projection, own = p.entities.find(e => e.entityRef === p.self.entityRef);
  assert.deepEqual(own.motionTimeline.map(x => [x.kind, x.fromSceneTimeMs, x.throughSceneTimeMs]), [['hold', 34, 175], ['motion', 175, 203]]);
  // 灰盒速度为100 px/s；保留其原2.8距离/整数3px，不借用章节180的5px。
  assert.equal(own.motionTrail.at(-1).x - own.motionTrail[0].x, 3);
  assert.deepEqual(p.sceneOverview.entities.find(e => e.entityRef === p.self.entityRef).motionTimeline, own.motionTimeline);
  const events = (await db.pool.query('SELECT event,event_text_encoding FROM world_events WHERE session_id=$1 AND session_seq>$2 ORDER BY session_seq', [sessionId, from])).rows.map(r => decodeJsonbText(r.event, r.event_text_encoding));
  const moved = events.find(e => e.kind === 'spatial.actor' && e.payload.actor.movement?.travelled > 0);
  assert.equal(moved.payload.actor.movement.travelled, 2.8);
  assert.deepEqual((await db.pool.query('SELECT session_seq,state FROM sessions WHERE session_id=$1', [sessionId])).rows[0], before, '生成时间表的读取不得推进权威世界');
  const old = await runtime.openConnection(users[0].token, directionCaps); await runtime.subscribe(old, sessionId);
  const oldp = (await sync(old)).events.at(-1).payload.projection;
  assert.equal(Object.hasOwn(oldp.entities.find(e => e.entityRef === oldp.self.entityRef), 'motionTimeline'), false);
  await assert.rejects(runtime.openConnection(users[0].token, ['spatial-v2', 'spatial-timed-trail-v1']), { code: 'INVALID_MESSAGE' });
  const disabled = new AuthorityRuntime({ pool: db.pool });
  try { await assert.rejects(disabled.openConnection(users[0].token, caps), { code: 'INVALID_MESSAGE' }); }
  finally { await disabled.close(); }
});
