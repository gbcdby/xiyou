import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAP, createGame } from '../web/engine.mjs';
import { createRenderer } from '../web/world.mjs';

function walk(game, id, point) {
  assert.equal(game.select(id).ok, true);
  assert.equal(game.moveTo(point.x, point.y).ok, true);
  game.update(60);
  assert.equal(game.state.actors[id].moving, false);
}

function openDoor(game) {
  for (const [id, side, point] of [['gaocai', 'left', MAP.points.leftSupport], ['carpenter', 'right', MAP.points.rightSupport]]) {
    walk(game, id, MAP.points.wood);
    assert.equal(game.interact('wood', 'take-material').ok, true);
    walk(game, id, point);
    assert.equal(game.interact(`${side}-support`, 'install').ok, true);
  }
  walk(game, 'gaocai', game.state.actors.wukong);
  assert.equal(game.interact('wukong', 'request-open').ok, true);
  for (let frame = 0; !game.state.facts.doorOpen && frame < 300; frame += 1) game.update(0.05);
  assert.equal(game.state.facts.doorOpen, true);
}

function rendererFor(t, game) {
  const originals = new Map(['window', 'Image'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { devicePixelRatio: 1 } });
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: class {} });
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  // 仅隔离 Canvas 宿主初始化，命中逻辑和游戏状态使用真实实现。
  return createRenderer({
    getContext: () => ({ setTransform() {} }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1600, height: 1000 }),
  }, game);
}

test('人物点击：开门后翠兰从头到脚可选，悟空与已移除门障不能抢走点击', t => {
  const game = createGame();
  const renderer = rendererFor(t, game);
  openDoor(game);
  const cuilan = game.state.actors.cuilan;
  assert.equal(renderer.hitTest({ x: cuilan.x, y: cuilan.y - 30 })?.id, 'cuilan', '开门瞬间同位置重叠应命中最后绘制的翠兰');
  game.update(2);
  for (const [dx, dy] of [[0, -55], [0, -30], [-9, -17], [8, -8], [0, -3]]) {
    assert.equal(renderer.hitTest({ x: cuilan.x + dx, y: cuilan.y + dy })?.id, 'cuilan', `翠兰身体位置 (${dx}, ${dy}) 应可直接点击`);
  }
  const wukong = game.state.actors.wukong;
  assert.equal(renderer.hitTest({ x: wukong.x, y: wukong.y - 30 })?.id, 'wukong', '让路后的悟空仍可独立点击');
});

test('高才清单的站姿、锚点或帧时长损坏时继续绘制旧人物，不中断场景', async t => {
  const originals = new Map(['window', 'Image', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { devicePixelRatio: 1 } });
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: class {
    set src(value) { this.url = value; this.complete = true; this.naturalWidth = 1; queueMicrotask(() => this.onload?.()); }
    get src() { return this.url; }
  } });
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const source = JSON.parse(readFileSync(new URL('../web/assets/gaocai/manifest.json', import.meta.url), 'utf8'));
  for (const [label, damage] of [
    ['缺站姿', manifest => { manifest.native.s.idle = null; }],
    ['缺脚底锚点', manifest => { manifest.native.s.idle.footPivot = null; }],
    ['帧时长为零', manifest => { manifest.native.s.walk.frameDurationMs = 0; }],
  ]) {
    const manifest = structuredClone(source);
    damage(manifest);
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async () => ({ ok: true, json: async () => manifest }) });
    const errors = [], pictures = [], labels = [];
    // 只隔离 Canvas 宿主；实际清单预载、回退决策和场景 draw 全部执行。
    const ctx = new Proxy({
      measureText: () => ({ width: 30 }),
      createLinearGradient: () => ({ addColorStop() {} }),
      drawImage: image => pictures.push(image.src),
      fillText: value => labels.push(value),
    }, { get: (target, key) => target[key] ?? (() => {}) });
    const game = createGame();
    const renderer = createRenderer({
      getContext: () => ctx,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1600, height: 1000 }),
    }, game, error => errors.push(error));
    await new Promise(resolve => setImmediate(resolve));
    assert.doesNotThrow(() => renderer.draw(0, 0.016), label);
    game.moveTo(1000, 790);
    game.update(0.2);
    assert.doesNotThrow(() => renderer.draw(0.2, 0.016), `${label}后仍能行走`);
    assert.ok(errors.some(error => error.kind === 'character'), `${label}应报告角色资源错误`);
    assert.ok(labels.includes('高才 · 你'), `${label}后角色与玩家标记仍在场景中`);
    assert.equal(pictures.some(url => url.includes('/gaocai/')), false, `${label}应使用旧矢量人物`);
  }
});
