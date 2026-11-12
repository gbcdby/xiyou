import {
  parseClientAction, validateContract, parseContract, parseProposedIntent,
  type ClientAction, type WorldBatch, type ProposedIntent, type AuthorizedSnapshot,
} from '../index.mjs';
import { actionSemanticDigestSync } from '../node.mjs';

const request: ClientAction = {
  schemaVersion: 1, sessionId: 'S1', actorId: 'C1', clientActionId: 'A1',
  controlEpoch: '1', baseSeq: '0', action: { kind: 'move', regionId: 'entry' },
};
const parsed = parseClientAction(JSON.stringify(request));
if (parsed.action.kind === 'transfer_item') {
  const itemRevision: string = parsed.action.expectedItemRevision;
  void itemRevision;
}
const snapshot: AuthorizedSnapshot = parseContract('AuthorizedSnapshot', '{}');
const batch: WorldBatch = validateContract('WorldBatch', {});
const intent: ProposedIntent = parseProposedIntent('{}', 'D1');
const digest: string = actionSemanticDigestSync(request);
void [snapshot, batch, intent, digest];

// @ts-expect-error 客户端 envelope 没有可信主体字段。
const forged: ClientAction = { ...request, principalId: 'system' };
// @ts-expect-error wire 序号必须保持字符串。
const numericSequence: ClientAction = { ...request, baseSeq: 9007199254740993 };
// @ts-expect-error 模型候选不能持有可信决策版本。
const changedEpoch: ProposedIntent = { decisionId: 'D1', toolCalls: [], controlEpoch: '2' };
void [forged, numericSequence, changedEpoch];

// 高老庄仅使用有限动作构造入口，避免旧内容任意字符串操作分支吞没判别。
import { gaolaoInteraction, isGaolaoInteraction } from '../spatial.mjs';
import type { ActionV2 } from '../spatial.mjs';
const chapterAction=gaolaoInteraction({kind:'interact',operationId:'gz-confirm-settlement',targetRef:'R'+ 'a'.repeat(32),expectedTargetRevision:'1',parameters:{consentId:'R'+ 'b'.repeat(32),expectedConsentVersion:'2'}});
chapterAction.parameters.consentId;
// @ts-expect-error 本人安置操作不能省略同意版本参数
gaolaoInteraction({kind:'interact',operationId:'gz-confirm-settlement',targetRef:'ref',expectedTargetRevision:'1'});
// @ts-expect-error 章节操作不能临时发明
gaolaoInteraction({kind:'interact',operationId:'gz-invent-world',targetRef:'ref',expectedTargetRevision:'1'});
function chapterConsumer(action:ActionV2){if(isGaolaoInteraction(action)&&action.operationId==='gz-confirm-settlement')return action.parameters.consentId;}
void chapterConsumer;
