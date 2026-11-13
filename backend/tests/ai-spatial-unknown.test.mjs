import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../runtime.mjs';
import { RuntimeError } from '../errors.mjs';
import { ModelGateway } from '../ai/gateway.mjs';
import { AIOrchestrator } from '../ai/orchestrator.mjs';
import { decodeStoredOutput } from '../ai/output.mjs';
import { reserveCall, saveOutput } from '../ai/persistence.mjs';
import { parseSpatialProposedIntent } from '../../protocol/spatial-ai.mjs';
import { spatialIntentSemanticDigestSync } from '../../protocol/spatial-ai-node.mjs';
import { decodeJsonbText } from '../jsonb-text.mjs';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { gaolaoRoom, accepted } from '../test-support/gaolao-room.mjs';
import { createRunningRoom, deferred, until } from '../test-support/ai-room.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fixture(t, { region = false, proxy = false } = {}) {
  const db = await startTestPostgres('unknown-recovery', { outputSubdirectory: 'runtime-recovery' });
  const clock = { value: Date.parse('2026-11-14T08:00:00Z') }, fault = { remaining: 0, attempts: [] };
  let runtime;
  const cleanup = [];
  const pool = { query: (...args) => db.pool.query(...args), connect: async () => {
    const client = await db.pool.connect();
    return { release: (...args) => client.release(...args), query: async (sql, ...args) => {
      if (fault.remaining > 0 && /^SELECT (r\.receipt|receipt FROM action_receipts)/.test(sql)) {
        fault.remaining--;
        await client.query("SET LOCAL statement_timeout='1ms'");
        try { await client.query('SELECT pg_sleep(0.02)'); }
        catch (error) { fault.attempts.push({ at: performance.now(), code: error.code }); throw error; }
        assert.fail('真实PostgreSQL查询必须产生原生超时');
      }
      return client.query(sql, ...args);
    } };
  } };
  t.after(async () => { for (const close of cleanup) await close(); await runtime?.close(); await db.stop(); });
  runtime = await createRuntime({ pool, now: () => clock.value });
  const room = region ? await createRunningRoom(runtime) : await gaolaoRoom(runtime, clock, proxy ? 5 : 2);
  let handle = await runtime.bindInternal(room.sessionId, region ? 'tangseng' : room.content.chapterRules.people.wukong, 'core_npc');
  if (proxy) {
    const actorId = (await room.snapshot(0)).projection.self;
    await runtime.disconnect(room.handles[0]);
    clock.value += 31000;
    for (const connection of room.handles.slice(1)) await runtime.heartbeat(connection);
    await runtime.maintenance(room.sessionId);
    const state = await runtime.replay(room.sessionId), member = state.members.find(value => value.userId === room.users[0].userId);
    assert.equal(state.characters[member.characterId].mode, 'AIProxyControlled');
    assert.ok(actorId.entityRef);
    handle = await runtime.bindInternal(room.sessionId, member.characterId, 'proxy');
  }
  return { db, clock, fault, runtime, room, handle, region, cleanup };
}

function controlled(t, f, { actionFor = () => ({ kind: 'wait' }), rawFor, beforeGenerate, interval = 90, budget = 5 } = {}) {
  const calls = [];
  const gateway = new ModelGateway({ provider: { kind: 'controlled', providerId: 'recovered-unknown-test', async generate({ context }) {
    await beforeGenerate?.(context);
    const intent = { ...(f.region ? {} : { schemaVersion: 2 }), decisionId: context.decision.decisionId, toolCalls: [actionFor(context)] };
    const raw = rawFor ? rawFor(context) : JSON.stringify(intent, null, 2) + '\n';
    calls.push({ decisionId: context.decision.decisionId, raw, context }); return { rawText: raw };
  } }, modelId: 'controlled-unknown' });
  const ai = new AIOrchestrator({ runtime: f.runtime, gateway, minIntervalMs: interval, maxCallsPerSession: budget });
  f.cleanup.push(async () => { await ai.close(); assert.equal(gateway.metrics().externalCalls, 0); });
  return { ai, calls, gateway };
}

function loseCommit(f, { faults = 1, command = 'spatial-decision-submit', afterCommit } = {}) {
  let used = false;
  f.runtime.hooks = { async afterCommit({ command: actual }) {
    if (used || actual !== command) return;
    used = true;
    await afterCommit?.();
    f.fault.remaining = faults;
    throw new RuntimeError('OUTCOME_UNKNOWN', '真实提交已经完成，仅丢失本次返回。');
  } };
}

async function stored(f, decisionId) {
  const parameters = [f.room.sessionId, decisionId];
  const run = (await f.db.pool.query('SELECT * FROM ai_runs WHERE session_id=$1 AND decision_id=$2', parameters)).rows[0];
  const decision = (await f.db.pool.query('SELECT record FROM decisions WHERE session_id=$1 AND decision_id=$2', parameters)).rows[0].record;
  const intent = (await f.db.pool.query('SELECT * FROM spatial_intents WHERE session_id=$1 AND intent_id=$2', [f.room.sessionId, `${decisionId}:submit`])).rows[0];
  const receipts = (await f.db.pool.query('SELECT * FROM action_receipts WHERE session_id=$1 AND client_action_id=$2', [f.room.sessionId, `${decisionId}:submit`])).rows;
  const count = (await f.db.pool.query('SELECT count(*) FROM ai_runs WHERE session_id=$1', [f.room.sessionId])).rows[0].count;
  return { run, decision, intent, receipts, count };
}

for (const kind of ['move_to', 'speak']) test(`真实COMMIT及原生57014：${kind}只恢复原收据、原请求与原导航序号`, async t => {
  const f = await fixture(t);
  const { ai, calls } = controlled(t, f, { actionFor: context => kind === 'move_to' ? { kind, sceneId: context.projection.self.sceneId, destination: { x: context.projection.self.position.x + 20, y: context.projection.self.position.y } } : { kind, text: '原始发言只能生效一次。', channel: 'public', recipientRefs: [] } });
  let original;
  loseCommit(f, { afterCommit: async () => { original = await stored(f, calls[0].decisionId); } });
  ai.watch(f.handle, { autoWake: false });
  try { await until(() => ai.status(f.handle).phase === 'Idle' && ai.status(f.handle).lastReceipt?.status === 'Accepted', '原生查询故障必须有限自动恢复'); }
  catch (error) {
    const current = await stored(f, calls[0].decisionId);
    t.diagnostic(JSON.stringify({ status: ai.status(f.handle), nativeErrors: f.fault.attempts, providerCalls: calls.length, durableDecision: current.decision.status, durableRun: current.run.status, receiptCount: current.receipts.length }));
    throw error;
  }
  await pause(180);
  assert.equal(calls.length, 1); assert.equal(ai.status(f.handle).pendingWake, false);
  assert.deepEqual(f.fault.attempts.map(value => value.code), ['57014']);
  const after = await stored(f, calls[0].decisionId);
  assert.equal(after.run.status, 'Resolved'); assert.equal(after.count, '1'); assert.equal(after.decision.status, 'Committed');
  assert.equal(decodeStoredOutput(after.run), calls[0].raw); assert.equal(after.run.semantic_digest, original.run.semantic_digest);
  assert.equal(after.run.model_result.outputStringDigest, original.run.model_result.outputStringDigest);
  assert.deepEqual(after.intent, original.intent); assert.deepEqual(after.receipts, original.receipts);
  assert.equal(after.decision.movementCommandSeq, original.decision.movementCommandSeq); assert.equal(after.receipts.length, 1);
  assert.deepEqual(ai.status(f.handle).lastReceipt, after.receipts[0].receipt.publicReceipt);
});

test('显式恢复接替未执行的旧重试：有预算余量也不追加模型调用', async t => {
  const f = await fixture(t), { ai, calls } = controlled(t, f, { interval: 400 });
  loseCommit(f); ai.watch(f.handle, { autoWake: false });
  await until(() => ai.status(f.handle).phase === 'Unknown', '等待真实未知结果');
  assert.equal(ai.status(f.handle).pendingWake, true);
  f.fault.remaining = 0; await ai.recover(f.handle);
  await pause(470);
  assert.equal(calls.length, 1); assert.equal(ai.status(f.handle).phase, 'Idle'); assert.equal(ai.status(f.handle).pendingWake, false);
  assert.equal((await stored(f, calls[0].decisionId)).run.status, 'Resolved');
});

test('Unknown有限重试保留本人新观察，显式恢复先收束原结果再独立规划', async t => {
  const f = await fixture(t), { ai, calls } = controlled(t, f), notices = [];
  f.runtime.on('commit', notice => { if (notice.sessionId === f.room.sessionId) notices.push(structuredClone(notice)); });
  let original;
  loseCommit(f, { faults: Infinity, afterCommit: async () => { original = await stored(f, calls[0].decisionId); } });
  ai.watch(f.handle);
  await until(() => ai.status(f.handle).phase === 'Unknown', '等待原生收据超时');
  const self = (await f.room.snapshot('wukong')).projection.self;
  const observed = accepted(await f.room.send('wukong', { kind: 'inspect', targetRef: self.entityRef }));
  await until(() => f.fault.attempts.length === 4 && ai.status(f.handle).phase === 'Unknown' && !ai.status(f.handle).pendingWake, '初次加三次技术重试后必须停住');
  await pause(200); assert.equal(f.fault.attempts.length, 4); assert.equal(calls.length, 1);
  assert.ok(f.fault.attempts.every(value => value.code === '57014'));
  for (let i = 1; i < 4; i++) assert.ok(f.fault.attempts[i].at - f.fault.attempts[i - 1].at >= 80);
  f.fault.remaining = 0; await ai.recover(f.handle);
  await until(() => calls.length === 2 && ai.status(f.handle).phase === 'Idle', '保留观察只在本人旧结果收束后驱动新决定');
  const old = await stored(f, calls[0].decisionId), fresh = await stored(f, calls[1].decisionId);
  assert.equal(old.run.status, 'Resolved'); assert.equal(decodeStoredOutput(old.run), calls[0].raw);
  assert.equal(old.run.semantic_digest, original.run.semantic_digest); assert.deepEqual(old.intent, original.intent); assert.deepEqual(old.receipts, original.receipts);
  assert.equal(old.decision.movementCommandSeq, original.decision.movementCommandSeq); assert.equal(fresh.count, '2');
  assert.ok(decodeJsonbText(fresh.run.context, fresh.run.context_text_encoding).projection.observations.some(value => value.observationRef === observed.result.observationRefs[0]));
  const notice = notices.find(value => value.events.some(event => event.kind === 'spatial.observation' && event.payload.observation.observationRef === observed.result.observationRefs[0]));
  assert.ok(notice); f.runtime.emit('commit', notice); f.runtime.emit('commit', notice);
  await pause(180); assert.equal(calls.length, 2);
});

test('安全fallback丢返回与原生查询故障只恢复同一个系统收据', async t => {
  const f = await fixture(t), { ai, calls } = controlled(t, f, { rawFor: () => '{非法输出' });
  loseCommit(f, { command: 'spatial-decision-fallback' }); ai.watch(f.handle, { autoWake: false });
  await until(() => ai.status(f.handle).phase === 'Idle' && ai.status(f.handle).lastFallback?.status === 'Accepted', '安全fallback应恢复原系统结果');
  await pause(180); assert.equal(calls.length, 1);
  assert.deepEqual(f.fault.attempts.map(value => value.code), ['57014']);
  const id = calls[0].decisionId, rows = (await f.db.pool.query('SELECT principal_id,client_action_id FROM action_receipts WHERE session_id=$1 AND client_action_id=$2', [f.room.sessionId, `${id}:fallback`])).rows;
  assert.deepEqual(rows, [{ principal_id: 'system', client_action_id: `${id}:fallback` }]);
  assert.equal((await stored(f, id)).run.status, 'Resolved');
});

for (const part of ['request', 'intent']) test(`确定的${part}摘要冲突保留ACTION_ID_REUSE，不转为Unknown`, async t => {
  const f = await fixture(t), { ai, calls } = controlled(t, f);
  loseCommit(f, { faults: 0, afterCommit: async () => {
    const id = `${calls[0].decisionId}:submit`;
    if (part === 'request') await f.db.pool.query('UPDATE action_receipts SET semantic_digest=$3 WHERE session_id=$1 AND client_action_id=$2', [f.room.sessionId, id, '0'.repeat(64)]);
    else await f.db.pool.query("UPDATE spatial_intents SET execution_context=jsonb_set(execution_context,'{intentDigest}',to_jsonb($3::text)) WHERE session_id=$1 AND intent_id=$2", [f.room.sessionId, id, '0'.repeat(64)]);
  } });
  ai.watch(f.handle, { autoWake: false });
  await until(() => ai.status(f.handle).phase === 'Unavailable', '摘要冲突应确定拒绝');
  assert.equal(ai.status(f.handle).error, 'ACTION_ID_REUSE'); assert.equal(ai.status(f.handle).pendingWake, false);
  await pause(180); assert.equal(calls.length, 1);
  await assert.rejects(ai.recover(f.handle), { code: 'ACTION_ID_REUSE' }); assert.equal(calls.length, 1);
});

for (const phase of ['confirm', 'recovery']) test(`真实代理撤权发生在${phase}，拒绝读取且不再推理`, async t => {
  const f = await fixture(t, { proxy: true }), { ai, calls } = controlled(t, f, { interval: 400 });
  loseCommit(f, { faults: phase === 'confirm' ? 0 : 1, afterCommit: phase === 'confirm' ? () => f.runtime.revokeAccess(f.room.sessionId, f.room.users[0].userId) : undefined });
  ai.watch(f.handle, { autoWake: false });
  if (phase === 'recovery') {
    await until(() => ai.status(f.handle).phase === 'Unknown', '先保留原Unknown');
    await f.runtime.revokeAccess(f.room.sessionId, f.room.users[0].userId);
    await assert.rejects(ai.recover(f.handle), { code: 'FORBIDDEN' });
  } else await until(() => ai.status(f.handle).phase === 'Unavailable', 'confirm必须重新检查当前读权');
  assert.equal(ai.status(f.handle).error, 'FORBIDDEN'); assert.equal(ai.status(f.handle).pendingWake, false);
  await pause(450); assert.equal(calls.length, 1);
  await assert.rejects(f.runtime.decisionReceipt(f.handle, calls[0].decisionId), { code: 'FORBIDDEN' });
});

test('region旧确认链：原生查询超时仍自动恢复原Receipt', async t => {
  const f = await fixture(t, { region: true }), { ai, calls } = controlled(t, f, { budget: 1 });
  loseCommit(f, { command: 'intent' }); ai.watch(f.handle, { autoWake: false });
  await until(() => ai.status(f.handle).lastReceipt?.status === 'Accepted' && ai.status(f.handle).phase === 'BudgetExhausted', 'region原请求应恢复');
  assert.equal(calls.length, 1); assert.deepEqual(f.fault.attempts.map(value => value.code), ['57014']);
  assert.equal((await stored(f, calls[0].decisionId)).run.status, 'Resolved');
});

test('重启后的旧epoch原文只得到拒绝，不换导航号也不再调用模型', async t => {
  const f = await fixture(t), prepared = await f.runtime.prepareDecisionContext(f.handle);
  assert.equal((await reserveCall(f.runtime, f.handle, prepared, { providerKind: 'controlled' }, 5)).reserved, true);
  const self = prepared.context.projection.self;
  const rawText = JSON.stringify({ schemaVersion: 2, decisionId: prepared.decision.decisionId, toolCalls: [{ kind: 'move_to', sceneId: self.sceneId, destination: { x: self.position.x + 20, y: self.position.y } }] });
  const semanticDigest = spatialIntentSemanticDigestSync(parseSpatialProposedIntent(rawText, prepared.decision.decisionId, prepared.context));
  await saveOutput(f.runtime, f.handle, prepared.decision.decisionId, { status: 'Valid', rawText, semanticDigest });
  await f.runtime.close();
  const fresh = await createRuntime({ pool: f.db.pool, now: () => f.clock.value });
  const handle = await fresh.bindInternal(f.room.sessionId, f.handle.actorId, 'core_npc');
  const { ai, calls } = controlled(t, { ...f, runtime: fresh, handle });
  f.cleanup.push(() => fresh.close());
  assert.notEqual((await fresh.replay(f.room.sessionId)).characters[handle.actorId].controlEpoch, prepared.decision.controlEpoch);
  ai.watch(handle, { autoWake: false });
  await until(() => ai.status(handle).phase === 'Idle' && ai.status(handle).lastReceipt?.status === 'Rejected', '旧epoch恢复只能拒绝原请求');
  assert.equal(ai.status(handle).lastReceipt.code, 'STALE_CONTROL'); assert.equal(calls.length, 0);
  const after = await stored(f, prepared.decision.decisionId);
  assert.equal(after.run.status, 'Resolved'); assert.equal(after.count, '1'); assert.equal(decodeStoredOutput(after.run), rawText);
  assert.equal(after.run.semantic_digest, semanticDigest); assert.equal(after.decision.movementCommandSeq, prepared.decision.movementCommandSeq);
  assert.equal(decodeJsonbText(after.intent.request, after.intent.request_text_encoding).action.movementCommandSeq, prepared.decision.movementCommandSeq);
  assert.equal(after.receipts.length, 1); assert.equal(after.receipts[0].receipt.publicReceipt.status, 'Rejected');
});

test('准备后真实暂停：已准备推理可结束，世界操作仍拒绝，后续resume独立唤醒', async t => {
  const f = await fixture(t), entered = deferred(), release = deferred(), pausedAtProvider = [];
  let held = false;
  const { ai, calls } = controlled(t, f, {
    beforeGenerate: async context => { pausedAtProvider.push((await f.runtime.replay(f.room.sessionId)).paused); assert.equal(context.projection.paused, false); },
    actionFor: () => pausedAtProvider.length === 1 ? { kind: 'speak', text: '暂停后不能推进新剧情。', channel: 'public', recipientRefs: [] } : { kind: 'wait' },
  });
  f.runtime.hooks = { async afterCommit({ command }) {
    if (command === 'prepare-decision-context' && !held) { held = true; entered.resolve(); await release.promise; }
  } };
  try {
    ai.watch(f.handle); await entered.promise;
    await f.runtime.disconnect(f.room.handles[1]);
    assert.equal((await f.runtime.replay(f.room.sessionId)).paused, true);
    assert.equal(calls.length, 0); release.resolve();
    await until(() => ai.status(f.handle).phase === 'Idle' && ai.status(f.handle).lastReceipt?.code === 'SESSION_PAUSED', '已准备决定的动作仍应经过实际暂停围栏');
    assert.deepEqual(pausedAtProvider, [true]); assert.equal(calls.length, 1);
    await assert.rejects(f.runtime.prepareDecisionContext(f.handle), { code: 'SESSION_PAUSED' });
    const connection = await f.runtime.openConnection(f.room.users[1].token, ['spatial-v2']), snapshot = await f.runtime.subscribe(connection, f.room.sessionId);
    await f.runtime.control(connection, JSON.stringify({ schemaVersion: 2, type: 'control.resume', sessionId: f.room.sessionId, viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, nonce: crypto.randomUUID() }));
    await until(() => calls.length === 2 && ai.status(f.handle).phase === 'Idle', '随后真人resume必须独立唤醒');
    assert.deepEqual(pausedAtProvider, [true, false]);
    const state = await f.runtime.replay(f.room.sessionId);
    assert.ok(!(state.claims[f.handle.actorId] ?? []).some(value => value.text === '暂停后不能推进新剧情。'));
  } finally { release.resolve(); }
});
