import test from 'node:test';
import assert from 'node:assert/strict';
import { SpatialSessionClient } from '../src/network/spatial-session.ts';
import { spatialSnapshot, spatialBatch } from './spatial-fixture.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));
function harness({ hook = true, timed = true, subscribeBurst = false, onState = () => {} } = {}) {
  const initial = spatialSnapshot(), snapshots = [], requests = []; let handlers, syncBurst = false, controlBurst = false, current = initial, active = 0, maximum = 0, lastSnapshot, heldNext;
  const client = new SpatialSessionClient({ receipt: async () => null }, (_token, callbacks) => {
    handlers = callbacks; let connected = true; queueMicrotask(() => callbacks.connected());
    return { get connected() { return connected; }, acceptedCapabilities: timed ? ['spatial-direction-v1', 'spatial-timed-trail-v1'] : [], close() { connected = false; },
      request(event, raw, consume) {
        const request = typeof raw === 'string' ? JSON.parse(raw) : raw; requests.push({ event, request, hook: typeof consume === 'function' });
        if (event === 'sync.request' && heldNext) {
          const held = heldNext; heldNext = null; held.request = request; active++; maximum = Math.max(maximum, active);
          return new Promise((resolve, reject) => { held.deliver = value => { try { if (hook) consume?.(value); resolve(value); } catch (error) { reject(error); } finally { active--; } }; });
        }
        return new Promise((resolve, reject) => {
          if (event === 'sync.request') { active++; maximum = Math.max(maximum, active); }
          try {
            let reply, push;
            if (event === 'session.subscribe') { reply = structuredClone(initial); if (subscribeBurst) { push = spatialBatch(initial, '11'); current = { ...initial, snapshotSeq: '11' }; } }
            else if (event.startsWith('control.')) {
              current = { ...structuredClone(initial), viewId: 'controlled', snapshotSeq: '20' }; current.projection.self.controlEpoch = '3';
              reply = { schemaVersion: 2, sessionId: initial.sessionId, nonce: request.nonce, controlEpoch: '3', observedSeq: '20', snapshot: current };
              if (controlBurst) { push = spatialBatch(current, '21'); current = { ...current, snapshotSeq: '21' }; }
            } else if (syncBurst) {
              syncBurst = false; reply = { ...spatialBatch({ ...current, snapshotSeq: request.cursor }, '11'), syncFrontierSeq: '11' };
              push = spatialBatch({ ...current, snapshotSeq: '11' }, '12'); current = { ...current, snapshotSeq: '12' };
            } else reply = { schemaVersion: 2, type: 'world.batch', sessionId: request.sessionId, viewId: request.viewId, fromExclusive: request.cursor, throughSeq: request.cursor, events: [] };
            if (hook) consume?.(reply);
            if (push) callbacks.batch(push);
            resolve(reply);
          } catch (error) { reject(error); }
          finally { if (event === 'sync.request') active--; }
        });
      } };
  }, { heartbeatMs: 0, reconnectDelayMs: 0, onChange(state) { if (state.snapshot && lastSnapshot !== state.snapshot) { lastSnapshot = state.snapshot; snapshots.push(state.snapshot); } onState(state); } });
  return { client, initial, snapshots, requests, get handlers() { return handlers; }, get maximum() { return maximum; }, burstSync() { syncBurst = true; }, burstControl() { controlBurst = true; }, holdSync() { const held = {}; heldNext = held; return held; },
    async open() { client.open(initial.sessionId, 'token'); await flush(); } };
}

test('SUP-03：同步ACK与紧接push同turn到达时依次应用11/12恰一次', async t => {
  const h = harness(); t.after(() => h.client.close()); await h.open(); h.snapshots.length = 0; h.burstSync();
  await h.client.sync(); await flush(); assert.deepEqual(h.snapshots.map(value => value.snapshotSeq), ['11', '12']); assert.equal(h.maximum, 1);
});
test('SUP-03：subscribe/control的snapshot也在紧接的新binding push之前安装', async t => {
  const h = harness({ subscribeBurst: true }); t.after(() => h.client.close()); await h.open();
  assert.deepEqual(h.snapshots.map(value => value.snapshotSeq), ['10', '11']); h.snapshots.length = 0; h.burstControl();
  await h.client.control('resume'); await flush(); assert.deepEqual(h.snapshots.map(value => value.snapshotSeq), ['20', '21']); assert.equal(h.client.state.inputReady, true);
});
test('SUP-03：旧transport不提供hook时，缺hook兼容仍只在await后应用一次', async t => {
  const h = harness({ hook: false }); t.after(() => h.client.close()); await h.open();
  assert.deepEqual(h.snapshots.map(value => value.snapshotSeq), ['10']); await h.client.control('resume');
  assert.equal(h.client.state.snapshot.viewId, 'controlled'); assert.deepEqual(h.snapshots.map(value => value.snapshotSeq), ['10', '20']);
});
test('SUP-03：未协商新模式的旧调用不安装同步消费hook', async t => {
  const h = harness({ timed: false }); t.after(() => h.client.close()); await h.open(); await h.client.control('resume');
  assert.equal(h.client.state.timedTrail, false); assert.ok(h.requests.every(request => !request.hook));
});
test('SUP-03：同link旧view ACK不能覆盖控制，新view等待原物理sync；真实撤权仍优先', async t => {
  for (const forbidden of [false, true]) await t.test(forbidden ? '真实撤权' : '旧数据', async t => {
    const h = harness(); t.after(() => h.client.close()); await h.open(); const held = h.holdSync(), round = h.client.sync(); await flush();
    await h.client.control('resume'); assert.equal(h.client.state.snapshot.viewId, 'controlled');
    held.deliver(forbidden ? { schemaVersion: 2, code: 'FORBIDDEN', message: '本局访问已撤销。' } : spatialBatch(h.initial, '11'));
    await round; await flush(); assert.equal(h.maximum, 1);
    if (forbidden) { assert.equal(h.client.state.connection, 'forbidden'); assert.equal(h.client.state.snapshot, null); }
    else { assert.equal(h.client.state.snapshot.viewId, 'controlled'); assert.equal(h.client.state.snapshot.snapshotSeq, '20'); }
  });
});
test('SUP-03：旧link的迟到撤权回调不能撤销已建立的新link', async t => {
  const h = harness(); t.after(() => h.client.close()); await h.open(); const held = h.holdSync(), round = h.client.sync(); await flush();
  h.client.reconnect(); await flush(); held.deliver({ schemaVersion: 2, code: 'FORBIDDEN', message: '旧连接错误' }); await round;
  assert.equal(h.client.state.connection, 'online'); assert.equal(h.client.state.snapshot.snapshotSeq, '10');
});
test('SUP-03：View接受后核心消费异常仍释放sync槽，后续从已接受游标补读，不重放', async t => {
  let fail = false;
  const h = harness({ onState: state => { if (fail && state.snapshot?.snapshotSeq === '11') { fail = false; throw new Error('受控核心消费异常'); } } });
  t.after(() => h.client.close()); await h.open(); fail = true;
  const held = h.holdSync(), round = h.client.sync(); held.deliver({ ...spatialBatch(h.initial, '11'), syncFrontierSeq: '11' }); await round;
  assert.equal(h.client.state.snapshot.snapshotSeq, '11');
  const next = h.holdSync(), second = h.client.sync(); assert.equal(next.request.cursor, '11');
  next.deliver({ ...spatialBatch({ ...h.initial, snapshotSeq: '11' }, '12'), syncFrontierSeq: '12' }); await second;
  assert.deepEqual(h.snapshots.map(value => value.snapshotSeq), ['10', '11', '12']); assert.equal(h.maximum, 1);
});
