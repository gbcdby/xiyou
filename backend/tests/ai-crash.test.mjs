import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createRuntime } from '../runtime.mjs';
import { ModelGateway } from '../ai/gateway.mjs';
import { AIOrchestrator } from '../ai/orchestrator.mjs';
import { createRunningRoom } from '../test-support/ai-room.mjs';
import { captureAI } from '../test-support/ai-evidence.mjs';

test('真实进程崩溃：模型原文、独立 fallback、原意图 ACK 与发布恢复', async t => {
  const database = await startTestPostgres('ai-crash');
  const runtime = await createRuntime({ pool: database.pool });
  const exits = [];
  t.after(async () => { await runtime.close(); try { await captureAI(database, 'crash', { exits }); } finally { await database.stop(); } });
  for (const [phase, code] of [['after-output', 81], ['before-fallback', 82], ['after-fallback', 83], ['after-intent', 84], ['during-publish', 85]]) await t.test(phase, async subtest => {
    const room = await createRunningRoom(runtime);
    const child = fork(fileURLToPath(new URL('../test-support/ai-crash-worker.mjs', import.meta.url)), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
    const messages = []; child.on('message', value => messages.push(value));
    const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (exitCode, signal) => resolve({ exitCode, signal })); });
    let timer;
    try {
      child.send({ phase, connection: database.connection, sessionId: room.sessionId, token: room.users[0].token });
      const exit = await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('AI 故障子进程没有按时退出。')); }, 10000); })]);
      assert.equal(exit.exitCode, code, stderr); assert.equal(exit.signal, null);
      const prepared = messages.find(value => value.type === 'prepared'); assert.ok(prepared);
      exits.push({ phase, ...exit, decisionId: prepared.decisionId, configuration: prepared.configuration, metricsAtProviderEntry: prepared.metrics });
      const recovered = await createRuntime({ pool: database.pool });
      const handle = await recovered.bindInternal(room.sessionId, 'tangseng', 'core_npc');
      const gateway = new ModelGateway({ provider: { kind: 'controlled', providerId: 'controlled-recovery', generate() { throw new Error('恢复不能发起新模型调用'); } }, modelId: 'unused-v1' });
      const orchestrator = new AIOrchestrator({ runtime: recovered, gateway });
      try {
        orchestrator.watch(handle, { wake: false, autoWake: false });
        const old = await recovered.internalReceipt(handle, `${prepared.decisionId}:submit`);
        const oldFallback = await recovered.internalReceipt(handle, `${prepared.decisionId}:fallback`, true);
        if (phase === 'after-output' || phase.includes('fallback')) assert.equal(old, null);
        else assert.equal(old.status, 'Accepted');
        if (phase === 'before-fallback') assert.equal(oldFallback, null);
        if (phase === 'after-fallback') assert.equal(oldFallback.status, 'Accepted');
        assert.equal((await orchestrator.recover(handle)).blocked, false);
        const receipt = await recovered.internalReceipt(handle, `${prepared.decisionId}:submit`);
        const fallback = await recovered.internalReceipt(handle, `${prepared.decisionId}:fallback`, true);
        if (phase.includes('fallback')) {
          assert.equal(receipt, null); assert.equal(fallback.status, 'Accepted'); assert.equal(fallback.actionEventRange, null);
          assert.equal((await recovered.decisionState(handle, prepared.decisionId)).status, 'Rejected');
        } else {
          assert.equal(receipt.status, 'Accepted'); assert.equal(fallback, null);
          if (old) assert.deepEqual(receipt, old);
          assert.equal((await recovered.decisionState(handle, prepared.decisionId)).status, 'Committed');
        }
        const state = await recovered.replay(room.sessionId);
        const saved = (await database.pool.query('SELECT state FROM sessions WHERE session_id=$1', [room.sessionId])).rows[0].state;
        assert.deepEqual(state, saved);
        await orchestrator.recover(handle);
        assert.deepEqual(await recovered.replay(room.sessionId), state);
        const count = (await database.pool.query('SELECT count(*) FROM action_receipts WHERE session_id=$1 AND client_action_id IN ($2,$3)', [room.sessionId, `${prepared.decisionId}:submit`, `${prepared.decisionId}:fallback`])).rows[0].count;
        assert.equal(count, '1');
        const run = (await database.pool.query('SELECT output_raw,status FROM ai_runs WHERE session_id=$1 AND decision_id=$2', [room.sessionId, prepared.decisionId])).rows[0];
        assert.equal(run.output_raw, prepared.raw); assert.equal(run.status, 'Resolved');
        assert.equal(gateway.metrics().calls, 0);
        await recovered.publishPending();
        assert.equal((await database.pool.query("SELECT count(*) FROM outbox WHERE session_id=$1 AND status='Pending'", [room.sessionId])).rows[0].count, '0');
        if (phase === 'during-publish') assert.ok(messages.some(value => value.type === 'delivered'));
        subtest.diagnostic(`真实子进程退出码 ${exit.exitCode}，信号为空；恢复保留原决定及原文，未新增模型调用。`);
      } finally { await orchestrator.close(); await recovered.close(); }
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited;
    }
  });
});
