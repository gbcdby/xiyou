import test from 'node:test';
import assert from 'node:assert/strict';
import { room, until } from '../test-support/spatial-supply-room.mjs';

// Arm from the public duringPublish hook after all peers already received the row.
// Only Promise-based pool leases are wrapped; callback pool.query stays untouched.
function plaFaultLease(pool, { before, after } = {}) {
  const connect = pool.connect, events = [];
  let armed = false, captured = null, restored = false;
  pool.connect = function (...args) {
    if (args.some(value => typeof value === 'function')) return connect.apply(this, args);
    const lease = connect.apply(this, args);
    if (!lease?.then) return lease;
    return lease.then(client => {
      if (!armed || captured) return client;
      armed = false;
      const query = client.query, release = client.release;
      const state = { client, pid: client.processID, released: false }; captured = state;
      client.query = async function (...queryArgs) {
        const entry = { sql: queryArgs[0], pid: state.pid, returned: false, code: null, injected: false }; events.push(entry);
        try {
          await before?.(entry, state);
          const result = await query.apply(this, queryArgs); entry.returned = true;
          await after?.(entry, result, state);
          return result;
        } catch (error) { entry.code = error.code; throw error; }
      };
      client.release = function (...args) {
        state.released = true;
        events.push({ release: true, pid: state.pid, error: args[0] ?? null });
        client.query = query; client.release = release;
        return release.apply(this, args);
      };
      return client;
    });
  };
  return { events, arm() { armed = true; }, captured: () => captured,
    async restore() {
      if (restored) return; restored = true; pool.connect = connect;
      // Failure cleanup only: assertions occur before this forced lease retirement.
      if (captured && !captured.released) {
        try { await captured.client.query('ROLLBACK'); } catch {}
        captured.client.release(new Error('PLA fixture cleanup of unreleased client'));
      }
    },
  };
}
const plaLockError = label => Object.assign(new Error(label), { code: '55P03' });
const plaStoredRow = (r, through) => r.database.pool.query(
  'SELECT status,attempts FROM outbox WHERE session_id=$1 AND through_seq=$2', [r.sessionId, through]).then(result => result.rows);

test('PLA-03：55P03 仅锁 SELECT 可延期，其他位置保留错误或提交未知', { timeout: 20000 }, async t => {
  const r = await room(t);
  for (const site of ['BEGIN', 'UPDATE', 'beforeCommit', 'COMMIT', 'afterCommit']) {
    await t.test(site, async () => {
      const through = await r.append(); await Promise.all(r.peers.map(r.query));
      const fault = plaLockError(`fixed ${site} failure`); let injected = false;
      const audit = plaFaultLease(r.database.pool, {
        before(entry) {
          if (site === 'UPDATE' && typeof entry.sql === 'string' && entry.sql.startsWith('UPDATE outbox SET')) {
            injected = entry.injected = true; throw fault;
          }
        },
        after(entry) {
          // BEGIN really opened; COMMIT really committed before its response is lost.
          if ((site === 'BEGIN' || site === 'COMMIT') && entry.sql === site) {
            injected = entry.injected = true; throw fault;
          }
        },
      });
      r.runtime.hooks.duringPublish = () => audit.arm();
      r.runtime.hooks.beforeCommit = ({ command }) => {
        if (command === 'outbox-progress' && site === 'beforeCommit') { injected = true; throw fault; }
      };
      r.runtime.hooks.afterCommit = ({ command }) => {
        if (command === 'outbox-progress' && site === 'afterCommit') { injected = true; throw fault; }
      };
      try {
        const committed = site === 'COMMIT' || site === 'afterCommit';
        await assert.rejects(r.flush({ progressLock: 'try' }), error => committed ? error.code === 'OUTCOME_UNKNOWN' : error === fault);
        assert.equal(injected, true, 'the selected fault must actually have been reached');
        assert.deepEqual(await plaStoredRow(r, through), [{ status: committed ? 'Published' : 'Pending', attempts: committed ? 1 : 0 }]);
        assert.equal(audit.events.filter(event => event.release).length, 1);
        if (!committed) assert(audit.events.some(event => event.sql === 'ROLLBACK' && event.returned), 'failure must really roll back');
        else assert(audit.events.some(event => event.sql === 'COMMIT' && event.returned), 'unknown result must correspond to a real committed transaction');
      } finally {
        delete r.runtime.hooks.duringPublish; delete r.runtime.hooks.beforeCommit; delete r.runtime.hooks.afterCommit;
        await audit.restore();
        await r.flush(); // Restore a finite fixture before the next independent fault.
      }
    });
  }
});

test('PLA-03：忙分支 ROLLBACK 失败必须可见并丢弃 client，不能当延期成功', { timeout: 15000 }, async t => {
  const r = await room(t), through = await r.append(); await Promise.all(r.peers.map(r.query));
  const holder = await r.database.pool.connect(); let holderOpen = false, publishing, settled = false, rollbackInjected = false;
  const fault = Object.assign(new Error('fixed busy ROLLBACK transport failure'), { code: 'PLA_ROLLBACK_FAILURE' });
  let audit;
  try {
    await holder.query('BEGIN'); holderOpen = true;
    await holder.query('SELECT session_id FROM sessions WHERE session_id=$1 FOR SHARE', [r.sessionId]);
    audit = plaFaultLease(r.database.pool, { before(entry) {
      if (entry.sql === 'ROLLBACK' && !rollbackInjected) { rollbackInjected = entry.injected = true; throw fault; }
    } });
    r.runtime.hooks.duringPublish = () => audit.arm();
    publishing = r.flush({ progressLock: 'try' });
    const outcome = publishing.then(value => ({ value }), error => ({ error }));
    void outcome.then(() => { settled = true; });
    await until(() => settled, 'try busy rollback failure must settle while the unrelated shared lock is still held');
    const result = await outcome;
    assert.equal(result.error, fault, 'rollback failure must not be swallowed as false/Published');
    assert.equal(rollbackInjected, true);
    assert(audit.events.some(event => event.sql === 'SELECT session_id FROM sessions WHERE session_id=$1 FOR UPDATE NOWAIT' && event.code === '55P03'));
    const releases = audit.events.filter(event => event.release);
    assert.equal(releases.length, 1); assert.equal(releases[0].error, fault);
    assert.deepEqual(await plaStoredRow(r, through), [{ status: 'Pending', attempts: 0 }]);
    const retiredPid = audit.captured().pid;
    await until(async () => (await r.database.pool.query('SELECT 1 FROM pg_stat_activity WHERE pid=$1', [retiredPid])).rowCount === 0,
      'discarded failing client must actually disappear from PostgreSQL, not merely escape one next lease');
    const later = await r.database.pool.connect();
    try { assert.notEqual(later, audit.captured().client); assert.equal((await later.query('SELECT 1 AS usable')).rows[0].usable, 1); }
    finally { later.release(); }
  } finally {
    if (holderOpen) await holder.query('ROLLBACK').catch(() => {});
    await publishing?.catch(() => {});
    holder.release(); delete r.runtime.hooks.duringPublish; await audit?.restore();
  }
});
