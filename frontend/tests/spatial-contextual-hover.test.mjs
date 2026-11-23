import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { ScenePointerGesture } from '../src/domain/spatial-camera-gesture.ts';

// 执行生产 SFC 的指针处理与模式 watcher；DOM/Canvas 命中和 rAF 由受控边界替身提供。
const source = await readFile(new URL('../src/features/world/SpatialMap.vue', import.meta.url), 'utf8');
const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)?.[1]; assert.ok(script);
const parsed = ts.createSourceFile('SpatialMap.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const functions = parsed.statements.filter(ts.isFunctionDeclaration).map(node => node.getText(parsed));
const modeWatches = parsed.statements.filter(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
  && node.expression.expression.getText(parsed) === 'watch' && node.expression.arguments[0]?.getText(parsed).includes('props.labelMode'));
const code = ts.transpileModule([...functions, ...modeWatches.map(node => node.getText(parsed))].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const leaveHandler = source.match(/@pointerleave="([\w]+)"/)?.[1] ?? '() => {}';

function harness(mode = 'contextual') {
  const calls = [], pending = [], watches = [], captured = new Set();
  const props = { labelMode: mode, immersive: true, disabled: false };
  const element = { style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 500, height: 400 }),
    focus() {}, setPointerCapture(id) { captured.add(id); }, hasPointerCapture(id) { return captured.has(id); }, releasePointerCapture(id) { captured.delete(id); } };
  const api = new Function('bindings', `
    const { props, element, calls, pending, watches, ScenePointerGesture } = bindings;
    const canvas = { value: element }, displaySnapshot = { value: { projection: { scene: { sceneId: 'yard' } } } }, snapshotSubscription = null;
    const painter = { hit: point => point.x >= 100 && point.x <= 120 && point.y >= 140 && point.y <= 160
      || hovered === 'elder' && point.x >= 80 && point.x <= 140 && point.y >= 80 && point.y <= 100 ? 'elder' : null, point: point => point };
    const gesture = new ScenePointerGesture(), dragging = { value: false }, cameraState = { value: { mode: 'follow', canReturn: false } };
    const camera = { pan() { return true; }, reset() {} }, held = new Set(), stopped = false;
    let frame = 0, hovered, hoverPoint = null, capturedPointer = null, cameraScope = '';
    let renderedFrame = { viewport: { width: 500, height: 400 } };
    const requestAnimationFrame = callback => { pending.push(callback); return pending.length; };
    const emit = (...args) => calls.push(args);
    const watch = (read, callback) => watches.push({ read, callback });
    ${code}
    return { pointerMove, pointerDown, pointerUp, resetCamera, leave: ${leaveHandler},
      get hovered() { return hovered; }, get dragging() { return dragging.value; },
      drain() { pending.length = 0; frame = 0; },
      mode(value) { const before = props.labelMode; props.labelMode = value; for (const watcher of watches) watcher.callback(value, before); },
    };` )({ props, element, calls, pending, watches, ScenePointerGesture });
  const event = (extra = {}) => ({ pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, buttons: 0, clientX: 110, clientY: 150, preventDefault() {}, ...extra });
  return { api, event, pending, calls, element };
}

test('GZ-HC-04：停帧后真实悬停/离开处理唤醒一次绘制，同一目标移动不空转', () => {
  const h = harness();
  h.api.pointerMove(h.event());
  assert.equal(h.api.hovered, 'elder'); assert.equal(h.pending.length, 1, '首次悬停必须请求绘制');
  h.api.drain(); h.api.pointerMove(h.event({ clientX: 111 }));
  assert.equal(h.pending.length, 0, '同一对象不重复启动停帧画布');
  h.api.leave(); assert.equal(h.api.hovered, undefined); assert.equal(h.pending.length, 1, '离开画布需清除旧名称');
  assert.deepEqual(h.calls, [], '悬停不产生世界动作');
});

test('GZ-HC-04：拖动、触屏和场景重置不残留 hover，触屏本体仍可选中', () => {
  const h = harness();
  h.api.pointerMove(h.event()); h.api.drain();
  h.api.pointerDown(h.event({ buttons: 1 }));
  assert.equal(h.api.hovered, 'elder', '尚未越过拖动阈值时保持可点名称');
  h.api.pointerMove(h.event({ buttons: 1, clientX: 150 }));
  assert.equal(h.api.dragging, true); assert.equal(h.api.hovered, undefined);
  h.api.pointerUp(h.event({ clientX: 150 })); assert.deepEqual(h.calls, [], '拖动不误选取或行走');
  h.api.pointerMove(h.event()); assert.equal(h.api.hovered, 'elder');
  h.api.pointerMove(h.event({ pointerType: 'touch' })); assert.equal(h.api.hovered, undefined, '触摸移动没有持续 hover');
  h.api.pointerDown(h.event({ pointerType: 'touch', buttons: 1 }));
  h.api.pointerUp(h.event({ pointerType: 'touch' }));
  assert.deepEqual(h.calls, [['select', 'elder']], '触屏轻点仍按本体命中选取');
  assert.equal(h.api.hovered, undefined, '触屏抬起不模拟鼠标悬停');
  h.api.pointerMove(h.event()); h.api.resetCamera(); assert.equal(h.api.hovered, undefined, '显示作用域复位不留下旧对象');
});

test('GZ-HC-04：全量模式沿用原光标，模式变化主动唤醒且不继承旧 hover', () => {
  const h = harness('all');
  h.api.pointerMove(h.event()); assert.equal(h.element.style.cursor, 'pointer');
  assert.equal(h.api.hovered, undefined); assert.equal(h.pending.length, 0);
  h.api.mode('contextual'); assert.equal(h.pending.length, 1, '模式变化唤醒静止场景');
  h.api.drain(); h.api.pointerMove(h.event()); assert.equal(h.api.hovered, 'elder');
  h.api.drain(); h.api.mode('all'); assert.equal(h.api.hovered, undefined); assert.equal(h.pending.length, 1);
  assert.deepEqual(h.calls, []);
});

test('GZ-HC-04：可见悬停名称按下后保持，松开只选择该对象而不点地', () => {
  const h = harness();
  h.api.pointerMove(h.event()); h.api.drain();
  const label = h.event({ clientY: 90 });
  h.api.pointerMove(label); h.api.pointerDown({ ...label, buttons: 1 });
  assert.equal(h.api.hovered, 'elder', '按住名称期间不能撤销其显示资格');
  h.api.drain(); h.api.pointerUp(label);
  assert.deepEqual(h.calls, [['select', 'elder']], '松开仍命中名称，不退化成 move');
});
