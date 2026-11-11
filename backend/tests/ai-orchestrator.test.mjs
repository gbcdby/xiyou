import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createRuntime } from '../runtime.mjs';
import { ModelGateway } from '../ai/gateway.mjs';
import { AIOrchestrator } from '../ai/orchestrator.mjs';
import { RuntimeError } from '../errors.mjs';
import { parseProposedIntent, intentSemanticDigestSync } from '../../protocol/node.mjs';
import { createRunningRoom, actionRaw, deferred, until } from '../test-support/ai-room.mjs';
import { captureAI } from '../test-support/ai-evidence.mjs';

let database; let runtime; const gateways = [];
function makeGateway(options) { const gateway = new ModelGateway(options); gateways.push(gateway); return gateway; }
before(async () => { database = await startTestPostgres('ai-orchestrator'); runtime = await createRuntime({ pool: database.pool }); });
after(async () => { await runtime?.close(); try { await captureAI(database, 'orchestrator', { gateways: gateways.map(gateway => ({ configuration: gateway.configuration(), metrics: gateway.metrics() })) }); } finally { await database?.stop(); } });

test('真实 PostgreSQL：全局并发有界，每角色单在途；忽略 Abort 的 provider 不拖住关闭', async () => {
  const rooms = [await createRunningRoom(runtime), await createRunningRoom(runtime)];
  const handles = await Promise.all(rooms.map(room => runtime.bindInternal(room.sessionId, 'tangseng', 'core_npc')));
  const returns = []; const inputs = []; let active = 0; let maximum = 0;
  const gateway = makeGateway({ provider: { kind: 'controlled', providerId: 'controlled-test', generate(input) {
    inputs.push(input); active++; maximum = Math.max(maximum, active);
    const result = deferred(); returns.push(result);
    return result.promise.finally(() => { active--; });
  } }, modelId: 'lifecycle-v1' });
  const orchestrator = new AIOrchestrator({ runtime, gateway, maxConcurrent: 1, minIntervalMs: 10, maxCallsPerSession: 1 });
  try {
    for (const handle of handles) orchestrator.watch(handle);
    await until(() => inputs.length === 1, '首个模型必须启动');
    for (let index = 0; index < 20; index++) orchestrator.wake(handles[0]);
    assert.equal(inputs.length, 1);
    returns[0].resolve({ rawText: JSON.stringify({ decisionId: inputs[0].context.decision.decisionId, toolCalls: [{ kind: 'wait' }] }) });
    await until(() => inputs.length === 2, '第二角色应在首个结束后公平取得调用机会');
    assert.equal(maximum, 1);
    const secondId = inputs[1].context.decision.decisionId;
    const closed = orchestrator.close();
    let timer;
    try { await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('忽略 Abort 导致调度器关闭挂起')), 1000); })]); }
    finally { clearTimeout(timer); }
    const record = await runtime.decisionState(handles[1], secondId);
    assert.equal(record.status, 'Cancelled');
    const before = await runtime.replay(rooms[1].sessionId);
    returns[1].resolve({ rawText: JSON.stringify({ decisionId: secondId, toolCalls: [{ kind: 'move', regionId: 'store' }] }) });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(await runtime.replay(rooms[1].sessionId), before);
    assert.equal(await runtime.internalReceipt(handles[1], `${secondId}:submit`), null);
    assert.equal(gateway.metrics().active, 0);
    assert.equal(gateway.metrics().cancelled, 1);
  } finally { for (const result of returns) result.resolve({ rawText: '{}' }); await orchestrator.close(); }
});

test('真实 PostgreSQL：实际模型超时产生稳定 fallback，迟到输出失效，后续规划使用新 ID', async () => {
  const r = await createRunningRoom(runtime);
  const handle = await runtime.bindInternal(r.sessionId, 'tangseng', 'core_npc');
  const late = deferred(); const inputs = [];
  const gateway = makeGateway({ provider: { kind: 'controlled', providerId: 'controlled-test', async generate(input) {
    inputs.push(input);
    if (inputs.length === 1) return late.promise;
    return { rawText: JSON.stringify({ decisionId: input.context.decision.decisionId, toolCalls: [{ kind: 'wait' }] }) };
  } }, modelId: 'timeout-v1', timeoutMs: 30 });
  const orchestrator = new AIOrchestrator({ runtime, gateway, minIntervalMs: 10, maxCallsPerSession: 2 });
  try {
    orchestrator.watch(handle);
    await until(() => orchestrator.status(handle).lastFallback !== null && orchestrator.status(handle).phase === 'Idle', '超时必须有持久 fallback');
    const originalId = inputs[0].context.decision.decisionId;
    assert.equal((await runtime.decisionState(handle, originalId)).status, 'Rejected', '供应商超时早于权威 Decision deadline，不能伪称权威 Expired');
    assert.equal(orchestrator.status(handle).lastFallback.clientActionId, `${originalId}:fallback`);
    const before = await runtime.replay(r.sessionId);
    late.resolve({ rawText: JSON.stringify({ decisionId: originalId, toolCalls: [{ kind: 'move', regionId: 'store' }] }) });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(await runtime.replay(r.sessionId), before);
    orchestrator.wake(handle);
    await until(() => orchestrator.status(handle).lastReceipt?.status === 'Accepted', '超时后应能重新观察与规划');
    assert.notEqual(inputs[1].context.decision.decisionId, originalId);
    assert.equal(await runtime.internalReceipt(handle, `${originalId}:submit`), null);
    assert.equal(gateway.metrics().timeouts, 1); assert.equal(gateway.metrics().calls, 2);
  } finally { late.resolve({ rawText: '{}' }); await orchestrator.close(); }
});

test('真实 PostgreSQL：显式恢复的结果仍未知时保留 Unknown，恢复成功后才标记空闲', async () => {
  const r = await createRunningRoom(runtime);
  const handle = await runtime.bindInternal(r.sessionId, 'tangseng', 'core_npc');
  const decision = await runtime.prepareDecision(handle);
  await runtime.settleDecision(handle, decision.decisionId, 'Rejected');
  const gateway = makeGateway({ provider: { kind: 'controlled', providerId: 'controlled-test', generate() { throw new Error('纯恢复不能调用模型'); } }, modelId: 'unused-v1' });
  const orchestrator = new AIOrchestrator({ runtime, gateway });
  const previous = runtime.hooks;
  runtime.hooks = {
    afterCommit({ command }) { if (command === 'fallback') throw new RuntimeError('OUTCOME_UNKNOWN'); },
    beforeCommit({ command }) { if (command === 'internal-receipt') throw new RuntimeError('OUTCOME_UNKNOWN'); },
  };
  try {
    orchestrator.watch(handle, { wake: false, autoWake: false });
    await assert.rejects(orchestrator.recover(handle), { code: 'OUTCOME_UNKNOWN' });
    assert.equal(orchestrator.status(handle).phase, 'Unknown');
    assert.equal(orchestrator.status(handle).lastFallback, null);
    runtime.hooks = previous;
    await orchestrator.recover(handle);
    assert.equal(orchestrator.status(handle).phase, 'Idle');
    assert.equal(orchestrator.status(handle).lastFallback.status, 'Accepted');
    assert.equal(gateway.metrics().calls, 0);
  } finally { runtime.hooks = previous; await orchestrator.close(); }
});

test('真实 PostgreSQL：合并唤醒按实际模型启动时间限流，重启仍遵守本局持久预算', async () => {
  const room = await createRunningRoom(runtime);
  const handle = await runtime.bindInternal(room.sessionId, 'tangseng', 'core_npc');
  const entered = deferred(); const release = deferred(); let first = true; const starts = [];
  const previous = runtime.hooks;
  runtime.hooks = { beforeCommit: async ({ command }) => {
    if (command === 'prepare-decision-context' && first) { first = false; entered.resolve(); await release.promise; }
  } };
  const provider = { kind: 'controlled', providerId: 'controlled-test', async generate(input) {
    starts.push(performance.now());
    return { rawText: JSON.stringify({ decisionId: input.context.decision.decisionId, toolCalls: [{ kind: starts.length === 1 ? 'inspect' : 'wait', ...(starts.length === 1 ? { targetId: 'passage_structure' } : {}) }] }) };
  } };
  const gateway = makeGateway({ provider, modelId: 'interval-v1' });
  const orchestrator = new AIOrchestrator({ runtime, gateway, minIntervalMs: 150, maxCallsPerSession: 2 });
  let next;
  try {
    orchestrator.watch(handle);
    await entered.promise;
    for (let index = 0; index < 20; index++) orchestrator.wake(handle);
    await new Promise(resolve => setTimeout(resolve, 250)); release.resolve();
    await until(() => starts.length === 2 && orchestrator.status(handle).phase === 'Idle', '两轮模型必须完成');
    assert.ok(starts[1] - starts[0] >= 145, `实际调用间隔只有 ${starts[1] - starts[0]} ms`);
    await orchestrator.close(); runtime.hooks = previous;
    const another = makeGateway({ provider, modelId: 'interval-v1' });
    next = new AIOrchestrator({ runtime, gateway: another, minIntervalMs: 10, maxCallsPerSession: 2 });
    next.watch(handle);
    await until(() => next.status(handle).phase === 'BudgetExhausted', '重启必须读取已用预算');
    assert.equal(another.metrics().calls, 0);
    assert.equal(starts.length, 2);
    assert.equal((await database.pool.query('SELECT count(*) FROM ai_runs WHERE session_id=$1', [room.sessionId])).rows[0].count, '2');
  } finally { release.resolve(); runtime.hooks = previous; await orchestrator.close(); await next?.close(); }
});

test('真实 PostgreSQL：未知提交保留原文和摘要，新实例只恢复旧 Receipt，不改失败或调用新模型', async () => {
  const room = await createRunningRoom(runtime);
  const handle = await runtime.bindInternal(room.sessionId, 'tangseng', 'core_npc');
  let raw; let decisionId; let restarted; let recovery;
  const gateway = makeGateway({ provider: { kind: 'controlled', providerId: 'controlled-test', async generate(input) {
    decisionId = input.context.decision.decisionId;
    raw = `{ "decisionId": "${decisionId}", "toolCalls": [{"kind":"wait"}], "dialogue":{"channel":"public","text":"我们再核对一下？","recipientIds":[]} }`;
    return { rawText: raw };
  } }, modelId: 'unknown-v1' });
  const orchestrator = new AIOrchestrator({ runtime, gateway, maxCallsPerSession: 1 });
  const previous = runtime.hooks;
  runtime.hooks = {
    afterCommit({ command }) { if (command === 'intent') throw new RuntimeError('OUTCOME_UNKNOWN', '受控提交响应丢失'); },
    beforeCommit({ command }) { if (command === 'internal-receipt') throw new RuntimeError('OUTCOME_UNKNOWN', '受控查询暂不可用'); },
  };
  try {
    orchestrator.watch(handle);
    await until(() => orchestrator.status(handle).phase === 'Unknown', '未知结果必须保留为 Unknown');
    assert.equal(orchestrator.status(handle).lastFallback, null);
    await orchestrator.close(); runtime.hooks = previous;
    const state = await runtime.replay(room.sessionId);
    restarted = await createRuntime({ pool: database.pool });
    const again = await restarted.bindInternal(room.sessionId, 'tangseng', 'core_npc');
    const unused = makeGateway({ provider: { kind: 'controlled', providerId: 'controlled-test', async generate() { throw new Error('恢复不应新建模型调用'); } }, modelId: 'unused-v1' });
    recovery = new AIOrchestrator({ runtime: restarted, gateway: unused });
    recovery.watch(again, { wake: false });
    assert.equal((await recovery.recover(again)).blocked, false);
    const receipt = recovery.status(again).lastReceipt;
    assert.equal(receipt?.clientActionId, `${decisionId}:submit`);
    assert.equal(receipt.status, 'Accepted');
    assert.equal(receipt.semanticDigest, intentSemanticDigestSync(parseProposedIntent(raw, decisionId)));
    assert.equal(unused.metrics().calls, 0);
    assert.deepEqual(await restarted.replay(room.sessionId), state);
    assert.equal(await restarted.internalReceipt(again, `${decisionId}:fallback`, true), null);
    const saved = (await database.pool.query('SELECT output_raw,semantic_digest,context FROM ai_runs WHERE session_id=$1 AND decision_id=$2', [room.sessionId, decisionId])).rows[0];
    assert.equal(saved.output_raw, raw);
    assert.equal(saved.semantic_digest, receipt.semanticDigest);
    assert.equal(saved.context.decision.decisionId, decisionId);
  } finally { runtime.hooks = previous; await orchestrator.close(); await recovery?.close(); await restarted?.close(); }
});

test('真实 PostgreSQL：新调度器从持久失败决定恢复 fallback，稳定原因键只产生一份收据', async () => {
  const room = await createRunningRoom(runtime);
  const handle = await runtime.bindInternal(room.sessionId, 'tangseng', 'core_npc');
  const decision = await runtime.prepareDecision(handle);
  await runtime.settleDecision(handle, decision.decisionId, 'Rejected');
  const gateway = makeGateway({ provider: { kind: 'controlled', providerId: 'controlled-test', async generate() { throw new Error('恢复不应调用模型'); } }, modelId: 'unused-v1' });
  const orchestrator = new AIOrchestrator({ runtime, gateway });
  try {
    orchestrator.watch(handle, { wake: false });
    const first = await orchestrator.recover(handle);
    assert.equal(first.blocked, false);
    const receipt = await runtime.internalReceipt(handle, `${decision.decisionId}:fallback`, true);
    assert.equal(receipt.status, 'Accepted');
    assert.equal(receipt.code, 'NO_CHANGE');
    await orchestrator.recover(handle);
    const rows = await database.pool.query('SELECT receipt FROM action_receipts WHERE session_id=$1 AND client_action_id=$2', [room.sessionId, `${decision.decisionId}:fallback`]);
    assert.equal(rows.rowCount, 1);
    const saved = (await database.pool.query('SELECT record FROM decisions WHERE session_id=$1 AND decision_id=$2', [room.sessionId, decision.decisionId])).rows[0].record;
    assert.equal(saved.status, 'Rejected');
    assert.equal(gateway.metrics().calls, 0);
  } finally { await orchestrator.close(); }
});

test('真实 PostgreSQL：模型等待在事务外，真人先取得收据，模型随后通过同一 Validator', async () => {
  const room = await createRunningRoom(runtime);
  const handle = await runtime.bindInternal(room.sessionId, 'tangseng', 'core_npc');
  const started = deferred(); const returned = deferred(); let input;
  const gateway = makeGateway({ provider: { kind: 'controlled', providerId: 'controlled-test', async generate(value) { input = value; started.resolve(); return returned.promise; } }, modelId: 'wait-v1' });
  const orchestrator = new AIOrchestrator({ runtime, gateway, minIntervalMs: 10, maxCallsPerSession: 1 });
  try {
    orchestrator.watch(handle);
    await started.promise;
    const human = await runtime.submit(room.connections[1], actionRaw(room, 1, { kind: 'inspect', targetId: 'stock_record' }));
    assert.equal(human.status, 'Accepted');
    assert.equal(orchestrator.status(handle).phase, 'Inferring');
    returned.resolve({ rawText: JSON.stringify({ decisionId: input.context.decision.decisionId, toolCalls: [{ kind: 'wait' }] }) });
    await until(() => orchestrator.status(handle).lastReceipt?.status === 'Accepted', '合法模型结果必须进入权威提交');
    assert.equal(orchestrator.status(handle).lastReceipt.clientActionId, `${input.context.decision.decisionId}:submit`);
    assert.deepEqual(input.context.memory.observations.map(o => o.observationId), input.context.decision.observationIds);
    assert.equal(gateway.metrics().externalCalls, 0);
  } finally { returned.resolve({ rawText: '{}' }); await orchestrator.close(); }
});
