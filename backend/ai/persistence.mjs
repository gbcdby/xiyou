import { createHash } from 'node:crypto';
import { canonicalize, parseProposedIntent, intentSemanticDigestSync } from '../../protocol/node.mjs';
import { ownRecord } from '../../game/records.mjs';
import { RuntimeError } from '../errors.mjs';
import { encodeOutput, decodeStoredOutput, outputStringDigest } from './output.mjs';
import { parseSpatialProposedIntent } from '../../protocol/spatial-ai.mjs';
import { spatialIntentSemanticDigestSync } from '../../protocol/spatial-ai-node.mjs';
import { encodeJsonbText, decodeJsonbText } from '../jsonb-text.mjs';

const digest = value => createHash('sha256').update(canonicalize(value)).digest('hex');
const mode = principal => principal.principalKind === 'core_npc' ? 'CoreNPCControlled' : 'AIProxyControlled';

export async function callCount(runtime, handle) {
  const principal = runtime.internal(handle);
  return runtime.locked(principal.sessionId, { kind: 'ai-budget' }, async tx => {
    await runtime.authorizeInternal(tx, principal);
    return Number((await tx.client.query('SELECT count(*) FROM ai_runs WHERE session_id=$1', [principal.sessionId])).rows[0].count);
  });
}

/** 预留计入本局持久调用预算；进程重启不能重置费用上限。 */
export async function reserveCall(runtime, handle, prepared, configuration, maxCalls) {
  const principal = runtime.internal(handle);
  return runtime.locked(principal.sessionId, { kind: 'ai-reserve' }, async tx => {
    await runtime.authorizeInternal(tx, principal); await runtime.deadline(tx);
    const record = (await tx.client.query('SELECT record FROM decisions WHERE session_id=$1 AND decision_id=$2 AND actor_id=$3', [principal.sessionId, prepared.decision.decisionId, principal.actorId])).rows[0]?.record;
    const actor = ownRecord(tx.state.characters, principal.actorId);
    if (!record || record.status !== 'Pending' || tx.state.phase !== 'Running' || actor.mode !== mode(principal) || actor.controlEpoch !== record.controlEpoch || tx.time >= record.deadlineAt) return { reserved: false, reason: 'STALE' };
    const matched = record.schemaVersion === 2
      ? canonicalize(record) === canonicalize(prepared.decision) && record.contextDigest === digest(prepared.context) && prepared.context.schemaVersion === 2 && prepared.context.decision.decisionId === record.decisionId
      : canonicalize(record) === canonicalize(prepared.context.decision) && prepared.context.actorId === principal.actorId && prepared.context.principalKind === principal.principalKind;
    if (!matched || prepared.context.sessionId !== principal.sessionId) throw new RuntimeError('FORBIDDEN', '上下文必须匹配本次可信决策。');
    const existing = await tx.client.query('SELECT 1 FROM ai_runs WHERE session_id=$1 AND decision_id=$2', [principal.sessionId, record.decisionId]);
    if (existing.rowCount) return { reserved: false, reason: 'EXISTS' };
    const count = Number((await tx.client.query('SELECT count(*) FROM ai_runs WHERE session_id=$1', [principal.sessionId])).rows[0].count);
    if (count >= maxCalls) return { reserved: false, reason: 'CALL_BUDGET' };
    const encoded = record.schemaVersion === 2 ? encodeJsonbText(prepared.context) : { value: prepared.context, encoding: null };
    await tx.client.query("INSERT INTO ai_runs(session_id,decision_id,actor_id,principal_kind,context,context_digest,configuration,status,created_at,context_text_encoding) VALUES($1,$2,$3,$4,$5,$6,$7,'Reserved',$8,$9)", [principal.sessionId, record.decisionId, principal.actorId, principal.principalKind, encoded.value, digest(prepared.context), configuration, tx.time, encoded.encoding]);
    return { reserved: true };
  });
}

/** 保存原文先于任何提交；不能用第二次模型输出覆盖相同决定。 */
export async function saveOutput(runtime, handle, decisionId, output) {
  const principal = runtime.internal(handle);
  return runtime.locked(principal.sessionId, { kind: 'ai-output' }, async tx => {
    await runtime.authorizeInternal(tx, principal); await runtime.deadline(tx);
    const run = (await tx.client.query('SELECT * FROM ai_runs WHERE session_id=$1 AND decision_id=$2 AND actor_id=$3 AND principal_kind=$4', [principal.sessionId, decisionId, principal.actorId, principal.principalKind])).rows[0];
    if (!run) throw new RuntimeError('FORBIDDEN', '模型调用记录不属于当前主体。');
    if (run.status !== 'Reserved') {
      if (decodeStoredOutput(run) !== (output.rawText ?? null) || run.semantic_digest !== (output.semanticDigest ?? null)) throw new RuntimeError('ACTION_ID_REUSE', '该决定已保存另一份输出。');
      return;
    }
    const context = decodeJsonbText(run.context, run.context_text_encoding);
    if (output.status === 'Valid') {
      const semanticDigest = context.schemaVersion === 2 ? spatialIntentSemanticDigestSync(parseSpatialProposedIntent(output.rawText, decisionId, context)) : intentSemanticDigestSync(parseProposedIntent(output.rawText, decisionId));
      if (semanticDigest !== output.semanticDigest) throw new RuntimeError('INVALID_MESSAGE', '模型输出摘要不匹配。');
    }
    const { rawText, ...metadata } = output;
    const encoded = encodeOutput(rawText);
    if (typeof rawText === 'string') metadata.outputStringDigest = outputStringDigest(rawText);
    await tx.client.query("UPDATE ai_runs SET status='Ready',output_raw=$3,semantic_digest=$4,model_result=$5,output_encoding=$6 WHERE session_id=$1 AND decision_id=$2", [principal.sessionId, decisionId, encoded.raw, output.semanticDigest ?? null, metadata, encoded.encoding]);
  });
}

export async function saveOutcome(runtime, handle, decisionId, outcome) {
  const principal = runtime.internal(handle);
  return runtime.locked(principal.sessionId, { kind: 'ai-outcome' }, async tx => {
    await runtime.authorizeInternal(tx, principal); await runtime.deadline(tx);
    await tx.client.query("UPDATE ai_runs SET status='Resolved',outcome=$5 WHERE session_id=$1 AND decision_id=$2 AND actor_id=$3 AND principal_kind=$4", [principal.sessionId, decisionId, principal.actorId, principal.principalKind, outcome]);
  });
}
