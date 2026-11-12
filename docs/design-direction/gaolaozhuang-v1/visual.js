// #28 固定样例：只切换设计展示，不连接服务端、不裁定世界事实。
const params = new URLSearchParams(location.search);
const state = params.get('state') || 'main';
document.body.dataset.state = state;
const world = document.querySelector('#world');
const actors = document.querySelector('#actors');
const atlas = {
  tang: { x: 40, width: 310, top: 10, footY: 866, footX: 156 },
  wukong: { x: 365, width: 290, top: 74, footY: 869, footX: 161 },
  bajie: { x: 680, width: 390, top: 47, footY: 866, footX: 208 },
  cuilan: { x: 1087, width: 292, top: 57, footY: 869, footX: 140 },
  carpenter: { x: 1406, width: 340, top: 28, footY: 867, footX: 187 },
};

function showActor(kind, name, x, y, active = false) {
  const element = document.createElement('div');
  element.className = 'actor';
  element.style.cssText = `left:${x}px;top:${y}px;z-index:${Math.round(y)}`;
  const shadow = document.createElement('span');
  shadow.className = 'actor-shadow';
  element.append(shadow);
  if (active) {
    const ring = document.createElement('span');
    ring.className = 'selection-ring';
    element.append(ring);
  }
  const art = document.createElement('div');
  art.className = 'actor-art';
  const image = document.createElement('img');
  image.alt = name;
  if (kind === 'gaocai') {
    // 原归档 manifest 的 SE 站姿：footPivot(184,527)、scale=0.14559386973180077。
    const scale = 0.14559386973180077;
    art.style.cssText = `left:${-184 * scale}px;top:${-527 * scale}px;width:${362 * scale}px;height:${543 * scale}px`;
    image.src = 'assets/gaocai-idle-se.png';
    image.style.cssText = `width:${362 * scale}px;height:${543 * scale}px;left:0;top:0`;
    element.dataset.bodyHeight = '76';
  } else {
    const crop = atlas[kind];
    const scale = 76 / (crop.footY - crop.top);
    art.style.cssText = `left:${-crop.footX * scale}px;top:${-crop.footY * scale}px;width:${crop.width * scale}px;height:${887 * scale}px`;
    image.src = 'assets/characters-concept.png';
    image.style.cssText = `width:${1774 * scale}px;height:${887 * scale}px;left:${-crop.x * scale}px;top:0`;
    element.dataset.bodyHeight = '76';
  }
  art.append(image);
  element.append(art);
  const label = document.createElement('span');
  label.className = `actor-label${active ? ' active' : ''}`;
  label.textContent = name;
  element.append(label);
  actors.append(element);
}

function fitWorld() {
  const scale = Math.max(innerWidth / 1600, innerHeight / 1000);
  // 此样页仅冻结相机中点；正式实现按授权本地角色跟随。
  world.style.transform = `translate(${(innerWidth - 1600 * scale) / 2}px,${(innerHeight - 1000 * scale) / 2}px) scale(${scale})`;
}
addEventListener('resize', fitWorld);
fitWorld();

const overlay = document.querySelector('#overlay');
const content = {
  dialogue: `<p class="eyebrow">后宅门前 · 当面交谈</p><h2>悟空</h2><p class="subtitle">“等门撑稳住，我再动手。你们先把她照应好。”</p><article class="entry"><span class="tag claim">◇ 他提出的安排</span><p>左侧门撑已经锁定，右侧仍需准备。铜封尚未解除。</p></article><button class="secondary-button">说明准备情况</button> <button class="secondary-button">请求检查铜封</button><p class="fine-print">交谈时，同伴仍可在场景中行动。</p>`,
  inventory: `<h2>行囊</h2><p class="subtitle">你正在保管的物件。交接需要走到对方面前。</p><article class="entry"><span class="tag">公共借用</span><h3>门撑木料</h3><p>用于右侧承力点。尚未安装；用完需要归还。</p><button class="secondary-button">交给同伴</button></article><article class="entry"><span class="tag claim">原件 · 可展示</span><h3>旧饭账</h3><p>记录来自灶房。展示内容与转交原件是两种操作。</p><button class="secondary-button">选择展示对象</button></article><p class="fine-print">私人包裹不会因为名字相同或角色离线而变为公共物。</p>`,
  notebook: `<h2>手记</h2><p class="subtitle">只记录你亲历或合法获知的内容。线索有来源，结论可回查。</p><article class="entry"><span class="tag">✓ 亲眼所见</span><h3>后宅门锁被铜封住</h3><p>来源：高才在后宅门前检查。普通钥匙无法打开。</p></article><article class="entry"><span class="tag claim">◇ 本人陈述</span><h3>翠兰希望离开后宅</h3><p>来源：侧窗前的当面交谈。她还没有同意任何一条具体路线。</p></article><article class="entry"><span class="tag pending">? 待核验</span><h3>曾有人在等候取经人</h3><p>来源：已获准查看的饭账。还需要独立来源与时间比较。</p></article><button class="secondary-button">选择一条向同伴说明</button>`,
  team: `<h2>队伍</h2><p class="subtitle">两位同伴在线。职责可以协作与交接。</p><article class="entry"><span class="tag">你 · 在线</span><h3>高才 · 迎客联络</h3><p>正在准备后宅门撑。</p></article><article class="entry"><span class="tag">同伴 · 在线</span><h3>木匠 · 木作帮手</h3><p>已锁定左侧门撑，正在门前等候。</p></article><p class="fine-print">队伍交流面向玩家，不会自动成为 NPC 已知的信息。</p>`,
  recap: `<h2>这一路发生的事</h2><p class="subtitle">当前局的可知经过；每一步保留发生时的视角。</p><article class="entry"><span class="tag">✓ 已完成</span><h3>左侧门撑已经锁定</h3><p>木匠完成安装。离开或短暂掉线不会让它自动松开。</p></article><article class="entry"><span class="tag claim">◇ 尚未执行</span><h3>悟空愿意看看门锁</h3><p>这是回应，不代表铜封已经解除。</p></article><article class="entry"><span class="tag pending">? 未完成</span><h3>翠兰尚未安置</h3><p>还需要开门、确认随行安排、本人实际到达并确认。</p></article>`,
};
const followContent = {
  inventory: `<h2>行囊</h2><p class="subtitle">门撑已经装好。当前保管的物件仍需当面交接。</p><article class="entry"><span class="tag claim">原件 · 可展示</span><h3>旧饭账</h3><p>记录来自灶房。展示内容与转交原件是两种操作。</p><button class="secondary-button">选择展示对象</button><button class="secondary-button">交给同伴</button></article><p class="fine-print">翠兰的私人包裹另需本人许可，不因为答应随行便自动取走。</p>`,
  notebook: `<h2>手记</h2><p class="subtitle">只记录你亲历或合法获知的内容。线索有来源，结论可回查。</p><article class="entry"><span class="tag">✓ 亲眼所见</span><h3>后宅通路已开放</h3><p>两侧门撑已锁定，悟空解除铜封，通路已经检查。</p></article><article class="entry"><span class="tag claim">◇ 本人安排</span><h3>翠兰愿意前往前院客房</h3><p>她已接受由高才带路。现在先去敞开的客房门口，进门到达后再由她确认。</p></article><article class="entry"><span class="tag pending">? 待核验</span><h3>曾有人在等候取经人</h3><p>来源：已获准查看的饭账。还需要独立来源与时间比较。</p></article><button class="secondary-button">选择一条向同伴说明</button>`,
  team: `<h2>队伍</h2><p class="subtitle">两位同伴在线。职责可以协作与交接。</p><article class="entry"><span class="tag">你 · 在线</span><h3>高才 · 迎客联络</h3><p>正陪翠兰走向前院客房。</p></article><article class="entry"><span class="tag">同伴 · 在线</span><h3>木匠 · 木作帮手</h3><p>门撑已锁定，正在照看开放通路。</p></article><p class="fine-print">队伍交流面向玩家，不会自动成为 NPC 已知的信息。</p>`,
  recap: `<h2>这一路发生的事</h2><p class="subtitle">当前局的可知经过；每一步保留发生时的视角。</p><article class="entry"><span class="tag">✓ 已完成</span><h3>后宅门已经打开</h3><p>门撑锁定、本人退让及铜封解除均已确认，通路已开放。</p></article><article class="entry"><span class="tag claim">◇ 正在进行</span><h3>翠兰已接受随行安排</h3><p>目的地是前院客房，由高才带路；她仍可暂停或重新约定。</p></article><article class="entry"><span class="tag pending">? 尚未完成</span><h3>还未到达客房内室</h3><p>走到门口不等于安置完成，仍需实际进门到达并由本人确认。</p></article>`,
};
const interactionCard = document.querySelector('#interaction-card');
const followCard = document.querySelector('#follow-card');
let panelTrigger = null;
function restoreSceneCards() {
  // 关闭阅读面板只恢复当前场景的卡片，不把初始门撑样例带进随行态。
  interactionCard.hidden = !overlay.hidden || state === 'follow';
  followCard.hidden = state !== 'follow';
}
function closePanel() {
  overlay.hidden = true;
  restoreSceneCards();
  panelTrigger?.focus();
  panelTrigger = null;
}
function openPanel(kind, trigger = null) {
  if (!content[kind]) return;
  const panelContent = state === 'follow' ? followContent[kind] || content[kind] : content[kind];
  overlay.innerHTML = `<button class="close-button" aria-label="关闭面板">×</button>${panelContent}`;
  overlay.dataset.kind = kind;
  overlay.hidden = false;
  panelTrigger = trigger;
  restoreSceneCards();
}
function showDesignNotice() {
  const toast = document.querySelector('#toast');
  toast.textContent = '这是独立视觉样页；实际操作由正式服务端确认。';
  toast.hidden = false;
}
// 委托包含后来打开的面板按钮；静态入口和动态内容都只给设计提示。
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  if (button.dataset.open) return openPanel(button.dataset.open, button);
  if (button.classList.contains('close-button')) return closePanel();
  showDesignNotice();
});
addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (!overlay.hidden) closePanel();
  else showDesignNotice();
});

const pathLayer = document.querySelector('#path-layer');
const locationGuides = document.querySelector('#location-guides');
const leftSupport = document.querySelector('.support-left');
const rightSupport = document.querySelector('.support-right');
// 两个示意落点分别对齐 C02/C03；图像状态也须与随行阶段一致。
leftSupport.setAttribute('transform', 'translate(23 11)');
rightSupport.setAttribute('transform', 'translate(-25 6)');
function showRoute(points, end) {
  pathLayer.removeAttribute('hidden');
  pathLayer.innerHTML = `<polyline points="${points}" fill="none" stroke="#365e52" stroke-width="3" stroke-dasharray="2 11" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="${end[0]}" cy="${end[1]}" rx="17" ry="8" fill="#f8f2e560" stroke="#365e52" stroke-width="2"/>`;
}
// 开口是独立设计标记；原背景位图不含完整内室，正式门/剖面资产仍待制作。
locationGuides.innerHTML = '<path d="M615 268V350H675V268" fill="#f8f2e550" stroke="#365e52" stroke-width="2.5" stroke-dasharray="6 4"/><rect x="559" y="370" width="172" height="29" rx="5" fill="#fff8e9ec" stroke="#9e916c"/><text x="645" y="390" text-anchor="middle">前院客房 · 敞开门</text>';

if (state === 'road') {
  document.querySelector('.background').src = 'assets/village-road.png';
  document.querySelector('.background').alt = '高老庄外的茶棚与短路场景概念';
  document.querySelector('.scene-states').setAttribute('hidden', '');
  showRoute('760,750 590,650 580,470 700,430 700,415', [700, 415]);
  locationGuides.innerHTML = '<path d="M550 235V325H610V235" fill="none" stroke="#365e52" stroke-width="2.5" stroke-dasharray="6 4"/><rect x="490" y="340" width="170" height="29" rx="5" fill="#fff8e9ec" stroke="#9e916c"/><text x="575" y="360" text-anchor="middle">茶棚后间 · 敞开门</text>';
  document.querySelector('#place-name').textContent = '庄外短路';
  document.querySelector('#objective-title').textContent = '让来客与旧事相见';
  document.querySelector('.objective-copy').textContent = '把已有材料送到约定的会面点。';
  document.querySelector('.progress').innerHTML = '<span class="completed"><b>✓</b> 已获旧饭账</span><span><b>◇</b> 向见证人核对日期</span>';
  document.querySelector('#interaction-card').innerHTML = '<p class="eyebrow">茶棚前</p><h2>去核对一段旧事</h2><p>沿花圃左侧走到见证人面前，问问来客到庄上之前的事。</p><button class="primary-button">前往茶棚 <span>→</span></button>';
  showActor('gaocai', '高才', 760, 750, true);
  showActor('bajie', '猪刚鬣', 1240, 340);
  showActor('carpenter', '茶棚见证人', 700, 415);
} else if (state === 'follow') {
  document.querySelector('.closed-door').setAttribute('hidden', '');
  rightSupport.removeAttribute('transform');
  const supportWood = [...leftSupport.children].slice(0, 3).map(element => element.outerHTML).join('');
  rightSupport.innerHTML = `<g transform="translate(2477 11) scale(-1 1)">${supportWood}</g><circle cx="1310" cy="405" r="12" fill="#f8f2e5" stroke="#365e52" stroke-width="1.5"/><path d="M1304 405l4 4 8-9" fill="none" stroke="#365e52" stroke-width="2.3"/>`;
  rightSupport.dataset.supportState = 'locked';
  showRoute('708,640 690,560 680,470 645,390 645,350', [645, 350]);
  document.querySelector('#interaction-card').hidden = true;
  document.querySelector('#follow-card').hidden = false;
  document.querySelector('#objective-title').textContent = '陪翠兰走到安置点';
  document.querySelector('.objective-copy').textContent = '顺着石路，先到左前方敞开的客房门口。';
  document.querySelector('.progress').innerHTML = '<span class="completed"><b>✓</b> 后宅通路已开放</span><span><b>◇</b> 下一段：前院客房门口</span>';
  showActor('gaocai', '高才', 708, 640, true);
  showActor('cuilan', '翠兰', 645, 620);
  showActor('tang', '唐僧', 850, 690);
  showActor('wukong', '悟空', 1210, 450);
} else {
  showActor('gaocai', '高才', state === 'dialogue' ? 950 : 708, state === 'dialogue' ? 640 : 752, true);
  showActor('tang', '唐僧', 850, 690);
  showActor('wukong', '悟空', state === 'dialogue' ? 1010 : 1180, state === 'dialogue' ? 600 : 490);
  showActor('carpenter', '木匠', 1285, 450);
  if (content[state]) openPanel(state);
  if (state === 'dialogue') document.querySelector('#path-layer').setAttribute('hidden', '');
}
restoreSceneCards();
document.documentElement.dataset.designReady = 'true';
