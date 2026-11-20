/** NSO唯一有限入口：原生node:test/TAP；只在根单独释放后执行共享实现。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyInvocation, repository, methodDirectory, sha256, writeExclusive } from './guard.mjs';
import { installPageProbe } from './page-probe.mjs';
import { createNodeProbe } from './node-probe.mjs';
import { createColdHooks } from './cold-hooks.mjs';
import { createLoadHook, DEFINITIONS } from './loader-hooks.mjs';
import { validateRaw, validateCold, validateShape } from './envelope.mjs';
import { SCHEMA } from './schema.mjs';
import { ENVELOPE } from './envelope-schema.mjs';
import { enqueueSocketPacket, consumeQueuedPacket } from '../../../backend/socket-enqueue.mjs';

const { config, output } = verifyInvocation('finite');
const cases = [], outcomes = [];
const add = (id, name, work) => cases.push({ id, name, work });
const batch = () => ({ schemaVersion: 2, type: 'world.batch', sessionId: 'finite-session', viewId: 'finite-view',
  fromExclusive: '1', throughSeq: '2', events: [] });
const packet = value => ({ type: 2, nsp: '/', data: ['world.batch', value] });
const cell = (raw, row, name) => row[[...SCHEMA.common, ...SCHEMA.tails[raw.kinds[row[1]]]].indexOf(name)];
function pageWorld() {
  const calls = [], behaviors = new Map(), host = {}, clock = { value: 100, reads: 0, fail: false };
  const invoke = (kind, receiver, args) => { calls.push({ kind, receiver, args });
    return behaviors.has(kind) ? Reflect.apply(behaviors.get(kind), receiver, args) : kind === 2 ? 'applied' : undefined; };
  class Manager { ondecoded(...args) { return invoke(0, this, args); } }
  class Socket { constructor(io) { this.io = io; this.nsp = '/'; } onpacket(...args) { return invoke(1, this, args); } }
  class SpatialView { applyBatch(...args) { return invoke(2, this, args); } }
  const manager = new Manager(), socket = new Socket(manager), view = new SpatialView();
  const slots = [[Manager.prototype, 'ondecoded', manager], [Socket.prototype, 'onpacket', socket], [SpatialView.prototype, 'applyBatch', view]]
    .map(([prototype, name, receiver]) => ({ prototype, name, receiver, original: Object.getOwnPropertyDescriptor(prototype, name) }));
  const fixtures = extra => ({ Manager, Socket, SpatialView, host, now: () => {
    clock.reads++; if (clock.fail) throw Error('受控时钟错误'); return ++clock.value;
  }, ...extra });
  return { Manager, Socket, SpatialView, manager, socket, view, host, calls, behaviors, clock, slots, fixtures,
    invoke(kind, args) { const slot = slots[kind]; return Reflect.apply(slot.prototype[slot.name], slot.receiver, args); },
    restored(except = []) { for (const [index, slot] of slots.entries()) if (!except.includes(index))
      assert.deepEqual(Object.getOwnPropertyDescriptor(slot.prototype, slot.name), slot.original);
      assert.equal(Object.getOwnPropertyDescriptor(host, '__xiyouNormalSupplyObservation'), undefined); },
  };
}
async function installPage(world, extra = {}) {
  const setup = await installPageProbe(config, world.fixtures(extra)); assert.equal(setup.installed, true); return setup.api;
}
function nodeWorld(original = () => undefined, extra = {}) {
  const runtime = new EventEmitter(), order = [], clock = { reads: 0, value: 100 };
  runtime.on('commit', () => order.push('original'));
  const probe = createNodeProbe(config, { now: () => { clock.reads++; return ++clock.value; }, ...extra });
  let binding = original;
  probe.bind(original, () => binding, value => { binding = value; }); probe.activate(runtime);
  return { runtime, order, probe, clock, invoke(receiver, args) { return Reflect.apply(binding, receiver, args); },
    bound() { return binding; }, restored() { assert.equal(binding, original); assert.equal(runtime.listeners('commit').length, 1); } };
}
function commit(runtime, suffix = '2') {
  runtime.emit('commit', { sessionId: 'finite-session', events: [{ sessionSeq: '1' }, { sessionSeq: suffix }] });
}
function adapterInput({ failSend = false, current = () => true, kind = 'push' } = {}) {
  const connection = new EventEmitter(); connection.readyState = 'open';
  const handle = { connectionId: 'connection-one' }, binding = {}, value = batch();
  const socket = { conn: connection, connected: true, data: { handle }, nsp: { name: '/' } };
  let sends = 0, currents = 0;
  const input = { sockets: new Map([[handle.connectionId, socket]]), handle, binding, value, kind,
    current() { currents++; return current(); },
    send() { sends++; if (failSend) throw Error('原发送异常'); connection.emit('packetCreate', {
      type: 'message', data: kind === 'push' ? '2' + JSON.stringify(['world.batch', value]) : '31' + JSON.stringify([value]) }); },
  };
  return { input, counts: () => ({ sends, currents }), consume: proof => consumeQueuedPacket(proof, handle, binding, value, kind) };
}

add('NSO-F01', 'Page三入口保留this、全部args、metadata、原返回及恰一次', async () => {
  const world = pageWorld(), api = await installPage(world);
  for (let kind = 0; kind < 3; kind++) {
    const value = batch(), metadata = {}, extra = {}, args = kind === 2 ? [value, 9, metadata, extra] : [packet(value), metadata, extra];
    const returned = {}; world.behaviors.set(kind, function () { return returned; });
    assert.equal(world.invoke(kind, args), returned);
    const actual = world.calls.at(-1); assert.equal(actual.receiver, world.slots[kind].receiver); assert.equal(actual.args.length, args.length);
    for (let index = 0; index < args.length; index++) assert.equal(actual.args[index], args[index]);
  }
  assert.equal(world.calls.length, 3); const raw = api.stop(); validateRaw(raw, config); assert.equal(raw.terminal.valid, true); world.restored();
});
add('NSO-F02', 'Page不订阅返回Promise或访问then，保留同一对象', async () => {
  const world = pageWorld(), api = await installPage(world); let thenReads = 0;
  const returned = Object.create(null, { then: { get() { thenReads++; throw Error('不得读取then'); } } });
  world.behaviors.set(2, () => returned); assert.equal(world.invoke(2, [batch(), 1, {}]), returned); assert.equal(thenReads, 0);
  const promise = Promise.resolve('known'); world.behaviors.set(2, () => promise); assert.equal(world.invoke(2, [batch(), 1]), promise);
  const raw = api.stop(); assert.equal(thenReads, 0); validateRaw(raw, config); world.restored();
});
add('NSO-F03', 'Page原异常身份与原message getter零读取', async () => {
  const world = pageWorld(), api = await installPage(world); let reads = 0;
  const failure = Object.create(null, { message: { get() { reads++; throw Error('不得读取message'); } } });
  world.behaviors.set(2, () => { throw failure; }); let caught;
  try { world.invoke(2, [batch(), 1]); } catch (error) { caught = error; }
  assert.equal(caught, failure); assert.equal(reads, 0); const raw = api.stop();
  assert.equal(raw.terminal.threw, 1); validateRaw(raw, config); assert.equal(reads, 0); world.restored();
});
add('NSO-F04', 'Page真实对象关系跨原微任务保持但不伪造同步parent', async () => {
  const world = pageWorld(), api = await installPage(world), value = batch(), envelope = packet(value);
  world.behaviors.set(0, original => { Promise.resolve().then(() => world.socket.onpacket(original)); });
  world.behaviors.set(1, original => world.view.applyBatch(original.data[1], 7, {}));
  world.manager.ondecoded(envelope); await Promise.resolve();
  const raw = api.stop(); validateRaw(raw, config); assert.equal(raw.rows.length, 3);
  assert.equal(cell(raw, raw.rows[0], 'packet'), cell(raw, raw.rows[1], 'packet'));
  assert.equal(cell(raw, raw.rows[1], 'payload'), cell(raw, raw.rows[2], 'payload'));
  assert.equal(cell(raw, raw.rows[1], 'parent'), null); assert.equal(cell(raw, raw.rows[2], 'parent'), raw.rows[1][0]); world.restored();
});
add('NSO-F05', 'Page同范围不同payload不被合并，非applied结果原样', async () => {
  const world = pageWorld(), api = await installPage(world);
  for (const result of ['applied', 'duplicate', 'refetch', 'stale', 'resync']) {
    world.behaviors.set(2, () => result); assert.equal(world.invoke(2, [batch(), 3, {}]), result);
  }
  const raw = api.stop(); validateRaw(raw, config);
  assert.equal(new Set(raw.rows.map(row => cell(raw, row, 'payload'))).size, 5);
  assert.deepEqual(raw.rows.map(row => SCHEMA.enums.result[row[10]]), ['applied', 'duplicate', 'refetch', 'stale', 'resync']); world.restored();
});
add('NSO-F06', 'own-data不调用输入getter，原消费者仍可按原位置调用', async () => {
  const world = pageWorld(), api = await installPage(world); let reads = 0;
  const value = batch(); Object.defineProperty(value, 'sessionId', { get() { reads++; return 'finite-session'; } });
  world.behaviors.set(2, original => { assert.equal(original.sessionId, 'finite-session'); return 'applied'; });
  world.invoke(2, [value, 1]); assert.equal(reads, 1);
  const raw = api.stop(); assert.equal(reads, 1); assert.equal(cell(raw, raw.rows[0], 'sessionId'), null); validateRaw(raw, config); world.restored();
});
add('NSO-F07', '反射失败不替代原异常；随后封口纯委托', async () => {
  const world = pageWorld(), api = await installPage(world), failure = Error('原异常'); let reflected = 0;
  const value = new Proxy({}, { getOwnPropertyDescriptor() { reflected++; throw Error('观察反射失败'); } });
  world.behaviors.set(2, () => { throw failure; }); let caught;
  try { world.invoke(2, [value, 1]); } catch (error) { caught = error; }
  assert.equal(caught, failure); const count = world.clock.reads;
  try { world.invoke(2, [value, 1]); } catch (error) { assert.equal(error, failure); }
  assert.equal(world.clock.reads, count); assert.equal(reflected, 1); assert.equal(world.calls.length, 2);
  const raw = api.stop(); assert.equal(raw.terminal.valid, false); assert.equal(raw.terminal.seen, 1); validateRaw(raw, config); world.restored();
});
add('NSO-F08', '行数上限保留前缀，原函数不被截断', async () => {
  const world = pageWorld(), api = await installPage(world, { limits: { maxRows: 1 } });
  world.invoke(2, [batch(), 1]); world.invoke(2, [batch(), 1]); const clock = world.clock.reads;
  world.invoke(2, [batch(), 1]); assert.equal(world.clock.reads, clock); assert.equal(world.calls.length, 3);
  const raw = api.stop(); assert.equal(raw.rows.length, 1); assert.equal(raw.terminal.dropped, 1); assert.equal(raw.terminal.valid, false); validateRaw(raw, config); world.restored();
});
add('NSO-F09', '独立字节上限在第二行入账前封口', async () => {
  const world = pageWorld(), api = await installPage(world, { limits: { rawMaxBytes: 65536 + 26 * 32 + 3 } });
  world.manager.ondecoded({}); world.manager.ondecoded({});
  const raw = api.stop(); assert.equal(raw.rows.length, 1); assert.equal(raw.terminal.dropped, 1);
  assert.equal(raw.terminal.reservedBytes, 65536 + 26 * 32 + 3); assert.equal(raw.terminal.valid, false); validateRaw(raw, config); world.restored();
});
add('NSO-F10', 'identity上限不保留部分不完整行', async () => {
  const world = pageWorld(), api = await installPage(world, { limits: { maxObjects: 1 } });
  world.manager.ondecoded(packet(batch())); const raw = api.stop();
  assert.equal(raw.rows.length, 0); assert.equal(raw.terminal.dropped, 1); assert.equal(world.calls.length, 1); assert.equal(raw.terminal.valid, false); validateRaw(raw, config); world.restored();
});
add('NSO-F11', '部分Page安装恢复已改描述符', async () => {
  const world = pageWorld(); Object.defineProperty(world.Socket.prototype, 'onpacket', { ...world.slots[1].original, configurable: false });
  const setup = await installPageProbe(config, world.fixtures()); assert.equal(setup.installed, false);
  const raw = setup.api.stop(); assert.equal(raw.terminal.valid, false); validateRaw(raw, config); world.restored([1]);
});
add('NSO-F12', '停采恢复与已绑定wrapper纯委托', async () => {
  const world = pageWorld(), api = await installPage(world), bound = world.view.applyBatch.bind(world.view);
  bound(batch(), 1, {}); const raw = api.stop(), frozen = JSON.stringify(raw), clock = world.clock.reads;
  assert.equal(bound(batch(), 2, {}), 'applied'); assert.equal(world.clock.reads, clock); assert.equal(JSON.stringify(raw), frozen);
  assert.equal(world.calls.length, 2); validateRaw(raw, config); world.restored();
});
add('NSO-F13', '恢复冲突不覆盖外部替换，方法INVALID', async () => {
  const world = pageWorld(), api = await installPage(world), foreign = function () {};
  world.SpatialView.prototype.applyBatch = foreign; const raw = api.stop();
  assert.equal(world.SpatialView.prototype.applyBatch, foreign); assert.equal(raw.terminal.valid, false); assert.equal(raw.terminal.restoreConflicts, 1); validateRaw(raw, config); world.restored([2]);
});
add('NSO-F14', '热调用内stop明确保留unfinished，原返回不变', async () => {
  const world = pageWorld(), api = await installPage(world);
  world.behaviors.set(2, () => { api.stop(); return 'applied'; });
  assert.equal(world.invoke(2, [batch(), 1]), 'applied'); const raw = api.stop();
  assert.equal(raw.terminal.activeOnStop, 1); assert.equal(raw.terminal.unfinished, 1); assert.equal(raw.terminal.valid, false); validateRaw(raw, config); world.restored();
});
add('NSO-F15', 'Node保留全部args、this、proof及原调用一次', () => {
  const calls = [], returned = {}, receiver = {}, input = adapterInput().input, extra = {}, args = [input, extra];
  const world = nodeWorld(function (...values) { calls.push({ receiver: this, values }); return returned; });
  assert.equal(world.invoke(receiver, args), returned); assert.equal(calls.length, 1); assert.equal(calls[0].receiver, receiver);
  assert.equal(calls[0].values.length, args.length); for (let index = 0; index < args.length; index++) assert.equal(calls[0].values[index], args[index]);
  const raw = world.probe.stop(); validateRaw(raw, config); assert.equal(raw.terminal.valid, true); world.restored();
});
add('NSO-F16', '真实enqueue/consume的push证明身份与单次消费', () => {
  const direct = adapterInput(), originalProof = enqueueSocketPacket(direct.input); assert.equal(direct.consume(originalProof), true);
  const actual = adapterInput(), world = nodeWorld(enqueueSocketPacket), proof = world.invoke(undefined, [actual.input]);
  assert.ok(proof); assert.equal(actual.consume(proof), true); assert.equal(actual.consume(proof), false);
  assert.deepEqual(actual.counts(), direct.counts()); assert.equal(actual.counts().sends, 1);
  const raw = world.probe.stop(); assert.ok(cell(raw, raw.rows[0], 'returnObject')); validateRaw(raw, config); world.restored();
});
add('NSO-F17', '真实ACK proof与原发送失败null均不被改写', () => {
  const world = nodeWorld(enqueueSocketPacket), ack = adapterInput({ kind: 'ack' }), failed = adapterInput({ failSend: true });
  const proof = world.invoke(undefined, [ack.input]); assert.equal(ack.consume(proof), true);
  assert.equal(world.invoke(undefined, [failed.input]), null); assert.equal(failed.counts().sends, 1);
  const raw = world.probe.stop(); assert.equal(cell(raw, raw.rows[1], 'returnObject'), null); validateRaw(raw, config); world.restored();
});
add('NSO-F18', '原拒绝资格仍不发送，观察器不调用current/send', () => {
  const direct = adapterInput({ current: () => false }); assert.equal(enqueueSocketPacket(direct.input), null);
  const actual = adapterInput({ current: () => false }), world = nodeWorld(enqueueSocketPacket);
  assert.equal(world.invoke(undefined, [actual.input]), null); assert.deepEqual(actual.counts(), direct.counts()); assert.equal(actual.counts().sends, 0);
  validateRaw(world.probe.stop(), config); world.restored();
});
add('NSO-F19', 'Node反射错误与原destructure异常各自保留', () => {
  const originalError = Error('原输入异常'), observerError = Error('观察异常'); let originalCalls = 0;
  const world = nodeWorld(function (...args) { originalCalls++; return Reflect.apply(enqueueSocketPacket, this, args); });
  const input = new Proxy({}, { getOwnPropertyDescriptor() { throw observerError; }, get() { throw originalError; } });
  let caught; try { world.invoke(undefined, [input]); } catch (error) { caught = error; }
  assert.equal(caught, originalError); assert.equal(originalCalls, 1);
  const raw = world.probe.stop(); assert.equal(raw.terminal.valid, false); validateRaw(raw, config); world.restored();
});
add('NSO-F20', 'commit通知不改变原listener顺序且不读取payload', () => {
  const runtime = new EventEmitter(), order = [];
  const publisher = () => order.push('publisher'), later = () => order.push('later');
  runtime.on('commit', publisher);
  let at = 100, capture = false, payloadReads = 0;
  const original = () => undefined; let bound = original;
  const probe = createNodeProbe(config, { now() { if (capture) order.push('N1'); return ++at; } });
  probe.bind(original, () => bound, value => { bound = value; }); probe.activate(runtime);
  const installed = runtime.listeners('commit');
  assert.equal(installed.length, 2); assert.equal(installed[0], publisher);
  assert.equal(typeof installed[1], 'function'); assert.notEqual(installed[1], publisher);
  const first = { sessionSeq: '1', get payload() { payloadReads++; throw Error('不得读取payload'); } };
  runtime.on('commit', later); capture = true;
  try { runtime.emit('commit', { sessionId: 'finite-session', events: [first, { sessionSeq: '3' }] }); }
  finally { capture = false; }
  assert.equal(order[0], 'publisher'); assert.equal(order.at(-1), 'later'); assert.ok(order.length > 2);
  assert.ok(order.slice(1, -1).every(value => value === 'N1')); assert.equal(payloadReads, 0);
  const raw = probe.stop(); assert.equal(cell(raw, raw.rows[0], 'firstSeq'), '1'); assert.equal(cell(raw, raw.rows[0], 'lastSeq'), '3');
  assert.equal(raw.terminal.notifications, 1); validateRaw(raw, config);
  assert.deepEqual(runtime.listeners('commit'), [publisher, later]); assert.equal(bound, original); assert.equal(payloadReads, 0);
});
add('NSO-F21', 'commit观察内部反射异常不逃出EventEmitter', () => {
  const world = nodeWorld(), value = new Proxy({}, { getOwnPropertyDescriptor() { throw Error('观察失败'); } });
  assert.doesNotThrow(() => world.runtime.emit('commit', value)); assert.deepEqual(world.order, ['original']);
  const raw = world.probe.stop(); assert.equal(raw.terminal.valid, false); validateRaw(raw, config); world.restored();
});
add('NSO-F22', 'Node停采后的旧bound引用纯委托，raw不变', () => {
  let count = 0; const returned = {}, world = nodeWorld(() => { count++; return returned; }), bound = world.bound().bind({});
  bound(adapterInput().input); commit(world.runtime); const raw = world.probe.stop(), frozen = JSON.stringify(raw), clock = world.clock.reads;
  assert.equal(bound(adapterInput().input), returned); commit(world.runtime, '4');
  assert.equal(count, 2); assert.equal(world.clock.reads, clock); assert.equal(JSON.stringify(raw), frozen); validateRaw(raw, config); world.restored();
});
function worst(rule) {
  if (Object.hasOwn(rule, 'const')) return rule.const;
  if (rule.type.startsWith('string')) return '\u0000'.repeat(rule.maxCodeUnits);
  if (rule.type.startsWith('number')) return rule.maximum;
  if (rule.type === 'boolean') return false;
  if (rule.type === 'array') return Array.from({ length: rule.maxItems }, () => worst(rule.items));
  return Object.fromEntries(Object.entries(rule.fields).map(([key, value]) => [key, worst(value)]));
}
add('NSO-F23', '全部头尾与cold封套的最坏字符串外侧字节oracle', () => {
  const proof = JSON.parse(readFileSync(resolve(methodDirectory, 'capacity-proof.json')));
  const header = worst(ENVELOPE.rawHeader), cold = worst(ENVELOPE.cold); validateShape(header, ENVELOPE.rawHeader); validateShape(cold, ENVELOPE.cold);
  assert.ok(Buffer.byteLength(JSON.stringify(header) + '\n') <= proof.rawHeaderIncludingLF); assert.ok(proof.rawHeaderIncludingLF <= 65536);
  assert.ok(Buffer.byteLength(JSON.stringify(cold) + '\n') <= proof.coldEnvelopeIncludingLF); assert.ok(proof.coldEnvelopeIncludingLF <= 32768);
});
add('NSO-F24', '全长可转义行按实际UTF8仍不超过预扣', async () => {
  const world = pageWorld(), api = await installPage(world), value = batch();
  value.sessionId = '\u0000'.repeat(128); value.viewId = '\u0000'.repeat(128);
  value.fromExclusive = '1'.repeat(128); value.throughSeq = '2'.repeat(128);
  const envelope = packet(value); envelope.nsp = '\u0000'.repeat(128); world.socket.nsp = '\u0000'.repeat(128);
  world.socket.onpacket(envelope); world.view.applyBatch(value, 1, {});
  const raw = api.stop(); const actual = validateRaw(raw, config); assert.ok(actual.bytes <= raw.terminal.reservedBytes);
  assert.equal(raw.terminal.valid, true); world.restored();
});

class Handle {
  constructor(value) { this.value = value; this.disposed = 0; }
  async evaluate(fn) { return fn(this.value); }
  async getProperty(name) { return new Handle(this.value[name]); }
  async dispose() { this.disposed++; }
}
function coldWorld({ statusFailures = 0, originalFailure = null, installFailure = false, hookFailure = null } = {}) {
  const world = pageWorld(), runtime = new EventEmitter(), node = createNodeProbe(config, { now: () => ++world.clock.value });
  let enqueue = enqueueSocketPacket; node.bind(enqueue, () => enqueue, value => { enqueue = value; });
  const calls = [], writes = [], statusValues = []; let writeAttempts = 0, hookCalls = 0, roomBinding;
  const browser = { async close(...args) { calls.push({ kind: 'browser', receiver: this, args }); if (originalFailure) throw originalFailure; return 'browser-return'; } };
  const context = { browser: () => browser, async close(...args) { calls.push({ kind: 'context', receiver: this, args }); if (originalFailure) throw originalFailure; return 'context-return'; } };
  const page = { context: () => context, async reload(...args) { calls.push({ kind: 'reload', receiver: this, args }); if (originalFailure) throw originalFailure; return 'reload-return'; } };
  const originals = { browser: browser.close, context: context.close, reload: page.reload };
  const controller = createColdHooks({ config, nodeProbe: node,
    async installPageHandle() { if (installFailure) throw Error('受控Page安装失败'); return new Handle(await installPageProbe(config, world.fixtures())); },
    onRaw(realm, raw) { const checked = validateRaw(raw, config); writes.push({ realm, raw }); return { bytes: checked.bytes, sha256: sha256(checked.text) }; },
    onStatus(status) { writeAttempts++; validateCold(status); if (writeAttempts <= statusFailures) throw Error('受控cold写失败'); statusValues.push(structuredClone(status)); },
  });
  controller.status.enqueueLoaded = controller.status.harnessLoaded = controller.status.loaderRemoved = controller.status.temporaryBridgeRemoved = true;
  const original = async function (options) { await options.beforeSession(page, 0); return 'room-return'; };
  roomBinding = original; controller.harness(original, () => roomBinding, value => { roomBinding = value; });
  const options = { server: { runtime }, async beforeSession() { hookCalls++; if (hookFailure) throw hookFailure; } };
  return { world, node, runtime, controller, page, context, browser, calls, writes, statusValues, originals,
    start: () => roomBinding(options), hookCalls: () => hookCalls, writeAttempts: () => writeAttempts,
    assertRestored() { assert.equal(roomBinding, original); assert.equal(browser.close, originals.browser);
      assert.equal(context.close, originals.context); assert.equal(page.reload, originals.reload); assert.equal(enqueue, enqueueSocketPacket); } };
}
add('NSO-F25', '共享冷实现先安装再原hook，reload收取后原调用一次', async () => {
  const value = coldWorld(); assert.equal(await value.start(), 'room-return'); assert.equal(value.hookCalls(), 1);
  value.world.view.applyBatch(batch(), 1, {}); commit(value.runtime);
  const argument = {}; assert.equal(await value.page.reload(argument), 'reload-return');
  assert.equal(value.calls.length, 1); assert.equal(value.calls[0].args[0], argument); assert.equal(value.calls[0].receiver, value.page);
  assert.equal(value.controller.status.valid, true); assert.deepEqual(value.writes.map(item => item.realm), ['node', 'page']); value.assertRestored();
});
add('NSO-F26', 'cold收取错误不替代原close异常身份', async () => {
  const failure = Error('原close失败'), value = coldWorld({ originalFailure: failure, statusFailures: 1 }); await value.start();
  let caught; try { await value.context.close(); } catch (error) { caught = error; }
  assert.equal(caught, failure); assert.equal(value.calls.length, 1); assert.equal(value.controller.status.valid, false);
  assert.equal(await value.controller.collect('context.close'), false); value.assertRestored();
});
add('NSO-F27', 'R-NSO-COMP-001写失败后collect/status皆false，exit不复活资格', async () => {
  const value = coldWorld({ statusFailures: 1 }); await value.start();
  assert.equal(await value.page.reload(), 'reload-return'); assert.equal(value.calls.length, 1);
  assert.equal(value.controller.status.valid, false); assert.ok(value.controller.status.errors.includes('COLD_WRITE_FAILED'));
  assert.equal(await value.controller.collect('page.reload'), false); value.controller.exit();
  assert.equal(value.writeAttempts(), 2); assert.equal(value.statusValues.length, 1); assert.equal(value.statusValues[0].valid, false);
  assert.ok(value.statusValues[0].errors.includes('EXIT_WITHOUT_COLD_COLLECTION')); assert.equal(value.calls.length, 1); value.assertRestored();
});
add('NSO-F28', '部分冷安装失败仍调用原hook并恢复先装项', async () => {
  const value = coldWorld({ installFailure: true }); assert.equal(await value.start(), 'room-return');
  assert.equal(value.hookCalls(), 1); assert.equal(value.controller.status.valid, false);
  assert.equal(value.controller.status.pageInstalled, false); assert.equal(await value.controller.collect('install-failure'), false); value.assertRestored();
});
add('NSO-F29', '原beforeSession异常保持同一身份并收取一次', async () => {
  const failure = Error('原hook失败'), value = coldWorld({ hookFailure: failure }); let caught;
  try { await value.start(); } catch (error) { caught = error; }
  assert.equal(caught, failure); assert.equal(value.hookCalls(), 1); assert.equal(value.controller.status.valid, false);
  assert.equal(value.writes.length, 2); value.assertRestored();
});
add('NSO-F30', '同一cold collection Promise共享，原不同close调用各自一次', async () => {
  const value = coldWorld(); await value.start();
  const first = value.controller.collect('context.close'), second = value.controller.collect('browser.close'); assert.equal(first, second); await first;
  await value.context.close(); await value.browser.close(); assert.deepEqual(value.calls.map(item => item.kind), ['context', 'browser']);
  assert.equal(value.writes.length, 2); assert.equal(value.writeAttempts(), 1); value.assertRestored();
});
add('NSO-F31', 'loader共用变换对准确原源码逐字绑定，非目标对象原样', () => {
  const sources = DEFINITIONS.map(item => ({ path: item.path, sha256: sha256(readFileSync(resolve(repository, item.path))) }));
  const transforms = DEFINITIONS.map(item => ({ path: item.path, beforeSHA256: sources.find(source => source.path === item.path).sha256,
    afterSHA256: sha256(readFileSync(resolve(repository, item.path), 'utf8') + item.suffix) }));
  const status = { transformedModules: [] }, nodeRaw = { setup: { modules: [] } }, hook = createLoadHook({ repository, sources, transforms, status, nodeRaw });
  const untouched = { format: 'module', source: 'export const untouched = 1;' };
  assert.equal(hook('file:///unrelated.mjs', {}, () => untouched), untouched);
  for (const item of DEFINITIONS) {
    const source = readFileSync(resolve(repository, item.path), 'utf8'), loaded = { format: 'module', source };
    const result = hook(pathToFileURL(resolve(repository, item.path)).href, {}, () => loaded);
    assert.equal(result.source, source + item.suffix); assert.equal(loaded.source, source);
  }
  assert.equal(status.transformedModules.length, 2); assert.equal(nodeRaw.setup.modules.length, 2);
});
add('NSO-F32', 'loader拒绝错源、重复安装及未绑定变换，不执行注入内容', () => {
  const item = DEFINITIONS[0], source = readFileSync(resolve(repository, item.path), 'utf8'), url = pathToFileURL(resolve(repository, item.path)).href;
  const sources = [{ path: item.path, sha256: sha256(source) }], transforms = [{ path: item.path, beforeSHA256: sha256(source), afterSHA256: sha256(source + item.suffix) }];
  const create = (changes = {}) => createLoadHook({ repository, sources, transforms, status: { transformedModules: [] }, nodeRaw: { setup: { modules: [] } }, ...changes });
  assert.throws(() => create()(url, {}, () => ({ format: 'module', source: source + ' ' })));
  assert.throws(() => create({ transforms: [] })(url, {}, () => ({ format: 'module', source })));
  assert.throws(() => create()(url, {}, () => ({ format: 'commonjs', source })));
  const duplicated = source + '\n// ' + item.marker;
  assert.throws(() => create({ sources: [{ path: item.path, sha256: sha256(duplicated) }],
    transforms: [{ path: item.path, beforeSHA256: sha256(duplicated), afterSHA256: sha256(duplicated + item.suffix) }] })
  (url, {}, () => ({ format: 'module', source: duplicated })));
  const hook = create(); hook(url, {}, () => ({ format: 'module', source })); assert.throws(() => hook(url, {}, () => ({ format: 'module', source })));
});

for (const item of cases) await test(item.id + ' ' + item.name, async () => {
  try { await item.work(); outcomes.push({ id: item.id, status: 'PASS' }); }
  catch (error) { outcomes.push({ id: item.id, status: 'FAIL' }); throw error; }
});
writeExclusive(output, 'finite-result.json', JSON.stringify({ format: 'NSO_FINITE_RESULT_V1', naturalQualified: false,
  productHead: config.productHead, productTree: config.productTree, methodSHA256: config.methodSHA256,
  inputSHA256: config.inputSHA256, nodeVersion: process.version, cases: outcomes }) + '\n', 32768);
