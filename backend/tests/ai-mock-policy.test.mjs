import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createRuntime } from '../runtime.mjs';
import { createRunningRoom, actionRaw } from '../test-support/ai-room.mjs';
import { ModelGateway } from '../ai/gateway.mjs';
import { createMockProvider, mockPolicies } from '../ai/mock-provider.mjs';
import { canonicalize } from '../../protocol/node.mjs';

let database; let runtime; const evidence = [];
const digest = value => createHash('sha256').update(canonicalize(value)).digest('hex');
before(async () => { database = await startTestPostgres('ai-mock-policy'); runtime = await createRuntime({ pool: database.pool }); });
after(async () => {
  await runtime?.close(); await database?.stop();
  if (process.env.XIYOU_MOCK_EVIDENCE_DIR) {
    await mkdir(process.env.XIYOU_MOCK_EVIDENCE_DIR, { recursive: true });
    await writeFile(path.join(process.env.XIYOU_MOCK_EVIDENCE_DIR, 'policy-evidence.json'), JSON.stringify({ acceptanceProfile: 'mock-20261111', input: '新建合成身份与标准内容，经实际 Runtime 取得 Gateway 输入；没有模型外部调用', clock: 'real', policies: mockPolicies, proposals: evidence }, null, 2) + '\n');
  }
});

async function propose(room, role) {
  const handle = await runtime.bindInternal(room.sessionId, role, 'core_npc');
  const prepared = await runtime.prepareDecisionContext(handle);
  const inputs = [];
  const provider = createMockProvider(role);
  const gateway = new ModelGateway({ provider: { ...provider, generate(input, options) { inputs.push(structuredClone(input)); return provider.generate(input, options); } }, modelId: mockPolicies[role].modelId });
  try {
    const output = await gateway.generate(prepared.context);
    assert.equal(output.status, 'Valid');
    assert.equal((await provider.generate(inputs[0])).rawText, output.rawText, '同一合法输入必须给出同一原文');
    const record = { actorId: role, sessionId: room.sessionId, decisionId: prepared.decision.decisionId, inputDigest: digest(inputs[0]), contextDigest: output.contextDigest, outputDigest: output.outputDigest, semanticDigest: output.semanticDigest, observationIds: prepared.decision.observationIds, tools: JSON.parse(output.rawText).toolCalls, receipt: null };
    evidence.push(record);
    return { handle, ...prepared, input: inputs[0], rawText: output.rawText, intent: JSON.parse(output.rawText), record };
  } finally { await gateway.close(); }
}

async function commit(proposed) {
  const receipt = await runtime.submitIntent(proposed.handle, proposed.decision.decisionId, proposed.rawText);
  proposed.record.receipt = { status: receipt.status, code: receipt.code, actionEventRange: receipt.actionEventRange, semanticDigest: receipt.semanticDigest };
  assert.equal(receipt.status, 'Accepted');
  return receipt;
}
async function human(room, index, action) {
  const receipt = await runtime.submit(room.connections[index], actionRaw(room, index, action));
  assert.equal(receipt.status, 'Accepted');
  return receipt;
}
async function shareSource(room, index, sourceId, recipientId = 'tangseng') {
  const snapshot = await runtime.snapshot(room.users[index].token, room.sessionId);
  const source = snapshot.projection.observations.find(o => o.source.sourceIds.includes(sourceId));
  assert.ok(source, '玩家必须先真实取得合法来源');
  return human(room, index, { kind: 'share_evidence', evidenceId: source.observationId, recipientIds: [recipientId] });
}
const claimText = proposed => proposed.intent.toolCalls.filter(tool => ['speak', 'make_claim'].includes(tool.kind)).map(tool => tool.text).join('\n');

test('最新路线已完成后不复活旧请求，无新玩家输入时不在两个出口间往返', async () => {
  const room = await createRunningRoom(runtime);
  await human(room, 0, { kind: 'move', regionId: 'side_path' });
  await human(room, 0, { kind: 'speak', text: '出口 store', channel: 'public', recipientIds: [] });
  async function reach(regionId) {
    for (let index = 0; index < 40; index++) {
      const proposed = await propose(room, 'wukong'); await commit(proposed);
      if ((await runtime.replay(room.sessionId)).characters.wukong.regionId === regionId) return;
    }
    assert.fail('明确合法路线未实际完成');
  }
  await reach('store');
  await human(room, 0, { kind: 'move', regionId: 'store' });
  await human(room, 0, { kind: 'speak', text: '出口 side_path', channel: 'public', recipientIds: [] });
  await reach('side_path');
  for (let index = 0; index < 30; index++) {
    const proposed = await propose(room, 'wukong'); await commit(proposed);
    assert.equal(proposed.intent.toolCalls.some(tool => tool.kind === 'move'), false, '最新请求已抵达，旧store建议不能再次成为移动意图');
    assert.equal((await runtime.replay(room.sessionId)).characters.wukong.regionId, 'side_path');
  }
});

test('双策略只读取本角色合法上下文，各自主动检查并提出不同方案', async () => {
  const room = await createRunningRoom(runtime);
  const tang = await propose(room, 'tangseng');
  const monkey = await propose(room, 'wukong');
  assert.notEqual(mockPolicies.tangseng.modelId, mockPolicies.wukong.modelId);
  assert.notEqual(mockPolicies.tangseng.providerId, mockPolicies.wukong.providerId);
  assert.notDeepEqual(tang.context.memory.beliefs, monkey.context.memory.beliefs);
  for (const proposed of [tang, monkey]) {
    assert.deepEqual(proposed.context.memory.observations.map(o => o.observationId), proposed.decision.observationIds);
    assert.ok(proposed.context.memory.observations.every(o => o.observerId === proposed.context.actorId));
    assert.ok(proposed.context.memory.beliefs.every(b => b.holderId === proposed.context.actorId));
    assert.ok(proposed.intent.toolCalls.every(tool => proposed.decision.allowedTools.includes(tool.kind)));
    assert.ok(proposed.intent.toolCalls.some(tool => tool.kind === 'inspect'));
    assert.ok(proposed.intent.toolCalls.every(tool => !['use_item', 'interact', 'take_item'].includes(tool.kind)));
    await commit(proposed);
  }
  const world = await runtime.replay(room.sessionId);
  const texts = Object.values(world.claims);
  assert.ok(texts.some(c => c.speakerId === 'tangseng' && /暂不通行/.test(c.text) && /修复/.test(c.text)));
  assert.ok(texts.some(c => c.speakerId === 'wukong' && /亲自检查/.test(c.text)));
  assert.equal(world.targets.passage_structure.fields.find(f => f.key === 'safe').value, false);
  assert.equal(world.targets.passage_structure.fields.find(f => f.key === 'permit').value, false);
});

test('相同口头指责：旧记录单源及重复分享不足，独立现场痕迹改变唐僧公开判断与证据行动', async () => {
  const room = await createRunningRoom(runtime);
  const wording = '同行损坏了通路，应该立即认错并承担修复。';
  await human(room, 0, { kind: 'speak', text: wording, channel: 'public', recipientIds: [] });
  await shareSource(room, 0, 'structure-before-arrival');
  await shareSource(room, 0, 'structure-before-arrival');
  const before = await propose(room, 'tangseng');
  assert.equal(claimText(before).includes('相互印证'), false);
  await commit(before);
  await human(room, 0, { kind: 'inspect', targetId: 'passage_structure' });
  await shareSource(room, 0, 'structure-current-trace');
  await human(room, 0, { kind: 'speak', text: wording, channel: 'public', recipientIds: [] });
  const after = await propose(room, 'tangseng');
  assert.match(claimText(after), /损坏早于到达.*不再把损坏归咎/);
  assert.ok(after.intent.toolCalls.some(tool => tool.kind === 'share_evidence'));
  assert.equal(after.intent.beliefUpdates[0].basedOnObservationIds.length, 2);
  await commit(after);
  const unseen = await propose(room, 'wukong');
  assert.equal(unseen.context.memory.observations.some(o => o.source.sourceIds.includes('structure-current-trace')), false);
  assert.equal(claimText(unseen).includes('损坏早于到达'), false);
  assert.equal((await runtime.replay(room.sessionId)).targets.passage_structure.fields.find(f => f.key === 'safe').value, false);
});

test('相同口头指责：登记单源不足，真实现场标记改变材料建议；悟空仅在合法分享后调整', async () => {
  const room = await createRunningRoom(runtime);
  const wording = '原材料被偷走了，应该让搬运者承担全部损失。';
  await human(room, 1, { kind: 'inspect', targetId: 'stock_record' });
  await human(room, 1, { kind: 'move', regionId: 'passage' });
  await human(room, 1, { kind: 'speak', text: wording, channel: 'public', recipientIds: [] });
  await shareSource(room, 1, 'authorized-movement-register');
  const before = await propose(room, 'tangseng');
  assert.equal(claimText(before).includes('材料属于合法搬运'), false);
  await commit(before);
  await human(room, 0, { kind: 'move', regionId: 'side_path' });
  await human(room, 0, { kind: 'inspect', targetId: 'material_cache' });
  const unseen = await propose(room, 'wukong');
  assert.equal(unseen.context.memory.observations.some(o => o.source.sourceIds.includes('material-site-trace')), false);
  await human(room, 0, { kind: 'move', regionId: 'passage' });
  await shareSource(room, 0, 'material-site-trace');
  await human(room, 1, { kind: 'speak', text: wording, channel: 'public', recipientIds: [] });
  const after = await propose(room, 'tangseng');
  assert.match(claimText(after), /材料属于合法搬运.*不能按盗取定责/);
  assert.ok(after.intent.toolCalls.some(tool => tool.kind === 'share_evidence'));
  await commit(after);
  await human(room, 1, { kind: 'move', regionId: 'side_path' });
  await shareSource(room, 1, 'authorized-movement-register', 'wukong');
  await human(room, 0, { kind: 'move', regionId: 'side_path' });
  await shareSource(room, 0, 'material-site-trace', 'wukong');
  await human(room, 1, { kind: 'speak', text: wording, channel: 'public', recipientIds: [] });
  const monkeyAfter = await propose(room, 'wukong');
  assert.match(claimText(monkeyAfter), /改为支持取回原材料/);
  assert.ok(monkeyAfter.intent.toolCalls.some(tool => tool.kind === 'share_evidence'));
  await commit(monkeyAfter);
});

test('口头修复与路线请求不能通行；玩家真实修复和许可后，公开方案改变并实际移动', async () => {
  const room = await createRunningRoom(runtime);
  const wording = '通路已经修好了，请从出口 destination 通行。';
  await human(room, 0, { kind: 'speak', text: wording, channel: 'public', recipientIds: [] });
  const refused = await propose(room, 'tangseng');
  assert.match(claimText(refused), /暂不通行/);
  assert.equal(refused.intent.toolCalls.some(tool => tool.kind === 'move'), false);
  await commit(refused);
  await human(room, 0, { kind: 'move', regionId: 'side_path' });
  await human(room, 0, { kind: 'take_item', itemId: 'original_material', expectedItemRevision: '0' });
  await human(room, 0, { kind: 'move', regionId: 'passage' });
  await human(room, 1, { kind: 'move', regionId: 'passage' });
  await human(room, 1, { kind: 'transfer_item', itemId: 'repair_tool', targetId: room.actors[0], expectedItemRevision: '0' });
  await human(room, 0, { kind: 'use_item', itemIds: ['original_material', 'repair_tool'], expectedItemRevisions: { original_material: '1', repair_tool: '1' }, targetId: 'passage_structure', expectedTargetRevision: '0', operation: 'repair' });
  const repaired = await propose(room, 'tangseng');
  assert.match(claimText(repaired), /已看到实际修复.*许可尚未生效/);
  assert.equal(repaired.intent.toolCalls.some(tool => tool.kind === 'move'), false);
  await commit(repaired);
  await human(room, 1, { kind: 'interact', targetId: 'passage_structure', expectedTargetRevision: '1', operation: 'grant_passage' });
  await human(room, 0, { kind: 'speak', text: wording, channel: 'public', recipientIds: [] });
  const permitted = await propose(room, 'tangseng');
  assert.match(claimText(permitted), /已确认实际修复与有效许可/);
  await commit(permitted);
  let moved = false;
  for (let index = 0; index < 20 && !moved; index++) {
    const proposed = await propose(room, 'tangseng');
    assert.ok(proposed.intent.toolCalls.every(tool => !['use_item', 'interact'].includes(tool.kind)));
    await commit(proposed);
    moved = proposed.intent.toolCalls.some(tool => tool.kind === 'move' && tool.regionId === 'destination');
  }
  assert.equal(moved, true, '方案变化必须随后产生实际合法移动');
  const state = await runtime.replay(room.sessionId);
  assert.equal(state.characters.tangseng.regionId, 'destination');
  assert.equal(state.characters.wukong.regionId, 'side_path', '未听到请求与新证据的另一角色不能提前通行');
  assert.equal(state.phase, 'Running', '一人答应或抵达不等于两角色终局');
});

test('私人说法与跨局唯一标记不进入完整 provider 输入，核心策略不接受代理主体', async () => {
  const room = await createRunningRoom(runtime);
  const other = await createRunningRoom(runtime);
  const secret = `私人标记-${crypto.randomUUID()}`;
  const otherMarker = `跨局标记-${crypto.randomUUID()}`;
  assert.equal((await runtime.submit(room.connections[0], actionRaw(room, 0, { kind: 'speak', text: secret, channel: 'private', recipientIds: [room.actors[1]] }))).status, 'Accepted');
  assert.equal((await runtime.submit(other.connections[0], actionRaw(other, 0, { kind: 'speak', text: otherMarker, channel: 'public', recipientIds: [] }))).status, 'Accepted');
  for (const role of ['tangseng', 'wukong']) {
    const proposed = await propose(room, role);
    assert.equal(JSON.stringify(proposed.input).includes(secret), false);
    assert.equal(JSON.stringify(proposed.input).includes(otherMarker), false);
    const provider = createMockProvider(role);
    await assert.rejects(async () => provider.generate({ ...proposed.input, context: { ...proposed.context, principalKind: 'proxy' } }), /核心角色/);
  }
});
