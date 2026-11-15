import assert from 'node:assert/strict';
import test from 'node:test';
import { selectObject } from './gaolao-real-support.mjs';
import { observeSelectionClicks } from './cuilan-click-observation.mjs';

// 调用真实选择 helper；定位器只模拟已展开详情对底层入口的拦截，不算浏览器命中验收。
function fixture({ opened = true, closeError, entryError, closeWait } = {}) {
  const calls = [], events = [], reference = '当前授权人物';
  let visible = opened;
  const absent = { count: async () => 0, isVisible: async () => false };
  const close = { isVisible: async () => visible, click: async (...args) => {
    calls.push(['close', args]); if (closeWait) await closeWait;
    if (closeError) throw closeError; visible = false;
  } };
  const entry = { count: async () => 1, click: async (...args) => {
    calls.push(['entry', args]);
    if (visible) throw new Error('已展开详情拦截底层对象入口');
    if (entryError) throw entryError;
  } };
  const page = {
    getByRole(role, options) {
      assert.equal(role, 'button'); assert.equal(options.exact, true);
      if (options.name === '关闭对象区') return close;
      assert.equal(options.name, '场景对象'); return entry;
    },
    locator(selector) {
      if (selector === '.spatial-reading-pane') return absent;
      if (selector === '.spatial-sidebar.hud-card-collapsed') return { getByRole: () => absent };
      if (selector === '.spatial-object-list') return { getByRole: () => ({
        allTextContents: async () => ['翠兰'], nth(index) { assert.equal(index, 0); return { click: async (...args) => calls.push(['object', args]) }; },
      }) };
      assert.equal(selector, '#spatial-selection-heading');
      return { innerText: async () => { calls.push(['heading']); return '翠兰'; } };
    },
    evaluate: async () => ({ targets: [], items: [], entities: [{ entityRef: reference, name: '翠兰' }], self: { sceneId: '当前场景' } }),
  };
  return { page, calls, events, reference };
}

test('重新选对象先普通关闭可见详情，再保留原入口与对象各一次无参点击', async () => {
  const f = fixture(); const remove = observeSelectionClicks(f.page, event => { f.events.push(event); return f.events.length; });
  try { assert.equal(await selectObject(f.page, f.reference), '翠兰'); } finally { remove(); }
  assert.deepEqual(f.calls, [['close', []], ['entry', []], ['object', []], ['heading']]);
  assert.deepEqual(f.events.map(e => [e.branch, e.phase]), [
    ['close-objects', 'called'], [undefined, 'returned'],
    ['objects-entry', 'called'], [undefined, 'returned'],
    ['object-button', 'called'], [undefined, 'returned'],
  ]);
});

test('详情已关闭时不制造关闭点击，原入口仍必须点击', async () => {
  const f = fixture({ opened: false });
  assert.equal(await selectObject(f.page, f.reference), '翠兰');
  assert.deepEqual(f.calls, [['entry', []], ['object', []], ['heading']]);
});

test('关闭失败保留原错误对象，观察器失败不改错且不继续点击底层入口', async () => {
  const error = new Error('原关闭 5000ms 超时'), f = fixture({ closeError: error });
  const remove = observeSelectionClicks(f.page, event => { f.events.push(event); if (event.phase === 'threw') throw new Error('只读观察器失败'); return 'close'; });
  try { await assert.rejects(selectObject(f.page, f.reference), value => value === error); } finally { remove(); }
  assert.deepEqual(f.calls, [['close', []]]);
  assert.deepEqual(f.events.map(e => e.phase), ['called', 'threw']); assert.equal(f.events[1].error, error);
});

test('关闭未完成时不提前启动入口点击，完成后仍按原顺序选择', async () => {
  let release; const closeWait = new Promise(resolve => { release = resolve; }), f = fixture({ closeWait });
  let started; const entered = new Promise(resolve => { started = resolve; });
  const remove = observeSelectionClicks(f.page, event => { if (event.branch === 'close-objects') started(); return 'pending-close'; });
  const pending = selectObject(f.page, f.reference);
  await entered; assert.deepEqual(f.calls, [['close', []]]);
  release(); try { assert.equal(await pending, '翠兰'); } finally { remove(); }
  assert.deepEqual(f.calls, [['close', []], ['entry', []], ['object', []], ['heading']]);
});

test('前置关闭不吞原对象入口异常，不重试或跳到对象点击', async () => {
  const error = new Error('原入口 5000ms 超时'), f = fixture({ entryError: error });
  await assert.rejects(selectObject(f.page, f.reference), value => value === error);
  assert.deepEqual(f.calls, [['close', []], ['entry', []]]);
});
