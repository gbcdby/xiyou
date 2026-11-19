import test from 'node:test';
import assert from 'node:assert/strict';
import { SpatialSessionClient } from '../src/network/spatial-session.ts';
import { directionClock } from '../src/domain/spatial-direction.ts';
import { ConfirmedMotion } from '../src/domain/spatial-motion.ts';
import { createSpatialSnapshotSource } from '../src/domain/spatial-snapshot-source.ts';
import { spatialSnapshot, spatialBatch, selfRef } from './spatial-fixture.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { await flush(); await flush(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const empty = q => ({ schemaVersion: 2, type: 'world.batch', sessionId: q.sessionId, viewId: q.viewId,
  fromExclusive: q.cursor, throughSeq: q.cursor, events: [] });

async function room(t, { base = '10', timed = true, direction = true, heartbeatMs = 0 } = {}) {
  let nextId = 0, controlCount = 0;
  const requests = [], actions = [], links = [], syncReplies = [], controlReplies = [], known = new Map(), queries = [];
  const activity = { active: new Map(), maximum: new Map(), changed() {} };
  const initial = spatialSnapshot(); initial.snapshotSeq = base; initial.projection.self.canControl = false;
  const receipt = (index = 0, patch = {}) => {
    const q = actions[index].q, sequence = q.action.movementCommandSeq;
    return { schemaVersion: 2, sessionId: q.sessionId, clientActionId: q.clientActionId, status: 'Accepted', code: 'OK', observedSeq: String(BigInt(base) + 1n),
      actionEventRange: null, result: q.action.kind === 'stop_move' ? { status: 'cancelled', movementCommandSeq: sequence }
        : { movementId: 'move_0000000000000000000000000000001', planVersion: '1', movementCommandSeq: sequence, status: 'accepted' }, ...patch };
  };
  const client = new SpatialSessionClient({ receipt: async (_session, id) => { queries.push(id); return known.get(id) ?? null; } }, (_token, handlers) => {
    const id = links.length + 1;
    const link = { id, handlers, connected: true,
      acceptedCapabilities: ['spatial-v2', ...(direction ? ['spatial-direction-v1'] : []), ...(timed ? ['spatial-timed-trail-v1'] : [])],
      close() { this.connected = false; }, async request(event, raw, consume) {
        const q = typeof raw === 'string' ? JSON.parse(raw) : raw; requests.push({ event, q, raw, link: id });
        let value;
        if (event === 'session.subscribe') value = structuredClone(initial);
        else if (event.startsWith('control.')) {
          const snapshot = spatialSnapshot(); snapshot.snapshotSeq = client.state.snapshot?.snapshotSeq ?? base;
          const epoch = String(3 + controlCount++); snapshot.viewId = 'controlled-' + epoch; snapshot.projection.self.controlEpoch = epoch;
          snapshot.projection.self.capabilities = direction ? ['move_direction'] : [];
          const response = { schemaVersion: 2, sessionId: q.sessionId, nonce: q.nonce, controlEpoch: epoch, observedSeq: snapshot.snapshotSeq, snapshot };
          value = controlReplies.length ? await controlReplies.shift()(response) : response;
        } else if (event === 'player.action.request') {
          const gate = deferred(), entry = { q, raw, gate, link: id }; actions.push(entry);
          known.set(q.clientActionId, receipt(actions.length - 1)); value = await gate.promise;
        } else {
          assert.equal(event, 'sync.request'); const count = (activity.active.get(id) ?? 0) + 1;
          activity.active.set(id, count); activity.maximum.set(id, Math.max(activity.maximum.get(id) ?? 0, count));
          try { value = syncReplies.length ? await syncReplies.shift()(q) : empty(q); }
          finally { activity.active.set(id, activity.active.get(id) - 1); }
        }
        consume?.(value); return value;
      } };
    links.push(link); return link;
  }, { heartbeatMs, reconnectDelayMs: 0, id: () => 'receipt-action-' + ++nextId, onChange: state => activity.changed(state) });
  t.after(() => client.close()); client.open(initial.sessionId, 'token'); links[0].handlers.connected();
  await settle(); await client.control('resume'); await settle(); assert.equal(client.state.inputReady, true); requests.length = 0;
  return {
    client, requests, actions, links, known, queries, activity, receipt, get link() { return links.at(-1); },
    syncs: () => requests.filter(r => r.event === 'sync.request'),
    send(action = { kind: 'move_direction', movementCommandSeq: '1', sceneId: 'yard', mapVersion: 'gray-map-v1', direction: 'E' }) { return client.send(action, true); },
    reply(index = 0, value = receipt(index)) { actions[index].gate.resolve(value); },
    holdSync() { const gate = deferred(); syncReplies.push(q => { gate.request = q; return gate.promise; }); return gate; },
    nextSync(value) { syncReplies.push(q => typeof value === 'function' ? value(q) : value); },
    holdControl() { const gate = deferred(); controlReplies.push(response => { gate.response = response; return gate.promise; }); return gate; },
    push(through = String(BigInt(client.state.snapshot.snapshotSeq) + 1n), change = () => {}) {
      const previous = client.state.snapshot, snapshot = structuredClone(previous), p = snapshot.projection;
      const fromTime = p.sceneTimeMs, from = { ...p.self.position }, to = { x: from.x + 18, y: from.y };
      p.sceneTimeMs += 120; p.self.position = to; p.self.movementCommandHighWater = '1'; p.entities[0].position = { ...to };
      Object.assign(p.entities[0], { motionTrail: [from, to], motionFromSceneTimeMs: fromTime, motionThroughSceneTimeMs: p.sceneTimeMs,
        motionTimeline: [{ kind: 'motion', fromSceneTimeMs: fromTime, throughSceneTimeMs: fromTime + 100, fromTrailIndex: 0, throughTrailIndex: 1 },
          { kind: 'hold', fromSceneTimeMs: fromTime + 100, throughSceneTimeMs: p.sceneTimeMs, fromTrailIndex: 1, throughTrailIndex: 1 }] });
      const batch = spatialBatch(snapshot, through); change(batch); links.at(-1).handlers.batch(batch); return batch;
    },
  };
}

test('RC-01：同绑定完整前缀已应用的首次方向Accepted不再补读，保留原收据与timed历史', async t => {
  for (const base of ['10', '9007199254740993']) await t.test(base, async t => {
    const h = await room(t, { base }), through = String(BigInt(base) + 1n), sending = h.send(); await settle();
    const batch = h.push(through), applied = h.client.state.snapshot, original = h.actions[0].raw, receipt = h.receipt();
    assert.equal(applied.snapshotSeq, through); assert.ok(Object.isFrozen(applied.projection.entities[0].motionTimeline));
    assert.deepEqual(applied.projection.entities[0].motionTimeline, batch.events[0].payload.projection.entities[0].motionTimeline);
    assert.equal(h.syncs().length, 0); h.reply(0, receipt); const outcome = await sending; await settle();
    assert.equal(h.syncs().length, 0, '本收据前缀已完整应用，不提出另一次补读');
    assert.equal(outcome.status, 'accepted'); assert.equal(outcome.raw, original); assert.deepEqual(outcome.receipt, receipt);
    assert.strictEqual(h.client.state.snapshot, applied); assert.equal(h.actions.length, 1);
  });
});

test('RC-02：未满足的前缀、未应用push及不适用收据仍补读', async t => {
  const cases = [
    { name: '无push', push: false },
    { name: '只到11而观察12', receipt: { observedSeq: '12' } },
    { name: '错view推送', change: batch => { batch.viewId = 'wrong-view'; }, applied: '10' },
    { name: '部分重叠推送', change: batch => { batch.fromExclusive = '9'; }, applied: '10' },
    { name: '非法timed推送', change: batch => { batch.events[0].payload.projection.entities[0].motionTimeline[0].throughTrailIndex = 99; }, applied: '10' },
    { name: 'Rejected', receipt: { status: 'Rejected', code: 'STALE_MOVEMENT_COMMAND', result: {} }, status: 'rejected' },
    { name: '收据命令序号不同', receipt: { result: { movementCommandSeq: '2', status: 'accepted' } } },
    { name: '收据缺命令序号', receipt: { result: { status: 'accepted' } } },
    { name: '缺timed能力', options: { timed: false } },
    { name: 'stop不适用', action: { kind: 'stop_move', movementCommandSeq: '1' } },
    { name: '点选路线不适用', action: { kind: 'move_to', movementCommandSeq: '1', sceneId: 'yard', destination: { x: 136, y: 100 } } },
  ];
  for (const entry of cases) await t.test(entry.name, async t => {
    const h = await room(t, entry.options), sending = h.send(entry.action); await settle();
    if (entry.push !== false) h.push('11', entry.change); await settle();
    const applied = entry.push === false ? '10' : entry.applied ?? '11'; assert.equal(h.client.state.snapshot.snapshotSeq, applied);
    const before = h.syncs().length, receipt = h.receipt(0, entry.receipt); h.reply(0, receipt);
    const outcome = await sending; await settle();
    assert.equal(h.syncs().length - before, 1); assert.equal(h.syncs().at(-1).q.cursor, applied);
    assert.equal(outcome.status, entry.status ?? 'accepted'); assert.deepEqual(outcome.receipt, receipt);
  });
});

test('RC-02：非法或错id收据保留Unknown，错误回复不借前缀覆盖恢复授权', async t => {
  for (const kind of ['错id', '非法范围', 'OUTCOME_UNKNOWN', 'FORBIDDEN']) await t.test(kind, async t => {
    const h = await room(t), sending = h.send(); await settle(); h.push('11'); const raw = h.actions[0].raw;
    const value = kind === '错id' ? h.receipt(0, { clientActionId: 'another-action' })
      : kind === '非法范围' ? h.receipt(0, { actionEventRange: { first: '11', last: '12' } })
        : { schemaVersion: 2, code: kind, message: '受控错误。' };
    h.reply(0, value); await sending; await settle();
    const draft = h.client.state.actions.find(value => value.raw === raw);
    assert.equal(draft.status, 'unknown'); assert.equal(draft.receipt, null); assert.equal(h.syncs().length, 0);
    if (kind === 'FORBIDDEN') { assert.equal(h.client.state.snapshot, null); assert.equal(h.client.state.inputReady, false); }
    else assert.equal(h.actions[1].q.action.kind, 'stop_move', '未知方向仍走独立stop，不伪造成功');
  });
  await t.test('未协商direction仍拒绝发送', async t => {
    const h = await room(t, { direction: false }); await assert.rejects(h.send(), /方向行走能力/); assert.equal(h.actions.length, 0);
  });
});

test('RC-03：在途sync只省本收据的需求，显式、heartbeat、push缺口和新view需求均保留', async t => {
  for (const demand of ['没有其他需求', '显式', 'heartbeat', 'push缺口', '新view']) await t.test(demand, async t => {
    if (demand === 'heartbeat') t.mock.timers.enable({ apis: ['setInterval'] });
    const h = await room(t, { heartbeatMs: demand === 'heartbeat' ? 1000 : 0 }), gate = h.holdSync(), original = h.client.sync(); await settle();
    const sending = h.send(); await settle(); h.push('11');
    if (demand === '显式') { void h.client.sync(); void h.client.sync(); }
    if (demand === 'heartbeat') t.mock.timers.tick(1000);
    if (demand === 'push缺口') h.push('13', batch => { batch.fromExclusive = '9'; });
    if (demand === '新view') await h.client.control('take');
    h.reply(); await sending; await settle(); assert.equal(h.syncs().length, 1);
    gate.resolve(empty(gate.request)); await original; await settle();
    assert.equal(h.syncs().length, demand === '没有其他需求' ? 1 : 2);
    assert.equal(h.activity.maximum.get(1), 1); assert.equal(h.client.state.snapshot.snapshotSeq, '11');
    if (demand !== '没有其他需求') assert.equal(h.syncs().at(-1).q.viewId, h.client.state.snapshot.viewId);
  });
});

test('RC-04：省读后原显式同步和heartbeat的撤权仍立即清视图与输入', async t => {
  for (const source of ['显式', 'heartbeat']) for (const code of ['FORBIDDEN', 'UNAUTHENTICATED']) await t.test(source + code, async t => {
    if (source === 'heartbeat') t.mock.timers.enable({ apis: ['setInterval'] });
    const h = await room(t, { heartbeatMs: source === 'heartbeat' ? 1000 : 0 }), sending = h.send(); await settle(); h.push('11');
    h.reply(); await sending; await settle(); assert.equal(h.syncs().length, 0);
    h.nextSync({ schemaVersion: 2, code, message: '真实读取已撤权。' });
    if (source === 'heartbeat') { t.mock.timers.tick(1000); await settle(); } else await h.client.sync();
    assert.equal(h.syncs().length, 1); assert.equal(h.client.state.connection, 'forbidden');
    assert.equal(h.client.state.snapshot, null); assert.equal(h.client.state.inputReady, false); assert.equal(h.link.connected, false);
  });
});

test('RC-04：省读后同link旧view在途撤权仍优先，旧link错误不能伤新连接', async t => {
  for (const replacement of ['同link新view', '新link']) await t.test(replacement, async t => {
    const h = await room(t), oldLink = h.link, gate = h.holdSync(), original = h.client.sync(); await settle();
    const sending = h.send(); await settle(); h.push('11'); h.reply(); await sending; await settle();
    assert.equal(h.syncs().length, 1);
    if (replacement === '同link新view') await h.client.control('take');
    else { oldLink.handlers.disconnected(); h.client.reconnect(); h.link.handlers.connected(); await settle(); await h.client.control('resume'); await settle(); }
    const before = h.syncs().length, current = h.client.state.snapshot;
    gate.resolve({ schemaVersion: 2, code: 'FORBIDDEN', message: '旧在途读取撤权。' }); await original; await settle();
    assert.equal(h.syncs().length, before);
    if (replacement === '同link新view') { assert.equal(h.client.state.snapshot, null); assert.equal(h.client.state.inputReady, false); }
    else { assert.strictEqual(h.client.state.snapshot, current); assert.equal(h.client.state.connection, 'online'); assert.equal(h.client.state.inputReady, true); }
    for (const maximum of h.activity.maximum.values()) assert.equal(maximum, 1);
  });
});

test('RC-05：query先确认后原实时ACK不再具有首次waiting资格', async t => {
  const h = await room(t), sending = h.send(); await settle(); h.push('11'); const raw = h.actions[0].raw, id = h.actions[0].q.clientActionId;
  await h.client.query(id); await settle(); assert.equal(h.syncs().length, 1); assert.equal(h.client.state.actions[0].status, 'accepted');
  h.reply(); await sending; await settle(); assert.equal(h.syncs().length, 2); assert.equal(h.client.state.actions[0].raw, raw);
  assert.equal(h.actions.length, 1, '查询与原ACK都不重发世界动作');
});

test('RC-05：400ms原截止、Unknown查询/重试和迟到ACK均保原身份及补读', async t => {
  for (const recovery of ['迟到ACK', 'query', 'retry']) await t.test(recovery, async t => {
    let now = 0, next = 0, h; const jobs = new Map(), savedClock = { ...directionClock };
    // 仅控制既有公开时钟；客户端账本、两槽、原截止和独立stop均使用真实实现。
    Object.assign(directionClock, { now: () => now,
      setTimeout(callback, delay) { const id = ++next; jobs.set(id, { callback, at: now + delay }); return id; },
      clearTimeout(id) { jobs.delete(id); } });
    t.after(() => { h?.client.close(); Object.assign(directionClock, savedClock); });
    const advance = async through => {
      for (;;) {
        const entry = [...jobs].sort((a, b) => a[1].at - b[1].at).find(([, job]) => job.at <= through); if (!entry) break;
        jobs.delete(entry[0]); now = entry[1].at; entry[1].callback(); await settle();
      }
      now = through; await settle();
    };
    h = await room(t); h.client.setDirection({ x: 1, y: 0 }); await settle(); h.push('11');
    const raw = h.actions[0].raw, id = h.actions[0].q.clientActionId;
    await advance(399); assert.equal(h.client.state.actions.find(value => value.id === id).status, 'waiting');
    assert.deepEqual(h.actions.map(value => value.q.action.movementCommandSeq), ['1', '2']);
    await advance(400); assert.equal(h.client.state.actions.find(value => value.id === id).status, 'unknown');
    assert.deepEqual(h.actions.map(value => value.q.action.kind), ['move_direction', 'move_direction', 'stop_move']);
    assert.equal(h.actions[2].q.action.movementCommandSeq, '3');
    const before = h.syncs().length;
    if (recovery === '迟到ACK') h.reply();
    else if (recovery === 'query') await h.client.query(id);
    else {
      const retrying = h.client.retry(id); await settle();
      assert.equal(h.client.state.actions.find(value => value.id === id).status, 'unknown', 'retry不重启等待或400ms');
      assert.equal(h.actions[3].raw, raw); h.reply(3); await retrying;
    }
    await settle(); assert.equal(h.syncs().length - before, 1);
    const confirmed = h.client.state.actions.find(value => value.id === id); assert.equal(confirmed.status, 'accepted'); assert.equal(confirmed.raw, raw);
    const count = h.actions.length; await advance(600);
    assert.equal(h.actions.length, count, '恢复原收据不复活未知前持键，第二截止不重复stop');
    assert.equal(h.client.state.actions.find(value => value.id === h.actions[1].q.clientActionId).status, 'unknown');
    if (recovery !== '迟到ACK') { h.reply(); await settle(); assert.equal(h.syncs().length - before, 2, '旧原Promise到达仍回退原路径'); }
  });
});

test('RC-05：重连回放只查原Receipt，未借旧覆盖恢复输入或改写原串', async t => {
  const h = await room(t), sending = h.send(); await settle(); h.push('11');
  const raw = h.actions[0].raw, id = h.actions[0].q.clientActionId;
  h.actions[0].gate.reject(new Error('原方向ACK丢失')); await sending; await settle();
  assert.equal(h.client.state.actions.find(value => value.id === id).status, 'unknown'); const before = h.syncs().length, requests = h.actions.length;
  // 明确保持订阅同步在途，才可要求多个回放收据合并成一个后续轮。
  const gate = h.holdSync(); h.client.reconnect(); h.link.handlers.connected(); await settle();
  assert.ok(h.queries.includes(id)); assert.equal(h.client.state.actions.find(value => value.id === id).status, 'accepted');
  assert.equal(h.client.state.actions.find(value => value.id === id).raw, raw); assert.equal(h.actions.length, requests);
  assert.equal(h.syncs().length - before, 1); gate.resolve(empty(gate.request)); await settle();
  assert.equal(h.client.state.inputReady, false); assert.equal(h.syncs().length - before, 2, '订阅同步与回放收据合并补读仍在');
});

test('RC-06：绑定变化或onChange重入后必须以末尾当前状态判定', async t => {
  const changes = [
    ['appearance', p => { p.self.appearanceEpoch = '1'; p.entities[0].appearanceEpoch = '1'; }],
    ['map', p => { p.mapVersion = 'new-map'; }],
    ['scene', p => { p.self.sceneId = 'new-yard'; p.entities[0].sceneId = 'new-yard'; p.scene.sceneId = 'new-yard'; }],
    ['epoch', p => { p.self.controlEpoch = '4'; }],
  ];
  for (const [name, change] of changes) for (const reentrant of [false, true]) await t.test(name + (reentrant ? '收据发布重入' : 'ACK前变化'), async t => {
    const h = await room(t), sending = h.send(); await settle();
    if (!reentrant) h.push('11', batch => change(batch.events[0].payload.projection));
    else {
      h.push('11'); let changed = false;
      h.activity.changed = state => {
        if (changed || state.actions[0]?.status !== 'accepted') return; changed = true;
        h.push('12', batch => change(batch.events[0].payload.projection));
      };
    }
    h.reply(); await sending; await settle();
    assert.equal(h.syncs().length, 1); assert.equal(h.syncs()[0].q.cursor, reentrant ? '12' : '11');
    assert.equal(h.client.state.actions[0].status, 'accepted');
  });
});

test('RC-06：首次实际发送前publish重入不能将旧envelope绑定到新地图', async t => {
  const h = await room(t); let changed = false;
  h.activity.changed = state => {
    if (changed || state.actions[0]?.status !== 'waiting') return; changed = true;
    h.push('11', batch => { batch.events[0].payload.projection.mapVersion = 'new-map'; });
  };
  const sending = h.send(); await settle(); assert.equal(h.client.state.snapshot.projection.mapVersion, 'new-map');
  assert.equal(h.actions[0].q.action.mapVersion, 'gray-map-v1'); h.reply(); await sending; await settle(); assert.equal(h.syncs().length, 1);
});

test('RC-06：控制、能力及重连围栏保留，新增判定异常只回退补读', async t => {
  for (const change of ['已安装新view', '控制pending', '撤掉timed', '重连', '判定抛错']) await t.test(change, async t => {
    const h = await room(t), sending = h.send(); await settle(); h.push('11'); let controlling, gate;
    if (change === '已安装新view') { await h.client.control('take'); await settle(); h.requests.length = 0; }
    else {
      let changed = false;
      h.activity.changed = state => {
        if (changed || state.actions[0]?.status !== 'accepted') return; changed = true;
        if (change === '控制pending') { gate = h.holdControl(); controlling = h.client.control('take'); }
        if (change === '撤掉timed') h.link.acceptedCapabilities = ['spatial-v2', 'spatial-direction-v1'];
        if (change === '重连') h.client.reconnect();
        if (change === '判定抛错') {
          const capabilities = h.link.acceptedCapabilities; let once = true;
          Object.defineProperty(h.link, 'acceptedCapabilities', { get() { if (once) { once = false; throw new Error('受控能力读取失败'); } return capabilities; } });
        }
      };
    }
    h.reply(); await sending; await settle();
    assert.equal(h.client.state.actions[0].status, 'accepted', '新增消重失败不能将已确认Receipt降为Unknown');
    if (change === '控制pending') {
      assert.equal(h.client.state.controlBusy, true); assert.equal(h.syncs().length, 0);
      gate.resolve(gate.response); await controlling; await settle(); assert.equal(h.syncs().length, 1); assert.equal(h.client.state.snapshot.viewId, 'controlled-4');
    } else if (change === '重连') {
      assert.equal(h.client.state.snapshot, null); h.link.handlers.connected(); await settle();
      assert.equal(h.syncs().length, 1); assert.equal(h.client.state.inputReady, false);
    } else assert.equal(h.syncs().length, 1);
  });
});

test('RC-06：ACK前actor变化触发原resync，旧link收据不能安装新授权', async t => {
  const h = await room(t), sending = h.send(); await settle();
  h.push('11', batch => {
    const p = batch.events[0].payload.projection, changed = 'self_1111111111111111111111111111111'; p.self.entityRef = changed; p.entities[0].entityRef = changed;
  });
  assert.equal(h.links.length, 2); assert.equal(h.client.state.snapshot, null);
  h.reply(); await sending; await settle(); assert.equal(h.client.state.actions[0].status, 'unknown');
  assert.equal(h.client.state.inputReady, false); assert.equal(h.syncs().length, 0);
});

test('RC-07：真实snapshot source与Motion保留未播motion/hold，收据不是paint且后续push照序接入', async t => {
  const h = await room(t), { source, publish } = createSpatialSnapshotSource(), motion = new ConfirmedMotion(), seen = []; let now = 0;
  publish(h.client.state.snapshot);
  const subscription = source.subscribe(snapshot => {
    if (snapshot) { seen.push(snapshot.snapshotSeq); motion.update(snapshot, now); } else motion.reset();
  }, error => { throw error; });
  t.after(() => subscription.close()); h.activity.changed = state => publish(state.snapshot);
  const sending = h.send(); await settle(); now = 100; const batch = h.push('11'), installed = h.client.state.snapshot;
  const before = motion.pose(selfRef, 150); assert.equal(before.position.x, 109); assert.equal(motion.settled(selfRef, 150), false);
  h.reply(); await sending; await settle(); assert.equal(h.syncs().length, 0); assert.deepEqual(seen, ['10', '11']);
  assert.deepEqual(motion.pose(selfRef, 150), before); assert.equal(motion.presentationCreditMs, 0);
  assert.strictEqual(h.client.state.snapshot, installed); assert.deepEqual(installed.projection.entities[0].motionTimeline, batch.events[0].payload.projection.entities[0].motionTimeline);
  now = 150; h.push('12'); assert.deepEqual(seen, ['10', '11', '12']);
  assert.equal(motion.pose(selfRef, 200).position.x, 118); assert.equal(motion.pose(selfRef, 210).moving, false, '原20ms hold没有被收据抵扣');
  assert.equal(motion.pose(selfRef, 270).position.x, 127); assert.equal(motion.pose(selfRef, 340).distance, 36);
  assert.equal(motion.settled(selfRef, 339), false); assert.equal(motion.settled(selfRef, 340), true); assert.equal(motion.presentationCreditMs, 0);
});
