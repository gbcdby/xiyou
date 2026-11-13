import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { createAuthorityServer } from './server.mjs';
import { attachSpatialAI } from './ai/spatial-runtime.mjs';
import { configuredGateway } from './ai/provider-config.mjs';

/** 默认服务不挑选供应商；此入口要求调用方明确提供并授权 Gateway 配置。 */
export async function createAIServer({ pool, gateway, now, hooks, maxConcurrent, minIntervalMs, maxCallsPerSession, log = () => {} }) {
  const server = await createAuthorityServer({ pool, now, hooks, log });
  let ai, closing;
  try { ai = await attachSpatialAI({ runtime: server.runtime, gateway, maxConcurrent, minIntervalMs, maxCallsPerSession, log }); }
  catch (error) { await server.close(); throw error; }
  return { runtime: server.runtime, ai, listen: (...args) => server.listen(...args), close() { return closing ??= (async () => { await ai.close(); await server.close(); })(); } };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('请通过 DATABASE_URL 指定真实 PostgreSQL 数据库。');
  if (!process.env.XIYOU_AI_CONFIG) throw new Error('缺少 XIYOU_AI_CONFIG，未启用任何模型供应商。');
  const { gateway, scheduling } = await configuredGateway(process.env.XIYOU_AI_CONFIG);
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 16 });
  let server, closing;
  const close = () => closing ??= (async () => { try { await server?.close(); } finally { await gateway.close(); await pool.end(); } })();
  try {
    server = await createAIServer({ pool, gateway, ...scheduling, log: (message, fields) => console.log(message, fields ?? {}) });
    const port = Number(process.env.PORT ?? 3000);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT 必须为有效端口。');
    const address = await server.listen(port, process.env.HOST ?? '127.0.0.1');
    console.log(`空间自主角色服务已启动，监听端口 ${address.port}。`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => close().catch(() => { process.exitCode = 1; }));
  } catch (error) { await close(); throw error; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error('空间自主角色服务未启动。', { code: error.code ?? 'START_FAILED', message: error.message }); process.exitCode = 1; });
