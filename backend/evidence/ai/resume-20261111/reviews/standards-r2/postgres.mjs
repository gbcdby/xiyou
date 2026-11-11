import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { appendFile, mkdir, mkdtemp } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repository = fileURLToPath(new URL('../../', import.meta.url));

async function availablePort() {
  const reservation = createServer();
  await new Promise((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolve);
  });
  const port = reservation.address().port;
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  return port;
}

/** 每次检查创建独立的真实 PostgreSQL 集群；失败不退化为内存替身。 */
export async function startTestPostgres(label = 'runtime') {
  if (!/^[a-z0-9-]+$/.test(label)) throw new Error('测试名称只能包含小写字母、数字与连字符');
  const outputRoot = path.join(repository, '.agent-output', 'ai-standards-r2', 'postgres');
  await mkdir(outputRoot, { recursive: true });
  const output = await mkdtemp(path.join(outputRoot, label + '-'));
  const port = await availablePort();
  const password = randomBytes(24).toString('hex');
  let pendingLogs = Promise.resolve();
  const log = message => {
    pendingLogs = pendingLogs.then(() => appendFile(path.join(output, 'postgres.log'), String(message) + '\n'));
  };
  const server = new EmbeddedPostgres({
    databaseDir: path.join(output, 'data'),
    port,
    user: 'xiyou_test',
    password,
    authMethod: 'scram-sha-256',
    persistent: true,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: ['-h', '127.0.0.1', '-c', 'unix_socket_directories=', '-c', 'timezone=UTC', '-c', 'log_timezone=UTC'],
    onLog: log,
    onError: log,
  });
  await server.initialise();
  await server.start();
  const connection = { host: '127.0.0.1', port, user: 'xiyou_test', password, database: 'postgres' };
  const pool = new pg.Pool({ ...connection, max: 12 });
  let stopped = false;
  return {
    pool,
    connection,
    output,
    async stop() {
      if (stopped) return;
      stopped = true;
      await pool.end();
      await server.stop();
      await pendingLogs;
    },
  };
}
