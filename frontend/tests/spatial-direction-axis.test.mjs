import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SpatialSessionClient } from '../src/network/spatial-session.ts';
import { directionClock, DIRECTION_LOOKAHEAD } from '../src/domain/spatial-direction.ts';
import { directionTarget } from '../src/domain/spatial-navigation.ts';
import { spatialBatch, spatialSnapshot } from './spatial-fixture.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));
const trace = JSON.parse(await readFile(new URL('./fixtures/direction-down-ci68.json', import.meta.url), 'utf8'));

async function room(t, position = { x: 100, y: 100 }) {
  let now = 0, next = 0, handlers, loseMoveAck = false;
  const jobs = new Map(), receipts = new Map(), requests = [], savedClock = { ...directionClock };
  Object.assign(directionClock, {
    now: () => now,
    setTimeout(callback, delay) { const id = ++next; jobs.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { jobs.delete(id); },
  });
  const initial = spatialSnapshot(); initial.projection.self.canControl = false;
  initial.projection.self.position = { ...position }; initial.projection.entities[0].position = { ...position };
  Object.assign(initial.projection.scene, { width: 1600, height: 1000, walkableAreas: [{ areaId: 'ground', polygon: [{ x: 0, y: 0 }, { x: 1600, y: 0 }, { x: 1600, y: 1000 }, { x: 0, y: 1000 }] }] });
  const link = { connected: true, close() {}, async request(event, raw) {
    if (event === 'session.subscribe') return structuredClone(initial);
    const request = JSON.parse(raw);
    if (event === 'sync.request') return { schemaVersion: 2, type: 'world.batch', sessionId: request.sessionId, viewId: request.viewId, fromExclusive: request.cursor, throughSeq: request.cursor, events: [] };
    if (event.startsWith('control.')) {
      const snapshot = structuredClone(client.state.snapshot), epoch = String(BigInt(snapshot.projection.self.controlEpoch) + 1n);
      snapshot.viewId = 'control-' + epoch; Object.assign(snapshot.projection.self, { canControl: true, controlEpoch: epoch, movementCommandHighWater: '0' });
      return { schemaVersion: 2, sessionId: request.sessionId, nonce: request.nonce, controlEpoch: epoch, observedSeq: snapshot.snapshotSeq, snapshot };
    }
    requests.push({ at: now, request, origin: { ...client.state.snapshot.projection.self.position } });
    const receipt = { schemaVersion: 2, sessionId: request.sessionId, clientActionId: request.clientActionId, status: 'Accepted', code: 'OK', observedSeq: '10', actionEventRange: null,
      result: request.action.kind === 'move_to' ? { movementId: 'move_' + request.action.movementCommandSeq.padStart(31, '0'), planVersion: request.action.movementCommandSeq, movementCommandSeq: request.action.movementCommandSeq, status: 'accepted' } : { status: 'cancelled' } };
    receipts.set(request.clientActionId, receipt);
    if (request.action.kind === 'move_to' && loseMoveAck) { loseMoveAck = false; throw new Error('移动 ACK 丢失'); }
    return receipt;
  } };
  const client = new SpatialSessionClient({ receipt: async (_sessionId, actionId) => receipts.get(actionId) ?? null }, (_token, callbacks) => { handlers = callbacks; return link; }, { heartbeatMs: 0, reconnectDelayMs: 0 });
  t.after(() => { client.close(); Object.assign(directionClock, savedClock); });
  client.open('spatial-room', 'token'); handlers.connected(); await flush(); await client.control('resume');
  return { client, requests, loseNextMoveAck() { loseMoveAck = true; },
    publish(position, change = () => {}) {
      const snapshot = structuredClone(client.state.snapshot); snapshot.projection.self.position = { ...position }; snapshot.projection.entities[0].position = { ...position };
      change(snapshot); handlers.batch(spatialBatch(snapshot, String(BigInt(snapshot.snapshotSeq) + 1n)));
    },
    async advance(through) {
      while (true) {
        const entry = [...jobs].sort((a, b) => a[1].at - b[1].at).find(([, job]) => job.at <= through);
        if (!entry) break;
        jobs.delete(entry[0]); now = entry[1].at; entry[1].callback(); await flush();
      }
      now = through; await flush();
    },
  };
}

test('R66-CI68-DOWN-001：原CI授权位置与接收时序下，纯下短目标不跟随滞后x来回摆动', async t => {
  assert.deepEqual(trace.originalRequests.map(value => value.destination.x), [1079, 1088, 1081, 1087]);
  const h = await room(t, trace.updates[0].position);
  await h.advance(trace.phaseAt); h.client.setDirection({ x: 0, y: 1 }); await flush();
  for (const update of trace.updates.slice(1)) {
    await h.advance(update.at); h.publish(update.position, snapshot => { snapshot.projection.sceneTimeMs = update.sceneTimeMs; }); await flush();
    assert.deepEqual(h.client.state.snapshot.projection.self.position, update.position, '输入目标不回写授权位置');
  }
  await h.advance(trace.stopAt); h.client.setDirection(null); await flush();
  const moves = h.requests.filter(value => value.request.action.kind === 'move_to');
  assert.ok(moves.length >= 4);
  assert.ok(moves.every(value => value.request.action.destination.x === trace.updates[0].position.x), '同一纯下输入保持最初确认的横轴锚点');
  for (const { request, origin } of moves) assert.ok(Math.hypot(request.action.destination.x - origin.x, request.action.destination.y - origin.y) <= DIRECTION_LOOKAHEAD);
  assert.equal(h.requests.at(-1).request.action.kind, 'stop_move');
});

test('R66-CI68-DOWN-001：改向、全松、明确接管和控制边界都重建零轴锚点', async t => {
  for (const change of ['改向后转回', '全松', '停步按钮', '明确取消', '控制周期', '场景']) await t.test(change, async t => {
    const h = await room(t); h.client.setDirection({ x: 0, y: 1 }); await flush();
    h.publish({ x: 110, y: 115 }); await h.advance(100);
    assert.equal(h.requests.at(-1).request.action.destination.x, 100);
    h.publish({ x: 120, y: 130 });
    if (change === '改向后转回') h.client.setDirection({ x: 1, y: 0 });
    else if (change === '全松') { h.client.setDirection(null); await flush(); }
    else if (change === '停步按钮') await h.client.stop();
    else if (change === '明确取消') h.client.cancelQueued();
    else if (change === '控制周期') { h.publish({ x: 120, y: 130 }, snapshot => { snapshot.projection.self.controlEpoch = '4'; }); await h.client.control('take'); }
    else h.publish({ x: 120, y: 130 }, snapshot => { snapshot.projection.self.sceneId = 'other'; snapshot.projection.scene.sceneId = 'other'; snapshot.projection.entities[0].sceneId = 'other'; });
    h.client.setDirection({ x: 0, y: 1 }); await h.advance(200);
    assert.equal(h.requests.at(-1).request.action.destination.x, 120);
  });
});

test('R66-CI68-DOWN-001：Unknown先冻结，查询原收据后新输入不沿用旧锚点', async t => {
  const h = await room(t); h.client.setDirection({ x: 0, y: 1 }); await flush();
  h.publish({ x: 110, y: 115 }); h.loseNextMoveAck(); await h.advance(100);
  const unknown = h.client.state.actions.find(value => value.status === 'unknown'); assert.ok(unknown);
  const count = h.requests.length; h.client.setDirection({ x: 0, y: 1 }); await h.advance(200); assert.equal(h.requests.length, count);
  h.publish({ x: 120, y: 130 }); await h.client.query(unknown.id);
  h.client.setDirection({ x: 0, y: 1 }); await flush();
  assert.equal(h.requests.at(-1).request.action.destination.x, 120);
  assert.equal(h.client.state.actions.find(value => value.id === unknown.id).raw, unknown.raw);
});

test('R66-CI68-DOWN-001：锚定目标仍从当前授权点验距与碰撞，不穿过横向细墙', () => {
  const scene = spatialSnapshot().projection.scene, origin = { x: 100, y: 100 }, anchor = { x: 91, y: 80 };
  const target = directionTarget(scene, origin, { x: 0, y: 1 }, anchor);
  assert.equal(target.x, 91); assert.ok(target.y > origin.y); assert.ok(Math.hypot(target.x - origin.x, target.y - origin.y) <= DIRECTION_LOOKAHEAD);
  scene.obstacles = [{ obstacleId: 'thin-wall', polygon: [{ x: 95, y: 0 }, { x: 96, y: 0 }, { x: 96, y: 800 }, { x: 95, y: 800 }], exceptAreas: [] }];
  assert.equal(directionTarget(scene, origin, { x: 0, y: 1 }, anchor), null);
});
