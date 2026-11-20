import test from 'node:test';
import assert from 'node:assert/strict';
import { committedPublisher } from '../spatial-direction-runtime.mjs';
import { room, until, holdNextInstallation } from '../test-support/spatial-supply-room.mjs';
import { validateSpatial } from '../../protocol/spatial.mjs';

const PLA_WAIT_SQL = 'SELECT session_id FROM sessions WHERE session_id=$1 FOR UPDATE';
const PLA_TRY_SQL = PLA_WAIT_SQL + ' NOWAIT';
const PLA_LEGACY_SQL = 'SELECT * FROM sessions WHERE session_id=$1 FOR UPDATE';
const plaEventTurn = () => new Promise(resolve => setImmediate(resolve));
function plaAuditProgress(pool, { after, allowLegacy = () => false } = {}) {
  const connect = pool.connect, events = [], leases = [];
  pool.connect = function (...args) {
    if (args.some(value => typeof value === 'function')) return connect.apply(this, args);
    const connecting = connect.apply(this, args); if (!connecting?.then) return connecting;
    return connecting.then(client => {
      const query = client.query, release = client.release;
      const lease = { client, pid: client.processID, progress: false, released: false }; leases.push(lease);
      client.query = function (...args) {
        if (args.some(value => typeof value === 'function')) return query.apply(this, args);
        const receiver = this;
        return (async () => {
          const sql = args[0];
          lease.progress ||= sql === PLA_WAIT_SQL || sql === PLA_TRY_SQL || allowLegacy() && sql === PLA_LEGACY_SQL;
          const entry = lease.progress ? { sql, pid: lease.pid, returned: false, settled: false, code: null } : null;
          if (entry) events.push(entry);
          try {
            const value = await query.apply(receiver, args);
            if (entry) { entry.returned = true; await after?.(entry); entry.settled = true; }
            return value;
          } catch (error) { if (entry) { entry.returned = true; entry.settled = true; entry.code = error.code; } throw error; }
        })();
      };
      client.release = function (...args) {
        lease.released = true; client.query = query; client.release = release;
        if (lease.progress) events.push({ release: true, pid: lease.pid, error: args[0] ?? null });
        return release.apply(this, args);
      };
      return client;
    });
  };
  return { events,
    async restore() {
      pool.connect = connect;
      // Called only after the test has unblocked and awaited all started work.
      for (const lease of leases.filter(lease => !lease.released)) {
        try { await lease.client.query('ROLLBACK'); } catch {}
        lease.client.release(new Error('PLA fixture cleanup of unreleased client'));
      }
    },
  };
}
async function plaActuallyWaiting(pool, pid, sql) {
  const row = (await pool.query('SELECT wait_event_type,query FROM pg_stat_activity WHERE pid=$1', [pid])).rows[0];
  return row?.wait_event_type === 'Lock' && row.query === sql;
}
const plaProgressRows = (r, list) => r.database.pool.query(
  'SELECT through_seq,status,attempts FROM outbox WHERE session_id=$1 AND through_seq=ANY($2::bigint[]) ORDER BY through_seq',
  [r.sessionId, list]).then(result => result.rows);

test('PLA-06：wait 实际等待有限持锁者，取得排他锁后新共享读不得穿透', { timeout: 15000 }, async t => {
  const r = await room(t), through = await r.append(); await Promise.all(r.peers.map(r.query));
  const holder = await r.database.pool.connect(), firstGate = Promise.withResolvers(), commitGate = Promise.withResolvers();
  const originalPublish = r.runtime.publishPending, tasks = new Set(), modes = [];
  let holderOpen = false, reader = null, readerOpen = false, reading, readerSettled = false;
  let enteredFirst = false, progressLocked = false, publisher, audit, progressCalls = 0;
  try {
    await holder.query('BEGIN'); holderOpen = true; await holder.query('SELECT session_id FROM sessions WHERE session_id=$1 FOR SHARE', [r.sessionId]);
    audit = plaAuditProgress(r.database.pool);
    r.runtime.publishPending = function (deliver, options) { modes.push(options.progressLock); return originalPublish.call(this, deliver, options); };
    r.runtime.hooks.duringPublish = async () => { if (++progressCalls === 1) { enteredFirst = true; await firstGate.promise; } };
    r.runtime.hooks.beforeCommit = async ({ command }) => { if (command === 'outbox-progress') { progressLocked = true; await commitGate.promise; } };
    publisher = committedPublisher({ runtime: r.runtime, deliver: r.deliver, track(promise) {
      tasks.add(promise); void promise.then(() => tasks.delete(promise), () => tasks.delete(promise)); return promise;
    } });
    publisher.request('spatial-v2', { progressLock: 'try' }); await until(() => enteredFirst, 'first G must reach its public progress hook');
    publisher.request('spatial-v2', { progressLock: 'wait' }); publisher.request('spatial-v2', { progressLock: 'try' });
    firstGate.resolve();
    await until(async () => {
      const entry = audit.events.find(event => event.sql === PLA_WAIT_SQL && !event.returned);
      return !!entry && await plaActuallyWaiting(r.database.pool, entry.pid, PLA_WAIT_SQL);
    }, 'the retained wait request must really enter the PostgreSQL lock queue');
    const waiting = audit.events.find(event => event.sql === PLA_WAIT_SQL && !event.returned);
    assert.deepEqual(modes, ['try', 'wait']);
    assert(audit.events.some(event => event.sql === PLA_TRY_SQL && event.code === '55P03'));
    assert(audit.events.some(event => event.sql === 'ROLLBACK' && event.returned && event.settled));
    assert.equal(waiting.returned, false);
    // 排队不是读者围栏：先释放本夹具的有限冲突集合，再验证实际获授后的互斥。
    await holder.query('ROLLBACK'); holderOpen = false;
    await until(() => progressLocked, 'wait G must really acquire the row and reach its original pre-COMMIT hook');
    assert.equal(waiting.returned, true);
    reader = await r.database.pool.connect(); await reader.query('BEGIN'); readerOpen = true;
    const shareSql = 'SELECT session_id FROM sessions WHERE session_id=$1 FOR SHARE';
    reading = reader.query(shareSql, [r.sessionId]);
    void reading.then(() => { readerSettled = true; }, () => { readerSettled = true; });
    await until(() => plaActuallyWaiting(r.database.pool, reader.processID, shareSql), 'new SHARE must actually wait while G holds the exclusive row lock');
    assert.equal(readerSettled, false);
    commitGate.resolve(); await reading; await reader.query('ROLLBACK'); readerOpen = false;
    await until(() => tasks.size === 0, 'the one publisher must naturally settle after its real COMMIT');
    assert.deepEqual(await plaProgressRows(r, [through]), [{ through_seq: through, status: 'Published', attempts: 1 }]);
    assert.deepEqual(modes, ['try', 'wait']);
  } finally {
    publisher?.close(); firstGate.resolve(); commitGate.resolve();
    if (holderOpen) await holder.query('ROLLBACK').catch(() => {});
    await reading?.catch(() => {});
    if (readerOpen) await reader.query('ROLLBACK').catch(() => {});
    await Promise.allSettled([...tasks]);
    reader?.release(); holder.release(); await audit?.restore();
    r.runtime.publishPending = originalPublish; delete r.runtime.hooks.duringPublish; delete r.runtime.hooks.beforeCommit;
  }
});

test('PLA-07：try G 的真实回滚已完成但调用未返回，P=1/2均保留G/W自然收束', { timeout: 30000 }, async t => {
  for (const count of [1, 2]) {
    await t.test(`P=${count}`, async t => {
      const r = await room(t), old = [];
      for (let i = 0; i < count; i++) old.push(await r.append());
      await Promise.all(r.peers.map(r.query));
      const holder = await r.database.pool.connect(), rollbackGate = Promise.withResolvers(), waveGate = Promise.withResolvers();
      const originalSync = r.runtime.sync;
      let holderOpen = false, rollbackHeld = false, waveHeld = false, stopped = false, publishing, settled = false, audit;
      try {
        await holder.query('BEGIN'); holderOpen = true; await holder.query('SELECT session_id FROM sessions WHERE session_id=$1 FOR SHARE', [r.sessionId]);
        audit = plaAuditProgress(r.database.pool, { after: async entry => {
          if (entry.sql === 'ROLLBACK' && !rollbackHeld) { rollbackHeld = true; await rollbackGate.promise; }
        } });
        r.runtime.sync = async function (...args) {
          const result = await originalSync.apply(this, args);
          if (!waveHeld) { waveHeld = true; await waveGate.promise; }
          return result;
        };
        publishing = r.flush({ progressLock: 'try', isStopped: () => stopped });
        void publishing.then(() => { settled = true; }, () => { settled = true; });
        await until(() => rollbackHeld, 'busy branch must actually complete ROLLBACK before its response is held');
        const rollback = audit.events.find(event => event.sql === 'ROLLBACK');
        assert.equal(rollback.returned, true); assert.equal(rollback.settled, false);
        assert.equal((await r.flush()).busy, true, 'unsettled rollback call still belongs to G and its original owner');
        await holder.query('ROLLBACK'); holderOpen = false;
        const head = await r.append(); await until(() => waveHeld, 'a new committed H must enter W while original G is still awaiting its rollback result');
        rollbackGate.resolve(); await until(() => rollback.settled, 'the rollback call must really settle');
        await plaEventTurn(); await plaEventTurn();
        assert.equal(settled, false, 'settled final G cannot stand in for the existing W result');
        assert.equal((await r.flush()).busy, true);
        assert.equal(audit.events.filter(event => event.sql === PLA_TRY_SQL).length, 1, 'G2 cannot overtake an unsettled W');
        waveGate.resolve(); const result = await publishing;
        assert.equal(result.examined, count); assert.equal(result.published, count - 1);
        assert.deepEqual(await plaProgressRows(r, [...old, head]), old.map((through_seq, index) => ({ through_seq,
          status: index === 0 ? 'Pending' : 'Published', attempts: index === 0 ? 0 : 1 }))
          .concat([{ through_seq: head, status: 'Pending', attempts: 0 }]), 'new H was supplied but never appended to this finite P');
      } finally {
        stopped = true; rollbackGate.resolve(); waveGate.resolve();
        if (holderOpen) await holder.query('ROLLBACK').catch(() => {});
        await publishing?.catch(() => {}); holder.release(); r.runtime.sync = originalSync; await audit?.restore();
      }
    });
  }
});

test('PLA-08：try 取得锁后仍重核真实安装 pending，不以旧覆盖登记 Published', { timeout: 15000 }, async t => {
  const r = await room(t), through = await r.append(); await Promise.all(r.peers.map(r.query));
  const progressGate = Promise.withResolvers(), hold = holdNextInstallation(r.runtime), audit = plaAuditProgress(r.database.pool);
  let entered = false, installationHeld = false, publishing, subscribing;
  void hold.entered.then(() => { installationHeld = true; });
  r.runtime.hooks.duringPublish = async () => { if (!entered) { entered = true; await progressGate.promise; } };
  try {
    publishing = r.flush({ progressLock: 'try' }); await until(() => entered, 'try G must pass its initial ready check');
    subscribing = r.rpc(r.peers[0], 'session.subscribe', { sessionId: r.sessionId }); void subscribing.catch(() => {});
    await until(() => installationHeld, 'real subscribe must be held after its COMMIT, before installation');
    assert.equal(r.runtime.pendingViewInstallation(r.peers[0].handle), true);
    progressGate.resolve(); const result = await publishing;
    assert.equal(result.published, 0);
    assert.deepEqual(await plaProgressRows(r, [through]), [{ through_seq: through, status: 'Pending', attempts: 0 }]);
    assert(audit.events.some(event => event.sql === PLA_TRY_SQL && event.returned && event.code === null), 'this is successful lock acquisition, not a busy-only test');
    assert(audit.events.some(event => event.sql === 'COMMIT' && event.returned));
    assert(!audit.events.some(event => typeof event.sql === 'string' && event.sql.startsWith('UPDATE outbox SET')));
    hold.release(); validateSpatial('SnapshotV2', await subscribing); delete r.runtime.hooks.duringPublish;
    await r.flush({ progressLock: 'try' });
    assert.deepEqual(await plaProgressRows(r, [through]), [{ through_seq: through, status: 'Published', attempts: 1 }]);
  } finally {
    progressGate.resolve(); hold.restore();
    await Promise.allSettled([publishing, subscribing].filter(Boolean));
    delete r.runtime.hooks.duringPublish; await audit.restore();
  }
});

test('PLA-01：mixed 读者即使显式请求 try，仍走原阻塞式进度入口', { timeout: 15000 }, async t => {
  const r = await room(t, { count: 3, mixed: true }), through = await r.append();
  const holder = await r.database.pool.connect(); let holderOpen = false, publishing, settled = false;
  const audit = plaAuditProgress(r.database.pool, { allowLegacy: () => holderOpen });
  r.runtime.hooks.duringPublish = async () => {
    if (holderOpen) return;
    await holder.query('BEGIN'); holderOpen = true;
    await holder.query('SELECT session_id FROM sessions WHERE session_id=$1 FOR SHARE', [r.sessionId]);
  };
  try {
    publishing = r.flush({ progressLock: 'try' }); void publishing.then(() => { settled = true; }, () => { settled = true; });
    await until(async () => {
      const entry = audit.events.find(event => event.sql === PLA_LEGACY_SQL && !event.returned);
      return !!entry && await plaActuallyWaiting(r.database.pool, entry.pid, PLA_LEGACY_SQL);
    }, 'mixed progress must actually queue its original SELECT * FOR UPDATE');
    assert.equal(settled, false);
    assert(!audit.events.some(event => event.sql === PLA_TRY_SQL));
    await holder.query('ROLLBACK'); holderOpen = false;
    assert.equal((await publishing).published, 1);
    assert.deepEqual(await plaProgressRows(r, [through]), [{ through_seq: through, status: 'Published', attempts: 1 }]);
  } finally {
    if (holderOpen) await holder.query('ROLLBACK').catch(() => {});
    await publishing?.catch(() => {}); holder.release(); delete r.runtime.hooks.duringPublish; await audit.restore();
  }
});
