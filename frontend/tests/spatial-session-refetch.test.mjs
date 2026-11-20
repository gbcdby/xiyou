import test from 'node:test';
import assert from 'node:assert/strict';
import { SpatialSessionClient } from '../src/network/spatial-session.ts';
import { spatialSnapshot, spatialBatch } from './spatial-fixture.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));
const empty = request => ({ schemaVersion: 2, type: 'world.batch', sessionId: request.sessionId,
  viewId: request.viewId, fromExclusive: request.cursor, throughSeq: request.cursor, events: [] });

function harness(onChange = () => {}) {
  const initial = spatialSnapshot(), requests = [], changes = [];
  let handlers, reply = empty, controlReply = value => value;
  const link = { connected: true, close() { this.connected = false; }, async request(event, raw) {
    if (event === 'session.subscribe') return structuredClone(initial);
    const request = JSON.parse(raw);
    if (event === 'sync.request') { requests.push(request); return reply(request); }
    assert.ok(event.startsWith('control.'));
    const snapshot = spatialSnapshot(); snapshot.viewId = 'control-view';
    snapshot.snapshotSeq = '20'; snapshot.projection.self.controlEpoch = '3';
    return controlReply({ schemaVersion: 2, sessionId: request.sessionId, nonce: request.nonce,
      controlEpoch: '3', observedSeq: snapshot.snapshotSeq, snapshot });
  } };
  const client = new SpatialSessionClient({ receipt: async () => null }, (_token, listeners) => {
    handlers = listeners; return link;
  }, { heartbeatMs: 0, reconnectDelayMs: 0, onChange(state) {
    changes.push({ cursor: state.snapshot?.snapshotSeq, name: state.snapshot?.projection.self.name });
    onChange(state);
  } });
  return { client, initial, link, requests, changes, get handlers() { return handlers; },
    setReply(value) { reply = value; }, setControlReply(value) { controlReply = value; },
    async start() {
      client.open(initial.sessionId, 'token'); handlers.connected(); await flush();
      assert.equal(client.state.snapshot.snapshotSeq, '10'); requests.length = 0; changes.length = 0;
    } };
}

test('SV02-05：同步响应重入推进后，保留内层快照并从当前游标续取', async () => {
  const h = harness();
  try {
    await h.start(); let calls = 0;
    h.setReply(request => {
      if (h.requests.length === 1) {
        const outer = spatialBatch(h.initial, '13'), inner = spatialBatch(h.initial, '11');
        outer.events[0].payload.projection.self.name = '不应安装的外层';
        inner.events[0].payload.projection.self.name = '内层已确认';
        const projection = outer.events[0].payload.projection;
        projection.targets = new Proxy([], { ownKeys(array) {
          calls++; projection.targets = []; h.handlers.batch(inner);
          return Reflect.ownKeys(array);
        } });
        return outer;
      }
      if (request.cursor === '11') {
        const batch = spatialBatch(h.client.state.snapshot, '13');
        batch.events[0].payload.projection.self.name = '当前游标补取'; return batch;
      }
      return empty(request);
    });
    await h.client.sync();
    assert.equal(calls, 1);
    assert.deepEqual(h.requests.map(request => request.cursor), ['10', '11', '13']);
    assert.ok(h.changes.some(change => change.cursor === '11' && change.name === '内层已确认'));
    assert.ok(h.changes.every(change => change.name !== '不应安装的外层'));
    assert.equal(h.client.state.snapshot.snapshotSeq, '13');
    assert.equal(h.client.state.snapshot.projection.self.name, '当前游标补取');
  } finally { h.client.close(); }
});

test('SV02-06：等待时推送缺口在原轮后补取，即使本页响应为空重复', async () => {
  const h = harness(); let release;
  try {
    await h.start();
    h.setReply(request => h.requests.length === 1
      ? new Promise(resolve => { release = () => resolve(empty(request)); }) : empty(request));
    const pending = h.client.sync();
    h.handlers.batch(spatialBatch({ ...h.initial, snapshotSeq: '12' }, '13'));
    assert.equal(h.requests.length, 1, '同一页仍保持单个在途请求');
    release(); await pending; await flush(); await flush();
    assert.deepEqual(h.requests.map(request => request.cursor), ['10', '10']);
    assert.equal(h.client.state.snapshot.snapshotSeq, '10');
  } finally { release?.(); h.client.close(); }
});

test('SV02-06：没有新补取意图的重复响应仍结束本轮', async () => {
  const h = harness();
  try { await h.start(); await h.client.sync(); assert.equal(h.requests.length, 1); }
  finally { h.client.close(); }
});

test('SV02-07：持续refetch仍共用八页上限，结束后不自行重开', async () => {
  const h = harness();
  try {
    await h.start();
    h.setReply(() => spatialBatch({ ...h.initial, snapshotSeq: '12' }, '13'));
    await h.client.sync(); await flush();
    assert.equal(h.requests.length, 8); assert.equal(h.client.state.snapshot.snapshotSeq, '10');
    assert.ok(h.requests.every(request => request.cursor === '10'));
    h.setReply(empty); await h.client.sync();
    assert.equal(h.requests.length, 9, '上一轮释放key，显式新轮仅请求一次');
  } finally { h.client.close(); }
});

test('SV02-08：链路已断开时，refetch不会继续向旧链路发下一页', async () => {
  const h = harness();
  try {
    await h.start();
    h.setReply(() => {
      h.link.connected = false;
      return spatialBatch({ ...h.initial, snapshotSeq: '12' }, '13');
    });
    await h.client.sync(); assert.equal(h.requests.length, 1);
    assert.equal(h.client.state.snapshot.snapshotSeq, '10');
  } finally { h.client.close(); }
});

test('SV02-08：应用发布中启动控制事务，旧轮停止且新视图独立补取', async () => {
  let h, control, releaseControl, started = false;
  h = harness(state => {
    if (state.snapshot?.snapshotSeq === '11' && !started) {
      started = true; control = h.client.control('take');
    }
  });
  try {
    await h.start();
    h.setControlReply(value => new Promise(resolve => { releaseControl = () => resolve(value); }));
    h.setReply(request => request.cursor === '10' ? spatialBatch(h.initial, '11') : empty(request));
    await h.client.sync();
    assert.ok(started); assert.equal(h.client.state.controlBusy, true);
    assert.deepEqual(h.requests.map(request => request.cursor), ['10']);
    releaseControl(); await control; await flush();
    assert.equal(h.client.state.snapshot.viewId, 'control-view');
    assert.deepEqual(h.requests.map(request => [request.viewId, request.cursor]),
      [['spatial-view-1', '10'], ['control-view', '20']]);
  } finally { releaseControl?.(); if (control) await control; h.client.close(); }
});

test('SV02-09：错误view结束本轮，只有独立外部需求可以开启后继轮', async t => {
  for (const fresh of [false, true]) await t.test(String(fresh), async () => {
    const h = harness(); let release;
    try {
      await h.start();
      h.setReply(request => h.requests.length === 1
        ? new Promise(resolve => { release = () => resolve({ ...empty(request), viewId: 'wrong-view' }); })
        : empty(request));
      const pending = h.client.sync();
      if (fresh) h.handlers.batch(spatialBatch({ ...h.initial, snapshotSeq: '12' }, '13'));
      release(); await pending; await flush(); await flush();
      assert.deepEqual(h.requests.map(q => q.cursor), fresh ? ['10', '10'] : ['10']);
      assert.equal(h.client.state.snapshot.viewId, h.initial.viewId); assert.equal(h.client.state.snapshot.snapshotSeq, '10');
    } finally { release?.(); h.client.close(); }
  });
});

test('SV02-09：有补取意图时撤权响应仍立即清空视图并停止', async () => {
  const h = harness(); let release;
  try {
    await h.start();
    h.setReply(() => new Promise(resolve => { release = () => resolve({ schemaVersion: 2, code: 'FORBIDDEN', message: '本局权限已撤销。' }); }));
    const pending = h.client.sync();
    h.handlers.batch(spatialBatch({ ...h.initial, snapshotSeq: '12' }, '13'));
    release(); await pending;
    assert.equal(h.requests.length, 1); assert.equal(h.client.state.connection, 'forbidden');
    assert.equal(h.client.state.snapshot, null);
  } finally { release?.(); h.client.close(); }
});
