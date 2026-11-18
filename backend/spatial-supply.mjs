import { setImmediate as yieldToIO } from 'node:timers/promises';
import { parseSpatial } from '../protocol/spatial.mjs';
import { RuntimeError } from './errors.mjs';
import { consumeQueuedPacket } from './socket-enqueue.mjs';
import { directionCapability, timedTrailCapability } from './spatial-direction-config.mjs';

const resync = () => new RuntimeError('RESYNC_REQUIRED', '当前连接的连续发送前缀已经失效，请重新取得快照。');

/** 连接本地的发送顺序；每一次读取仍调用原授权事务，绝不缓存读权。 */
export function createSpatialSupply(runtime) {
  const sent = new WeakMap(), lanes = new WeakMap();
  const enabled = handle => !!runtime.spatialDirection && ['spatial-v2', directionCapability, timedTrailCapability]
    .every(capability => runtime.connection(handle).capabilities.includes(capability));
  const current = (handle, view) => !!view?.active && runtime.connectionView(handle) === view
    && !runtime.connection(handle).closing && !runtime.pendingViewInstallation(handle)
    && view.scope.generation >= runtime.connection(handle).viewScopeFence;
  const cursor = view => view?.active && runtime.connectionView(view.handle) === view ? sent.get(view) ?? null : null;
  function assertCurrent(handle, view) { if (!current(handle, view)) throw resync(); }
  function sendChecked(handle, view, value, send, kind) {
    assertCurrent(handle, view);
    let proof;
    try { proof = send(value, view); } catch { /* 失败与空回调都不能成为水位。 */ }
    if (!current(handle, view) || !consumeQueuedPacket(proof, handle, view, value, kind)) {
      const error = resync(); error.keepSpatialPending = true;
      runtime.retireView(view, true);
      throw error;
    }
  }
  function laneFor(handle) {
    let lane = lanes.get(handle);
    if (!lane) { lane = { active: null, rpc: null, publisher: null }; lanes.set(handle, lane); }
    return lane;
  }
  function drain(lane) {
    if (lane.active) return;
    const item = lane.rpc ?? lane.publisher;
    if (!item) return;
    if (item === lane.rpc) lane.rpc = null; else lane.publisher = null;
    lane.active = item;
    Promise.resolve().then(() => item.work()).then(item.resolve, item.reject).finally(() => {
      lane.active = null; drain(lane);
    });
  }
  function enqueue(handle, kind, work) {
    const lane = laneFor(handle);
    if (kind === 'rpc' && lane.rpc) return Promise.reject(resync());
    if (kind === 'publisher' && lane.publisher) { lane.publisher.work = work; return lane.publisher.promise; }
    const item = { kind, work };
    item.promise = new Promise((resolve, reject) => { item.resolve = resolve; item.reject = reject; });
    lane[kind] = item; drain(lane); return item.promise;
  }
  function sentBatch(handle, view, batch, send, kind = 'ack') {
    assertCurrent(handle, view);
    const through = cursor(view);
    if (through === null || batch.sessionId !== view.sessionId || batch.viewId !== view.viewId || BigInt(batch.throughSeq) < BigInt(batch.fromExclusive)
      || !(batch.fromExclusive === through || BigInt(batch.fromExclusive) < BigInt(through) && BigInt(batch.throughSeq) <= BigInt(through))) throw resync();
    sendChecked(handle, view, batch, send, kind);
    if (batch.fromExclusive === through) sent.set(view, batch.throughSeq);
  }
  return {
    enabled, current, cursor,
    snapshot(handle, value, send) {
      const snapshot = value.snapshot ?? value, view = runtime.connectionView(handle);
      assertCurrent(handle, view);
      if (snapshot.schemaVersion !== 2 || snapshot.type !== 'world.snapshot' || snapshot.sessionId !== view.sessionId
        || snapshot.viewId !== view.viewId || snapshot.snapshotSeq !== view.cursor) throw resync();
      sendChecked(handle, view, value, send, 'ack');
      // 同一控制nonce的原结果可重发，不能把此binding已发头倒退成历史快照。
      if (!sent.has(view)) sent.set(view, snapshot.snapshotSeq);
      runtime.emit('spatial-supply-ready', { connectionId: handle.connectionId });
    },
    sync(handle, raw, send) {
      const request = parseSpatial('SyncRequestV2', raw), view = runtime.connectionView(handle);
      // 资格只在入队同一turn捕获；真正旧cursor和前置RPC仍保留历史补读。
      const admitted = cursor(view), predecessor = laneFor(handle).active;
      const aligned = current(handle, view) && enabled(handle) && admitted !== null && request.cursor === admitted;
      return enqueue(handle, 'rpc', async () => {
        assertCurrent(handle, view);
        const through = cursor(view);
        if (through === null || request.sessionId !== view.sessionId || request.viewId !== view.viewId || BigInt(request.cursor) > BigInt(through)) throw resync();
        // 单lane中同V的新增sent只能来自所捕获publisher的真实入队；它不是客户端应用确认。
        const continued = aligned && enabled(handle) && predecessor?.kind === 'publisher' && BigInt(through) > BigInt(admitted);
        const batch = await runtime.sync(handle, raw, continued ? { sentPrefixStart: through }
          : BigInt(request.cursor) < BigInt(through) ? { throughSeqCeiling: through } : {});
        sentBatch(handle, view, batch, send);
        return batch;
      });
    },
    publish(view, target, send) {
      const handle = view.handle, sessionId = view.sessionId;
      return enqueue(handle, 'publisher', async () => {
        // 控制替换可让第一读失效，只对已发送基线的新binding再试一次；不追无限换view。
        for (let attempt = 0; attempt < 2; attempt++) {
          const binding = runtime.connectionView(handle);
          if (!binding?.active || binding.sessionId !== sessionId) return { ignored: true };
          if (!current(handle, binding)) return { blocked: true };
          const through = cursor(binding);
          if (through === null) return { blocked: true };
          if (BigInt(through) >= BigInt(target)) return { covered: true };
          let batch;
          try { batch = await runtime.sync(handle, JSON.stringify({ schemaVersion: 2, type: 'sync.request', sessionId, viewId: binding.viewId, cursor: through })); }
          catch (error) {
            // 行锁等待时已换binding也可能直接拒绝；仅此旧引用错误可重核新baseline。
            if (error.code === 'RESYNC_REQUIRED' && !current(handle, binding)) continue;
            throw error;
          }
          if (!current(handle, binding)) continue;
          if (batch.throughSeq === through) return { blocked: true };
          if (enabled(handle)) {
            // 原读事务已释放；保留活动lane，让出后再核binding，发送和proof仍同步完成。
            await yieldToIO();
            if (!current(handle, binding)) continue;
          }
          sentBatch(handle, binding, batch, send, 'push');
          return { covered: BigInt(batch.throughSeq) >= BigInt(target), progressed: true };
        }
        return { blocked: true };
      });
    },
  };
}
