export type {
  Action, AuthorizedProjection, AuthorizedSnapshot, CharacterView, Claim, ClientReceipt,
  ControlRequest, ControlResponse, ErrorResponse, ItemView, Observation, TargetView, WorldBatch,
} from '../../../game/types.ts';

export interface GuestIdentity { token: string; userId: string; name: string }
export interface RoomSummary { sessionId: string; name: string; playerCount: number; phase: 'Lobby' | 'Running' | 'Finished' | 'Aborted' }
export interface RoomMembership { sessionId: string; actorId: string }

export const roleNames: Record<string, string> = {
  A: '勘查', B: '材料保管', C: '通行协调', D: '寻物', E: '记事',
};

export const controlNames: Record<string, string> = {
  HumanControlled: '本人控制', GracePeriod: '断线宽限', AIProxyControlled: '受限托管',
  CoreNPCControlled: '核心伙伴', Revoked: '只读',
};

export const operationNames: Record<string, string> = { repair: '修复通路', grant_passage: '授予通行许可' };

export function fieldValue(value: string | number | boolean | null): string {
  if (value === true) return '已满足';
  if (value === false) return '未满足';
  if (value === null) return '尚无';
  return String(value);
}
