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
