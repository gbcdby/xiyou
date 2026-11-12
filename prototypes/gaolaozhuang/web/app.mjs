import { createGame, MAP } from './engine.mjs';
import { createRenderer } from './world.mjs';
import { createNavigation } from './navigation.mjs';

const $ = id => document.getElementById(id);
const game = createGame();
const navigation = createNavigation(game);
const canvas = $('world');
const renderer = createRenderer(canvas, game, asset => toast(asset.kind === 'character'
  ? '高才的部分动作未能载入，暂用站姿或简化人物。玩法仍可继续。'
  : '场景图片未能载入，已使用简化地图。玩法仍可继续。'));
let started = false, selectedTargetId = null, drawerMode = null;
let toastTimeout, speechTimeout, lastDialogue = '', lastUiKey = '', lastActionKey = '';
let lastTime = performance.now(), elapsed = 0, uiTimer = 0, recapSeen = false;
let soundOn = false, audioContext = null, soundTimer = null, lastLogCount = 0;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);

function toast(message) {
  if(!message) return;
  $('toast').textContent=message;$('toast').classList.add('visible');
  clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>$('toast').classList.remove('visible'),3900);
}

function modalOpen() {
  return !$('intro-modal').hidden || !$('recap-modal').hidden || !$('drawer').hidden;
}

function stopPending() { navigation.stop(); }

function selectPlayer(id) {
  const result=navigation.select(id);
  selectedTargetId=null;$('interaction-card').hidden=true;
  if(result.ok){toast(`现在由${game.state.actors[id].name}行动`);playNote(440,.1);}else toast(result.message);
  refreshUI(true);canvas.focus({preventScroll:true});
}

function openInteraction(id) {
  selectedTargetId=id;lastActionKey='';refreshInteraction();
}

function actOn(id,actionId=null) {
  const result=navigation.approach(id,actionId);
  toast(result.message);
  if(result.ok&&result.arrived)playNote(554,.14);
  refreshUI(true);canvas.focus({preventScroll:true});
}

function guideNext() {
  const objective=game.getObjective();
  if(!objective.targetId){toast(objective.detail||'先看看附近的人和物。');return;}
  if(objective.roleId && game.state.activeId!==objective.roleId)selectPlayer(objective.roleId);
  const target=game.getTargets().find(t=>t.id===objective.targetId);
  if(!target){toast(objective.detail);return;}
  openInteraction(target.id);
  const result=navigation.approach(target.id,null,true);
  toast(result.message);refreshInteraction();canvas.focus({preventScroll:true});
}

function updatePending() {
  const result=navigation.update();
  if(!result)return;
  if(result.arrived){openInteraction(result.targetId);if(result.ok&&!result.guideOnly)playNote(554,.14);}
  toast(result.message);refreshUI(true);
}

function refreshInteraction() {
  if(!selectedTargetId){$('interaction-card').hidden=true;return;}
  const target=game.getTargets().find(t=>t.id===selectedTargetId);
  if(!target){$('interaction-card').hidden=true;selectedTargetId=null;return;}
  const actor=game.state.actors[game.state.activeId];
  const near=distance(actor,target)<=MAP.interactionRadius;
  const actions=game.getActions(target.id);
  const isWalking=navigation.pending?.targetId===target.id;
  $('interaction-card').hidden=false;
  $('interaction-name').textContent=target.name;
  $('interaction-distance').textContent=isWalking?'正在走近…':near?'就在身边':'稍远';
  const blockedReason=actions.find(action=>!action.enabled&&action.reason)?.reason;
  $('interaction-hint').textContent=!actions.length?'这里暂时没有新事情，去别处看看吧。':
    !actions.some(action=>action.enabled)&&blockedReason?blockedReason:
    isWalking?'点另一处地面、停步或切换角色，可以取消这次前往。':near?'选择一个行动，让事情往前走。':'选择动作后，会先走近再进行。';
  const marks={wood:'料',ledger:'账',safe:'安','left-support':'支','right-support':'支',door:'门',meeting:'约'};
  $('interaction-mark').textContent=marks[target.id]||target.name.slice(0,1);
  const key=JSON.stringify([target.id,game.state.activeId,actions]);
  if(key===lastActionKey)return;
  lastActionKey=key;$('interaction-actions').replaceChildren();
  if(!actions.length){$('interaction-hint').textContent='这里暂时没有新事情，去别处看看吧。';}
  for(const action of actions){
    const b=document.createElement('button');b.type='button';b.textContent=action.label;b.disabled=!action.enabled;
    if(action.reason)b.title=action.reason;
    b.addEventListener('click',()=>actOn(target.id,action.id));$('interaction-actions').append(b);
  }
}

function refreshUI(force=false) {
  const state=game.state, facts=state.facts;
  const key=JSON.stringify([state.activeId,state.stage,facts,state.items,state.supports,state.logs.length]);
  if(force||key!==lastUiKey){
    lastUiKey=key;
    const objective=game.getObjective();
    $('quest-title').textContent=objective.title;$('quest-detail').textContent=objective.detail;
    $('guide-button').disabled=!objective.targetId;
    $('chapter-progress').textContent=facts.cuilanSafe?'三 · 赴约':facts.doorOpen?'二 · 护送':'一 · 开门';
    for(const [id,done,current] of [['step-door',facts.doorOpen,!facts.doorOpen],['step-escort',facts.cuilanSafe,facts.doorOpen&&!facts.cuilanSafe],['step-meeting',facts.meetingComplete,facts.cuilanSafe&&!facts.meetingComplete]]){
      $(id).classList.toggle('done',!!done);$(id).classList.toggle('current',!!current);
    }
    for(const id of ['gaocai','carpenter']){const el=$(`select-${id}`),active=state.activeId===id;el.classList.toggle('active',active);el.setAttribute('aria-pressed',String(active));}
    $('inventory-count').textContent=Object.values(state.items).filter(item=>item.owner===state.activeId).length;
    if(state.logs.length>lastLogCount){$('notebook-dot').hidden=false;lastLogCount=state.logs.length;}
    if(drawerMode)renderDrawer();
  }
  refreshInteraction();
  const dialogue=state.dialogue;
  const signature=dialogue?`${dialogue.speaker}|${dialogue.text}`:'';
  if(signature&&signature!==lastDialogue){
    lastDialogue=signature;
    $('speech-name').textContent=state.actors[dialogue.speaker]?.name||dialogue.speaker;
    $('speech-text').textContent=dialogue.text;$('speech-card').hidden=false;
    clearTimeout(speechTimeout);speechTimeout=setTimeout(()=>$('speech-card').hidden=true,14000);
  }
  if(state.recap&&!recapSeen){recapSeen=true;showRecap();}
}

function showRecap() {
  $('recap-content').innerHTML=[
    '两位同伴各安一侧支架，悟空亲自到门前帮忙。',
    '翠兰同意后跟随你穿过庭院，抵达安置处。',
    '旧饭账与厨娘的证言相互印证；会面改到庄口，你把消息带到了。',
  ].map((s,i)=>`<div class="recap-event"><span>${i+1}</span><p>${s}</p></div>`).join('');
  $('recap-modal').hidden=false;$('recap-continue').focus();
}

function openDrawer(mode) {
  drawerMode=mode;$('drawer').hidden=false;$('drawer-backdrop').hidden=false;
  renderDrawer();$('drawer-close').focus();
}

function closeDrawer() {
  drawerMode=null;$('drawer').hidden=true;$('drawer-backdrop').hidden=true;canvas.focus({preventScroll:true});
}

function renderDrawer() {
  const state=game.state;
  if(drawerMode==='inventory'){
    $('drawer-kicker').textContent=`${state.actors[state.activeId].name} · 随身物件`;$('drawer-title').textContent='行囊';
    const held=Object.values(state.items).filter(item=>item.owner===state.activeId);
    $('drawer-content').innerHTML=(held.length?held.map(item=>`<div class="inventory-item"><span class="inventory-icon">${item.kind==='material'?'木':'账'}</span><div><b>${escape(item.name)}</b><small>${item.kind==='material'?'带到后屋门前，安装一侧支架。':'可以带给唐长老，也可以交给身边的同伴。'}</small></div></div>`).join(''):'<p class="empty-note">行囊还是空的。<br>看看厨房前的木料和旧饭账。</p>')+'<div class="drawer-footer-note"><p>需要交接饭账时，先走近另一位同伴，再点击他选择交接。门撑木料各领一份；每件东西只有一位持有人。</p></div>';
  } else if(drawerMode==='notebook'){
    $('drawer-kicker').textContent='已发生的事 · 本地共享手记';$('drawer-title').textContent='庄中手记';
    const logs=state.logs.slice().reverse();
    $('drawer-content').innerHTML=logs.length?logs.map(log=>`<div class="notebook-entry">${escape(typeof log==='string'?log:log.text)}</div>`).join(''):'<p class="empty-note">这页手记，等你来写。<br>先问问庄里的人吧。</p>';
    $('notebook-dot').hidden=true;
  } else {
    $('drawer-kicker').textContent='原型说明 · 操作';$('drawer-title').textContent='入庄须知';
    $('drawer-content').innerHTML=`<h3>先试一小段故事</h3><p>两位同伴先搭好门撑，等悟空走来开门；征得翠兰同意后陪她去前庭，再带着旧饭账和证言赴约。</p><h3>怎么走，怎么做</h3><ul><li>点击空地行走。桌子、花圃与房屋边界会挡住去路。</li><li>点击物件或人物，选择下方动作；距离较远时会先走近。</li><li>点击右上头像，或按 <kbd>1</kbd> / <kbd>2</kbd> 切换高才、木匠。</li><li>按 <kbd>E</kbd> 与最近的人或物互动；方向键也可以移动。</li><li>点击“停步”或按 <kbd>Esc</kbd> 取消行走和排队互动。切换同伴也会取消上一人的行动。</li><li>任务卡的“去下一处”可以带路，到场后仍由你选动作。</li></ul><h3>可以试试这些变化</h3><p>让两个人各拿一根木料；走到同伴身边交接饭账；护送途中请翠兰歇一会，再请她继续；会面地点变了，就带着东西重新赴约。</p><h3>这一版的边界</h3><p>这是本地单人切换两个角色的样片，NPC 行为由规则预设，用来验证行走和协作手感。尚未接入真人联机和真实 AI。刷新页面会重新开始，打开手记时暂停模拟。</p><p>桌面横屏体验优先。手机竖屏会随当前角色移动视野，可用“去下一处”前往屏幕外的目标。</p><div class="drawer-footer-note"><p>原型任务：<a href="https://github.com/gbcdby/xiyou/issues/25" target="_blank" rel="noopener noreferrer">xiyou #25</a><br>水墨淡彩场景为本项目生成资产；高才正在试用八方向行走与站立动画，其他人物保留原型绘制。</p><button class="secondary-button" id="drawer-restart" type="button">重新开始这段故事</button></div>`;
    $('drawer-restart').addEventListener('click',restart);
  }
}

function restart() {
  navigation.stop();game.reset();selectedTargetId=null;lastDialogue='';lastUiKey='';lastActionKey='';recapSeen=false;lastLogCount=0;
  closeDrawer();$('recap-modal').hidden=true;$('speech-card').hidden=true;$('interaction-card').hidden=true;clearTimeout(speechTimeout);
  started=true;refreshUI(true);toast('新的一回。从两根支架木料开始。');
}

function playNote(frequency,duration=.25) {
  if(!soundOn||!audioContext)return;
  const t=audioContext.currentTime,o=audioContext.createOscillator(),gain=audioContext.createGain();
  o.type='sine';o.frequency.setValueAtTime(frequency,t);
  gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(.025,t+.015);gain.gain.exponentialRampToValueAtTime(.0001,t+duration);
  o.connect(gain);gain.connect(audioContext.destination);o.start(t);o.stop(t+duration+.02);
}

async function toggleSound() {
  soundOn=!soundOn;
  if(soundOn){
    const Audio=window.AudioContext||window.webkitAudioContext;
    if(!Audio){soundOn=false;toast('这个浏览器暂不支持声音。');return;}
    try{audioContext||=new Audio();await audioContext.resume();}catch{soundOn=false;toast('声音暂未能开启。');return;}
    playNote(440,.5);
    const notes=[293.66,392,440,587.33,523.25,392];let i=0;
    soundTimer=setInterval(()=>{if(!document.hidden)playNote(notes[i++%notes.length],1.6);},3800);
  }else{clearInterval(soundTimer);audioContext?.suspend();}
  $('sound-toggle').setAttribute('aria-pressed',String(soundOn));$('sound-label').textContent=soundOn?'声音开':'声音关';
}

canvas.addEventListener('pointermove',event=>{
  const target=renderer.hitTest(renderer.toWorld(event.clientX,event.clientY));renderer.setHover(target?.id||null);canvas.style.cursor=target?'pointer':'crosshair';
});
canvas.addEventListener('pointerleave',()=>renderer.setHover(null));
canvas.addEventListener('pointerdown',event=>{
  if(event.button!==0||modalOpen())return;
  const p=renderer.toWorld(event.clientX,event.clientY),target=renderer.hitTest(p);
  canvas.focus({preventScroll:true});
  if(target){openInteraction(target.id);return;}
  stopPending();selectedTargetId=null;$('interaction-card').hidden=true;
  const result=navigation.move(p.x,p.y);
  if(!result.ok)toast(result.message);else renderer.mark(p,elapsed);
});
window.addEventListener('resize',()=>renderer.resize());
for(const id of ['gaocai','carpenter'])$(`select-${id}`).addEventListener('click',()=>selectPlayer(id));
$('start-button').addEventListener('click',()=>{started=true;$('intro-modal').hidden=true;canvas.focus({preventScroll:true});toast('点空地走走；也可以用“去下一处”找到第一件事。');refreshUI(true);});
$('guide-button').addEventListener('click',guideNext);
$('stop-button').addEventListener('click',()=>{stopPending();toast('已停步，排队中的互动也已取消。');canvas.focus({preventScroll:true});refreshInteraction();});
$('interaction-close').addEventListener('click',()=>{selectedTargetId=null;$('interaction-card').hidden=true;});
$('speech-close').addEventListener('click',()=>$('speech-card').hidden=true);
$('inventory-open').addEventListener('click',()=>openDrawer('inventory'));
$('notebook-open').addEventListener('click',()=>openDrawer('notebook'));
$('help-open').addEventListener('click',()=>openDrawer('help'));
$('drawer-close').addEventListener('click',closeDrawer);
$('drawer-backdrop').addEventListener('click',closeDrawer);
$('sound-toggle').addEventListener('click',toggleSound);
$('recap-continue').addEventListener('click',()=>{$('recap-modal').hidden=true;canvas.focus({preventScroll:true});});
$('restart-button').addEventListener('click',restart);

document.addEventListener('keydown',event=>{
  if(event.key==='Tab'&&modalOpen()){
    const box=!$('drawer').hidden?$('drawer'):!$('intro-modal').hidden?$('intro-modal'):$('recap-modal');
    const list=[...box.querySelectorAll('button:not(:disabled),a[href]')];
    if(list.length){const first=list[0],last=list.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
    return;
  }
  if(event.key==='Escape'){
    if(!$('drawer').hidden)closeDrawer();else if(!$('recap-modal').hidden)$('recap-continue').click();else{stopPending();selectedTargetId=null;$('interaction-card').hidden=true;$('speech-card').hidden=true;toast('已停步。');}
    return;
  }
  if(modalOpen()||event.target.matches('input,textarea,button,a'))return;
  if(event.key==='1'||event.key==='2'){event.preventDefault();selectPlayer(event.key==='1'?'gaocai':'carpenter');return;}
  if(event.key.toLowerCase()==='e'){
    event.preventDefault();const target=game.getNearestTarget();
    if(target){openInteraction(target.id);}else toast('走近人物或物件，再试着互动。');return;
  }
  const directions={ArrowUp:[0,-110],ArrowDown:[0,110],ArrowLeft:[-110,0],ArrowRight:[110,0]};
  if(directions[event.key]){event.preventDefault();stopPending();const actor=game.state.actors[game.state.activeId];const d=directions[event.key];game.moveTo(actor.x+d[0],actor.y+d[1]);}
});

document.addEventListener('visibilitychange',()=>{lastTime=performance.now();});
window.addEventListener('error',event=>{console.error('原型运行错误',event.message);toast('运行遇到问题，可刷新重试。');});

function frame(now) {
  // 引擎内部再分小步；低帧率时仍按经过时间行走，切回标签页不补跑整段。
  const dt=Math.min(.25,Math.max(0,(now-lastTime)/1000));lastTime=now;elapsed+=dt;
  try{
    if(started&&!modalOpen()&&!document.hidden){game.update(dt);updatePending();}
    // 高才帧相位来自引擎实际路程；暂停保留当前帧，重开随新 actor 自动归零。
    renderer.draw(elapsed,dt);
    uiTimer+=dt;if(uiTimer>.12){uiTimer=0;refreshUI();}
  }catch(error){console.error('场景更新失败',error);$('load-error').hidden=false;return;}
  requestAnimationFrame(frame);
}

refreshUI(true);$('start-button').focus();requestAnimationFrame(frame);
