import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ActionJournal } from '../src/domain/action-journal.ts';
import { prepareAction } from '../src/domain/action-draft.ts';
const snapshot = JSON.parse(await readFile(new URL('../../protocol/fixtures/valid-v1.json', import.meta.url), 'utf8')).AuthorizedSnapshot;
function storage() { const data = new Map(); return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }; }

test('标签页恢复保留待确认动作的原始字节，按登录用户和房间隔离', () => {
  const medium = storage(); const journal = new ActionJournal(medium);
  const action = prepareAction(snapshot, { kind: 'wait' }, 'persistent-action');
  assert.equal(journal.save('user-one', snapshot.sessionId, [action]), true);
  const restored = new ActionJournal(medium).load('user-one', snapshot.sessionId);
  assert.equal(restored.length, 1); assert.equal(restored[0].raw, action.raw); assert.equal(restored[0].status, 'unknown');
  assert.equal(journal.load('user-two', snapshot.sessionId).length, 0);
  assert.equal(journal.load('user-one', 'other-session').length, 0);
  journal.save('user-one', snapshot.sessionId, [{ ...action, status: 'accepted' }]);
  assert.equal(journal.load('user-one', snapshot.sessionId).length, 0);
});

test('缓存不可写时明确返回失败，不声称动作已经持久保留', () => {
  const journal = new ActionJournal({ ...storage(), setItem: () => { throw new Error('quota'); } });
  assert.equal(journal.save('one', snapshot.sessionId, [prepareAction(snapshot, { kind: 'wait' }, 'pending')]), false);
});
