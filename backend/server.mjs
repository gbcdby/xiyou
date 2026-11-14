import { createServer } from 'node:http';
import { parseRecapQuery } from './recap.mjs';
import { Server as SocketServer } from 'socket.io';
import { parseStrictJSON } from '../protocol/index.mjs';
import { createRuntime } from './runtime.mjs';
import { RuntimeError, errorResponse } from './errors.mjs';
import {attachScenePolicies} from './scene-policy-runtime.mjs';

const exact = (value, keys, optional = []) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => ![...keys, ...optional].includes(key)) || !keys.every(key => Object.hasOwn(value, key))) throw new RuntimeError('INVALID_MESSAGE', '消息字段不完整或含未知字段。');
  return value;
};
async function readBody(request, keys, optional = []) {
  let length = 0; const parts = [];
  for await (const part of request) { length += part.length; if (length > 65536) throw new RuntimeError('INVALID_MESSAGE', '请求内容过大。'); parts.push(part); }
  let raw;
  try { raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)); }
  catch { throw new RuntimeError('INVALID_MESSAGE', '请求必须是有效的 UTF-8 JSON。'); }
  return exact(parseStrictJSON(raw), keys, optional);
}
function tokenOf(request) {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) throw new RuntimeError('UNAUTHENTICATED', '请先登录。');
  return header.slice(7);
}
function respond(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
const statusOf = code => ({ INVALID_MESSAGE: 400, UNAUTHENTICATED: 401, FORBIDDEN: 403, SESSION_GONE: 410, ACTION_ID_REUSE: 409, CONTROL_HELD: 409, RESYNC_REQUIRED: 409, STALE_REFERENCE: 409, UPGRADE_REQUIRED: 426, OUTCOME_UNKNOWN: 503 })[code] ?? 503;

/** 单体 HTTP + Socket.IO 适配器；所有世界写入复用 AuthorityRuntime。 */
export async function createAuthorityServer({ pool, now, hooks, log = () => {} } = {}) {
  const runtime = await createRuntime({ pool, now, hooks });
  const scenePolicy = await attachScenePolicies({runtime,log});
  const tasks = new Set(); const sockets = new Map();
  let stopped = false; let pulsing = false; let lastLegacyPulse = Date.now();
  function track(promise) { tasks.add(promise); promise.finally(() => tasks.delete(promise)).catch(() => {}); return promise; }
  const http = createServer((request, response) => {
    track((async () => {
      try {
        const url = new URL(request.url, 'http://localhost');
        const path = url.pathname;
        if (request.method === 'GET' && path === '/health') { await pool.query('SELECT 1'); return respond(response, 200, { status: 'ok' }); }
        if (request.method === 'POST' && path === '/api/auth/guest') return respond(response, 200, await runtime.guest(await readBody(request, ['name'])));
        const token = tokenOf(request);
        if (path === '/api/sessions' && request.method === 'GET') return respond(response, 200, await runtime.listSessions(token));
        if (path === '/api/sessions' && request.method === 'POST') return respond(response, 200, await runtime.create(token, await readBody(request, ['nonce', 'contentVersion'], ['capabilities'])));
        const match = path.match(/^\/api\/sessions\/([A-Za-z0-9_.:-]+)(?:\/(join|start|cancel|actions|recap)(?:\/([A-Za-z0-9_.:-]+))?)?$/);
        if (!match) throw new RuntimeError('INVALID_MESSAGE', '接口不存在。');
        const [, sessionId, operation, actionId] = match;
        if (request.method === 'GET' && !operation) return respond(response, 200, await runtime.snapshot(token, sessionId, String(request.headers['x-xiyou-capabilities'] ?? '').split(',').map(x => x.trim())));
        if (request.method === 'GET' && operation === 'recap' && !actionId) return respond(response, 200, await runtime.recap(token, sessionId, parseRecapQuery(url.searchParams)));
        if (request.method === 'GET' && operation === 'actions' && actionId) {
          const receipt = await runtime.receipt(token, sessionId, actionId);
          return respond(response, receipt ? 200 : 404, receipt ?? { schemaVersion: 1, code: 'OUTCOME_UNKNOWN', message: '尚无确定收据，请保留原动作身份继续查询或重试。' });
        }
        if (request.method === 'POST' && ['join', 'start', 'cancel'].includes(operation) && !actionId) return respond(response, 200, await runtime[operation](token, sessionId, await readBody(request, ['nonce'], operation === 'join' ? ['capabilities'] : [])));
        throw new RuntimeError('INVALID_MESSAGE', '接口不接受该请求。');
      } catch (error) {
        const dto = errorResponse(error);
        if (!response.headersSent) respond(response, statusOf(dto.code), dto);
        else response.end();
      }
    })());
  });
  const io = new SocketServer(http, { path: '/socket.io', maxHttpBufferSize: 131072, serveClient: false });
  io.use((socket, next) => {
    track((async () => {
      try {
        const auth = exact(socket.handshake.auth, ['token'], ['capabilities']);
        if (auth.capabilities !== undefined && (!Array.isArray(auth.capabilities) || auth.capabilities.length > 8 || auth.capabilities.some(c => !['region-v1', 'spatial-v2', 'spatial-appearance-v1', 'spatial-object-visual-v1'].includes(c)))) throw new RuntimeError('INVALID_MESSAGE', '客户端能力格式无效。');
        socket.data.handle = await runtime.openConnection(auth.token, auth.capabilities ?? []);
        next();
      } catch (error) {
        const failure = new Error('连接认证未通过。'); failure.data = errorResponse(error); next(failure);
      }
    })());
  });
  io.on('connection', socket => {
    const handle = socket.data.handle;
    sockets.set(handle.connectionId, socket);
    for (const [event, operation] of [
      ['session.subscribe', value => runtime.subscribe(handle, exact(value, ['sessionId']).sessionId)],
      ['player.action.request', value => runtime.submit(handle, value)],
      ['sync.request', value => runtime.sync(handle, value)],
      ['control.resume', value => control('control.resume', value)],
      ['control.take', value => control('control.take', value)],
    ]) {
      socket.on(event, (value, acknowledge) => {
        track((async () => {
          try { const result = await operation(value); if (typeof acknowledge === 'function') acknowledge(result); }
          catch (error) { if (typeof acknowledge === 'function') acknowledge(errorResponse(error)); }
        })());
      });
    }
    function control(type, raw) {
      if (typeof raw !== 'string' || parseStrictJSON(raw).type !== type) throw new RuntimeError('INVALID_MESSAGE', '控制请求与消息名称不一致。');
      return runtime.control(handle, raw);
    }
    socket.on('disconnect', () => {
      sockets.delete(handle.connectionId);
      track(runtime.disconnect(handle).catch(error => log('连接撤销暂未完成。', { code: errorResponse(error).code })));
    });
  });
  runtime.on('view-revoked', ({ connectionId }) => sockets.get(connectionId)?.disconnect(true));
  const pulse = async () => {
    if (stopped || pulsing) return;
    pulsing = true;
    try {
      const legacyDue = Date.now() - lastLegacyPulse >= 1000;
      if (legacyDue) lastLegacyPulse = Date.now();
      for (const socket of legacyDue ? sockets.values() : []) {
        try { await runtime.heartbeat(socket.data.handle); }
        catch { socket.disconnect(true); }
      }
      const rows = (await pool.query("SELECT session_id FROM sessions WHERE state->>'phase' IN ('Lobby','Running') AND ($1 OR state->>'protocolCapability'='spatial-v2')", [legacyDue])).rows;
      for (const row of rows) await runtime.maintenance(row.session_id);
      await runtime.publishPending(async (connectionId, batch) => { sockets.get(connectionId)?.emit('world.batch', batch); }, { capability: legacyDue ? null : 'spatial-v2' });
    } catch (error) { log('后台维护暂未完成，将保留原记录重试。', { code: errorResponse(error).code }); }
    finally { pulsing = false; }
  };
  const timer = setInterval(() => track(pulse()), 200); timer.unref();
  return {
    runtime, scenePolicy,
    async listen(port = 3000, host = '127.0.0.1') {
      await new Promise((resolve, reject) => { http.once('error', reject); http.listen(port, host, resolve); });
      return http.address();
    },
    async close() {
      if (stopped) return; stopped = true; clearInterval(timer);
      await scenePolicy.close();
      await new Promise(resolve => io.close(resolve));
      while (tasks.size) await Promise.allSettled([...tasks]);
      await runtime.close();
    },
  };
}
