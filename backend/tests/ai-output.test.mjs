import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createRuntime } from '../runtime.mjs';
import { ModelGateway } from '../ai/gateway.mjs';
import { AIOrchestrator } from '../ai/orchestrator.mjs';
import { createRunningRoom, until } from '../test-support/ai-room.mjs';
import { parseProposedIntent, intentSemanticDigestSync } from '../../protocol/node.mjs';
import { reserveCall, saveOutput } from '../ai/persistence.mjs';
import { RuntimeError } from '../errors.mjs';

let database; let runtime;
before(async () => { database = await startTestPostgres('ai-output'); runtime = await createRuntime({ pool: database.pool }); });
after(async () => { await runtime?.close(); await database?.stop(); });

test('真实 PostgreSQL：含 NUL 的非法模型原文无损保存，并按原决定拒绝和 fallback', async () => {
  const room = await createRunningRoom(runtime);
  const handle = await runtime.bindInternal(room.sessionId, 'tangseng', 'core_npc');
  const raw = '{bad' + String.fromCharCode(0); let decisionId;
  const gateway = new ModelGateway({ provider: { kind: 'controlled', providerId: 'controlled-output', async generate(input) {
    decisionId = input.context.decision.decisionId; return { rawText: raw };
  } }, modelId: 'output-v1' });
  const ai = new AIOrchestrator({ runtime, gateway, maxCallsPerSession: 1, minIntervalMs: 10 });
  try {
    ai.watch(handle, { autoWake: false });
    await until(() => decisionId && ['Idle', 'Unavailable'].includes(ai.status(handle).phase), '模型输出必须收束');
    assert.equal(ai.status(handle).error, null);
    assert.equal((await runtime.decisionState(handle, decisionId)).status, 'Rejected');
    const fallback = await runtime.internalReceipt(handle, `${decisionId}:fallback`, true);
    assert.equal(fallback?.status, 'Accepted');
    assert.equal(await runtime.internalReceipt(handle, `${decisionId}:submit`), null);
    const saved = (await database.pool.query('SELECT * FROM ai_runs WHERE session_id=$1 AND decision_id=$2', [room.sessionId, decisionId])).rows[0];
    assert.equal(saved.status, 'Resolved');
    assert.equal(saved.output_encoding, 'json-string-v1');
    assert.equal(saved.output_raw, JSON.stringify(raw));
    assert.equal(JSON.parse(saved.output_raw), raw);
    assert.equal(saved.model_result.outputDigest, createHash('sha256').update(raw).digest('hex'));
    await ai.recover(handle);
    const receipts = await database.pool.query('SELECT 1 FROM action_receipts WHERE session_id=$1 AND client_action_id=$2', [room.sessionId, `${decisionId}:fallback`]);
    assert.equal(receipts.rowCount, 1);
    assert.equal(gateway.metrics().externalCalls, 0);
  } finally { await ai.close(); }
});

test('真实子进程退出：孤立 surrogate 原文跨重启不替换，失败恢复只落一次 fallback', async t => {
  const exactDigests = [];
  for (const codeUnit of [0xd800, 0xdc00]) await t.test(`非法码元 ${codeUnit.toString(16)}`, async () => {
    const room = await createRunningRoom(runtime);
    const raw = '{bad' + String.fromCharCode(codeUnit);
    const child = fork(fileURLToPath(new URL('../test-support/ai-crash-worker.mjs', import.meta.url)), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let stderr = ''; const messages = [];
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('message', message => messages.push(message));
    const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (exitCode, signal) => resolve({ exitCode, signal })); });
    let timer;
    try {
      child.send({ phase: 'after-output', rawText: raw, connection: database.connection, sessionId: room.sessionId, token: room.users[0].token });
      const exit = await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('故障子进程没有按时退出')); }, 10000); })]);
      assert.equal(exit.exitCode, 81, stderr); assert.equal(exit.signal, null);
      const { decisionId } = messages.find(message => message.type === 'prepared');
      const restarted = await createRuntime({ pool: database.pool });
      const handle = await restarted.bindInternal(room.sessionId, 'tangseng', 'core_npc');
      const gateway = new ModelGateway({ provider: { kind: 'controlled', providerId: 'controlled-recovery', generate() { throw new Error('纯恢复不得调用模型'); } }, modelId: 'unused-v1' });
      const ai = new AIOrchestrator({ runtime: restarted, gateway });
      try {
        const before = (await database.pool.query('SELECT * FROM ai_runs WHERE session_id=$1 AND decision_id=$2', [room.sessionId, decisionId])).rows[0];
        assert.equal(before.status, 'Ready');
        assert.equal(JSON.parse(before.output_raw), raw);
        assert.equal(before.output_encoding, 'json-string-v1');
        assert.equal(before.model_result.status, 'Invalid');
        assert.equal(before.model_result.outputStringDigest, createHash('sha256').update(JSON.stringify(raw)).digest('hex'));
        exactDigests.push(before.model_result.outputStringDigest);
        ai.watch(handle, { wake: false, autoWake: false });
        await ai.recover(handle);
        assert.equal((await restarted.decisionState(handle, decisionId)).status, 'Rejected');
        assert.equal((await restarted.internalReceipt(handle, `${decisionId}:fallback`, true))?.status, 'Accepted');
        assert.equal(await restarted.internalReceipt(handle, `${decisionId}:submit`), null);
        await saveOutput(restarted, handle, decisionId, { status: 'Invalid', rawText: raw });
        await assert.rejects(saveOutput(restarted, handle, decisionId, { status: 'Invalid', rawText: '{bad' + String.fromCharCode(0xfffd) }), { code: 'ACTION_ID_REUSE' });
        await ai.recover(handle);
        const after = (await database.pool.query('SELECT * FROM ai_runs WHERE session_id=$1 AND decision_id=$2', [room.sessionId, decisionId])).rows[0];
        assert.equal(after.output_raw, before.output_raw);
        assert.equal(after.model_result.outputStringDigest, before.model_result.outputStringDigest);
        assert.equal(after.status, 'Resolved');
        const count = await database.pool.query('SELECT 1 FROM action_receipts WHERE session_id=$1 AND client_action_id=$2', [room.sessionId, `${decisionId}:fallback`]);
        assert.equal(count.rowCount, 1); assert.equal(gateway.metrics().calls, 0);
      } finally { await ai.close(); await restarted.close(); }
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited;
    }
  });
  assert.equal(new Set(exactDigests).size, 2, '不同孤立码元不能共享有损 UTF-8 摘要身份');
});

test('真实 PostgreSQL：旧版普通 text 原文仍按原文、原摘要恢复，迁移可重复启动', async () => {
  const room = await createRunningRoom(runtime);
  const handle = await runtime.bindInternal(room.sessionId, 'tangseng', 'core_npc');
  const prepared = await runtime.prepareDecisionContext(handle);
  const decisionId = prepared.decision.decisionId;
  const raw = `{ "decisionId": "${decisionId}", "toolCalls": [{"kind":"wait"}], "dialogue":{"channel":"public","text":"我们再核查一下？","recipientIds":[]} }`;
  const semanticDigest = intentSemanticDigestSync(parseProposedIntent(raw, decisionId));
  await reserveCall(runtime, handle, prepared, { providerKind: 'controlled', modelId: 'legacy-output' }, 1);
  await saveOutput(runtime, handle, decisionId, { status: 'Valid', rawText: raw, semanticDigest });
  await database.pool.query("UPDATE ai_runs SET output_raw=$3,output_encoding=NULL,model_result=model_result-'outputStringDigest' WHERE session_id=$1 AND decision_id=$2", [room.sessionId, decisionId, raw]);
  const restarted = await createRuntime({ pool: database.pool });
  const again = await restarted.bindInternal(room.sessionId, 'tangseng', 'core_npc');
  const gateway = new ModelGateway({ provider: { kind: 'controlled', providerId: 'controlled-recovery', generate() { throw new Error('纯恢复不得调用模型'); } }, modelId: 'unused-v1' });
  const ai = new AIOrchestrator({ runtime: restarted, gateway });
  try {
    ai.watch(again, { wake: false, autoWake: false });
    await ai.recover(again);
    const receipt = await restarted.internalReceipt(again, `${decisionId}:submit`);
    assert.equal(receipt?.status, 'Accepted'); assert.equal(receipt.semanticDigest, semanticDigest);
    assert.equal(await restarted.internalReceipt(again, `${decisionId}:fallback`, true), null);
    await saveOutput(restarted, again, decisionId, { status: 'Valid', rawText: raw, semanticDigest });
    await ai.recover(again);
    const saved = (await database.pool.query('SELECT * FROM ai_runs WHERE session_id=$1 AND decision_id=$2', [room.sessionId, decisionId])).rows[0];
    assert.equal(saved.output_raw, raw); assert.equal(saved.output_encoding, null);
    assert.equal(saved.semantic_digest, semanticDigest); assert.equal(saved.status, 'Resolved');
    const count = await database.pool.query('SELECT 1 FROM action_receipts WHERE session_id=$1 AND client_action_id=$2', [room.sessionId, `${decisionId}:submit`]);
    assert.equal(count.rowCount, 1); assert.equal(gateway.metrics().calls, 0);
  } finally { await ai.close(); await restarted.close(); }
});

test('真实 PostgreSQL：旧版 Ready 的 NUL 原文恢复先查询结果，再拒绝并保持原摘要', async () => {
  const room = await createRunningRoom(runtime);
  const handle = await runtime.bindInternal(room.sessionId, 'tangseng', 'core_npc');
  const prepared = await runtime.prepareDecisionContext(handle);
  const decisionId = prepared.decision.decisionId;
  const raw = JSON.stringify({ decisionId, toolCalls: [{ kind: 'wait' }], dialogue: { channel: 'public', text: '核查' + String.fromCharCode(0), recipientIds: [] } });
  const semanticDigest = intentSemanticDigestSync(parseProposedIntent(raw, decisionId));
  await reserveCall(runtime, handle, prepared, { providerKind: 'controlled', modelId: 'legacy-output' }, 1);
  await saveOutput(runtime, handle, decisionId, { status: 'Valid', rawText: raw, semanticDigest });
  // 构造升级前的 text 原文和 Valid 状态：没有新编码版本或码元摘要。
  await database.pool.query("UPDATE ai_runs SET output_raw=$3,output_encoding=NULL,model_result=model_result-'outputStringDigest' WHERE session_id=$1 AND decision_id=$2", [room.sessionId, decisionId, raw]);
  const restarted = await createRuntime({ pool: database.pool });
  const again = await restarted.bindInternal(room.sessionId, 'tangseng', 'core_npc');
  const gateway = new ModelGateway({ provider: { kind: 'controlled', providerId: 'controlled-recovery', generate() { throw new Error('纯恢复不得调用模型'); } }, modelId: 'unused-v1' });
  const ai = new AIOrchestrator({ runtime: restarted, gateway });
  try {
    ai.watch(again, { wake: false, autoWake: false });
    restarted.hooks = { beforeCommit({ command }) { if (command === 'internal-receipt') throw new RuntimeError('OUTCOME_UNKNOWN'); } };
    await assert.rejects(ai.recover(again), { code: 'OUTCOME_UNKNOWN' });
    assert.equal(ai.status(again).phase, 'Unknown');
    assert.equal((await runtime.decisionState(handle, decisionId)).status, 'Pending');
    assert.equal(await runtime.internalReceipt(handle, `${decisionId}:fallback`, true), null);
    restarted.hooks = {};
    assert.equal((await ai.recover(again)).blocked, false);
    assert.equal((await restarted.decisionState(again, decisionId)).status, 'Rejected');
    assert.equal((await restarted.internalReceipt(again, `${decisionId}:fallback`, true))?.status, 'Accepted');
    assert.equal(await restarted.internalReceipt(again, `${decisionId}:submit`), null);
    const saved = (await database.pool.query('SELECT * FROM ai_runs WHERE session_id=$1 AND decision_id=$2', [room.sessionId, decisionId])).rows[0];
    assert.equal(saved.output_raw, raw);
    assert.equal(saved.output_encoding, null);
    assert.equal(saved.semantic_digest, semanticDigest);
    assert.equal(saved.model_result.status, 'Valid', '原模型分类是历史事实，不回写为新调用');
    assert.equal(saved.outcome.rejectionReason, 'UNPERSISTABLE_INTENT');
    await ai.recover(again);
    const receipts = await database.pool.query('SELECT 1 FROM action_receipts WHERE session_id=$1 AND client_action_id=$2', [room.sessionId, `${decisionId}:fallback`]);
    assert.equal(receipts.rowCount, 1);
    assert.equal(gateway.metrics().calls, 0);
  } finally { restarted.hooks = {}; await ai.close(); await restarted.close(); }
});

test('真实 PostgreSQL：共享协议允许的 NUL 对白在 AI 边界拒绝，原包没有局部效果', async () => {
  const room = await createRunningRoom(runtime);
  const handle = await runtime.bindInternal(room.sessionId, 'tangseng', 'core_npc');
  let raw; let decisionId;
  const gateway = new ModelGateway({ provider: { kind: 'controlled', providerId: 'controlled-output', async generate(input) {
    decisionId = input.context.decision.decisionId;
    raw = JSON.stringify({ decisionId, toolCalls: [{ kind: 'inspect', targetId: 'passage_structure' }], dialogue: { channel: 'public', text: '核查' + String.fromCharCode(0) + '？', recipientIds: [] } });
    assert.equal(parseProposedIntent(raw, decisionId).dialogue.text.includes(String.fromCharCode(0)), true);
    return { rawText: raw };
  } }, modelId: 'output-v1' });
  const ai = new AIOrchestrator({ runtime, gateway, maxCallsPerSession: 1, minIntervalMs: 10 });
  try {
    ai.watch(handle, { autoWake: false });
    await until(() => decisionId && ['Idle', 'Unavailable'].includes(ai.status(handle).phase), '不可持久意图必须收束');
    assert.equal(ai.status(handle).error, null);
    assert.equal((await runtime.decisionState(handle, decisionId)).status, 'Rejected');
    assert.equal((await runtime.internalReceipt(handle, `${decisionId}:fallback`, true))?.status, 'Accepted');
    assert.equal(await runtime.internalReceipt(handle, `${decisionId}:submit`), null);
    const saved = (await database.pool.query('SELECT * FROM ai_runs WHERE session_id=$1 AND decision_id=$2', [room.sessionId, decisionId])).rows[0];
    assert.equal(JSON.parse(saved.output_raw), raw);
    assert.equal(saved.model_result.status, 'Invalid');
    assert.equal(saved.model_result.reason, 'UNPERSISTABLE_INTENT');
    assert.equal(saved.model_result.parsedSemanticDigest, intentSemanticDigestSync(parseProposedIntent(raw, decisionId)));
    const events = await database.pool.query("SELECT 1 FROM world_events WHERE session_id=$1 AND event->'causedBy'->>'decisionId'=$2", [room.sessionId, decisionId]);
    assert.equal(events.rowCount, 0, '被拒整包不得留下 inspect 或对白效果');
    await ai.recover(handle);
    assert.equal(ai.status(handle).error, null);
    assert.equal(gateway.metrics().invalid, 1);
  } finally { await ai.close(); }
});
