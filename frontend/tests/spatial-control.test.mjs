import test from 'node:test';
import assert from 'node:assert/strict';
import { SpatialSessionClient } from '../src/network/spatial-session.ts';
import { spatialSnapshot, spatialBatch } from './spatial-fixture.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function harness(options = {}) {
  const initial = spatialSnapshot(); initial.projection.self.canControl = false;
  const requests = [], syncReplies = [], controlReplies = [], controls = new Map();
  let handlers, links = 0, serverView = initial.viewId;
  function accepted(request) {
    if (controls.has(request.nonce)) return controls.get(request.nonce);
    const snapshot = spatialSnapshot(); snapshot.sessionId = request.sessionId; snapshot.viewId = 'controlled-view'; snapshot.projection.self.controlEpoch = '3';
    serverView = snapshot.viewId;
    const response = { schemaVersion: 2, sessionId: request.sessionId, nonce: request.nonce, controlEpoch: '3', observedSeq: snapshot.snapshotSeq, snapshot };
    controls.set(request.nonce, response); return response;
  }
  const client = new SpatialSessionClient({ receipt: async () => null }, (_token, next) => {
    handlers = next; links++; let connected = true; serverView = initial.viewId;
    queueMicrotask(() => { if (connected) next.connected(); });
    return { get connected() { return connected; }, close() { connected = false; }, async request(event, raw) {
      const request = typeof raw === 'string' ? JSON.parse(raw) : raw; requests.push({ event, raw, request });
      if (event === 'session.subscribe') return { ...structuredClone(initial), sessionId: request.sessionId };
      if (event.startsWith('control.')) return controlReplies.length ? controlReplies.shift()(request) : accepted(request);
      if (event === 'sync.request') {
        if (syncReplies.length) return syncReplies.shift()(request);
        return request.viewId !== serverView ? { schemaVersion: 2, code: 'RESYNC_REQUIRED', message: '旧视图已经被控制事务替换。' } : { schemaVersion: 2, type: 'world.batch', sessionId: request.sessionId, viewId: request.viewId, fromExclusive: request.cursor, throughSeq: request.cursor, events: [] };
      }
      throw new Error(`未配置的测试请求：${event}`);
    } };
  }, { heartbeatMs: 0, reconnectDelayMs: 0, ...options });
  return { client, requests, syncReplies, controlReplies, initial, accepted, get handlers() { return handlers; }, get links() { return links; }, async open() { client.open('spatial-room', 'token'); await flush(); } };
}
function delayControl(h) {
  const gate = deferred();
  h.controlReplies.push(request => { const reply = h.accepted(request); return gate.promise.then(() => reply); });
  return gate;
}

test('默认一秒心跳经过控制ACK等待窗口，一次恢复即可取得新视图与输入源', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const h = harness({ heartbeatMs: undefined }); await h.open(); const gate = delayControl(h);
  const restoring = h.client.control('resume');
  try {
    t.mock.timers.tick(1000); await flush();
    gate.resolve(); await restoring; await flush();
    assert.equal(h.client.state.inputReady, true);
    assert.equal(h.client.state.snapshot.viewId, 'controlled-view');
    assert.equal(h.links, 1, '控制换视图不能被旧视图同步触发的重连打断');
    assert.equal(h.requests.filter(r => r.event === 'control.resume').length, 1);
    assert.ok(h.requests.some(r => r.event === 'sync.request' && r.request.viewId === 'controlled-view'), '控制确认后立即按新视图继续补发');
  } finally { gate.resolve(); await restoring; h.client.close(); }
});

test('控制开始前已在途的旧sync，无论先后返回都不能覆盖成功控制', async t => {
  for (const beforeAck of [true, false]) await t.test(beforeAck ? '旧sync先返回' : '控制ACK先返回', async () => {
    const h = harness(); await h.open(); const oldSync = deferred(); h.syncReplies.push(() => oldSync.promise);
    const synchronizing = h.client.sync(); const gate = delayControl(h); const restoring = h.client.control('resume');
    const stale = { schemaVersion: 2, code: 'RESYNC_REQUIRED', message: '原视图已过期。' };
    try {
      if (beforeAck) { oldSync.resolve(stale); await synchronizing; gate.resolve(); await restoring; }
      else { gate.resolve(); await restoring; oldSync.resolve(stale); await synchronizing; }
      await flush(); assert.equal(h.client.state.inputReady, true); assert.equal(h.links, 1);
      assert.ok(h.requests.some(r => r.event === 'sync.request' && r.request.viewId === 'controlled-view'));
    } finally { gate.resolve(); oldSync.resolve(stale); await Promise.all([restoring, synchronizing]); h.client.close(); }
  });
});

test('控制结果未知时保留原nonce，旧视图补发不破坏原样重试', async () => {
  const h = harness(); await h.open();
  h.controlReplies.push(request => { h.accepted(request); throw new Error('控制已经提交但确认丢失'); });
  await h.client.control('resume'); assert.equal(h.client.state.controlBusy, false);
  assert.match(h.client.state.message, /待确认/);
  await h.client.sync(); await h.client.control('resume'); await flush();
  const sent = h.requests.filter(r => r.event === 'control.resume');
  assert.equal(sent.length, 2); assert.equal(sent[1].raw, sent[0].raw);
  assert.equal(h.client.state.inputReady, true); assert.equal(h.links, 1); h.client.close();
});

test('明确控制拒绝后继续同步，下一次操作使用新nonce且能正常恢复', async () => {
  const h = harness(); await h.open();
  h.controlReplies.push(() => ({ schemaVersion: 2, code: 'CONTROL_HELD', message: '当前由另一处控制。' }));
  const before = h.requests.filter(r => r.event === 'sync.request').length;
  await h.client.control('resume'); await flush();
  assert.equal(h.client.state.controlBusy, false);
  assert.ok(h.requests.filter(r => r.event === 'sync.request').length > before, '确定失败不停止后续状态同步');
  await h.client.control('resume');
  const sent = h.requests.filter(r => r.event === 'control.resume');
  assert.notEqual(sent[0].request.nonce, sent[1].request.nonce); assert.equal(h.client.state.inputReady, true); h.client.close();
});

test('真正结束连接、换房、撤权或收到更高epoch后，旧控制ACK不能复活', async t => {
  const cases = {
    '关闭': h => h.client.close(),
    '换房': h => h.client.open('another-room', 'token'),
    '断开': h => h.handlers.disconnected(),
    '新连接': h => h.client.reconnect(),
    '撤权': h => h.handlers.batch({ schemaVersion: 2, code: 'FORBIDDEN', message: '本局访问已撤销。' }),
    '更高epoch': h => { h.initial.projection.self.controlEpoch = '4'; h.handlers.batch(spatialBatch(h.initial, '11')); },
    '终态': h => { const projection = structuredClone(h.initial.projection); projection.phase = 'Finished'; h.handlers.batch(spatialBatch(h.initial, '11', projection)); },
  };
  for (const [name, invalidate] of Object.entries(cases)) await t.test(name, async () => {
    const h = harness(); await h.open(); const gate = delayControl(h); const restoring = h.client.control('resume');
    invalidate(h); await flush(); gate.resolve(); await restoring; await flush();
    assert.equal(h.client.state.inputReady, false, `${name}之后不能安装旧控制来源`);
    if (name === '换房') assert.equal(h.client.state.snapshot.sessionId, 'another-room');
    if (name === '更高epoch') assert.equal(h.client.state.snapshot.projection.self.controlEpoch, '4');
    h.client.close();
  });
});

test('旧sync的真正撤权错误仍立即生效，不能被控制过渡隔离吞掉', async () => {
  const h = harness(); await h.open(); const oldSync = deferred(); h.syncReplies.push(() => oldSync.promise);
  const synchronizing = h.client.sync(); const gate = delayControl(h); const restoring = h.client.control('resume');
  oldSync.resolve({ schemaVersion: 2, code: 'FORBIDDEN', message: '本局访问已撤销。' }); await synchronizing;
  gate.resolve(); await restoring;
  assert.equal(h.client.state.connection, 'forbidden'); assert.equal(h.client.state.snapshot, null); assert.equal(h.client.state.inputReady, false); h.client.close();
});
