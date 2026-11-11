import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { createAuthorityServer } from './server.mjs';
import { attachMockAI } from './ai/mock-runtime.mjs';

/** 与普通服务使用同一权威 Runtime，仅显式加上受控角色启动层。 */
export async function createMockServer({ pool, now, hooks, minIntervalMs, maxCallsPerSession, log = () => {} }) {
  const server = await createAuthorityServer({ pool, now, hooks, log });
  let ai;
  try { ai = await attachMockAI({ runtime: server.runtime, minIntervalMs, maxCallsPerSession, log }); }
  catch (error) { await server.close(); throw error; }
  let closing;
  return {
    runtime: server.runtime, ai,
    listen: (...args) => server.listen(...args),
    close() {
      return closing ??= (async () => {
        const results = await Promise.allSettled([ai.close(), server.close()]);
        const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
        if (failures.length) throw new AggregateError(failures, '模拟服务关闭未完整完成。');
      })();
    },
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('请通过 DATABASE_URL 指定真实 PostgreSQL 数据库。');
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT 必须为有效端口。');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 16 });
  const connectionEnds = new Set();
  pool.on('connect', client => {
    const ended = new Promise(resolve => client.once('end', resolve));
    connectionEnds.add(ended); ended.then(() => connectionEnds.delete(ended));
  });
  let server; let closing;
  const close = () => closing ??= (async () => {
    try { await server?.close(); }
    finally { await pool.end(); await Promise.all([...connectionEnds]); }
    process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal);
    console.log('模拟角色策略、权威服务及数据库连接已关闭。');
  })();
  function onSignal() { close().catch(() => { console.error('模拟服务关闭失败。'); process.exitCode = 1; }); }
  try {
    server = await createMockServer({ pool, log: (message, fields) => console.log(message, fields ?? {}) });
    const address = await server.listen(port, process.env.HOST ?? '127.0.0.1');
    console.log(`模拟角色策略：权威服务已启动，监听端口 ${address.port}。不调用外部模型。`);
    process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
  } catch (error) { await close(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  console.error('模拟服务未能启动。', { code: error.code ?? 'START_FAILED', message: error.message });
  process.exitCode = 1;
});
