import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSpatialContext } from '../ai/spatial-context.mjs';
import { ModelGateway } from '../ai/gateway.mjs';
import { parseSpatialProposedIntent, validateSpatialAI } from '../../protocol/spatial-ai.mjs';

const fixture = JSON.parse(readFileSync(new URL('../../protocol/fixtures/spatial-ai-v2.json', import.meta.url)));
const snapshot = () => structuredClone(fixture.snapshot);
const context = () => buildSpatialContext(snapshot(), { decisionId: 'decision-one' });
const raw = action => JSON.stringify({ schemaVersion: 2, decisionId: 'decision-one', toolCalls: [action] });
const provider = generate => ({ kind: 'controlled', providerId: 'controlled-spatial-test', generate });

test('空间上下文：仅公开 DTO，控制/导航元数据留服务端，同意工具只给本人', () => {
  const source = snapshot(), original = structuredClone(source), value = buildSpatialContext(source, { decisionId: 'decision-one' });
  validateSpatialAI('SpatialDecisionContextV2', value);
  assert.deepEqual(value.decision, { decisionId: 'decision-one' });
  for (const forbidden of ['actorId', 'characterId', 'principalKind', 'controlEpoch', 'movementCommandSeq', 'movementCommandHighWater', 'readVersions', 'reclaimHolderEpoch', 'motionTrail']) assert.ok(!JSON.stringify(value).includes('"' + forbidden + '"'), forbidden);
  assert.equal(value.projection.entities[0].appearanceId, 'cuilan');
  assert.deepEqual(value.projection.objectives, source.projection.objectives);
  assert.deepEqual(value.projection.observations, source.projection.observations);
  const consentTools = value.tools.filter(t => ['respond_consent', 'withdraw_consent'].includes(t.kind));
  assert.equal(consentTools.length, 2);
  assert.ok(consentTools.every(t => t.consentId === 'R' + 'h'.repeat(32)));
  assert.ok(value.tools.some(t => t.kind === 'inspect' && t.targetRef === 'R' + 'd'.repeat(32)));
  assert.deepEqual(source, original);
  value.projection.self.name = '隔离副本';
  assert.equal(source.projection.self.name, '本人');
  source.projection.self.actorId = 'hidden';
  assert.throws(() => buildSpatialContext(source), { code: 'INVALID_MESSAGE' });
});

test('空间 Gateway：选择 V2 Schema，严格绑定决定和授权引用，保留 v1 接口', async () => {
  const inputs = [], outputs = [raw({ kind: 'wait' }), raw({ kind: 'inspect', targetRef: 'R' + 'z'.repeat(32) }), raw({ kind: 'respond_consent', consentId: 'R' + 'i'.repeat(32), expectedConsentVersion: '2', response: 'accept' })];
  const gateway = new ModelGateway({ provider: provider(async input => { inputs.push(input); return { rawText: outputs.shift() }; }), modelId: 'controlled-spatial-v1' });
  try {
    const valid = await gateway.generate(context());
    assert.equal(valid.status, 'Valid');
    assert.match(valid.semanticDigest, /^[a-f0-9]{64}$/);
    assert.equal(inputs[0].responseSchema.$ref, '#/$defs/SpatialProposedIntentV2');
    assert.ok(!Object.hasOwn(inputs[0].responseSchema.$defs, 'PublicEnvelope'));
    assert.ok(!Object.hasOwn(inputs[0].responseSchema.$defs, 'ProjectionV2'));
    assert.equal((await gateway.generate(context())).status, 'Invalid');
    assert.equal((await gateway.generate(context())).status, 'Invalid');
    const forged = { ...context(), actorId: 'secret' };
    assert.deepEqual(await gateway.generate(forged), { status: 'Blocked', reason: 'INVALID_CONTEXT' });
    assert.equal(inputs.length, 3);
    assert.equal(gateway.metrics().externalCalls, 0);
  } finally { await gateway.close(); }
  const v1 = new ModelGateway({ provider: provider(async input => {
    assert.equal(input.responseSchema.$ref, '#/$defs/ProposedIntent');
    return { rawText: '{"decisionId":"old","toolCalls":[{"kind":"wait"}]}' };
  }), modelId: 'controlled-v1' });
  try { assert.equal((await v1.generate({ contextVersion: 'legal-memory-v1', decision: { decisionId: 'old' } })).status, 'Valid'); }
  finally { await v1.close(); }
});

test('空间模型引用：持物、当前工具、合法证据及本人决定版本在边界核对', () => {
  const value = context();
  for (const good of fixture.validIntents) parseSpatialProposedIntent(JSON.stringify(good), 'decision-one', value);
  const forbidden = [
    { kind: 'interact', targetRef: 'R' + 'b'.repeat(32), operationId: 'gz-recruitment-decision', expectedTargetRevision: '1', parameters: { expectedDecisionVersion: '0', response: 'accept' } },
    { kind: 'share_evidence', evidenceRef: 'R' + 'g'.repeat(32), recipientRefs: ['R' + 'b'.repeat(32)] },
    { kind: 'speak', text: '旧引用不能作为当前听众', channel: 'directed', recipientRefs: ['R' + 'z'.repeat(32)] },
    { kind: 'transfer_item', itemRef: 'R' + 'c'.repeat(32), expectedItemRevision: '2', recipientRef: 'R' + 'b'.repeat(32) },
    { kind: 'move_to', sceneId: 'hidden-room', destination: { x: 10, y: 10 } },
    { kind: 'move_to', sceneId: 'yard', destination: { x: 1001, y: 10 } },
    { kind: 'move_to', sceneId: 'yard', destination: { x: 100, y: 10 }, anchorId: 'hidden-anchor' },
  ];
  for (const action of forbidden) assert.throws(() => parseSpatialProposedIntent(raw(action), 'decision-one', value), { code: 'INVALID_MESSAGE' });
  const restricted = buildSpatialContext(snapshot(), { decisionId: 'decision-one', allowedKinds: ['move_to', 'stop_move', 'inspect', 'speak', 'wait'] });
  assert.ok(restricted.tools.every(t => ['move_to', 'stop_move', 'inspect', 'speak', 'wait'].includes(t.kind)));
  assert.throws(() => parseSpatialProposedIntent(JSON.stringify(fixture.validIntents[2]), 'decision-one', restricted), { code: 'INVALID_MESSAGE' });
});

test('空间上下文：人格与目标只带安全字段，目标来源不得冒用隐藏观察', () => {
  const persona = { motives: ['尊重当事人意愿。'], boundaries: ['不把别人的承诺当作已执行事实。'] };
  const goal = { goalId: 'learn', label: '再听一次来源说明', status: 'active', basedOnObservationRefs: ['R' + 'f'.repeat(32)], objectiveId: 'learn' };
  const value = buildSpatialContext(snapshot(), { decisionId: 'decision-one', persona, goals: [goal] });
  assert.deepEqual(value.persona, persona); assert.deepEqual(value.goals, [goal]);
  assert.throws(() => buildSpatialContext(snapshot(), { persona: { ...persona, actorId: 'secret' } }), { code: 'INVALID_MESSAGE' });
  assert.throws(() => buildSpatialContext(snapshot(), { goals: [{ ...goal, basedOnObservationRefs: ['R' + 'z'.repeat(32)] }] }), { code: 'INVALID_MESSAGE' });
  assert.throws(() => buildSpatialContext(snapshot(), { goals: [{ ...goal, objectiveId: 'secret-objective' }] }), { code: 'INVALID_MESSAGE' });
  assert.throws(() => buildSpatialContext(snapshot(), { goals: [goal, goal] }), { code: 'INVALID_MESSAGE' });
});

test('空间 Gateway：调用方后改对象不能替换已经派发的决定与引用', async () => {
  let finish, started;
  const dispatched = new Promise(resolve => { started = resolve; });
  const gateway = new ModelGateway({ provider: provider(async () => { started(); return new Promise(resolve => { finish = resolve; }); }), modelId: 'controlled-bound-context' });
  const value = context(), pending = gateway.generate(value);
  await dispatched;
  value.decision.decisionId = 'changed'; value.tools.length = 0;
  finish({ rawText: raw({ kind: 'wait' }) });
  try { assert.equal((await pending).status, 'Valid'); }
  finally { await gateway.close(); }
});

test('空间 Gateway：NUL 原文保留为非法持久意图，超时/取消/迟到拒绝有界', async () => {
  const text = raw({ kind: 'speak', text: '\u0000', channel: 'public', recipientRefs: [] });
  const gateway = new ModelGateway({ provider: provider(async () => ({ rawText: text })), modelId: 'controlled-nul' });
  try {
    const output = await gateway.generate(context());
    assert.equal(output.status, 'Invalid'); assert.equal(output.reason, 'UNPERSISTABLE_INTENT');
    assert.equal(output.rawText, text); assert.match(output.parsedSemanticDigest, /^[a-f0-9]{64}$/);
  } finally { await gateway.close(); }
  let rejectLate, signal;
  const timeout = new ModelGateway({ provider: provider(async (input, options) => { signal = options.signal; return new Promise((resolve, reject) => { rejectLate = reject; }); }), modelId: 'controlled-timeout', timeoutMs: 15 });
  assert.equal((await timeout.generate(context())).status, 'Timeout'); assert.equal(signal.aborted, true);
  await timeout.close(); rejectLate(new Error('迟到的供应商错误'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(timeout.metrics().active, 0); assert.equal(timeout.metrics().externalCalls, 0);
});
