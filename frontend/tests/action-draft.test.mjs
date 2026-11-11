import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { prepareAction } from '../src/domain/action-draft.ts';

const fixtures = JSON.parse(await readFile(new URL('../../protocol/fixtures/valid-v1.json', import.meta.url), 'utf8'));

test('动作草稿固定原游标、控制代次和载荷，后续投影变化不改写原请求', () => {
  const snapshot = structuredClone(fixtures.AuthorizedSnapshot);
  snapshot.projection.phase = 'Running';
  snapshot.projection.self.canControl = true;
  snapshot.projection.self.mode = 'HumanControlled';
  const action = { kind: 'transfer_item', itemId: 'I7', targetId: 'C4', expectedItemRevision: '2' };
  const draft = prepareAction(snapshot, action, 'request-fixed');
  const before = draft.raw;
  snapshot.snapshotSeq = '2000';
  snapshot.projection.self.controlEpoch = '20';
  action.expectedItemRevision = '9';
  assert.equal(draft.raw, before);
  const parsed = JSON.parse(before);
  assert.equal(parsed.clientActionId, 'request-fixed');
  assert.equal(parsed.controlEpoch, fixtures.AuthorizedSnapshot.projection.self.controlEpoch);
  assert.equal(parsed.baseSeq, fixtures.AuthorizedSnapshot.snapshotSeq);
  assert.equal(parsed.action.expectedItemRevision, '2');
  assert.equal(draft.status, 'waiting');
});

test('只读、非运行与未获控制的投影不能发出新动作', () => {
  const snapshot = structuredClone(fixtures.AuthorizedSnapshot);
  snapshot.projection.self.canControl = false;
  assert.throws(() => prepareAction(snapshot, { kind: 'wait' }, 'request-readonly'));
  snapshot.projection.self.canControl = true;
  snapshot.projection.phase = 'Finished';
  assert.throws(() => prepareAction(snapshot, { kind: 'wait' }, 'request-terminal'));
});
