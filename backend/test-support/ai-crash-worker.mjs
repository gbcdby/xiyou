import pg from 'pg';
import { createRuntime } from '../runtime.mjs';
import { ModelGateway } from '../ai/gateway.mjs';
import { AIOrchestrator } from '../ai/orchestrator.mjs';
import { until } from './ai-room.mjs';

const send = value => new Promise((resolve, reject) => process.send(value, error => error ? reject(error) : resolve()));

// 父进程持有真实数据库；故障参数只通过测试 IPC 进入，未注册任何网络后门。
process.once('message', async input => {
  const pool = new pg.Pool({ ...input.connection, max: 4 });
  let runtime; let orchestrator; let armed = false;
  try {
    runtime = await createRuntime({ pool, hooks: {
      beforeCommit({ command }) { if (armed && command === 'fallback' && input.phase === 'before-fallback') process.exit(82); },
      afterCommit({ command }) {
        if (armed && command === 'ai-output' && input.phase === 'after-output') process.exit(81);
        if (armed && command === 'fallback' && input.phase === 'after-fallback') process.exit(83);
        if (armed && command === 'intent' && input.phase === 'after-intent') process.exit(84);
      },
      duringPublish({ sessionId }) { if (armed && sessionId === input.sessionId && input.phase === 'during-publish') process.exit(85); },
    } });
    await runtime.publishPending();
    const reader = await runtime.openConnection(input.token);
    await runtime.subscribe(reader, input.sessionId);
    const handle = await runtime.bindInternal(input.sessionId, 'tangseng', 'core_npc');
    const gateway = new ModelGateway({ provider: { kind: 'controlled', providerId: 'controlled-crash', async generate(request) {
      await runtime.publishPending();
      const decisionId = request.context.decision.decisionId;
      const rawText = Object.hasOwn(input, 'rawText') ? input.rawText : input.phase.includes('fallback') ? '{invalid' : JSON.stringify({ decisionId, toolCalls: [{ kind: 'inspect', targetId: 'passage_structure' }] });
      await send({ type: 'prepared', decisionId, raw: rawText, snapshotSeq: request.context.snapshotSeq, configuration: gateway.configuration(), metrics: gateway.metrics() });
      armed = true;
      return { rawText };
    } }, modelId: 'crash-v1' });
    orchestrator = new AIOrchestrator({ runtime, gateway, maxCallsPerSession: 1, minIntervalMs: 10 });
    orchestrator.watch(handle);
    await until(() => ['Idle', 'BudgetExhausted'].includes(orchestrator.status(handle).phase) && orchestrator.status(handle).lastReceipt !== null, '预定提交没有完成', 5000);
    await send({ type: 'ack', receipt: orchestrator.status(handle).lastReceipt });
    await runtime.publishPending(async (_connectionId, batch) => { await send({ type: 'delivered', throughSeq: batch.throughSeq }); });
    throw new Error('预定故障点没有终止进程。');
  } catch (error) {
    console.error('AI 故障检查未到达预定阶段。', error.code ?? error.name);
    await orchestrator?.close(); await runtime?.close(); await pool.end(); process.exit(2);
  }
});
