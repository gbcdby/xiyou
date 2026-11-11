import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { decodeStoredOutput } from '../ai/output.mjs';

/** 可选作者取证：只写显式指定目录，不收集数据库连接、环境或凭据。 */
export async function captureAI(database, name, additional = {}) {
  const directory = process.env.XIYOU_AI_EVIDENCE_DIR;
  if (!directory) return;
  const runs = (await database.pool.query(`SELECT a.session_id,a.actor_id,a.principal_kind,a.decision_id,a.context,a.context_digest,a.configuration,a.status,a.output_raw,a.output_encoding,a.semantic_digest,a.model_result,a.outcome,d.record AS decision
    FROM ai_runs a JOIN decisions d USING(session_id,decision_id) ORDER BY a.session_id,(d.record->>'generation')::numeric`)).rows.map(row => {
      const { output_encoding, ...run } = row;
      return { ...run, output_raw: decodeStoredOutput(row), output_storage_encoding: output_encoding ?? 'plain-text-legacy' };
    });
  const sessions = (await database.pool.query('SELECT DISTINCT s.session_id,s.content_digest,s.reducer_version FROM sessions s JOIN ai_runs a USING(session_id) ORDER BY s.session_id')).rows;
  const events = (await database.pool.query("SELECT event FROM world_events WHERE event->'causedBy'->>'decisionId' IS NOT NULL ORDER BY session_id,session_seq")).rows.map(row => row.event);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${name}.json`), JSON.stringify({ sourceCommit: process.env.XIYOU_AI_SOURCE_COMMIT ?? null, kind: '受控供应商实际检查', actualExternalModelCalls: 0, sessions, runs, events, ...additional }, null, 2) + '\n');
}
