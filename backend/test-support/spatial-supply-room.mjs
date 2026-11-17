import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Server } from 'socket.io';
import { io } from 'socket.io-client';
import { createRuntime } from '../runtime.mjs';
import { errorResponse } from '../errors.mjs';
import { enqueueSocketPacket } from '../socket-enqueue.mjs';
import { startTestPostgres } from './postgres.mjs';
import { validateSpatial } from '../../protocol/spatial.mjs';

export const capabilities = ['spatial-v2', 'spatial-direction-v1', 'spatial-timed-trail-v1'];
export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function until(check, message, timeout = 1000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await pause(5); }
  assert.fail(message);
}

export function holdNextInstallation(runtime) {
  const entered = Promise.withResolvers(), release = Promise.withResolvers(), original = runtime.stageSpatialView;
  let claimed = false, candidate;
  runtime.stageSpatialView = function (tx, handle, view, scope, ...rest) {
    original.call(this, tx, handle, view, scope, ...rest);
    if (claimed) return;
    claimed = true; candidate = { handle, view, scope };
    const index = tx.afterCommit.length - 1, install = tx.afterCommit[index];
    tx.afterCommit[index] = async () => { entered.resolve(); await release.promise; return install(); };
  };
  return { entered: entered.promise, release: release.resolve, candidate: () => candidate,
    restore() { release.resolve(); runtime.stageSpatialView = original; } };
}

/** 真实PG与Socket.IO；只隔离后台定时器，授权、共享lane、完整DTO入队仍调用生产实现。 */
export async function room(t, { count = 2, mixed = false } = {}) {
  const database = await startTestPostgres('supply-wave', { outputSubdirectory: 'supply-wave-implement' });
  const runtime = await createRuntime({ pool: database.pool, now: () => Date.parse('2026-11-17T09:00:00Z'), spatialDirection: { checkpointMs: 50 } });
  const http = createServer(), server = new Server(http, { serveClient: false }), sockets = new Map(), peers = [], tasks = new Set();
  const track = promise => { tasks.add(promise); promise.finally(() => tasks.delete(promise)).catch(() => {}); return promise; };
  server.use((socket, next) => { track(runtime.openConnection(socket.handshake.auth.token, socket.handshake.auth.capabilities)
    .then(handle => { socket.data.handle = handle; next(); }, next)); });
  const enqueue = (handle, binding, value, kind, send) => enqueueSocketPacket({ sockets, handle, binding, value, kind, send,
    current: () => runtime.spatialSupply.current(handle, binding) });
  server.on('connection', socket => {
    const handle = socket.data.handle; sockets.set(handle.connectionId, socket);
    for (const event of ['session.subscribe', 'control.resume', 'control.take', 'sync.request']) socket.on(event, (value, ack) => {
      track((async () => {
        const send = (result, binding) => enqueue(handle, binding, result, 'ack', () => ack(result));
        try {
          if (event === 'sync.request' && runtime.spatialSupply.enabled(handle)) return await runtime.spatialSupply.sync(handle, value, send);
          const result = event === 'session.subscribe' ? await runtime.subscribe(handle, value.sessionId)
            : event === 'sync.request' ? await runtime.sync(handle, value) : await runtime.control(handle, value);
          if (runtime.spatialSupply.enabled(handle)) runtime.spatialSupply.snapshot(handle, result, send); else ack(result);
        } catch (error) { ack(errorResponse(error)); }
      })());
    });
    socket.on('disconnect', () => { sockets.delete(handle.connectionId); track(runtime.disconnect(handle)); });
  });
  runtime.on('view-revoked', ({ connectionId }) => sockets.get(connectionId)?.disconnect(true));
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const peer of peers) peer.client.close();
    await new Promise(resolve => server.close(resolve));
    while (tasks.size) await Promise.allSettled([...tasks]);
    await runtime.close(); await database.stop();
  });
  const users = await Promise.all(['甲', '乙'].map(name => runtime.guest({ name })));
  const { sessionId } = await runtime.create(users[0].token, { nonce: crypto.randomUUID(), contentVersion: 'spatial-graybox-v2', capabilities });
  for (const user of users) await runtime.join(user.token, sessionId, { nonce: crypto.randomUUID(), capabilities });
  await runtime.start(users[0].token, sessionId, { nonce: crypto.randomUUID() });
  const rpc = (peer, event, value) => peer.client.timeout(5000).emitWithAck(event, value);
  const addPeer = async (caps = capabilities, userIndex = 0, resume = false) => {
    const connected = once(server, 'connection');
    const client = io(`http://127.0.0.1:${http.address().port}`, { transports: ['websocket'], reconnection: false,
      auth: { token: users[userIndex].token, capabilities: caps } });
    await once(client, 'connect'); const [socket] = await connected;
    const peer = { client, handle: socket.data.handle, socket, batches: [] }; peers.push(peer);
    client.on('world.batch', batch => peer.batches.push(batch));
    peer.snapshot = await rpc(peer, 'session.subscribe', { sessionId }); validateSpatial('SnapshotV2', peer.snapshot);
    if (resume) {
      const controlled = await rpc(peer, 'control.resume', JSON.stringify({ schemaVersion: 2, type: 'control.resume', sessionId,
        viewId: peer.snapshot.viewId, actorRef: peer.snapshot.projection.self.entityRef, nonce: crypto.randomUUID() }));
      validateSpatial('ControlResponseV2', controlled); peer.snapshot = controlled.snapshot;
    }
    return peer;
  };
  for (let index = 0; index < count; index++) await addPeer(mixed && index === count - 1 ? ['spatial-v2'] : capabilities, index === 1 ? 1 : 0, index < 2);
  const deliver = (connectionId, batch, binding) => binding
    ? enqueue(binding.handle, binding, batch, 'push', () => sockets.get(connectionId)?.emit('world.batch', batch))
    : sockets.get(connectionId)?.emit('world.batch', batch);
  const flush = options => runtime.publishPending(deliver, options);
  await flush();
  const append = (count = 1) => runtime.locked(sessionId, { kind: 'parallel-supply-fixture' }, tx => {
    for (let index = 0; index < count; index++) tx.emit('spatial.clock', { sceneTimeMs: tx.state.sceneTimeMs, wallAnchorMs: tx.state.wallAnchorMs, paused: tx.state.paused });
    return tx.state.sessionSeq;
  });
  const query = peer => rpc(peer, 'sync.request', JSON.stringify({ schemaVersion: 2, type: 'sync.request', sessionId,
    viewId: runtime.connectionView(peer.handle).viewId, cursor: runtime.spatialSupply.cursor(runtime.connectionView(peer.handle)) }));
  const control = peer => rpc(peer, 'control.take', JSON.stringify({ schemaVersion: 2, type: 'control.take', sessionId,
    viewId: runtime.connectionView(peer.handle).viewId, actorRef: peer.snapshot.projection.self.entityRef, nonce: crypto.randomUUID() }));
  const pending = () => database.pool.query("SELECT through_seq,status,attempts FROM outbox WHERE session_id=$1 AND status='Pending' ORDER BY through_seq", [sessionId]).then(result => result.rows);
  return { database, runtime, users, peers, sessionId, rpc, append, query, control, flush, pending, deliver, addPeer };
}

