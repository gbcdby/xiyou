import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClientAction, validateContract, compareDecimal, actionSemanticDigest, ContractError } from '../index.mjs';

const action = () => ({ schemaVersion: 1, sessionId: 'S1', actorId: 'C3', clientActionId: 'A-7b8d', controlEpoch: '4', baseSeq: '1008', action: { kind: 'transfer_item', itemId: 'I7', targetId: 'C4', expectedItemRevision: '2' } });

test('M0 原始动作示例合法且客户端不可提供可信字段', () => {
  assert.equal(parseClientAction(JSON.stringify(action())).actorId, 'C3');
  for (const [key, value] of [['principalId', 'system'], ['connectionId', 'conn'], ['serverTime', '2026-11-11T00:00:00.000Z'], ['sessionSeq', '1009']]) {
    assert.throws(() => parseClientAction(JSON.stringify({ ...action(), [key]: value })), ContractError);
  }
  assert.throws(() => validateContract('ClientAction', { ...action(), action: { ...action().action, visibility: 'all' } }), ContractError);
});

test('版本、未知动作与无前导零十进制字符串遵守固定合同', () => {
  for (const baseSeq of [0, '-1', '01', '1.0', ' 1', '1e2']) assert.throws(() => validateContract('ClientAction', { ...action(), baseSeq }), ContractError);
  assert.throws(() => validateContract('ClientAction', { ...action(), schemaVersion: 2 }), ContractError);
  assert.throws(() => validateContract('ClientAction', { ...action(), action: { kind: 'grant_world_fact' } }), ContractError);
  assert.equal(compareDecimal('9', '10'), -1);
  assert.equal(compareDecimal('9007199254740993', '9007199254740992'), 1);
});

test('摘要与字段顺序无关，覆盖旧 epoch、游标、角色和完整操作', async () => {
  const first = action();
  const reordered = { action: { expectedItemRevision: '2', targetId: 'C4', itemId: 'I7', kind: 'transfer_item' }, baseSeq: '1008', controlEpoch: '4', clientActionId: 'A-7b8d', actorId: 'C3', sessionId: 'S1', schemaVersion: 1 };
  assert.equal(await actionSemanticDigest(first), await actionSemanticDigest(reordered));
  for (const changed of [{ ...first, controlEpoch: '5' }, { ...first, baseSeq: '1009' }, { ...first, actorId: 'C5' }, { ...first, action: { ...first.action, targetId: 'C5' } }]) assert.notEqual(await actionSemanticDigest(first), await actionSemanticDigest(changed));
});

test('物品使用明确携带全部物品与目标的前置版本', () => {
  const use = { kind: 'use_item', itemIds: ['material', 'tool'], expectedItemRevisions: { material: '2', tool: '0' }, targetId: 'gate', expectedTargetRevision: '1', operation: 'repair' };
  validateContract('ClientAction', { ...action(), action: use });
  for (const invalid of [{ ...use, expectedItemRevisions: { material: '2' } }, { ...use, itemIds: ['material', 'material'] }, { ...use, expectedTargetRevision: undefined }]) assert.throws(() => validateContract('ClientAction', { ...action(), action: invalid }), ContractError);
});
