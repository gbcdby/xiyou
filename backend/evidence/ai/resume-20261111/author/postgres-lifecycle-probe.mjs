import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import EmbeddedPostgres from 'embedded-postgres';
import { startTestPostgres } from '../../backend/test-support/postgres.mjs';

const name = process.argv[2];
assert.match(name, /^(baseline|fixed)$/);
const events = []; const errors = []; let database;
const record = (kind, detail = {}) => events.push({ kind, elapsedMs: performance.now(), ...detail });
const originalStop = EmbeddedPostgres.prototype.stop;
EmbeddedPostgres.prototype.stop = async function (...args) {
  record('postgres.stop.begin');
  const result = await originalStop.apply(this, args);
  record('postgres.stop.end');
  return result;
};
try {
  database = await startTestPostgres(`lifecycle-${name}`);
  const clients = await Promise.all([database.pool.connect(), database.pool.connect()]);
  const releases = []; const ended = [];
  clients.forEach((client, index) => {
    ended.push(new Promise(resolve => client.once('end', () => { record('client.end', { index }); resolve(); })));
    const originalEnd = client.end.bind(client);
    let release; const gate = new Promise(resolve => { release = resolve; }); releases.push(release);
    client.end = callback => {
      record('client.end.requested', { index });
      if (callback) { gate.then(() => originalEnd(callback)); return; }
      return gate.then(() => originalEnd());
    };
    client.release();
  });
  database.pool.on('error', error => {
    const observed = { code: error.code ?? error.name, message: error.message };
    errors.push(observed); record('pool.error', observed);
  });
  const poolEnd = database.pool.end.bind(database.pool);
  database.pool.end = async () => {
    record('pool.end.begin');
    await poolEnd(); record('pool.end.resolved');
    // 精确在 Pool 兑现之后放行真实连接终止；没有固定时间延迟。
    for (const release of releases) release();
  };
  await database.stop();
  await Promise.all(ended);
  const postgresLog = await readFile(new URL(`file://${database.output}/postgres.log`), 'utf8');
  const result = { name, events, errors, databaseOutput: database.output, pgShutdownComplete: postgresLog.includes('database system is shut down') };
  await writeFile(new URL(`./postgres-lifecycle-${name}.json`, import.meta.url), JSON.stringify(result, null, 2) + '\n');
  const stopping = events.findIndex(event => event.kind === 'postgres.stop.begin');
  const closed = events.map((event, index) => event.kind === 'client.end' ? index : -1).filter(index => index >= 0);
  assert.equal(closed.length, 2);
  assert.ok(closed.every(index => index < stopping), '数据库快停发生在真实连接结束之前');
  assert.deepEqual(errors, [], '记录到的 pool 错误必须使探针失败，不能被忽略');
  assert.equal(result.pgShutdownComplete, true);
  console.log(JSON.stringify({ name, result: 'PASS', events: events.map(event => event.kind) }));
} finally {
  EmbeddedPostgres.prototype.stop = originalStop;
  await database?.stop();
}
