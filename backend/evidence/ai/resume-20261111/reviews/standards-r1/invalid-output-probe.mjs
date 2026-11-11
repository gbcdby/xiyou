import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { startTestPostgres } from './postgres.mjs';
import { createRuntime } from '../../backend/runtime.mjs';
import { ModelGateway } from '../../backend/ai/gateway.mjs';
import { AIOrchestrator } from '../../backend/ai/orchestrator.mjs';
import { createRunningRoom, until } from '../../backend/test-support/ai-room.mjs';

const results = [];
const database = await startTestPostgres('invalid-output');
const runtime = await createRuntime({ pool: database.pool });
try {
  for (const [name, output] of [
    ['普通非法 JSON 对照', () => '{bad'],
    ['含 U+0000 的非法 JSON', () => '{bad' + String.fromCharCode(0)],
    ['合法 JSON 中的 U+0000 对白', decisionId => JSON.stringify({ decisionId, toolCalls: [{ kind: 'wait' }], dialogue: { channel: 'public', text: '核查' + String.fromCharCode(0) + '？', recipientIds: [] } })],
  ]) {
    const room = await createRunningRoom(runtime);
    const handle = await runtime.bindInternal(room.sessionId, 'tangseng', 'core_npc');
    let decisionId;
    const gateway = new ModelGateway({ provider: { kind: 'controlled', providerId: 'review-local', async generate(input) {
      decisionId = input.context.decision.decisionId;
      return { rawText: output(decisionId) };
    } }, modelId: 'invalid-output-probe' });
    const ai = new AIOrchestrator({ runtime, gateway, maxCallsPerSession: 1, minIntervalMs: 10 });
    try {
      ai.watch(handle, { autoWake: false });
      await until(() => decisionId && ['Idle', 'Unavailable'].includes(ai.status(handle).phase), '输出应到达可观察终态');
      const beforeRecovery = {
        status: ai.status(handle),
        decision: (await runtime.decisionState(handle, decisionId)).status,
        run: (await database.pool.query('SELECT status,model_result,output_raw IS NOT NULL AS has_raw FROM ai_runs WHERE session_id=$1 AND decision_id=$2', [room.sessionId, decisionId])).rows[0],
        fallback: await runtime.internalReceipt(handle, `${decisionId}:fallback`, true),
      };
      let recoveryError = null;
      try { await ai.recover(handle); } catch (error) { recoveryError = { code: error.code, message: error.message }; }
      const result = {
        name, beforeRecovery, recoveryError,
        afterRecovery: { status: ai.status(handle), decision: (await runtime.decisionState(handle, decisionId)).status, fallback: await runtime.internalReceipt(handle, `${decisionId}:fallback`, true) },
        gatewayMetrics: gateway.metrics(),
      };
      if (name === '普通非法 JSON 对照') { assert.equal(result.beforeRecovery.decision, 'Rejected'); assert.equal(result.beforeRecovery.fallback.status, 'Accepted'); }
      results.push(result); console.log(JSON.stringify(result));
    } finally { await ai.close(); }
  }
} finally { await runtime.close(); await database.stop(); }
await writeFile(new URL('./invalid-output-result.json', import.meta.url), JSON.stringify({ node: process.version, databaseOutput: database.output, results }, null, 2) + '\n');
