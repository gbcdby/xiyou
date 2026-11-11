import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startTestPostgres } from '../../backend/test-support/postgres.mjs';
import { createRuntime } from '../../backend/runtime.mjs';
import { createRunningRoom } from '../../backend/test-support/ai-room.mjs';
import { captureAI } from '../../backend/test-support/ai-evidence.mjs';
import { reserveCall, saveOutput } from '../../backend/ai/persistence.mjs';
import { parseProposedIntent, intentSemanticDigestSync } from '../../protocol/node.mjs';

const database = await startTestPostgres('ai-output-capture');
const runtime = await createRuntime({ pool: database.pool });
try {
  const room = await createRunningRoom(runtime);
  const handle = await runtime.bindInternal(room.sessionId, 'tangseng', 'core_npc');
  const expected = new Map();
  for (const invalid of [false, true]) {
    const prepared = await runtime.prepareDecisionContext(handle);
    const raw = invalid ? '{bad' + String.fromCharCode(0, 0xd800) : JSON.stringify({ decisionId: prepared.decision.decisionId, toolCalls: [{ kind: 'wait' }] });
    await reserveCall(runtime, handle, prepared, { providerKind: 'controlled' }, 2);
    await saveOutput(runtime, handle, prepared.decision.decisionId, { status: invalid ? 'Invalid' : 'Valid', rawText: raw, ...(!invalid ? { semanticDigest: intentSemanticDigestSync(parseProposedIntent(raw, prepared.decision.decisionId)) } : {}) });
    expected.set(prepared.decision.decisionId, raw);
  }
  process.env.XIYOU_AI_EVIDENCE_DIR = new URL('./captures/', import.meta.url).pathname;
  await captureAI(database, 'output');
  const captured = JSON.parse(await readFile(new URL('./captures/output.json', import.meta.url), 'utf8'));
  assert.equal(captured.runs.length, 2);
  for (const run of captured.runs) {
    assert.equal(run.output_raw, expected.get(run.decision_id));
    assert.equal(run.output_storage_encoding, 'json-string-v1');
    assert.equal(Object.hasOwn(run, 'output_encoding'), false);
    if (run.semantic_digest) assert.equal(intentSemanticDigestSync(parseProposedIntent(run.output_raw, run.decision_id)), run.semantic_digest);
  }
  console.log('真实 PostgreSQL 取证消费者：有效原文和含 NUL/孤立 surrogate 原文均无损，原语义摘要校验通过。');
} finally { await runtime.close(); await database.stop(); }
