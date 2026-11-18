import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createSpatialSupply } from '../spatial-supply.mjs';
import { supplyLoopback } from '../test-support/supply-loopback.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const caps = ['spatial-v2', 'spatial-direction-v1', 'spatial-timed-trail-v1'];
const raw = (view, cursor = '40') => JSON.stringify({ schemaVersion: 2, type: 'sync.request', sessionId: view.sessionId, viewId: view.viewId, cursor });
const batch = (request, through, frontier = through) => ({ schemaVersion: 2, type: 'world.batch', sessionId: request.sessionId, viewId: request.viewId, fromExclusive: request.cursor, throughSeq: through, syncFrontierSeq: frontier, events: [] });
async function fixture(t, { baseline = true } = {}) {
  const h = await supplyLoopback(t), runtime = new EventEmitter(), connection = { capabilities: caps, closing: false, viewScopeFence: 1 };
  let view, pending = false;
  const replace = (id, cursor) => { if (view) view.active = false; view = { active: true, schemaVersion: 2, sessionId: 'room', viewId: id, cursor, handle: h.handle, scope: { generation: 1 } }; return view; };
  replace('view-one', '40');
  Object.assign(runtime, { spatialDirection: { checkpointMs: 50 }, connection: () => connection, connectionView: () => view, pendingViewInstallation: () => pending,
    retireView: old => { old.active = false; if (old === view) view = null; }, sync: async (_handle, value) => batch(JSON.parse(value), '45') });
  const supply = createSpatialSupply(runtime);
  const install = async () => { const slot = await h.reserve(); supply.snapshot(h.handle, { schemaVersion: 2, type: 'world.snapshot', sessionId: view.sessionId, viewId: view.viewId, snapshotSeq: view.cursor }, slot.send); await slot.reply; };
  if (baseline) await install();
  return { ...h, runtime, supply, connection, replace, install, view: () => view, pending: value => { pending = value; } };
}

test('D66-SUP-01：RPC与publisher共享单读→发送槽，installed和sent各守原义', async t => {
  const f = await fixture(t), gate = deferred(), entered = deferred(), calls = [];
  f.runtime.sync = async (_h, value) => { const request = JSON.parse(value); calls.push(request.cursor); if (calls.length === 1) { entered.resolve(); await gate.promise; } return batch(request, calls.length === 1 ? '45' : '48'); };
  const slot = await f.reserve(), rpc = f.supply.sync(f.handle, raw(f.view()), slot.send); await entered.promise;
  const pub = f.supply.publish(f.view(), '48', f.push); await tick(); assert.deepEqual(calls, ['40']);
  gate.resolve(); await rpc; await slot.reply; await pub;
  assert.deepEqual(calls, ['40', '45']); assert.equal(f.supply.cursor(f.view()), '48'); assert.equal(f.view().cursor, '40');
});
test('D66-SUP-01：反向发布后旧请求只读服务器已发前缀，客户端不能申报跳头', async t => {
  const f = await fixture(t), reads = [];
  f.runtime.sync = async (_h, value, options = {}) => { const request = JSON.parse(value); reads.push({ cursor: request.cursor, ...options }); return batch(request, options.throughSeqCeiling ?? '48', '60'); };
  await f.supply.publish(f.view(), '48', f.push);
  const slot = await f.reserve(); await f.supply.sync(f.handle, raw(f.view()), slot.send);
  assert.deepEqual(reads, [{ cursor: '40' }, { cursor: '40', throughSeqCeiling: '48' }]);
  assert.equal((await slot.reply).throughSeq, '48'); assert.equal(f.supply.cursor(f.view()), '48');
  await assert.rejects(f.supply.sync(f.handle, raw(f.view(), '49'), () => true), { code: 'RESYNC_REQUIRED' }); assert.equal(reads.length, 2);
});
test('RRS-T04：真实ACK超时不取消前置RPC，下一旧请求保留历史补读与RPC优先', { timeout: 10000 }, async t => {
  const f = await fixture(t), entered = deferred(), release = deferred(), calls = [];
  let active = 0, maxActive = 0, firstSettled = false, first, second, publishing;
  f.runtime.sync = async (_handle, value, options = {}) => {
    const request = JSON.parse(value), index = calls.length;
    calls.push({ cursor: request.cursor, ...options }); active++; maxActive = Math.max(maxActive, active);
    try {
      if (index === 0) { entered.resolve(); await release.promise; }
      return batch(request, options.throughSeqCeiling ?? (index === 0 ? '45' : '48'), '48');
    } finally { active--; }
  };
  try {
    const oldSlot = await f.reserve();
    const timedOut = assert.rejects(oldSlot.reply, /timed out/);
    first = f.supply.sync(f.handle, raw(f.view()), oldSlot.send);
    first.then(() => { firstSettled = true; }, () => { firstSettled = true; });
    await entered.promise; await timedOut;
    assert.equal(firstSettled, false); assert.equal(f.supply.cursor(f.view()), '40');
    const nextSlot = await f.reserve();
    second = f.supply.sync(f.handle, raw(f.view()), nextSlot.send);
    publishing = f.supply.publish(f.view(), '48', f.push);
    await tick(); assert.equal(calls.length, 1, '客户端超时不释放服务端lane');
    release.resolve(); await Promise.all([first, second, publishing]);
    const recovered = await nextSlot.reply;
    assert.equal(recovered.fromExclusive, '40'); assert.equal(recovered.throughSeq, '45');
    assert.deepEqual(calls, [{ cursor: '40' }, { cursor: '40', throughSeqCeiling: '45' }, { cursor: '45' }]);
    assert.equal(maxActive, 1); assert.equal(f.supply.cursor(f.view()), '48'); assert.equal(f.view().cursor, '40');
  } finally { release.resolve(); await Promise.allSettled([first, second, publishing].filter(Boolean)); }
});
test('D66-SUP-01：最多一活动读、一等待RPC、一合并publisher，RPC优先且无并发扩张', async t => {
  const f = await fixture(t), gate = deferred(), entered = deferred(), calls = []; let active = 0, maxActive = 0;
  f.runtime.sync = async (_h, value) => { const request = JSON.parse(value), at = calls.length; calls.push(request.cursor); active++; maxActive = Math.max(maxActive, active); if (at === 0) { entered.resolve(); await gate.promise; } active--; return batch(request, ['41', '42', '50'][at]); };
  const first = await f.reserve(), second = await f.reserve();
  const a = f.supply.sync(f.handle, raw(f.view()), first.send); await entered.promise;
  const b = f.supply.sync(f.handle, raw(f.view(), '41'), second.send);
  await assert.rejects(f.supply.sync(f.handle, raw(f.view()), () => true), { code: 'RESYNC_REQUIRED' });
  const p = f.supply.publish(f.view(), '48', f.push), p2 = f.supply.publish(f.view(), '50', f.push); assert.equal(p, p2);
  gate.resolve(); await Promise.all([a, b, p, first.reply, second.reply]);
  assert.deepEqual(calls, ['40', '41', '42']); assert.equal(maxActive, 1); assert.equal(f.supply.cursor(f.view()), '50');
});
test('D66-SUP-02：安装但未真实发snapshot不建水位；空deliver失败并要求保留Pending', async t => {
  const f = await fixture(t, { baseline: false }); let reads = 0;
  f.runtime.sync = async (_h, value) => { reads++; return batch(JSON.parse(value), '45'); };
  assert.equal(f.supply.cursor(f.view()), null); assert.deepEqual(await f.supply.publish(f.view(), '45', f.push), { blocked: true });
  await assert.rejects(f.supply.sync(f.handle, raw(f.view()), () => true), { code: 'RESYNC_REQUIRED' }); assert.equal(reads, 0);
  await f.install(); const old = f.view();
  await assert.rejects(f.supply.publish(old, '45', () => true), error => error.code === 'RESYNC_REQUIRED' && error.keepSpatialPending === true);
  assert.equal(f.supply.cursor(old), null); assert.equal(old.active, false); assert.equal(old.cursor, '40');
});
test('D66-SUP-02：旧view读settle前新view等待；旧回复不得安装或撤销新binding', async t => {
  const f = await fixture(t), gate = deferred(), entered = deferred(), calls = [];
  f.runtime.sync = async (_h, value) => { const r = JSON.parse(value); calls.push(r.viewId); if (r.viewId === 'view-one') { entered.resolve(); await gate.promise; } return batch(r, r.viewId === 'view-one' ? '45' : '51'); };
  const oldSlot = await f.reserve(), old = f.supply.sync(f.handle, raw(f.view()), oldSlot.send); old.catch(() => {}); await entered.promise;
  f.replace('view-two', '50'); await f.install();
  const slot = await f.reserve(), latest = f.supply.sync(f.handle, raw(f.view(), '50'), slot.send);
  await tick(); assert.deepEqual(calls, ['view-one']); gate.resolve();
  await assert.rejects(old, { code: 'RESYNC_REQUIRED' }); await latest; await slot.reply;
  assert.deepEqual(calls, ['view-one', 'view-two']); assert.equal(f.supply.cursor(f.view()), '51'); assert.equal(f.view().active, true);
});
test('D66-SUP-02：publisher过时候选不裁段，只对新已发baseline有界再读一次', async t => {
  const f = await fixture(t), calls = [];
  f.runtime.sync = async (_h, value) => {
    const request = JSON.parse(value); calls.push(request.cursor);
    f.replace(`view-${calls.length + 1}`, String(50 + calls.length)); await f.install();
    return batch(request, String(Number(request.cursor) + 1));
  };
  let sent = 0;
  assert.deepEqual(await f.supply.publish(f.view(), '60', () => { sent++; }), { blocked: true });
  assert.deepEqual(calls, ['40', '51']); assert.equal(sent, 0); assert.equal(f.supply.cursor(f.view()), '52');
});
test('D66-SUP-02：旧view行锁后RESYNC仅重读新baseline，真正撤权错误不能吞掉', async t => {
  const f = await fixture(t), calls = [];
  f.runtime.sync = async (_h, value) => {
    const request = JSON.parse(value); calls.push(request.cursor);
    if (calls.length === 1) { f.replace('view-two', '50'); await f.install(); throw Object.assign(new Error('旧view已换'), { code: 'RESYNC_REQUIRED' }); }
    return batch(request, '60');
  };
  assert.equal((await f.supply.publish(f.view(), '60', f.push)).covered, true); assert.deepEqual(calls, ['40', '50']);
  f.runtime.sync = async () => { f.replace('view-three', '60'); await f.install(); throw Object.assign(new Error('真实撤权'), { code: 'FORBIDDEN' }); };
  await assert.rejects(f.supply.publish(f.view(), '61', f.push), { code: 'FORBIDDEN' });
});
test('D66-SUP-02：安装/fence守卫、功能OFF和方向-only不借新模式授予发送事实', async t => {
  const f = await fixture(t); let reads = 0; f.runtime.sync = async () => { reads++; };
  f.pending(true); assert.deepEqual(await f.supply.publish(f.view(), '45', f.push), { blocked: true }); f.pending(false);
  f.connection.viewScopeFence = 2; assert.deepEqual(await f.supply.publish(f.view(), '45', f.push), { blocked: true }); assert.equal(reads, 0);
  f.connection.capabilities = ['spatial-v2', 'spatial-direction-v1']; assert.equal(f.supply.enabled(f.handle), false);
  f.connection.capabilities = caps; f.runtime.spatialDirection = null; assert.equal(f.supply.enabled(f.handle), false);
});

test('Y-T1：非空publisher在原读finally后让出，真实proof前水位不前进', async t => {
  const f = await fixture(t), order = []; let beforeSend;
  f.runtime.sync = async (_handle, value) => {
    try { return batch(JSON.parse(value), '45'); }
    finally {
      order.push('read-finished');
      setImmediate(() => { order.push('io-opportunity'); beforeSend = f.supply.cursor(f.view()); });
    }
  };
  const result = await f.supply.publish(f.view(), '45', (value, binding) => {
    order.push('send'); assert.equal(f.supply.cursor(binding), '40'); return f.push(value, binding);
  });
  await tick();
  assert.deepEqual(order, ['read-finished', 'io-opportunity', 'send']);
  assert.equal(beforeSend, '40'); assert.equal(f.supply.cursor(f.view()), '45'); assert.equal(f.view().cursor, '40');
  assert.deepEqual(result, { covered: true, progressed: true });
});

test('Y-T2：让出期间保持活动lane，随后RPC仍先于等待publisher并沿真实sent续读', async t => {
  const f = await fixture(t), slot = await f.reserve(), calls = []; let rpc, next, during;
  f.runtime.sync = async (_handle, value, options = {}) => {
    const request = JSON.parse(value), index = calls.length;
    calls.push({ cursor: request.cursor, ...options });
    if (index === 0) setImmediate(() => {
      rpc = f.supply.sync(f.handle, raw(f.view()), slot.send); rpc.catch(() => {});
      next = f.supply.publish(f.view(), '50', f.push); next.catch(() => {});
      queueMicrotask(() => { during = { reads: calls.length, sent: f.supply.cursor(f.view()) }; });
    });
    return batch({ ...request, cursor: options.sentPrefixStart ?? request.cursor }, ['45', '48', '50'][index]);
  };
  const first = f.supply.publish(f.view(), '45', f.push);
  try {
    await first;
    assert.deepEqual(during, { reads: 1, sent: '40' });
    assert.ok(rpc && next); await Promise.all([rpc, next]);
    const reply = await slot.reply;
    assert.equal(reply.fromExclusive, '45'); assert.equal(reply.throughSeq, '48');
    assert.deepEqual(calls, [{ cursor: '40' }, { cursor: '40', sentPrefixStart: '45' }, { cursor: '48' }]);
    assert.equal(f.supply.cursor(f.view()), '50'); assert.equal(f.view().cursor, '40');
  } finally { await Promise.allSettled([first, rpc, next].filter(Boolean)); }
});

test('Y-T3：让出期间失效不发旧候选，重绑定仍只有原两次attempt', async t => {
  for (const changes of [1, 2]) await t.test(`连续更换${changes}次binding`, async t => {
    const f = await fixture(t), slots = [], calls = [], sent = [];
    for (let index = 0; index < changes; index++) slots.push(await f.reserve());
    f.runtime.sync = async (_handle, value) => {
      const request = JSON.parse(value), index = calls.length; calls.push(request.viewId);
      if (index < changes) setImmediate(() => {
        const view = f.replace(`view-${index + 2}`, String(50 + index * 10));
        f.supply.snapshot(f.handle, { schemaVersion: 2, type: 'world.snapshot', sessionId: view.sessionId,
          viewId: view.viewId, snapshotSeq: view.cursor }, slots[index].send);
      });
      return batch(request, String(Number(request.cursor) + 5));
    };
    const result = await f.supply.publish(f.view(), '55', (value, binding) => { sent.push(value.viewId); return f.push(value, binding); });
    await Promise.all(slots.map(slot => slot.reply));
    assert.deepEqual(calls, ['view-one', 'view-2']);
    assert.deepEqual(sent, changes === 1 ? ['view-2'] : []);
    assert.deepEqual(result, changes === 1 ? { covered: true, progressed: true } : { blocked: true });
    assert.equal(f.supply.cursor(f.view()), changes === 1 ? '55' : '60');
  });
  for (const [name, invalidate] of [
    ['pending', f => f.pending(true)], ['closing', f => { f.connection.closing = true; }],
    ['scope fence', f => { f.connection.viewScopeFence = 2; }],
  ]) await t.test(name, async t => {
    const f = await fixture(t); let reads = 0, sends = 0;
    f.runtime.sync = async (_handle, value) => { reads++; setImmediate(() => invalidate(f)); return batch(JSON.parse(value), '45'); };
    assert.deepEqual(await f.supply.publish(f.view(), '45', (value, binding) => { sends++; return f.push(value, binding); }), { blocked: true });
    assert.equal(reads, 1); assert.equal(sends, 0); assert.equal(f.supply.cursor(f.view()), '40');
  });
});

test('Y-T4：让出期间的新head不改原完整批次，真实发送后current失效仍不能推进水位', async t => {
  await t.test('固定已读批次', async t => {
    const f = await fixture(t), sent = []; let head = '45', reads = 0;
    f.runtime.sync = async (_handle, value) => {
      reads++; const candidate = batch(JSON.parse(value), head); setImmediate(() => { head = '90'; }); return candidate;
    };
    assert.deepEqual(await f.supply.publish(f.view(), '45', (value, binding) => { sent.push(value); return f.push(value, binding); }), { covered: true, progressed: true });
    assert.equal(head, '90'); assert.equal(reads, 1); assert.deepEqual(sent, [batch(JSON.parse(raw(f.view())), '45')]);
    assert.equal(f.supply.cursor(f.view()), '45'); assert.equal(f.view().cursor, '40');
  });
  await t.test('真实packet后current失败保留Pending', async t => {
    const f = await fixture(t), view = f.view(); let yielded = false, sentAfterYield = false;
    f.runtime.sync = async (_handle, value) => { setImmediate(() => { yielded = true; }); return batch(JSON.parse(value), '45'); };
    await assert.rejects(f.supply.publish(view, '45', (value, binding) => {
      sentAfterYield = yielded; const proof = f.push(value, binding); f.connection.closing = true; return proof;
    }), error => error.code === 'RESYNC_REQUIRED' && error.keepSpatialPending === true);
    assert.equal(sentAfterYield, true); assert.equal(view.active, false); assert.equal(view.cursor, '40'); assert.equal(f.supply.cursor(view), null);
  });
});

test('Y-T5：ACK、空批、已覆盖、旧能力与原读错误不增加publisher等待', async t => {
  for (const mode of ['ack', 'empty', 'covered', 'off', 'legacy', 'direction-only', 'FORBIDDEN', 'OUTCOME_UNKNOWN']) await t.test(mode, async t => {
    const f = await fixture(t); let opportunity = false, reads = 0, sends = 0;
    if (mode === 'off') f.runtime.spatialDirection = null;
    if (mode === 'legacy') f.connection.capabilities = ['spatial-v1'];
    if (mode === 'direction-only') f.connection.capabilities = ['spatial-v2', 'spatial-direction-v1'];
    const slot = mode === 'ack' ? await f.reserve() : null;
    f.runtime.sync = async (_handle, value) => {
      reads++;
      if (mode === 'FORBIDDEN' || mode === 'OUTCOME_UNKNOWN') throw Object.assign(new Error('原读失败'), { code: mode });
      return batch(JSON.parse(value), mode === 'empty' ? '40' : '45');
    };
    setImmediate(() => { opportunity = true; });
    if (slot) {
      await f.supply.sync(f.handle, raw(f.view()), slot.send);
    } else {
      const work = f.supply.publish(f.view(), mode === 'covered' ? '40' : '45', (value, binding) => { sends++; return f.push(value, binding); });
      if (mode === 'FORBIDDEN' || mode === 'OUTCOME_UNKNOWN') await assert.rejects(work, { code: mode });
      else assert.deepEqual(await work, mode === 'covered' ? { covered: true } : mode === 'empty' ? { blocked: true } : { covered: true, progressed: true });
    }
    assert.equal(opportunity, false, '上述路径不等待下一Immediate阶段');
    assert.equal(reads, mode === 'covered' ? 0 : 1);
    if (!slot) assert.equal(sends, ['off', 'legacy', 'direction-only'].includes(mode) ? 1 : 0);
    if (slot) await slot.reply;
    await tick();
  });
});
