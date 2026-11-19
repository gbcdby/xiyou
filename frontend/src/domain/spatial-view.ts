import { canonicalize, compareDecimal } from '../../../protocol/index.mjs';
import { checkSpatialSnapshotShellAndRelations, validateSpatial } from '../../../protocol/spatial.mjs';
import type { BatchV2, SnapshotV2, SyncRequestV2 } from '../../../game/spatial-types.ts';
import type { BatchResult, SnapshotResult } from './client-view.ts';

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

/** 只由本次调用持有；非applied结果不能携带旧分页目标。 */
export interface BatchApplicationMetadata { syncFrontierSeq?: string }

function frontierData(input: unknown): PropertyDescriptor | undefined {
  if (!input || typeof input !== 'object') return;
  const descriptor = Object.getOwnPropertyDescriptor(input, 'syncFrontierSeq');
  if (descriptor && (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))) throw new Error('同步前沿必须是自有可枚举数据');
  return descriptor;
}

function singleEvent(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false;
  const events = Object.getOwnPropertyDescriptor(input, 'events');
  if (!events || !events.enumerable || !Object.hasOwn(events, 'value')) throw new Error('事件必须是自有可枚举数据');
  if (!Array.isArray(events.value)) return false;
  const length = Object.getOwnPropertyDescriptor(events.value, 'length');
  if (!length || !Object.hasOwn(length, 'value')) throw new Error('事件数组长度无效');
  return length.value === 1;
}

/** 防止clone丢弃隐藏字段后把非法输入降格为缺字段；共享数据不等同于环。 */
function cloneableData(value: unknown, visited = new WeakSet<object>()): void {
  if (!value || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('单事件批次只能包含可枚举JSON数据');
    cloneableData(descriptor.value, visited);
  }
}

/** 只保存服务端授权投影；视图代次和整批区间一起约束所有异步输入。 */
export class SpatialView {
  #snapshot: SnapshotV2 | null = null;
  #sessionId = '';
  #generation = 0;
  get snapshot(): SnapshotV2 | null { return this.#snapshot; }
  get generation(): number { return this.#generation; }
  begin(sessionId: string): number { this.#generation++; this.#sessionId = sessionId; this.#snapshot = null; return this.#generation; }
  acceptSnapshot(input: unknown, generation: number): SnapshotResult {
    if (generation !== this.#generation || this.#snapshot) return 'stale';
    try {
      const snapshot = validateSpatial('SnapshotV2', input);
      if (snapshot.sessionId !== this.#sessionId) return 'stale';
      this.#snapshot = freeze(structuredClone(snapshot)); return 'applied';
    } catch { return 'invalid'; }
  }
  syncRequest(): SyncRequestV2 | null {
    const current = this.#snapshot;
    return current ? { schemaVersion: 2, type: 'sync.request', sessionId: current.sessionId, viewId: current.viewId, cursor: current.snapshotSeq } : null;
  }
  applyBatch(input: unknown, generation: number, metadata?: BatchApplicationMetadata): BatchResult {
    try { if (metadata) delete metadata.syncFrontierSeq; } catch { return 'refetch'; }
    if (generation !== this.#generation || !this.#snapshot) return 'stale';
    const previous = this.#snapshot;
    try {
      const suppliedFrontier = frontierData(input), owned = singleEvent(input);
      let batch: BatchV2;
      if (owned) {
        canonicalize(input); cloneableData(input);
        // 原图的反射过程可能修改已扫描字段，必须完整重验这份私有副本。
        batch = validateSpatial('BatchV2', structuredClone(input));
        if (batch.events.length !== 1) return 'refetch';
      } else batch = validateSpatial('BatchV2', input);
      if (batch.sessionId !== previous.sessionId || batch.viewId !== previous.viewId) return 'stale';
      if (compareDecimal(batch.throughSeq, previous.snapshotSeq) <= 0) return 'duplicate';
      if (batch.fromExclusive !== previous.snapshotSeq) return 'refetch';
      if (['Finished', 'Aborted'].includes(previous.projection.phase)) return 'resync';
      let lastSeq = batch.fromExclusive; const eventIds = new Set<string>();
      let projection = previous.projection;
      for (const event of batch.events) {
        if (compareDecimal(event.sessionSeq, lastSeq) <= 0 || compareDecimal(event.sessionSeq, batch.throughSeq) > 0 || eventIds.has(event.eventId)) return 'refetch';
        lastSeq = event.sessionSeq; eventIds.add(event.eventId);
        const next = event.payload.projection;
        if (next.self.entityRef !== previous.projection.self.entityRef || next.contentVersion !== previous.projection.contentVersion || next.reducerVersion !== previous.projection.reducerVersion || compareDecimal(next.self.controlEpoch, projection.self.controlEpoch) < 0) return 'resync';
        projection = next;
      }
      const next = { ...previous, snapshotSeq: batch.throughSeq, projection };
      let snapshot: SnapshotV2;
      if (owned) { checkSpatialSnapshotShellAndRelations(next); snapshot = freeze(next); }
      else snapshot = freeze(structuredClone(validateSpatial('SnapshotV2', next)));
      let frontier: string | undefined;
      if (owned) { if (Object.hasOwn(batch, 'syncFrontierSeq')) frontier = batch.syncFrontierSeq; }
      else if (suppliedFrontier) {
        frontier = validateSpatial('DecimalString', suppliedFrontier.value);
        if (compareDecimal(frontier, snapshot.snapshotSeq) < 0) return 'refetch';
      }
      // 包括局部元数据写入在内的所有可失败工作先完成，再一次安装授权快照。
      if (metadata && frontier !== undefined) metadata.syncFrontierSeq = frontier;
      this.#snapshot = snapshot;
      return 'applied';
    } catch { return 'refetch'; }
  }
}
