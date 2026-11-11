import { parseClientAction } from '../../../protocol/index.mjs';
import { actionLabels } from './action-draft.ts';
import type { ActionDraft } from './action-draft.ts';

type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** 只保留待确认的原始请求，不缓存授权投影；页面刷新后仍须重新向服务取授权。 */
export class ActionJournal {
  #storage: StoragePort;
  constructor(storage: StoragePort) { this.#storage = storage; }
  #key(userId: string, sessionId: string) { return `xiyou.pending.v1:${encodeURIComponent(userId)}:${encodeURIComponent(sessionId)}`; }
  load(userId: string, sessionId: string): ActionDraft[] {
    try {
      const values: unknown = JSON.parse(this.#storage.getItem(this.#key(userId, sessionId)) || '[]');
      if (!Array.isArray(values)) return [];
      const result: ActionDraft[] = [];
      for (const raw of values) {
        if (typeof raw !== 'string') continue;
        try {
          const action = parseClientAction(raw);
          if (action.sessionId !== sessionId || result.some(existing => existing.id === action.clientActionId)) continue;
          result.push(Object.freeze({ id: action.clientActionId, sessionId, actorId: action.actorId, raw, label: actionLabels[action.action.kind], status: 'unknown', receipt: null }));
        } catch { /* 损坏或不符合已发布契约的缓存不发送到服务。 */ }
      }
      return result;
    } catch { return []; }
  }
  save(userId: string, sessionId: string, actions: ActionDraft[]): boolean {
    try {
      const pending = actions.filter(action => action.sessionId === sessionId && (action.status === 'waiting' || action.status === 'unknown'));
      if (pending.length) this.#storage.setItem(this.#key(userId, sessionId), JSON.stringify(pending.map(action => action.raw)));
      else this.#storage.removeItem(this.#key(userId, sessionId));
      return true;
    } catch { return false; }
  }
}
