import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, MAP } from '../web/engine.mjs';
import { createNavigation } from '../web/navigation.mjs';

function settle(game, navigation) {
  for (let n=0;n<3000 && navigation.pending;n++) {
    game.update(.05);
    navigation.update();
  }
  assert.equal(navigation.pending, null, '导航应有确定终点');
}

test('护送引导必须走进安置点，不能停在普通交互距离外沿', () => {
  const game=createGame(), navigation=createNavigation(game);
  assert.equal(navigation.approach('safe', null, true).ok, true);
  settle(game,navigation);
  const actor=game.state.actors.gaocai;
  assert.ok(Math.hypot(actor.x-MAP.points.safe.x,actor.y-MAP.points.safe.y)<6);
});

test('切换角色取消旧排队动作和行走，不能让新角色拿到旧请求的木料', () => {
  const game=createGame(), navigation=createNavigation(game);
  navigation.approach('wood','take-material');
  game.update(.1);
  const before={...game.state.actors.gaocai};
  navigation.select('carpenter');
  game.update(30);
  navigation.update();
  assert.equal(navigation.pending,null);
  assert.equal(game.state.activeId,'carpenter');
  assert.equal(game.state.items['wood-gaocai'].owner,'wood');
  assert.equal(game.state.items['wood-carpenter'].owner,'wood');
  assert.equal(game.state.actors.gaocai.x,before.x);
  assert.equal(game.state.actors.gaocai.y,before.y);
});

test('停止和重新点击空地取消到达动作，走近再操作仍可重新完成', () => {
  const game=createGame(), navigation=createNavigation(game);
  navigation.approach('wood','take-material');
  navigation.stop();
  game.update(30);navigation.update();
  assert.equal(game.state.items['wood-gaocai'].owner,'wood');
  navigation.approach('wood','take-material');
  navigation.move(1000,800);
  game.update(30);navigation.update();
  assert.equal(game.state.items['wood-gaocai'].owner,'wood');
  navigation.approach('wood','take-material');
  settle(game,navigation);
  assert.equal(game.state.items['wood-gaocai'].owner,'gaocai');
});

test('定位只负责带路，远处动作在抵达后才执行，重复请求不复制物件', () => {
  const game=createGame(), navigation=createNavigation(game);
  navigation.approach('wood',null,true);
  settle(game,navigation);
  assert.equal(game.state.items['wood-gaocai'].owner,'wood');
  assert.equal(navigation.approach('wood','take-material').ok,true);
  assert.equal(game.state.items['wood-gaocai'].owner,'gaocai');
  assert.equal(navigation.approach('wood','take-material').ok,false);
  assert.equal(Object.values(game.state.items).filter(item=>item.owner==='gaocai').length,1);
});
