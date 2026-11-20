import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AuthorityRuntime } from '../runtime.mjs';
import { loadContent, contentDigest } from '../../content/index.mjs';
import { emptyWorld, reduceWorld } from '../../game/world.mjs';
import { encodeJsonbText } from '../jsonb-text.mjs';
import { PrefixStateBudget, PrefixStateCache } from '../prefix-state-cache.mjs';

const content = await loadContent('spatial-graybox-v2');
const sessionId = 'S-prefix-cache';
const cause = { principalId: 'system', actionId: 'prefix-cache-test' };
const runtimes = new Set();
afterEach(async () => { for (const runtime of runtimes) await runtime.close(); runtimes.clear(); });

function fixture({ fixedContent = content, session = sessionId, hostName = '甲' } = {}) {
  const initial = emptyWorld(session, fixedContent);
  const definitions = [
    ['session.created', { hostUserId: 'U-host', seed: 'prefix' }],
    ['session.member_joined', { userId: 'U-host', characterId: 'C-host', name: hostName }],
    ['session.member_joined', { userId: 'U-guest', characterId: 'C-guest', name: '乙' }],
    ['spatial.started', { wallAnchorMs: 0 }],
    ...[10, 20, 30].map(sceneTimeMs => ['spatial.clock', { sceneTimeMs, wallAnchorMs: sceneTimeMs, paused: false }]),
  ];
  const events = definitions.map(([kind, payload], index) => ({ schemaVersion: 2, sessionId: session, sessionSeq: String(index + 1),
    eventId: `${session}:E${index + 1}`, causedBy: cause, serverTime: '2026-11-16T00:00:00.000Z',
    audience: { humanCharacterIds: [], coreNpcCharacterIds: [], proxyCharacterIds: [] }, kind, payload }));
  const states = [initial];
  for (const event of events) states.push(reduceWorld(states.at(-1), event, fixedContent));
  const storedState = encodeJsonbText(states.at(-1));
  const row = { session_id: session, session_seq: String(events.length), state: storedState.value, state_text_encoding: storedState.encoding,
    initial_state: initial, content_snapshot: fixedContent, content_digest: contentDigest(fixedContent),
    reducer_version: fixedContent.reducerVersion, logical_time: '2026-11-16T00:00:00.000Z' };
  const observations = { eventReads: [], scannedEvents: 0 };
  const client = {
    visibleEvents: events,
    async query(sql, parameters) {
      if (sql.includes('SELECT * FROM sessions')) return { rows: [structuredClone(row)] };
      if (sql.includes('SELECT event,event_text_encoding FROM world_events')) {
        const lower = /session_seq\s*>\s*\$2/.test(sql) ? BigInt(parameters[1]) : 0n;
        const upper = BigInt(parameters.at(-1));
        const selected = this.visibleEvents.filter(event => BigInt(event.sessionSeq) > lower && BigInt(event.sessionSeq) <= upper);
        observations.eventReads.push({ lower: String(lower), upper: String(upper), count: selected.length });
        observations.scannedEvents += selected.length;
        return { rows: selected.map(event => { const stored = encodeJsonbText(event); return { event: structuredClone(stored.value), event_text_encoding: stored.encoding }; }) };
      }
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
      throw new Error(`未预期的数据库调用：${sql}`);
    },
    release() {},
  };
  const pool = { async connect() { return client; } };
  const runtime = new AuthorityRuntime({ pool, now: () => Date.parse(row.logical_time) });
  runtimes.add(runtime);
  const run = (operation, rollback = false) => {
    const marker = new Error('受控只读回滚'); let result;
    return runtime.locked(session, { kind: 'prefix-cache-test', cause }, async tx => {
      result = await operation(tx); if (rollback) throw marker; return result;
    }).catch(error => { if (rollback && error === marker) return result; throw error; });
  };
  const at = q => run(tx => runtime.stateAt(tx, q));
  return { initial, events, states, row, client, pool, runtime, run, at, observations };
}

test('已提交历史前缀重复读取保持原 replay 状态且不再扫描历史事件', async () => {
  const f = fixture();
  const expected = await f.runtime.replay(sessionId, '5');
  const first = await f.at('5');
  assert.deepEqual(first, expected);
  const before = f.observations.scannedEvents;
  const second = await f.at('5');
  assert.deepEqual(second, expected);
  assert.equal(f.observations.scannedEvents, before, '重复已提交前缀不能再次重放全部历史');
});

test('冷 runtime 观察过的已提交快照在后续同步中直接可用，不回到历史起点', async () => {
  const f = fixture();
  const snapshot = await f.at('7');
  assert.deepEqual(snapshot, f.states[7]);
  assert.equal(f.observations.scannedEvents, 0, '当前快照不需要读取事件');
  const next = { ...f.events.at(-1), sessionSeq: '8', eventId: `${sessionId}:E8`,
    payload: { sceneTimeMs: 40, wallAnchorMs: 40, paused: false } };
  const stored = encodeJsonbText(reduceWorld(f.states[7], next, content));
  Object.assign(f.row, { session_seq: '8', state: stored.value, state_text_encoding: stored.encoding });
  f.client.visibleEvents = [...f.events, next];
  snapshot.characters['C-host'].name = '调用者不能污染已提交锚点';
  assert.deepEqual(await f.at('7'), f.states[7]);
  assert.equal(f.observations.scannedEvents, 0, '后续同步的快照锚点不得重放整段冷历史');
});

test('读取事务回滚仍可保留先前已提交的行头，但不保留本事务修改', async () => {
  const f = fixture();
  await f.run(tx => {
    tx.state.characters['C-host'].name = '事务内修改';
    tx.row.state.characters['C-host'].name = '行对象修改';
    tx.emit('spatial.clock', { sceneTimeMs: 40, wallAnchorMs: 40, paused: false });
  }, true);
  const next = { ...f.events.at(-1), sessionSeq: '8', eventId: `${sessionId}:E8`,
    payload: { sceneTimeMs: 40, wallAnchorMs: 40, paused: false } };
  const stored = encodeJsonbText(reduceWorld(f.states[7], next, content));
  Object.assign(f.row, { session_seq: '8', state: stored.value, state_text_encoding: stored.encoding });
  f.client.visibleEvents = [...f.events, next];
  assert.deepEqual(await f.at('7'), f.states[7]);
  assert.equal(f.observations.scannedEvents, 0, '事务开始前已提交的行头不会随本事务回滚失效');
});

test('历史、零、重复和倒序目标逐项等于未缓存 replay，补读只使用不大于目标的最近前缀', async () => {
  const f = fixture();
  for (const q of ['5', '0', '6', '2', '4', '1', '6']) {
    const expected = await f.runtime.replay(sessionId, q);
    assert.deepEqual(await f.at(q), expected);
  }
  assert(f.observations.eventReads.some(read => read.lower === '5' && read.upper === '6' && read.count === 1));
  assert(f.observations.eventReads.some(read => read.lower === '2' && read.upper === '4' && read.count === 2));
});

test('调用者修改返回的深层对象不污染精确命中或后续后缀重放', async () => {
  const f = fixture();
  const value = await f.at('5');
  value.characters['C-host'].name = '不应入库'; value.members[0].name = '污染';
  const hit = await f.at('5');
  assert.equal(hit.characters['C-host'].name, '甲');
  hit.characters['C-guest'].name = '另一处污染';
  assert.deepEqual(await f.at('6'), await f.runtime.replay(sessionId, '6'));
});

test('事务当前 fast path 保留同一对象，emit 的当前状态不跨事务晋升', async () => {
  const f = fixture();
  await f.run(async tx => {
    tx.emit('spatial.clock', { sceneTimeMs: 40, wallAnchorMs: 40, paused: false });
    const before = f.observations.eventReads.length;
    assert.equal(await f.runtime.stateAt(tx, '8'), tx.state);
    assert.equal(f.observations.eventReads.length, before);
  }, true);
  await assert.rejects(f.at('8'), { code: 'RESYNC_REQUIRED' });
});

test('原 h 以上的中间未提交前缀不从 tx.events 合成；缺少 SQL 行仍按原路径失败', async () => {
  const f = fixture();
  await f.at('5');
  await assert.rejects(f.run(async tx => {
    tx.emit('spatial.clock', { sceneTimeMs: 40, wallAnchorMs: 40, paused: false });
    tx.emit('spatial.clock', { sceneTimeMs: 50, wallAnchorMs: 50, paused: false });
    return f.runtime.stateAt(tx, '8');
  }, true), { code: 'RESYNC_REQUIRED' });
  assert.deepEqual(f.observations.eventReads.at(-1), { lower: '0', upper: '8', count: 7 });
});

test('SQL 可见的本事务 INSERT 中间点仍不缓存，回滚或提交未知后原前缀必须重新确认', async () => {
  const f = fixture();
  for (const outcome of ['ROLLBACK', 'OUTCOME_UNKNOWN']) {
    const query = f.client.query.bind(f.client);
    if (outcome === 'OUTCOME_UNKNOWN') f.client.query = async (sql, args) => {
      if (sql === 'COMMIT') throw new Error('受控提交响应丢失');
      if (/^(INSERT INTO (world_events|outbox)|UPDATE sessions SET)/.test(sql)) return { rows: [] };
      return query(sql, args);
    };
    const operation = f.run(async tx => {
      tx.emit('spatial.clock', { sceneTimeMs: 40, wallAnchorMs: 40, paused: false });
      tx.emit('spatial.clock', { sceneTimeMs: 50, wallAnchorMs: 50, paused: false });
      f.client.visibleEvents = [...f.events, tx.events[0]];
      assert.equal((await f.runtime.stateAt(tx, '8')).sessionSeq, '8', outcome);
    }, outcome === 'ROLLBACK');
    if (outcome === 'OUTCOME_UNKNOWN') await assert.rejects(operation, { code: 'OUTCOME_UNKNOWN' });
    else await operation;
    f.client.query = query;
    assert.equal(f.observations.eventReads.at(-1).lower, '0');
    f.client.visibleEvents = f.events;
    await assert.rejects(f.at('8'), { code: 'RESYNC_REQUIRED' });
  }
});

test('可信提交上界固定在事务开始时，后来改动 row 水位不会扩大缓存资格', async () => {
  const f = fixture();
  await f.run(async tx => {
    tx.emit('spatial.clock', { sceneTimeMs: 40, wallAnchorMs: 40, paused: false });
    tx.emit('spatial.clock', { sceneTimeMs: 50, wallAnchorMs: 50, paused: false });
    tx.row.session_seq = '9'; tx.row.state.sessionSeq = '9';
    f.client.visibleEvents = [...f.events, tx.events[0]];
    await f.runtime.stateAt(tx, '8');
  }, true);
  f.client.visibleEvents = f.events;
  await assert.rejects(f.at('8'), { code: 'RESYNC_REQUIRED' });
});

test('锁定行的列水位与解码状态不一致时弃用缓存，不改变原重放结果', async () => {
  const f = fixture();
  await f.at('5');
  f.row.session_seq = '6';
  const before = f.observations.scannedEvents;
  assert.deepEqual(await f.at('5'), f.states[5]);
  assert.equal(f.observations.scannedEvents - before, 5);
});

test('两个 owner 即便共享 pool 也冷读；历史恢复用新 owner 隔离同名旧分支', async () => {
  const a = fixture(), b = fixture({ hostName: '恢复分支' });
  await a.at('5');
  assert.equal((await b.at('5')).characters['C-host'].name, '恢复分支');
  assert.equal(b.observations.scannedEvents, 5);
  const fresh = new AuthorityRuntime({ pool: a.pool }); runtimes.add(fresh);
  const before = a.observations.scannedEvents;
  assert.deepEqual(await fresh.locked(sessionId, { kind: 'prefix-cache-test', cause }, tx => fresh.stateAt(tx, '5')), a.states[5]);
  assert.equal(a.observations.scannedEvents - before, 5);
});

test('同 owner 更换 pool 立即停止缓存资格，不继承其他数据库的相同键', async () => {
  const a = fixture(), b = fixture({ hostName: '另一数据库' });
  await a.at('5');
  a.runtime.pool = b.pool;
  assert.equal((await a.at('5')).characters['C-host'].name, '另一数据库');
  const before = b.observations.scannedEvents;
  await a.at('5');
  assert.equal(b.observations.scannedEvents - before, 5);
});

test('不同 session、content digest 或 reducer 标识不命中旧命名空间', async () => {
  const f = fixture();
  await f.at('5');
  const other = fixture({ session: 'S-other', hostName: '别局' });
  const query = f.client.query.bind(f.client);
  f.client.query = (sql, args) => args?.[0] === 'S-other' ? other.client.query(sql, args) : query(sql, args);
  assert.equal((await f.runtime.locked('S-other', { kind: 'prefix-cache-test', cause }, tx => f.runtime.stateAt(tx, '5'))).characters['C-host'].name, '别局');
  for (const field of ['content_digest', 'reducer_version']) {
    const original = f.row[field]; f.row[field] += '-separate';
    const before = f.observations.scannedEvents;
    assert.deepEqual(await f.at('5'), f.states[5]);
    assert.equal(f.observations.scannedEvents - before, 5);
    f.row[field] = original;
  }
});

test('create 等未锁定的 buildTransaction 不授缓存资格，即使行包含可读中间前缀', async () => {
  const f = fixture();
  const uncommitted = () => f.runtime.buildTransaction(f.client, structuredClone(f.row), cause);
  for (let i = 0; i < 2; i += 1) {
    const before = f.observations.scannedEvents;
    assert.deepEqual(await f.runtime.stateAt(uncommitted(), '5'), f.states[5]);
    assert.equal(f.observations.scannedEvents - before, 5);
  }
  const before = f.observations.scannedEvents;
  assert.deepEqual(await f.at('5'), f.states[5]);
  assert.equal(f.observations.scannedEvents - before, 5, '首次锁定读取不能命中未提交来源');
});

test('乱序完成的历史读取按最大可用前缀选择，而不是最后写入项', async () => {
  const f = fixture(), gate = Promise.withResolvers(), entered = Promise.withResolvers();
  const query = f.client.query.bind(f.client);
  f.client.query = async (sql, args) => {
    if (sql.includes('SELECT event,') && args.at(-1) === '5') { entered.resolve(); await gate.promise; }
    return query(sql, args);
  };
  const older = f.at('5'); await entered.promise;
  assert.deepEqual(await f.at('6'), f.states[6]);
  gate.resolve(); await older;
  const before = f.observations.scannedEvents;
  assert.deepEqual(await f.at('6'), f.states[6]);
  assert.equal(f.observations.scannedEvents, before);
});

test('close 清缓存且阻止在途旧计算重新填回，原方法仍可退回无缓存读取', async () => {
  const f = fixture(), gate = Promise.withResolvers(), entered = Promise.withResolvers();
  const query = f.client.query.bind(f.client); let held = false;
  f.client.query = async (sql, args) => {
    if (sql.includes('SELECT event,') && !held) { held = true; entered.resolve(); await gate.promise; }
    return query(sql, args);
  };
  const pending = f.at('5'); await entered.promise;
  await f.runtime.close(); gate.resolve(); assert.deepEqual(await pending, f.states[5]);
  for (let i = 0; i < 2; i += 1) {
    const before = f.observations.scannedEvents;
    assert.deepEqual(await f.at('5'), f.states[5]);
    assert.equal(f.observations.scannedEvents - before, 5);
  }
});

test('NUL 与字面反斜杠编码在冷读、命中和后缀读取中保持逐字段相等', async () => {
  const f = fixture({ hostName: '甲\u0000乙\\0\\末' });
  for (const q of ['5', '5', '6']) {
    const value = await f.at(q);
    assert.deepEqual(value, await f.runtime.replay(sessionId, q));
    assert.equal(value.characters['C-host'].name, '甲\u0000乙\\0\\末');
  }
});

test('原缺口、编码和 reducer 错误在冷路径或未缓存后缀中原样失败，不登记坏点', async () => {
  const f = fixture();
  await f.at('4');
  f.client.visibleEvents = f.events.filter(event => event.sessionSeq !== '5');
  await assert.rejects(f.at('6'), /连续前缀/);
  f.client.visibleEvents = f.events;
  const query = f.client.query.bind(f.client);
  f.client.query = async (...args) => {
    const result = await query(...args);
    if (args[0].includes('SELECT event,')) result.rows[0].event_text_encoding = 'invalid-encoding';
    return result;
  };
  await assert.rejects(f.at('6'), /未知的 JSONB/);
  f.client.query = async (...args) => {
    const result = await query(...args);
    if (args[0].includes('SELECT event,')) result.rows[0].event.kind = 'not-a-world-event';
    return result;
  };
  await assert.rejects(f.at('6'));
  f.client.query = query;
  assert.deepEqual(await f.at('6'), f.states[6]);
});

function smallCache(limits = {}) {
  const pool = {}, budget = new PrefixStateBudget({ bytes: 16000, entries: 3, sessionEntries: 2, itemBytes: 8000, ...limits });
  const cache = new PrefixStateCache(pool, budget);
  function tx(session = 'S', suffix = '') {
    const row = { session_id: session, session_seq: '9', state: { sessionId: session, sessionSeq: '9' },
      content_digest: 'content' + suffix, reducer_version: 'reducer', initial_state: {} };
    const value = { row, content: {}, state: structuredClone(row.state) }; cache.capture(value, pool); return value;
  }
  function save(transaction, seq, extra = {}) { const value = { sessionId: transaction.row.session_id, sessionSeq: seq, ...extra }; cache.complete(cache.begin(transaction, seq, pool), transaction, value, pool); }
  return { pool, budget, cache, tx, save };
}

test('资源限制按同局合并内容命名空间，并按精确字节代理和全局项数淘汰', () => {
  const f = smallCache();
  const a = f.tx(), b = f.tx('S', '-new'), other = f.tx('T');
  f.save(a, '1'); f.save(a, '2'); f.save(b, '3');
  assert.equal(f.cache.begin(a, '1', f.pool).sequence, null);
  f.save(other, '1'); f.save(other, '2');
  assert.equal(f.budget.usage.entries, 3);
  assert(f.budget.usage.bytes <= f.budget.limits.bytes);
  f.cache.close(); assert.deepEqual(f.budget.usage, { entries: 0, bytes: 0 });
});

test('超大项和无法克隆的返回值不缓存，其他已确认项继续可读', () => {
  const f = smallCache({ itemBytes: 150 }); const tx = f.tx();
  f.save(tx, '1'); f.save(tx, '2', { text: '长'.repeat(100) });
  f.save(tx, '3', { function: () => {} });
  assert.equal(f.cache.begin(tx, '3', f.pool).sequence, '1');
  assert.equal(f.budget.usage.entries, 2, '只有已提交行头和合法历史项占用预算'); f.cache.close();
});

test('共享全进程预算只共享淘汰额度，不共享 owner 数据；删除会话阻止旧回调填回', () => {
  const f = smallCache(), secondPool = {}, second = new PrefixStateCache(secondPool, f.budget);
  const tx = f.tx(); f.save(tx, '1');
  const secondTx = { row: structuredClone(tx.row), content: {}, state: structuredClone(tx.state) }; second.capture(secondTx, secondPool);
  assert.equal(second.begin(secondTx, '1', secondPool).sequence, null);
  const pending = f.cache.begin(tx, '2', f.pool);
  f.cache.clearSession('S');
  f.cache.complete(pending, tx, { sessionId: 'S', sessionSeq: '2' }, f.pool);
  assert.equal(f.budget.usage.entries, 1, '删除一个 owner 的会话不能删除另一个 owner 已确认的行头');
  assert.equal(second.begin(secondTx, '9', secondPool).sequence, '9');
  second.close(); f.cache.close(); assert.deepEqual(f.budget.usage, { entries: 0, bytes: 0 });
});

test('跨 owner 总字节数实际触发淘汰，淘汰后旧 owner 返回 miss 而不影响状态语义', () => {
  const f = smallCache({ bytes: 200, entries: 10, sessionEntries: 10, itemBytes: 200 });
  const otherPool = {}, other = new PrefixStateCache(otherPool, f.budget), first = f.tx();
  const second = { row: structuredClone(first.row), content: {}, state: structuredClone(first.state) }; other.capture(second, otherPool);
  f.save(first, '1', { text: 'a'.repeat(80) });
  other.complete(other.begin(second, '2', otherPool), second, { sessionId: 'S', sessionSeq: '2', text: 'b'.repeat(80) }, otherPool);
  assert.equal(f.budget.usage.entries, 1); assert(f.budget.usage.bytes <= 200);
  assert.equal(f.cache.begin(first, '1', f.pool).sequence, null);
  assert.equal(other.begin(second, '2', otherPool).sequence, '2');
  other.close(); f.cache.close();
});

test('真实 deleteSession 接线只在 COMMIT 后撤销缓存；回滚不丢弃已确认旧点', async () => {
  const f = fixture();
  const event = { ...f.events.at(-1), sessionSeq: '8', eventId: `${sessionId}:E8`, kind: 'session.aborted', payload: { reason: '缓存删除边界' } };
  const terminal = reduceWorld(f.states.at(-1), event, content), stored = encodeJsonbText(terminal);
  Object.assign(f.row, { session_seq: '8', state: stored.value, state_text_encoding: stored.encoding });
  f.client.visibleEvents = [...f.events, event];
  const query = f.client.query.bind(f.client); let deleted = 0;
  f.client.query = async (sql, args) => { if (sql.startsWith('DELETE FROM sessions')) { deleted += 1; return { rows: [] }; } return query(sql, args); };
  await f.at('5');
  f.runtime.hooks.beforeCommit = ({ command }) => { if (command === 'delete') throw new Error('受控提交前回滚'); };
  await assert.rejects(f.runtime.deleteSession(sessionId), /受控提交前回滚/);
  let before = f.observations.scannedEvents;
  assert.deepEqual(await f.at('5'), f.states[5]);
  assert.equal(f.observations.scannedEvents, before);
  delete f.runtime.hooks.beforeCommit;
  await f.runtime.deleteSession(sessionId);
  before = f.observations.scannedEvents;
  assert.deepEqual(await f.at('5'), f.states[5]);
  assert.equal(f.observations.scannedEvents - before, 5); assert.equal(deleted, 2);
});
