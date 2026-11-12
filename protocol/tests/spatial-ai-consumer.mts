import { parseSpatialProposedIntent, type SpatialProposedIntentV2, type SpatialContextV2 } from '../spatial-ai.mjs';
import { spatialIntentSemanticDigestSync } from '../spatial-ai-node.mjs';

const intent: SpatialProposedIntentV2 = { schemaVersion: 2, decisionId: 'D', toolCalls: [{ kind: 'move_to', sceneId: 'yard', destination: { x: 1, y: 2 } }] };
const result: SpatialProposedIntentV2 = parseSpatialProposedIntent(JSON.stringify(intent), 'D');
const digest: string = spatialIntentSemanticDigestSync(result);
function known(context: SpatialContextV2) { return context.projection.observations.map(item => item.observationRef); }
// @ts-expect-error 模型不得选择控制 epoch。
const forged: SpatialProposedIntentV2 = { ...intent, controlEpoch: '1' };
// @ts-expect-error 模型导航不得携带权威移动序号。
const navigation: SpatialProposedIntentV2 = { schemaVersion: 2, decisionId: 'D', toolCalls: [{ kind: 'stop_move', movementCommandSeq: '1' }] };
// @ts-expect-error 模型不得使用真人队聊。
const privateSpeech: SpatialProposedIntentV2 = { schemaVersion: 2, decisionId: 'D', toolCalls: [{ kind: 'speak', text: 'x', channel: 'team', recipientRefs: [] }] };
void [digest, known, forged, navigation, privateSpeech];
