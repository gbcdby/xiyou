import assert from 'node:assert/strict';
import { startTestPostgres } from '../../backend/test-support/postgres.mjs';
import { createRuntime } from '../../backend/runtime.mjs';
import { ModelGateway } from '../../backend/ai/gateway.mjs';
import { AIOrchestrator } from '../../backend/ai/orchestrator.mjs';
import { createRunningRoom, until } from '../../backend/test-support/ai-room.mjs';

const database = await startTestPostgres('ai-requirements-r2');
const runtime = await createRuntime({ pool: database.pool });
const cases = [
  ['字面反斜线序列', '这段文字保留 \\u0000 字面值？', true],
  ['其他控制码元', '核查' + String.fromCharCode(1, 9, 10, 13, 31) + '？', true],
  ['有效补充平面与替换字符', '核查😀�？', true],
  ['解码后的实际 NUL', '核查' + String.fromCharCode(0) + '？', false],
];
try {
  for (const [name, text, allowed] of cases) {
    const room = await createRunningRoom(runtime);
    const handle = await runtime.bindInternal(room.sessionId, 'tangseng', 'core_npc');
    let decisionId; let original;
    const gateway = new ModelGateway({ provider: { kind: 'controlled', providerId: 'independent-requirements-probe', async generate(input) {
      decisionId = input.context.decision.decisionId;
      original = JSON.stringify({ decisionId, toolCalls: [{ kind: 'wait' }], dialogue: { channel: 'public', text, recipientIds: [] } });
      return { rawText: original };
    } }, modelId: 'controlled-unicode-boundary' });
    const ai = new AIOrchestrator({ runtime, gateway, maxCallsPerSession: 1, minIntervalMs: 10 });
    try {
      ai.watch(handle, { autoWake: false });
      await until(() => decisionId && ['Idle', 'Unavailable'].includes(ai.status(handle).phase), '边界样本未完成');
      assert.equal(ai.status(handle).error, null);
      const stored = (await database.pool.query('SELECT * FROM ai_runs WHERE session_id=$1 AND decision_id=$2', [room.sessionId, decisionId])).rows[0];
      assert.equal(stored.status, 'Resolved');
      assert.equal(stored.output_encoding, 'json-string-v1');
      assert.equal(JSON.parse(stored.output_raw), original);
      const result = await runtime.internalReceipt(handle, `${decisionId}:submit`);
      const fallback = await runtime.internalReceipt(handle, `${decisionId}:fallback`, true);
      const world = await runtime.replay(room.sessionId);
      if (allowed) {
        assert.equal(result?.status, 'Accepted');
        assert.equal(fallback, null);
        assert.ok(Object.values(world.claims).some(claim => claim.speakerId === 'tangseng' && claim.text === text));
      } else {
        assert.equal(result, null);
        assert.equal(fallback?.status, 'Accepted');
        assert.equal(stored.model_result.reason, 'UNPERSISTABLE_INTENT');
        assert.equal(Object.values(world.claims).some(claim => claim.text === text), false);
      }
      const unchanged = JSON.stringify(world);
      await ai.recover(handle);
      assert.equal(JSON.stringify(await runtime.replay(room.sessionId)), unchanged);
      assert.equal(gateway.metrics().calls, 1);
      assert.equal(gateway.metrics().externalCalls, 0);
      console.log(`通过：${name}；原文无损、结果与恢复一致。`);
    } finally { await ai.close(); }
  }
  console.log('4/4 独立 Unicode 持久边界检查通过；外部模型调用为 0。');
} finally { await runtime.close(); await database.stop(); }
