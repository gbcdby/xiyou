import test from 'node:test';
import assert from 'node:assert/strict';
import { SpatialSessionClient } from '../src/network/spatial-session.ts';
import { spatialSnapshot, spatialBatch } from './spatial-fixture.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));
async function room(t, drafts = []) {
  const initial = spatialSnapshot(), requests = []; let handlers, mode = 'empty', pending, active = 0, maximum = 0;
  const empty = q => ({ schemaVersion: 2, type: 'world.batch', sessionId: q.sessionId, viewId: q.viewId, fromExclusive: q.cursor, throughSeq: q.cursor, events: [] });
  const advance = q => spatialBatch({ ...initial, snapshotSeq: q.cursor }, String(BigInt(q.cursor) + 1n));
  const link = { connected: true, close() {}, async request(event, raw) {
    if (event === 'session.subscribe') return structuredClone(initial);
    assert.equal(event, 'sync.request', '同步不能重发世界动作');
    const q = JSON.parse(raw); requests.push(q); active++; maximum = Math.max(maximum, active);
    try {
      if (mode === 'hold') return await new Promise((resolve, reject) => { pending = value => value instanceof Error ? reject(value) : resolve(value === 'advance' ? advance(q) : value ?? empty(q)); });
      return mode === 'advance' ? advance(q) : empty(q);
    } finally { active--; }
  } };
  const client = new SpatialSessionClient({ receipt: async () => null }, (_token, value) => { handlers = value; return link; }, { heartbeatMs: 0, reconnectDelayMs: 0 });
  t.after(() => client.close()); client.open(initial.sessionId, 'token', drafts); handlers.connected(); await flush(); await flush();
  return { client, initial, requests, handlers, get maximum() { return maximum; }, setMode(value) { mode = value; }, reply(value) { pending(value); } };
}

test('D66-CLIENT-03：活动sync期间多个新需求和重叠推送合并为一次补读', async t => {
  const h = await room(t), count = h.requests.length; h.setMode('hold'); const first = h.client.sync();
  await flush(); h.handlers.batch(spatialBatch({ ...h.initial, snapshotSeq: '9' }, '12'));
  void h.client.sync(); void h.client.sync(); await flush();
  assert.equal(h.requests.length - count, 1);
  h.setMode('empty'); h.reply(); await first; await flush(); await flush();
  assert.equal(h.requests.length - count, 2, '原sync结束后消费fresh需求一次');
  assert.equal(h.maximum, 1);
});

test('D66-CLIENT-03：每轮最多8页，仅有新需求时追加一轮，无需求不无限追赶', async t => {
  const h = await room(t), count = h.requests.length; h.setMode('hold'); const first = h.client.sync();
  await flush(); void h.client.sync(); h.setMode('advance'); h.reply('advance'); await first; await flush(); await flush();
  assert.equal(h.requests.length - count, 16, '一轮8页和合并的一轮8页，没有第三轮');
  assert.equal(h.maximum, 1);
});

test('D66-CLIENT-03：sync自身refetch只续本轮剩余页，不制造递归需求', async t => {
  const h = await room(t), count = h.requests.length; h.setMode('hold'); const first = h.client.sync();
  await flush(); h.setMode('advance'); h.reply(spatialBatch({ ...h.initial, snapshotSeq: '9' }, '12'));
  await first; await flush(); await flush();
  assert.equal(h.requests.length - count, 8);
  assert.deepEqual(h.requests.slice(count).map(q => q.cursor), ['10', '10', '11', '12', '13', '14', '15', '16']);
  assert.equal(h.client.state.snapshot.snapshotSeq, '17', '原非法页未应用，后续合法页从实际cursor推进');
  assert.equal(h.maximum, 1);
});

test('D66-CLIENT-03：断线或Forbidden使旧同步和排队需求失效', async t => {
  for (const ending of ['断线', 'Forbidden']) await t.test(ending, async t => {
    const h = await room(t), count = h.requests.length; h.setMode('hold'); const first = h.client.sync();
    await flush(); void h.client.sync();
    if (ending === '断线') h.handlers.disconnected();
    h.setMode('advance'); h.reply(ending === 'Forbidden' ? { schemaVersion: 2, code: 'FORBIDDEN', message: '授权已撤销。' } : undefined);
    await first; await flush(); await flush();
    assert.equal(h.requests.length - count, 1); assert.equal(h.client.state.snapshot, null);
    assert.equal(h.client.state.connection, ending === '断线' ? 'offline' : 'forbidden');
  });
});

test('D66-CLIENT-03：读取错误只消费已有新需求一次，Unknown原动作不重发或恢复输入', async t => {
  const snapshot = spatialSnapshot();
  const raw = JSON.stringify({ schemaVersion: 2, sessionId: snapshot.sessionId, viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef,
    clientActionId: 'original-direction', controlEpoch: '2', baseSeq: '10', action: { kind: 'move_direction', movementCommandSeq: '1', sceneId: 'yard', mapVersion: 'gray-map-v1', direction: 'E' } });
  for (const failure of ['OUTCOME_UNKNOWN', 'transport']) await t.test(failure, async t => {
    const h = await room(t, [{ id: 'original-direction', raw }]), count = h.requests.length;
    h.setMode('hold'); const first = h.client.sync(); await flush(); void h.client.sync();
    h.setMode('empty'); h.reply(failure === 'transport' ? new Error('读取回复丢失') : { schemaVersion: 2, code: 'OUTCOME_UNKNOWN', message: '读取未完成。' });
    await first; await flush(); await flush();
    assert.equal(h.requests.length - count, 2); assert.equal(h.maximum, 1);
    assert.equal(h.client.state.actions.length, 1); assert.equal(h.client.state.actions[0].status, 'unknown');
    assert.equal(h.client.state.actions[0].raw, raw); assert.equal(h.client.state.inputReady, false);
  });
});
