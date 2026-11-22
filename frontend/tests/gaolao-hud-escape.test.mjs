import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// 执行生产页面的键盘分派；只替换 DOM 目标、Vue ref 和关闭动作，检查持久化偏好不截断世界输入。
const source = await readFile(new URL('../src/features/session/SpatialSessionPage.vue', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('SpatialSessionPage.ts', source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1], ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const declaration = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'escape');
const code = ts.transpileModule(declaration.getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function room({ hud = true, guidance = false, dock = true, reading = null, more = false, receipts = false, objects = false, selected = '', target = 'world' } = {}) {
  const calls = [], ref = value => ({ value });
  class Target { closest(selector) { return selector === '.gaolao-dock-anchor' && target === 'dock' || selector === '.gaolao-map-navigator' && target === 'map' ? this : null; } }
  const bindings = { hud: ref(hud), guidanceExpanded: ref(guidance), dockExpanded: ref(dock), reading: ref(reading), receiptsOpen: ref(receipts), objectsOpen: ref(objects), selectedRef: ref(selected), canStop: ref(true),
    toolDock: ref({ closeMore() { if (!more) return false; more = false; calls.push('closeMore'); return true; }, focusFallback() { calls.push('dockFocus'); } }),
    guidanceToggle: ref({ focus() { calls.push('taskFocus'); } }), nextTick: callback => Promise.resolve().then(callback), HTMLElement: Target,
    closeReading() { calls.push('closeReading'); }, closeReceipts() { calls.push('closeReceipts'); }, closeObjects() { calls.push('closeObjects'); }, stop() { calls.push('stop'); },
  };
  const handler = new Function('bindings', `const {${Object.keys(bindings).join(',')}} = bindings; ${code}; return escape;`)(bindings);
  return { calls, bindings, async escape() { handler({ key: 'Escape', target: new Target(), preventDefault() { calls.push('preventDefault'); }, stopPropagation() { calls.push('stopPropagation'); } }); await Promise.resolve(); } };
}

test('灰盒忽略已保存的任务展开偏好，Esc 仍停步且不改写该偏好', async () => {
  const current = room({ hud: false, guidance: true }); await current.escape();
  assert.ok(current.calls.includes('stop')); assert.equal(current.bindings.guidanceExpanded.value, true);
});
test('工具栏内 Esc 收起并回焦收起后的工具入口，不发世界停步', async () => {
  const current = room({ target: 'dock' }); await current.escape();
  assert.equal(current.bindings.dockExpanded.value, false); assert.ok(current.calls.includes('dockFocus')); assert.ok(!current.calls.includes('stop'));
});
test('世界画布 Esc 保留停步，不因工具栏默认展开而先折叠', async () => {
  const current = room(); await current.escape();
  assert.ok(current.calls.includes('stop')); assert.equal(current.bindings.dockExpanded.value, true);
});
test('更多和阅读面板优先关闭，不连带收起底栏或发停步', async () => {
  for (const configuration of [{ more: true, reading: 'notebook', expected: 'closeMore' }, { reading: 'notebook', expected: 'closeReading' }]) {
    const current = room({ ...configuration, target: 'dock' }); await current.escape();
    assert.ok(current.calls.includes(configuration.expected)); assert.equal(current.bindings.dockExpanded.value, true); assert.ok(!current.calls.includes('stop'));
  }
});

test('键盘焦点移到地图后 Esc 仍先关闭上层临时面板并阻止地图同次处理', async () => {
  for (const configuration of [
    { more: true, reading: 'notebook', expected: 'closeMore' },
    { reading: 'notebook', expected: 'closeReading' },
    { receipts: true, expected: 'closeReceipts' },
    { objects: true, expected: 'closeObjects' },
    { selected: 'visible-person', expected: 'closeObjects' },
  ]) {
    const current = room({ ...configuration, target: 'map' }); await current.escape();
    assert.deepEqual(current.calls.filter(value => value.startsWith('close')), [configuration.expected]);
    assert.ok(current.calls.includes('preventDefault')); assert.ok(current.calls.includes('stopPropagation'));
    assert.ok(!current.calls.includes('stop')); assert.equal(current.bindings.dockExpanded.value, true);
  }
});

test('没有上层临时面板时地图自行处理 Esc，不连带收起任务或停步', async () => {
  const current = room({ target: 'map', guidance: true }); await current.escape();
  assert.deepEqual(current.calls, []); assert.equal(current.bindings.guidanceExpanded.value, true);
});
