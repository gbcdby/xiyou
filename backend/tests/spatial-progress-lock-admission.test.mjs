import test from 'node:test';
import assert from 'node:assert/strict';
import { room, until } from '../test-support/spatial-supply-room.mjs';

// 仅记录 Promise 获取的真实 client；callback 型 pool.query 沿原实现。
function observeProgress(pool) {
  const connect = pool.connect, events = [];
  pool.connect = function (...args) {
    if (args.some(value => typeof value === 'function')) return connect.apply(this, args);
    return connect.apply(this, args).then(client => {
      const query = client.query, release = client.release;
      let progress = false;
      client.query = async function (...queryArgs) {
        const sql = queryArgs[0];
        progress ||= typeof sql === 'string' && sql.startsWith('SELECT session_id FROM sessions WHERE session_id=$1 FOR UPDATE');
        const entry = progress ? { sql, returned: false, code: null } : null;
        if (entry) events.push(entry);
        try { const result = await query.apply(this, queryArgs); if (entry) entry.returned = true; return result; }
        catch (error) { if (entry) { entry.returned = true; entry.code = error.code; } throw error; }
      };
      client.release = function (...releaseArgs) {
        client.query = query; client.release = release;
        if (progress) events.push({ release: true, discarded: !!releaseArgs[0] });
        return release.apply(this, releaseArgs);
      };
      return client;
    });
  };
  return { events, restore() { pool.connect = connect; } };
}

test('PLA-02：try 碰真实共享锁后回滚保留 Pending，释放后默认 wait 可登记', { timeout: 15000 }, async t => {
  const r = await room(t), through = await r.append();
  await Promise.all(r.peers.map(r.query));
  const before = await r.pending(), holder = await r.database.pool.connect();
  await holder.query('BEGIN');
  await holder.query('SELECT session_id FROM sessions WHERE session_id=$1 FOR SHARE', [r.sessionId]);
  const audit = observeProgress(r.database.pool);
  let publishing, settled = false, beforeCommit = 0, afterCommit = 0, unlocked = false;
  r.runtime.hooks.beforeCommit = ({ command }) => { if (command === 'outbox-progress') beforeCommit++; };
  r.runtime.hooks.afterCommit = ({ command }) => { if (command === 'outbox-progress') afterCommit++; };
  try {
    publishing = r.flush({ progressLock: 'try' });
    void publishing.then(() => { settled = true; }, () => { settled = true; });
    await until(() => audit.events.length > 0, '进度锁 SELECT 必须实际开始');
    await until(() => settled, 'try G 必须在旧共享持锁者仍在途时结束，不能排队等待其释放');
    assert.deepEqual(await publishing, { busy: false, examined: 1, published: 0 });
    assert.deepEqual(await r.pending(), before);
    assert.equal(beforeCommit, 0); assert.equal(afterCommit, 0);
    assert.deepEqual(audit.events, [
      { sql: 'SELECT session_id FROM sessions WHERE session_id=$1 FOR UPDATE NOWAIT', returned: true, code: '55P03' },
      { sql: 'ROLLBACK', returned: true, code: null },
      { release: true, discarded: false },
    ], '真实回滚完成且client释放后才结束，不能吞错继续UPDATE');
    const laterReader = await r.database.pool.connect();
    try {
      await laterReader.query("SET lock_timeout='1000ms'");
      assert.equal((await laterReader.query('SELECT session_id FROM sessions WHERE session_id=$1 FOR SHARE', [r.sessionId])).rowCount, 1,
        '已退出的 try G 不能继续挡住后来的兼容共享读');
    } finally { laterReader.release(); }
    await holder.query('ROLLBACK'); unlocked = true;
    const fallback = await r.flush();
    assert.equal(fallback.published, 1);
    assert.deepEqual((await r.database.pool.query('SELECT status,attempts FROM outbox WHERE session_id=$1 AND through_seq=$2', [r.sessionId, through])).rows,
      [{ status: 'Published', attempts: 1 }]);
    assert.equal(beforeCommit, 1); assert.equal(afterCommit, 1);
    assert(audit.events.some(entry => entry.sql === 'SELECT session_id FROM sessions WHERE session_id=$1 FOR UPDATE' && entry.returned));
  } finally {
    if (!unlocked) await holder.query('ROLLBACK');
    await publishing?.catch(() => {});
    holder.release(); audit.restore();
    delete r.runtime.hooks.beforeCommit; delete r.runtime.hooks.afterCommit;
  }
});
