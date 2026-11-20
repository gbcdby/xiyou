// #66：真实Vue/DOM/SpatialMap/Canvas生命周期组件回归；公开DTO受控，不代替PG或整场运动验收。
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse, compileTemplate } from 'vue/compiler-sfc';
import { createServer as createVite } from 'vite';
import { chromium } from 'playwright';
import { repository, sourceIdentity, saveJSON, sha256, until } from './network-support.mjs';

const output = resolve(process.env.FRONTEND_EVIDENCE_DIR || resolve(repository, '.agent-output/presentation-lifecycle'));
await mkdir(output, { recursive: true });
const pageSource = await readFile(resolve(repository, 'frontend/src/features/session/SpatialSessionPage.vue'), 'utf8');
const { descriptor, errors } = parse(pageSource); assert.deepEqual(errors, []);
function elementWithClass(node, name) {
  if (node.type === 1 && node.props.some(prop => prop.type === 6 && prop.name === 'class' && prop.value?.content.split(' ').includes(name))) return node;
  for (const child of node.children ?? []) { const found = elementWithClass(child, name); if (found) return found; }
  return null;
}
const rootNode = elementWithClass(descriptor.template.ast, 'spatial-page');
const layoutNode = elementWithClass(descriptor.template.ast, 'spatial-layout');
assert.ok(rootNode && layoutNode, '必须读取实际Page祖先节点，不能复制class条件');
const opening = node => `<${node.tag} ${node.props.map(prop => prop.loc.source).join(' ')}>`;
// 只隔离这两个实际模板节点；组件、媒体测量、CSS和呈现生产者均使用生产模块。
const template = `${opening(rootNode)}
  <header class="gaolao-heading"><h1>呈现生命周期组件检查</h1></header>
  ${opening(layoutNode)}<div class="spatial-main">
    <SpatialMap :snapshot="snapshot" :snapshot-source="source" :disabled="disabled" :immersive="hud" :selected="selected" :person-labels="personLabels" />
  </div><div class="spatial-rail"><section class="gaolao-map-navigator">公开地图</section>
    <aside v-if="hudPanelKind" class="spatial-sidebar"><section class="panel" :class="{ 'spatial-reading-pane': reading }">
      <header class="spatial-reading-heading"><h2>{{ reading ? '手记' : '场景对象' }}</h2></header>
      <div class="spatial-reading-content"><p v-for="line in 12" :key="line">受控公开面板内容。</p></div>
    </section></aside>
  </div></div>
</div>`;
const compiled = compileTemplate({ source: template, filename: 'presentation-lifecycle-fixture.vue', id: 'presentation-lifecycle' });
assert.deepEqual(compiled.errors, []);
const fixtureSource = `
import { createApp, ref, shallowRef, nextTick } from 'vue';
import SpatialMap from '/src/features/world/SpatialMap.vue';
import { useGaolaoHud } from '/src/features/session/use-gaolao-hud.ts';
import { ConfirmedMotion } from '/src/domain/spatial-motion.ts';
import { createSpatialSnapshotSource } from '/src/domain/spatial-snapshot-source.ts';
import { SpatialCanvas, readCanvasFrame } from '/src/rendering/spatial-canvas.ts';
import { CanvasPresentationOwner } from '/src/rendering/spatial-presentation.ts';
import { spatialSnapshot } from '/tests/spatial-fixture.mjs';
import { observePresentation } from '/tests/presentation-observer.mjs';
import { installCanvasBoundaryProbe, realHoldSuffix } from '/tests/presentation-boundary-probe.mjs';
import '/src/styles.css';
import '/src/styles-spatial.css';
import '/src/styles-art.css';
${compiled.code}
let phase = '初始化', app, currentMotion, state, binding = 0, seq = 10;
const observer = observePresentation({ ConfirmedMotion, SpatialCanvas, CanvasPresentationOwner }, { phase: () => phase });
const boundaries = installCanvasBoundaryProbe();
// 只计真实组件front的成功写入；不调用调度或信用接口。
let frontWrites = 0;
for (const method of ['drawImage','clearRect','fillRect']) {
  const original = CanvasRenderingContext2D.prototype[method];
  CanvasRenderingContext2D.prototype[method] = function (...args) {
    const result = Reflect.apply(original, this, args);
    if (this.canvas?.matches?.('[data-testid="spatial-map"]')) frontWrites++;
    return result;
  };
}
const update = ConfirmedMotion.prototype.update;
ConfirmedMotion.prototype.update = function(...args) { currentMotion = this; return Reflect.apply(update, this, args); };
const channel = createSpatialSnapshotSource();
channel.source.subscribe(value => observer.snapshot(value), error => observer.error(error));
const rect = element => { if (!element) return null; const r = element.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; };
function read() {
  const calls = observer.read().calls, canvas = document.querySelector('[data-testid="spatial-map"]');
  const lastAccepted = calls.findLast(row => row.kind === 'owner.painted' && row.returned === true);
  const lastPainted = calls.findLast(row => row.kind === 'owner.painted');
  const lastBarrier = calls.findLast(row => ['owner.invalidate','motion.update','motion.reset'].includes(row.kind));
  const root = document.querySelector('.spatial-page'), layout = document.querySelector('.spatial-layout');
  return { at:performance.now(), phase, call:calls.at(-1)?.call ?? 0, paints:calls.filter(row=>row.kind==='canvas.paint' && row.frame).length,
    invalidations:calls.filter(row=>row.kind==='owner.invalidate').length, credit:currentMotion?.presentationCreditMs ?? 0,
    settled:currentMotion?.settled(state?.snapshot.value.projection.self.entityRef,performance.now()) ?? false,
    qualified:Boolean(lastAccepted && (!lastBarrier || lastAccepted.call > lastBarrier.call)), lastAccepted, lastPainted,
    snapshotSeq:state?.snapshot.value.snapshotSeq,
    narrow:state?.narrow.value, classes:{ root:root?.className, layout:layout?.className },
    canvas:rect(canvas), panel:rect(document.querySelector('.spatial-sidebar')),
    columns:layout ? getComputedStyle(layout).gridTemplateColumns : null };
}
function redrawRead() {
  const canvas = document.querySelector('[data-testid="spatial-map"]');
  return { ...read(), frontWrites, active:currentMotion?.active(performance.now()) ?? false,
    visible:!document.hidden && document.visibilityState==='visible', selected:state?.selected.value,
    frame:canvas ? readCanvasFrame(canvas) : null };
}
function publish(value) { channel.publish(value); state.snapshot.value = value; }
function advance() { const next=structuredClone(state.snapshot.value); next.snapshotSeq=String(++seq); publish(next); return read(); }
function rebind() {
  const next=spatialSnapshot(); next.snapshotSeq=String(++seq); next.viewId='lifecycle-'+(++binding); publish(next); return read();
}
function panel(kind) { state.reading.value=kind==='reading'?'notebook':null; state.hudPanelKind.value=kind; }
window.__lifecycle = {
  async boot(hud=true, useSource=true) {
    app=createApp({ components:{SpatialMap}, render, setup() {
      const hudRoot=ref(null), {narrow}=useGaolaoHud(hudRoot);
      state={hudRoot,narrow,hud:ref(hud),reading:ref(null),hudPanelKind:ref(null),snapshot:shallowRef(spatialSnapshot()),disabled:ref(false),selected:ref(undefined),personLabels:ref({})};
      channel.publish(state.snapshot.value); return {...state,source:useSource?channel.source:undefined};
    }}); app.mount('#fixture');
    // 同一JS任务内、首次rAF之前切换：没有成功paint就不能有信用。
    panel('reading'); await nextTick(); panel(null); await nextTick(); advance(); return read();
  },
  read, redrawRead, mark(value) { phase=value; }, evidence:()=>observer.read(),
  async redrawSamples(count=6) {
    const values=[];
    for(let index=0;index<count;index++) {
      await new Promise(resolve=>requestAnimationFrame(resolve));
      values.push(redrawRead());
    }
    return values;
  },
  async redrawSelect() { state.selected.value=state.snapshot.value.projection.self.entityRef; await nextTick(); },
  async redrawLabel(value) { state.personLabels.value={ [state.snapshot.value.projection.self.entityRef]:value }; await nextTick(); },
  boundaryRows:boundaries.read, realHoldSuffix,
  async boundary(mode) {
    const index=boundaries.arm(mode);
    if(mode==='prepare-error') advance(); else state.selected.value=state.selected.value?undefined:state.snapshot.value.projection.self.entityRef;
    await nextTick(); return index;
  },
  sealOnly() { boundaries.seal(); return read(); },
  async panel(kind) { panel(kind); await nextTick(); await Promise.resolve(); const changed=read(); const sealed=advance(); return {changed,sealed}; },
  advance,
  async advanceFlushed() { advance(); await nextTick(); return read(); },
  async hold(duration=1000) {
    rebind(); await nextTick();
    const next=structuredClone(state.snapshot.value), from=next.projection.sceneTimeMs, through=from+duration, position=next.projection.self.position;
    next.snapshotSeq=String(++seq); next.projection.sceneTimeMs=through;
    Object.assign(next.projection.entities[0],{motionTrail:[{...position},{...position}],motionFromSceneTimeMs:from,motionThroughSceneTimeMs:through,
      motionTimeline:[{kind:'hold',fromSceneTimeMs:from,throughSceneTimeMs:through,fromTrailIndex:0,throughTrailIndex:1}]});
    publish(next); await nextTick(); await Promise.resolve(); return read();
  },
  async redrawFutureMotion() {
    rebind(); await nextTick();
    const next=structuredClone(state.snapshot.value), from=next.projection.sceneTimeMs;
    const start={...next.projection.self.position}, end={x:start.x+36,y:start.y};
    next.snapshotSeq=String(++seq); next.projection.sceneTimeMs=from+500;
    next.projection.self.position={...end};
    Object.assign(next.projection.entities[0],{position:{...end},motionTrail:[{...start},{...start},{...end}],
      motionFromSceneTimeMs:from,motionThroughSceneTimeMs:from+500,
      motionTimeline:[{kind:'hold',fromSceneTimeMs:from,throughSceneTimeMs:from+300,fromTrailIndex:0,throughTrailIndex:1},
        {kind:'motion',fromSceneTimeMs:from+300,throughSceneTimeMs:from+500,fromTrailIndex:1,throughTrailIndex:2}]});
    publish(next); await nextTick(); return {...redrawRead(),start,end};
  },
  async redrawNpcMotion() {
    rebind(); await nextTick();
    const base=structuredClone(state.snapshot.value), npcRef='npc_redraw_000000000000000000000000';
    const start={x:260,y:100}, end={x:296,y:100};
    base.snapshotSeq=String(++seq); base.projection.entities.push({entityRef:npcRef,name:'续绘同行者',appearanceEpoch:'0',sceneId:base.projection.self.sceneId,position:{...start},facing:'S'});
    publish(base); await nextTick();
    const held=structuredClone(base), from=held.projection.sceneTimeMs, position=held.projection.self.position;
    held.snapshotSeq=String(++seq); held.projection.sceneTimeMs=from+5000;
    Object.assign(held.projection.entities[0],{motionTrail:[{...position},{...position}],motionFromSceneTimeMs:from,motionThroughSceneTimeMs:from+5000,
      motionTimeline:[{kind:'hold',fromSceneTimeMs:from,throughSceneTimeMs:from+5000,fromTrailIndex:0,throughTrailIndex:1}]});
    publish(held); await nextTick();
    const next=structuredClone(held), npc=next.projection.entities.find(person=>person.entityRef===npcRef), npcFrom=next.projection.sceneTimeMs;
    next.snapshotSeq=String(++seq); next.projection.sceneTimeMs=npcFrom+200;
    Object.assign(npc,{position:{...end},motionTrail:[{...start},{...end}],motionFromSceneTimeMs:npcFrom,motionThroughSceneTimeMs:npcFrom+200});
    publish(next); await nextTick(); return {...redrawRead(),npcRef,start,end};
  },
  async redrawAppearanceHold() {
    rebind(); await nextTick();
    const base=structuredClone(state.snapshot.value); base.snapshotSeq=String(++seq);
    Object.assign(base.projection.self,{appearanceId:'gaocai',appearanceEpoch:'1'});
    Object.assign(base.projection.entities[0],{appearanceId:'gaocai',appearanceEpoch:'1'});
    publish(base); await nextTick();
    const next=structuredClone(base), from=next.projection.sceneTimeMs, position=next.projection.self.position;
    next.snapshotSeq=String(++seq); next.projection.sceneTimeMs=from+5000;
    Object.assign(next.projection.entities[0],{motionTrail:[{...position},{...position}],motionFromSceneTimeMs:from,motionThroughSceneTimeMs:from+5000,
      motionTimeline:[{kind:'hold',fromSceneTimeMs:from,throughSceneTimeMs:from+5000,fromTrailIndex:0,throughTrailIndex:1}]});
    publish(next); await nextTick(); return redrawRead();
  },
  async fresh() { panel(null); rebind(); await nextTick(); },
  async invalidate(kind) {
    const root=document.querySelector('.spatial-page');
    if(kind==='hidden') { root.hidden=true; root.hidden=false; }
    if(kind==='style') { root.style.visibility='hidden'; root.style.visibility=''; }
    if(kind==='class') { root.classList.add('lifecycle-hidden'); root.classList.remove('lifecycle-hidden'); }
    if(kind==='disabled') state.disabled.value=true;
    if(kind==='identity') rebind();
    if(kind==='unmount') app.unmount();
    await nextTick(); await Promise.resolve(); return read();
  },
  async enable() { state.disabled.value=false; await nextTick(); },
};
`;
const fixturePlugin = {
  name: 'presentation-lifecycle-fixture',
  resolveId(id) { if (id === '/presentation-lifecycle-fixture.js') return '\0presentation-lifecycle-fixture'; },
  load(id) { if (id === '\0presentation-lifecycle-fixture') return fixtureSource; },
  configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (req.url !== '/presentation-lifecycle-fixture') return next();
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><html lang="zh-CN"><head><style>.lifecycle-hidden{visibility:hidden}</style></head><body><div id="app"><main id="fixture"></main></div><script type="module" src="/presentation-lifecycle-fixture.js"></script></body></html>');
    });
  },
};
const report = { workId:'GZ-UX-01-PRESENTATION', scope:'真实Vue/DOM/SpatialMap/Canvas与原observer；实际Page两祖先class绑定，公开DTO受控组件，不是整页联机或完整方向验收。',
  source:await sourceIdentity(), startedAt:new Date().toISOString(), pageSourceSha256:sha256(pageSource),
  testSourceSha256:sha256(await readFile(new URL(import.meta.url))), templateAncestors:[opening(rootNode),opening(layoutNode)], cases:[], pages:[], pageErrors:[] };
let vite, browser;
const activePages = [];
async function open(width, hud=true, useSource=true) {
  const page=await browser.newPage({viewport:{width,height:900}}); activePages.push(page);
  page.on('pageerror', error=>report.pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/presentation-lifecycle-fixture`);
  await until(()=>page.evaluate(()=>Boolean(window.__lifecycle)),'真实组件模块载入',10000);
  const beforePaint=await page.evaluate(([hud,useSource])=>window.__lifecycle.boot(hud,useSource),[hud,useSource]);
  assert.equal(beforePaint.paints,0,'首次rAF前未成功paint'); assert.equal(beforePaint.credit,0,'未paint的面板切换不得产生信用');
  report.cases.push({name:`${width}/${hud?'HUD':'非HUD'}未paint零资格`,status:'PASS',observed:beforePaint});
  await ready(page); return page;
}
async function ready(page) {
  return until(()=>page.evaluate(()=>{const value=window.__lifecycle.read();return value.qualified&&value.settled?value:null;}),'原Canvas实际painted=true且无待播段',10000);
}
async function recordPanel(page, kind, name, shouldInvalidate) {
  const before=await ready(page); await page.evaluate(name=>window.__lifecycle.mark(name),name);
  const after=await page.evaluate(kind=>window.__lifecycle.panel(kind),kind);
  const row={name,status:'PENDING',before,...after}; report.cases.push(row);
  if(shouldInvalidate) { assert.ok(after.changed.invalidations>before.invalidations,'有效布局/覆盖层开合必须通知原owner失效'); assert.equal(after.changed.credit,0); }
  else {
    assert.equal(after.changed.invalidations,before.invalidations,'桌面独立rail面板不得产生无效owner失效');
    assert.deepEqual(after.changed.canvas,before.canvas,'桌面面板开合不改变实际Canvas区域');
    assert.ok(after.sealed.credit>before.credit,'下一次原snapshot封口保留真实paint以来的连续资格');
  }
  row.status='PASS'; return row;
}
async function assertRedrawSleep(page, name, resourceState=null) {
  const before=await page.evaluate(()=>window.__lifecycle.redrawRead());
  if(resourceState) {
    assert.equal(before.frame?.resources.find(resource=>resource.file===resourceState.file)?.status,resourceState.status,'受控资源状态必须实际可见');
    assert.ok(before.frame.resources.every(resource=>resource.file===resourceState.file || resource.status==='ready'),'除明确受控资源外均须就绪');
  } else {
  assert.ok(before.frame && before.frame.resources.every(resource=>resource.status==='ready'),'资源必须已稳定，不能靠加载延迟冒充停帧');
  }
  assert.equal(before.lastPainted?.snapshotSeq,before.snapshotSeq,'当前snapshot已经真实呈现');
  assert.equal(before.lastPainted?.returned,true,'纯hold成功帧仍保留原凭据');
  const samples=await page.evaluate(()=>window.__lifecycle.redrawSamples(6));
  for(const sample of samples) {
    assert.equal(sample.visible,true,'确有前台可见native rAF机会'); assert.ok(sample.canvas.width>0 && sample.canvas.height>0);
    assert.equal(sample.active,true,'纯hold仍在原队列时间中'); assert.equal(sample.settled,false);
    assert.equal(sample.frontWrites,before.frontWrites,'纯hold不得自动重复写front');
    assert.equal(sample.frame.serial,before.frame.serial,'必须保留真实上一帧，不能制造新serial');
    assert.deepEqual(sample.canvas,before.canvas,'观察窗内布局必须稳定');
    assert.equal(sample.credit,before.credit,'仅等待rAF不能自行增加信用');
  }
  report.cases.push({name,status:'PASS',before,samples}); return samples.at(-1);
}
async function redrawWake(page, name, trigger, inspect=()=>{}) {
  const before=await page.evaluate(()=>window.__lifecycle.redrawRead());
  await trigger();
  const after=await until(()=>page.evaluate(before=>{
    const value=window.__lifecycle.redrawRead();
    return value.frontWrites>before.frontWrites && value.frame?.serial>before.frame.serial
      && value.lastPainted?.snapshotSeq===value.snapshotSeq ? value : null;
  },before),name+'实际front重画',10000);
  await inspect(after,before);
  report.cases.push({name,status:'PASS',before,after});
  await assertRedrawSleep(page,name+'之后再次停止自动续绘');
}
async function redrawResourcePaint(page, file, status, writes) {
  return until(()=>page.evaluate(({file,status,writes})=>{
    const value=window.__lifecycle.redrawRead(), resource=value.frame?.resources.find(entry=>entry.file===file);
    return resource?.status===status && value.frame.resources.every(entry=>entry.file===file || entry.status==='ready')
      && value.frontWrites>writes && value.lastPainted?.snapshotSeq===value.snapshotSeq ? value : null;
  },{file,status,writes}),'资源'+status+'通知后的真实front',10000);
}
async function collect(page) {
  const evidence=await page.evaluate(()=>window.__lifecycle.evidence());
  assert.equal(evidence.dropped,0); assert.deepEqual(evidence.errors,[]);
  report.pages.push({url:page.url(),viewport:page.viewportSize(),evidence});
}
try {
  vite=await createVite({root:resolve(repository,'frontend'),configFile:resolve(repository,'frontend/vite.config.mjs'),configLoader:'native',
    cacheDir:resolve(output,'vite-cache'),plugins:[fixturePlugin],server:{host:'127.0.0.1',port:0,fs:{allow:[repository]}}});
  await vite.listen(); browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:process.env.CHROMIUM_ARGS?JSON.parse(process.env.CHROMIUM_ARGS):[]});
  report.environment={node:process.version,chromium:browser.version(),dpr:1};
  const desktop=await open(1600);
  for(const kind of ['objects',null,'reading',null]) await recordPanel(desktop,kind,`桌面面板:${kind??'关闭'}`,false);
  await desktop.evaluate(()=>window.__lifecycle.mark('待播hold零信用'));
  await desktop.evaluate(()=>window.__lifecycle.hold());
  const hold=await until(()=>desktop.evaluate(()=>{const value=window.__lifecycle.read();return value.lastPainted?.snapshotSeq===value.snapshotSeq&&!value.settled?value:null;}),'待播hold已由原Canvas实际绘制',10000);
  assert.equal(hold.lastPainted.returned,true,'成功纯hold帧保存凭据不等于产生余额'); assert.equal(hold.credit,0);
  const holdPanel=await desktop.evaluate(()=>window.__lifecycle.panel('reading'));
  assert.equal(holdPanel.changed.settled,false); assert.equal(holdPanel.sealed.credit,0,'已实际paint的旧hold仍占用原时长，面板开合不补信用');
  report.cases.push({name:'待播hold零信用',status:'PASS',before:hold,after:holdPanel}); await desktop.evaluate(()=>window.__lifecycle.fresh());
  for(const kind of ['hidden','style','class','disabled','identity']) {
    await ready(desktop); const before=await desktop.evaluate(()=>window.__lifecycle.advance()); assert.ok(before.credit>0);
    await ready(desktop); await desktop.evaluate(kind=>window.__lifecycle.mark('真实失效:'+kind),kind);
    const after=await desktop.evaluate(kind=>window.__lifecycle.invalidate(kind),kind);
    assert.equal(after.credit,0,'真正失效不能保留旧余额：'+kind); assert.ok(after.invalidations>before.invalidations);
    report.cases.push({name:'真实失效:'+kind,status:'PASS',before,after});
    if(kind==='disabled') await desktop.evaluate(()=>window.__lifecycle.enable());
  }
  await ready(desktop); const resizeBefore=await desktop.evaluate(()=>window.__lifecycle.advance()); assert.ok(resizeBefore.credit>0);
  await desktop.setViewportSize({width:1500,height:900});
  await until(()=>desktop.evaluate(before=>{const now=window.__lifecycle.read();return now.invalidations>before.invalidations&&now.canvas.width!==before.canvas.width?now:null;},resizeBefore),'真实resize保留原失效',10000);
  const resizeAfter=await desktop.evaluate(()=>window.__lifecycle.read());
  const resizeEvidence=await desktop.evaluate(call=>window.__lifecycle.evidence().calls.filter(row=>row.call>call),resizeBefore.call);
  assert.ok(resizeEvidence.some(row=>row.kind==='motion.invalidatePresentation'&&row.creditBefore>0&&row.creditAfter===0));
  report.cases.push({name:'真实viewport resize清除旧余额',status:'PASS',before:resizeBefore,after:resizeAfter});
  await ready(desktop); const unmountBefore=await desktop.evaluate(()=>window.__lifecycle.advance()); assert.ok(unmountBefore.credit>0);
  const unmounted=await desktop.evaluate(()=>window.__lifecycle.invalidate('unmount')); assert.equal(unmounted.credit,0);
  report.cases.push({name:'unmount清除旧余额',status:'PASS',observed:unmounted}); await collect(desktop); await desktop.close();

  for(const width of [901,900,390]) {
    const page=await open(width), expectedNarrow=width<=900;
    assert.equal((await page.evaluate(()=>window.__lifecycle.read())).narrow,expectedNarrow,'使用真实useGaolaoHud容器测量');
    const opened=await recordPanel(page,'reading',`${width}px阅读面板`,expectedNarrow);
    assert.equal(opened.changed.classes.root.includes('hud-panel-open'),expectedNarrow);
    assert.equal(opened.changed.classes.layout.includes('reading-open'),expectedNarrow);
    if(width===901) {
      const before=await ready(page); await page.setViewportSize({width:900,height:900});
      const after=await until(()=>page.evaluate(()=>{const value=window.__lifecycle.read();return value.narrow&&value.classes.root.includes('hud-panel-open')&&value.classes.layout.includes('reading-open')?value:null;}),'已打开面板跨入900恢复原通知',10000);
      assert.ok(after.invalidations>before.invalidations);
      report.cases.push({name:'面板打开时901→900断点',status:'PASS',before,after});
    }
    await recordPanel(page,null,`${width}px关闭面板`,true); await collect(page); await page.close();
  }
  const legacy=await open(1600,false), before=await ready(legacy);
  const opened=await recordPanel(legacy,'reading','非HUD阅读保留原网格行为',true);
  assert.ok(opened.changed.classes.layout.includes('reading-open')); assert.equal(opened.changed.classes.root.includes('hud-panel-open'),false);
  assert.notEqual(opened.changed.columns,before.columns,'非HUD实际grid列继续随阅读面板变化');
  await recordPanel(legacy,null,'非HUD关闭阅读保留原通知',true); await collect(legacy); await legacy.close();
  for(const useSource of [true,false]) for(const mode of ['observe','buffer-error','callback-error','front-error','painted-error','null-result','prepare-error']) {
    const page=await open(1200,true,useSource); await ready(page);
    const credited=await page.evaluate(()=>window.__lifecycle.advanceFlushed()); assert.ok(credited.credit>0); await ready(page);
    const name=`真实Canvas边界/${useSource?'source':'props'}/${mode}`; await page.evaluate(name=>window.__lifecycle.mark(name),name);
    const index=await page.evaluate(mode=>window.__lifecycle.boundary(mode),mode);
    const boundary=await until(()=>page.evaluate(index=>{const value=window.__lifecycle.boundaryRows()[index];return value?.completed?value:null;},index),name,10000);
    const after=await page.evaluate(()=>window.__lifecycle.read());
    const row={name,status:'PENDING',boundary,after}; report.cases.push(row);
    if(mode==='observe') {
      assert.equal(boundary.hasProductionCallback,true,'使用实际Map提供的前台写前回调');
      assert.deepEqual(boundary.events.map(event=>event.kind),['buffer-start','before-front','front-transform','front-write','paint-return','owner-painted']);
      assert.ok(boundary.events.slice(0,4).every(event=>event.oldFrontIntact),'buffer及封口前旧front像素必须完整保留');
      assert.equal(boundary.accepted,true); assert.equal(boundary.creditAfterPaint,boundary.creditAtSeal,'新成功帧只开凭据，不即时增加余额');
      assert.ok(boundary.serial>boundary.previousSerial); assert.deepEqual(boundary.queries.map(query=>query.name),['settled','needsFrame']);
      assert.ok(boundary.queries.every(query=>query.at===boundary.sampledAt),'paint/settled/needsFrame使用同一采样时刻');
    } else {
      assert.equal(after.credit,0,'异常或null必须撤销所有余额'); assert.equal(after.qualified,false,'异常不能留下旧资格或产生新资格');
      assert.notEqual(boundary.accepted,true); const sealed=await page.evaluate(()=>window.__lifecycle.sealOnly());
      assert.equal(sealed.credit,0,'没有新成功帧的再次封口不能恢复旧余额');
    }
    row.status='PASS'; await collect(page); await page.close();
  }
  for(const useSource of [true,false]) {
    const page=await open(1600,true,useSource), prefix='RD-05/06/'+(useSource?'source':'props');
    const warm=await page.evaluate(()=>window.__lifecycle.redrawSamples(3));
    assert.ok(warm.every(value=>value.frontWrites===warm[0].frontWrites && value.frame.resources.every(resource=>resource.status==='ready')),'建立资源及布局稳定的非活动基线');
    await page.evaluate(prefix=>window.__lifecycle.mark(prefix),prefix);
    await page.evaluate(()=>window.__lifecycle.hold(5000));
    await until(()=>page.evaluate(()=>{
      const value=window.__lifecycle.redrawRead();
      return value.lastPainted?.snapshotSeq===value.snapshotSeq && value.active && !value.settled ? value : null;
    }),prefix+'待播pure hold已实际paint',10000);
    await assertRedrawSleep(page,prefix+'/纯hold保留队列但不自续');
    await redrawWake(page,prefix+'/snapshot',()=>page.evaluate(()=>window.__lifecycle.advance()));
    await redrawWake(page,prefix+'/selected',()=>page.evaluate(()=>window.__lifecycle.redrawSelect()),after=>assert.equal(after.selected,after.lastPainted.entityRef));
    await redrawWake(page,prefix+'/personLabels',()=>page.evaluate(()=>window.__lifecycle.redrawLabel('续绘标签')),
      after=>assert.equal(after.frame.labels.find(label=>label.key===after.lastPainted.entityRef)?.label,'续绘标签'));
    await redrawWake(page,prefix+'/resize',()=>page.setViewportSize({width:1500,height:900}),
      (after,before)=>assert.notEqual(after.canvas.width,before.canvas.width));
    await redrawWake(page,prefix+'/visibility-class',()=>page.evaluate(()=>window.__lifecycle.invalidate('class')),
      (after,before)=>assert.ok(after.invalidations>before.invalidations));
    await collect(page); await page.close();
  }
  for(const useSource of [true,false]) {
    const page=await open(1600,true,useSource), prefix='RD-06增量/'+(useSource?'source':'props');
    await page.evaluate(prefix=>window.__lifecycle.mark(prefix+'/future-motion'),prefix);
    const future=await page.evaluate(()=>window.__lifecycle.redrawFutureMotion());
    const futureSamples=await page.evaluate(()=>window.__lifecycle.redrawSamples(48));
    const futureFrames=[...new Map(futureSamples.filter(value=>value.lastPainted?.snapshotSeq===future.snapshotSeq)
      .map(value=>[value.frame.serial,value.frame.actors.find(actor=>actor.ref===value.lastPainted.entityRef)])).values()];
    assert.ok(futureFrames.some(actor=>!actor.moving && actor.position.x===future.start.x),'已实际绘出未来motion前的leading hold');
    assert.ok(new Set(futureFrames.filter(actor=>actor.moving).map(actor=>actor.position.x)).size>=2,'没有新snapshot也必须继续绘出至少两个不同运动位置');
    assert.deepEqual(futureFrames.at(-1).position,future.end); assert.equal(futureFrames.at(-1).moving,false,'最后实际帧必须回到idle');
    report.cases.push({name:prefix+'/leading hold自动进入未来motion',status:'PASS',future,futureSamples});

    await page.evaluate(prefix=>window.__lifecycle.mark(prefix+'/npc'),prefix);
    const npc=await page.evaluate(()=>window.__lifecycle.redrawNpcMotion());
    const npcSamples=await page.evaluate(()=>window.__lifecycle.redrawSamples(6));
    const npcFrames=npcSamples.filter(value=>value.lastPainted?.snapshotSeq===npc.snapshotSeq)
      .map(value=>value.frame.actors.find(actor=>actor.ref===npc.npcRef)).filter(Boolean);
    assert.ok(new Set(npcFrames.filter(actor=>actor.moving).map(actor=>actor.position.x)).size>=2,'本人hold不能遮蔽其他实体的实际连续运动');
    const npcAfter=await until(()=>page.evaluate(({npcRef,end})=>{
      const value=window.__lifecycle.redrawRead(), actor=value.frame?.actors.find(actor=>actor.ref===npcRef);
      return actor && !actor.moving && actor.position.x===end.x && actor.position.y===end.y ? value : null;
    },npc),prefix+'/NPC实际运动尾',10000);
    assert.equal(npcAfter.frame.actors.find(actor=>actor.ref===npcAfter.lastPainted.entityRef).moving,false);
    report.cases.push({name:prefix+'/本人hold与NPC运动',status:'PASS',npc,npcSamples,npcAfter});
    await assertRedrawSleep(page,prefix+'/NPC结束后本人hold仍不自续');

    const file=await page.evaluate(async()=>{
      const {spriteForAppearance}=await import('/src/domain/gaolao-art.ts');
      return spriteForAppearance('gaocai','S',false,0).href;
    });
    const pattern='**'+file+'*', requests=[], routeTasks=[];
    let releaseInitial,releaseRetry;
    const initialGate=new Promise(resolve=>{releaseInitial=resolve;}), retryGate=new Promise(resolve=>{releaseRetry=resolve;});
    const handler=route=>{
      const task=(async()=>{
        const retry=new URL(route.request().url()).searchParams.has('retry');
        requests.push({url:route.request().url(),retry});
        const outcome=await(retry?retryGate:initialGate);
        if(outcome==='fail') await route.abort('failed'); else await route.continue();
      })();
      routeTasks.push(task); return task;
    };
    await page.route(pattern,handler);
    try {
      const before=await page.evaluate(()=>window.__lifecycle.redrawRead());
      await page.evaluate(prefix=>window.__lifecycle.mark(prefix+'/appearance-resource'),prefix);
      await page.evaluate(()=>window.__lifecycle.redrawAppearanceHold());
      const loading=await redrawResourcePaint(page,file,'loading',before.frontWrites);
      assert.equal(requests.length,1,'实际资源请求已经到达受控路由');
      assert.equal(loading.frame.actors.find(actor=>actor.ref===loading.lastPainted.entityRef).appearanceId,'gaocai','同点静态外观变化必须进入真实frame');
      assert.equal(loading.frame.actors.find(actor=>actor.ref===loading.lastPainted.entityRef).art,null,'idle资源未到时保持实际中性回退');
      report.cases.push({name:prefix+'/静态appearance唤醒',status:'PASS',before,loading});
      await page.evaluate(()=>window.__lifecycle.redrawSamples(3));
      const asleep=await assertRedrawSleep(page,prefix+'/资源待到期间纯hold停止自续',{file,status:'loading'});
      let readyFrom=asleep;
      if(useSource) releaseInitial('ready');
      else {
        releaseInitial('fail');
        const failed=await redrawResourcePaint(page,file,'failed',asleep.frontWrites);
        assert.ok(failed.frame.failed.includes(file));
        report.cases.push({name:prefix+'/资源failed通知唤醒',status:'PASS',before:asleep,after:failed});
        await page.evaluate(()=>window.__lifecycle.redrawSamples(3));
        const failedAsleep=await assertRedrawSleep(page,prefix+'/failed后不自动轮询',{file,status:'failed'});
        await page.getByRole('button',{name:'重新载入场景'}).click();
        const retrying=await redrawResourcePaint(page,file,'loading',failedAsleep.frontWrites);
        assert.equal(requests.length,2); assert.equal(requests[1].retry,true,'使用实际retry入口及资源URL');
        report.cases.push({name:prefix+'/真实retry按钮唤醒',status:'PASS',before:failedAsleep,after:retrying});
        await page.evaluate(()=>window.__lifecycle.redrawSamples(3));
        readyFrom=await assertRedrawSleep(page,prefix+'/retry请求在途不自动轮询',{file,status:'loading'});
        releaseRetry('ready');
      }
      const completed=await redrawResourcePaint(page,file,'ready',readyFrom.frontWrites);
      assert.equal(completed.frame.actors.find(actor=>actor.ref===completed.lastPainted.entityRef).art?.href,file,'独立资源通知必须实际绘出新idle图像');
      report.cases.push({name:prefix+'/资源ready独立唤醒',status:'PASS',before:readyFrom,after:completed,requests});
      await page.evaluate(()=>window.__lifecycle.redrawSamples(3));
      await assertRedrawSleep(page,prefix+'/资源就绪后再次停止自续');
    } finally {
      releaseInitial('ready'); releaseRetry('ready');
      await Promise.allSettled(routeTasks); await page.unroute(pattern,handler);
    }
    await collect(page); await page.close();
  }
  const suffix=await browser.newPage({viewport:{width:1200,height:900}}); activePages.push(suffix);
  await suffix.goto(`http://127.0.0.1:${vite.httpServer.address().port}/presentation-lifecycle-fixture`);
  await until(()=>suffix.evaluate(()=>Boolean(window.__lifecycle)),'真实hold后缀模块',10000);
  const suffixes=await suffix.evaluate(()=>window.__lifecycle.realHoldSuffix());
  for(const value of suffixes) {
    assert.equal(value.sampledPending,true); assert.equal(value.accepted,true); assert.equal(value.afterPrepare,0); assert.equal(value.beforeSeal,0);
    assert.equal(value.credit,value.earlySeal?0:value.sealedAt-Math.max(value.presentedAt,value.tail));
    if(value.earlySeal) assert.ok(value.firstSeal<value.tail); else assert.ok(value.credit>0);
    assert.equal(value.repeatedCredit,value.credit); assert.equal(value.nullFrame,null); assert.equal(value.nullAccepted,false); assert.equal(value.afterNull,0);
    report.cases.push({name:`真实Canvas纯hold后缀/${value.earlySeal?'早封口不复活':'持续凭据仅空后缀'}`,status:'PASS',observed:value});
  }
  await collect(suffix); await suffix.close();
  assert.deepEqual(report.pageErrors,[]); report.status='PASS_COMPONENT_LIFECYCLE_ONLY';
} catch(error) {
  report.status='FAIL'; report.error=String(error.stack??error); process.exitCode=1;
  console.error(error);
} finally {
  for(const page of activePages.filter(page=>!page.isClosed())) { try { await collect(page); } catch(error) { report.pageErrors.push(String(error)); } }
  await browser?.close(); await vite?.close(); report.finishedAt=new Date().toISOString(); report.sourceEnd=await sourceIdentity();
  await saveJSON(resolve(output,'result.json'),report);
}
console.log(JSON.stringify({status:report.status,cases:report.cases.length,output,error:report.error}));
