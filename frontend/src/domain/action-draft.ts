import { canonicalize, validateContract } from '../../../protocol/index.mjs';
import type { Action, AuthorizedSnapshot, ClientReceipt } from '../../../game/types.ts';

export type ActionStatus = 'waiting' | 'unknown' | 'accepted' | 'rejected';

export interface ActionDraft {
  readonly id: string;
  readonly sessionId: string;
  readonly actorId: string;
  readonly raw: string;
  readonly label: string;
  status: ActionStatus;
  receipt: ClientReceipt | null;
  detail?: string;
}

export const actionLabels: Record<Action['kind'], string> = {
  move: '前往场所', inspect: '查看线索', take_item: '拿取物品', transfer_item: '转交物品',
  use_item: '使用物品', interact: '执行操作', share_evidence: '展示证据',
  speak: '发送陈述', make_claim: '提出说法', wait: '暂候片刻',
};

/** 草稿的 wire 字节从创建起固定；重试不得换成当前授权或当前游标。 */
export function prepareAction(snapshot: AuthorizedSnapshot, action: Action, id: string): ActionDraft {
  validateContract('AuthorizedSnapshot', snapshot);
  const self = snapshot.projection.self;
  if (snapshot.projection.phase !== 'Running' || !self.canControl || self.mode !== 'HumanControlled') {
    throw new Error('当前不能提交新动作，请先取得角色控制权并同步状态。');
  }
  const envelope = validateContract('ClientAction', {
    schemaVersion: 1, sessionId: snapshot.sessionId, actorId: self.characterId,
    clientActionId: id, controlEpoch: self.controlEpoch, baseSeq: snapshot.snapshotSeq, action,
  });
  return Object.freeze({
    id, sessionId: snapshot.sessionId, actorId: self.characterId,
    raw: canonicalize(envelope), label: actionLabels[action.kind], status: 'waiting', receipt: null,
  });
}
