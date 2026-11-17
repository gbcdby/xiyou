import test from 'node:test';
import assert from 'node:assert/strict';
import { SpatialSessionClient } from '../src/network/spatial-session.ts';
import { spatialSnapshot, spatialBatch } from './spatial-fixture.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const initial = spatialSnapshot(), unauthenticated = [], replies = [];
  let handlers, closed = false;
  const link = {
    get connected() { return !closed; },
    acceptedCapabilities: ['spatial-direction-v1', 'spatial-timed-trail-v1'],
    close() { closed = true; },
    async request(event, raw, consume) {
      let value;
      if (event === 'session.subscribe') value = structuredClone(initial);
      else if (replies.length) value = replies.shift();
      else {
        const request = JSON.parse(raw);
        value = { schemaVersion: 2, type: 'world.batch', sessionId: request.sessionId, viewId: request.viewId,
          fromExclusive: request.cursor, throughSeq: request.cursor, events: [] };
      }
      consume?.(value);
      return value;
    },
  };
  const client = new SpatialSessionClient({ receipt: async () => null }, (_token, callbacks) => {
    handlers = callbacks; return link;
  }, { heartbeatMs: 0, reconnectDelayMs: 0, onUnauthenticated: token => unauthenticated.push(token) });
  return { client, initial, replies, unauthenticated, get handlers() { return handlers; }, get closed() { return closed; },
    async open() { client.open(initial.sessionId, '原登录令牌'); handlers.connected(); await flush(); } };
}

test('错误分流：v1省略message与v2升级错误仍关闭授权视图，并只对登录失效通知原令牌', async t => {
  const cases = [
    ['v1登录失效', { schemaVersion: 1, code: 'UNAUTHENTICATED' }],
    ['v1访问撤销', { schemaVersion: 1, code: 'FORBIDDEN' }],
    ['v1房间消失', { schemaVersion: 1, code: 'SESSION_GONE' }],
    ['v2能力升级', { schemaVersion: 2, code: 'UPGRADE_REQUIRED', message: '请升级', requiredCapabilities: ['spatial-direction-v1'] }],
    ['空原型的v2错误', Object.assign(Object.create(null), { schemaVersion: 2, code: 'UNAUTHENTICATED', message: '请登录' })],
  ];
  for (const [name, value] of cases) await t.test(name, async t => {
    const h = harness(); t.after(() => h.client.close()); await h.open();
    assert.equal(h.client.state.connection, 'online');
    h.replies.push(value); await h.client.sync();
    assert.equal(h.client.state.connection, 'forbidden');
    assert.equal(h.client.state.snapshot, null); assert.equal(h.client.state.inputReady, false);
    assert.equal(h.closed, true);
    assert.deepEqual(h.unauthenticated, value.code === 'UNAUTHENTICATED' ? ['原登录令牌'] : []);
  });
});

test('错误分流：含code的畸形消息仍完整校验，不能撤权或推进游标，后续合法批次仍能应用', async t => {
  const cases = [
    ['错误版本', { schemaVersion: 3, code: 'FORBIDDEN', message: '访问已撤销' }],
    ['v2缺少message', { schemaVersion: 2, code: 'FORBIDDEN' }],
    ['message类型错误', { schemaVersion: 2, code: 'FORBIDDEN', message: 42 }],
    ['多余字段', { schemaVersion: 2, code: 'FORBIDDEN', message: '访问已撤销', extra: true }],
    ['未知能力', { schemaVersion: 2, code: 'UPGRADE_REQUIRED', message: '请升级', requiredCapabilities: ['unknown'] }],
    ['v1未知错误码', { schemaVersion: 1, code: 'FUTURE_ERROR' }],
    ['继承code', Object.assign(Object.create({ code: 'FORBIDDEN' }), { schemaVersion: 2, message: '访问已撤销' })],
  ];
  for (const [name, value] of cases) await t.test(name, async t => {
    const h = harness(); t.after(() => h.client.close()); await h.open();
    h.replies.push(value); await h.client.sync();
    assert.equal(h.client.state.connection, 'online'); assert.equal(h.closed, false);
    assert.equal(h.client.state.snapshot.snapshotSeq, '10'); assert.deepEqual(h.unauthenticated, []);
    h.replies.push(spatialBatch(h.initial, '11')); await h.client.sync();
    assert.equal(h.client.state.snapshot.snapshotSeq, '11');
  });
});

test('错误分流：v2开放错误码继续显示公开回退信息，不被误当成无效批次', async t => {
  const h = harness(); t.after(() => h.client.close()); await h.open();
  h.replies.push({ schemaVersion: 2, code: 'FUTURE_ERROR', message: '内部详情不显示' }); await h.client.sync();
  assert.equal(h.client.state.connection, 'online'); assert.equal(h.client.state.snapshot.snapshotSeq, '10');
  assert.equal(h.client.state.message, '请求未完成，请同步当前场景后重试。');
  assert.deepEqual(h.unauthenticated, []);
});

test('错误分流：非对象及无法读取的对象保持断线处理，属性异常不泄漏或误报撤权', async t => {
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  let getterReads = 0;
  const cases = [
    ['空值', null], ['字符串', 'FORBIDDEN'],
    ['code访问器', { schemaVersion: 2, get code() { getterReads++; return 'FORBIDDEN'; }, message: '访问已撤销' }],
    ['code读取抛错', { schemaVersion: 2, get code() { getterReads++; throw new Error('受控属性异常'); }, message: '访问已撤销' }],
    ['属性描述探测抛错', new Proxy({ schemaVersion: 2, code: 'FORBIDDEN', message: '访问已撤销' }, {
      getOwnPropertyDescriptor() { throw new Error('受控描述异常'); },
    })],
    ['已撤销Proxy', revoked.proxy],
  ];
  for (const [name, value] of cases) await t.test(name, async t => {
    const h = harness(); t.after(() => h.client.close()); await h.open();
    assert.doesNotThrow(() => h.handlers.failed(value));
    assert.equal(h.client.state.connection, 'offline'); assert.equal(h.client.state.snapshot, null);
    assert.equal(h.closed, true); assert.deepEqual(h.unauthenticated, []);
    assert.equal(getterReads, 0, '严格JSON拒绝访问器，不读取其值');
  });
});
