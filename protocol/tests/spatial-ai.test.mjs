import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSpatialProposedIntent, validateSpatialAI, canonicalSpatialIntentPayload } from '../spatial-ai.mjs';
import { spatialIntentSemanticDigestSync } from '../spatial-ai-node.mjs';

const reference = 'R' + 'a'.repeat(32);
const intent = action => ({ schemaVersion: 2, decisionId: 'decision-one', toolCalls: [action] });

test('空间模型合同：单个有限动作不允许模型决定导航序号或可信元数据', () => {
  const value = intent({ kind: 'move_to', sceneId: 'yard', destination: { x: 12, y: 34 }, targetRef: reference });
  assert.deepEqual(JSON.parse(JSON.stringify(parseSpatialProposedIntent(JSON.stringify(value), 'decision-one'))), value);
  for (const forged of [
    { ...value, actorId: 'hidden-actor' }, { ...value, controlEpoch: '2' }, { ...value, nonce: 'forged' },
    { ...value, readVersions: {} }, { ...value, goalUpdates: [] }, { ...value, beliefUpdates: [] },
    intent({ ...value.toolCalls[0], movementCommandSeq: '10' }), intent({ kind: 'advance_world', arrived: true }),
    intent({ kind: 'move', regionId: 'yard' }), intent({ kind: 'request_end', proposalId: 'x', proposalVersion: '0', scope: 'chapter' }),
    { ...value, toolCalls: [] }, { ...value, toolCalls: [value.toolCalls[0], { kind: 'take_item', itemRef: reference, expectedItemRevision: '1' }] },
  ]) assert.throws(() => parseSpatialProposedIntent(JSON.stringify(forged), 'decision-one'), { code: 'INVALID_MESSAGE' });
  assert.throws(() => parseSpatialProposedIntent(JSON.stringify(value), 'different'), { code: 'INVALID_MESSAGE' });
});

test('空间模型合同：严格原文、频道、Unicode、字节和精确数字边界', () => {
  const raw = JSON.stringify(intent({ kind: 'speak', text: '先查证，再决定。', channel: 'public', recipientRefs: [] }));
  for (const bad of [
    raw.replace('"schemaVersion":2', '"schemaVersion":2,"schemaVersion":2'),
    raw.replace('"text":', '"te\\u0078t":"重复", "text":'),
    raw.replace('"public"', '"team"'), raw.replace('"public"', '"directed"'),
    raw.replace('先查证，再决定。', '\\ud800'), raw + ' {}', '```json\n' + raw + '\n```',
    JSON.stringify(intent({ kind: 'move_to', sceneId: 'yard', destination: { x: 1, y: 2 } })).replace('"x":1', '"x":1.00000000000000001'),
    raw + ' '.repeat(65536),
  ]) assert.throws(() => parseSpatialProposedIntent(bad, 'decision-one'), { code: 'INVALID_MESSAGE' });
  const nul = raw.replace('先查证，再决定。', '\\u0000');
  assert.equal(parseSpatialProposedIntent(nul, 'decision-one').toolCalls[0].text, String.fromCharCode(0));
  assert.throws(() => validateSpatialAI('SpatialProposedIntentV2', intent({ kind: 'speak', text: '问询', channel: 'public', recipientRefs: [reference] })), { code: 'INVALID_MESSAGE' });
});

test('空间模型合同：语义摘要覆盖完整意图，格式差异保持一致', () => {
  const value = intent({ kind: 'wait' });
  const parsed = parseSpatialProposedIntent(JSON.stringify(value, null, 2), 'decision-one');
  assert.equal(canonicalSpatialIntentPayload(value), canonicalSpatialIntentPayload(parsed));
  assert.equal(spatialIntentSemanticDigestSync(value), spatialIntentSemanticDigestSync(parsed));
  assert.notEqual(spatialIntentSemanticDigestSync(value), spatialIntentSemanticDigestSync({ ...value, decisionId: 'decision-two' }));
});
