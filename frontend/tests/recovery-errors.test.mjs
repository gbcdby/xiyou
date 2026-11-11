import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SessionClient } from '../src/network/session-client.ts';
import { prepareAction } from '../src/domain/action-draft.ts';
import { HttpApi } from '../src/network/http-api.ts';

const snapshot = JSON.parse(await readFile(new URL('../../protocol/fixtures/valid-v1.json', import.meta.url), 'utf8')).AuthorizedSnapshot;
const tick = () => new Promise(resolve => setImmediate(resolve));

function recoveryHarness(failureAt = 'subscribe', api = { receipt: async () => null }, options = {}) {
  const ports = [];
  let unavailable = true;
  const client = new SessionClient(api, (_token, handlers) => {
    const port = {
      handlers, connected: false, requests: [], closed: false,
      request(event, value) {
        this.requests.push({ event, value });
        if (event === 'session.subscribe') {
          if (unavailable) return Promise.resolve({ schemaVersion: 1, code: 'OUTCOME_UNKNOWN', message: '服务暂时不可用。' });
          return Promise.resolve({ ...structuredClone(snapshot), sessionId: value.sessionId });
        }
        if (event === 'player.action.request') return Promise.reject(new Error('确认丢失'));
        const request = JSON.parse(value);
        return Promise.resolve({ schemaVersion: 1, type: 'world.batch', sessionId: request.sessionId, viewId: request.viewId, fromExclusive: request.cursor, throughSeq: request.cursor, events: [] });
      },
      close() { this.connected = false; this.closed = true; },
    };
    ports.push(port);
    queueMicrotask(() => {
      if (port.closed) return;
      if (failureAt === 'handshake' && unavailable) handlers.failed({ schemaVersion: 1, code: 'OUTCOME_UNKNOWN' });
      else { port.connected = true; handlers.connected(); }
    });
    return port;
  }, { heartbeatMs: 1500, reconnectDelayMs: 1000, ...options });
  return { client, ports, recover: () => { unavailable = false; } };
}

for (const failureAt of ['subscribe', 'handshake']) {
  test(`R-vs001-p05-REQ-001：${failureAt} 的一次暂态错误在有界延迟后自动恢复，保留原动作且不自动接管`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const h = recoveryHarness(failureAt); t.after(() => h.client.close());
    const draft = prepareAction(snapshot, { kind: 'wait' }, 'original-pending-action');
    h.client.open(snapshot.sessionId, '原身份', [draft]); await tick();
    assert.equal(h.client.state.snapshot, null);
    h.recover();
    t.mock.timers.tick(999); await tick(); assert.equal(h.ports.length, 1);
    t.mock.timers.tick(1); await tick();
    assert.equal(h.client.state.connection, 'online');
    assert.equal(h.client.state.snapshot.sessionId, snapshot.sessionId);
    assert.equal(h.ports.length, 2);
    assert.equal(h.ports[0].closed, true);
    assert.equal(h.client.state.actions[0].raw, draft.raw);
    assert.equal(h.client.state.actions[0].status, 'unknown');
    assert.ok(h.ports.flatMap(port => port.requests).every(request => ['session.subscribe', 'sync.request'].includes(request.event)));
  });
}

test('R-vs001-p05-REQ-001：持续暂态失败每个延迟窗口最多建立一次新连接', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const h = recoveryHarness(); t.after(() => h.client.close());
  h.client.open(snapshot.sessionId, '原身份'); await tick();
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    h.ports[0].handlers.failed({ schemaVersion: 1, code: 'OUTCOME_UNKNOWN' });
    t.mock.timers.tick(999); await tick(); assert.equal(h.ports.length, attempt);
    t.mock.timers.tick(1); await tick(); assert.equal(h.ports.length, attempt + 1);
  }
  assert.equal(h.client.state.connection, 'offline');
});

test('R-vs001-p05-REQ-001：关闭和换房会作废旧恢复定时器与旧连接回调', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const h = recoveryHarness(); t.after(() => h.client.close());
  h.client.open(snapshot.sessionId, '原身份'); await tick();
  h.client.close();
  t.mock.timers.tick(15000); await tick();
  assert.equal(h.ports.length, 1); assert.equal(h.client.state.connection, 'idle');
  h.client.open(snapshot.sessionId, '原身份'); await tick();
  const old = h.ports[1]; h.recover();
  h.client.open('new-session', '新身份'); await tick();
  old.handlers.connected(); old.handlers.failed({ schemaVersion: 1, code: 'OUTCOME_UNKNOWN' });
  t.mock.timers.tick(15000); await tick();
  assert.equal(h.ports.length, 3);
  assert.equal(h.client.state.snapshot.sessionId, 'new-session');
});

test('R-vs001-p05-REQ-001：恢复任务发布连接中状态时被关闭，不能随后创建旧连接', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let stopOnConnecting = false;
  const h = recoveryHarness('subscribe', undefined, { onChange: state => {
    if (stopOnConnecting && state.connection === 'connecting') h.client.close();
  } });
  t.after(() => h.client.close());
  h.client.open(snapshot.sessionId, '原身份'); await tick();
  h.recover(); stopOnConnecting = true;
  t.mock.timers.tick(1000); await tick();
  assert.equal(h.ports.length, 1);
  assert.equal(h.client.state.connection, 'idle');
  assert.equal(h.client.state.snapshot, null);
});

for (const code of ['UNAUTHENTICATED', 'FORBIDDEN', 'SESSION_GONE']) {
  test(`R-vs001-p05-REQ-001：恢复后收到 ${code}，旧定时器不能再次连接`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const h = recoveryHarness(); t.after(() => h.client.close());
    h.client.open(snapshot.sessionId, '原身份'); await tick();
    h.recover(); h.client.reconnect(); await tick();
    h.ports[1].handlers.failed({ schemaVersion: 1, code });
    t.mock.timers.tick(15000); await tick();
    assert.equal(h.ports.length, 2);
    assert.equal(h.client.state.snapshot, null);
    assert.equal(h.client.state.connection, 'forbidden');
    assert.equal(h.ports[1].closed, true);
  });
}

test('R-vs001-p05-REQ-002：查询明确 SESSION_GONE 后立即清空授权并停订阅，原动作仍保持未知', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const api = new HttpApi(() => '原身份', async () => new Response(JSON.stringify({ schemaVersion: 1, code: 'SESSION_GONE' }), { status: 404 }));
  const h = recoveryHarness('subscribe', api); t.after(() => h.client.close());
  h.recover(); h.client.open(snapshot.sessionId, '原身份'); await tick();
  await h.client.send({ kind: 'wait' });
  const action = h.client.state.actions[0];
  assert.equal(h.client.state.connection, 'online');
  await h.client.query(action.id);
  assert.equal(h.client.state.snapshot, null);
  assert.equal(h.client.state.connection, 'forbidden');
  assert.equal(h.ports[0].closed, true);
  assert.equal(h.client.state.actions[0].raw, action.raw);
  assert.equal(h.client.state.actions[0].status, 'unknown');
  assert.equal(h.client.state.actions[0].receipt, null);
  t.mock.timers.tick(15000); await tick(); assert.equal(h.ports.length, 1);
});
