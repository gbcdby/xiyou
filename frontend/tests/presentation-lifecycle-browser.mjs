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
    <SpatialMap :snapshot="snapshot" :snapshot-source="source" :disabled="disabled" :immersive="hud" />
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
import { SpatialCanvas } from '/src/rendering/spatial-canvas.ts';
import { CanvasPresentationOwner } from '/src/rendering/spatial-presentation.ts';
import { spatialSnapshot } from '/tests/spatial-fixture.mjs';
import { observePresentation } from '/tests/presentation-observer.mjs';
import '/src/styles.css';
import '/src/styles-spatial.css';
import '/src/styles-art.css';
${compiled.code}
let phase = '初始化', app, currentMotion, state, binding = 0, seq = 10;
const observer = observePresentation({ ConfirmedMotion, SpatialCanvas, CanvasPresentationOwner }, { phase: () => phase });
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
function publish(value) { channel.publish(value); state.snapshot.value = value; }
function advance() { const next=structuredClone(state.snapshot.value); next.snapshotSeq=String(++seq); publish(next); return read(); }
function rebind() {
  const next=spatialSnapshot(); next.snapshotSeq=String(++seq); next.viewId='lifecycle-'+(++binding); publish(next); return read();
}
function panel(kind) { state.reading.value=kind==='reading'?'notebook':null; state.hudPanelKind.value=kind; }
window.__lifecycle = {
  async boot(hud=true) {
    app=createApp({ components:{SpatialMap}, render, setup() {
      const hudRoot=ref(null), {narrow}=useGaolaoHud(hudRoot);
      state={hudRoot,narrow,hud:ref(hud),reading:ref(null),hudPanelKind:ref(null),snapshot:shallowRef(spatialSnapshot()),disabled:ref(false)};
      channel.publish(state.snapshot.value); return {...state,source:channel.source};
    }}); app.mount('#fixture');
    // 同一JS任务内、首次rAF之前切换：没有成功paint就不能有信用。
    panel('reading'); await nextTick(); panel(null); await nextTick(); advance(); return read();
  },
  read, mark(value) { phase=value; }, evidence:()=>observer.read(),
  async panel(kind) { panel(kind); await nextTick(); await Promise.resolve(); const changed=read(); const sealed=advance(); return {changed,sealed}; },
  advance,
  async hold() {
    rebind(); const next=structuredClone(state.snapshot.value), from=next.projection.sceneTimeMs, through=from+1000, position=next.projection.self.position;
    next.snapshotSeq=String(++seq); next.projection.sceneTimeMs=through;
    Object.assign(next.projection.entities[0],{motionTrail:[{...position},{...position}],motionFromSceneTimeMs:from,motionThroughSceneTimeMs:through,
      motionTimeline:[{kind:'hold',fromSceneTimeMs:from,throughSceneTimeMs:through,fromTrailIndex:0,throughTrailIndex:1}]});
    publish(next); await nextTick(); await Promise.resolve(); return read();
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
async function open(width, hud=true) {
  const page=await browser.newPage({viewport:{width,height:900}}); activePages.push(page);
  page.on('pageerror', error=>report.pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/presentation-lifecycle-fixture`);
  await until(()=>page.evaluate(()=>Boolean(window.__lifecycle)),'真实组件模块载入',10000);
  const beforePaint=await page.evaluate(hud=>window.__lifecycle.boot(hud),hud);
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
  assert.equal(hold.lastPainted.returned,false); assert.equal(hold.credit,0);
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
