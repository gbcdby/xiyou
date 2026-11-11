import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ActionJournal } from '../src/domain/action-journal.ts';

const identityKey = 'xiyou.guest.v1';
const expiredIdentity = { token: '已失效的测试令牌', userId: 'old-user', name: '原旅伴' };
const snapshot = JSON.parse(await readFile(new URL('../../protocol/fixtures/valid-v1.json', import.meta.url), 'utf8')).AuthorizedSnapshot;
const tick = () => new Promise(resolve => setImmediate(resolve));
function memoryStorage() {
  const entries = new Map([[identityKey, JSON.stringify(expiredIdentity)]]);
  return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) };
}

test('R-vs001-p05-STD-001：实际状态桥接收到明确 UNAUTHENTICATED 后清除身份，使登录分支可达且不复用失效 token', async t => {
  const storage = memoryStorage(); const requests = [];
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor); else delete globalThis.sessionStorage; });
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    requests.push(init);
    return requests.length === 1 ? new Response(JSON.stringify({ schemaVersion: 1, code: 'UNAUTHENTICATED' }), { status: 401 }) : new Response('[]');
  });
  const store = await import('../src/state/app-store.ts?http-auth-recovery');
  t.after(() => store.sessionClient.close());
  await assert.rejects(store.api.rooms(), error => error.code === 'UNAUTHENTICATED');
  assert.equal(store.identity.value, null);
  assert.equal(storage.getItem(identityKey), null);
  assert.equal(!store.identity.value, true);
  await store.api.rooms();
  assert.equal(requests[0].headers.Authorization, `Bearer ${expiredIdentity.token}`);
  assert.equal(requests[1].headers.Authorization, undefined);
});

function socketFactory(ports) {
  return (token, handlers) => {
    const port = { token, handlers, connected: false, closed: false,
      request(event, raw) {
        if (event === 'session.subscribe') return Promise.resolve(structuredClone(snapshot));
        if (event === 'player.action.request') return Promise.reject(new Error('确认丢失'));
        const request = JSON.parse(raw);
        return Promise.resolve({ schemaVersion: 1, type: 'world.batch', sessionId: request.sessionId, viewId: request.viewId, fromExclusive: request.cursor, throughSeq: request.cursor, events: [] });
      },
      close() { this.connected = false; this.closed = true; },
    };
    ports.push(port); queueMicrotask(() => { if (!port.closed) { port.connected = true; handlers.connected(); } });
    return port;
  };
}

test('R-vs001-p05-STD-001：Socket 身份失效清理当前会话，保留旧身份原动作，新访客不自动取回原房间', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { createAppStore } = await import('../src/state/app-store.ts');
  const storage = memoryStorage(); const ports = []; const requests = [];
  const nextIdentity = { token: '新访客令牌', userId: 'new-user', name: '新旅伴' };
  const store = createAppStore({ storage, connectLink: socketFactory(ports), fetcher: async (url, init) => {
    requests.push({ url, init }); return new Response(JSON.stringify(nextIdentity));
  } });
  t.after(() => store.sessionClient.close());
  store.enterSession(snapshot.sessionId); await tick();
  await store.sendAction({ kind: 'wait' });
  const original = store.sessionState.value.actions[0];
  ports[0].handlers.failed({ schemaVersion: 1, code: 'UNAUTHENTICATED' });
  assert.equal(store.identity.value, null);
  assert.equal(storage.getItem(identityKey), null);
  assert.equal(store.sessionState.value.snapshot, null);
  assert.equal(ports[0].closed, true);
  assert.match(store.authNotice.value, /新访客不能取回原身份/);
  const journal = new ActionJournal(storage);
  assert.equal(journal.load('old-user', snapshot.sessionId)[0].raw, original.raw);
  await store.signIn('新旅伴');
  assert.deepEqual(store.identity.value, nextIdentity);
  assert.equal(requests[0].init.headers.Authorization, undefined);
  assert.equal(journal.load('new-user', snapshot.sessionId).length, 0);
  assert.equal(journal.load('old-user', snapshot.sessionId)[0].raw, original.raw);
  ports[0].handlers.failed({ schemaVersion: 1, code: 'UNAUTHENTICATED' });
  t.mock.timers.tick(15000); await tick();
  assert.equal(ports.length, 1); assert.equal(store.sessionState.value.snapshot, null);
  assert.deepEqual(store.identity.value, nextIdentity);
});

for (const [code, status] of [['FORBIDDEN', 403], ['SESSION_GONE', 404]]) {
  test(`R-vs001-p05-STD-001：房间查询 ${code} 停止旧授权视图，但保留仍有效的登录身份`, async t => {
    const { createAppStore } = await import('../src/state/app-store.ts');
    const storage = memoryStorage(); const ports = [];
    const store = createAppStore({ storage, connectLink: socketFactory(ports), fetcher: async () => new Response(JSON.stringify({ schemaVersion: 1, code }), { status }) });
    t.after(() => store.sessionClient.close());
    store.enterSession(snapshot.sessionId); await tick(); await store.sendAction({ kind: 'wait' });
    await store.sessionClient.query(store.sessionState.value.actions[0].id);
    assert.equal(store.sessionState.value.snapshot, null);
    assert.equal(store.sessionState.value.connection, 'forbidden');
    assert.equal(ports[0].closed, true);
    assert.deepEqual(store.identity.value, expiredIdentity);
    assert.deepEqual(JSON.parse(storage.getItem(identityKey)), expiredIdentity);
    assert.equal(store.authNotice.value, '');
  });
}

test('R-vs001-p05-STD-001：普通网络失败不清除登录身份', async t => {
  const { createAppStore } = await import('../src/state/app-store.ts');
  const storage = memoryStorage();
  const store = createAppStore({ storage, fetcher: async () => { throw new Error('网络暂不可达'); } });
  t.after(() => store.sessionClient.close());
  await assert.rejects(store.api.rooms(), error => error.code === 'NETWORK_UNAVAILABLE');
  assert.deepEqual(store.identity.value, expiredIdentity);
  assert.deepEqual(JSON.parse(storage.getItem(identityKey)), expiredIdentity);
});

test('R-vs001-p05-STD-001：迟到的旧 HTTP 认证错误不能清除已经登录的新访客', async t => {
  const { createAppStore } = await import('../src/state/app-store.ts');
  const storage = memoryStorage(); const nextIdentity = { token: '新令牌', userId: 'new-user', name: '新旅伴' };
  let resolveOld; const oldResponse = new Promise(resolve => { resolveOld = resolve; }); let calls = 0;
  const store = createAppStore({ storage, fetcher: async url => {
    if (url === '/api/auth/guest') return new Response(JSON.stringify(nextIdentity));
    calls += 1;
    return calls === 1 ? oldResponse : new Response(JSON.stringify({ schemaVersion: 1, code: 'UNAUTHENTICATED' }), { status: 401 });
  } });
  t.after(() => store.sessionClient.close());
  const oldRequest = store.api.rooms().catch(error => error);
  await assert.rejects(store.api.rooms(), error => error.code === 'UNAUTHENTICATED');
  assert.equal(store.identity.value, null);
  const reloaded = createAppStore({ storage }); t.after(() => reloaded.sessionClient.close());
  assert.equal(reloaded.identity.value, null);
  await store.signIn('新旅伴');
  resolveOld(new Response(JSON.stringify({ schemaVersion: 1, code: 'UNAUTHENTICATED' }), { status: 401 }));
  assert.equal((await oldRequest).code, 'UNAUTHENTICATED');
  assert.deepEqual(store.identity.value, nextIdentity);
  assert.deepEqual(JSON.parse(storage.getItem(identityKey)), nextIdentity);
});
