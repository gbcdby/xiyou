import { canonicalize, compareDecimal } from '../../../protocol/index.mjs';
import { checkSpatialSnapshotShellAndRelations, validateSpatial } from '../../../protocol/spatial.mjs';
import type { BatchV2, SnapshotV2, SyncRequestV2 } from '../../../game/spatial-types.ts';
import type { BatchResult, SnapshotResult } from './client-view.ts';

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

/** 只由本次调用持有；仅applied结果可消费目标。普通自有sink会清旧值，反射sink不承诺跨对象回滚。 */
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
      // 原图反射可能改动已扫描字段；只安装这份实际通过完整校验的自有副本。
      const owned = validateSpatial('SnapshotV2', structuredClone(snapshot));
      const frozen = freeze(owned);
      if (generation !== this.#generation || this.#snapshot || frozen.sessionId !== this.#sessionId) return 'stale';
      this.#snapshot = frozen; return 'applied';
    } catch { return 'invalid'; }
  }
  syncRequest(): SyncRequestV2 | null {
    const current = this.#snapshot;
    return current ? { schemaVersion: 2, type: 'sync.request', sessionId: current.sessionId, viewId: current.viewId, cursor: current.snapshotSeq } : null;
  }
  #batchInstallationResult(previous: SnapshotV2, preparedSeq: string, generation: number): 'stale' | 'duplicate' | 'refetch' | undefined {
    const current = this.#snapshot;
    if (generation !== this.#generation || !current) return 'stale';
    if (current !== previous) return compareDecimal(preparedSeq, current.snapshotSeq) <= 0 ? 'duplicate' : 'refetch';
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
      // 输入反射已失去安装资格时，不再向普通sink发布候选分页目标。
      const prepared = this.#batchInstallationResult(previous, snapshot.snapshotSeq, generation);
      if (prepared) return prepared;
      // metadata写失败必须先于世界安装；其setter/Proxy也可能同步重入。
      if (metadata && frontier !== undefined) metadata.syncFrontierSeq = frontier;
      const installation = this.#batchInstallationResult(previous, snapshot.snapshotSeq, generation);
      if (installation) return installation;
      this.#snapshot = snapshot;
      return 'applied';
    } catch { return 'refetch'; }
  }
}
