import { loadContent } from '../../content/index.mjs';
import { AIOrchestrator } from './orchestrator.mjs';

const attachments = new WeakSet();

/** 一个实例共享队列、并发与持久预算；内容注册决定参与者，不把第三人塞进真人席位。 */
export async function attachSpatialAI({ runtime, gateway, maxConcurrent = 2, minIntervalMs = 1000, maxCallsPerSession = 60, log = () => {} }) {
  if (attachments.has(runtime)) throw new Error('该权威实例已经登记空间自主角色。');
  if (!gateway || typeof gateway.generate !== 'function') throw new Error('空间自主角色需要明确注入 Model Gateway。');
  const orchestrator = new AIOrchestrator({ runtime, gateway, maxConcurrent, minIntervalMs, maxCallsPerSession });
  const sessions = new Map(), pending = new Map();
  let closed = false, closing;
  attachments.add(runtime);
  function register(sessionId) {
    if (closed || sessions.has(sessionId)) return Promise.resolve();
    if (pending.has(sessionId)) return pending.get(sessionId);
    const task = (async () => {
      const row = (await runtime.pool.query("SELECT state->>'contentVersion' AS content_version FROM sessions WHERE session_id=$1 AND state->>'protocolCapability'='spatial-v2' AND state->>'phase'='Running'", [sessionId])).rows[0];
      if (!row || closed) return;
      const content = await loadContent(row.content_version), registrations = [];
      for (const npc of content.npcs.filter(value => ['persistent_core', 'chapter_autonomous'].includes(value.actorKind))) {
        const handle = await runtime.bindInternal(sessionId, npc.characterId, 'core_npc');
        registrations.push({ actorId: npc.characterId, actorKind: npc.actorKind, handle });
      }
      if (closed) return;
      sessions.set(sessionId, { registrations, sceneRoles: content.npcs.filter(value => value.actorKind === 'scene_role').map(value => ({ actorId: value.characterId, policy: 'scene_rule' })) });
      for (const registration of registrations) orchestrator.watch(registration.handle);
    })();
    pending.set(sessionId, task);
    task.finally(() => pending.delete(sessionId)).catch(() => {});
    return task;
  }
  const onCommit = ({ sessionId, events }) => {
    if (closed || !events.some(event => event.schemaVersion === 2) || events.some(event => ['session.finished', 'session.aborted'].includes(event.kind))) return;
    register(sessionId).catch(error => log('空间自主角色登记暂未完成。', { code: error.code ?? 'INTERNAL_ERROR' }));
  };
  runtime.on('commit', onCommit);
  const attachment = {
    register,
    status() {
      return { closed, maxConcurrent, minIntervalMs, maxCallsPerSession, configuration: gateway.configuration(), metrics: gateway.metrics(), registering: pending.size, sessions: [...sessions].map(([sessionId, value]) => ({ sessionId, sceneRoles: value.sceneRoles, actors: value.registrations.map(({ actorId, actorKind, handle }) => ({ actorId, actorKind, ...orchestrator.status(handle) })) })) };
    },
    close() {
      if (closing) return closing;
      closed = true; runtime.off('commit', onCommit);
      closing = (async () => { await Promise.allSettled([...pending.values()]); await orchestrator.close(); sessions.clear(); attachments.delete(runtime); })();
      return closing;
    },
  };
  try {
    const rows = (await runtime.pool.query("SELECT session_id FROM sessions WHERE state->>'protocolCapability'='spatial-v2' AND state->>'phase'='Running' ORDER BY session_id")).rows;
    await Promise.all(rows.map(row => register(row.session_id)));
    return attachment;
  } catch (error) { await attachment.close(); throw error; }
}
