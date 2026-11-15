import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { canonicalize } from '../../protocol/node.mjs';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createRuntime } from '../runtime.mjs';
import { gaolaoRoom, accepted, share } from '../test-support/gaolao-room.mjs';
import { ModelGateway } from '../ai/gateway.mjs';
import { reserveCall, saveOutput, saveOutcome } from '../ai/persistence.mjs';
import { decodeJsonbText } from '../jsonb-text.mjs';
import { spatialEvaluationReport } from '../scripts/evaluate-spatial-ai.mjs';

const clock = { value: Date.parse('2026-11-15T03:00:00Z') };
const hash = value => createHash('sha256').update(canonicalize(value)).digest('hex');
let db, runtime;
const calibrationReports = [];
before(async () => {
  db = await startTestPostgres('spatial-evaluation', { outputSubdirectory: 'issue63-evaluation' });
  runtime = await createRuntime({ pool: db.pool, now: () => clock.value });
});
after(async () => {
  try {
    const directory = new URL('../../.agent-output/issue63-evaluation/', import.meta.url);
    await mkdir(directory, { recursive: true });
    await writeFile(new URL('calibration-samples.json', directory), JSON.stringify({ schemaVersion: 1, sourceKind: 'controlled', externalCalls: 0, evaluation: 'NOT_RUN', reports: calibrationReports }, null, 2) + '\n');
  } finally { await runtime?.close(); await db?.stop(); }
});

async function controlledSample(room, action, key = 'wukong') {
  const handle = room.actors.get(key).handle;
  const prepared = await runtime.prepareDecisionContext(handle);
  const gateway = new ModelGateway({
    provider: { kind: 'controlled', providerId: 'evaluation-chain-calibration', generate({ context }) {
      return { rawText: JSON.stringify({ schemaVersion: 2, decisionId: context.decision.decisionId, toolCalls: [typeof action === 'function' ? action(context) : action] }) };
    } }, modelId: 'controlled-evidence-chain',
  });
  try {
    assert.equal((await reserveCall(runtime, handle, prepared, gateway.configuration(), 12)).reserved, true);
    const output = await gateway.generate(prepared.context);
    assert.equal(output.status, 'Valid');
    await saveOutput(runtime, handle, prepared.decision.decisionId, output);
    const receipt = await runtime.submitIntent(handle, prepared.decision.decisionId, output.rawText);
    const decision = await runtime.decisionState(handle, prepared.decision.decisionId);
    const fallback = ['Rejected', 'Expired'].includes(decision.status) ? await runtime.submitFallback(handle, decision.decisionId) : null;
    await saveOutcome(runtime, handle, decision.decisionId, { decisionStatus: decision.status, receipt, fallback });
    assert.equal(gateway.metrics().externalCalls, 0);
    return { prepared, output, receipt, fallback };
  } finally { await gateway.close(); }
}

test('评价来源链把真实受理绑定到原上下文、模型意图、Receipt 和完整事件范围', async () => {
  const room = await gaolaoRoom(runtime, clock, 2, 'gaolaozhuang-scene-v3');
  const actual = await controlledSample(room, { kind: 'speak', text: '仅按本人已经看到的材料说明。', channel: 'public', recipientRefs: [] });
  accepted(actual.receipt);
  assert.ok(actual.receipt.actionEventRange);
  const report = await spatialEvaluationReport(db.pool, room.sessionId), sample = report.samples[0];
  assert.equal(report.evaluation, 'NOT_RUN');
  assert.equal(report.externalSamples, 0);
  assert.equal(sample.evidenceChain?.status, 'COMPLETE');
  assert.equal(sample.evidenceChain.context.digest, hash(actual.prepared.context));
  assert.equal(sample.evidenceChain.context.baseSeq, actual.prepared.context.snapshotSeq);
  assert.equal(sample.evidenceChain.output.semanticDigest, actual.output.semanticDigest);
  assert.equal(sample.evidenceChain.output.stringDigest, createHash('sha256').update(JSON.stringify(actual.output.rawText)).digest('hex'));
  const trace = sample.evidenceChain.actions[0];
  assert.equal(trace.mode, 'intent');
  assert.equal(trace.actionId, actual.receipt.clientActionId);
  assert.deepEqual(trace.receipt, actual.receipt);
  assert.equal(trace.status, 'COMPLETE');
  assert.equal(trace.worldEffect, 'EVENTS_COMMITTED');
  const rows = (await db.pool.query('SELECT event,event_text_encoding FROM world_events WHERE session_id=$1 AND session_seq BETWEEN $2 AND $3 ORDER BY session_seq', [room.sessionId, actual.receipt.actionEventRange.first, actual.receipt.actionEventRange.last])).rows;
  assert.equal(trace.worldEvents.length, rows.length);
  for (const [index, row] of rows.entries()) {
    const event = decodeJsonbText(row.event, row.event_text_encoding);
    assert.deepEqual(trace.worldEvents[index], { eventId: event.eventId, sessionSeq: event.sessionSeq, kind: event.kind, digest: hash(event) });
    assert.equal(event.causedBy.actionId, trace.actionId);
    assert.equal(event.causedBy.actorId, sample.actorId);
  }
  assert.ok(!JSON.stringify(sample.evidenceChain).includes('payload'));
  assert.ok(BigInt(report.snapshotSeq) >= BigInt(actual.receipt.observedSeq));
  calibrationReports.push({ scenario: 'accepted', report });
});

test('合法拒绝无动作事件仍有完整链；补入真实来源后新的决定保留新上下文和原回执', async () => {
  const room = await gaolaoRoom(runtime, clock, 2, 'gaolaozhuang-scene-v3');
  await room.go('wukong', room.C('C01'));
  const rejected = await controlledSample(room, context => {
    const seal = context.projection.targets.find(target => target.name === '铜封门');
    return { kind: 'interact', targetRef: seal.entityRef, operationId: 'gz-break-seal', expectedTargetRevision: seal.resourceRevision };
  });
  assert.equal(rejected.receipt.status, 'Rejected');
  assert.equal(rejected.receipt.code, 'NOT_READY');
  assert.equal(rejected.receipt.actionEventRange, null);
  assert.ok(!rejected.prepared.context.projection.observations.some(observation => observation.source?.label === '侧窗本人回应'));
  const carer = room.role('B');
  await room.go(carer, room.C('C04'));
  accepted(await room.interact(carer, '侧窗联络点', 'gz-contact'));
  await room.go(carer, room.C('C01'));
  await share(room, carer, '侧窗本人回应', '孙悟空');
  const replanned = await controlledSample(room, context => {
    assert.ok(context.projection.observations.some(observation => observation.source?.label === '侧窗本人回应'));
    return { kind: 'speak', text: '已经收到本人通过侧窗的回应；还要确认门内退让与门撑固定。', channel: 'public', recipientRefs: [] };
  });
  accepted(replanned.receipt);
  const report = await spatialEvaluationReport(db.pool, room.sessionId);
  const old = report.samples.find(sample => sample.decisionId === rejected.prepared.decision.decisionId);
  const next = report.samples.find(sample => sample.decisionId === replanned.prepared.decision.decisionId);
  assert.equal(old.evidenceChain.status, 'COMPLETE');
  assert.deepEqual(old.evidenceChain.actions[0].receipt, rejected.receipt);
  assert.equal(old.evidenceChain.actions[0].worldEffect, 'REJECTED_NO_EFFECT');
  assert.deepEqual(old.evidenceChain.actions[0].worldEvents, []);
  assert.equal(old.evidenceChain.actions[1].mode, 'fallback');
  assert.deepEqual(old.evidenceChain.actions[1].receipt, rejected.fallback);
  assert.equal(next.evidenceChain.status, 'COMPLETE');
  assert.ok(BigInt(next.generation) > BigInt(old.generation));
  assert.ok(BigInt(next.evidenceChain.context.baseSeq) > BigInt(old.evidenceChain.context.baseSeq));
  assert.notEqual(next.evidenceChain.context.digest, old.evidenceChain.context.digest);
  assert.notEqual(next.evidenceChain.actions[0].actionId, old.evidenceChain.actions[0].actionId);
  const source = next.sourceObservations.find(observation => observation.source?.label === '侧窗本人回应');
  assert.equal(source.category, 'Claim');
  assert.ok(!old.sourceObservations.some(observation => observation.observationRef === source.observationRef));
  assert.equal(report.evaluation, 'NOT_RUN');
  assert.equal(report.externalSamples, 0);
  assert.equal(report.coverage.refusalThenEvidence, 'NOT_ASSESSED');
  calibrationReports.push({ scenario: 'rejected-then-authorized-evidence-and-new-decision', report });
});

test('合法等待的 NO_CHANGE 不要求虚构 WorldEvent', async () => {
  const room = await gaolaoRoom(runtime, clock, 2, 'gaolaozhuang-scene-v3');
  const actual = await controlledSample(room, { kind: 'wait' });
  assert.equal(actual.receipt.status, 'Accepted');
  assert.equal(actual.receipt.code, 'NO_CHANGE');
  assert.equal(actual.receipt.actionEventRange, null);
  const sample = (await spatialEvaluationReport(db.pool, room.sessionId)).samples[0];
  assert.equal(sample.evidenceChain.status, 'COMPLETE');
  assert.equal(sample.evidenceChain.actions[0].worldEffect, 'NO_CHANGE');
  assert.deepEqual(sample.evidenceChain.actions[0].worldEvents, []);
});

test('导出不带出真人队聊或其他房间；错绑的 outcome 不可伪装为本样本回执', async () => {
  const room = await gaolaoRoom(runtime, clock, 2, 'gaolaozhuang-scene-v3');
  const privateText = '本局真人队聊限定的校准文本';
  accepted(await room.send(0, { kind: 'speak', text: privateText, channel: 'team', recipientRefs: [] }));
  const actual = await controlledSample(room, { kind: 'speak', text: '本人只看到可见资料。', channel: 'public', recipientRefs: [] });
  const other = await gaolaoRoom(runtime, clock, 2, 'gaolaozhuang-scene-v3');
  const foreign = await controlledSample(other, { kind: 'speak', text: '另一个房间专有的校准文本', channel: 'public', recipientRefs: [] });
  const initial = await spatialEvaluationReport(db.pool, room.sessionId);
  assert.equal(initial.samples.length, 1);
  assert.ok(!JSON.stringify(initial).includes(privateText));
  assert.ok(!JSON.stringify(initial).includes(other.sessionId));
  assert.ok(!JSON.stringify(initial).includes('另一个房间专有的校准文本'));
  const decisionId = actual.prepared.decision.decisionId;
  const saved = (await db.pool.query('SELECT outcome FROM ai_runs WHERE session_id=$1 AND decision_id=$2', [room.sessionId, decisionId])).rows[0].outcome;
  try {
    await db.pool.query("UPDATE ai_runs SET outcome=jsonb_set(outcome,'{receipt}',$3::jsonb) WHERE session_id=$1 AND decision_id=$2", [room.sessionId, decisionId, JSON.stringify(foreign.receipt)]);
    const report = await spatialEvaluationReport(db.pool, room.sessionId), sample = report.samples[0];
    assert.equal(sample.evidenceChain.status, 'INCOMPLETE');
    assert.ok(sample.evidenceChain.issues.includes('INTENT_OUTCOME_MISMATCH'));
    assert.deepEqual(sample.evidenceChain.actions[0].receipt, actual.receipt);
    assert.ok(!JSON.stringify(report).includes(other.sessionId));
    assert.ok(!JSON.stringify(report).includes(foreign.receipt.clientActionId));
  } finally {
    await db.pool.query('UPDATE ai_runs SET outcome=$3 WHERE session_id=$1 AND decision_id=$2', [room.sessionId, decisionId, saved]);
  }
});

test('必要持久链缺失或摘要错配逐项 INCOMPLETE，不能靠缓存 outcome 补齐', async t => {
  const room = await gaolaoRoom(runtime, clock, 2, 'gaolaozhuang-scene-v3');
  const actual = await controlledSample(room, { kind: 'speak', text: '用于检查真实持久链的校准发言。', channel: 'public', recipientRefs: [] });
  const decisionId = actual.prepared.decision.decisionId, actionId = actual.receipt.clientActionId;
  await t.test('原请求缺失', async () => {
    const saved = (await db.pool.query('DELETE FROM spatial_intents WHERE session_id=$1 AND intent_id=$2 RETURNING *', [room.sessionId, actionId])).rows[0];
    try {
      const sample = (await spatialEvaluationReport(db.pool, room.sessionId)).samples[0];
      assert.equal(sample.evidenceChain.status, 'INCOMPLETE');
      assert.ok(sample.evidenceChain.actions[0].issues.includes('ORIGINAL_REQUEST_MISSING'));
      assert.equal(sample.evidenceChain.actions[0].receipt, null);
    } finally {
      await db.pool.query('INSERT INTO spatial_intents(session_id,intent_id,actor_id,control_epoch,request,execution_context,request_text_encoding) VALUES($1,$2,$3,$4,$5,$6,$7)', [saved.session_id, saved.intent_id, saved.actor_id, saved.control_epoch, saved.request, saved.execution_context, saved.request_text_encoding]);
    }
  });
  await t.test('真实 Receipt 缺失', async () => {
    const saved = (await db.pool.query('DELETE FROM action_receipts WHERE session_id=$1 AND client_action_id=$2 RETURNING *', [room.sessionId, actionId])).rows[0];
    try {
      const sample = (await spatialEvaluationReport(db.pool, room.sessionId)).samples[0];
      assert.equal(sample.evidenceChain.status, 'INCOMPLETE');
      assert.ok(sample.evidenceChain.actions[0].issues.includes('AUTHORITATIVE_RECEIPT_MISSING'));
      assert.equal(sample.evidenceChain.actions[0].receipt, null);
    } finally {
      await db.pool.query('INSERT INTO action_receipts(session_id,principal_id,client_action_id,actor_id,semantic_digest,receipt) VALUES($1,$2,$3,$4,$5,$6)', [saved.session_id, saved.principal_id, saved.client_action_id, saved.actor_id, saved.semantic_digest, saved.receipt]);
    }
  });
  await t.test('Receipt 声明的世界事件缺失', async () => {
    const saved = (await db.pool.query('DELETE FROM world_events WHERE session_id=$1 AND session_seq=$2 RETURNING *', [room.sessionId, actual.receipt.actionEventRange.first])).rows[0];
    try {
      const sample = (await spatialEvaluationReport(db.pool, room.sessionId)).samples[0];
      assert.equal(sample.evidenceChain.status, 'INCOMPLETE');
      assert.ok(sample.evidenceChain.actions[0].issues.includes('WORLD_EVENT_RANGE_INCOMPLETE'));
      assert.equal(sample.evidenceChain.actions[0].worldEffect, 'UNCONFIRMED');
    } finally {
      await db.pool.query('INSERT INTO world_events(session_id,session_seq,event,event_text_encoding) VALUES($1,$2,$3,$4)', [saved.session_id, saved.session_seq, saved.event, saved.event_text_encoding]);
    }
  });
  await t.test('原上下文摘要错配', async () => {
    await db.pool.query('UPDATE ai_runs SET context_digest=$3 WHERE session_id=$1 AND decision_id=$2', [room.sessionId, decisionId, '0'.repeat(64)]);
    try {
      const sample = (await spatialEvaluationReport(db.pool, room.sessionId)).samples[0];
      assert.equal(sample.evidenceChain.status, 'INCOMPLETE');
      assert.ok(sample.evidenceChain.issues.includes('CONTEXT_BINDING_MISMATCH'));
      assert.deepEqual(sample.sourceObservations, []);
      assert.deepEqual(sample.heardClaims, []);
      assert.equal(sample.intent, null);
    } finally {
      await db.pool.query('UPDATE ai_runs SET context_digest=$3 WHERE session_id=$1 AND decision_id=$2', [room.sessionId, decisionId, hash(actual.prepared.context)]);
    }
  });
  const restored = (await spatialEvaluationReport(db.pool, room.sessionId)).samples[0];
  assert.equal(restored.evidenceChain.status, 'COMPLETE');
});

test('导出保持同一只读快照，不能把读到的 Receipt 与稍后删改的事件拼接', async () => {
  const room = await gaolaoRoom(runtime, clock, 2, 'gaolaozhuang-scene-v3');
  const actual = await controlledSample(room, { kind: 'speak', text: '一致快照内已提交的校准发言。', channel: 'public', recipientRefs: [] });
  let removed;
  const concurrentPool = { async connect() {
    const client = await db.pool.connect();
    return {
      async query(sql, parameters) {
        if (!removed && sql.startsWith('SELECT a.*')) {
          assert.equal((await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only, 'on');
          removed = (await db.pool.query('DELETE FROM world_events WHERE session_id=$1 AND session_seq=$2 RETURNING *', [room.sessionId, actual.receipt.actionEventRange.first])).rows[0];
        }
        return client.query(sql, parameters);
      },
      release() { client.release(); },
    };
  } };
  try {
    const report = await spatialEvaluationReport(concurrentPool, room.sessionId);
    assert.ok(removed);
    assert.equal((await db.pool.query('SELECT 1 FROM world_events WHERE session_id=$1 AND session_seq=$2', [removed.session_id, removed.session_seq])).rowCount, 0);
    assert.equal(report.samples[0].evidenceChain.status, 'COMPLETE');
    assert.equal(report.samples[0].evidenceChain.actions[0].worldEvents[0].sessionSeq, removed.session_seq);
  } finally {
    if (removed) await db.pool.query('INSERT INTO world_events(session_id,session_seq,event,event_text_encoding) VALUES($1,$2,$3,$4)', [removed.session_id, removed.session_seq, removed.event, removed.event_text_encoding]);
  }
  await assert.rejects(spatialEvaluationReport(db.pool, '不存在的校准会话'), /实际空间会话/);
  assert.equal((await spatialEvaluationReport(db.pool, room.sessionId)).samples[0].evidenceChain.status, 'COMPLETE');
});
