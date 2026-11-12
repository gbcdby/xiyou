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
function openPanel(kind) {
  if (!content[kind]) return;
  overlay.innerHTML = `<button class="close-button" aria-label="关闭面板">×</button>${content[kind]}`;
  overlay.dataset.kind = kind;
  overlay.hidden = false;
  document.querySelector('#interaction-card').hidden = true;
  overlay.querySelector('.close-button').onclick = () => { overlay.hidden = true; document.querySelector('#interaction-card').hidden = false; };
}
document.querySelectorAll('[data-open]').forEach(button => button.onclick = () => openPanel(button.dataset.open));
addEventListener('keydown', event => { if (event.key === 'Escape') { overlay.hidden = true; document.querySelector('#interaction-card').hidden = false; } });

if (state === 'road') {
  document.querySelector('.background').src = 'assets/village-road.png';
  document.querySelector('.background').alt = '高老庄外的茶棚与短路场景概念';
  document.querySelector('.scene-states').setAttribute('hidden', '');
  document.querySelector('#path-layer').setAttribute('hidden', '');
  document.querySelector('#place-name').textContent = '庄外短路';
  document.querySelector('#objective-title').textContent = '让来客与旧事相见';
  document.querySelector('.objective-copy').textContent = '把已有材料送到约定的会面点。';
  document.querySelector('.progress').innerHTML = '<span class="completed"><b>✓</b> 已获旧饭账</span><span><b>◇</b> 向见证人核对日期</span>';
  document.querySelector('#interaction-card').innerHTML = '<p class="eyebrow">茶棚</p><h2>去核对一段旧事</h2><p>到茶棚问问，来客到庄上之前发生过什么。</p><button class="primary-button">前往茶棚 <span>→</span></button>';
  showActor('gaocai', '高才', 760, 750, true);
  showActor('bajie', '猪刚鬣', 1350, 535);
  showActor('carpenter', '木匠', 945, 680);
} else if (state === 'follow') {
  document.querySelector('.closed-door').setAttribute('hidden', '');
  document.querySelector('#path-layer').setAttribute('hidden', '');
  document.querySelector('#interaction-card').hidden = true;
  document.querySelector('#follow-card').hidden = false;
  document.querySelector('#objective-title').textContent = '陪翠兰走到安置点';
  document.querySelector('.objective-copy').textContent = '陪她走到客房，路上不必着急。';
  document.querySelector('.progress').innerHTML = '<span class="completed"><b>✓</b> 后宅通路已开放</span><span><b>◇</b> 正在前往前院客房</span>';
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
document.querySelectorAll('button:not([data-open]):not(.close-button)').forEach(button => {
  if (button.onclick) return;
  button.addEventListener('click', () => {
    const toast = document.querySelector('#toast');
    toast.textContent = '这是独立视觉样页；实际操作由正式服务端确认。';
    toast.hidden = false;
  });
});
document.documentElement.dataset.designReady = 'true';
