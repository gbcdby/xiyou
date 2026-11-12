import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiFailure, HttpApi } from '../src/network/http-api.ts';

const entry = (seq = '9', suffix = '') => ({ entryRef: 'entry_' + ('a'.repeat(30)) + seq + suffix, eventSeq: seq, category: 'Claim', text: '我想先看看安排。', fields: [], speakerRef: 'actor_' + 'b'.repeat(32), speakerName: '翠兰' });
const page = (entries = [entry()], nextBeforeSeq = null) => ({ schemaVersion: 2, type: 'session.recap', sessionId: 'S', throughSeq: '10', phase: 'Finished', ending: { title: '各走各路', summary: '已完成救援，尚未达成同行。', endingCode: 'GZ-E02', facts: [{ key: 'safe', label: '翠兰已确认安置', value: true }] }, entries, nextBeforeSeq });
const binding = () => ({ sessionId: 'S', actorRef: 'actor_' + 'c'.repeat(32), throughSeq: '10', phase: 'Finished', viewId: 'view-1', identity: 'account-one' });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('v2复盘HTTP声明空间能力、固定分页水位并保留完整授权长文本', async () => {
  const requests = []; const large = { ...page(Array.from({ length: 50 }, (_, i) => ({ ...entry(String(49 - i)), text: '合法的历史记录。'.repeat(100) }))), throughSeq: '100' };
  const api = new HttpApi(() => 'synthetic-token', async (path, init) => { requests.push({ path, init }); return new Response(JSON.stringify(large)); });
  const controller = new AbortController();
  assert.deepEqual(await api.spatialRecap('S', '100', '60', controller.signal), large);
  assert.equal(requests[0].path, '/api/sessions/S/recap?throughSeq=100&beforeSeq=60');
  assert.equal(requests[0].init.headers['X-Xiyou-Capabilities'], 'spatial-v2');
  assert.equal(requests[0].init.method, 'GET');
  assert.equal(Object.hasOwn(requests[0].init, 'body'), false);
  controller.abort(); assert.equal(requests[0].init.signal.aborted, true);
});

test('换账号/房间/视图/本人引用/终态水位与关闭会清空，迟到旧复盘不能回填', async () => {
  const { SpatialRecapClient } = await import('../src/network/spatial-recap-client.ts');
  for (const change of [{ identity: 'account-two' }, { sessionId: 'S2' }, { viewId: 'view-2' }, { actorRef: 'actor_' + 'd'.repeat(32) }, { throughSeq: '11' }, null]) {
    const requests = [];
    const client = new SpatialRecapClient({ spatialRecap(...args) { const d = deferred(); requests.push({ args, ...d }); return d.promise; } });
    const first = client.open(binding()); const next = client.open(change ? { ...binding(), ...change } : null);
    assert.equal(requests[0].args[3].aborted, true); assert.deepEqual(client.state.entries, []); assert.equal(client.state.ending, null);
    requests[0].resolve(page()); await first; assert.deepEqual(client.state.entries, []);
    if (change) { requests[1].resolve({ ...page(), sessionId: change.sessionId || 'S', throughSeq: change.throughSeq || '10' }); await next; assert.equal(client.state.entries.length, 1); }
    client.close(); assert.deepEqual(client.state.entries, []); assert.equal(client.state.ending, null);
  }
});

test('同一事件的合法多条历史与发生时称呼保持，分页故障重试原水位/游标', async () => {
  const { SpatialRecapClient } = await import('../src/network/spatial-recap-client.ts');
  const calls = []; let attempt = 0;
  const client = new SpatialRecapClient({ async spatialRecap(...args) { calls.push(args); if (++attempt === 1) return page([entry('9', 'a'), entry('9', 'b')], '9'); if (attempt === 2) throw new ApiFailure('暂时断线'); return page([entry('7')]); } });
  await client.open(binding()); await client.loadMore();
  assert.equal(client.state.status, 'error'); assert.equal(client.state.complete, false); assert.equal(client.state.entries.length, 2);
  await client.loadMore(); assert.equal(client.state.complete, true); assert.deepEqual(client.state.entries.map(e => e.eventSeq), ['9', '9', '7']);
  assert.deepEqual(client.state.entries.map(e => e.speakerName), ['翠兰', '翠兰', '翠兰']);
  assert.deepEqual(calls.map(args => args.slice(0, 3)), [['S', '10', undefined], ['S', '10', '9'], ['S', '10', '9']]);
});

test('当前撤权清除已读历史与结局，不把明确失权当成暂时缺页', async () => {
  const { SpatialRecapClient } = await import('../src/network/spatial-recap-client.ts');
  for (const code of ['FORBIDDEN', 'UNAUTHENTICATED', 'SESSION_GONE']) {
    let calls = 0;
    const client = new SpatialRecapClient({ async spatialRecap() { if (++calls === 1) return page([entry()], '9'); throw new ApiFailure('访问终止', 404, code); } });
    await client.open(binding()); await client.loadMore();
    assert.deepEqual(client.state.entries, []); assert.equal(client.state.ending, null); assert.equal(client.state.status, 'forbidden'); assert.equal(client.state.complete, false);
  }
});

test('跨房/未来事件/倒序/重复及不推进的分页拒绝进入授权历史', async () => {
  const { SpatialRecapClient } = await import('../src/network/spatial-recap-client.ts');
  for (const invalid of [
    { ...page(), sessionId: 'S2' }, { ...page(), throughSeq: '11' }, { ...page(), phase: 'Aborted' },
    page([entry('11')]), page([entry('7'), entry('9')]), page([entry(), entry()]), page([], '9'), page([entry('9')], '10'),
  ]) {
    const client = new SpatialRecapClient({ async spatialRecap() { return invalid; } });
    await client.open(binding()); assert.equal(client.state.status, 'error'); assert.deepEqual(client.state.entries, []); assert.equal(client.state.ending, null);
  }
  let calls = 0;
  const client = new SpatialRecapClient({ async spatialRecap() { return ++calls === 1 ? page([entry('9')], '9') : page([entry('9')], '9'); } });
  await client.open(binding()); await client.loadMore(); assert.equal(client.state.status, 'error'); assert.equal(client.state.entries.length, 1);
});

test('复盘故障使用固定反馈，不把内部错误/隐藏称呼暴露给玩家', async () => {
  const { SpatialRecapClient } = await import('../src/network/spatial-recap-client.ts');
  const client = new SpatialRecapClient({ async spatialRecap() { throw new Error('内部真身、权限路径和调试信息'); } });
  await client.open(binding()); assert.equal(client.state.status, 'error'); assert.doesNotMatch(client.state.message, /真身|权限路径|调试信息/);
  const empty = new SpatialRecapClient({ async spatialRecap() { return page([]); } });
  await empty.open(binding()); assert.equal(empty.state.complete, true); assert.equal(empty.state.status, 'ready');
});
