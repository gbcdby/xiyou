import { canonicalize, compareDecimal, validateContract } from '../../../protocol/index.mjs';
import type { AuthorizedSnapshot, AuthorizedProjection, SyncRequest } from '../../../game/types.ts';

export type BatchResult = 'applied' | 'duplicate' | 'stale' | 'refetch' | 'resync';
export type SnapshotResult = 'applied' | 'stale' | 'invalid';

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** 只消费授权 DTO；此处不承担服务端受众过滤。 */
export class ClientView {
  #snapshot: AuthorizedSnapshot | null = null;
  #sessionId = '';
  #generation = 0;

  get snapshot(): AuthorizedSnapshot | null { return this.#snapshot; }
  get generation(): number { return this.#generation; }

  /** 换绑、撤权、重连或 RESYNC 都废弃上一代的待用结果。 */
  begin(sessionId: string): number {
    this.#generation += 1;
    this.#sessionId = sessionId;
    this.#snapshot = null;
    return this.#generation;
  }

  acceptSnapshot(input: unknown, generation: number): SnapshotResult {
    if (generation !== this.#generation || this.#snapshot) return 'stale';
    try {
      const snapshot = validateContract('AuthorizedSnapshot', input);
      if (snapshot.sessionId !== this.#sessionId) return 'stale';
      this.#snapshot = freeze(snapshot);
      return 'applied';
    } catch { return 'invalid'; }
  }

  syncRequest(): SyncRequest | null {
    const snapshot = this.#snapshot;
    if (!snapshot) return null;
    return { schemaVersion: 1, type: 'sync.request', sessionId: snapshot.sessionId, viewId: snapshot.viewId, cursor: snapshot.snapshotSeq };
  }

  applyBatch(input: unknown, generation: number): BatchResult {
    if (generation !== this.#generation || !this.#snapshot) return 'stale';
    const previous = this.#snapshot;
    try {
      const batch = validateContract('WorldBatch', input);
      if (batch.sessionId !== previous.sessionId || batch.viewId !== previous.viewId) return 'stale';
      if (compareDecimal(batch.throughSeq, previous.snapshotSeq) <= 0) return 'duplicate';
      if (previous.projection.phase === 'Finished' || previous.projection.phase === 'Aborted') return 'resync';
      if (batch.fromExclusive !== previous.snapshotSeq) return 'refetch';
      let projection: AuthorizedProjection = structuredClone(previous.projection);
      for (const event of batch.events) {
        if (event.kind === 'projection.replace') {
          const next = event.payload.projection;
          if (next.self.characterId !== previous.projection.self.characterId || next.contentVersion !== previous.projection.contentVersion || next.reducerVersion !== previous.projection.reducerVersion) return 'resync';
          projection = structuredClone(next);
        } else if (event.kind === 'ClaimRecorded') {
          const found = projection.claims.find(claim => claim.claimId === event.payload.claimId);
          if (found && canonicalize(found) !== canonicalize(event.payload)) return 'refetch';
          if (!found) projection.claims.push(structuredClone(event.payload));
        } else {
          const found = projection.observations.find(observation => observation.observationId === event.payload.observationId);
          if (found && canonicalize(found) !== canonicalize(event.payload)) return 'refetch';
          if (!found) projection.observations.push(structuredClone(event.payload));
        }
      }
      const snapshot = validateContract('AuthorizedSnapshot', { ...previous, snapshotSeq: batch.throughSeq, projection });
      this.#snapshot = freeze(snapshot);
      return 'applied';
    } catch { return 'refetch'; }
  }
}
