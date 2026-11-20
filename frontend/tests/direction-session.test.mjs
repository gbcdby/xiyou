import test from 'node:test';
import assert from 'node:assert/strict';
import { SpatialSessionClient } from '../src/network/spatial-session.ts';
import { spatialSnapshot, spatialBatch } from './spatial-fixture.mjs';
import { directionClock } from '../src/domain/spatial-direction.ts';

const flush = () => new Promise(resolve => setImmediate(resolve));
async function room(t, enabled = true) {
  let handlers, pendingFirst = null, rejectFirst = false, hold = false, failFirst = false, holdDirections = false; const wires = [], known = new Map(), pendingDirections = [];
  const initial = spatialSnapshot(); initial.projection.self.canControl = false;
  const receipt = (r, status = 'Accepted') => ({ schemaVersion: 2, sessionId: r.sessionId, clientActionId: r.clientActionId, status, code: status === 'Accepted' ? 'OK' : 'STALE_MOVEMENT_COMMAND', observedSeq: '10', actionEventRange: null, result: status === 'Rejected' ? {} : r.action.kind === 'stop_move' ? { status: 'cancelled', movementCommandSeq: r.action.movementCommandSeq } : { movementId: 'move_' + r.action.movementCommandSeq.padStart(31, '0'), planVersion: r.action.movementCommandSeq, movementCommandSeq: r.action.movementCommandSeq, status: 'accepted' } });
  const link = { connected: true, acceptedCapabilities: enabled ? ['spatial-direction-v1'] : [], close() {}, async request(event, raw) {
    if (event === 'session.subscribe') return structuredClone(initial);
    const r = JSON.parse(raw);
    if (event === 'sync.request') return { schemaVersion: 2, type: 'world.batch', sessionId: r.sessionId, viewId: r.viewId, fromExclusive: r.cursor, throughSeq: r.cursor, events: [] };
    if (event.startsWith('control.')) { const s = spatialSnapshot(); s.viewId = 'next-view'; s.projection.self.controlEpoch = '3'; return { schemaVersion: 2, sessionId: r.sessionId, nonce: r.nonce, observedSeq: s.snapshotSeq, controlEpoch: '3', snapshot: s }; }
    wires.push(raw); known.set(r.clientActionId, receipt(r));
    if (failFirst && wires.length === 1) throw new Error('原结果已提交，ACK丢失');
    if (hold && wires.length === 1) return new Promise(resolve => { pendingFirst = () => resolve(receipt(r, rejectFirst ? 'Rejected' : 'Accepted')); });
    if (holdDirections && r.action.kind === 'move_direction') return new Promise(resolve => { pendingDirections.push(() => resolve(receipt(r))); });
    return receipt(r);
  } };
  const client = new SpatialSessionClient({ receipt: async (_session, id) => known.get(id) ?? null }, (_token, h) => { handlers = h; return link; }, { heartbeatMs: 0, reconnectDelayMs: 0 });
  t.after(() => client.close()); client.open('spatial-room', 'token'); handlers.connected(); await flush(); await client.control('resume');
  return { client, wires, link, get handlers() { return handlers; }, holdFirst(rejected = false) { hold = true; rejectFirst = rejected; }, loseFirstAck() { failFirst = true; }, completeFirst() { pendingFirst(); },
    holdDirections() { holdDirections = true; }, completeDirection(index) { pendingDirections[index](); } };
}

test('DIR-CLIENT：默认旧路径；成功cap的新方向只发送枚举与当前绑定，不提交客户端位置', async t => {
  for (const enabled of [false, true]) await t.test(String(enabled), async t => {
    const h = await room(t, enabled); h.client.setDirection({ x: 0, y: 1 }); await flush(); h.client.setDirection(null); await flush();
    const actions = h.wires.map(raw => JSON.parse(raw).action);
    assert.equal(actions[0].kind, enabled ? 'move_direction' : 'move_to');
    if (enabled) assert.deepEqual(actions[0], { kind: 'move_direction', sceneId: 'yard', mapVersion: 'gray-map-v1', direction: 'S', movementCommandSeq: '1' });
    assert.equal(actions[1].kind, 'stop_move'); assert.equal(actions[1].movementCommandSeq, '2');
  });
});

test('DIR-CLIENT：新方向越过旧ACK；旧拒绝不发送stop，最终stop序号覆盖两请求', async t => {
  const h = await room(t); h.holdFirst(true); h.client.setDirection({ x: 1, y: 1 }); await flush(); h.client.setDirection({ x: 0, y: 1 }); await flush();
  assert.deepEqual(h.wires.map(raw => JSON.parse(raw).action.kind), ['move_direction', 'move_direction']);
  h.completeFirst(); await flush(); assert.equal(h.wires.length, 2);
  h.client.setDirection(null); await flush(); assert.equal(JSON.parse(h.wires[2]).action.movementCommandSeq, '3');
});

test('DIR-CLIENT：身份/地图变更取消旧持键，不由迟到ACK恢复', async t => {
  const h = await room(t); h.holdFirst(); h.client.setDirection({ x: 1, y: 1 }); await flush();
  const changed = structuredClone(h.client.state.snapshot); changed.projection.mapVersion = 'new-map';
  h.handlers.batch(spatialBatch(changed, '11')); h.completeFirst(); await flush(); await new Promise(resolve => setTimeout(resolve, 130));
  assert.equal(h.wires.length, 1);
});

test('DIR-CLIENT：未知方向保原串，兼容连接不得改写重发，查询原Receipt后才新输入', async t => {
  const h = await room(t); h.loseFirstAck(); h.client.setDirection({ x: 1, y: 0 }); await flush();
  const original = h.wires[0], id = JSON.parse(original).clientActionId;
  assert.equal(h.client.state.actions.find(a => a.id === id).status, 'unknown');
  assert.deepEqual(h.wires.map(raw => JSON.parse(raw).action.kind), ['move_direction', 'stop_move']);
  h.client.setDirection({ x: 0, y: 1 }); await flush(); assert.equal(h.wires.length, 2);
  h.link.acceptedCapabilities = []; await h.client.retry(id); assert.equal(h.wires.length, 2);
  assert.equal(h.client.state.actions.find(a => a.id === id).raw, original);
  await h.client.query(id); assert.equal(h.client.state.actions.find(a => a.id === id).status, 'accepted');
  assert.equal(h.client.state.actions.find(a => a.id === id).raw, original);
});

test('D66-CLIENT-02：跨地图绑定仍最多两条原方向未决；只续最新明确意图，stop独立', async t => {
  const h = await room(t); h.holdDirections();
  h.client.setDirection({ x: 1, y: 0 }); h.client.setDirection({ x: 0, y: 1 }); await flush();
  const originals = [...h.wires];
  const changed = structuredClone(h.client.state.snapshot); changed.projection.mapVersion = 'new-map';
  h.handlers.batch(spatialBatch(changed, '11'));
  h.client.setDirection({ x: 1, y: 0 }); h.client.setDirection({ x: 0, y: 1 }); await flush();
  assert.equal(h.wires.length, 2, '重建输入绑定不得增加全会话原方向容量');
  await assert.rejects(h.client.send({ kind: 'move_direction', sceneId: 'yard', mapVersion: 'new-map', direction: 'W', movementCommandSeq: '3' }, true), /未决|确认/);
  h.client.setDirection(null); await flush();
  assert.equal(JSON.parse(h.wires[2]).action.kind, 'stop_move', '两方向槽满仍可立即停步');
  assert.equal(JSON.parse(h.wires[2]).action.movementCommandSeq, '3');
  h.client.setDirection({ x: -1, y: 0 }); h.client.setDirection({ x: 0, y: 1 });
  h.completeDirection(0); await flush();
  assert.equal(h.wires.length, 4);
  assert.deepEqual(JSON.parse(h.wires[3]).action, { kind: 'move_direction', sceneId: 'yard', mapVersion: 'new-map', direction: 'S', movementCommandSeq: '4' });
  assert.deepEqual(h.client.state.actions.slice(0, 2).map(draft => draft.raw), originals);
  assert.equal(h.client.state.actions.filter(draft => ['waiting', 'unknown'].includes(draft.status) && JSON.parse(draft.raw).action.kind === 'move_direction').length, 2);
});

test('D66-CLIENT-02：旧绑定400ms仍收束Unknown，查询原Receipt不复活持键', async t => {
  const h = await room(t); h.holdDirections();
  h.client.setDirection({ x: 1, y: 0 }); h.client.setDirection({ x: 0, y: 1 }); await flush();
  const originals = [...h.wires], ids = originals.map(raw => JSON.parse(raw).clientActionId);
  await new Promise(resolve => setTimeout(resolve, 150));
  const changed = structuredClone(h.client.state.snapshot); changed.projection.mapVersion = 'new-map';
  h.handlers.batch(spatialBatch(changed, '11')); h.client.setDirection({ x: -1, y: 0 });
  await new Promise(resolve => setTimeout(resolve, 280));
  assert.deepEqual(h.client.state.actions.filter(draft => ids.includes(draft.id)).map(draft => draft.status), ['unknown', 'unknown']);
  assert.deepEqual(h.wires.map(raw => JSON.parse(raw).action.kind), ['move_direction', 'move_direction', 'stop_move']);
  assert.deepEqual(h.client.state.actions.filter(draft => ids.includes(draft.id)).map(draft => draft.raw), originals);
  void h.client.retry(ids[0]); await flush();
  assert.equal(h.wires[3], originals[0], '重试只使用同一ID、序号与原串');
  assert.equal(h.client.state.actions.find(draft => draft.id === ids[0]).status, 'unknown', '重试不能重新开始400ms或解除冻结');
  h.client.setDirection({ x: 1, y: 0 }); await flush(); assert.equal(h.wires.length, 4);
  for (const id of ids) await h.client.query(id);
  await new Promise(resolve => setTimeout(resolve, 130));
  assert.equal(h.wires.length, 4, '查询只收束原请求，不能恢复Unknown前的最新持键');
  h.client.setDirection({ x: 0, y: 1 }); await flush();
  assert.equal(h.wires.length, 5, '原账本已收束后新的明确输入才恢复');
});

test('D66-CLIENT-02：同绑定查询原方向Receipt可释放本地代次，未完成的网络Promise不永久占槽', async t => {
  const h = await room(t); h.holdDirections();
  h.client.setDirection({ x: 1, y: 0 }); h.client.setDirection({ x: 0, y: 1 }); await flush();
  const ids = h.wires.map(raw => JSON.parse(raw).clientActionId);
  await new Promise(resolve => setTimeout(resolve, 430));
  for (const id of ids) await h.client.query(id);
  assert.equal(h.wires.length, 3, '查询不自动恢复此前持键');
  h.client.setDirection({ x: -1, y: 0 }); await flush();
  assert.equal(h.wires.length, 4, '两条原Receipt确认后新的明确输入可以发出');
});


test('DS2-05：两条同向跨绑定仍由原账本限槽，stop和原截止各自保持', async t => {
  for (const ending of ['两槽满立即停步', '原截止后查询恢复']) await t.test(ending, async t => {
    let now = 0, next = 0, h; const jobs = new Map(), savedClock = { ...directionClock };
    // 复用现有方向测试的有限时钟，只替换公开clock，不替换客户端判定或账本。
    Object.assign(directionClock, {
      now: () => now,
      setTimeout(callback, delay) { const id = ++next; jobs.set(id, { callback, at: now + delay }); return id; },
      clearTimeout(id) { jobs.delete(id); },
    });
    t.after(() => { h?.client.close(); Object.assign(directionClock, savedClock); });
    const advance = async through => {
      for (;;) {
        const entry = [...jobs].sort((a, b) => a[1].at - b[1].at).find(([, job]) => job.at <= through); if (!entry) break;
        jobs.delete(entry[0]); now = entry[1].at; entry[1].callback(); await flush();
      }
      now = through; await flush();
    };
    h = await room(t); h.holdDirections();
    h.client.setDirection({ x: 1, y: 0 }); await flush(); await advance(100);
    assert.deepEqual(h.wires.map(raw => JSON.parse(raw).action.direction), ['E', 'E']);
    const originals = [...h.wires], requests = originals.map(raw => JSON.parse(raw)), ids = requests.map(request => request.clientActionId);
    assert.deepEqual(requests.map(request => request.action.movementCommandSeq), ['1', '2']);
    await advance(150);
    const changed = structuredClone(h.client.state.snapshot); changed.projection.mapVersion = 'new-map';
    h.handlers.batch(spatialBatch(changed, '11')); h.client.setDirection({ x: 0, y: 1 }); await flush();
    assert.equal(h.wires.length, 2, '新controller的空Map不能绕过两条旧同向原账本');
    await assert.rejects(h.client.send({ kind: 'move_direction', sceneId: 'yard', mapVersion: 'new-map', direction: 'W', movementCommandSeq: '3' }, true), /未决|确认/);
    if (ending === '两槽满立即停步') {
      h.client.setDirection(null); await flush();
      const stop = JSON.parse(h.wires[2]);
      assert.equal(stop.action.kind, 'stop_move'); assert.equal(stop.action.movementCommandSeq, '3');
      assert.equal(stop.controlEpoch, requests[0].controlEpoch, '覆盖只在同一控制epoch解释');
      h.completeDirection(0); h.completeDirection(1); await flush(); await advance(700);
      assert.equal(h.wires.length, 3, '原同向回调不恢复已全松方向');
    } else {
      await advance(399); assert.deepEqual(h.client.state.actions.slice(0, 2).map(draft => draft.status), ['waiting', 'waiting']);
      await advance(400); assert.deepEqual(h.client.state.actions.slice(0, 2).map(draft => draft.status), ['unknown', 'waiting']);
      assert.deepEqual(h.wires.map(raw => JSON.parse(raw).action.kind), ['move_direction', 'move_direction', 'stop_move']);
      assert.equal(JSON.parse(h.wires[2]).action.movementCommandSeq, '3');
      await advance(499); assert.equal(h.client.state.actions.find(draft => draft.id === ids[1]).status, 'waiting');
      await advance(500); assert.deepEqual(h.client.state.actions.slice(0, 2).map(draft => draft.status), ['unknown', 'unknown']);
      assert.equal(h.wires.length, 3, '第二原截止不重复发stop，也不按新绑定重启400ms');
      for (const id of ids) await h.client.query(id);
      await advance(650); assert.equal(h.wires.length, 3, '原Receipt查询只收束，不恢复旧持键');
      assert.deepEqual(h.client.state.actions.slice(0, 2).map(draft => draft.status), ['accepted', 'accepted']);
      h.client.setDirection({ x: -1, y: 0 }); await flush();
      assert.deepEqual(JSON.parse(h.wires[3]).action, { kind: 'move_direction', sceneId: 'yard', mapVersion: 'new-map', direction: 'W', movementCommandSeq: '4' }, '原Receipt已定案时，未回的旧Promise不永久占全会话槽');
      h.completeDirection(0); h.completeDirection(1); await flush();
      assert.equal(h.wires.length, 4, '旧网络回调只收束其原身份');
      assert.equal(h.client.state.actions.filter(draft => ['waiting', 'unknown'].includes(draft.status) && JSON.parse(draft.raw).action.kind === 'move_direction').length, 1);
      h.client.setDirection(null); await flush();
      assert.equal(JSON.parse(h.wires[4]).action.movementCommandSeq, '5'); assert.equal(JSON.parse(h.wires[4]).action.kind, 'stop_move');
      h.completeDirection(2); await flush(); await advance(1100); assert.equal(h.wires.length, 5);
    }
    assert.deepEqual(h.client.state.actions.filter(draft => ids.includes(draft.id)).map(draft => draft.raw), originals, '跨绑定、截止、查询和迟到回调均保留两个原串');
  });
});
