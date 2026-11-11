import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseContract, validateContract, parseProposedIntent, canonicalActionPayload,
  actionSemanticDigest, intentSemanticDigest, contractNames, contractSchema, ContractError,
} from '../index.mjs';
import { actionSemanticDigestSync, intentSemanticDigestSync } from '../node.mjs';

const read = file => JSON.parse(readFileSync(new URL('../fixtures/' + file, import.meta.url), 'utf8'));
const valid = read('valid-v1.json');
const invalid = read('invalid-v1.json');
const vector = read('digest-v1.json');
const copy = value => structuredClone(value);

test('全部固定正反样本使用公开入口校验', () => {
  assert.deepEqual(Object.keys(valid).sort(), [...contractNames].sort());
  for (const [name, value] of Object.entries(valid)) validateContract(name, parseContract(name, JSON.stringify(value)));
  for (const sample of invalid) assert.throws(() => validateContract(sample.contract, sample.value), ContractError, sample.name);
});

test('摘要与独立计算的固定向量一致，去重 ID 只负责定位', async () => {
  assert.equal(canonicalActionPayload(valid.ClientAction), vector.canonical);
  assert.equal(actionSemanticDigestSync(valid.ClientAction), vector.sha256);
  assert.equal(await actionSemanticDigest(valid.ClientAction), vector.sha256);
  assert.equal(await actionSemanticDigest({ ...valid.ClientAction, clientActionId: 'another-id' }), vector.sha256);
  assert.equal(await intentSemanticDigest(valid.ProposedIntent), intentSemanticDigestSync(valid.ProposedIntent));
  const reordered = copy(valid.ProposedIntent);
  reordered.toolCalls.reverse();
  assert.notEqual(intentSemanticDigestSync(reordered), intentSemanticDigestSync(valid.ProposedIntent));
});

test('模型输出不能改写决策身份、读取版本或工具索引', () => {
  const raw = JSON.stringify(valid.ProposedIntent);
  assert.equal(parseProposedIntent(raw, 'D1').decisionId, 'D1');
  assert.throws(() => parseProposedIntent(raw, 'D2'), ContractError);
  for (const fields of [{ generation: '100' }, { controlEpoch: '100' }, { observationIds: ['secret'] }, { allowedTools: ['interact'] }]) {
    assert.throws(() => validateContract('ProposedIntent', { ...valid.ProposedIntent, ...fields }), ContractError);
  }
  const indexed = copy(valid.ProposedIntent);
  indexed.toolCalls[0].toolCallIndex = 3;
  assert.throws(() => validateContract('ProposedIntent', indexed), ContractError);
});

test('收据状态、事件范围和观察游标不能混淆', () => {
  const rejected = { ...valid.ActionReceipt, status: 'Rejected', code: 'STALE_CONTROL', actionEventRange: null };
  validateContract('ActionReceipt', rejected);
  for (const changes of [
    { status: 'Pending' }, { status: 'Rejected', code: 'STALE_CONTROL' },
    { actionEventRange: { first: '1010', last: '1011' } },
    { actionEventRange: { first: '1009', last: '1008' } },
  ]) assert.throws(() => validateContract('ActionReceipt', { ...valid.ActionReceipt, ...changes }), ContractError);
  // 拒绝命令可以观察到同事务系统截止事件的新游标，但动作范围仍为空。
  validateContract('ActionReceipt', { ...rejected, observedSeq: '1010' });
});

test('过滤区间允许隐藏事件，拒绝乱序、区间外和错误 Session 身份', () => {
  validateContract('WorldBatch', { ...valid.WorldBatch, events: [] });
  validateContract('WorldBatch', { ...valid.WorldBatch, fromExclusive: '1011', throughSeq: '1011', events: [] });
  for (const changes of [
    { fromExclusive: '1012' }, { throughSeq: '1265' },
    { sessionId: 'S2' }, { events: [valid.WorldBatch.events[0], valid.WorldBatch.events[0]] },
    { throughSeq: '1009' },
  ]) assert.throws(() => validateContract('WorldBatch', { ...valid.WorldBatch, ...changes }), ContractError);
});

test('授权投影只能带本人的合法知识结构，保留超过千条的累计知识', () => {
  const wrongObserver = copy(valid.AuthorizedSnapshot);
  wrongObserver.projection.observations[0].observerId = 'wukong';
  assert.throws(() => validateContract('AuthorizedSnapshot', wrongObserver), ContractError);
  const future = copy(valid.AuthorizedSnapshot);
  future.projection.observations[0].source.sourceSeq = '1009';
  assert.throws(() => validateContract('AuthorizedSnapshot', future), ContractError);
  const privateClaim = copy(valid.AuthorizedSnapshot);
  privateClaim.projection.claims.push({ claimId: 'private-1', speakerId: 'C4', text: '不可读内容', channel: 'private', recipientIds: ['tang'] });
  assert.throws(() => validateContract('AuthorizedSnapshot', privateClaim), ContractError);
  const many = copy(valid.AuthorizedSnapshot);
  many.projection.observations = Array.from({ length: 1001 }, (_, i) => ({ ...copy(valid.AuthorizedSnapshot.projection.observations[0]), observationId: 'O' + i }));
  validateContract('AuthorizedSnapshot', many);
});

test('事实、陈述和信念记录具有不同 payload 与来源要求', () => {
  const claim = { claimId: 'claim-1', speakerId: 'C3', text: '通路已经修好', channel: 'public', recipientIds: [] };
  validateContract('WorldEvent', { ...valid.WorldEvent, kind: 'ClaimRecorded', payload: claim });
  assert.throws(() => validateContract('WorldEvent', { ...valid.WorldEvent, kind: 'target.updated', payload: claim }), ContractError);
  const belief = { beliefId: 'belief-1', holderId: 'tang', statement: '暂不确定责任', confidence: 'uncertain', basedOnObservationIds: ['O2'], revision: '1' };
  validateContract('WorldEvent', { ...valid.WorldEvent, kind: 'BeliefUpdated', payload: belief });
  assert.throws(() => validateContract('WorldEvent', { ...valid.WorldEvent, kind: 'BeliefUpdated', payload: { ...belief, basedOnObservationIds: [] } }), ContractError);
});

test('可信上下文的结构校验不能由客户端字段混入', () => {
  const context = copy(valid.TrustedExecutionContext);
  delete context.connectionId;
  assert.throws(() => validateContract('TrustedExecutionContext', context), ContractError);
  assert.throws(() => validateContract('ClientAction', { ...valid.ClientAction, context: valid.TrustedExecutionContext }), ContractError);
  assert.throws(() => validateContract('WorldEvent', { ...valid.WorldEvent, eventId: 'S2:E1009' }), ContractError);
  assert.throws(() => validateContract('WorldEvent', { ...valid.WorldEvent, serverTime: '2026-02-31T04:00:00.000Z' }), ContractError);
});

test('调用方不能修改公开 schema 后放松其他请求的校验', () => {
  assert.throws(() => { contractSchema.$defs.ClientAction.additionalProperties = true; }, TypeError);
  assert.throws(() => { contractNames.push('Anything'); }, TypeError);
});
