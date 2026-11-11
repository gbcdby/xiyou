import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { actionSemanticDigest, parseClientAction } from '../../protocol/index.mjs';
import { SessionClient } from '../src/network/session-client.ts';
import { ApiFailure } from '../src/network/http-api.ts';

const fixtures = JSON.parse(await readFile(new URL('../../protocol/fixtures/valid-v1.json', import.meta.url), 'utf8'));
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function harness(options = {}) {
  const ports = []; const actions = []; const queries = [];
  let snapshot = structuredClone(fixtures.AuthorizedSnapshot);
  snapshot.projection.phase = 'Running'; snapshot.projection.self.mode = 'HumanControlled'; snapshot.projection.self.canControl = true;
  let queryResult = null;
  let counter = 0;
  const client = new SessionClient({ receipt: async (...args) => { queries.push(args); return queryResult; } }, (_token, handlers) => {
    const port = { handlers, connected: false, requests: [], closed: false,
      request(event, value) {
        this.requests.push({ event, value });
        if (event === 'session.subscribe') return Promise.resolve(structuredClone(snapshot));
        if (event === 'sync.request') { const request = JSON.parse(value); return Promise.resolve({ schemaVersion: 1, type: 'world.batch', sessionId: request.sessionId, viewId: request.viewId, fromExclusive: request.cursor, throughSeq: request.cursor, events: [] }); }
        const response = deferred(); actions.push({ event, value, response }); return response.promise;
      },
      close() { this.closed = true; this.connected = false; },
      connect() { this.connected = true; handlers.connected(); },
    }; ports.push(port); return port;
  }, { id: () => `nonce-${++counter}`, heartbeatMs: 0, reconnectDelayMs: 0, ...options });
  return { client, ports, actions, queries, get snapshot() { return snapshot; }, set snapshot(value) { snapshot = value; }, set queryResult(value) { queryResult = value; } };
}
async function ready(h) { h.client.open(h.snapshot.sessionId, 'token-one'); h.ports[0].connect(); await tick(); }
async function receiptFor(raw) {
  const action = parseClientAction(raw);
  return { ...structuredClone(fixtures.ClientReceipt), sessionId: action.sessionId, actorId: action.actorId, clientActionId: action.clientActionId, semanticDigest: await actionSemanticDigest(action) };
}
function controlResponseFor(raw, observedSeq) {
  const request = JSON.parse(raw);
  return { ...structuredClone(fixtures.ControlResponse), sessionId: request.sessionId, actorId: request.actorId, nonce: request.nonce, observedSeq };
}
function pushThrough(h, throughSeq, projection = null) {
  const snapshot = h.client.state.snapshot;
  h.ports.at(-1).handlers.batch({ schemaVersion: 1, type: 'world.batch', sessionId: snapshot.sessionId, viewId: snapshot.viewId, fromExclusive: snapshot.snapshotSeq, throughSeq,
    events: projection ? [{ sessionSeq: throughSeq, eventId: `${snapshot.sessionId}:E${throughSeq}`, kind: 'projection.replace', payload: { projection } }] : [] });
}

test('丢失确认与查询不到结果后仍保留原文，重连后的重试不更换旧 epoch、游标或动作 ID', async t => {
  const h = harness(); t.after(() => h.client.close()); await ready(h);
  const sending = h.client.send({ kind: 'wait' });
  const original = h.actions[0].value;
  h.actions[0].response.reject(new Error('ack lost')); await sending;
  assert.equal(h.client.state.actions[0].status, 'unknown');
  await h.client.query(h.client.state.actions[0].id);
  assert.equal(h.client.state.actions[0].status, 'unknown');
  h.snapshot.snapshotSeq = '9007199254740999'; h.snapshot.projection.self.controlEpoch = '99';
  h.client.reconnect(); h.ports[1].connect(); await tick();
  const retrying = h.client.retry(h.client.state.actions[0].id);
  assert.equal(h.actions[1].value, original);
  h.actions[1].response.resolve(await receiptFor(original)); await retrying;
  assert.equal(h.client.state.actions[0].status, 'accepted');
});

test('动作收据不能直接改变世界或游标，身份不匹配的收据不能被当作成功', async t => {
  const h = harness(); t.after(() => h.client.close()); await ready(h);
  const before = JSON.stringify(h.client.state.snapshot);
  const sending = h.client.send({ kind: 'wait' });
  const wrong = await receiptFor(h.actions[0].value); wrong.clientActionId = 'different-id';
  h.actions[0].response.resolve(wrong); await sending;
  assert.equal(h.client.state.actions[0].status, 'unknown');
  assert.equal(JSON.stringify(h.client.state.snapshot), before);
  const retrying = h.client.retry(h.client.state.actions[0].id);
  h.actions[1].response.resolve(await receiptFor(h.actions[1].value)); await retrying;
  assert.equal(h.client.state.actions[0].status, 'accepted');
  assert.equal(JSON.stringify(h.client.state.snapshot), before);
});

test('迟到的空查询不能把已经取得的提交收据降回未知', async t => {
  const h = harness(); t.after(() => h.client.close()); await ready(h);
  const sending = h.client.send({ kind: 'wait' });
  h.actions[0].response.reject(new Error('lost')); await sending;
  const pendingQuery = deferred(); h.queryResult = pendingQuery.promise;
  const querying = h.client.query(h.client.state.actions[0].id);
  const retrying = h.client.retry(h.client.state.actions[0].id);
  h.actions[1].response.resolve(await receiptFor(h.actions[1].value)); await retrying;
  assert.equal(h.client.state.actions[0].status, 'accepted');
  pendingQuery.resolve(null); await querying;
  assert.equal(h.client.state.actions[0].status, 'accepted');
});

test('换房之后旧连接快照、批次和动作确认均不能填回新视图', async t => {
  const h = harness(); t.after(() => h.client.close()); await ready(h);
  const oldPort = h.ports[0];
  const sending = h.client.send({ kind: 'wait' });
  const oldSnapshot = structuredClone(h.snapshot);
  h.snapshot.sessionId = 'session-new'; h.snapshot.viewId = 'new-view';
  h.client.open('session-new', 'new-token'); h.ports[1].connect(); await tick();
  oldPort.handlers.batch({ schemaVersion: 1, type: 'world.batch', sessionId: oldSnapshot.sessionId, viewId: oldSnapshot.viewId, fromExclusive: oldSnapshot.snapshotSeq, throughSeq: (BigInt(oldSnapshot.snapshotSeq) + 1n).toString(), events: [] });
  h.actions[0].response.resolve(await receiptFor(h.actions[0].value)); await sending;
  assert.equal(h.client.state.snapshot.sessionId, 'session-new');
  assert.equal(h.client.state.actions.length, 0);
  assert.equal(oldPort.closed, true);
});

test('收据查询确认权限失效时清空授权投影并停止旧订阅', async t => {
  const h = harness(); t.after(() => h.client.close()); await ready(h);
  const sending = h.client.send({ kind: 'wait' }); h.actions[0].response.reject(new Error('lost')); await sending;
  h.queryResult = Promise.reject(new ApiFailure('成员权限已撤销。', 403, 'FORBIDDEN'));
  await h.client.query(h.client.state.actions[0].id);
  assert.equal(h.client.state.snapshot, null);
  assert.equal(h.client.state.connection, 'forbidden');
  assert.equal(h.ports[0].closed, true);
});

test('恢复控制遇到占用不会自动接管；已明确拒绝后的新尝试使用新 nonce', async t => {
  const h = harness(); t.after(() => h.client.close()); await ready(h);
  const restoring = h.client.control('resume');
  const first = JSON.parse(h.actions[0].value);
  h.actions[0].response.resolve({ schemaVersion: 1, code: 'CONTROL_HELD' }); await restoring;
  assert.equal(h.actions.length, 1);
  assert.equal(h.actions[0].event, 'control.resume');
  const again = h.client.control('resume');
  const second = JSON.parse(h.actions[1].value);
  assert.notEqual(second.nonce, first.nonce);
  h.actions[1].response.resolve({ schemaVersion: 1, code: 'CONTROL_HELD' }); await again;
});

test('控制请求超时只在同一物理连接原样重试，新物理连接必须换 nonce', async t => {
  const h = harness(); t.after(() => h.client.close()); await ready(h);
  const restoring = h.client.control('resume');
  const first = h.actions[0].value;
  h.actions[0].response.reject(new Error('timeout')); await restoring;
  const retrying = h.client.control('resume'); assert.equal(h.actions[1].value, first);
  h.actions[1].response.reject(new Error('timeout')); await retrying;
  h.client.reconnect(); h.ports[1].connect(); await tick();
  const fresh = h.client.control('resume'); assert.notEqual(JSON.parse(h.actions[2].value).nonce, JSON.parse(first).nonce);
  h.actions[2].response.resolve({ schemaVersion: 1, code: 'CONTROL_HELD' }); await fresh;
});

test('最后一个流批次丢失且没有后续消息时，周期补发仍会恢复到当前游标', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const h = harness({ heartbeatMs: 1500 }); t.after(() => h.client.close()); await ready(h);
  const head = (BigInt(h.snapshot.snapshotSeq) + 2n).toString();
  const original = h.ports[0].request.bind(h.ports[0]);
  h.ports[0].request = (event, raw) => {
    if (event !== 'sync.request') return original(event, raw);
    const request = JSON.parse(raw);
    return Promise.resolve({ schemaVersion: 1, type: 'world.batch', sessionId: request.sessionId, viewId: request.viewId, fromExclusive: request.cursor, throughSeq: head, events: [] });
  };
  t.mock.timers.tick(1500); await tick();
  assert.equal(h.client.state.snapshot.snapshotSeq, head);
});

test('RESYNC_REQUIRED 立即清空旧视图，新连接订阅只发送 Session 而不自行选择 viewId', async t => {
  const h = harness(); t.after(() => h.client.close()); await ready(h);
  const old = h.ports[0]; const original = old.request.bind(old);
  old.request = (event, raw) => event === 'sync.request' ? Promise.resolve({ schemaVersion: 1, code: 'RESYNC_REQUIRED' }) : original(event, raw);
  await h.client.sync();
  assert.equal(h.client.state.snapshot, null); assert.equal(old.closed, true);
  h.ports[1].connect(); await tick();
  assert.deepEqual(h.ports[1].requests[0], { event: 'session.subscribe', value: { sessionId: h.snapshot.sessionId } });
  assert.equal(h.client.state.connection, 'online');
});

test('连接握手明确拒绝身份时停止重连，不继续展示旧授权', async t => {
  const h = harness(); t.after(() => h.client.close()); await ready(h);
  h.ports[0].handlers.failed({ schemaVersion: 1, code: 'UNAUTHENTICATED', message: '登录已失效。' });
  assert.equal(h.client.state.snapshot, null);
  assert.equal(h.client.state.connection, 'forbidden');
});

test('控制 ACK 先到时只在授权投影达到 observedSeq 后清理同步提示，不从 ACK 修改权限', async t => {
  const h = harness(); t.after(() => h.client.close());
  h.snapshot.projection.self.mode = 'GracePeriod'; h.snapshot.projection.self.canControl = false;
  await ready(h);
  const before = structuredClone(h.client.state.snapshot);
  const observedSeq = (BigInt(before.snapshotSeq) + 2n).toString();
  const restoring = h.client.control('resume');
  h.actions[0].response.resolve(controlResponseFor(h.actions[0].value, observedSeq)); await restoring;
  assert.match(h.client.state.message, /正在同步当前授权/);
  assert.deepEqual(h.client.state.snapshot, before);
  pushThrough(h, (BigInt(before.snapshotSeq) + 1n).toString());
  assert.match(h.client.state.message, /正在同步当前授权/);
  const projection = structuredClone(before.projection);
  projection.self.mode = 'HumanControlled'; projection.self.canControl = true;
  pushThrough(h, observedSeq, projection);
  assert.equal(h.client.state.message, '');
  assert.equal(h.client.state.snapshot.projection.self.canControl, true);
});

test('授权推送先于控制 ACK 时不留下已经完成的同步提示', async t => {
  const h = harness(); t.after(() => h.client.close()); await ready(h);
  const observedSeq = (BigInt(h.snapshot.snapshotSeq) + 1n).toString();
  const restoring = h.client.control('resume');
  pushThrough(h, observedSeq);
  h.actions[0].response.resolve(controlResponseFor(h.actions[0].value, observedSeq)); await restoring;
  assert.equal(h.client.state.message, '');
});

test('暂态同步失败后只有合法补发成功才清理提示，同游标空批也代表恢复', async t => {
  const h = harness(); t.after(() => h.client.close()); await ready(h);
  const port = h.ports[0]; const original = port.request.bind(port);
  port.request = (event, raw) => event === 'sync.request' ? Promise.reject(new Error('暂时断流')) : original(event, raw);
  await h.client.sync();
  assert.match(h.client.state.message, /状态同步尚未完成/);
  const message = h.client.state.message;
  port.request = (event, raw) => event === 'sync.request' ? Promise.resolve({ schemaVersion: 1, type: 'world.batch', sessionId: h.snapshot.sessionId, viewId: '其他授权视图', fromExclusive: h.snapshot.snapshotSeq, throughSeq: h.snapshot.snapshotSeq, events: [] }) : original(event, raw);
  await h.client.sync();
  assert.equal(h.client.state.message, message);
  port.request = original;
  await h.client.sync();
  assert.equal(h.client.state.message, '');
});

test('控制水位随后到达不会清除后来出现的操作错误', async t => {
  const h = harness(); t.after(() => h.client.close()); await ready(h);
  const observedSeq = (BigInt(h.snapshot.snapshotSeq) + 1n).toString();
  const restoring = h.client.control('resume');
  h.actions[0].response.resolve(controlResponseFor(h.actions[0].value, observedSeq)); await restoring;
  const sending = h.client.send({ kind: 'wait' });
  const message = '新的操作结果仍待确认。';
  h.actions[1].response.resolve({ schemaVersion: 1, code: 'OUTCOME_UNKNOWN', message }); await sending;
  pushThrough(h, observedSeq);
  await h.client.sync();
  assert.equal(h.client.state.message, message);
});

for (const outcome of ['ACK', '超时']) test(`在途控制请求的迟到${outcome}不能覆盖较新的操作错误`, async t => {
  const h = harness(); t.after(() => h.client.close()); await ready(h);
  const observedSeq = (BigInt(h.snapshot.snapshotSeq) + 1n).toString();
  const restoring = h.client.control('resume');
  const sending = h.client.send({ kind: 'wait' });
  const message = '较新的操作错误需要保留。';
  h.actions[1].response.resolve({ schemaVersion: 1, code: 'OUTCOME_UNKNOWN', message }); await sending;
  if (outcome === 'ACK') h.actions[0].response.resolve(controlResponseFor(h.actions[0].value, observedSeq));
  else h.actions[0].response.reject(new Error('较早请求迟到超时'));
  await restoring;
  assert.equal(h.client.state.message, message);
  assert.equal(h.client.state.controlBusy, false);
  pushThrough(h, observedSeq);
  await h.client.sync();
  assert.equal(h.client.state.message, message);
});

test('较早同步请求的迟到超时不能覆盖较新的操作错误', async t => {
  const h = harness(); t.after(() => h.client.close()); await ready(h);
  const port = h.ports[0]; const original = port.request.bind(port); const pending = deferred();
  port.request = (event, raw) => event === 'sync.request' ? pending.promise : original(event, raw);
  const syncing = h.client.sync();
  const sending = h.client.send({ kind: 'wait' });
  const message = '同步期间出现的新错误。';
  h.actions[0].response.resolve({ schemaVersion: 1, code: 'OUTCOME_UNKNOWN', message }); await sending;
  pending.reject(new Error('较早同步迟到超时')); await syncing;
  assert.equal(h.client.state.message, message);
  port.request = original; await h.client.sync();
  assert.equal(h.client.state.message, message);
});
