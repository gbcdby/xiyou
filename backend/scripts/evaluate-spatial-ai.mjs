import pg from 'pg';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { canonicalize } from '../../protocol/node.mjs';
import { validateSpatial } from '../../protocol/spatial.mjs';
import { parseSpatialProposedIntent, spatialIntentSemanticDigestSync } from '../../protocol/spatial-ai-node.mjs';
import { decodeJsonbText } from '../jsonb-text.mjs';
import { decodeStoredOutput, outputStringDigest } from '../ai/output.mjs';

const digest = value => createHash('sha256').update(canonicalize(value)).digest('hex');
const resultStatus = issues => issues.length ? 'INCOMPLETE' : 'COMPLETE';

/** 只读取原 actor/action 的权威收据；缓存 outcome 不能充当已落地的证据。 */
async function actionEvidence(client, row, mode, intent) {
  const fallback = mode === 'fallback', actionId = `${row.decision_id}:${fallback ? 'fallback' : 'submit'}`;
  const principalId = fallback ? 'system' : `${row.principal_kind}:${row.actor_id}`;
  const trace = { mode, actionId, status: 'INCOMPLETE', issues: [], requestDigest: null, receiptDigest: null, receipt: null, worldEffect: 'UNKNOWN', worldEvents: [] };
  const finish = () => ({ ...trace, status: resultStatus(trace.issues) });
  const stored = (await client.query(`SELECT i.request,i.request_text_encoding,i.execution_context,
    r.semantic_digest,r.receipt FROM spatial_intents i LEFT JOIN action_receipts r
    ON r.session_id=i.session_id AND r.actor_id=i.actor_id AND r.client_action_id=i.intent_id AND r.principal_id=$4
    WHERE i.session_id=$1 AND i.actor_id=$2 AND i.intent_id=$3`, [row.session_id, row.actor_id, actionId, principalId])).rows[0];
  if (!stored) { trace.issues.push('ORIGINAL_REQUEST_MISSING'); return finish(); }
  let request;
  try {
    request = validateSpatial('PublicEnvelope', decodeJsonbText(stored.request, stored.request_text_encoding));
    const action = fallback ? row.record.fallback : intent?.toolCalls[0];
    const expectedAction = action && { ...action, ...(['move_to', 'stop_move'].includes(action.kind) ? { movementCommandSeq: row.record.movementCommandSeq } : {}) };
    const expectedIntentDigest = fallback ? digest({ decisionId: row.decision_id, fallback: row.record.fallback }) : row.semantic_digest;
    const binding = stored.execution_context;
    if (request.sessionId !== row.session_id || request.clientActionId !== actionId || request.actorRef !== row.record.actorRef
      || request.viewId !== row.record.viewId || request.controlEpoch !== row.record.controlEpoch || request.baseSeq !== row.record.baseSeq
      || binding?.decisionId !== row.decision_id || binding.generation !== row.record.generation || binding.mode !== mode
      || binding.intentDigest !== expectedIntentDigest || !expectedAction || canonicalize(request.action) !== canonicalize(expectedAction)) throw new Error('请求不属于原决定。');
    trace.requestDigest = digest(request);
  } catch { trace.issues.push('REQUEST_BINDING_MISMATCH'); return finish(); }
  if (!stored.receipt) { trace.issues.push('AUTHORITATIVE_RECEIPT_MISSING'); return finish(); }
  try {
    const receipt = validateSpatial('ReceiptV2', stored.receipt.publicReceipt);
    if (stored.receipt.actorId !== row.actor_id || receipt.sessionId !== row.session_id || receipt.clientActionId !== actionId
      || stored.semantic_digest !== trace.requestDigest || stored.receipt.semanticDigest !== trace.requestDigest) throw new Error('收据不属于原请求。');
    trace.receipt = receipt;
    trace.receiptDigest = digest(receipt);
  } catch { trace.issues.push('RECEIPT_BINDING_MISMATCH'); return finish(); }
  const range = trace.receipt.actionEventRange;
  if (!range) {
    trace.worldEffect = trace.receipt.status === 'Rejected' ? 'REJECTED_NO_EFFECT' : 'NO_CHANGE';
    if (trace.receipt.status === 'Accepted' && trace.receipt.code !== 'NO_CHANGE') trace.issues.push('WORLD_EVENT_RANGE_MISSING');
    return finish();
  }
  const events = (await client.query('SELECT session_seq,event,event_text_encoding FROM world_events WHERE session_id=$1 AND session_seq BETWEEN $2 AND $3 ORDER BY session_seq', [row.session_id, range.first, range.last])).rows;
  if (BigInt(events.length) !== BigInt(range.last) - BigInt(range.first) + 1n) trace.issues.push('WORLD_EVENT_RANGE_INCOMPLETE');
  for (const entry of events) {
    const event = decodeJsonbText(entry.event, entry.event_text_encoding);
    if (event.sessionId !== row.session_id || event.sessionSeq !== entry.session_seq || event.causedBy?.actionId !== actionId
      || event.causedBy.actorId !== row.actor_id || event.causedBy.principalId !== principalId) {
      if (!trace.issues.includes('WORLD_EVENT_BINDING_MISMATCH')) trace.issues.push('WORLD_EVENT_BINDING_MISMATCH');
      continue;
    }
    // 世界事件可能同时通知不同观察者；此报告不带出 payload、audience 或其他人的投影。
    trace.worldEvents.push({ eventId: event.eventId, sessionSeq: event.sessionSeq, kind: event.kind, digest: digest(event) });
  }
  trace.worldEffect = trace.issues.length ? 'UNCONFIRMED' : 'EVENTS_COMMITTED';
  return finish();
}

async function sampleEvidence(client, row) {
  const issues = [];
  let context = null, raw = null, intent = null;
  try {
    context = decodeJsonbText(row.context, row.context_text_encoding);
    const original = decodeJsonbText(row.record.contextSnapshot, row.record.contextEncoding);
    if (context.sessionId !== row.session_id || context.decision?.decisionId !== row.decision_id || row.record.sessionId !== row.session_id
      || row.record.actorId !== row.actor_id || row.record.decisionId !== row.decision_id || context.snapshotSeq !== row.record.baseSeq
      || context.viewId !== row.record.viewId || context.projection?.self.entityRef !== row.record.actorRef
      || digest(context) !== row.context_digest || row.record.contextDigest !== row.context_digest || digest(original) !== row.context_digest) throw new Error('上下文不属于原决定。');
  } catch { context = null; issues.push('CONTEXT_BINDING_MISMATCH'); }
  try { raw = decodeStoredOutput(row); }
  catch { issues.push('MODEL_OUTPUT_MISMATCH'); }
  if (!row.model_result) issues.push('MODEL_RESULT_MISSING');
  if (row.model_result?.contextDigest && row.model_result.contextDigest !== row.context_digest) issues.push('MODEL_CONTEXT_MISMATCH');
  if (row.semantic_digest) {
    try {
      if (!context || typeof raw !== 'string') throw new Error('有效原文或上下文缺失。');
      intent = parseSpatialProposedIntent(raw, row.decision_id, context);
      if (spatialIntentSemanticDigestSync(intent) !== row.semantic_digest) throw new Error('意图摘要不匹配。');
    } catch { intent = null; issues.push('MODEL_INTENT_MISMATCH'); }
  } else if (row.model_result?.status === 'Valid') issues.push('MODEL_INTENT_MISSING');
  const modes = [...(row.semantic_digest ? ['intent'] : []), ...(['Rejected', 'Expired'].includes(row.record.status) || row.outcome?.fallback ? ['fallback'] : [])];
  const actions = [];
  for (const mode of modes) actions.push(await actionEvidence(client, row, mode, intent));
  if (row.status !== 'Resolved' || !row.outcome) issues.push('RUN_NOT_RESOLVED');
  for (const action of actions) if (row.outcome) {
    const cached = row.outcome[action.mode === 'fallback' ? 'fallback' : 'receipt'];
    if (canonicalize(cached ?? null) !== canonicalize(action.receipt)) issues.push(`${action.mode.toUpperCase()}_OUTCOME_MISMATCH`);
  }
  // outcome 是调度缓存；错绑缓存只报告缺口，不把其中另一个房间的 Receipt 带出。
  const outcome = row.outcome ? {
    decisionStatus: row.outcome.decisionStatus,
    receipt: actions.find(action => action.mode === 'intent')?.receipt ?? null,
    fallback: actions.find(action => action.mode === 'fallback')?.receipt ?? null,
    ...(row.outcome.rejectionReason ? { rejectionReason: row.outcome.rejectionReason } : {}),
  } : null;
  const evidenceChain = {
    schemaVersion: 1, status: resultStatus([...issues, ...actions.flatMap(action => action.issues)]), issues,
    context: { digest: row.context_digest, baseSeq: row.record.baseSeq, generation: row.record.generation },
    output: { status: row.model_result?.status ?? null, stringDigest: typeof raw === 'string' ? outputStringDigest(raw) : null, semanticDigest: row.semantic_digest },
    actions,
  };
  return { context, intent, outcome, evidenceChain };
}

/** 只汇集已发生的合法模型样本，不发起推理，也不自动给出真人/质量 PASS。 */
export async function spatialEvaluationReport(pool, sessionId) {
  const client = await pool.connect();
  try {
    // 输出、决定、收据和事件必须来自同一个已提交快照，不能拼接导出期间的不同状态。
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const session = (await client.query("SELECT state->>'contentVersion' AS content_version,state->>'protocolCapability' AS capability,state->>'sessionSeq' AS snapshot_seq FROM sessions WHERE session_id=$1", [sessionId])).rows[0];
    if (!session || session.capability !== 'spatial-v2') throw new Error('评价对象必须是实际空间会话。');
    const rows = (await client.query('SELECT a.*,d.record FROM ai_runs a JOIN decisions d ON d.session_id=a.session_id AND d.decision_id=a.decision_id WHERE a.session_id=$1 ORDER BY a.created_at,a.decision_id', [sessionId])).rows;
    const samples = [];
    for (const row of rows) {
      const { context, intent, outcome, evidenceChain } = await sampleEvidence(client, row);
      samples.push({ decisionId: row.decision_id, actorId: row.actor_id, sourceKind: row.configuration.providerKind, configuration: row.configuration, createdAt: row.created_at, generation: row.record.generation, sourceObservations: context?.projection?.observations ?? [], heardClaims: context?.projection?.claims ?? [], persona: context?.persona ?? null, goals: context?.goals ?? [], model: row.model_result, intent, semanticDigest: row.semantic_digest, decisionStatus: row.record.status, runStatus: row.status, outcome, durationMs: row.model_result?.durationMs ?? null, evidenceChain });
    }
    await client.query('COMMIT');
    const externalCount = samples.filter(sample => sample.sourceKind === 'external').length;
    return { schemaVersion: 1, sessionId, contentVersion: session.content_version, snapshotSeq: session.snapshot_seq, evaluation: externalCount ? 'SAMPLES_COLLECTED' : 'NOT_RUN', scope: '真实模型样本汇集；因果、拒绝后补证、不同顺序、三角色公平、身份权限与真人趣味须分别复核。', controlledSamples: samples.length - externalCount, externalSamples: externalCount, coverage: { evidenceOrders: 'NOT_ASSESSED', refusalThenEvidence: 'NOT_ASSESSED', npcCommunication: 'NOT_ASSESSED', branches: 'NOT_ASSESSED', humanEnjoyment: 'NOT_RUN' }, samples };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function main() {
  const sessionId = process.argv[2];
  if (!sessionId || !process.env.DATABASE_URL) throw new Error('请明确给出会话ID和 DATABASE_URL；此脚本只读取已保存样本。');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  try { console.log(JSON.stringify(await spatialEvaluationReport(pool, sessionId), null, 2)); }
  finally { await pool.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error('模型样本读取失败。', { code: error.code ?? 'EVALUATION_UNAVAILABLE', message: error.message }); process.exitCode = 1; });
