import test from 'node:test';
import assert from 'node:assert/strict';
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
