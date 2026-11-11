import { ModelGateway } from './gateway.mjs';
import { AIOrchestrator } from './orchestrator.mjs';
import { createMockProvider, mockPolicies } from './mock-provider.mjs';

const attachments = new WeakSet();

/** 启动层只绑定可信角色身份；数据库和全世界状态不会进入 provider。 */
export async function attachMockAI({ runtime, minIntervalMs = 1000, maxCallsPerSession = 120, log = () => {} }) {
  if (attachments.has(runtime)) throw new Error('该权威实例已登记模拟角色策略。');
  const workers = Object.entries(mockPolicies).map(([actorId, policy]) => {
    const gateway = new ModelGateway({ provider: createMockProvider(actorId), modelId: policy.modelId });
    return { actorId, policy, gateway, orchestrator: new AIOrchestrator({ runtime, gateway, maxConcurrent: 1, minIntervalMs, maxCallsPerSession }), handles: new Map() };
  });
  const pending = new Map();
  let closed = false; let closing;
  attachments.add(runtime);
  function register(sessionId) {
    if (closed || workers.every(worker => worker.handles.has(sessionId))) return Promise.resolve();
    if (pending.has(sessionId)) return pending.get(sessionId);
    const task = (async () => {
      const row = (await runtime.pool.query("SELECT session_id FROM sessions WHERE session_id=$1 AND state->>'phase'='Running'", [sessionId])).rows[0];
      if (!row || closed) return;
      const bindings = [];
      for (const worker of workers) {
        if (worker.handles.has(sessionId)) continue;
        const handle = await runtime.bindInternal(sessionId, worker.actorId, 'core_npc');
        if (closed) return;
        bindings.push({ worker, handle });
      }
      for (const { worker, handle } of bindings) {
        worker.handles.set(sessionId, handle);
        worker.orchestrator.watch(handle, { autoWake: false });
      }
    })();
    pending.set(sessionId, task);
    task.finally(() => pending.delete(sessionId)).catch(() => {});
    return task;
  }
  const onCommit = ({ sessionId, events }) => {
    if (closed || events.some(event => ['session.finished', 'session.aborted'].includes(event.kind))) return;
    register(sessionId).catch(error => log('模拟角色登记暂未完成，后续提交将重试。', { code: error.code ?? 'INTERNAL_ERROR' }));
    // 通知只决定是否唤醒；模型仍由 Runtime 重建合法上下文，不接收事件原文。
    for (const worker of workers) {
      const handle = worker.handles.get(sessionId);
      if (handle && events.some(event => event.kind !== 'GoalUpdated' && event.audience.coreNpcCharacterIds.includes(worker.actorId))) worker.orchestrator.wake(handle);
    }
  };
  runtime.on('commit', onCommit);
  const attachment = {
    status() {
      return { mode: '模拟角色策略', minIntervalMs, maxCallsPerSession, closed, registering: pending.size, roles: workers.map(worker => ({
        actorId: worker.actorId, ...worker.policy, configuration: worker.gateway.configuration(), metrics: worker.gateway.metrics(),
        sessions: [...worker.handles].map(([sessionId, handle]) => ({ sessionId, ...worker.orchestrator.status(handle) })),
      })) };
    },
    close() {
      if (closing) return closing;
      closed = true; runtime.off('commit', onCommit);
      closing = (async () => {
        await Promise.allSettled([...pending.values()]);
        await Promise.all(workers.map(worker => worker.orchestrator.close()));
        for (const worker of workers) worker.handles.clear();
        attachments.delete(runtime);
      })();
      return closing;
    },
  };
  try {
    const rows = (await runtime.pool.query("SELECT session_id FROM sessions WHERE state->>'phase'='Running' ORDER BY session_id")).rows;
    await Promise.all(rows.map(row => register(row.session_id)));
    log('模拟角色策略已登记：唐僧核对安全与许可，悟空检查现场与来源。');
    return attachment;
  } catch (error) { await attachment.close(); throw error; }
}
