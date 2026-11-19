import { errorResponse } from './errors.mjs';

/** COMMIT 只标脏并尝试快速发布；既有维护的阻塞需求不能被后来的提交覆盖。 */
export function committedPublisher({ runtime, deliver, track = promise => promise, log = () => {} }) {
  let stopped = false, running = false, scheduled = null, dirty = false, includeLegacy = false, pendingBlocking = false, generation = 0;
  function schedule() {
    if (stopped || running || scheduled) return;
    scheduled = setImmediate(() => {
      scheduled = null;
      if (!stopped) track(run());
    });
  }
  function request(capability = 'spatial-v2', { progressLock = 'wait' } = {}) {
    if (stopped) return;
    dirty = true; generation++;
    pendingBlocking ||= progressLock !== 'try';
    if (capability === null) includeLegacy = true;
    schedule();
  }
  async function run() {
    if (stopped || running || !dirty) return;
    running = true;
    const started = generation, capability = includeLegacy ? null : 'spatial-v2', runBlocking = pendingBlocking;
    dirty = false; includeLegacy = false; pendingBlocking = false;
    let repeat = false;
    try {
      const result = await runtime.publishPending(deliver, { capability, isStopped: () => stopped, progressLock: runBlocking ? 'wait' : 'try' });
      if (stopped) return;
      if (result?.busy) {
        // 未取得owner，领取的需求仍未服务；只由下一个既有入口再次唤醒。
        dirty = true; pendingBlocking ||= runBlocking; includeLegacy ||= capability === null;
        return;
      }
      const pending = (await runtime.pool.query("SELECT 1 FROM outbox o JOIN sessions s ON s.session_id=o.session_id WHERE o.status='Pending' AND ($1::text IS NULL OR s.state->>'protocolCapability'=$1) LIMIT 1", [includeLegacy ? null : capability])).rowCount > 0;
      if (stopped) return;
      dirty ||= pending;
      const freshRequest = generation !== started;
      // 先判是否续轮，再继承模式；继承位本身不能让零进展Pending空转。
      repeat = pendingBlocking || (dirty && (result?.published > 0 || freshRequest || includeLegacy));
      if (repeat && !freshRequest) pendingBlocking ||= runBlocking;
    } catch (error) {
      const freshBlocking = pendingBlocking;
      dirty = true; pendingBlocking ||= runBlocking; includeLegacy ||= capability === null;
      // 只给在途新到的wait一次后续机会，不能把恢复位误当成新请求。
      repeat = freshBlocking;
      log('提交后的空间发布暂未完成，将保留 Pending 重试。', { code: errorResponse(error).code });
    } finally {
      running = false;
      if (repeat) schedule();
    }
  }
  return {
    request,
    close() { stopped = true; if (scheduled) clearImmediate(scheduled); scheduled = null; },
  };
}

/** 实验开关内的空间检查点；从不高频调用完整 maintenance。 */
export function attachSpatialDirection({ runtime, deliver, track, log = () => {} }) {
  if (!runtime.spatialDirection) return null;
  const publisher = committedPublisher({ runtime, deliver, track, log });
  const rooms = new Set();
  let stopped = false, scanning = false;
  const onCommit = ({ events }) => {
    if (events.some(event => event.schemaVersion === 2)) publisher.request('spatial-v2', { progressLock: 'try' });
  };
  runtime.on('commit', onCommit);
  const onSupplyReady = () => publisher.request('spatial-v2', { progressLock: 'wait' });
  runtime.on('spatial-supply-ready', onSupplyReady);
  async function checkpoint() {
    if (stopped || scanning) return;
    scanning = true;
    try {
      const active = (await runtime.pool.query("SELECT session_id FROM sessions WHERE state->>'protocolCapability'='spatial-v2' AND state->>'phase'='Running' AND state->>'paused'='false' AND EXISTS (SELECT 1 FROM jsonb_each(state->'characters') AS person WHERE person.value->>'kind'='human' AND person.value->>'mode'='HumanControlled' AND person.value->'movement'->>'status' IN ('accepted','moving'))")).rows;
      for (const row of active) {
        if (stopped || rooms.has(row.session_id)) continue;
        rooms.add(row.session_id);
        track(runtime.spatialCheckpoint(row.session_id)
          .catch(error => log('活动行走检查点暂未完成，将在下一轮重读。', { code: errorResponse(error).code }))
          .finally(() => rooms.delete(row.session_id)));
      }
    } catch (error) {
      log('活动行走检查点暂未完成，将在下一轮重读。', { code: errorResponse(error).code });
    } finally { scanning = false; }
  }
  const timer = setInterval(() => track(checkpoint()), runtime.spatialDirection.checkpointMs);
  timer.unref();
  return {
    publish: capability => publisher.request(capability, { progressLock: 'wait' }),
    close() { stopped = true; clearInterval(timer); runtime.off('commit', onCommit); runtime.off('spatial-supply-ready', onSupplyReady); publisher.close(); },
  };
}
