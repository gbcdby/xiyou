import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseContract, ContractError } from '../index.mjs';

const valid = JSON.parse(readFileSync(new URL('../fixtures/valid-v1.json', import.meta.url), 'utf8'));
const copy = value => structuredClone(value);
const parse = (name, value) => parseContract(name, JSON.stringify(value));
const wrapBatch = (kind, payload) => ({
  ...copy(valid.WorldBatch),
  events: [{ sessionSeq: '1010', eventId: 'S1:E1010', kind, payload }],
});
const wrapPersisted = (kind, payload) => ({ ...copy(valid.WorldEvent), kind, payload });

test('R-vs001-p01-REQ-001：事件包装一致拒绝非法陈述接收结构', () => {
  for (const [channel, recipientIds] of [['private', []], ['directed', []], ['public', ['C3']]]) {
    const claim = { claimId: 'claim-regression', speakerId: 'C4', text: '检验接收结构', channel, recipientIds };
    assert.throws(() => parse('WorldBatch', wrapBatch('ClaimRecorded', claim)), ContractError);
    assert.throws(() => parse('WorldEvent', wrapPersisted('ClaimRecorded', claim)), ContractError);
  }
});

test('R-vs001-p01-REQ-001：观察的来源游标不能晚于所在事件', () => {
  const observation = copy(valid.AuthorizedProjection.observations[0]);
  observation.source.sourceSeq = '2000';
  assert.throws(() => parse('WorldBatch', wrapBatch('ObservationRecorded', observation)), ContractError);
  assert.throws(() => parse('WorldEvent', wrapPersisted('ObservationRecorded', observation)), ContractError);
  const snapshot = copy(valid.AuthorizedSnapshot);
  snapshot.projection.observations = [observation];
  assert.throws(() => parse('AuthorizedSnapshot', snapshot), ContractError);
});

test('事件关系检查仍接受合法频道以及过去或当前前缀来源', () => {
  for (const [channel, recipientIds] of [['private', ['C3']], ['directed', ['C3']], ['public', []]]) {
    const claim = { claimId: 'claim-control', speakerId: 'C4', text: '合法陈述', channel, recipientIds };
    parse('WorldBatch', wrapBatch('ClaimRecorded', claim));
    parse('WorldEvent', wrapPersisted('ClaimRecorded', claim));
  }
  for (const sourceSeq of ['0', '1000', '1009']) {
    const observation = copy(valid.AuthorizedProjection.observations[0]);
    observation.source.sourceSeq = sourceSeq;
    parse('WorldEvent', wrapPersisted('ObservationRecorded', observation));
    parse('WorldBatch', wrapBatch('ObservationRecorded', observation));
  }
  const current = copy(valid.AuthorizedProjection.observations[0]);
  current.source.sourceSeq = '1010';
  parse('WorldBatch', wrapBatch('ObservationRecorded', current));
  const snapshot = copy(valid.AuthorizedSnapshot);
  snapshot.projection.observations[0].source.sourceSeq = snapshot.snapshotSeq;
  parse('AuthorizedSnapshot', snapshot);
});
