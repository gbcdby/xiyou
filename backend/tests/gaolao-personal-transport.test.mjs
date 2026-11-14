import test from 'node:test';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { createAuthorityServer } from '../server.mjs';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { errorResponse, RuntimeError } from '../errors.mjs';

test('真实 HTTP/Socket 新能力提示一致，旧错误缺省与旧房间保留', async t => {
  const db = await startTestPostgres('personal-transport', { outputSubdirectory: 'cuilan-authority-implement' });
  const server = await createAuthorityServer({ pool: db.pool }), sockets = [];
  t.after(async () => { for (const socket of sockets) socket.disconnect(); await server.close(); await db.stop(); });
  const address = await server.listen(0), base = `http://127.0.0.1:${address.port}`;
  const guest = await server.runtime.guest({ name: '能力入口检查' });
  const post = async capabilities => fetch(`${base}/api/sessions`, { method: 'POST', headers: { authorization: `Bearer ${guest.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ nonce: crypto.randomUUID(), contentVersion: 'gaolaozhuang-scene-v3', capabilities }) });
  const missing = await post(['spatial-v2']); assert.equal(missing.status, 426);
  const error = await missing.json(); assert.equal(error.code, 'UPGRADE_REQUIRED'); assert.deepEqual(error.requiredCapabilities, ['spatial-v2', 'gaolao-personal-consent-v1']);
  const created = await post(['spatial-v2', 'gaolao-personal-consent-v1']); assert.equal(created.status, 200); const { sessionId } = await created.json();
  const read = await fetch(`${base}/api/sessions/${sessionId}`, { headers: { authorization: `Bearer ${guest.token}`, 'x-xiyou-capabilities': 'spatial-v2' } });
  assert.equal(read.status, 426); assert.deepEqual((await read.json()).requiredCapabilities, error.requiredCapabilities);
  for (const capabilities of [['spatial-v2'], ['spatial-v2', 'gaolao-personal-consent-v1']]) {
    const socket = io(base, { auth: { token: guest.token, capabilities }, transports: ['websocket'], reconnection: false, autoConnect: false }); sockets.push(socket);
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); socket.connect(); });
    const result = await new Promise((resolve, reject) => { socket.timeout(5000).emit('session.subscribe', { sessionId }, (error, value) => error ? reject(error) : resolve(value)); });
    if (capabilities.length === 1) { assert.equal(result.code, 'UPGRADE_REQUIRED'); assert.deepEqual(result.requiredCapabilities, error.requiredCapabilities); }
    else { assert.equal(result.projection.reducerVersion, 'gaolao-world-v2'); assert.deepEqual(result.projection.chapter.privateReturns, []); }
  }
  assert.deepEqual(errorResponse(new RuntimeError('UPGRADE_REQUIRED')).requiredCapabilities, ['spatial-v2']);
  const legacy = await server.runtime.create(guest.token, { nonce: crypto.randomUUID(), contentVersion: 'gaolaozhuang-scene-v2', capabilities: ['spatial-v2'] });
  assert.equal((await server.runtime.snapshot(guest.token, legacy.sessionId, ['spatial-v2'])).projection.reducerVersion, 'gaolao-world-v1');
});
