import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpApi, ApiFailure } from '../src/network/http-api.ts';

const entry = (seq = '9') => ({ entryId: 'R-' + seq, eventSeq: seq, serverTime: '2026-11-11T12:00:00.000Z', category: 'Claim', kind: 'received_claim', actorId: 'B', text: '通路已修好', fields: [], references: [] });
const page = (entries = [entry()], nextBeforeSeq = null) => ({ schemaVersion: 1, type: 'session.recap', sessionId: 'S', actorId: 'B', throughSeq: '10', phase: 'Finished', entries, nextBeforeSeq });
const binding = () => ({ sessionId: 'S', actorId: 'B', throughSeq: '10', phase: 'Finished', viewId: 'view-1', identity: 'account-one' });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('复盘 HTTP 使用独立只读端点、固定水位和可取消信号', async () => {
  const requests = [];
  const api = new HttpApi(() => 'synthetic-token', async (path, init) => { requests.push({ path, init }); return new Response(JSON.stringify(page())); });
  const controller = new AbortController();
  assert.deepEqual(await api.recap('S', '10', '9', controller.signal), page());
  assert.equal(requests[0].path, '/api/sessions/S/recap?throughSeq=10&beforeSeq=9');
  assert.equal(requests[0].init.method, 'GET');
  controller.abort(); assert.equal(requests[0].init.signal.aborted, true);
});

test('换账号、房间、视图与撤权会清空并取消，迟到旧响应不能填回', async () => {
  const { RecapClient } = await import('../src/network/recap-client.ts');
  for (const change of [{ identity: 'account-two' }, { sessionId: 'S2' }, { viewId: 'view-2' }, null]) {
    const requests = [];
    const client = new RecapClient({ recap(...args) { const d = deferred(); requests.push({ args, ...d }); return d.promise; } });
    const first = client.open(binding());
    const next = client.open(change ? { ...binding(), ...change } : null);
    assert.equal(requests[0].args[3].aborted, true); assert.deepEqual(client.state.entries, []);
    requests[0].resolve(page()); await first;
    assert.deepEqual(client.state.entries, []);
    if (change) { requests[1].resolve({ ...page(), sessionId: change.sessionId || 'S' }); await next; assert.equal(client.state.entries.length, 1); }
    client.close(); assert.deepEqual(client.state.entries, []);
  }
});

test('分页失败保留已读页并标记不完整，重试仍使用同水位和原游标', async () => {
  const { RecapClient } = await import('../src/network/recap-client.ts');
  const calls = []; let attempt = 0;
  const client = new RecapClient({ async recap(...args) {
    calls.push(args);
    if (++attempt === 1) return page([entry('9')], '9');
    if (attempt === 2) throw new ApiFailure('临时断线');
    return page([entry('7')], null);
  } });
  await client.open(binding()); await client.loadMore();
  assert.equal(client.state.status, 'error'); assert.equal(client.state.complete, false); assert.equal(client.state.entries.length, 1);
  await client.loadMore(); assert.equal(client.state.complete, true); assert.deepEqual(client.state.entries.map(e => e.eventSeq), ['9', '7']);
  assert.deepEqual(calls.map(args => args.slice(0, 3)), [['S', '10', undefined], ['S', '10', '9'], ['S', '10', '9']]);
});

test('已读页遇到当前撤权立即清空；旧服务缺端点仅影响过程区', async () => {
  const { RecapClient } = await import('../src/network/recap-client.ts');
  for (const code of ['FORBIDDEN', 'UNAUTHENTICATED', 'SESSION_GONE']) {
    let called = 0;
    const client = new RecapClient({ async recap() { if (++called === 1) return page([entry('9')], '9'); throw new ApiFailure('访问终止', 403, code); } });
    await client.open(binding()); await client.loadMore();
    assert.deepEqual(client.state.entries, []); assert.equal(client.state.status, 'forbidden'); assert.equal(client.state.complete, false);
  }
  const missing = new RecapClient({ async recap() { throw new ApiFailure('接口不存在', 400, 'INVALID_MESSAGE'); } });
  await missing.open(binding()); assert.equal(missing.state.status, 'unavailable'); assert.match(missing.state.message, /结局仍可查看/);
});

test('响应身份、水位、分类及跨页顺序不匹配时不接纳页面', async () => {
  const { RecapClient } = await import('../src/network/recap-client.ts');
  for (const change of [{ sessionId: 'another' }, { actorId: 'another' }, { throughSeq: '11' }, { phase: 'Aborted' }, { entries: [{ ...entry(), category: 'Observation' }] }]) {
    const client = new RecapClient({ async recap() { return { ...page(), ...change }; } });
    await client.open(binding()); assert.deepEqual(client.state.entries, []); assert.equal(client.state.status, 'error');
  }
  let n = 0;
  const client = new RecapClient({ async recap() { return ++n === 1 ? page([entry('9')], '9') : page([entry('9')]); } });
  await client.open(binding()); await client.loadMore();
  assert.equal(client.state.entries.length, 1); assert.equal(client.state.status, 'error'); assert.equal(client.state.complete, false);
});

test('合法空页明确完成，空页错误仍保持不完整', async () => {
  const { RecapClient } = await import('../src/network/recap-client.ts');
  const empty = new RecapClient({ async recap() { return page([]); } });
  await empty.open(binding());
  assert.equal(empty.state.status, 'ready'); assert.equal(empty.state.complete, true); assert.deepEqual(empty.state.entries, []);
  const unavailable = new RecapClient({ async recap() { throw new ApiFailure('暂时无法读取'); } });
  await unavailable.open(binding());
  assert.equal(unavailable.state.status, 'error'); assert.equal(unavailable.state.complete, false); assert.deepEqual(unavailable.state.entries, []);
});
