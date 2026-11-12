import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP, createGame } from '../web/engine.mjs';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const actor = (game, id = game.state.activeId) => game.state.actors[id];

function assertLegalPoint(point) {
  const r = MAP.actorRadius;
  assert.ok(point.x >= MAP.bounds.left + r && point.x <= MAP.bounds.right - r, '角色不得越过横向界限');
  assert.ok(point.y >= MAP.bounds.top + r && point.y <= MAP.bounds.bottom - r, '角色不得越过纵向界限');
  for (const wall of MAP.obstacles) {
    const inside = point.x > wall.x - r && point.x < wall.x + wall.w + r && point.y > wall.y - r && point.y < wall.y + wall.h + r;
    assert.equal(inside, false, `角色不得穿过 ${wall.id}`);
  }
}

function walk(game, id, point) {
  assert.equal(game.select(id).ok, true);
  const result = game.moveTo(point.x, point.y);
  assert.equal(result.ok, true, result.message);
  for (let frame = 0; actor(game, id).moving && frame < 1000; frame += 1) game.update(0.05);
  assert.equal(actor(game, id).moving, false, '必须能到达可达目标');
  assert.ok(distance(actor(game, id), point) < 1, '必须实际走到目标');
}

function takeWood(game, id) {
  walk(game, id, MAP.points.wood);
  assert.equal(game.interact('wood', 'take-material').ok, true);
}

function installSupports(game) {
  takeWood(game, 'gaocai');
  walk(game, 'gaocai', MAP.points.leftSupport);
  assert.equal(game.interact('left-support', 'install').ok, true);
  takeWood(game, 'carpenter');
  walk(game, 'carpenter', MAP.points.rightSupport);
  assert.equal(game.interact('right-support', 'install').ok, true);
}

function until(game, condition, message) {
  for (let frame = 0; !condition() && frame < 1600; frame += 1) game.update(0.05);
  assert.equal(Boolean(condition()), true, message);
}

function openDoor(game) {
  installSupports(game);
  walk(game, 'gaocai', actor(game, 'wukong'));
  assert.equal(game.interact('wukong', 'request-open').ok, true);
  until(game, () => game.state.facts.doorOpen, '悟空必须能走到门前并处理铜封');
}

function rescue(game) {
  openDoor(game);
  walk(game, 'gaocai', actor(game, 'cuilan'));
  assert.equal(game.interact('cuilan', 'invite').ok, true);
  walk(game, 'gaocai', MAP.points.safe);
  until(game, () => game.state.facts.cuilanSafe, '翠兰必须能够实际到达安置点');
}

function gatherEvidence(game) {
  walk(game, 'gaocai', MAP.points.ledger);
  assert.equal(game.interact('ledger', 'take-ledger').ok, true);
  walk(game, 'carpenter', MAP.points.cook);
  assert.equal(game.interact('cook', 'hear-story').ok, true);
  walk(game, 'gaocai', actor(game, 'tangseng'));
  assert.equal(game.interact('tangseng', 'show-ledger').ok, true);
}

test('移动：绕过花圃与石桌，每段路径和实际位置均合法', () => {
  const game = createGame();
  const start = { ...actor(game) };
  const result = game.moveTo(890, 400);
  assert.equal(result.ok, true, '可达的目的地应当接受移动');
  assert.equal(result.rerouted, true, '直线遇障碍时应当绕行');
  let previous = start;
  for (const next of actor(game).path) {
    const samples = Math.ceil(distance(previous, next));
    for (let sample = 0; sample <= samples; sample += 1) {
      const t = samples ? sample / samples : 1;
      assertLegalPoint({ x: previous.x + (next.x - previous.x) * t, y: previous.y + (next.y - previous.y) * t });
    }
    previous = next;
  }
  for (let frame = 0; actor(game).moving && frame < 1000; frame += 1) {
    game.update(0.08);
    assertLegalPoint(actor(game));
  }
  assert.ok(distance(actor(game), { x: 890, y: 400 }) < 1);
});

test('移动：越界和障碍目标被拒绝，大 dt 不绕过路线', () => {
  const game = createGame();
  assert.equal(game.moveTo(10, 600).ok, false);
  assert.equal(game.moveTo(800, 520).ok, false);
  assert.equal(game.moveTo(Number.NaN, 700).ok, false);
  const start = { ...actor(game) };
  assert.equal(game.moveTo(890, 400).ok, true);
  game.update(1000);
  assertLegalPoint(actor(game));
  assert.ok(distance(actor(game), { x: 890, y: 400 }) < 1);
  assert.ok(distance(actor(game), start) > 100);
});

test('移动：切换角色不瞬移，未选角色继续已下达的行走，重置保留 state 引用', () => {
  const game = createGame();
  const state = game.state;
  const first = { ...actor(game) };
  assert.equal(game.moveTo(450, 795).ok, true);
  assert.equal(game.select('carpenter').ok, true);
  const second = { ...actor(game) };
  assert.equal(game.select('wukong').ok, false, 'NPC 不可变成玩家位');
  game.update(0.5);
  assert.ok(distance(actor(game, 'gaocai'), first) > 1);
  assert.equal(distance(actor(game, 'carpenter'), second), 0);
  assert.equal(game.reset().ok, true);
  assert.equal(game.state, state);
  assert.equal(game.state.activeId, 'gaocai');
  assert.equal(actor(game).x, 690);
  assert.equal(actor(game).moving, false);
});

test('协作：木料唯一，远程操作被拒绝，一人不能包办两个支架', () => {
  const game = createGame();
  assert.equal(game.interact('wood', 'take-material').ok, false, '必须走近木料');
  takeWood(game, 'gaocai');
  assert.equal(game.state.items['wood-gaocai'].owner, 'gaocai');
  assert.equal(game.state.items['wood-carpenter'].owner, 'wood');
  assert.equal(game.interact('wood', 'take-material').ok, false, '重复领取不得复制');
  walk(game, 'gaocai', MAP.points.leftSupport);
  assert.equal(game.interact('left-support', 'install').ok, true);
  assert.equal(game.state.supports.left, 'gaocai');
  assert.equal(game.state.items['wood-gaocai'].owner, 'left-support');
  assert.equal(game.interact('left-support', 'install').ok, false, '已锁定的支架不重复消耗');
  walk(game, 'gaocai', MAP.points.wood);
  assert.equal(game.interact('wood', 'take-material').ok, false, '不能拿走另一角色预留的材料');
  walk(game, 'gaocai', MAP.points.rightSupport);
  assert.equal(game.interact('right-support', 'install').ok, false);
  takeWood(game, 'carpenter');
  walk(game, 'carpenter', MAP.points.rightSupport);
  assert.equal(game.interact('right-support', 'install').ok, true);
  assert.deepEqual(game.state.supports, { left: 'gaocai', right: 'carpenter' });
  assert.equal(game.state.facts.doorOpen, false, '准备成功不直接开门');
  walk(game, 'gaocai', MAP.points.safe);
  assert.deepEqual(game.state.supports, { left: 'gaocai', right: 'carpenter' }, '离开操作点不解除锁定');
});

test('引导：下一步可指出需要切换的角色，目标点都可以导航', () => {
  const game = createGame();
  assert.equal(game.getObjective().targetId, 'wood');
  takeWood(game, 'gaocai');
  assert.equal(game.getObjective().targetId, 'left-support');
  walk(game, 'gaocai', MAP.points.leftSupport);
  assert.equal(game.interact('left-support', 'install').ok, true);
  assert.equal(game.getObjective().roleId, 'carpenter');
  for (const target of game.getTargets()) assertLegalPoint(target);
  const woodActions = game.getActions('wood');
  assert.equal(woodActions.find((action) => action.id === 'take-material').enabled, false);
  assert.equal(game.select('carpenter').ok, true);
  assert.equal(game.getActions('wood').find((action) => action.id === 'take-material').enabled, true, '动作可用性不冒充距离检查');
});

test('救援：请求不等于开门，悟空必须真实到达且重复请求无额外副作用', () => {
  const game = createGame();
  installSupports(game);
  game.update(60);
  assert.equal(game.state.facts.doorOpen, false);
  walk(game, 'gaocai', actor(game, 'wukong'));
  assert.equal(game.interact('wukong', 'request-open').ok, true);
  assert.equal(game.state.facts.openingRequested, true);
  assert.equal(game.state.facts.doorOpen, false, '对白不能直接写成门已打开');
  assert.equal(actor(game, 'wukong').moving, true);
  const eventCount = game.state.logs.length;
  assert.equal(game.interact('wukong', 'request-open').ok, false);
  assert.equal(game.state.logs.length, eventCount);
  game.update(0.01);
  assert.equal(game.state.facts.doorOpen, false);
  until(game, () => game.state.facts.doorOpen, '悟空抵达才开门');
  assert.ok(distance(actor(game, 'wukong'), MAP.points.door) < 1);
  assert.equal(actor(game, 'cuilan').visible, true);
});

test('救援：悟空开门后连续走到一旁，让翠兰保持在原位等待邀请', () => {
  const game = createGame();
  openDoor(game);
  assert.equal(actor(game, 'wukong').moving, true, '开门后应主动让开人物交互位置');
  let previous = { ...actor(game, 'wukong') };
  assert.ok(distance(previous, MAP.points.door) < 1, '必须先实际到达门边再让路');
  for (let frame = 0; actor(game, 'wukong').moving && frame < 150; frame += 1) {
    game.update(0.02);
    const current = actor(game, 'wukong');
    assert.ok(distance(current, previous) <= current.speed * 0.02 + 0.001, '让路必须沿路径连续行走，不能瞬移');
    assertLegalPoint(current);
    previous = { ...current };
  }
  assert.equal(actor(game, 'wukong').moving, false, '让路应有确定终点');
  assert.ok(distance(actor(game, 'wukong'), actor(game, 'cuilan')) >= 90, '两人的身体与点击区域应清晰分离');
  assert.ok(distance(actor(game, 'cuilan'), MAP.points.door) < 1, '未经同意不能先行挪走翠兰');
  assert.equal(game.state.facts.cuilanConsented, false);
  assert.equal(game.state.facts.cuilanSafe, false);
});

test('随行：同意和翠兰本人实际到达缺一不可，切角色不替代她到场', () => {
  const game = createGame();
  openDoor(game);
  walk(game, 'gaocai', MAP.points.safe);
  game.update(10);
  assert.equal(game.state.facts.cuilanSafe, false);
  assert.equal(actor(game, 'bajie').visible, false, '安全前猪刚鬣不能归来');
  walk(game, 'gaocai', actor(game, 'cuilan'));
  assert.equal(game.interact('cuilan', 'invite').ok, true);
  assert.equal(game.state.facts.cuilanConsented, true);
  assert.equal(game.state.facts.cuilanSafe, false);
  assert.equal(game.moveTo(MAP.points.safe.x, MAP.points.safe.y).ok, true);
  assert.equal(game.select('carpenter').ok, true);
  until(game, () => !actor(game, 'gaocai').moving, '原领队继续走路');
  if (distance(actor(game, 'cuilan'), MAP.points.safe) > 1) assert.equal(game.state.facts.cuilanSafe, false);
  until(game, () => game.state.facts.cuilanSafe, '翠兰自己到达后才确认安全');
  assert.ok(distance(actor(game, 'cuilan'), MAP.points.safe) < 1);
  assert.equal(actor(game, 'bajie').visible, true);
});

test('随行：暂停保留位置，远程换领队失败，近距换领队后不再追旧角色', () => {
  const game = createGame();
  openDoor(game);
  walk(game, 'gaocai', actor(game, 'cuilan'));
  assert.equal(game.interact('cuilan', 'invite').ok, true);
  assert.equal(game.moveTo(1050, 700).ok, true);
  game.update(0.45);
  assert.equal(game.interact('cuilan', 'pause').ok, true);
  const paused = { ...actor(game, 'cuilan') };
  assert.equal(game.moveTo(450, 795).ok, true);
  game.update(2);
  assert.ok(distance(actor(game, 'cuilan'), paused) < 0.001);
  walk(game, 'carpenter', { x: 1350, y: 820 });
  assert.equal(game.interact('cuilan', 'take-lead').ok, false);
  walk(game, 'carpenter', actor(game, 'cuilan'));
  assert.equal(game.interact('cuilan', 'take-lead').ok, true);
  assert.equal(game.state.follow.leaderId, 'carpenter');
  const afterHandoff = { ...actor(game, 'cuilan') };
  walk(game, 'gaocai', { x: 400, y: 700 });
  assert.ok(distance(actor(game, 'cuilan'), afterHandoff) < 1, '旧领队不能继续牵引翠兰');
  walk(game, 'carpenter', MAP.points.safe);
  until(game, () => game.state.facts.cuilanSafe, '新的带路安排能够完成安置');
});

test('恢复：重置切断悟空与随行的旧计划，不会在新局自动完成旧动作', () => {
  const game = createGame();
  installSupports(game);
  walk(game, 'gaocai', actor(game, 'wukong'));
  assert.equal(game.interact('wukong', 'request-open').ok, true);
  game.reset();
  game.update(60);
  assert.equal(game.state.facts.doorOpen, false);
  assert.equal(actor(game, 'wukong').moving, false);
  openDoor(game);
  walk(game, 'gaocai', actor(game, 'cuilan'));
  assert.equal(game.interact('cuilan', 'invite').ok, true);
  game.moveTo(450, 795);
  game.update(0.2);
  game.reset();
  game.update(60);
  assert.equal(game.state.facts.cuilanSafe, false);
  assert.equal(game.state.follow.leaderId, null);
  assert.equal(game.state.items.ledger.owner, 'ledger');
  assert.equal(game.state.items['wood-gaocai'].owner, 'wood');
  assert.equal(game.state.items['wood-carpenter'].owner, 'wood');
  assert.equal(game.state.logs.length, 0);
});

test('证据：账本只有一个持有人，远程交接与旧持有人出示均失败', () => {
  const game = createGame();
  walk(game, 'gaocai', MAP.points.ledger);
  assert.equal(game.interact('ledger', 'take-ledger').ok, true);
  assert.equal(game.state.items.ledger.owner, 'gaocai');
  assert.equal(game.interact('ledger', 'take-ledger').ok, false);
  assert.equal(game.state.facts.ledgerRead, true);
  assert.equal(game.state.facts.cookHeard, false, '同一账本不能充当独立证词');
  assert.equal(game.interact('carpenter', 'give-ledger').ok, false, '远距离不能转交');
  walk(game, 'carpenter', actor(game, 'gaocai'));
  assert.equal(game.interact('gaocai', 'give-ledger').ok, false, '非持有人不能发起交接');
  assert.equal(game.select('gaocai').ok, true);
  assert.equal(game.interact('carpenter', 'give-ledger').ok, true);
  assert.equal(game.state.items.ledger.owner, 'carpenter');
  assert.equal(game.interact('carpenter', 'give-ledger').ok, false, '重复交接不复制物件');
  walk(game, 'gaocai', actor(game, 'tangseng'));
  assert.equal(game.interact('tangseng', 'show-ledger').ok, false, '旧持有人不能远程使用账本');
  walk(game, 'carpenter', actor(game, 'tangseng'));
  assert.equal(game.interact('tangseng', 'show-ledger').ok, true);
  assert.equal(game.state.facts.ledgerShown, true);
  assert.equal(game.state.items.ledger.owner, 'carpenter', '出示不等于转让所有权');
});

test('证据：两条独立来源可先调查，但翠兰安全前不能会面', () => {
  const game = createGame();
  gatherEvidence(game);
  assert.equal(game.state.evidence.length, 2);
  assert.notEqual(game.state.evidence[0].source, game.state.evidence[1].source);
  walk(game, 'gaocai', actor(game, 'bajie'));
  assert.equal(game.interact('bajie', 'invite-meeting').ok, false);
  game.update(60);
  assert.equal(game.state.facts.meetingChanged, false);
  assert.equal(game.state.recap, null);
});

test('会面：私有线索不隔空改变 NPC，现场改约后须携账且各人实际到场', () => {
  const game = createGame();
  rescue(game);
  gatherEvidence(game);
  game.update(10);
  assert.equal(game.state.facts.meetingChanged, false, '需要实际当面说明');
  walk(game, 'gaocai', actor(game, 'bajie'));
  assert.equal(game.interact('bajie', 'invite-meeting').ok, true);
  assert.equal(game.state.facts.meetingChanged, true);
  assert.equal(actor(game, 'bajie').moving, true);
  assert.equal(game.state.facts.meetingComplete, false);
  const eventCount = game.state.logs.length;
  assert.equal(game.interact('bajie', 'invite-meeting').ok, false);
  assert.equal(game.state.logs.length, eventCount);
  walk(game, 'gaocai', MAP.points.meeting);
  assert.equal(game.interact('meeting', 'discuss').ok, false, '持账人先到不能替代 NPC 到场');
  until(game, () => game.state.facts.meetingReady, '会面人物必须实际走到新地点');
  walk(game, 'carpenter', MAP.points.meeting);
  assert.equal(game.interact('meeting', 'discuss').ok, false, '无账本的人不能代持有人出示');
  game.select('gaocai');
  assert.equal(game.interact('meeting', 'discuss').ok, true);
  assert.equal(game.state.stage, 'recap');
  assert.equal(game.state.facts.meetingComplete, true);
  assert.match(game.state.recap.scope, /本地/);
  assert.match(game.state.recap.scope, /全章/);
  const finalCount = game.state.logs.length;
  assert.equal(game.interact('meeting', 'discuss').ok, false);
  assert.equal(game.state.logs.length, finalCount);
});

test('停步：只取消指定玩家路径，不更换控制角色也不修改NPC计划', () => {
  const game = createGame();
  game.moveTo(450, 795);
  game.select('carpenter');
  game.moveTo(1000, 800);
  game.update(0.2);
  const stopped = { ...actor(game, 'gaocai') };
  assert.equal(game.stop('gaocai').ok, true);
  assert.equal(game.state.activeId, 'carpenter');
  assert.equal(game.stop('wukong').ok, false);
  game.update(1);
  assert.equal(distance(actor(game, 'gaocai'), stopped), 0);
  assert.equal(actor(game, 'carpenter').moving, true);
  const second = { ...actor(game, 'carpenter') };
  assert.equal(game.stop().ok, true);
  game.update(1);
  assert.equal(distance(actor(game, 'carpenter'), second), 0);
  assert.equal(game.state.facts.doorOpen, false);
});

test('安置：距离标记73像素还不算到达，等候动作引导领队走到实际安置点', () => {
  const game = createGame();
  openDoor(game);
  walk(game, 'gaocai', actor(game, 'cuilan'));
  assert.equal(game.interact('cuilan', 'invite').ok, true);
  walk(game, 'gaocai', { x: MAP.points.safe.x + 73, y: MAP.points.safe.y });
  game.update(10);
  assert.equal(game.state.facts.cuilanSafe, false, '仅靠近安置点不自动完成');
  assert.equal(game.interact('safe', 'wait').ok, true);
  until(game, () => game.state.facts.cuilanSafe, '等候动作必须走完最后一段');
  assert.ok(distance(actor(game, 'cuilan'), MAP.points.safe) < 1);
  assert.ok(game.state.logs.some(entry => entry.text.includes('我已到前院')));
});

test('证据：出示只送达账本，之后听到的证言不自动传播给NPC', () => {
  const game = createGame();
  walk(game, 'gaocai', MAP.points.ledger);
  game.interact('ledger', 'take-ledger');
  walk(game, 'gaocai', actor(game, 'tangseng'));
  game.interact('tangseng', 'show-ledger');
  walk(game, 'carpenter', MAP.points.cook);
  game.interact('cook', 'hear-story');
  assert.deepEqual(game.state.evidence.find(entry => entry.id === 'ledger-record').deliveredTo, ['tangseng']);
  assert.deepEqual(game.state.evidence.find(entry => entry.id === 'cook-account').deliveredTo, []);
  assert.equal(game.state.evidence.filter(entry => entry.id === 'cook-account').length, 1);
  assert.equal(game.interact('cook', 'hear-story').ok, false);
  assert.equal(game.state.evidence.length, 2);
});

test('恢复：改约途中重开会清除两位NPC旧路径、证据送达与结算计划', () => {
  const game = createGame();
  rescue(game);
  gatherEvidence(game);
  until(game, () => game.state.facts.bajieArrived, '猪刚鬣进院');
  walk(game, 'gaocai', actor(game, 'bajie'));
  assert.equal(game.interact('bajie', 'invite-meeting').ok, true);
  assert.equal(actor(game, 'bajie').moving, true);
  assert.equal(actor(game, 'tangseng').moving, true);
  game.update(0.2);
  game.reset();
  game.update(60);
  assert.equal(game.state.facts.meetingChanged, false);
  assert.equal(game.state.facts.meetingReady, false);
  assert.equal(game.state.facts.meetingComplete, false);
  assert.equal(game.state.recap, null);
  assert.equal(game.state.evidence.length, 0);
  assert.equal(actor(game, 'bajie').visible, false);
  assert.equal(actor(game, 'bajie').moving, false);
  assert.equal(actor(game, 'tangseng').moving, false);
});
