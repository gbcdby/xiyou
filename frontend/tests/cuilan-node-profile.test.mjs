import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createCuilanNodeProfile, normalizeCuilanCpuProfile } from './cuilan-node-profile.mjs';

const sourcePaths = ['backend/runtime.mjs'];
const dependencyPaths = ['frontend/node_modules/playwright-core'];
const profile = () => ({ startTime: 1000000, endTime: 1200000, samples: [2, 3], timeDeltas: [100000, 100000], nodes: [
  { id: 1, callFrame: { functionName: '(root)', url: '', lineNumber: -1, columnNumber: -1 }, children: [2, 3, 4] },
  { id: 2, callFrame: { functionName: 'stateAt', url: 'file:///repo/backend/runtime.mjs?token=PRIVATE#SECRET', lineNumber: 454, columnNumber: 4 }, children: [] },
  { id: 3, callFrame: { functionName: 'dispatch', url: 'file:///repo/frontend/node_modules/playwright-core/lib/client/connection.js', lineNumber: 9, columnNumber: 1 }, children: [] },
  { id: 4, callFrame: { functionName: 'PRIVATE_EVAL', url: 'https://private.invalid/SECRET?token=PRIVATE', lineNumber: 8, columnNumber: 1 }, children: [] },
] });
const point = at => ({ at, afterAt: at, wallTime: 1700000000000 + at, timeOrigin: 1700000000000 });
const bounds = () => ({ start: { before: point(0), after: point(0) }, stop: { before: point(200), after: point(200) } });

function fixture({ failCommand, holdCommand, raw = profile(), writeError, callbackDelay = {}, writeDelay = 0, lockError } = {}) {
  let at = 0, nextTimer = 0, gcCallback, gcDisconnects = 0, sessionCount = 0, disconnects = 0;
  const timers = new Map(), deferred = [], calls = [], pending = [], writes = [];
  const session = {
    connect: () => calls.push(['connect']), disconnect: () => { disconnects++; },
    post: (method, params, callback) => {
      calls.push([method, params]);
      if (method === holdCommand) { pending.push({ method, callback }); return; }
      if (method === failCommand) { callback(new Error('PRIVATE inspector failure')); return; }
      at += callbackDelay[method] ?? 0;
      callback(null, method === 'Profiler.stop' ? { profile: raw } : {});
    },
  };
  const observation = createCuilanNodeProfile({ repository: '/repo', output: '/evidence', sourcePaths, adapters: {
    now: () => point(at), makeSession: () => { sessionCount++; return session; },
    makeGcObserver: callback => { gcCallback = callback; return { observe: value => calls.push(['gc.observe', value]), disconnect: () => { gcDisconnects++; }, takeRecords: () => [] }; },
    setTimer: (callback, ms) => { const id = ++nextTimer; timers.set(id, { callback, ms }); return id; }, clearTimer: id => timers.delete(id),
    defer: callback => deferred.push(callback),
    read: async () => { if (lockError) throw lockError; return JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/playwright-core': { version: '1.57.0' } } }); },
    write: async (file, body, options) => { writes.push({ file, body, options }); at += writeDelay; if (writeError) throw writeError; },
  } });
  return { observation, calls, timers, pending, writes, session,
    counts: () => ({ sessionCount, disconnects, gcDisconnects }), advance: value => { at = value; },
    flush: () => { while (deferred.length) deferred.shift()(); },
    fire: ms => { const found = [...timers].find(([, value]) => value.ms === ms); assert.ok(found); timers.delete(found[0]); found[1].callback(); },
    gc: values => gcCallback({ getEntries: () => values }),
  };
}

test('未进入原历史段不创建 inspector、GC 或文件，close 幂等', async () => {
  const f = fixture(); await f.observation.close(); await f.observation.close();
  assert.equal(f.observation.report.status, 'NOT_RUN'); assert.equal(f.counts().sessionCount, 0); assert.equal(f.writes.length, 0);
  f.observation.start(); assert.equal(f.counts().sessionCount, 0);
});

test('单次非等待启用，停止只安排收尾，规范化仅在 close 写一次具名文件', async () => {
  const f = fixture(); assert.equal(f.observation.start(), undefined); f.observation.start();
  assert.equal(f.counts().sessionCount, 1);
  assert.deepEqual(f.calls.filter(row => row[0].startsWith('Profiler')).map(row => row[0]), ['Profiler.enable', 'Profiler.setSamplingInterval', 'Profiler.start']);
  assert.deepEqual(f.calls.find(row => row[0] === 'Profiler.setSamplingInterval')[1], { interval: 20000 });
  assert.ok([...f.timers.values()].some(row => row.ms === 600000));
  f.advance(200); f.observation.end('history-returned');
  assert.equal(f.calls.some(row => row[0] === 'Profiler.stop'), false); assert.equal(f.writes.length, 0);
  f.flush(); assert.equal(f.calls.filter(row => row[0] === 'Profiler.stop').length, 1); assert.equal(f.writes.length, 0);
  await f.observation.close(); await f.observation.close();
  assert.equal(f.observation.report.status, 'COLLECTED'); assert.equal(f.writes.length, 1); assert.equal(f.writes[0].file, '/evidence/p05-node-profile.json');
  assert.equal(f.observation.report.file.sha256, createHash('sha256').update(f.writes[0].body).digest('hex'));
  assert.equal(f.observation.report.file.bytes, Buffer.byteLength(f.writes[0].body));
  const saved = JSON.parse(f.writes[0].body); assert.deepEqual(saved.profile.timeDeltas, [100000, 100000]);
  assert.equal(saved.profile.nodes[1].callFrame.url, 'backend/runtime.mjs');
  assert.equal(saved.profile.nodes[2].callFrame.url, 'frontend/node_modules/playwright-core/lib/client/connection.js');
  assert.equal(saved.profile.nodes[3].callFrame.url, '<external>'); assert.equal(saved.profile.nodes[3].callFrame.functionName, '<external>');
  assert.ok(!f.writes[0].body.includes('PRIVATE') && !f.writes[0].body.includes('SECRET') && !f.writes[0].body.includes('/repo/'));
  const sealed = JSON.stringify(f.observation.report); f.gc([{ startTime: 400, duration: 8, detail: { kind: 1 } }]); f.observation.end('history-threw');
  assert.equal(JSON.stringify(f.observation.report), sealed); assert.equal(f.timers.size, 0);
});

test('停止先于迟到 start 回调时只收尾原采样，不能复活预算或第二份采样', async () => {
  const f = fixture({ holdCommand: 'Profiler.start' }); f.observation.start(); f.observation.end('history-threw'); f.flush();
  assert.equal(f.writes.length, 0); f.advance(200); f.pending[0].callback(null, {}); f.flush();
  await f.observation.close(); assert.equal(f.calls.filter(row => row[0] === 'Profiler.start').length, 1);
  assert.equal(f.calls.filter(row => row[0] === 'Profiler.stop').length, 1); assert.equal(f.timers.size, 0);
});

test('命令异常、2秒设置预算及晚回调均只令诊断不可用，不外泄错误文本', async () => {
  for (const mode of ['failure', 'timeout']) {
    const f = fixture(mode === 'failure' ? { failCommand: 'Profiler.enable' } : { holdCommand: 'Profiler.enable' });
    assert.doesNotThrow(() => f.observation.start()); if (mode === 'timeout') { f.advance(2300); f.fire(2000); }
    await assert.doesNotReject(f.observation.close());
    const sealed = JSON.stringify(f.observation.report); if (mode === 'timeout') f.pending[0].callback(null, {});
    assert.equal(JSON.stringify(f.observation.report), sealed); assert.equal(f.writes.length, 0); assert.equal(f.counts().sessionCount, 1);
    assert.equal(f.observation.report.status, 'UNAVAILABLE'); assert.ok(!sealed.includes('PRIVATE'));
  }
});

test('stop 不回复由原诊断预算收束，晚到完整对象不能在封口后保存或写报告', async () => {
  const f = fixture({ holdCommand: 'Profiler.stop' }); f.observation.start(); f.advance(200); f.observation.end('history-threw'); f.flush();
  const closing = f.observation.close(); f.advance(2400); f.fire(2000); await closing;
  assert.equal(f.observation.report.status, 'UNAVAILABLE'); assert.equal(f.writes.length, 0);
  const sealed = JSON.stringify(f.observation.report); f.pending[0].callback(null, { profile: profile() }); f.flush();
  assert.equal(JSON.stringify(f.observation.report), sealed); assert.equal(f.writes.length, 0); assert.equal(f.timers.size, 0);
});

for (const method of ['Profiler.start', 'Profiler.stop']) {
  test('命令回调先于迟到定时器恢复，实际2501ms也必须收束为不可用：' + method, async () => {
    const f = fixture({ callbackDelay: { [method]: 2501 } }); f.observation.start();
    f.advance(method === 'Profiler.start' ? 2701 : 200); f.observation.end('history-returned'); f.flush(); await f.observation.close();
    assert.equal(f.observation.report.status, 'UNAVAILABLE'); assert.equal(f.writes.length, 0);
    assert.ok(f.observation.report.issues.items.some(row => row.stage === method && row.reason === 'COMMAND_BUDGET_EXCEEDED'));
    const command = f.observation.report.bounds[method === 'Profiler.start' ? 'start' : 'stop'];
    assert.equal(command.after.at - command.before.at, 2501); assert.equal(f.timers.size, 0);
  });
}

test('写入完成先于迟到计时器时，实际2501ms保存不得记为成功', async () => {
  const f = fixture({ writeDelay: 2501 }); f.observation.start(); f.advance(200); f.observation.end('history-returned'); f.flush(); await f.observation.close();
  assert.equal(f.observation.report.status, 'PARTIAL'); assert.equal(f.observation.report.file.status, 'FAILED');
  assert.ok(f.observation.report.issues.items.some(row => row.stage === 'profile-save' && row.reason === 'IO_BUDGET_EXCEEDED'));
  assert.equal(f.writes[0].options.signal.aborted, true);
});

test('在600秒前提出停止但原生采样及完成晚于预算，真实超额仍须显式保留', async () => {
  const raw = profile(); raw.endTime = raw.startTime + 600500000;
  const f = fixture({ raw, callbackDelay: { 'Profiler.stop': 600 } }); f.observation.start(); f.advance(599900); f.observation.end('history-returned'); f.flush(); await f.observation.close();
  assert.equal(f.observation.report.status, 'PARTIAL'); assert.equal(f.observation.report.captureDurationMs, 600500);
  assert.equal(f.observation.report.nativeBudgetOverrunMs, 500); assert.ok(f.observation.report.budgetOverrunMs >= 500);
});

test('600秒软预算迟到如实标记，GC 有界且回调接收与事件时间分列', async () => {
  const f = fixture(); f.observation.start();
  for (let block = 0; block < 5; block++) { f.advance(block * 100); f.gc(Array.from({ length: 200 }, (_, i) => ({ startTime: block * 100 + i, duration: 3, detail: { kind: 1, flags: 0 }, private: 'SECRET' }))); }
  assert.equal(f.observation.report.gc.total, 1000); assert.equal(f.observation.report.gc.items.length, 512); assert.equal(f.observation.report.gc.dropped, 488);
  assert.ok(f.observation.report.gc.items.every(row => row.received.at !== row.startTime || row.startTime === 400));
  f.advance(605300); f.fire(600000); f.flush(); await f.observation.close();
  assert.equal(f.observation.report.budgetOverrunMs, 5300); assert.equal(f.observation.report.status, 'PARTIAL');
  assert.ok(!JSON.stringify(f.observation.report).includes('SECRET'));
});

test('原返回对象超容量不枚举整包，不写 raw profile，写失败也只标诊断', async () => {
  const raw = profile(); raw.nodes = new Array(8193); Object.defineProperty(raw.nodes, 0, { get() { throw new Error('不得扫描超限包'); } });
  const f = fixture({ raw }); f.observation.start(); f.advance(200); f.observation.end('history-returned'); f.flush(); await f.observation.close();
  assert.equal(f.observation.report.status, 'PARTIAL'); assert.equal(f.observation.report.profileStatus, 'CAPACITY_EXCEEDED'); assert.equal(f.writes.length, 0);
  const failed = fixture({ writeError: new Error('PRIVATE path') }); failed.observation.start(); failed.advance(200); failed.observation.end('history-returned'); failed.flush();
  await assert.doesNotReject(failed.observation.close()); assert.equal(failed.observation.report.status, 'PARTIAL'); assert.equal(failed.observation.report.file.status, 'FAILED');
  assert.ok(!JSON.stringify(failed.observation.report).includes('PRIVATE'));
});

test('CPU 时钟只用双端包络求相容偏移，矛盾或墙钟跳变不伪造精确对齐', () => {
  const options = { repository: '/repo', sourcePaths, dependencyPaths, bounds: bounds() };
  const valid = normalizeCuilanCpuProfile(profile(), options);
  assert.equal(valid.status, 'READY'); assert.deepEqual(valid.clock.offsetMs, { min: -1000, max: -1000 });
  const inconsistent = bounds(); inconsistent.stop.before.at = inconsistent.stop.after.at = 500;
  const bad = normalizeCuilanCpuProfile(profile(), { ...options, bounds: inconsistent });
  assert.equal(bad.clock.status, 'CLOCK_ALIGNMENT_INCONCLUSIVE'); assert.equal(bad.clock.offsetMs, null);
  const jump = bounds(); jump.stop.before.wallTime += 1000; jump.stop.after.wallTime += 1000;
  assert.equal(normalizeCuilanCpuProfile(profile(), { ...options, bounds: jump }).clock.wallStatus, 'WALL_CLOCK_DISCONTINUITY');
});

test('非法采样结构、缺节点引用和任意 eval/外部文件不能成为合法栈证据', () => {
  const options = { repository: '/repo', sourcePaths, dependencyPaths, bounds: bounds() };
  for (const change of [p => { p.samples = [99, 3]; }, p => { p.timeDeltas = [1]; }, p => { p.nodes[1].id = 1; }, p => { p.timeDeltas = [-1, 1]; }]) {
    const p = profile(); change(p); assert.equal(normalizeCuilanCpuProfile(p, options).status, 'INVALID_PROFILE');
  }
  const p = profile(); p.nodes[1].callFrame.url = 'file:///repo/../private/token.js'; p.nodes[1].callFrame.functionName = 'PRIVATE';
  const value = normalizeCuilanCpuProfile(p, options); assert.equal(value.status, 'READY'); assert.equal(value.profile.nodes[1].callFrame.functionName, '<external>');
  assert.ok(!JSON.stringify(value).includes('private') && !JSON.stringify(value).includes('PRIVATE'));
  for (const oversized of ['samples', 'timeDeltas', 'children']) {
    const tooLarge = profile(), values = new Array(oversized === 'children' ? 32769 : 65537);
    Object.defineProperty(values, 0, { get() { throw new Error('不得扫描超限数据'); } });
    if (oversized === 'children') tooLarge.nodes[0].children = values; else tooLarge[oversized] = values;
    assert.equal(normalizeCuilanCpuProfile(tooLarge, options).status, 'CAPACITY_EXCEEDED');
  }
});

test('所有URL分支统一长度上限，未列入锁定包白名单的依赖隐藏名称和路径', () => {
  const raw = profile(); raw.nodes[1].callFrame.url = 'node:' + 'x'.repeat(300); raw.nodes[1].callFrame.functionName = 'PRIVATE_LONG';
  raw.nodes[2].callFrame.url = 'file:///repo/frontend/node_modules/unlisted-package/index.js'; raw.nodes[2].callFrame.functionName = 'PRIVATE_PACKAGE';
  const value = normalizeCuilanCpuProfile(raw, { repository: '/repo', sourcePaths, dependencyPaths, bounds: bounds() });
  assert.equal(value.status, 'READY'); assert.ok(value.profile.nodes.every(node => node.callFrame.url.length <= 256));
  assert.equal(value.profile.nodes[1].callFrame.functionName, '<external>'); assert.equal(value.profile.nodes[2].callFrame.functionName, '<external>');
  assert.ok(!JSON.stringify(value).includes('unlisted-package') && !JSON.stringify(value).includes('PRIVATE'));
  const empty = normalizeCuilanCpuProfile(profile(), { repository: '/repo', sourcePaths, dependencyPaths: [], bounds: bounds() });
  assert.equal(empty.profile.nodes[2].callFrame.url, '<external>');
});

test('锁定白名单读取失败保守隐藏依赖，明确部分证据而不改变原流程', async () => {
  const f = fixture({ lockError: new Error('PRIVATE permission') }); f.observation.start(); f.advance(200); f.observation.end('history-returned'); f.flush();
  await assert.doesNotReject(f.observation.close()); assert.equal(f.observation.report.status, 'PARTIAL');
  const saved = JSON.parse(f.writes[0].body); assert.equal(saved.profile.nodes[2].callFrame.url, '<external>');
  assert.ok(!JSON.stringify(f.observation.report).includes('PRIVATE'));
});
