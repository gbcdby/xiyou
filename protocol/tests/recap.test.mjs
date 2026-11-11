import test from 'node:test';
import assert from 'node:assert/strict';
import { validateContract, parseContract, ContractError } from '../index.mjs';

const entry = (eventSeq = '9') => ({ entryId: 'R-9', eventSeq, serverTime: '2026-11-11T12:00:00.000Z', category: 'Claim', kind: 'received_claim', actorId: 'B', text: '通路已修好', fields: [], references: [{ kind: 'claim', id: 'claim-1' }] });
const recap = () => ({ schemaVersion: 1, type: 'session.recap', sessionId: 'S1', actorId: 'B', throughSeq: '10', phase: 'Finished', entries: [entry()], nextBeforeSeq: null });

test('独立终态复盘契约保留分享陈述、严格字段与完整原文', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(parseContract('AuthorizedRecap', JSON.stringify(recap())))), recap());
  const large = recap(); large.entries[0].text = '证'.repeat(2000); large.entries[0].fields = Array.from({ length: 32 }, (_, i) => ({ key: `f${i}`, label: '已授权字段', value: '证'.repeat(2000) }));
  validateContract('AuthorizedRecap', large);
  assert.equal(parseContract('AuthorizedRecap', JSON.stringify(large)).entries[0].text.length, 2000);
  for (const extra of [{ audience: {} }, { causedBy: {} }, { hiddenCount: 3 }]) assert.throws(() => validateContract('AuthorizedRecap', { ...recap(), ...extra }), ContractError);
  assert.throws(() => validateContract('AuthorizedRecap', { ...recap(), phase: 'Running' }), ContractError);
  assert.throws(() => validateContract('AuthorizedRecap', { ...recap(), entries: [{ ...entry(), category: 'Observation' }] }), ContractError);
});

test('复盘序号严格递减、限于固定水位，下一页游标只能是最后可见条目', () => {
  const value = { ...recap(), entries: [entry('9'), { ...entry('7'), entryId: 'R-7' }], nextBeforeSeq: '7' };
  validateContract('AuthorizedRecap', value);
  for (const changes of [
    { entries: [entry('11')] }, { entries: [entry('9'), { ...entry('9'), entryId: 'R-other' }] },
    { entries: [entry('7'), { ...entry('9'), entryId: 'R-other' }] }, { nextBeforeSeq: '8' },
    { entries: [], nextBeforeSeq: '7' }, { entries: Array(101).fill(entry()) },
  ]) assert.throws(() => validateContract('AuthorizedRecap', { ...value, ...changes }), ContractError);
});
