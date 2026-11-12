import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../web/engine.mjs';
import { createNavigation } from '../web/navigation.mjs';
import { facingFromDisplacement, gaocaiDirection, gaocaiFrameIndex } from '../web/gaocai-animation.mjs';

test('高才实际位移量化八向；零位移保留朝向；西侧只镜像对应原生组', () => {
  for (const [dx, dy, direction] of [[0, 1, 's'], [1, 1, 'se'], [1, 0, 'e'], [1, -1, 'ne'], [0, -1, 'n'], [-1, -1, 'nw'], [-1, 0, 'w'], [-1, 1, 'sw']]) {
    assert.equal(facingFromDisplacement(dx, dy, 's'), direction);
  }
  assert.equal(facingFromDisplacement(0, 0, 'nw'), 'nw');
  assert.deepEqual(gaocaiDirection('w'), { nativeDirection: 'e', mirrorX: true });
  assert.deepEqual(gaocaiDirection('sw'), { nativeDirection: 'se', mirrorX: true });
  assert.deepEqual(gaocaiDirection('nw'), { nativeDirection: 'ne', mirrorX: true });
  assert.deepEqual(gaocaiDirection('n'), { nativeDirection: 'n', mirrorX: false });
});

test('绕花圃的真实末路段决定停步朝向，零位移指令不改朝向', () => {
  const game = createGame();
  const actor = game.state.actors.gaocai;
  assert.equal(actor.facing, 's');
  assert.equal(game.moveTo(490, 400).rerouted, true);
  game.update(60);
  assert.equal(actor.moving, false);
  assert.equal(actor.facing, 'ne', '末段从花圃左侧向右上到达；不能使用鼠标目标相对起点的西北方向');
  const distance = actor.walkDistance;
  game.moveTo(490, 400);
  game.update(1);
  assert.equal(actor.facing, 'ne');
  assert.equal(actor.walkDistance, distance);
});

test('停步、切换与静止更新保留末朝向和步态距离；重开清零', () => {
  const game = createGame();
  const navigation = createNavigation(game);
  const actor = game.state.actors.gaocai;
  navigation.move(1000, 790);
  game.update(0.2);
  assert.equal(actor.facing, 'e');
  assert.ok(Math.abs(actor.walkDistance - 41) < 0.00001);
  assert.equal(gaocaiFrameIndex(actor.walkDistance), 2);
  navigation.stop();
  navigation.select('carpenter');
  game.update(10);
  navigation.select('gaocai');
  assert.equal(actor.moving, false);
  assert.equal(actor.facing, 'e');
  assert.ok(Math.abs(actor.walkDistance - 41) < 0.00001);
  game.reset();
  assert.notEqual(game.state.actors.gaocai, actor);
  assert.equal(game.state.actors.gaocai.facing, 's');
  assert.equal(game.state.actors.gaocai.walkDistance, 0);
});

test('距离帧相位在147.6地图单位后循环，不依赖页面总时钟', () => {
  assert.equal(gaocaiFrameIndex(0), 0);
  assert.equal(gaocaiFrameIndex(18.46), 1);
  assert.equal(gaocaiFrameIndex(129.16), 7);
  assert.equal(gaocaiFrameIndex(147.61), 0);
});
