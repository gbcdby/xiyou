import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createAIServer } from '../ai-main.mjs';
import { createAuthorityServer } from '../server.mjs';
import { ModelGateway } from '../ai/gateway.mjs';
import { attachSpatialAI } from '../ai/spatial-runtime.mjs';
import { reserveCall, saveOutput } from '../ai/persistence.mjs';
import { decodeStoredOutput } from '../ai/output.mjs';
import { parseSpatialProposedIntent } from '../../protocol/spatial-ai.mjs';
import { spatialIntentSemanticDigestSync } from '../../protocol/spatial-ai-node.mjs';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { gaolaoRoom, accepted } from '../test-support/gaolao-room.mjs';
import { gaolaoNetworkAdapter } from '../test-support/gaolao-network.mjs';
import { deferred, until } from '../test-support/ai-room.mjs';

test('真实HTTP/Socket启动入口：三自治角色共享Gateway完成提交，普通客户端继续操作并完整关闭', async t => {
  const db = await startTestPostgres('spatial-ai-server', { outputSubdirectory: 'a3-ai-runtime' }), clock = { value: Date.parse('2026-11-13T00:00:00Z') };
  let server, network;
  const gateway = new ModelGateway({ provider: { kind: 'controlled', providerId: 'network-spatial', generate({ context }) { return { rawText: JSON.stringify({ schemaVersion: 2, decisionId: context.decision.decisionId, toolCalls: [{ kind: 'wait' }] }) }; } }, modelId: 'controlled-network' });
  t.after(async () => { await network?.close(); await server?.close(); await db.stop(); });
  server = await createAIServer({ pool: db.pool, now: () => clock.value, gateway, maxConcurrent: 2, minIntervalMs: 1, maxCallsPerSession: 3 });
  network = gaolaoNetworkAdapter(server, `http://127.0.0.1:${(await server.listen(0)).port}`);
  const room = await gaolaoRoom(network, clock, 2);
  await until(() => server.ai.status().sessions.find(value => value.sessionId === room.sessionId)?.actors.every(actor => actor.lastReceipt?.status === 'Accepted' && actor.phase === 'Idle'), '正式服务入口必须实际完成三角色决定', 5000);
  accepted(await room.send(0, { kind: 'speak', text: '三名角色在场时真人仍可正常行动。', channel: 'public', recipientRefs: [] }));
  const snapshot = await room.snapshot(1);
  assert.equal(snapshot.projection.phase, 'Running');
  assert.equal((await db.pool.query('SELECT count(DISTINCT actor_id) FROM ai_runs WHERE session_id=$1', [room.sessionId])).rows[0].count, '3');
  assert.equal(gateway.metrics().externalCalls, 0); assert.deepEqual(network.errors, []);
  await network.close(); await server.close();
  assert.equal(gateway.metrics().active, 0); assert.equal(server.ai.status().closed, true);
});

for (const stage of ['settled', 'before-begin', 'after-read', 'settling']) test(`真实服务重启组合（${stage}）：resume与新观察不丢失，普通clock和重复通知不追加调用`, async t => {
  const db = await startTestPostgres('restart-resume-server', { outputSubdirectory: 'runtime-recovery' });
  const clock = { value: Date.parse('2026-11-14T05:00:00Z') }, calls = [], originals = [];
  let initial, server, oldNetwork, network, held = false;
  const entered = deferred(), release = deferred(), readFlow = new AsyncLocalStorage();
  t.after(async () => { release.resolve(); await network?.close(); await oldNetwork?.close(); await server?.close(); await initial?.close(); await db.stop(); });
  initial = await createAuthorityServer({ pool: db.pool, now: () => clock.value });
  oldNetwork = gaolaoNetworkAdapter(initial, `http://127.0.0.1:${(await initial.listen(0)).port}`);
  const room = await gaolaoRoom(oldNetwork, clock, 2);
  for (const key of ['tang', 'wukong', 'bajie']) {
    const handle = room.actors.get(key).handle, prepared = await initial.runtime.prepareDecisionContext(handle);
    assert.equal(prepared.context.projection.paused, false, '旧模型上下文不能作为重启后的暂停依据');
    assert.equal((await reserveCall(initial.runtime, handle, prepared, { providerKind: 'controlled' }, 8)).reserved, true);
    const rawText = JSON.stringify({ schemaVersion: 2, decisionId: prepared.decision.decisionId, toolCalls: [{ kind: 'wait' }] });
    const semanticDigest = spatialIntentSemanticDigestSync(parseSpatialProposedIntent(rawText, prepared.decision.decisionId, prepared.context));
    await saveOutput(initial.runtime, handle, prepared.decision.decisionId, { status: 'Valid', rawText, semanticDigest });
    const receipt = accepted(await initial.runtime.submitIntent(handle, prepared.decision.decisionId, rawText));
    originals.push({ actorId: handle.actorId, name: prepared.context.projection.self.name, decisionId: prepared.decision.decisionId, rawText, semanticDigest, receipt });
  }
  await oldNetwork.close(); await initial.close();
  const gateway = new ModelGateway({ provider: { kind: 'controlled', providerId: 'restart-resume', async generate({ context }) {
    assert.ok(!JSON.stringify(context).includes('spatialPauseBefore'), '提交前态不得进入模型上下文');
    const old = originals.find(value => value.name === context.projection.self.name);
    assert.equal((await db.pool.query('SELECT status FROM ai_runs WHERE session_id=$1 AND decision_id=$2', [room.sessionId, old.decisionId])).rows[0].status, 'Resolved', '新语义调用只能在本人原收据收束后开始');
    calls.push({ name: context.projection.self.name, decisionId: context.decision.decisionId, observationRefs: context.projection.observations.map(observation => observation.observationRef) });
    return { rawText: JSON.stringify({ schemaVersion: 2, decisionId: context.decision.decisionId, toolCalls: [{ kind: 'wait' }] }) };
  } }, modelId: 'controlled-restart-resume' });
  const pool = { query: (...args) => db.pool.query(...args), connect: async () => {
    const client = await db.pool.connect();
    if (stage === 'before-begin' && readFlow.getStore() && !held) { held = true; entered.resolve(); await release.promise; }
    return client;
  } };
  const hooks = { async afterCommit({ command }) {
    const target = stage === 'after-read' ? 'recover-decisions' : stage === 'settling' ? 'internal-decision-receipt' : null;
    if (target && command === target && readFlow.getStore() && !held) { held = true; entered.resolve(); await release.promise; }
  } };
  const authority = await createAuthorityServer({ pool, now: () => clock.value, hooks });
  const method = stage === 'settling' ? 'decisionReceipt' : 'recoverDecisions', actual = authority.runtime[method].bind(authority.runtime);
  let first = true;
  authority.runtime[method] = (handle, ...args) => {
    if (stage !== 'settled' && first && handle.actorId === room.content.chapterRules.people.tang) { first = false; return readFlow.run(true, () => actual(handle, ...args)); }
    return actual(handle, ...args);
  };
  const ai = await attachSpatialAI({ runtime: authority.runtime, gateway, maxConcurrent: 2, minIntervalMs: 10, maxCallsPerSession: 8 });
  server = { ...authority, ai, async close() { await ai.close(); await authority.close(); } };
  network = gaolaoNetworkAdapter(server, `http://127.0.0.1:${(await server.listen(0)).port}`);
  const current = () => server.ai.status().sessions.find(value => value.sessionId === room.sessionId);
  if (stage !== 'settled') await entered.promise;
  else await until(() => current()?.actors.length === 3 && current().actors.every(actor => actor.phase === 'Idle' && actor.lastReceipt?.status === 'Accepted'), '重启先恢复三名角色原收据');
  assert.equal((await server.runtime.replay(room.sessionId)).paused, true);
  assert.equal(calls.length, 0);
  if (stage === 'settled') for (const old of originals) assert.deepEqual(current().actors.find(actor => actor.actorId === old.actorId).lastReceipt, old.receipt);
  const clocks = [], notices = [];
  server.runtime.on('commit', notice => {
    if (notice.sessionId !== room.sessionId) return;
    notices.push(structuredClone(notice));
    assert.ok(notice.events.every(event => !Object.hasOwn(event, 'spatialPauseBefore')), '提交前态不得混入WorldEvent');
    for (const event of notice.events) if (event.kind === 'spatial.clock') clocks.push(event.payload.paused);
  });
  const reconnect = async index => {
    const socket = await network.openConnection(room.users[index].token, ['spatial-v2']), snapshot = await network.subscribe(socket, room.sessionId);
    const response = await network.control(socket, JSON.stringify({ schemaVersion: 2, type: 'control.resume', sessionId: room.sessionId, viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, nonce: crypto.randomUUID() }));
    assert.ok(response.snapshot); return socket;
  };
  const firstSocket = await reconnect(0);
  assert.equal((await server.runtime.replay(room.sessionId)).paused, true);
  await new Promise(resolve => setTimeout(resolve, 60)); assert.equal(calls.length, 0, '仅一人恢复仍暂停，不能调用模型');
  await reconnect(1);
  let inFlightObservation;
  if (stage !== 'settled') {
    const tang = await server.runtime.bindInternal(room.sessionId, room.content.chapterRules.people.tang, 'core_npc'), own = await server.runtime.observeInternal(tang);
    await server.runtime.reserveSpatialIntent(tang, 'observation-during-recovery', { kind: 'inspect', targetRef: own.projection.self.entityRef });
    inFlightObservation = accepted(await server.runtime.submitSpatialIntent(tang, 'observation-during-recovery')).result.observationRefs[0];
  }
  release.resolve();
  assert.ok(clocks.includes(false)); assert.equal((await server.runtime.replay(room.sessionId)).paused, false);
  try { await until(() => calls.length === 3 && current().actors.every(actor => actor.phase === 'Idle'), '两人实际恢复后必须分别唤醒三名角色'); }
  catch (error) { t.diagnostic(JSON.stringify({ stage, clocks, calls: calls.map(({ name, decisionId }) => ({ name, decisionId })), actors: current().actors })); throw error; }
  assert.deepEqual(new Set(calls.map(call => call.name)), new Set(['唐僧', '孙悟空', '猪刚鬣']));
  assert.ok(calls.every(call => !originals.some(old => old.decisionId === call.decisionId)));
  if (inFlightObservation) {
    assert.ok(calls.find(call => call.name === '唐僧').observationRefs.includes(inFlightObservation));
    assert.ok(calls.filter(call => call.name !== '唐僧').every(call => !call.observationRefs.includes(inFlightObservation)), '本人的未分享观察不进入他人上下文');
  }
  assert.equal((await db.pool.query('SELECT count(*) FROM ai_runs WHERE session_id=$1', [room.sessionId])).rows[0].count, '6');
  for (const old of originals) {
    const handle = await server.runtime.bindInternal(room.sessionId, old.actorId, 'core_npc');
    assert.deepEqual(await server.runtime.decisionReceipt(handle, old.decisionId), { receipt: old.receipt, semanticDigest: old.semanticDigest });
    const run = (await db.pool.query('SELECT * FROM ai_runs WHERE session_id=$1 AND decision_id=$2', [room.sessionId, old.decisionId])).rows[0];
    assert.equal(run.status, 'Resolved'); assert.equal(decodeStoredOutput(run), old.rawText);
  }
  const resumed = notices.find(notice => notice.spatialPauseBefore === true && notice.events.some(event => event.kind === 'spatial.clock' && event.payload.paused === false));
  assert.ok(resumed, '真实resume必须带事务起点的暂停事实');
  server.runtime.emit('commit', resumed); server.runtime.emit('commit', resumed);
  const snapshot = await network.snapshot(room.users[0].token, room.sessionId), self = snapshot.projection.self;
  accepted(await network.submit(firstSocket, JSON.stringify({ schemaVersion: 2, sessionId: room.sessionId, viewId: snapshot.viewId, actorRef: self.entityRef, clientActionId: 'unrelated-move-after-recovery', controlEpoch: self.controlEpoch, baseSeq: snapshot.snapshotSeq, action: { kind: 'move_to', sceneId: self.sceneId, destination: { x: self.position.x + 20, y: self.position.y }, movementCommandSeq: '1' } })));
  clock.value += 100; await server.runtime.maintenance(room.sessionId);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(calls.length, 3, '有预算余量时，重复resume、普通false时钟和无关移动都不能追加调用');
  assert.ok(notices.some(notice => notice.spatialPauseBefore === false && notice.events.some(event => event.kind === 'spatial.clock' && event.payload.paused === false)));
  const wukong = await server.runtime.bindInternal(room.sessionId, room.content.chapterRules.people.wukong, 'core_npc');
  const observe = async nonce => {
    const snapshot = await server.runtime.observeInternal(wukong);
    await server.runtime.reserveSpatialIntent(wukong, nonce, { kind: 'inspect', targetRef: snapshot.projection.self.entityRef });
    return accepted(await server.runtime.submitSpatialIntent(wukong, nonce));
  };
  const observation = await observe('new-authorized-observation');
  await until(() => calls.length === 4 && current().actors.every(actor => actor.phase === 'Idle'), '相关新观察必须独立唤醒本人');
  assert.equal(calls[3].name, '孙悟空');
  assert.ok(calls[3].observationRefs.includes(observation.result.observationRefs[0]));
  const observationNotice = notices.find(notice => notice.events.some(event => event.kind === 'spatial.observation' && event.payload.observation.observationRef === observation.result.observationRefs[0]));
  assert.ok(observationNotice); server.runtime.emit('commit', observationNotice); server.runtime.emit('commit', observationNotice);
  await new Promise(resolve => setTimeout(resolve, 60)); assert.equal(calls.length, 4, '同一Observation重投不能消耗第八次预算');
  await observe('another-authorized-observation');
  await until(() => calls.length === 5 && current().actors.every(actor => actor.phase === 'Idle'), '另一个真实新观察仍应独立唤醒');
  await observe('observation-after-budget');
  await until(() => current().actors.find(actor => actor.actorId === wukong.actorId).phase === 'BudgetExhausted', '后续语义唤醒仍受原持久预算约束');
  assert.equal(calls.length, 5); assert.equal((await db.pool.query('SELECT count(*) FROM ai_runs WHERE session_id=$1', [room.sessionId])).rows[0].count, '8');
  await server.runtime.abortSession(room.sessionId, '结束重启恢复组合检查');
  const terminal = await server.runtime.replay(room.sessionId);
  await server.runtime.maintenance(room.sessionId);
  assert.equal((await network.snapshot(room.users[0].token, room.sessionId)).snapshotSeq, terminal.sessionSeq);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(calls.length, 5); assert.equal(gateway.metrics().externalCalls, 0);
  assert.deepEqual(oldNetwork.errors, []); assert.deepEqual(network.errors, []);
  t.diagnostic(`${stage}：真实resume/本人新观察跨恢复阶段保留；普通clock、无关move及重复真实通知未追加调用；每次新provider前本人旧收据已收束，预算8与终态保持。`);
});
