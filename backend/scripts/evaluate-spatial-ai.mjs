import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { decodeJsonbText } from '../jsonb-text.mjs';
import { decodeStoredOutput } from '../ai/output.mjs';

/** 只汇集已发生的合法模型样本，不发起推理，也不自动给出真人/质量 PASS。 */
export async function spatialEvaluationReport(pool, sessionId) {
  const session = (await pool.query("SELECT state->>'contentVersion' AS content_version,state->>'protocolCapability' AS capability FROM sessions WHERE session_id=$1", [sessionId])).rows[0];
  if (!session || session.capability !== 'spatial-v2') throw new Error('评价对象必须是实际空间会话。');
  const rows = (await pool.query('SELECT a.*,d.record FROM ai_runs a JOIN decisions d ON d.session_id=a.session_id AND d.decision_id=a.decision_id WHERE a.session_id=$1 ORDER BY a.created_at,a.decision_id', [sessionId])).rows;
  const samples = rows.map(row => {
    const context = decodeJsonbText(row.context, row.context_text_encoding), raw = decodeStoredOutput(row);
    let intent = null;
    if (row.semantic_digest && raw) { try { intent = JSON.parse(raw); } catch {} }
    return { decisionId: row.decision_id, actorId: row.actor_id, sourceKind: row.configuration.providerKind, configuration: row.configuration, createdAt: row.created_at, generation: row.record.generation, sourceObservations: context.projection?.observations ?? [], heardClaims: context.projection?.claims ?? [], persona: context.persona ?? null, goals: context.goals ?? [], model: row.model_result, intent, semanticDigest: row.semantic_digest, decisionStatus: row.record.status, runStatus: row.status, outcome: row.outcome, durationMs: row.model_result?.durationMs ?? null };
  });
  const externalCount = samples.filter(sample => sample.sourceKind === 'external').length;
  return { schemaVersion: 1, sessionId, contentVersion: session.content_version, evaluation: externalCount ? 'SAMPLES_COLLECTED' : 'NOT_RUN', scope: '真实模型样本汇集；因果、拒绝后补证、不同顺序、三角色公平、身份权限与真人趣味须分别复核。', controlledSamples: samples.length - externalCount, externalSamples: externalCount, coverage: { evidenceOrders: 'NOT_ASSESSED', refusalThenEvidence: 'NOT_ASSESSED', npcCommunication: 'NOT_ASSESSED', branches: 'NOT_ASSESSED', humanEnjoyment: 'NOT_RUN' }, samples };
}

async function main() {
  const sessionId = process.argv[2];
  if (!sessionId || !process.env.DATABASE_URL) throw new Error('请明确给出会话ID和 DATABASE_URL；此脚本只读取已保存样本。');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  try { console.log(JSON.stringify(await spatialEvaluationReport(pool, sessionId), null, 2)); }
  finally { await pool.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error('模型样本读取失败。', { code: error.code ?? 'EVALUATION_UNAVAILABLE', message: error.message }); process.exitCode = 1; });
