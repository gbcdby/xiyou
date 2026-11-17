import { errorResponse } from './errors.mjs';

/** COMMIT 监听只标脏。发布中再次提交不丢唤醒；无进展或异常交回原 200ms 兜底。 */
export function committedPublisher({ runtime, deliver, track = promise => promise, log = () => {} }) {
  let stopped = false, running = false, scheduled = null, dirty = false, includeLegacy = false, generation = 0;
  function schedule() {
    if (stopped || running || scheduled) return;
    scheduled = setImmediate(() => {
      scheduled = null;
      if (!stopped) track(run());
    });
  }
  function request(capability = 'spatial-v2') {
    if (stopped) return;
    dirty = true; generation++;
    if (capability === null) includeLegacy = true;
    schedule();
  }
  async function run() {
    if (stopped || running || !dirty) return;
    running = true;
    const started = generation, capability = includeLegacy ? null : 'spatial-v2';
    dirty = false; includeLegacy = false;
    let repeat = false;
    try {
      const result = await runtime.publishPending(deliver, { capability, isStopped: () => stopped });
      if (stopped) return;
      const pending = (await runtime.pool.query("SELECT 1 FROM outbox o JOIN sessions s ON s.session_id=o.session_id WHERE o.status='Pending' AND ($1::text IS NULL OR s.state->>'protocolCapability'=$1) LIMIT 1", [includeLegacy ? null : capability])).rowCount > 0;
      dirty ||= pending;
      // 本轮尚未尝试的新提交须再读一次，不能被旧安装围栏的零进展吞掉。
      // 新一轮会记住当前代次；若仍只有同一批无进展记录，就交回定时兜底。
      repeat = dirty && !result?.busy && (result?.published > 0 || generation !== started || includeLegacy);
    } catch (error) {
      dirty = true;
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
    if (events.some(event => event.schemaVersion === 2)) publisher.request();
  };
  runtime.on('commit', onCommit);
  const onSupplyReady = () => publisher.request();
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
    publish: capability => publisher.request(capability),
    close() { stopped = true; clearInterval(timer); runtime.off('commit', onCommit); runtime.off('spatial-supply-ready', onSupplyReady); publisher.close(); },
  };
}
