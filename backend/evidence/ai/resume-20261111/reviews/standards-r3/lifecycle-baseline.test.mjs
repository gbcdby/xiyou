import test from 'node:test';
import assert from 'node:assert/strict';
import EmbeddedPostgres from 'embedded-postgres';
import { startTestPostgres } from './postgres-baseline.mjs';

test('真实 PostgreSQL：Pool 已兑现但连接尚未结束时，清理必须等待真实连接再停库', { timeout: 10000 }, async () => {
  const events = []; const errors = []; const releases = []; let database;
  const originalStop = EmbeddedPostgres.prototype.stop;
  EmbeddedPostgres.prototype.stop = async function (...args) {
    events.push('postgres.stop.begin');
    const result = await originalStop.apply(this, args);
    events.push('postgres.stop.end');
    return result;
  };
  try {
    database = await startTestPostgres('pool-lifecycle');
    const clients = await Promise.all([database.pool.connect(), database.pool.connect()]);
    const ended = clients.map((client, index) => {
      const closed = new Promise(resolve => client.once('end', () => { events.push(`client.${index}.end`); resolve(); }));
      const originalEnd = client.end.bind(client);
      let release; const gate = new Promise(resolve => { release = resolve; }); releases.push(release);
      client.end = callback => {
        events.push(`client.${index}.end.requested`);
        if (callback) { gate.then(() => originalEnd(callback)); return; }
        return gate.then(() => originalEnd());
      };
      client.release();
      return closed;
    });
    // 只在测试中汇总错误并在清理后断言为空；实际错误仍使整个测试失败。
    database.pool.on('error', error => errors.push({ code: error.code ?? error.name, message: error.message }));
    const poolEnd = database.pool.end.bind(database.pool);
    database.pool.end = async () => {
      await poolEnd(); events.push('pool.end.resolved');
      // 用明确门闩控制结束时序，不用固定 sleep 猜测连接是否已经关闭。
      for (const release of releases) release();
    };
    const stopping = database.stop();
    await stopping;
    await Promise.all(ended);
    const poolFinished = events.indexOf('pool.end.resolved');
    const serverStopping = events.indexOf('postgres.stop.begin');
    for (const index of [0, 1]) {
      const clientEnded = events.indexOf(`client.${index}.end`);
      assert.ok(poolFinished < clientEnded, '探针必须覆盖 Pool 已结束但真实连接仍在收束的窗口');
      assert.ok(clientEnded < serverStopping, '所有已接入连接必须先结束，再停止真实 PostgreSQL');
    }
    assert.deepEqual(errors, []);
    await database.stop();
    assert.equal(events.filter(event => event === 'postgres.stop.begin').length, 1);
  } finally {
    for (const release of releases) release();
    try { await database?.stop(); }
    finally { EmbeddedPostgres.prototype.stop = originalStop; }
  }
});
