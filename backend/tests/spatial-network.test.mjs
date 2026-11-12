import test from 'node:test';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { startTestPostgres } from '../test-support/postgres.mjs';
import { createAuthorityServer } from '../server.mjs';
import { MovementCommandSource, validateSpatial } from '../../protocol/spatial.mjs';
test('真实HTTP和Socket.IO：五个独立客户端移动、权威批次、能力提示、接管和原回执', async (t) => {
    const database = await startTestPostgres('spatial-network', { outputSubdirectory: 'space' });
    let server;
    const sockets = [];
    t.after(async () => {
        for (const socket of sockets)
            socket.disconnect();
        await server?.close();
        await database.stop();
    });
    let clock = Date.parse('2026-11-12T08:00:00.000Z');
    server = await createAuthorityServer({ pool: database.pool, now: () => clock });
    const address = await server.listen(0), origin = `http://127.0.0.1:${address.port}`;
    const caps = ['spatial-v2'];
    async function http(path, token, body, headers = {}) { const response = await fetch(origin + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: response.status, body: await response.json() }; }
    async function connect(token, capabilities = caps) { const socket = io(origin, { auth: { token, capabilities }, transports: ['websocket'], reconnection: false }); sockets.push(socket); await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); }); return socket; }
    const rpc = (socket, event, value) => socket.timeout(5000).emitWithAck(event, value);
    const users = [];
    for (let i = 0; i < 5; i++)
        users.push((await http('/auth/guest', null, { name: `网络玩家${i + 1}` })).body);
    const upgrade = await http('/sessions', users[0].token, { nonce: 'old-create', contentVersion: 'spatial-graybox-v2' });
    assert.equal(upgrade.status, 426);
    assert.equal(upgrade.body.code, 'UPGRADE_REQUIRED');
    const created = await http('/sessions', users[0].token, { nonce: 'create', contentVersion: 'spatial-graybox-v2', capabilities: caps });
    assert.equal(created.status, 200);
    const { sessionId } = created.body;
    assert.deepEqual(Object.keys(created.body), ['sessionId']);
    for (const user of users) {
        const joined = await http(`/sessions/${sessionId}/join`, user.token, { nonce: 'join', capabilities: caps });
        assert.deepEqual(joined.body, { sessionId });
    }
    const listed = (await http('/sessions', users[0].token)).body.find(x => x.sessionId === sessionId);
    assert.equal(listed.protocolCapability, 'spatial-v2');
    assert.equal(listed.contentVersion, 'spatial-graybox-v2');
    await http(`/sessions/${sessionId}/start`, users[0].token, { nonce: 'start' });
    assert.equal((await http(`/sessions/${sessionId}`, users[0].token)).status, 426);
    const oldSocket = await connect(users[0].token, []);
    assert.equal((await rpc(oldSocket, 'session.subscribe', { sessionId })).code, 'UPGRADE_REQUIRED');
    const clients = [];
    for (const user of users) {
        const socket = await connect(user.token), snapshot = await rpc(socket, 'session.subscribe', { sessionId });
        validateSpatial('SnapshotV2', snapshot);
        const control = await rpc(socket, 'control.resume', JSON.stringify({ schemaVersion: 2, type: 'control.resume', sessionId, viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, nonce: 'resume' }));
        validateSpatial('ControlResponseV2', control);
        clients.push({ socket, snapshot: control.snapshot, source: new MovementCommandSource(control.controlEpoch) });
    }
    const requests = clients.map((c, i) => JSON.stringify({ schemaVersion: 2, sessionId, viewId: c.snapshot.viewId, actorRef: c.snapshot.projection.self.entityRef, clientActionId: `move-${i}`, controlEpoch: c.snapshot.projection.self.controlEpoch, baseSeq: c.snapshot.snapshotSeq, action: c.source.move('gray-yard', { x: 200 + i * 15, y: 80 }) }));
    const receipts = await Promise.all(clients.map((c, i) => rpc(c.socket, 'player.action.request', requests[i])));
    receipts.forEach(r => { validateSpatial('ReceiptV2', r); assert.equal(r.status, 'Accepted'); });
    clock += 500;
    await server.runtime.maintenance(sessionId);
    for (let i = 0; i < clients.length; i++) {
        const c = clients[i];
        const batch = await rpc(c.socket, 'sync.request', JSON.stringify({ schemaVersion: 2, type: 'sync.request', sessionId, viewId: c.snapshot.viewId, cursor: c.snapshot.snapshotSeq }));
        validateSpatial('BatchV2', batch);
        assert.ok(BigInt(batch.throughSeq) > BigInt(c.snapshot.snapshotSeq));
        const projection = batch.events.at(-1).payload.projection;
        assert.notDeepEqual(projection.self.position, { x: 100 + i * 20, y: 100 });
        assert.ok(!JSON.stringify(batch).includes('characterId'));
    }
    clock += 2000;
    await server.runtime.maintenance(sessionId);
    for (let i = 0; i < users.length; i++) {
        const snapshot = (await http(`/sessions/${sessionId}`, users[i].token, undefined, { 'X-Xiyou-Capabilities': 'spatial-v2' })).body;
        validateSpatial('SnapshotV2', snapshot);
        assert.deepEqual(snapshot.projection.self.position, { x: 200 + i * 15, y: 80 });
        assert.equal(snapshot.projection.movement.status, 'arrived');
    }
    assert.deepEqual((await http(`/sessions/${sessionId}/actions/move-0`, users[0].token)).body, receipts[0]);
    assert.equal((await rpc(clients[0].socket, 'player.action.request', requests[0].replace('"schemaVersion":2', '"schemaVersion":2,"schemaVersion":2'))).code, 'INVALID_MESSAGE');
    const replacement = await connect(users[0].token), s = await rpc(replacement, 'session.subscribe', { sessionId }), controlRequest = { schemaVersion: 2, type: 'control.resume', sessionId, viewId: s.viewId, actorRef: s.projection.self.entityRef, nonce: 'new-resume' };
    assert.equal((await rpc(replacement, 'control.resume', JSON.stringify(controlRequest))).code, 'CONTROL_HELD');
    const disconnected = new Promise(resolve => clients[0].socket.once('disconnect', resolve));
    const taken = await rpc(replacement, 'control.take', JSON.stringify({ ...controlRequest, type: 'control.take', nonce: 'take' }));
    validateSpatial('ControlResponseV2', taken);
    await disconnected;
    assert.ok(BigInt(taken.controlEpoch) > BigInt(clients[0].snapshot.projection.self.controlEpoch));
    assert.deepEqual(await rpc(replacement, 'player.action.request', requests[0]), receipts[0]);
    const unknown = JSON.parse(requests[0]);
    unknown.clientActionId = 'unknown-old';
    unknown.action.movementCommandSeq = '9999';
    assert.equal((await rpc(replacement, 'player.action.request', JSON.stringify(unknown))).code, 'STALE_CONTROL');
    const newSource = new MovementCommandSource(taken.controlEpoch);
    assert.equal((await rpc(replacement, 'player.action.request', JSON.stringify({ schemaVersion: 2, sessionId, viewId: taken.snapshot.viewId, actorRef: taken.snapshot.projection.self.entityRef, clientActionId: 'new-stop', controlEpoch: taken.controlEpoch, baseSeq: taken.observedSeq, action: newSource.stop() }))).status, 'Accepted');
    assert.deepEqual(await server.runtime.replay(sessionId), (await database.pool.query('SELECT state FROM sessions WHERE session_id=$1', [sessionId])).rows[0].state);
});
test('真实HTTP和Socket.IO：房主先订阅Lobby、队友随后加入，两端控制后开局无需更换视图', async (t) => {
    const database = await startTestPostgres('spatial-lobby', { outputSubdirectory: 'space' });
    const server = await createAuthorityServer({ pool: database.pool });
    const sockets = [];
    t.after(async () => {
        for (const socket of sockets)
            socket.disconnect();
        await server.close();
        await database.stop();
    });
    const address = await server.listen(0), origin = `http://127.0.0.1:${address.port}`, capabilities = ['spatial-v2'];
    const http = async (path, token, body) => { const response = await fetch(origin + '/api' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }); assert.equal(response.status, 200); return response.json(); };
    const connect = async (token) => { const socket = io(origin, { auth: { token, capabilities }, transports: ['websocket'], reconnection: false }); sockets.push(socket); await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); }); return socket; };
    const rpc = (socket, event, value) => socket.timeout(5000).emitWithAck(event, value);
    const host = await http('/auth/guest', null, { name: '先进入大厅的房主' }), guest = await http('/auth/guest', null, { name: '后来进入的队友' });
    const { sessionId } = await http('/sessions', host.token, { nonce: 'create-lobby', contentVersion: 'spatial-graybox-v2', capabilities });
    const first = await connect(host.token), firstLobby = await rpc(first, 'session.subscribe', { sessionId });
    validateSpatial('SnapshotV2', firstLobby);
    assert.equal(firstLobby.projection.phase, 'Lobby');
    await http(`/sessions/${sessionId}/join`, guest.token, { nonce: 'join-later', capabilities });
    const joined = await rpc(first, 'sync.request', JSON.stringify({ schemaVersion: 2, type: 'sync.request', sessionId, viewId: firstLobby.viewId, cursor: firstLobby.snapshotSeq }));
    validateSpatial('BatchV2', joined);
    assert.equal(joined.events.at(-1).payload.projection.entities.length, 2);
    const second = await connect(guest.token), secondLobby = await rpc(second, 'session.subscribe', { sessionId });
    const controls = [];
    for (const [socket, snapshot] of [[first, firstLobby], [second, secondLobby]]) {
        const response = await rpc(socket, 'control.resume', JSON.stringify({ schemaVersion: 2, type: 'control.resume', sessionId, viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, nonce: 'lobby-control' }));
        validateSpatial('ControlResponseV2', response);
        controls.push(response);
    }
    await http(`/sessions/${sessionId}/start`, host.token, { nonce: 'start-from-lobby' });
    for (let i = 0; i < 2; i++) {
        const request = JSON.stringify({ schemaVersion: 2, type: 'sync.request', sessionId, viewId: controls[i].snapshot.viewId, cursor: controls[i].snapshot.snapshotSeq });
        const batch = await rpc([first, second][i], 'sync.request', request);
        validateSpatial('BatchV2', batch);
        assert.equal(batch.viewId, controls[i].snapshot.viewId);
        const p = batch.events.at(-1).payload.projection;
        assert.equal(p.phase, 'Running');
        assert.equal(p.paused, false);
        assert.equal(p.entities.length, 3);
        assert.ok(p.items.length >= 2);
        assert.equal(p.targets.length, 1);
        assert.equal(p.cooperations[0].operationVersion, '0');
        assert.equal(p.cooperations[0].readyCount, 0);
        assert.equal(p.cooperations[0].requiredCount, 2);
        assert.equal(p.cooperations[0].anchors.length, 2);
        assert.deepEqual(p.targets[0].availableOperations, []);
        assert.ok(!JSON.stringify(batch).includes('characterId'));
        const repeat = await rpc([first, second][i], 'sync.request', request);
        assert.equal(repeat.events.at(-1).eventId, batch.events.at(-1).eventId);
    }
});
