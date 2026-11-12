import { compareDecimal } from '../../../protocol/index.mjs';
import { validateSpatial } from '../../../protocol/spatial.mjs';
import type { SnapshotV2, SyncRequestV2 } from '../../../game/spatial-types.ts';
import type { BatchResult, SnapshotResult } from './client-view.ts';

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
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
  applyBatch(input: unknown, generation: number): BatchResult {
    if (generation !== this.#generation || !this.#snapshot) return 'stale';
    const previous = this.#snapshot;
    try {
      const batch = validateSpatial('BatchV2', input);
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
      this.#snapshot = freeze(structuredClone(validateSpatial('SnapshotV2', { ...previous, snapshotSeq: batch.throughSeq, projection })));
      return 'applied';
    } catch { return 'refetch'; }
  }
}
