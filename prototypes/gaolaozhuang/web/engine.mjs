// 高老庄本地样片：只处理两角色切换与受控人物，不接入生产协议。
export const MAP = {
  width: 1600,
  height: 1000,
  bounds: { left: 100, top: 380, right: 1500, bottom: 925 },
  actorRadius: 10,
  interactionRadius: 76,
  obstacles: [
    { id: 'table', x: 795, y: 455, w: 182, h: 100 },
    { id: 'planter', x: 475, y: 450, w: 145, h: 65 },
    { id: 'kitchen', x: 110, y: 340, w: 330, h: 110 },
  ],
  points: {
    wood: { x: 285, y: 500 },
    leftSupport: { x: 1190, y: 405 },
    rightSupport: { x: 1310, y: 405 },
    door: { x: 1250, y: 390 },
    safe: { x: 450, y: 795 },
    ledger: { x: 360, y: 550 },
    cook: { x: 280, y: 620 },
    tangseng: { x: 850, y: 690 },
    wukong: { x: 920, y: 620 },
    wukongAside: { x: 1370, y: 475 },
    meeting: { x: 1320, y: 820 },
    courtyardMeeting: { x: 820, y: 790 },
  },
};

const PLAYER_IDS = ['gaocai', 'carpenter'];
const EPSILON = 0.001;
const PLAYER_SPEED = 205;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function insideBounds(point) {
  const { left, top, right, bottom } = MAP.bounds;
  const r = MAP.actorRadius;
  return point.x >= left + r && point.x <= right - r && point.y >= top + r && point.y <= bottom - r;
}

function expanded(obstacle) {
  const r = MAP.actorRadius;
  return { left: obstacle.x - r, top: obstacle.y - r, right: obstacle.x + obstacle.w + r, bottom: obstacle.y + obstacle.h + r };
}

function walkable(point) {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !insideBounds(point)) return false;
  return MAP.obstacles.every((obstacle) => {
    const box = expanded(obstacle);
    return point.x < box.left || point.x > box.right || point.y < box.top || point.y > box.bottom;
  });
}

// 使用整段线段与扩张矩形相交判断，时间步再大也不能跨过障碍。
function segmentClear(from, to) {
  if (!walkable(from) || !walkable(to)) return false;
  for (const obstacle of MAP.obstacles) {
    const box = expanded(obstacle);
    let enter = 0;
    let leave = 1;
    let intersects = true;
    for (const [axis, minimum, maximum] of [['x', box.left, box.right], ['y', box.top, box.bottom]]) {
      const delta = to[axis] - from[axis];
      if (Math.abs(delta) < EPSILON) {
        if (from[axis] < minimum || from[axis] > maximum) intersects = false;
      } else {
        const first = (minimum - from[axis]) / delta;
        const second = (maximum - from[axis]) / delta;
        enter = Math.max(enter, Math.min(first, second));
        leave = Math.min(leave, Math.max(first, second));
        if (enter > leave) intersects = false;
      }
      if (!intersects) break;
    }
    if (intersects) return false;
  }
  return true;
}

const GRID_STEP = 20;
const grid = new Map();
for (let x = 120; x <= 1480; x += GRID_STEP) {
  for (let y = 360; y <= 900; y += GRID_STEP) {
    if (walkable({ x, y })) grid.set(`${x},${y}`, { x, y, key: `${x},${y}` });
  }
}

function nearestNode(point) {
  let best = null;
  let bestDistance = Infinity;
  for (const node of grid.values()) {
    const separation = distance(point, node);
    if (separation < bestDistance && segmentClear(point, node)) {
      best = node;
      bestDistance = separation;
    }
  }
  return best;
}

function route(from, destination) {
  if (!walkable(destination)) return null;
  if (distance(from, destination) < EPSILON) return [];
  if (segmentClear(from, destination)) return [{ ...destination }];
  const start = nearestNode(from);
  const goal = nearestNode(destination);
  if (!start || !goal) return null;
  const open = new Set([start.key]);
  const previous = new Map();
  const cost = new Map([[start.key, 0]]);
  const estimate = new Map([[start.key, distance(start, goal)]]);
  while (open.size) {
    let currentKey;
    let minimum = Infinity;
    for (const key of open) {
      if (estimate.get(key) < minimum) {
        minimum = estimate.get(key);
        currentKey = key;
      }
    }
    const current = grid.get(currentKey);
    if (currentKey === goal.key) {
      const nodes = [{ x: goal.x, y: goal.y }];
      let key = currentKey;
      while (previous.has(key)) {
        key = previous.get(key);
        const node = grid.get(key);
        nodes.unshift({ x: node.x, y: node.y });
      }
      nodes.push({ ...destination });
      const smooth = [];
      let anchor = from;
      for (let index = 0; index < nodes.length;) {
        let next = nodes.length - 1;
        while (next > index && !segmentClear(anchor, nodes[next])) next -= 1;
        if (distance(anchor, nodes[next]) > EPSILON) smooth.push(nodes[next]);
        anchor = nodes[next];
        index = next + 1;
      }
      return smooth;
    }
    open.delete(currentKey);
    for (const dx of [-GRID_STEP, 0, GRID_STEP]) {
      for (const dy of [-GRID_STEP, 0, GRID_STEP]) {
        if (!dx && !dy) continue;
        const neighbor = grid.get(`${current.x + dx},${current.y + dy}`);
        if (!neighbor || !segmentClear(current, neighbor)) continue;
        const nextCost = cost.get(currentKey) + Math.hypot(dx, dy);
        if (nextCost >= (cost.get(neighbor.key) ?? Infinity)) continue;
        previous.set(neighbor.key, currentKey);
        cost.set(neighbor.key, nextCost);
        estimate.set(neighbor.key, nextCost + distance(neighbor, goal));
        open.add(neighbor.key);
      }
    }
  }
  return null;
}

function navigate(actor, x, y) {
  const destination = { x, y };
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, message: '目的地坐标无效', reason: 'invalid', rerouted: false };
  if (!insideBounds(destination)) return { ok: false, message: '请在院内可行走的道路上落脚', reason: 'out-of-bounds', rerouted: false };
  if (!walkable(destination)) return { ok: false, message: '那里是建筑或障碍，请选择旁边的道路', reason: 'blocked', rerouted: false };
  const path = route(actor, destination);
  if (!path) return { ok: false, message: '目前没有通往此处的道路', reason: 'unreachable', rerouted: false };
  actor.path = path;
  actor.moving = path.length > 0;
  return { ok: true, message: actor.moving ? '正在沿道路前往' : '已停下', reason: actor.moving ? 'moved' : 'stopped', rerouted: path.length > 1 };
}

function advanceActor(actor, dt) {
  let remaining = (actor.speed ?? PLAYER_SPEED) * dt;
  while (actor.path.length && remaining > 0) {
    const next = actor.path[0];
    const separation = distance(actor, next);
    if (separation <= remaining + EPSILON) {
      actor.x = next.x;
      actor.y = next.y;
      remaining -= separation;
      actor.path.shift();
    } else {
      actor.x += ((next.x - actor.x) / separation) * remaining;
      actor.y += ((next.y - actor.y) / separation) * remaining;
      remaining = 0;
    }
  }
  actor.moving = actor.path.length > 0;
}

function initialState() {
  const npc = (id, name, point, color, extra = {}) => ({ id, name, ...point, path: [], moving: false, color, kind: 'npc', visible: true, speed: 175, ...extra });
  return {
    activeId: 'gaocai',
    stage: 'prepare',
    actors: {
      gaocai: { id: 'gaocai', name: '高才', x: 690, y: 790, path: [], moving: false, color: '#3b8290', kind: 'player' },
      carpenter: { id: 'carpenter', name: '木匠学徒', x: 750, y: 830, path: [], moving: false, color: '#a95d4a', kind: 'player' },
      wukong: npc('wukong', '孙悟空', MAP.points.wukong, '#a98849'),
      cuilan: npc('cuilan', '高翠兰', MAP.points.door, '#ad7890', { visible: false, speed: 170 }),
      tangseng: npc('tangseng', '唐僧', MAP.points.tangseng, '#bf7652'),
      bajie: npc('bajie', '猪刚鬣', { x: 1440, y: 870 }, '#7f7183', { visible: false, speed: 165 }),
      cook: npc('cook', '厨娘', MAP.points.cook, '#7a9264'),
    },
    facts: {
      leftInstalled: false, rightInstalled: false, openingRequested: false, doorOpen: false,
      cuilanConsented: false, cuilanSafe: false, ledgerRead: false, cookHeard: false,
      ledgerShown: false, bajieArrived: false, meetingChanged: false, meetingComplete: false,
      meetingReady: false,
    },
    items: {
      'wood-gaocai': { id: 'wood-gaocai', name: '门撑木料（高才）', kind: 'material', owner: 'wood', reservedFor: 'gaocai' },
      'wood-carpenter': { id: 'wood-carpenter', name: '门撑木料（木匠）', kind: 'material', owner: 'wood', reservedFor: 'carpenter' },
      ledger: { id: 'ledger', name: '旧饭账', kind: 'evidence', owner: 'ledger' },
    },
    supports: { left: null, right: null },
    follow: { leaderId: null, paused: false },
    evidence: [],
    logs: [], dialogue: null, recap: null,
  };
}

export function createGame() {
  const state = initialState();
  function record(text, speaker) {
    state.logs.push({ id: state.logs.length + 1, text });
    if (speaker) state.dialogue = { speaker, text };
  }

  function action(id, label, enabled, reason) {
    return { id, label, enabled: Boolean(enabled), ...(enabled ? {} : { reason }) };
  }

  function getActions(targetId) {
    if (state.recap) return [];
    const activeId = state.activeId;
    const wood = state.items[`wood-${activeId}`];
    if (targetId === 'wood') return [action('take-material', '领取自己的门撑木料', wood.owner === 'wood', '这份木料已经领取或安装，另一份留给同伴')];
    if (targetId === 'left-support' || targetId === 'right-support') {
      const side = targetId === 'left-support' ? 'left' : 'right';
      const other = side === 'left' ? 'right' : 'left';
      const allowed = !state.supports[side] && state.supports[other] !== activeId && wood.owner === activeId;
      return [action('install', `调整并锁定${side === 'left' ? '左' : '右'}侧门撑`, allowed,
        state.supports[side] ? '这侧门撑已经锁定' : state.supports[other] === activeId ? '另一侧需要同伴检查并安装' : '请先领取自己的木料')];
    }
    if (targetId === 'door') return [action('inspect', '查看铜封与门撑', !state.facts.doorOpen, '门已开放')];
    if (targetId === 'wukong') return [action('request-open', '请悟空前去处理铜封', state.supports.left && state.supports.right && !state.facts.openingRequested,
      state.facts.openingRequested ? '悟空已经收到请求，请留意他的实际行动' : '两人需要先各自锁定一侧门撑')];
    if (targetId === 'cuilan') {
      if (!state.facts.cuilanConsented) return [action('invite', '询问翠兰：是否随我到前院安置？', state.facts.doorOpen, '先打开后宅通路')];
      if (state.facts.cuilanSafe) return [];
      if (state.follow.leaderId !== activeId) return [action('take-lead', '商量改由我带路', true)];
      if (state.follow.paused) return [action('resume', '继续带路', true)];
      return [action('pause', '请翠兰先在这里稍候', true)];
    }
    if (targetId === 'safe') return [action('wait', '带翠兰走到安置处并等候', state.facts.cuilanConsented && !state.facts.cuilanSafe && !state.follow.paused && state.follow.leaderId === activeId,
      state.facts.cuilanSafe ? '翠兰已经亲自确认安置' : !state.facts.cuilanConsented ? '先与翠兰商量安置安排' : state.follow.paused ? '先走近翠兰，商量继续带路' : '请切换到翠兰同意的带路者，或当面商量换人')];
    if (targetId === 'ledger') return [action('take-ledger', '查看并带上旧饭账', state.items.ledger.owner === 'ledger',
      state.items.ledger.owner === activeId ? '你已带上旧饭账' : '账本已由同伴带走；走近持有人可以交接')];
    if (targetId === 'cook') return [action('hear-story', '听厨娘讲述候客旧事', !state.facts.cookHeard, '这段证言已记入本地共享手记')];
    if (PLAYER_IDS.includes(targetId) && targetId !== activeId) return [action('give-ledger', `将旧饭账交给${state.actors[targetId].name}`, state.items.ledger.owner === activeId, '只有账本的当前持有人可以转交')];
    if (targetId === 'tangseng') return [action('show-ledger', '向唐长老出示旧饭账', state.items.ledger.owner === activeId && !state.facts.ledgerShown,
      state.facts.ledgerShown ? '唐长老已经亲眼看过账本；再去听证言并安排会面' : '需要亲自带着旧饭账走近唐长老')];
    if (targetId === 'bajie') return [action('invite-meeting', '出示候客线索，邀请公开会面', state.facts.cuilanSafe && state.facts.bajieArrived && state.facts.ledgerShown && state.facts.cookHeard && state.items.ledger.owner === activeId && !state.facts.meetingChanged,
      !state.facts.cuilanSafe ? '先把翠兰安置好' : !state.facts.bajieArrived ? '他还在进院路上，稍候再当面交谈' : state.facts.meetingChanged ? '已改约庄口，请带着账本赴约' : !state.facts.ledgerShown ? '先把旧饭账带给唐长老' : !state.facts.cookHeard ? '还需要听厨娘的独立证言' : '请由账本持有人当面邀请')];
    if (targetId === 'meeting') return [action('discuss', '摆出账本，开始公开查证', state.facts.meetingReady && state.items.ledger.owner === activeId,
      !state.facts.meetingChanged ? '先走近猪刚鬣商量会面' : !state.facts.meetingReady ? '等唐长老与猪刚鬣本人走到新会面处' : '需要由旧饭账的当前持有人当面出示')];
    return [];
  }

  function getTargets() {
    const fixed = [
      { id: 'wood', name: '门撑木料', ...MAP.points.wood, kind: 'item', completed: Object.values(state.items).filter((item) => item.kind === 'material').every((item) => item.owner !== 'wood') },
      { id: 'left-support', name: '左侧承力点', ...MAP.points.leftSupport, kind: 'fixture', completed: Boolean(state.supports.left) },
      { id: 'right-support', name: '右侧承力点', ...MAP.points.rightSupport, kind: 'fixture', completed: Boolean(state.supports.right) },
      { id: 'door', name: '后宅铜封门', ...MAP.points.door, kind: 'fixture', completed: state.facts.doorOpen },
      { id: 'safe', name: '前院安置点', ...MAP.points.safe, kind: 'location', completed: state.facts.cuilanSafe },
      { id: 'ledger', name: '旧饭账', ...MAP.points.ledger, kind: 'item', completed: state.items.ledger.owner !== 'ledger' },
      { id: 'meeting', name: '庄口会面处', ...MAP.points.meeting, kind: 'location', completed: state.facts.meetingComplete },
    ];
    const characters = Object.values(state.actors).map((actor) => ({ id: actor.id, name: actor.name, x: actor.x, y: actor.y, kind: actor.kind, completed: false, visible: actor.visible !== false }));
    return [...fixed, ...characters].map((target) => ({ ...target, enabled: target.visible !== false && getActions(target.id).some((entry) => entry.enabled) }));
  }

  function getObjective() {
    if (!state.supports.left || !state.supports.right) {
      const available = PLAYER_IDS.find((id) => !Object.values(state.supports).includes(id) && id === state.activeId)
        ?? PLAYER_IDS.find((id) => !Object.values(state.supports).includes(id));
      const material = state.items[`wood-${available}`];
      if (material.owner === 'wood') return { title: '各自领一份门撑木料', detail: `${state.actors[available].name}去杂物棚领取木料；另一份留给同伴。`, targetId: 'wood', actionId: 'take-material', roleId: available };
      const side = state.supports.left ? 'right' : 'left';
      return { title: `锁定${side === 'left' ? '左' : '右'}侧门撑`, detail: '把木料送到后宅承力点，调整后锁定；另一侧由同伴完成。', targetId: `${side}-support`, actionId: 'install', roleId: available };
    }
    if (!state.facts.openingRequested) return { title: '请悟空来开门', detail: '两处门撑已固定。走近悟空，说明安全准备已完成。', targetId: 'wukong', actionId: 'request-open' };
    if (!state.facts.doorOpen) return { title: '悟空正往后宅走去', detail: '请求已送达，等悟空实际走到门前处理铜封；可以沿路跟过去。', targetId: 'door' };
    if (!state.facts.cuilanConsented) return { title: '问问翠兰想怎样离开', detail: '门已打开。走近翠兰，询问她是否愿意跟你去前院安置。', targetId: 'cuilan', actionId: 'invite' };
    if (!state.facts.cuilanSafe) {
      if (state.follow.paused) return { title: '继续之前的带路安排', detail: '翠兰正原地等候。走近她，继续带路，或者商量换人带路。', targetId: 'cuilan', actionId: 'resume', roleId: state.follow.leaderId };
      return { title: '陪翠兰走到前院', detail: '带路者走向安置点，等翠兰本人抵达；切换角色不会替代她到场。', targetId: 'safe', roleId: state.follow.leaderId };
    }
    if (!state.facts.ledgerRead) return { title: '查看旧饭账', detail: '翠兰已安全安置。去灶房找出候客旧账，再听厨娘独立说明。', targetId: 'ledger', actionId: 'take-ledger' };
    if (!state.facts.cookHeard) return { title: '听一段独立的证言', detail: '账上有候客记录，仍需听厨娘亲历的旧事；记录会放入本地共享手记。', targetId: 'cook', actionId: 'hear-story' };
    if (!state.facts.ledgerShown) return { title: '把账本带给唐长老', detail: '发现线索不等于人物已经知道。请持账人走近唐长老，让他亲眼查阅。', targetId: 'tangseng', actionId: 'show-ledger', roleId: state.items.ledger.owner };
    if (!state.facts.bajieArrived && !state.facts.meetingChanged) return { title: '猪刚鬣正走进院中', detail: '他正在前往前院；等他到场，再由持账人当面说明来意。', targetId: 'bajie', roleId: state.items.ledger.owner };
    if (!state.facts.meetingChanged) return { title: '当面邀请猪刚鬣', detail: '带着旧饭账，转述厨娘的证言，看看他愿意在哪里公开谈一谈。', targetId: 'bajie', actionId: 'invite-meeting', roleId: state.items.ledger.owner };
    if (!state.facts.meetingComplete) return { title: '地点变了，带证据赴约', detail: state.facts.meetingReady ? '唐长老与猪刚鬣已经到庄口。由持账人走近会面处，开始公开查证。' : '猪刚鬣改约到庄口。带着账本走过去，等两位当事人真正到场。', targetId: 'meeting', actionId: 'discuss', roleId: state.items.ledger.owner };
    return { title: '这段故事暂告一段', detail: '救援、实际护送与公开查证已完成。回顾记录本地样片中的事实，完整收徒与离庄尚待制作。' };
  }

  function interact(targetId, option) {
    const target = getTargets().find((entry) => entry.id === targetId);
    if (!target || target.visible === false) return { ok: false, message: '当前没有这个可见交互对象' };
    const player = state.actors[state.activeId];
    if (distance(player, target) > MAP.interactionRadius) return { ok: false, message: '请先走近，再进行交互', reason: 'too-far' };
    const choices = getActions(targetId);
    const choice = option ? choices.find((entry) => entry.id === option) : choices.find((entry) => entry.enabled);
    if (!choice || !choice.enabled) return { ok: false, message: choice?.reason ?? '当前没有可执行的操作' };
    if (choice.id === 'take-material') {
      state.items[`wood-${state.activeId}`].owner = state.activeId;
      const message = `${player.name}拿起一份木料，另一份仍由同伴保管。`;
      record(message);
      return { ok: true, message };
    }
    if (choice.id === 'install') {
      const side = targetId === 'left-support' ? 'left' : 'right';
      state.supports[side] = state.activeId;
      state.facts[`${side}Installed`] = true;
      state.items[`wood-${state.activeId}`].owner = targetId;
      const message = `${player.name}已锁定${side === 'left' ? '左' : '右'}侧门撑，可以离开此处。`;
      record(message);
      return { ok: true, message };
    }
    if (choice.id === 'inspect') {
      const message = '铜封不能用普通钥匙打开。需要两人各固定一侧门撑，再请悟空处理铜封。';
      record(message);
      return { ok: true, message };
    }
    if (choice.id === 'request-open') {
      const navigation = navigate(state.actors.wukong, MAP.points.door.x, MAP.points.door.y);
      if (!navigation.ok) return navigation;
      state.facts.openingRequested = true;
      state.stage = 'opening';
      const message = '门撑稳了，我这就走到后宅查看铜封。';
      record(message, '孙悟空');
      return { ok: true, message: '悟空接受请求，正在前往后宅；门还没有打开。' };
    }
    if (choice.id === 'invite') {
      state.facts.cuilanConsented = true;
      state.follow = { leaderId: state.activeId, paused: false };
      record(`我愿意去前院安置，请${player.name}带路。若要换人，先与我说一声。`, '高翠兰');
      return { ok: true, message: '翠兰同意跟随。请带她实际走到前院安置点。' };
    }
    if (choice.id === 'pause') {
      state.follow.paused = true;
      state.actors.cuilan.path = [];
      state.actors.cuilan.moving = false;
      record('我先在这里等你，准备好了再告诉我。', '高翠兰');
      return { ok: true, message: '翠兰已停下；之后可继续或换人带路。' };
    }
    if (choice.id === 'resume' || choice.id === 'take-lead') {
      state.follow = { leaderId: state.activeId, paused: false };
      state.actors.cuilan.path = [];
      state.actors.cuilan.moving = false;
      record(`好，接下来由${player.name}带我去前院。`, '高翠兰');
      return { ok: true, message: '新的带路安排已获翠兰同意。' };
    }
    if (choice.id === 'wait') {
      const navigation = navigate(player, MAP.points.safe.x, MAP.points.safe.y);
      if (!navigation.ok) return navigation;
      return { ok: true, message: '继续走到安置处中央，等翠兰本人抵达并确认；靠近标记还不算完成。' };
    }
    if (choice.id === 'take-ledger') {
      state.items.ledger.owner = state.activeId;
      state.facts.ledgerRead = true;
      state.evidence.push({ id: 'ledger-record', source: '灶房旧饭账', kind: 'record', observedBy: state.activeId, deliveredTo: [], text: '多日前便有为“东土来、往西去的僧人”留饭的记录。它支持提前候客，不证明全部自述。' });
      const message = `${player.name}带上旧饭账：候客记录早于师徒来庄。账本现在只有这一位持有人。`;
      record(message);
      return { ok: true, message };
    }
    if (choice.id === 'hear-story') {
      state.facts.cookHeard = true;
      state.evidence.push({ id: 'cook-account', source: '厨娘亲历陈述', kind: 'statement', observedBy: state.activeId, deliveredTo: [], text: '厨娘说：师徒到来之前，猪刚鬣便几次询问东土僧人的消息。陈述与账本是两个来源。' });
      record('前些日子，他就问有没有东土来的僧人，还叮嘱留一份饭。你们今日才到，这事却早有了。', '厨娘');
      return { ok: true, message: '厨娘的独立证言已记入本地共享手记；唐长老与猪刚鬣还需当面听到。' };
    }
    if (choice.id === 'give-ledger') {
      state.items.ledger.owner = targetId;
      const message = `${player.name}把唯一的旧饭账交给${state.actors[targetId].name}。后续出示须由新持有人进行。`;
      record(message);
      return { ok: true, message };
    }
    if (choice.id === 'show-ledger') {
      state.facts.ledgerShown = true;
      state.evidence.find(entry => entry.id === 'ledger-record').deliveredTo.push('tangseng');
      record('账上确有早于我们到来的候客记录。再听亲历者的说法，我们就在院中公开谈谈。', '唐僧');
      return { ok: true, message: '唐长老已亲眼查阅账本。出示没有转让账本，也没有直接促成收徒。' };
    }
    if (choice.id === 'invite-meeting') {
      // 这段受控场景发生在前院：唐僧位于公开说话的听闻范围，才会响应改约。
      if (distance(state.actors.tangseng, state.actors.bajie) > 180) return { ok: false, message: '唐长老还听不见这次安排，需要在附近公开商量。' };
      const destinations = { bajie: { x: MAP.points.meeting.x + 30, y: MAP.points.meeting.y + 4 }, tangseng: { x: MAP.points.meeting.x - 35, y: MAP.points.meeting.y - 8 } };
      const plans = Object.entries(destinations).map(([id, destination]) => ({ id, destination, path: route(state.actors[id], destination) }));
      if (plans.some(plan => plan.path === null)) return { ok: false, message: '新会面处暂不可达，安排还没有改变。' };
      state.facts.meetingChanged = true;
      state.stage = 'meeting';
      for (const plan of plans) { state.actors[plan.id].path = plan.path; state.actors[plan.id].moving = plan.path.length > 0; }
      for (const entry of state.evidence) if (!entry.deliveredTo.includes('bajie')) entry.deliveredTo.push('bajie');
      record('原来你们查了这些旧事。这里离后宅太近，咱们去庄口说吧，不惊动翠兰。', '猪刚鬣');
      record('唐长老在附近听见改约，同意走到庄口；两位当事人现在都还在路上。');
      return { ok: true, message: '他改约到庄口了。请带着账本重新赴约，等双方本人到场。' };
    }
    if (choice.id === 'discuss') {
      // 会面可用性每次按真实位置重新检查，不能仅依赖过去的“已到场”标记。
      const present = ['tangseng', 'bajie'].every(id => !state.actors[id].moving && distance(state.actors[id], MAP.points.meeting) <= MAP.interactionRadius);
      if (!present) return { ok: false, message: '当事人尚未全部在场，请继续等候。' };
      for (const entry of state.evidence) for (const recipient of ['tangseng', 'bajie']) if (!entry.deliveredTo.includes(recipient)) entry.deliveredTo.push(recipient);
      state.facts.meetingComplete = true;
      state.stage = 'recap';
      record('旧饭账已经摆在当事人面前，厨娘的证言也已当面转述。材料支持“提前候客”，收徒与否仍需当事人之后自愿决定。');
      state.recap = {
        title: '风来有信，故事未完',
        scope: '本地双角色、受控 NPC 的短流程样片；不是完整首章、真实联机或全章收徒验收。',
        completed: ['两位角色分别锁定门撑，悟空实际到门前开门', '翠兰同意随行，本人走到前院并确认可以自由出入', '旧饭账与独立证言已收集并当面送达', '会面地点改变后，持账人与两位当事人实际赴约'],
        notImplemented: ['真实多人和真实 LLM', '乔装与完整信息权限', '自主收徒或安全分别', '公共物归还、实际离庄与完整首章结局'],
        facts: { ...state.facts },
      };
      return { ok: true, message: '这段样片完成了：人已安全，线索已送达，改约也真正走到了。' };
    }
    return { ok: false, message: '当前没有可执行的操作' };
  }

  function planFollower() {
    if (!state.facts.cuilanConsented || state.facts.cuilanSafe || state.follow.paused || !state.follow.leaderId) return;
    const cuilan = state.actors.cuilan;
    const leader = state.actors[state.follow.leaderId];
    const nearSafety = distance(leader, MAP.points.safe) <= 40;
    const destination = nearSafety ? MAP.points.safe : leader;
    if (!nearSafety && distance(cuilan, leader) <= 30) {
      cuilan.path = [];
      cuilan.moving = false;
      return;
    }
    const oldDestination = cuilan.path.at(-1);
    if (!oldDestination || distance(oldDestination, destination) > 16) navigate(cuilan, destination.x, destination.y);
  }

  function settleArrivals() {
    if (state.facts.openingRequested && !state.facts.doorOpen && !state.actors.wukong.moving && distance(state.actors.wukong, MAP.points.door) < 1) {
      state.facts.doorOpen = true;
      state.actors.cuilan.visible = true;
      state.stage = 'escort';
      // 先实际开门，再沿路径让到一旁，避免一直挡住翠兰的身体与点击区域。
      navigate(state.actors.wukong, MAP.points.wukongAside.x, MAP.points.wukongAside.y);
      record('铜封已解除，门撑也稳固。我先让到一旁，去问问她的安置打算吧。', '孙悟空');
    }
    if (state.facts.cuilanConsented && !state.facts.cuilanSafe && distance(state.actors.cuilan, MAP.points.safe) < 1 && !state.actors.cuilan.moving) {
      state.facts.cuilanSafe = true;
      state.follow = { leaderId: null, paused: false };
      state.stage = 'evidence';
      record('我已到前院，这里可以自由出入。你们去办后面的事吧。', '高翠兰');
      state.actors.bajie.visible = true;
      navigate(state.actors.bajie, MAP.points.courtyardMeeting.x, MAP.points.courtyardMeeting.y);
      record('庄口传来脚步声：猪刚鬣回来了，正走向前院。');
    }
    if (state.facts.cuilanSafe && !state.facts.bajieArrived && !state.facts.meetingChanged && !state.actors.bajie.moving && distance(state.actors.bajie, MAP.points.courtyardMeeting) < 1) {
      state.facts.bajieArrived = true;
      record('猪刚鬣已走到前院，可以当面说明来意。');
    }
    if (state.facts.meetingChanged && !state.facts.meetingReady && ['tangseng', 'bajie'].every(id => !state.actors[id].moving && distance(state.actors[id], MAP.points.meeting) <= MAP.interactionRadius)) {
      state.facts.meetingReady = true;
      record('唐长老与猪刚鬣已实际抵达庄口。等持账人当面出示，才能开始公开查证。');
    }
  }

  return {
    state,
    select(id) {
      if (!PLAYER_IDS.includes(id)) return { ok: false, message: '只能切换高才与木匠学徒' };
      state.activeId = id;
      return { ok: true, message: `已切换为${state.actors[id].name}` };
    },
    moveTo(x, y) { return navigate(state.actors[state.activeId], x, y); },
    stop(id = state.activeId) {
      if (!PLAYER_IDS.includes(id)) return { ok: false, message: '只能停止两位玩家角色的行走' };
      state.actors[id].path = [];
      state.actors[id].moving = false;
      return { ok: true, message: `${state.actors[id].name}已停下` };
    },
    interact,
    update(dtSeconds) {
      if (!Number.isFinite(dtSeconds) || dtSeconds < 0) return { ok: false, message: '时间步无效' };
      const elapsed = Math.min(dtSeconds, 60);
      let remaining = elapsed;
      while (remaining > EPSILON) {
        const step = Math.min(remaining, 0.05);
        planFollower();
        for (const actor of Object.values(state.actors)) advanceActor(actor, step);
        settleArrivals();
        remaining -= step;
      }
      return { ok: true, message: '', elapsed };
    },
    reset() { Object.assign(state, initialState()); return { ok: true, message: '样片已重新开始' }; },
    getTargets,
    getObjective,
    getActions,
    getNearestTarget() {
      const player = state.actors[state.activeId];
      return getTargets().filter((target) => target.enabled && distance(player, target) <= MAP.interactionRadius)
        .sort((first, second) => distance(player, first) - distance(player, second))[0] ?? null;
    },
  };
}
