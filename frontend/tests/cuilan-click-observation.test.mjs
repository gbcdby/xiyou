import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import { openObjects, selectObject } from './gaolao-real-support.mjs';
import { observeSelectionClicks } from './cuilan-click-observation.mjs';
import * as observation from './cuilan-click-observation.mjs';

function selectionPage(branch, { failure, beforeClick = () => {}, clickWait } = {}) {
  const calls = [], reference = '当前授权引用', target = { entityRef: reference, name: '翠兰', sceneId: 'scene', position: { x: 30, y: 40 } };
  const click = async (...args) => { calls.push(['click', branch, args]); beforeClick(); if (clickWait) await clickWait; if (failure !== undefined) throw failure; };
  const absent = { count: async () => 0, isVisible: async () => false };
  const map = {
    scrollIntoViewIfNeeded: async () => calls.push(['scroll']), click,
    evaluate: async (_read, args) => args ? { pixel: { x: 71, y: 83 } } : { labels: branch === 'map-label' ? [{ key: reference, selectable: true, x: 10, y: 20, width: 30, height: 40 }] : [] },
  };
  const page = {
    evaluate: async () => ({ targets: [target], items: [], entities: [], self: { sceneId: 'scene' } }),
    getByRole: () => absent, getByTestId: () => map, mouse: { click },
    locator: selector => {
      if (selector === '.spatial-reading-pane') return absent;
      if (selector.startsWith('.spatial-sidebar')) return { getByRole: () => absent };
      if (selector === '.spatial-object-list') return { getByRole: () => ({ allTextContents: async () => branch === 'object-button' ? ['翠兰'] : ['翠兰', '翠兰'], nth: index => { assert.equal(index, 0); return { click }; } }) };
      assert.equal(selector, '#spatial-selection-heading');
      return { innerText: async () => { calls.push(['heading']); return '5号 · 翠兰'; } };
    },
  };
  return { page, calls, reference };
}

for (const [branch, args] of [['object-button', []], ['map-label', [{ position: { x: 25, y: 40 } }]], ['map-position', [71, 83]]]) {
  test('点击观测保留原单次调用、参数及选择后置断言：' + branch, async () => {
    const sample = selectionPage(branch), observed = [];
    const remove = observeSelectionClicks(sample.page, event => { observed.push({ ...event, calls: structuredClone(sample.calls) }); return '本次点击'; });
    assert.equal(await selectObject(sample.page, sample.reference), '5号 · 翠兰'); remove();
    assert.deepEqual(sample.calls.filter(row => row[0] === 'click'), [['click', branch, args]]);
    assert.deepEqual(observed.map(row => row.phase), ['called', 'returned']);
    assert.equal(observed[0].branch, branch); assert.equal(observed[0].reference, sample.reference);
    assert.equal(observed[0].calls.some(row => row[0] === 'click'), false);
    assert.equal(observed[1].calls.some(row => row[0] === 'click'), true);
    assert.equal(observed[1].calls.some(row => row[0] === 'heading'), false);
    assert.deepEqual(sample.calls.at(-1), ['heading']);
  });
}

test('原 click 抛错对象原样传播，观察失败不能转换原动作结果', async () => {
  const error = new Error('原点击超时'), sample = selectionPage('object-button', { failure: error }), phases = [];
  const remove = observeSelectionClicks(sample.page, event => { phases.push(event); if (event.phase === 'threw') throw new Error('仅观察器异常'); });
  await assert.rejects(selectObject(sample.page, sample.reference), actual => actual === error); remove();
  assert.deepEqual(phases.map(row => row.phase), ['called', 'threw']); assert.equal(phases[1].error, error);
  assert.equal(sample.calls.some(row => row[0] === 'heading'), false);
  assert.equal(sample.calls.filter(row => row[0] === 'click').length, 1);
});

test('调用前观察器异常或未启用观察器均保留实际点击与结果', async () => {
  for (const enabled of [false, true]) {
    const sample = selectionPage('object-button');
    const remove = enabled ? observeSelectionClicks(sample.page, () => { throw new Error('观察失败'); }) : () => {};
    assert.equal(await selectObject(sample.page, sample.reference), '5号 · 翠兰'); remove();
    assert.deepEqual(sample.calls, [['click', 'object-button', []], ['heading']]);
  }
});

test('原点击 Promise 未 settle 时观察器不提前返回或启动后置读取', async () => {
  let release, started; const clickWait = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { started = resolve; });
  const sample = selectionPage('object-button', { clickWait, beforeClick: started }), phases = [];
  const remove = observeSelectionClicks(sample.page, event => phases.push(event.phase));
  const pending = selectObject(sample.page, sample.reference);
  await entered; assert.deepEqual(phases, ['called']); assert.deepEqual(sample.calls, [['click', 'object-button', []]]);
  release(); assert.equal(await pending, '5号 · 翠兰'); remove(); assert.deepEqual(phases, ['called', 'returned']);
});

function observedPage({ installError } = {}) {
  const page = new EventEmitter(), url = 'http://127.0.0.1:4000/session/room?token=不得收集#fragment';
  const frame = { url: () => url };
  Object.assign(page, {
    url: () => url, mainFrame: () => frame,
    addInitScript: async (fn, args) => { page.init = { fn, args }; if (installError) throw installError; },
  });
  return page;
}
const pulse = page => ({ type: () => 'debug', text: () => page.init.args.prefix + JSON.stringify({
  kind: 'pulse', timeOrigin: 100, at: 42, wallTime: 1234, visibility: 'visible', readyState: 'complete', longTaskSupport: 'supported',
  longTasks: { count: 1, totalDuration: 60, maxDuration: 60, recent: [{ startTime: 20, duration: 60 }] },
  privateIgnoredField: '不得保存',
}) });

function objectsEntry({ present = true, restored = true, failure, clickWait, detailsOpen = false } = {}) {
  const calls = [];
  const entry = { count: async () => { calls.push('count'); return Number(present); }, click: async (...args) => {
    calls.push(['entry-click', args]); if (clickWait) await clickWait; if (failure) throw failure;
  } };
  const close = { isVisible: async () => { calls.push('close-visible'); return detailsOpen; }, click: async (...args) => {
    calls.push(['close-click', args]); detailsOpen = false;
  } };
  const restore = { isVisible: async () => { calls.push('restore-visible'); return restored; }, click: async (...args) => calls.push(['restore-click', args]) };
  const page = { getByRole: (...args) => {
    if (args[1]?.name === '关闭对象区') { calls.push(['close-locator', args]); return close; }
    calls.push(['entry-locator', args]); return entry;
  }, locator: selector => {
    calls.push(['restore-locator', selector]); return { getByRole: (...args) => { calls.push(['restore-role', args]); return restore; } };
  } };
  return { page, calls };
}

test('对象入口原单次无参 click 的边界先于恢复按钮，观察失败不改变动作', async () => {
  for (const throws of [false, true]) {
    const { page, calls } = objectsEntry(), phases = [];
    const remove = observeSelectionClicks(page, event => { phases.push({ phase: event.phase, branch: event.branch, calls: structuredClone(calls) }); if (throws) throw new Error('仅观察失败'); return 7; });
    await openObjects(page); remove();
    assert.deepEqual(calls, [
      ['close-locator', ['button', { name: '关闭对象区', exact: true }]], 'close-visible',
      ['entry-locator', ['button', { name: '场景对象', exact: true }]], 'count', ['entry-click', []],
      ['restore-locator', '.spatial-sidebar.hud-card-collapsed'], ['restore-role', ['button', { name: '取消选择并展开', exact: true }]], 'restore-visible', ['restore-click', []],
    ]);
    assert.equal(phases[0]?.branch, 'objects-entry');
    assert.deepEqual(phases.map(row => row.phase), throws ? ['called'] : ['called', 'returned']);
    assert.equal(phases[0].calls.some(row => row[0] === 'entry-click'), false);
    if (!throws) assert.equal(phases[1].calls.some(row => row[0] === 'restore-locator'), false);
  }
});

test('入口 click 未 settle 不进入恢复按钮，抛原错误且失败 hook 不截断传播', async () => {
  let release; const wait = new Promise(resolve => { release = resolve; }), error = new Error('原 5000ms 错误');
  const { page, calls } = objectsEntry({ failure: error, clickWait: wait }), phases = [];
  let started; const entered = new Promise(resolve => { started = resolve; });
  const remove = observeSelectionClicks(page, event => {
    phases.push(event);
    if (event.branch === 'objects-entry' && event.phase === 'called') started();
    if (event.phase === 'threw') throw new Error('诊断错误');
    return 8;
  });
  const pending = openObjects(page); await entered;
  assert.deepEqual(phases.map(row => row.phase), ['called']); assert.equal(calls.some(row => row[0] === 'restore-locator'), false);
  release(); await assert.rejects(pending, actual => actual === error); remove();
  assert.deepEqual(phases.map(row => row.phase), ['called', 'threw']); assert.equal(phases[1].error, error);
  assert.equal(calls.filter(row => row[0] === 'entry-click').length, 1); assert.equal(calls.some(row => row[0] === 'restore-locator'), false);
});

test('入口不存在不制造点击或观察，未注册入口仍按原顺序执行', async () => {
  const absent = objectsEntry({ present: false }), phases = [];
  const remove = observeSelectionClicks(absent.page, event => phases.push(event)); await openObjects(absent.page); remove();
  assert.deepEqual(phases, []); assert.equal(absent.calls.some(row => row[0] === 'entry-click'), false);
  const plain = objectsEntry({ restored: false }); await openObjects(plain.page);
  assert.equal(plain.calls.filter(row => row[0] === 'entry-click').length, 1); assert.equal(plain.calls.some(row => row[0] === 'restore-click'), false);
});

test('公共事件只存有限元数据，记录响应脉冲与 Node 时钟而不发额外页面请求', async t => {
  assert.equal(typeof observation.createCuilanClickObservation, 'function', '须有独立可关闭的观察器');
  t.mock.timers.enable({ apis: ['setInterval'] });
  const collector = observation.createCuilanClickObservation({ currentCase: () => 'P-05' }); t.after(() => collector.close());
  const page = observedPage(); await collector.attach(page, 'page-1');
  const request = { isNavigationRequest: () => true, resourceType: () => 'document', frame: () => page.mainFrame(), url: page.url, method: () => 'GET', failure: () => ({ errorText: 'net::ERR_ABORTED' }) };
  page.emit('request', request); page.emit('response', { request: () => request, status: () => 200 }); page.emit('requestfailed', request);
  page.emit('framenavigated', page.mainFrame()); page.emit('domcontentloaded'); page.emit('load');
  page.emit('request', { ...request, isNavigationRequest: () => false });
  page.emit('console', pulse(page)); t.mock.timers.tick(1000);
  assert.equal(collector.report.events.total, 6); assert.equal(collector.report.browser.total, 1); assert.equal(collector.report.node.total, 1);
  assert.equal(collector.report.browser.items[0].produced.at, 42); assert.ok(Number.isFinite(collector.report.browser.items[0].receivedAt));
  assert.ok(collector.report.events.items.every(row => row.caseId === 'P-05'));
  const serialized = JSON.stringify(collector.report);
  assert.ok(!serialized.includes('token=') && !serialized.includes('fragment') && !serialized.includes('privateIgnoredField') && !serialized.includes('不得保存'));
  assert.equal(page.init.args.pulseMs, 1000);
});

test('环槽有上限，close 后无监听、计时器或迟到点击写入', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const collector = observation.createCuilanClickObservation(), page = observedPage(); t.after(() => collector.close());
  await collector.attach(page, 'page-1');
  for (let i = 0; i < 300; i++) {
    const token = observation.beginSelectionClick(page, { reference: 'r'.repeat(400), branch: 'object-button' });
    observation.endSelectionClick(token, 'returned'); page.emit('console', pulse(page));
    page.emit('load');
  }
  t.mock.timers.tick(125000);
  assert.equal(collector.report.clicks.items.length, 256); assert.equal(collector.report.clicks.total, 600); assert.equal(collector.report.clicks.dropped, 344);
  assert.equal(collector.report.browser.items.length, 128); assert.equal(collector.report.events.items.length, 128); assert.equal(collector.report.node.items.length, 120);
  assert.ok(collector.report.clicks.items.filter(row => row.reference).every(row => row.reference.length <= 256));
  const late = observation.beginSelectionClick(page, { reference: 'late', branch: 'object-button' });
  collector.close(); const sealed = JSON.stringify(collector.report);
  observation.endSelectionClick(late, 'threw', new Error('迟到')); observation.beginSelectionClick(page, { reference: 'closed', branch: 'object-button' });
  page.emit('console', pulse(page)); page.emit('load'); t.mock.timers.tick(5000); collector.close();
  assert.equal(JSON.stringify(collector.report), sealed); assert.deepEqual(page.eventNames(), []);
});

test('page 关闭与安装/读取失败只影响诊断，页数和错误记录有界', async t => {
  const collector = observation.createCuilanClickObservation(); t.after(() => collector.close());
  const failed = observedPage({ installError: new Error('注册不支持') });
  await assert.doesNotReject(collector.attach(failed, 'failed'));
  assert.equal(collector.report.pages[0].installation, 'failed');
  const page = observedPage(); await collector.attach(page, 'page-1');
  for (let i = 0; i < 30; i++) page.emit('console', { type: () => 'debug', text: () => page.init.args.prefix + '{' });
  assert.equal(collector.report.issues.items.length, 16);
  page.emit('close'); const closedCount = collector.report.events.total;
  page.emit('load'); assert.equal(collector.report.events.total, closedCount); assert.deepEqual(page.eventNames(), []);
  for (let i = 0; i < 20; i++) await collector.attach(observedPage(), 'more-' + i);
  assert.equal(collector.report.pages.length, 16); collector.close(); assert.equal(collector.report.status, 'PARTIAL');
});

test('浏览器不支持 longtask 仅标诊断部分可用，保留真实脉冲', async t => {
  const collector = observation.createCuilanClickObservation(), page = observedPage(); t.after(() => collector.close()); await collector.attach(page, 'page-1');
  const message = pulse(page), raw = message.text().replace('"supported"', '"unsupported"');
  page.emit('console', { ...message, text: () => raw }); page.emit('console', { ...message, text: () => raw });
  assert.equal(collector.report.browser.total, 2); assert.equal(collector.report.pages[0].longTaskSupport, 'unsupported');
  assert.equal(collector.report.issues.total, 1); collector.close(); assert.equal(collector.report.status, 'PARTIAL');
});

test('浏览器脚本每秒仅一个小脉冲，长任务只保计数和最后八项，生命周期不执行动作', async t => {
  const collector = observation.createCuilanClickObservation(), page = observedPage(); t.after(() => collector.close());
  await collector.attach(page, 'page-1');
  const listeners = new Map(), emitted = [], timers = [], observed = []; let longTasks, now = 100;
  const document = { readyState: 'loading', visibilityState: 'visible', addEventListener: (name, callback) => listeners.set('document:' + name, callback) };
  const sandbox = {
    document, performance: { timeOrigin: 1000, now: () => now }, Date: { now: () => 2000 + now },
    console: { debug: value => emitted.push(value) },
    addEventListener: (name, callback) => listeners.set('window:' + name, callback),
    setInterval: (callback, interval) => { timers.push({ callback, interval }); return 1; }, clearInterval: () => {},
    PerformanceObserver: class {
      static supportedEntryTypes = ['longtask'];
      constructor(callback) { longTasks = callback; }
      observe(options) { observed.push(options); }
    },
  };
  sandbox.window = sandbox; sandbox.top = sandbox;
  runInNewContext('(' + page.init.fn.toString() + ')(' + JSON.stringify(page.init.args) + ')', sandbox);
  assert.equal(timers.length, 1); assert.equal(timers[0].interval, 1000);
  assert.equal(observed[0].type, 'longtask');
  longTasks({ getEntries: () => Array.from({ length: 12 }, (_, i) => ({ startTime: i, duration: 50 + i, attribution: ['不得收集'] })) });
  timers[0].callback(); now = 1100; timers[0].callback();
  const messages = emitted.map(value => JSON.parse(value.slice(page.init.args.prefix.length))), pulses = messages.filter(value => value.kind === 'pulse');
  assert.equal(pulses.length, 2); assert.equal(pulses[0].longTasks.count, 12); assert.equal(pulses[0].longTasks.recent.length, 8);
  assert.equal(pulses[1].longTasks.count, 0); assert.ok(!JSON.stringify(messages).includes('attribution'));
  let acted = false;
  listeners.get('document:click')({ isTrusted: true, target: { closest: selector => { assert.equal(selector, '.spatial-object-list button'); return { getAttribute: () => 'true' }; } }, preventDefault: () => { acted = true; } });
  assert.equal(acted, false); assert.equal(JSON.parse(emitted.at(-1).slice(page.init.args.prefix.length)).event, 'trusted-object-click');
});
