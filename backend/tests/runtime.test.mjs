import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createRuntime } from '../runtime.mjs';
import { validateContract } from '../../protocol/index.mjs';

let database;
let runtime;
let clock = Date.parse('2026-11-11T10:00:00.000Z');
before(async () => {
  database = await startTestPostgres('runtime');
  runtime = await createRuntime({ pool: database.pool, now: () => clock });
});
after(async () => { await runtime?.close(); await database?.stop(); });

async function room(count = 2) {
  const users = [];
  for (let index = 0; index < count; index++) users.push(await runtime.guest({ name: `玩家${index + 1}` }));
  const { sessionId } = await runtime.create(users[0].token, { nonce: crypto.randomUUID(), contentVersion: 'trust-repair-fixture-v1' });
  const actors = [];
  for (const user of users) actors.push((await runtime.join(user.token, sessionId, { nonce: crypto.randomUUID() })).actorId);
  return { sessionId, users, actors };
}

test('真实 PostgreSQL：创建去重、房主重复加入、固定内容开局和同水位回放', async () => {
  const { sessionId, users, actors } = await room();
  const again = await runtime.join(users[0].token, sessionId, { nonce: crypto.randomUUID() });
  assert.equal(again.actorId, actors[0]);
  await runtime.start(users[0].token, sessionId, { nonce: 'start-1' });
  const snapshot = await runtime.snapshot(users[0].token, sessionId);
  validateContract('AuthorizedSnapshot', snapshot);
  assert.equal(snapshot.projection.phase, 'Running');
  assert.equal(snapshot.projection.self.canControl, false);
  assert.deepEqual(snapshot.projection.self.roles, ['A', 'D']);
  assert.equal(snapshot.projection.self.regionId, 'passage');
  assert.equal(snapshot.projection.characters.length, 4);
  assert.ok(snapshot.projection.observations.some(o => o.source.kind === 'initial_content'));
  const saved = (await database.pool.query('SELECT state, content_snapshot, content_digest FROM sessions WHERE session_id=$1', [sessionId])).rows[0];
  assert.deepEqual(await runtime.replay(sessionId), saved.state);
  assert.equal(saved.content_snapshot.contentVersion, 'trust-repair-fixture-v1');
  assert.match(saved.content_digest, /^[0-9a-f]{64}$/);
  const events = (await database.pool.query('SELECT event FROM world_events WHERE session_id=$1 ORDER BY session_seq', [sessionId])).rows.map(row => row.event);
  events.forEach((event, index) => { validateContract('WorldEvent', event); assert.equal(event.sessionSeq, String(index + 1)); });
  assert.equal(saved.state.sessionSeq, String(events.length));
  assert.equal(saved.state.members.length, 2);
  const second = await runtime.start(users[0].token, sessionId, { nonce: 'start-1' });
  assert.equal(second.sessionId, sessionId);
  assert.equal((await runtime.snapshot(users[0].token, sessionId)).snapshotSeq, snapshot.snapshotSeq);
});

function controlRaw(sessionId, actorId, type = 'control.resume', nonce = crypto.randomUUID()) {
  return JSON.stringify({ schemaVersion: 1, type, sessionId, actorId, nonce });
}

async function running(count = 2) {
  const result = await room(count);
  await runtime.start(result.users[0].token, result.sessionId, { nonce: 'start' });
  result.connections = [];
  result.epochs = [];
  for (let index = 0; index < count; index++) {
    const connection = await runtime.openConnection(result.users[index].token);
    const control = await runtime.control(connection, controlRaw(result.sessionId, result.actors[index]));
    result.connections.push(connection); result.epochs.push(control.controlEpoch);
  }
  result.baseSeq = (await runtime.snapshot(result.users[0].token, result.sessionId)).snapshotSeq;
  return result;
}
function actionRaw(room, index, action, options = {}) {
  return JSON.stringify({ schemaVersion: 1, sessionId: room.sessionId, actorId: room.actors[index], clientActionId: options.id ?? crypto.randomUUID(), controlEpoch: options.epoch ?? room.epochs[index], baseSeq: options.baseSeq ?? room.baseSeq, action });
}

test('真实 PostgreSQL：并发物品版本竞争、持久收据、异载荷和旧游标', async () => {
  const r = await running(3);
  for (const index of [0, 2]) assert.equal((await runtime.submit(r.connections[index], actionRaw(r, index, { kind: 'move', regionId: 'store' }))).status, 'Accepted');
  const raw = actionRaw(r, 1, { kind: 'transfer_item', itemId: 'spare_material', targetId: r.actors[0], expectedItemRevision: '0' }, { id: 'race-a' });
  const competitor = actionRaw(r, 1, { kind: 'transfer_item', itemId: 'spare_material', targetId: r.actors[2], expectedItemRevision: '0' }, { id: 'race-b' });
  const results = await Promise.all([runtime.submit(r.connections[1], raw), runtime.submit(r.connections[1], competitor)]);
  assert.equal(results.filter(result => result.status === 'Accepted').length, 1);
  assert.equal(results.find(result => result.status === 'Rejected').code, 'STALE_PRECONDITION');
  for (const result of results) validateContract('ClientReceipt', result);
  assert.deepEqual(await runtime.submit(r.connections[1], raw), results[0]);
  const conflict = await runtime.submit(r.connections[1], actionRaw(r, 1, { kind: 'wait' }, { id: 'race-a' }));
  assert.equal(conflict.code, 'ACTION_ID_REUSE');
  assert.deepEqual(await runtime.receipt(r.users[1].token, r.sessionId, 'race-a'), results[0]);
  assert.equal(await runtime.receipt(r.users[1].token, r.sessionId, 'unknown-id'), null);
  assert.equal((await runtime.submit(r.connections[0], actionRaw(r, 0, { kind: 'wait' }, { baseSeq: '99999' }))).code, 'FUTURE_BASE_SEQ');
  const state = await runtime.replay(r.sessionId);
  assert.equal(state.items.spare_material.resourceRevision, '1');
  assert.ok([r.actors[0], r.actors[2]].includes(state.items.spare_material.location.characterId));
  assert.deepEqual(state, (await database.pool.query('SELECT state FROM sessions WHERE session_id=$1', [r.sessionId])).rows[0].state);
});

test('真实 PostgreSQL：观察、陈述分型，历史受众和显式证据传播', async () => {
  const r = await running();
  const first = await runtime.snapshot(r.users[0].token, r.sessionId);
  const second = await runtime.snapshot(r.users[1].token, r.sessionId);
  assert.ok(!JSON.stringify(second).includes('structure-before-arrival'));
  const said = await runtime.submit(r.connections[0], actionRaw(r, 0, { kind: 'speak', text: '我说通路已经修好，但这只是陈述。', channel: 'public', recipientIds: [] }));
  assert.equal(said.status, 'Accepted');
  const inspected = await runtime.submit(r.connections[0], actionRaw(r, 0, { kind: 'inspect', targetId: 'passage_structure' }));
  assert.equal(inspected.status, 'Accepted');
  assert.equal((await runtime.replay(r.sessionId)).targets.passage_structure.fields.find(f => f.key === 'safe').value, false);
  await runtime.submit(r.connections[1], actionRaw(r, 1, { kind: 'move', regionId: 'passage' }));
  assert.ok(!(await runtime.snapshot(r.users[1].token, r.sessionId)).projection.claims.some(c => c.text.includes('只是陈述')));
  const evidence = first.projection.observations.find(o => o.category === 'Evidence');
  const shared = await runtime.submit(r.connections[0], actionRaw(r, 0, { kind: 'share_evidence', evidenceId: evidence.observationId, recipientIds: [r.actors[1]] }));
  assert.equal(shared.status, 'Accepted');
  const afterShare = await runtime.snapshot(r.users[1].token, r.sessionId);
  assert.ok(afterShare.projection.observations.some(o => o.source.kind === 'evidence_share' && o.source.sourceIds.includes('structure-before-arrival')));
  assert.ok(!JSON.stringify(afterShare).includes('initial-responsibility'));
  assert.ok(!JSON.stringify(afterShare).includes('humanCharacterIds'));
  const fake = await runtime.submit(r.connections[1], actionRaw(r, 1, { kind: 'share_evidence', evidenceId: 'structure_record', recipientIds: [r.actors[0]] }));
  assert.equal(fake.code, 'TARGET_UNAVAILABLE');
  const hidden = await runtime.submit(r.connections[0], actionRaw(r, 0, { kind: 'take_item', itemId: 'original_material', expectedItemRevision: '0' }));
  const missing = await runtime.submit(r.connections[0], actionRaw(r, 0, { kind: 'take_item', itemId: 'does-not-exist', expectedItemRevision: '0' }));
  assert.equal(hidden.code, 'TARGET_UNAVAILABLE'); assert.equal(missing.code, hidden.code);
});

async function repairAndPermit(r) {
  await runtime.submit(r.connections[1], actionRaw(r, 1, { kind: 'move', regionId: 'passage' }));
  const repair = { kind: 'use_item', itemIds: ['spare_material', 'repair_tool'], expectedItemRevisions: { spare_material: '0', repair_tool: '0' }, targetId: 'passage_structure', expectedTargetRevision: '0', operation: 'repair' };
  const repaired = await runtime.submit(r.connections[1], actionRaw(r, 1, repair));
  assert.equal(repaired.status, 'Accepted');
  const permitted = await runtime.submit(r.connections[1], actionRaw(r, 1, { kind: 'interact', targetId: 'passage_structure', expectedTargetRevision: '1', operation: 'grant_passage' }));
  assert.equal(permitted.status, 'Accepted');
  return repair;
}

test('真实 PostgreSQL：内容驱动修复、工具和材料真实归属、许可前置条件', async () => {
  const r = await running();
  const earlyPermit = await runtime.submit(r.connections[0], actionRaw(r, 0, { kind: 'interact', targetId: 'passage_structure', expectedTargetRevision: '0', operation: 'grant_passage' }));
  assert.equal(earlyPermit.status, 'Rejected');
  const repair = await repairAndPermit(r);
  let state = await runtime.replay(r.sessionId);
  assert.deepEqual(state.items.spare_material.location, { kind: 'consumed' });
  assert.deepEqual(state.items.repair_tool.location, { kind: 'character', characterId: r.actors[1] });
  assert.equal(state.items.spare_material.resourceRevision, '1');
  assert.equal(state.items.repair_tool.resourceRevision, '1');
  assert.equal(state.targets.passage_structure.resourceRevision, '2');
  assert.equal(state.phase, 'Running');
  assert.equal((await runtime.submit(r.connections[1], actionRaw(r, 1, repair))).status, 'Rejected');
  state = await runtime.replay(r.sessionId);
  assert.equal(state.items.spare_material.resourceRevision, '1');
  assert.deepEqual(state, (await database.pool.query('SELECT state FROM sessions WHERE session_id=$1', [r.sessionId])).rows[0].state);
});

async function internalAction(handle, _sessionId, _actorId, action) {
  const decision = await runtime.prepareDecision(handle);
  return runtime.submitIntent(handle, decision.decisionId, JSON.stringify({ decisionId: decision.decisionId, toolCalls: [action] }));
}

test('真实 PostgreSQL：内部 NPC 同一提交入口，最终动作和终局原子化', async () => {
  const r = await running();
  await repairAndPermit(r);
  const monk = await runtime.bindInternal(r.sessionId, 'tangseng', 'core_npc');
  const monkey = await runtime.bindInternal(r.sessionId, 'wukong', 'core_npc');
  assert.equal((await internalAction(monkey, r.sessionId, 'wukong', { kind: 'move', regionId: 'passage' })).status, 'Accepted');
  assert.equal((await internalAction(monk, r.sessionId, 'tangseng', { kind: 'move', regionId: 'destination' })).status, 'Accepted');
  const before = await runtime.replay(r.sessionId);
  const decision = await runtime.prepareDecision(monkey);
  const finalRaw = JSON.stringify({ decisionId: decision.decisionId, toolCalls: [{ kind: 'move', regionId: 'destination' }] });
  const [finished] = await Promise.all([runtime.submitIntent(monkey, decision.decisionId, finalRaw), runtime.submit(r.connections[0], actionRaw(r, 0, { kind: 'wait' }))]);
  assert.equal(finished.status, 'Accepted');
  const state = await runtime.replay(r.sessionId);
  assert.equal(state.phase, 'Finished');
  assert.equal(state.ending.endingCode, 'costly_passage');
  assert.equal(finished.actionEventRange.last, state.sessionSeq);
  assert.equal(finished.observedSeq, state.sessionSeq);
  assert.ok(Object.values(state.characters).every(actor => actor.mode === 'Revoked'));
  const events = (await database.pool.query('SELECT event FROM world_events WHERE session_id=$1 ORDER BY session_seq DESC LIMIT 2', [r.sessionId])).rows.map(row => row.event);
  assert.equal(events[0].kind, 'session.finished'); assert.equal(events[1].kind, 'character.moved');
  assert.deepEqual(events[0].causedBy, events[1].causedBy);
  assert.deepEqual(await runtime.submitIntent(monkey, decision.decisionId, finalRaw), finished);
  const late = await runtime.submit(r.connections[0], actionRaw(r, 0, { kind: 'inspect', targetId: 'passage_structure' }));
  assert.equal(late.code, 'SESSION_NOT_RUNNING'); assert.equal(late.actionEventRange, null);
  assert.equal((await runtime.replay(r.sessionId)).sessionSeq, state.sessionSeq);
});

test('真实 PostgreSQL：截止先于动作/控制，拒绝范围为空且时间不倒退', async () => {
  const r = await running();
  const state = await runtime.replay(r.sessionId);
  clock = Date.parse(state.deadlineAt);
  const result = await runtime.submit(r.connections[0], actionRaw(r, 0, { kind: 'move', regionId: 'store' }));
  assert.equal(result.code, 'SESSION_NOT_RUNNING'); assert.equal(result.actionEventRange, null);
  assert.equal(BigInt(result.observedSeq), BigInt(state.sessionSeq) + 1n);
  const stopped = await runtime.replay(r.sessionId);
  assert.equal(stopped.characters[r.actors[0]].regionId, 'passage');
  const finalView = (await runtime.snapshot(r.users[0].token, r.sessionId)).projection;
  assert.equal(finalView.ending.facts.find(f => f.key === 'safe')?.value, false);
  assert.equal(finalView.objectives[0].status, 'blocked');
  clock -= 1000;
  assert.deepEqual(await runtime.replay(r.sessionId), stopped);
  const next = await runtime.control(r.connections[0], controlRaw(r.sessionId, r.actors[0], 'control.take'));
  assert.equal(next.code, 'FORBIDDEN');
  assert.equal((await runtime.replay(r.sessionId)).sessionSeq, stopped.sessionSeq);
});

test('真实 PostgreSQL：代理看不到私人频道，禁止物品和最终许可，交还后旧意图失效', async () => {
  const r = await running();
  const privateText = '私人记号：不能交给托管代理。';
  assert.equal((await runtime.submit(r.connections[0], actionRaw(r, 0, { kind: 'speak', text: privateText, channel: 'private', recipientIds: [r.actors[1]] }))).status, 'Accepted');
  const proxy = await runtime.bindInternal(r.sessionId, r.actors[1], 'proxy');
  await runtime.disconnect(r.connections[1]); clock += 30_001; await runtime.maintenance(r.sessionId);
  const context = await runtime.observeInternal(proxy);
  assert.ok(!JSON.stringify(context).includes(privateText));
  assert.ok(JSON.stringify(await runtime.snapshot(r.users[1].token, r.sessionId)).includes(privateText));
  assert.equal((await internalAction(proxy, r.sessionId, r.actors[1], { kind: 'transfer_item', itemId: 'spare_material', targetId: r.actors[0], expectedItemRevision: '0' })).code, 'RULE_VIOLATION');
  assert.equal((await internalAction(proxy, r.sessionId, r.actors[1], { kind: 'speak', text: '可以一起核对吗？', channel: 'public', recipientIds: [] })).status, 'Accepted');
  const decision = await runtime.prepareDecision(proxy);
  const oldRaw = JSON.stringify({ decisionId: decision.decisionId, toolCalls: [{ kind: 'inspect', targetId: 'stock_record' }] });
  const human = await runtime.openConnection(r.users[1].token);
  await runtime.control(human, controlRaw(r.sessionId, r.actors[1]));
  assert.equal((await runtime.submitIntent(proxy, decision.decisionId, oldRaw)).code, 'DECISION_STALE');
});

test('真实 PostgreSQL：跨 Session 读写拒绝，当前撤权先于旧收据，归档删除不重做', async () => {
  const a = await running(); const b = await running();
  const original = actionRaw(a, 0, { kind: 'wait' }, { id: 'old-result' });
  const receipt = await runtime.submit(a.connections[0], original);
  const bState = await runtime.replay(b.sessionId);
  await assert.rejects(runtime.snapshot(a.users[0].token, b.sessionId), { code: 'FORBIDDEN' });
  await assert.rejects(runtime.receipt(a.users[0].token, b.sessionId, 'old-result'), { code: 'FORBIDDEN' });
  await assert.rejects(runtime.submit(a.connections[0], actionRaw(b, 0, { kind: 'take_item', itemId: 'original_material', expectedItemRevision: '0' })), { code: 'FORBIDDEN' });
  assert.deepEqual(await runtime.replay(b.sessionId), bState);
  await runtime.revokeAccess(a.sessionId, a.users[0].userId);
  await assert.rejects(runtime.receipt(a.users[0].token, a.sessionId, 'old-result'), { code: 'FORBIDDEN' });
  await assert.rejects(runtime.submit(a.connections[0], original), { code: 'FORBIDDEN' });
  await runtime.abortSession(b.sessionId, '本次检查结束。');
  const beforeArchive = await runtime.submit(b.connections[0], actionRaw(b, 0, { kind: 'wait' }, { id: 'terminal-rejection' }));
  await runtime.archiveSession(b.sessionId);
  assert.deepEqual(await runtime.receipt(b.users[0].token, b.sessionId, 'terminal-rejection'), beforeArchive);
  await runtime.deleteSession(b.sessionId);
  await assert.rejects(runtime.snapshot(b.users[0].token, b.sessionId), { code: 'SESSION_GONE' });
  await assert.rejects(runtime.submit(b.connections[0], actionRaw(b, 0, { kind: 'wait' }, { id: 'terminal-rejection' })), { code: 'SESSION_GONE' });
  assert.equal(receipt.status, 'Accepted');
});

test('真实 PostgreSQL：服务端 view 绑定、隐藏空批次、固定水位投影和旧订阅失效', async () => {
  const r = await running();
  const snapshot = await runtime.subscribe(r.connections[0], r.sessionId);
  const syncRaw = cursor => JSON.stringify({ schemaVersion: 1, type: 'sync.request', sessionId: r.sessionId, viewId: snapshot.viewId, cursor });
  await runtime.submit(r.connections[1], actionRaw(r, 1, { kind: 'speak', text: '只有自己可见的记录。', channel: 'private', recipientIds: [r.actors[1]] }));
  const hidden = await runtime.sync(r.connections[0], syncRaw(snapshot.snapshotSeq));
  validateContract('WorldBatch', hidden);
  assert.deepEqual(hidden.events, []);
  assert.ok(BigInt(hidden.throughSeq) > BigInt(snapshot.snapshotSeq));
  await runtime.submit(r.connections[0], actionRaw(r, 0, { kind: 'move', regionId: 'store' }));
  const visible = await runtime.sync(r.connections[0], syncRaw(hidden.throughSeq));
  assert.equal(visible.events.at(-1).kind, 'projection.replace');
  assert.equal(visible.events.at(-1).payload.projection.self.regionId, 'store');
  assert.ok(!visible.events.at(-1).payload.projection.claims.some(c => c.text === '只有自己可见的记录。'));
  await assert.rejects(runtime.sync(r.connections[1], syncRaw(hidden.throughSeq)), { code: 'RESYNC_REQUIRED' });
  await assert.rejects(runtime.sync(r.connections[0], syncRaw('999999')), { code: 'RESYNC_REQUIRED' });
  const next = await runtime.openConnection(r.users[0].token);
  const readonly = await runtime.subscribe(next, r.sessionId);
  assert.equal(readonly.projection.self.canControl, false);
  await runtime.control(next, controlRaw(r.sessionId, r.actors[0], 'control.take'));
  await assert.rejects(runtime.sync(r.connections[0], syncRaw(visible.throughSeq)), { code: 'RESYNC_REQUIRED' });
  const current = await runtime.sync(next, JSON.stringify({ schemaVersion: 1, type: 'sync.request', sessionId: r.sessionId, viewId: readonly.viewId, cursor: readonly.snapshotSeq }));
  assert.equal(current.events.at(-1).payload.projection.self.canControl, true);
  const deliveries = [];
  await runtime.publishPending(async (connectionId, batch) => { deliveries.push({ connectionId, batch }); });
  assert.ok(deliveries.some(d => d.connectionId === next.connectionId));
  assert.equal((await database.pool.query("SELECT count(*) FROM outbox WHERE status='Pending'")).rows[0].count, '0');
});

test('真实 PostgreSQL：真人与 NPC 同版本抢物，只有一个主体取得唯一物品', async () => {
  const r = await running();
  await runtime.submit(r.connections[0], actionRaw(r, 0, { kind: 'move', regionId: 'side_path' }));
  const monkey = await runtime.bindInternal(r.sessionId, 'wukong', 'core_npc');
  const results = await Promise.all([
    runtime.submit(r.connections[0], actionRaw(r, 0, { kind: 'take_item', itemId: 'original_material', expectedItemRevision: '0' })),
    internalAction(monkey, r.sessionId, 'wukong', { kind: 'take_item', itemId: 'original_material', expectedItemRevision: '0' }),
  ]);
  assert.equal(results.filter(r => r.status === 'Accepted').length, 1);
  assert.equal(results.find(r => r.status === 'Rejected').code, 'STALE_PRECONDITION');
  const state = await runtime.replay(r.sessionId);
  assert.equal(state.items.original_material.resourceRevision, '1');
  assert.ok([r.actors[0], 'wukong'].includes(state.items.original_material.location.characterId));
});

test('真实 PostgreSQL：内部 Decision 原子包、generation、相关版本、超时与 fallback 围栏', async () => {
  const r = await running();
  const monkey = await runtime.bindInternal(r.sessionId, 'wukong', 'core_npc');
  const decision = await runtime.prepareDecision(monkey, { allowedTools: ['move', 'inspect', 'wait'], readEntityIds: ['character:wukong'] });
  validateContract('DecisionRecord', decision);
  const before = await runtime.replay(r.sessionId);
  const invalid = await runtime.submitIntent(monkey, decision.decisionId, JSON.stringify({ decisionId: decision.decisionId, toolCalls: [{ kind: 'move', regionId: 'passage' }, { kind: 'inspect', targetId: 'unavailable' }] }));
  assert.equal(invalid.status, 'Rejected'); assert.equal(invalid.actionEventRange, null);
  assert.deepEqual(await runtime.replay(r.sessionId), before);
  const current = await runtime.prepareDecision(monkey, { allowedTools: ['move', 'wait'] });
  const goodRaw = JSON.stringify({ decisionId: current.decisionId, toolCalls: [{ kind: 'move', regionId: 'passage' }, { kind: 'move', regionId: 'store' }] });
  const accepted = await runtime.submitIntent(monkey, current.decisionId, goodRaw);
  assert.equal(accepted.status, 'Accepted'); assert.deepEqual(await runtime.submitIntent(monkey, current.decisionId, goodRaw), accepted);
  const old = await runtime.prepareDecision(monkey, { allowedTools: ['wait'] });
  const replacement = await runtime.prepareDecision(monkey, { allowedTools: ['wait'] });
  assert.equal((await runtime.submitIntent(monkey, old.decisionId, JSON.stringify({ decisionId: old.decisionId, toolCalls: [{ kind: 'wait' }] }))).code, 'DECISION_STALE');
  await runtime.submit(r.connections[0], actionRaw(r, 0, { kind: 'move', regionId: 'store' }));
  assert.equal((await runtime.submitIntent(monkey, replacement.decisionId, JSON.stringify({ decisionId: replacement.decisionId, toolCalls: [{ kind: 'wait' }] }))).status, 'Accepted');
  const timed = await runtime.prepareDecision(monkey, { allowedTools: ['wait'] });
  clock += 10_001;
  assert.equal((await runtime.submitIntent(monkey, timed.decisionId, JSON.stringify({ decisionId: timed.decisionId, toolCalls: [{ kind: 'wait' }] }))).code, 'DECISION_EXPIRED');
  const fallback = await runtime.submitFallback(monkey, timed.decisionId);
  assert.equal(fallback.status, 'Accepted'); assert.deepEqual(await runtime.submitFallback(monkey, timed.decisionId), fallback);
  const record = (await database.pool.query('SELECT record FROM decisions WHERE session_id=$1 AND decision_id=$2', [r.sessionId, timed.decisionId])).rows[0].record;
  assert.equal(record.status, 'Expired');
  const cancelled = await runtime.prepareDecision(monkey, { allowedTools: ['wait'] });
  await runtime.abortSession(r.sessionId, '检查终局取消。');
  assert.equal((await runtime.submitIntent(monkey, cancelled.decisionId, JSON.stringify({ decisionId: cancelled.decisionId, toolCalls: [{ kind: 'wait' }] }))).code, 'SESSION_NOT_RUNNING');
  assert.equal((await database.pool.query('SELECT record FROM decisions WHERE session_id=$1 AND decision_id=$2', [r.sessionId, cancelled.decisionId])).rows[0].record.status, 'Cancelled');
});

test('真实 PostgreSQL：控制往返、双连接、nonce 重试及迟到旧断开', async () => {
  const { sessionId, users, actors } = await room();
  await runtime.start(users[0].token, sessionId, { nonce: 'start' });
  const first = await runtime.openConnection(users[0].token);
  const second = await runtime.openConnection(users[0].token);
  const initial = await runtime.control(first, controlRaw(sessionId, actors[0]));
  validateContract('ControlResponse', initial);
  assert.equal((await runtime.control(second, controlRaw(sessionId, actors[0]))).code, 'CONTROL_HELD');
  const takeoverRaw = controlRaw(sessionId, actors[0], 'control.take', 'takeover');
  const taken = await runtime.control(second, takeoverRaw);
  assert.ok(BigInt(taken.controlEpoch) > BigInt(initial.controlEpoch));
  await runtime.disconnect(first);
  let state = await runtime.replay(sessionId);
  assert.equal(state.characters[actors[0]].activeConnectionId, second.connectionId);
  const third = await runtime.openConnection(users[0].token);
  assert.deepEqual(await runtime.control(third, takeoverRaw), taken);
  assert.equal((await runtime.replay(sessionId)).characters[actors[0]].activeConnectionId, second.connectionId);
  await runtime.disconnect(second);
  state = await runtime.replay(sessionId);
  assert.equal(state.characters[actors[0]].mode, 'GracePeriod');
  clock += 30_001;
  await runtime.maintenance(sessionId);
  state = await runtime.replay(sessionId);
  assert.equal(state.characters[actors[0]].mode, 'AIProxyControlled');
  const resumed = await runtime.control(third, controlRaw(sessionId, actors[0]));
  assert.equal(resumed.mode, 'HumanControlled');
  assert.ok(BigInt(resumed.controlEpoch) > BigInt(state.characters[actors[0]].controlEpoch));
  assert.equal((await runtime.snapshot(users[0].token, sessionId)).projection.self.canControl, false);
});

test('真实 PostgreSQL：重放旧控制 nonce 不回退服务端当前断开代次', async () => {
  const r = await running();
  const raw = controlRaw(r.sessionId, r.actors[0], 'control.take', 'old-take');
  await runtime.control(r.connections[0], raw);
  const latest = await runtime.control(r.connections[0], controlRaw(r.sessionId, r.actors[0], 'control.take', 'new-take'));
  const replayed = await runtime.control(r.connections[0], raw);
  assert.ok(BigInt(replayed.controlEpoch) < BigInt(latest.controlEpoch));
  await runtime.disconnect(r.connections[0]);
  assert.equal((await runtime.replay(r.sessionId)).characters[r.actors[0]].mode, 'GracePeriod');
});

test('真实 PostgreSQL：受限代理读取旧收据也受当前成员权限约束', async () => {
  const r = await running();
  const proxy = await runtime.bindInternal(r.sessionId, r.actors[0], 'proxy');
  await runtime.disconnect(r.connections[0]); clock += 30_001; await runtime.maintenance(r.sessionId);
  const decision = await runtime.prepareDecision(proxy);
  const raw = JSON.stringify({ decisionId: decision.decisionId, toolCalls: [{ kind: 'wait' }] });
  assert.equal((await runtime.submitIntent(proxy, decision.decisionId, raw)).status, 'Accepted');
  await runtime.revokeAccess(r.sessionId, r.users[0].userId);
  await assert.rejects(runtime.submitIntent(proxy, decision.decisionId, raw), { code: 'FORBIDDEN' });
});

test('真实 PostgreSQL：分页最多 256 全局序号，投影准确对应中间前缀并移除旧可见物品', async () => {
  const r = await running();
  const snapshot = await runtime.subscribe(r.connections[0], r.sessionId);
  await runtime.submit(r.connections[0], actionRaw(r, 0, { kind: 'move', regionId: 'store' }));
  for (let index = 0; index < 130; index++) await runtime.submit(r.connections[1], actionRaw(r, 1, { kind: 'speak', text: `私有记录${index}`, channel: 'private', recipientIds: [r.actors[1]] }));
  await runtime.submit(r.connections[0], actionRaw(r, 0, { kind: 'move', regionId: 'side_path' }));
  const request = cursor => JSON.stringify({ schemaVersion: 1, type: 'sync.request', sessionId: r.sessionId, viewId: snapshot.viewId, cursor });
  const first = await runtime.sync(r.connections[0], request(snapshot.snapshotSeq));
  assert.equal(BigInt(first.throughSeq) - BigInt(first.fromExclusive), 256n);
  assert.equal(first.events.at(-1).payload.projection.self.regionId, 'store');
  assert.ok(first.events.at(-1).payload.projection.items.some(item => item.itemId === 'spare_material'));
  assert.equal((await runtime.replay(r.sessionId, first.throughSeq)).characters[r.actors[0]].regionId, 'store');
  const second = await runtime.sync(r.connections[0], request(first.throughSeq));
  assert.equal(second.events.at(-1).payload.projection.self.regionId, 'side_path');
  assert.ok(!second.events.at(-1).payload.projection.items.some(item => item.itemId === 'spare_material'));
  assert.ok(!JSON.stringify(first).includes('私有记录'));
  assert.ok(!JSON.stringify(second).includes('私有记录'));
});

test('真实 PostgreSQL：Decision 相关版本冲突被拒绝，Belief 不会写入世界事实', async () => {
  const r = await running();
  const monk = await runtime.bindInternal(r.sessionId, 'tangseng', 'core_npc');
  const beliefDecision = await runtime.prepareDecision(monk, { allowedTools: ['wait'] });
  const belief = await runtime.submitIntent(monk, beliefDecision.decisionId, JSON.stringify({ decisionId: beliefDecision.decisionId, toolCalls: [{ kind: 'wait' }], beliefUpdates: [{ beliefId: 'unverified-repair', statement: '我相信通路已经修好了。', confidence: 'confident', basedOnObservationIds: [beliefDecision.observationIds[0]] }] }));
  assert.equal(belief.status, 'Accepted');
  assert.equal((await runtime.replay(r.sessionId)).targets.passage_structure.fields.find(f => f.key === 'safe').value, false);
  const related = await runtime.prepareDecision(monk, { allowedTools: ['wait'], readEntityIds: ['target:passage_structure'] });
  await repairAndPermit(r);
  const stale = await runtime.submitIntent(monk, related.decisionId, JSON.stringify({ decisionId: related.decisionId, toolCalls: [{ kind: 'wait' }] }));
  assert.equal(stale.code, 'DECISION_STALE'); assert.equal(stale.actionEventRange, null);
  const forged = await runtime.prepareDecision(monk, { allowedTools: ['wait'] });
  const bad = await runtime.submitIntent(monk, forged.decisionId, JSON.stringify({ decisionId: forged.decisionId, toolCalls: [{ kind: 'wait' }], beliefUpdates: [{ beliefId: 'forged', statement: '无来源。', confidence: 'confident', basedOnObservationIds: ['invented-observation'] }] }));
  assert.equal(bad.status, 'Rejected');
  assert.ok(!(await runtime.replay(r.sessionId)).beliefs['tangseng:forged']);
});

test('真实 PostgreSQL：提交后响应异常先查询原键，不伪造拒绝或再执行', async () => {
  const r = await running();
  const raw = actionRaw(r, 0, { kind: 'move', regionId: 'store' }, { id: 'ack-fault' });
  const oldHook = runtime.hooks.afterCommit;
  runtime.hooks.afterCommit = ({ command, sessionId }) => { if (command === 'action' && sessionId === r.sessionId) throw new Error('受控响应故障。'); };
  try {
    const receipt = await runtime.submit(r.connections[0], raw);
    assert.equal(receipt.status, 'Accepted');
    assert.deepEqual(await runtime.receipt(r.users[0].token, r.sessionId, 'ack-fault'), receipt);
    assert.equal((await runtime.replay(r.sessionId)).characters[r.actors[0]].resourceRevision, '1');
  } finally { runtime.hooks.afterCommit = oldHook; }
});

test('真实 PostgreSQL：截止和最终动作真实竞争，提交顺序只产生一个终局', async () => {
  for (const first of ['intent', 'maintenance']) {
    const r = await running(); await repairAndPermit(r);
    const monk = await runtime.bindInternal(r.sessionId, 'tangseng', 'core_npc');
    const monkey = await runtime.bindInternal(r.sessionId, 'wukong', 'core_npc');
    await internalAction(monkey, r.sessionId, 'wukong', { kind: 'move', regionId: 'passage' });
    await internalAction(monk, r.sessionId, 'tangseng', { kind: 'move', regionId: 'destination' });
    const before = await runtime.replay(r.sessionId);
    const cutoff = Date.parse(before.deadlineAt);
    clock = cutoff - 2;
    const decision = await runtime.prepareDecision(monkey);
    const raw = JSON.stringify({ decisionId: decision.decisionId, toolCalls: [{ kind: 'move', regionId: 'destination' }] });
    let entered; let release;
    const enteredPromise = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const previous = runtime.hooks.beforeCommit;
    runtime.hooks.beforeCommit = async ({ command, sessionId }) => { if (command === first && sessionId === r.sessionId) { entered(); await gate; } };
    try {
      clock = first === 'intent' ? cutoff - 1 : cutoff;
      const leading = first === 'intent' ? runtime.submitIntent(monkey, decision.decisionId, raw) : runtime.maintenance(r.sessionId);
      await Promise.race([enteredPromise, leading.then(() => { throw new Error('预定事务没有进入竞争屏障。'); })]);
      clock = cutoff;
      const trailing = first === 'intent' ? runtime.maintenance(r.sessionId) : runtime.submitIntent(monkey, decision.decisionId, raw);
      release();
      const pair = await Promise.all([leading, trailing]);
      const receipt = first === 'intent' ? pair[0] : pair[1];
      const state = await runtime.replay(r.sessionId);
      assert.equal(state.ending.endingCode, first === 'intent' ? 'costly_passage' : 'unresolved');
      assert.equal(receipt.status, first === 'intent' ? 'Accepted' : 'Rejected');
      assert.equal(receipt.actionEventRange?.last ?? null, first === 'intent' ? state.sessionSeq : null);
      assert.equal((await database.pool.query("SELECT count(*) FROM world_events WHERE session_id=$1 AND event->>'kind'='session.finished'", [r.sessionId])).rows[0].count, '1');
      assert.ok(Object.values(state.characters).every(c => c.mode === 'Revoked'));
    } finally { release(); runtime.hooks.beforeCommit = previous; }
  }
});

test('真实 PostgreSQL：原材料查证通行与证据未齐通行按真实来源区分', async () => {
  for (const completeEvidence of [false, true]) {
    const r = await running();
    const act = (index, action) => runtime.submit(r.connections[index], actionRaw(r, index, action));
    await act(0, { kind: 'inspect', targetId: 'passage_structure' });
    await act(0, { kind: 'move', regionId: 'side_path' });
    await act(0, { kind: 'inspect', targetId: 'material_cache' });
    assert.equal((await act(0, { kind: 'take_item', itemId: 'original_material', expectedItemRevision: '0' })).status, 'Accepted');
    await act(0, { kind: 'move', regionId: 'passage' });
    await act(1, { kind: 'inspect', targetId: 'stock_record' });
    await act(1, { kind: 'move', regionId: 'passage' });
    await act(1, { kind: 'transfer_item', itemId: 'repair_tool', targetId: r.actors[0], expectedItemRevision: '0' });
    const monk = await runtime.bindInternal(r.sessionId, 'tangseng', 'core_npc');
    const monkey = await runtime.bindInternal(r.sessionId, 'wukong', 'core_npc');
    await internalAction(monkey, r.sessionId, 'wukong', { kind: 'move', regionId: 'passage' });
    for (const index of [0, 1]) {
      const view = await runtime.snapshot(r.users[index].token, r.sessionId);
      for (const observation of view.projection.observations.filter(o => o.category === 'Evidence')) {
        if (!completeEvidence && observation.source.sourceIds.includes('authorized-movement-register')) continue;
        await act(index, { kind: 'share_evidence', evidenceId: observation.observationId, recipientIds: ['tangseng', 'wukong'] });
      }
    }
    assert.equal((await act(0, { kind: 'use_item', itemIds: ['original_material', 'repair_tool'], expectedItemRevisions: { original_material: '1', repair_tool: '1' }, targetId: 'passage_structure', expectedTargetRevision: '0', operation: 'repair' })).status, 'Accepted');
    await act(1, { kind: 'interact', targetId: 'passage_structure', expectedTargetRevision: '1', operation: 'grant_passage' });
    await internalAction(monk, r.sessionId, 'tangseng', { kind: 'move', regionId: 'destination' });
    await internalAction(monkey, r.sessionId, 'wukong', { kind: 'move', regionId: 'destination' });
    const state = await runtime.replay(r.sessionId);
    assert.equal(state.ending.endingCode, completeEvidence ? 'clarified_passage' : 'costly_passage');
    assert.equal(state.items.original_material.location.kind, 'consumed');
    assert.equal(state.items.spare_material.location.kind, 'character');
    assert.equal(state.ending.facts.find(f => f.key === 'spareConsumed').value, false);
    assert.equal(state.ending.facts.find(f => f.key === 'evidenceComplete').value, completeEvidence);
  }
});

test('真实 PostgreSQL：四人和五人的固定角色装配及人数上限', async () => {
  const expected = { 4: [['A'], ['B'], ['C', 'E'], ['D']], 5: [['A'], ['B'], ['C'], ['D'], ['E']] };
  for (const count of [4, 5]) {
    const r = await room(count);
    if (count === 5) {
      const extra = await runtime.guest({ name: '第六位访客' });
      await assert.rejects(runtime.join(extra.token, r.sessionId, { nonce: 'extra' }), { code: 'FORBIDDEN' });
    }
    await runtime.start(r.users[0].token, r.sessionId, { nonce: 'start' });
    for (let index = 0; index < count; index++) {
      const view = await runtime.snapshot(r.users[index].token, r.sessionId);
      assert.deepEqual(view.projection.self.roles, expected[count][index]);
      assert.equal(view.projection.characters.length, count + 2);
    }
  }
});

test('真实 PostgreSQL：Lobby 房主取消幂等，终止后不能重新开局', async () => {
  const r = await room();
  await assert.rejects(runtime.cancel(r.users[1].token, r.sessionId, { nonce: 'cancel' }), { code: 'FORBIDDEN' });
  const first = await runtime.cancel(r.users[0].token, r.sessionId, { nonce: 'cancel' });
  const state = await runtime.replay(r.sessionId);
  assert.equal(state.phase, 'Aborted');
  assert.deepEqual(await runtime.cancel(r.users[0].token, r.sessionId, { nonce: 'cancel' }), first);
  await assert.rejects(runtime.start(r.users[0].token, r.sessionId, { nonce: 'restart' }), { code: 'FORBIDDEN' });
  assert.equal((await runtime.replay(r.sessionId)).sessionSeq, state.sessionSeq);
});
