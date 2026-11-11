import pg from 'pg';
import { createAuthorityServer } from './server.mjs';

if (!process.env.DATABASE_URL) throw new Error('请通过 DATABASE_URL 指定真实 PostgreSQL 数据库。');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 16 });
const server = await createAuthorityServer({ pool, log: (message, fields) => console.error(message, fields ?? {}) });
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT 必须为有效端口。');
const address = await server.listen(port, process.env.HOST ?? '127.0.0.1');
console.log(`权威服务已启动，监听端口 ${address.port}。`);
let closing = false;
async function close() {
  if (closing) return; closing = true;
  await server.close(); await pool.end();
  console.log('权威服务及数据库连接已关闭。');
}
process.once('SIGINT', () => close().catch(() => { process.exitCode = 1; }));
process.once('SIGTERM', () => close().catch(() => { process.exitCode = 1; }));
