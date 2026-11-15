import type { SnapshotV2 } from '../../../game/spatial-types.ts';
import { motionPresentationIdentity } from './spatial-motion.ts';

export interface SnapshotSubscription { readonly current: SnapshotV2 | null; close(): void }
export interface SpatialSnapshotSource {
  readonly current: SnapshotV2 | null;
  subscribe(accept: (snapshot: SnapshotV2 | null) => void, failed: (error: unknown) => void): SnapshotSubscription;
}
interface Listener {
  current: SnapshotV2 | null; active: boolean;
  accept: (snapshot: SnapshotV2 | null) => void; failed: (error: unknown) => void;
}

/** 只接收SpatialView已经接受的快照；稳定只读入口不保存或补放历史。 */
export function createSpatialSnapshotSource(): { source: SpatialSnapshotSource; publish(snapshot: SnapshotV2 | null): void } {
  let current: SnapshotV2 | null = null;
  const listeners = new Set<Listener>();
  const deliver = (listener: Listener, snapshot: SnapshotV2 | null) => {
    if (!listener.active) return;
    try { listener.accept(snapshot); if (listener.active) listener.current = snapshot; }
    catch (error) {
      listener.active = false; listener.current = null; listeners.delete(listener);
      // 显示失败不能撤销已接受View，也不能打断其它owner或自动重试遗漏段。
      try { listener.failed(error); } catch { /* 此订阅已隔离，继续通知其余owner。 */ }
    }
  };
  const dispatch = (snapshot: SnapshotV2 | null) => { current = snapshot; for (const listener of [...listeners]) deliver(listener, snapshot); };
  const source: SpatialSnapshotSource = Object.freeze({
    get current() { return current; },
    subscribe(accept: Listener['accept'], failed: Listener['failed']) {
      const listener: Listener = { current: null, active: true, accept, failed }; listeners.add(listener); deliver(listener, current);
      return Object.freeze({ get current() { return listener.current; }, close() { listener.active = false; listener.current = null; listeners.delete(listener); } });
    },
  });
  return { source, publish(snapshot) {
    if (!snapshot) { if (current) dispatch(null); return; }
    const sameBinding = current && motionPresentationIdentity(current) === motionPresentationIdentity(snapshot);
    if (sameBinding && current!.snapshotSeq === snapshot.snapshotSeq) return;
    if (current && !sameBinding) dispatch(null);
    dispatch(snapshot);
  } };
}
