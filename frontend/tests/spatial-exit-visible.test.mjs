import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { visibleSelf } from '../src/rendering/spatial-presentation.ts';

const pageSource = await readFile(new URL('../src/features/session/SpatialSessionPage.vue', import.meta.url), 'utf8');
const mapSource = await readFile(new URL('../src/features/world/SpatialMap.vue', import.meta.url), 'utf8');
const storeSource = await readFile(new URL('../src/state/spatial-store.ts', import.meta.url), 'utf8');
function functions(source, names) {
  const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)?.[1] ?? source;
  const parsed = ts.createSourceFile('subject.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const selected = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
  return ts.transpileModule(selected.map(node => node.getText(parsed)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText.replace(/^export /gm, '');
}
const clickExpression = pageSource.match(/<h2>场景出口<\/h2>[\s\S]*?@click="([^"]+)"/)?.[1];
assert.ok(clickExpression, '执行实际出口模板绑定，不能手写替代调用');
const pageCode = functions(pageSource, ['closeObjects', 'openMap', 'traverseExit', 'stop']);
const mapCode = functions(mapSource, ['revealScene']);
const performCode = functions(storeSource, ['performSpatial']);

// 真实 SFC 入口和方法，DOM滚动几何是受控替身；不伪造 paint、到达或呈现信用。
function fixture({ canvasPresent = true, connected = true, request = Promise.resolve() } = {}) {
  const calls = [], panels = {
    reading: { value: 'inventory' }, receiptsOpen: { value: true }, objectsOpen: { value: true },
    selectedRef: { value: '已选对象' }, recipient: { value: '原接收人' },
  };
  const style = { display: 'block', visibility: 'visible', opacity: '1', overflowX: 'visible', overflowY: 'visible' };
  let top = -240;
  const rect = () => ({ left: 100, top, right: 800, bottom: top + 400, width: 700, height: 400 });
  const element = {
    isConnected: connected, parentElement: null,
    ownerDocument: { hidden: false, visibilityState: 'visible', defaultView: { innerWidth: 1280, innerHeight: 900, getComputedStyle: () => style } },
    getBoundingClientRect: rect, getClientRects: () => [rect()],
    scrollIntoView(options) { calls.push(['scroll', options]); top = 250; },
    focus() { calls.push(['focus']); },
  };
  const canvas = { value: canvasPresent ? element : null };
  const revealScene = new Function('canvas', 'schedule', `${mapCode}; return typeof revealScene === 'function' ? revealScene : undefined;`)(canvas, () => calls.push(['schedule']));
  const sceneMap = { value: { revealScene } };
  const spatialNotice = { value: '' };
  const spatialClient = {
    traverseExit(exitId) { calls.push(['traverseExit', exitId]); return request; },
    stop() { calls.push(['stop']); return Promise.resolve(); },
    confirmDisplayedArrival() { calls.push(['forbidden-arrival']); },
  };
  const run = new Function('bindings', `
    const { reading, receiptsOpen, objectsOpen, selectedRef, recipient, sceneMap, spatialClient, spatialNotice, nextTick } = bindings;
    let readingTrigger = { focus(){ throw Error('不得恢复旧焦点'); }, isConnected: true };
    let objectsTrigger = readingTrigger, receiptsTrigger = readingTrigger;
    ${performCode}\n${pageCode}
    return { click(exit) { ${clickExpression}; }, stop, trigger: () => readingTrigger, panelTriggers: () => [objectsTrigger, receiptsTrigger] };
  `)({ ...panels, sceneMap, spatialClient, spatialNotice, nextTick: () => calls.push(['forbidden-defer']) });
  const frame = { viewport: { width: 700, height: 400, dpr: 1 }, fit: { x: 0, y: 0, scale: 1 }, view: { x: 0, y: 0, width: 700, height: 400 }, actors: [{ ref: '本人', position: { x: 560, y: 80 } }] };
  return { ...run, calls, panels, canvas, sceneMap, spatialNotice, visible: () => visibleSelf(element, frame, '本人') };
}

test('原出口点击同步恢复场景并只发送一次原请求；滚动不是到达证明', () => {
  const f = fixture(); assert.equal(f.visible(), false);
  f.click({ exitId: 'to-road' });
  assert.deepEqual(f.calls, [
    ['traverseExit', 'to-road'], ['scroll', { behavior: 'instant', block: 'center', inline: 'nearest' }], ['schedule'],
  ]);
  assert.equal(f.visible(), true, '只证明受控几何恢复，不冒充真实Canvas paint');
  assert.deepEqual(Object.fromEntries(Object.entries(f.panels).map(([k, v]) => [k, v.value])), {
    reading: null, receiptsOpen: false, objectsOpen: false, selectedRef: '', recipient: '',
  });
  assert.equal(f.trigger(), null);
  assert.deepEqual(f.panelTriggers(), [null, null]);
});

test('原请求未回时新停步及换组件不会被迟到续体重新发起或再次滚动', async () => {
  let resolve; const request = new Promise(done => { resolve = done; }), f = fixture({ request });
  f.click({ exitId: 'to-road' }); f.stop();
  f.sceneMap.value = { revealScene: () => f.calls.push(['forbidden-new-view-reveal']) };
  const before = structuredClone(f.calls); resolve(); await request; await Promise.resolve();
  assert.deepEqual(f.calls, before);
  assert.equal(f.calls.filter(row => row[0] === 'traverseExit').length, 1);
  assert.equal(f.calls.filter(row => row[0] === 'stop').length, 1);
  assert.equal(f.calls.filter(row => row[0] === 'scroll').length, 1);
});

test('缺少或已卸载canvas不制造可见、绘制、焦点或到达；仍沿原请求处理', () => {
  for (const options of [{ canvasPresent: false }, { connected: false }]) {
    const f = fixture(options); f.click({ exitId: 'to-road' });
    assert.deepEqual(f.calls, [['traverseExit', 'to-road']]);
  }
});

test('原请求失败沿performSpatial显示原错，不重发或延迟恢复场景', async () => {
  let reject; const request = new Promise((_done, fail) => { reject = fail; }), f = fixture({ request });
  f.click({ exitId: 'to-road' }); const before = structuredClone(f.calls);
  reject(new Error('原出口不可达')); await Promise.resolve(); await Promise.resolve();
  assert.equal(f.spatialNotice.value, '原出口不可达');
  assert.deepEqual(f.calls, before);
});
