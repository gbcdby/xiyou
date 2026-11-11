import test from 'node:test';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createAuthorityServer } from '../server.mjs';
import { validateContract } from '../../protocol/index.mjs';

test('真实 HTTP/Socket.IO：前端接口、严格原文、真实连接控制和恢复查询', async t => {
  const database = await startTestPostgres('network');
  let server; const sockets = [];
  t.after(async () => { for (const socket of sockets) socket.disconnect(); await server?.close(); await database.stop(); });
  server = await createAuthorityServer({ pool: database.pool });
  const address = await server.listen(0);
  const origin = `http://127.0.0.1:${address.port}`;
  async function http(path, token, body, headers = {}) {
    const response = await fetch(`${origin}/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  async function connect(token) {
    const socket = io(origin, { auth: { token }, reconnection: false, transports: ['websocket'] }); sockets.push(socket);
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); }); return socket;
  }
  const rpc = (socket, event, payload) => socket.timeout(5000).emitWithAck(event, payload);
  assert.equal((await http('/sessions')).status, 401);
  assert.equal((await http('/sessions/nonexistent/actions/unknown', 'invalid-token')).status, 401);
  assert.equal((await http('/auth/guest', null, '{"name":"甲","name":"乙"}')).body.code, 'INVALID_MESSAGE');
  const users = [(await http('/auth/guest', null, { name: '甲' })).body, (await http('/auth/guest', null, { name: '乙' })).body];
  assert.equal((await http('/sessions/nonexistent/actions/unknown', users[0].token)).status, 410);
  const created = (await http('/sessions', users[0].token, { nonce: 'create', contentVersion: 'trust-repair-fixture-v1' })).body;
  assert.deepEqual((await http('/sessions', users[0].token, { nonce: 'create', contentVersion: 'trust-repair-fixture-v1' })).body, created);
  const sessionId = created.sessionId;
  const members = [];
  for (const user of users) members.push((await http(`/sessions/${sessionId}/join`, user.token, { nonce: 'join' })).body);
  assert.equal((await http(`/sessions/${sessionId}/join`, users[0].token, { nonce: 'join-again' })).body.actorId, members[0].actorId);
  assert.equal((await http('/sessions', users[0].token)).body.find(r => r.sessionId === sessionId).playerCount, 2);
  assert.equal((await http(`/sessions/${sessionId}/start`, users[0].token, { nonce: 'start' })).status, 200);
  const socket = await connect(users[0].token);
  const snapshot = await rpc(socket, 'session.subscribe', { sessionId }); validateContract('AuthorizedSnapshot', snapshot);
  assert.equal(snapshot.projection.self.canControl, false);
  const control = await rpc(socket, 'control.resume', JSON.stringify({ schemaVersion: 1, type: 'control.resume', sessionId, actorId: members[0].actorId, nonce: 'resume' })); validateContract('ControlResponse', control);
  const sync = await rpc(socket, 'sync.request', JSON.stringify({ schemaVersion: 1, type: 'sync.request', sessionId, viewId: snapshot.viewId, cursor: snapshot.snapshotSeq }));
  validateContract('WorldBatch', sync); assert.equal(sync.events.at(-1).payload.projection.self.canControl, true);
  const raw = JSON.stringify({ schemaVersion: 1, sessionId, actorId: members[0].actorId, clientActionId: 'move', controlEpoch: control.controlEpoch, baseSeq: sync.throughSeq, action: { kind: 'move', regionId: 'store' } });
  const receipt = await rpc(socket, 'player.action.request', raw); validateContract('ClientReceipt', receipt); assert.equal(receipt.status, 'Accepted');
  assert.deepEqual((await http(`/sessions/${sessionId}/actions/move`, users[0].token)).body, receipt);
  const unknown = await http(`/sessions/${sessionId}/actions/unseen`, users[0].token); assert.equal(unknown.status, 404); assert.equal(unknown.body.code, 'OUTCOME_UNKNOWN');
  const repeated = raw.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1');
  assert.equal((await rpc(socket, 'player.action.request', repeated)).code, 'INVALID_MESSAGE');
  assert.equal((await rpc(socket, 'player.action.request', JSON.parse(raw))).code, 'INVALID_MESSAGE');
  const httpSnapshot = (await http(`/sessions/${sessionId}`, users[0].token, undefined, { 'x-connection-id': socket.id })).body;
  assert.equal(httpSnapshot.projection.self.canControl, false);
  const replacement = await connect(users[0].token);
  await rpc(replacement, 'session.subscribe', { sessionId });
  assert.equal((await rpc(replacement, 'control.resume', JSON.stringify({ schemaVersion: 1, type: 'control.resume', sessionId, actorId: members[0].actorId, nonce: 'held' }))).code, 'CONTROL_HELD');
  const disconnected = new Promise(resolve => socket.once('disconnect', resolve));
  await rpc(replacement, 'control.take', JSON.stringify({ schemaVersion: 1, type: 'control.take', sessionId, actorId: members[0].actorId, nonce: 'take' }));
  await disconnected;
  assert.deepEqual(await rpc(replacement, 'player.action.request', raw), receipt);
  const bad = io(origin, { auth: { token: 'invalid-token' }, reconnection: false }); sockets.push(bad);
  const failure = await new Promise(resolve => bad.once('connect_error', resolve));
  assert.equal(failure.data.code, 'UNAUTHENTICATED'); validateContract('ErrorResponse', failure.data);
});
