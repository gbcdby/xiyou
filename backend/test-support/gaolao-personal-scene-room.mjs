import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { loadContent } from '../../content/index.mjs';
import { parseSpatial, validateSpatial } from '../../protocol/spatial.mjs';
import { accepted } from './gaolao-room.mjs';
import { until } from './ai-room.mjs';

const capabilities = ['spatial-v2', 'gaolao-personal-consent-v1'];

/** 真实 HTTP/Socket 玩家与生产 scene 联合夹具；内部写 handle 仅给三个自主角色。 */
export async function personalSceneRoom(server, clock, version = 'gaolaozhuang-scene-v3', count = 2, { existing = null } = {}) {
  const content = await loadContent(version), address = await server.listen(0), origin = `http://127.0.0.1:${address.port}`;
  const sockets = [], users = [], actors = new Map(), serverHandles = new Map(), bindings = [], actions = [];
  const originalOpen = server.runtime.openConnection.bind(server.runtime);
  server.runtime.openConnection = async (token, ...args) => {
    const handle = await originalOpen(token, ...args); serverHandles.set(token, handle); return handle;
  };
  const rpc = (socket, event, payload) => socket.timeout(15000).emitWithAck(event, payload);
  const http = async (path, token, body) => {
    const response = await fetch(origin + '/api' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Xiyou-Capabilities': capabilities.join(','), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const raw = await response.text(), result = JSON.parse(raw);
    assert.equal(response.status, 200, raw);
    return result.type === 'world.snapshot' ? parseSpatial('SnapshotV2', raw) : result;
  };
  let sessionId;
  if (existing) {
    // 只重连真实旧账号/旧局；不创建会话、不重放剧情，也不接受权威状态输入。
    assert.deepEqual(Object.keys(existing).sort(), ['sessionId', 'users']);
    assert.equal(existing.users.length, count);
    users.push(...existing.users); sessionId = existing.sessionId;
  } else {
    for (let index = 0; index < count; index++) users.push(await http('/auth/guest', null, { name: `集成同行者${index + 1}` }));
    ({ sessionId } = await http('/sessions', users[0].token, { nonce: crypto.randomUUID(), contentVersion: version, capabilities }));
    for (const user of users) await http(`/sessions/${sessionId}/join`, user.token, { nonce: crypto.randomUUID(), capabilities });
    await http(`/sessions/${sessionId}/start`, users[0].token, { nonce: 'start' });
  }
  for (const [index, user] of users.entries()) {
    const socket = io(origin, { auth: { token: user.token, capabilities }, transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    const snapshot = await rpc(socket, 'session.subscribe', { sessionId });
    const controlled = await rpc(socket, 'control.resume', JSON.stringify({ schemaVersion: 2, type: 'control.resume', sessionId, viewId: snapshot.viewId, actorRef: snapshot.projection.self.entityRef, nonce: crypto.randomUUID() }));
    assert.equal(controlled.schemaVersion, 2, JSON.stringify(controlled));
    actors.set(index, { socket, token: user.token, internal: false, epoch: null, movementSeq: 0 });
  }
  for (const key of ['tang', 'wukong', 'bajie']) {
    const actorId = content.chapterRules.people[key], npc = content.npcs.find(row => row.characterId === actorId);
    assert.equal(npc.actorKind, key === 'bajie' ? 'chapter_autonomous' : 'persistent_core');
    const handle = await server.runtime.bindInternal(sessionId, actorId, 'core_npc');
    actors.set(key, { internal: true, handle }); bindings.push({ key, actorId });
  }
  const actorFor = key => { const actor = actors.get(key); assert.ok(actor, `夹具禁止控制或观察此角色：${key}`); return actor; };
  const snapshot = async key => {
    const actor = actorFor(key);
    return actor.internal ? server.runtime.observeInternal(actor.handle) : http(`/sessions/${sessionId}`, actor.token);
  };
  const send = async (key, action) => {
    const actor = actorFor(key);
    if (actor.internal) {
      const intentId = crypto.randomUUID();
      await server.runtime.reserveSpatialIntent(actor.handle, intentId, action);
      return server.runtime.submitSpatialIntent(actor.handle, intentId);
    }
    const current = await snapshot(key);
    const raw = JSON.stringify({ schemaVersion: 2, sessionId, viewId: current.viewId, actorRef: current.projection.self.entityRef, clientActionId: crypto.randomUUID(), controlEpoch: current.projection.self.controlEpoch, baseSeq: current.snapshotSeq, action });
    const receipt = await rpc(actor.socket, 'player.action.request', raw);
    actions.push({ player: key, raw, receipt });
    return receipt;
  };
  const sceneStatus = () => server.scenePolicy.status().actors.find(actor => actor.sessionId === sessionId);
  const drain = () => until(() => { const status = sceneStatus(); return status && status.phase === 'Idle' && !status.bootstrap && status.pendingSemanticSeq === '0'; }, '生产场景控制器须收束待办', 6000);
  const step = async (milliseconds = 1000) => {
    clock.value += milliseconds;
    for (const user of users) await server.runtime.heartbeat(serverHandles.get(user.token));
    await server.runtime.maintenance(sessionId); await drain();
  };
  const move = async (key, sceneId, destination) => {
    const actor = actorFor(key), current = await snapshot(key), action = { kind: 'move_to', sceneId, destination };
    if (!actor.internal) {
      if (actor.epoch !== current.projection.self.controlEpoch) { actor.epoch = current.projection.self.controlEpoch; actor.movementSeq = 0; }
      action.movementCommandSeq = String(++actor.movementSeq);
    }
    accepted(await send(key, action), `正常导航 ${key}`);
    for (let index = 0; index < 30; index++) {
      await step(); const projection = (await snapshot(key)).projection;
      validateSpatial('ProjectionV2', projection);
      if (projection.movement?.status === 'arrived') return projection;
      assert.ok(!['blocked', 'cancelled'].includes(projection.movement?.status), JSON.stringify(projection.movement));
    }
    throw new Error('联合夹具的正常导航没有在有限步内到达。');
  };
  const go = async (key, destination) => {
    const current = (await snapshot(key)).projection;
    if (current.self.sceneId !== destination.sceneId) {
      const scene = content.scenes.find(row => row.sceneId === current.self.sceneId), exit = scene.exits.find(row => row.destinationSceneId === destination.sceneId);
      assert.ok(exit, '跨场景路线有真实出口');
      await move(key, scene.sceneId, scene.anchors.find(anchor => anchor.anchorId === exit.anchorId).position);
    }
    return move(key, destination.sceneId, destination.position);
  };
  const entity = async (key, name) => {
    const projection = (await snapshot(key)).projection, found = [...projection.entities, ...projection.targets, ...projection.items].find(row => row.name === name);
    assert.ok(found, `当前授权投影须有 ${name}`); return found;
  };
  const interact = async (key, name, operationId, parameters) => {
    const target = name === 'self' ? (await snapshot(key)).projection.self : await entity(key, name);
    return send(key, { kind: 'interact', targetRef: target.entityRef, expectedTargetRevision: target.resourceRevision, operationId, ...(parameters ? { parameters } : {}) });
  };
  const at = (sceneId, anchorId) => ({ sceneId, position: content.scenes.find(scene => scene.sceneId === sceneId).anchors.find(anchor => anchor.anchorId === anchorId).position });
  const propose = async destinationId => {
    const self = (await snapshot(0)).projection.self, owner = await entity(0, '翠兰');
    accepted(await send(0, { kind: 'propose_follow', subjectRef: owner.entityRef, leaderRef: self.entityRef, destinationId, expectedTargetRevision: owner.resourceRevision }));
    await drain(); return (await snapshot(0)).projection.chapter.consents.findLast(consent => consent.purpose === 'follow');
  };
  await drain();
  return {
    content, sessionId, bindings, users, actions, snapshot, send, step, move, go, entity, interact, at, propose, drain, sceneStatus,
    readReceipt: (key, actionId) => http(`/sessions/${sessionId}/actions/${actionId}`, actorFor(key).token),
    retryOriginal(key, raw) {
      const actor = actorFor(key); assert.equal(actor.internal, false);
      assert.equal(JSON.parse(raw).sessionId, sessionId);
      return rpc(actor.socket, 'player.action.request', raw);
    },
    C: id => at('gaolao-courtyard', id), R: id => at('gaolao-village-road', id),
    state: () => server.runtime.replay(sessionId),
    async interruptControl(key) {
      const actor = actorFor(key); assert.equal(actor.internal, false);
      const current = await snapshot(key);
      return rpc(actor.socket, 'control.take', JSON.stringify({ schemaVersion: 2, type: 'control.take', sessionId, viewId: current.viewId, actorRef: current.projection.self.entityRef, nonce: crypto.randomUUID() }));
    },
    async close() { for (const socket of sockets) socket.disconnect(); server.runtime.openConnection = originalOpen; },
  };
}
