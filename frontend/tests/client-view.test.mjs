import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ClientView } from '../src/domain/client-view.ts';

const fixture = JSON.parse(await readFile(new URL('../../protocol/fixtures/valid-v1.json', import.meta.url), 'utf8')).AuthorizedSnapshot;
function snapshot() { return structuredClone(fixture); }
function batch(from, through, events = []) { return { schemaVersion: 1, type: 'world.batch', sessionId: fixture.sessionId, viewId: fixture.viewId, fromExclusive: from, throughSeq: through, events }; }
function setup() { const view = new ClientView(); const generation = view.begin(fixture.sessionId); view.acceptSnapshot(snapshot(), generation); return { view, generation }; }

test('隐藏事件的空完整区间仍推进游标，整批重复被忽略', () => {
  const { view, generation } = setup();
  const from = fixture.snapshotSeq;
  const through = (BigInt(from) + 2n).toString();
  assert.equal(view.applyBatch(batch(from, through), generation), 'applied');
  assert.equal(view.snapshot.snapshotSeq, through);
  assert.deepEqual(structuredClone(view.snapshot.projection), snapshot().projection);
  assert.equal(view.applyBatch(batch(from, through), generation), 'duplicate');
});

test('未来与重叠区间丢弃并从当前游标请求，不能猜补', () => {
  const { view, generation } = setup();
  const from = fixture.snapshotSeq;
  const future = (BigInt(from) + 1n).toString();
  assert.equal(view.applyBatch(batch(future, (BigInt(from) + 3n).toString()), generation), 'refetch');
  assert.equal(view.applyBatch(batch((BigInt(from) - 1n).toString(), future), generation), 'refetch');
  assert.equal(view.snapshot.snapshotSeq, from);
  assert.equal(view.syncRequest().cursor, from);
});

test('同批先合法后非法时，投影和游标均保持原样', () => {
  const { view, generation } = setup();
  const before = JSON.stringify(view.snapshot);
  const n = BigInt(fixture.snapshotSeq);
  const projection = structuredClone(fixture.projection);
  projection.items = [];
  const events = [
    { sessionSeq: (n + 1n).toString(), eventId: `${fixture.sessionId}:E${n + 1n}`, kind: 'projection.replace', payload: { projection } },
    { sessionSeq: (n + 2n).toString(), eventId: `${fixture.sessionId}:E${n + 2n}`, kind: 'ObservationRecorded', payload: { ...structuredClone(fixture.projection.observations[0]), observationId: 'wrong-observer', observerId: 'other-character' } },
  ];
  assert.equal(view.applyBatch(batch(n.toString(), (n + 2n).toString(), events), generation), 'refetch');
  assert.equal(JSON.stringify(view.snapshot), before);
});

test('换绑或撤权清空旧数据，旧代快照与旧流不能重新填入', () => {
  const { view, generation } = setup();
  const next = view.begin(fixture.sessionId);
  assert.equal(view.snapshot, null);
  assert.equal(view.acceptSnapshot(snapshot(), generation), 'stale');
  assert.equal(view.applyBatch(batch(fixture.snapshotSeq, (BigInt(fixture.snapshotSeq) + 1n).toString()), generation), 'stale');
  const foreign = snapshot(); foreign.sessionId = 'another-session';
  assert.equal(view.acceptSnapshot(foreign, next), 'stale');
  assert.equal(view.acceptSnapshot(snapshot(), next), 'applied');
  const foreignBatch = batch(fixture.snapshotSeq, (BigInt(fixture.snapshotSeq) + 1n).toString());
  foreignBatch.viewId = 'other-view';
  assert.equal(view.applyBatch(foreignBatch, next), 'stale');
  assert.equal(view.acceptSnapshot(snapshot(), next), 'stale');
});

test('投影替换能移除旧可见字段，并精确处理大于安全整数的游标', () => {
  const view = new ClientView(); const generation = view.begin(fixture.sessionId);
  const initial = snapshot(); initial.snapshotSeq = '9007199254740993';
  view.acceptSnapshot(initial, generation);
  const projection = structuredClone(initial.projection); projection.items = [];
  assert.equal(view.applyBatch(batch(initial.snapshotSeq, '9007199254740994', [{ sessionSeq: '9007199254740994', eventId: `${fixture.sessionId}:E9007199254740994`, kind: 'projection.replace', payload: { projection } }]), generation), 'applied');
  assert.equal(view.snapshot.snapshotSeq, '9007199254740994');
  assert.equal(view.snapshot.projection.items.length, 0);
});

test('终态快照仍可读取，旧区间重复不会执行，新的世界效果要求重新核对', () => {
  const view = new ClientView(); const generation = view.begin(fixture.sessionId);
  const terminal = snapshot(); terminal.projection.phase = 'Finished';
  terminal.projection.self.canControl = false; terminal.projection.self.mode = 'Revoked';
  terminal.projection.ending = { endingCode: 'unresolved', title: '本局结束', summary: '时限已到。', facts: [], unresolved: [] };
  assert.equal(view.acceptSnapshot(terminal, generation), 'applied');
  assert.equal(view.applyBatch(batch((BigInt(fixture.snapshotSeq) - 1n).toString(), fixture.snapshotSeq), generation), 'duplicate');
  assert.equal(view.applyBatch(batch(fixture.snapshotSeq, (BigInt(fixture.snapshotSeq) + 1n).toString()), generation), 'resync');
  assert.equal(view.snapshot.projection.phase, 'Finished');
});
