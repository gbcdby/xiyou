import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createServer as createVite } from 'vite';
import { spatialSnapshot } from './spatial-fixture.mjs';
import { sceneLayerFixtures } from './scene-layer-fixtures.mjs';
import { repository, until, saveJSON } from './network-support.mjs';
import { canvasFrame, canvasPixels, worldPixel } from './canvas-browser-support.mjs';

/** 真实Vue与Canvas资源生命周期；技术SVG只作为已知透明像素输入，不是实体DOM或正式美术验收。 */
export async function checkObjectGeometry({ browser, output, report }) {
  const layers=sceneLayerFixtures(),snapshot=spatialSnapshot(),p=snapshot.projection;
  p.contentVersion=layers.group.contentVersion;p.mapVersion=layers.group.mapVersion;
  p.scene={...p.scene,sceneId:layers.group.sceneId,width:1600,height:1000};
  p.self={...p.self,name:'高才',appearanceId:'gaocai',sceneId:p.scene.sceneId,position:{x:315,y:390}};
  p.entities=[{...p.entities[0],name:p.self.name,appearanceId:'gaocai',sceneId:p.self.sceneId,position:{...p.self.position}}];p.items=[];
  const target={entityRef:'R'+'b'.repeat(32),name:'灶房旧饭账',visualKey:'ledger-book',sceneId:p.scene.sceneId,position:{x:260,y:405},resourceRevision:'1',fields:[],availableOperations:[]};p.targets=[target];
  const asset={file:'/tests/geometry-book.svg',width:1254,height:1254,pivot:{x:624,y:645},scale:26/1126,offset:{x:32,y:-100},layer:'object'};
  const entry=file=>({contentVersion:p.contentVersion,mapVersion:p.mapVersion,sceneId:p.scene.sceneId,variants:{default:{...asset,file}}});
  const catalog={...layers.objectCatalog,'ledger-book':entry(asset.file),'ledger-error':entry('/tests/geometry-book-error.svg'),'ledger-retry':entry('/tests/geometry-book-retry.svg')};
  const evidence={scope:'GZ-OBJ-VIS-001/GZ-UX-01：真实Canvas固定取景、偏移图像/标签/命中、像素反馈、HTTP失败与迟到资源；隔离受控快照，不是正式美术或世界动作证明',checks:[],requests:[]};
  const check=name=>{evidence.checks.push({name,status:'PASS'});report.checks.push({name,status:'PASS',scope:'controlled-object-geometry'});};
  let vite,context,page,mode='hold';const pending=[];
  const body='<svg xmlns="http://www.w3.org/2000/svg" width="1254" height="1254"><rect x="60" y="129" width="1126" height="1004" fill="#49687c"/></svg>';
  const fulfill=route=>route.fulfill({status:200,contentType:'image/svg+xml',headers:{'Cache-Control':'no-store'},body});
  try {
    vite=await createVite({root:resolve(repository,'frontend'),configFile:resolve(repository,'frontend/vite.config.mjs'),configLoader:'native',cacheDir:resolve(output,'geometry-vite-cache'),plugins:[{name:'controlled-object-geometry',enforce:'pre',load(id){if(id===resolve(repository,'frontend/src/assets/gaolao-object-art.json'))return JSON.stringify(catalog);if(id===resolve(repository,'frontend/src/assets/gaolao-scene-layers.json'))return JSON.stringify(layers.catalog);}}],server:{host:'127.0.0.1',port:0,fs:{allow:[repository]}}});
    await vite.listen();context=await browser.newContext({viewport:{width:1600,height:1000},deviceScaleFactor:1,reducedMotion:'reduce'});page=await context.newPage();
    page.on('pageerror',error=>report.pageErrors.push({scope:'object-geometry',message:error.message}));
    await page.route('**/tests/layer-*.svg*',route=>route.fulfill({status:200,contentType:'image/svg+xml',body:layers.files[new URL(route.request().url()).pathname]}));
    await page.route('**/tests/geometry-book*.svg*',async route=>{evidence.requests.push({mode,url:new URL(route.request().url()).pathname+new URL(route.request().url()).search});if(mode==='hold')pending.push(route);else if(mode==='failed')await route.fulfill({status:404,body:'受控缺图'});else await fulfill(route);});
    await page.goto(vite.resolvedUrls.local[0]+'tests/object-visual-fixture.html');await page.waitForFunction(()=>Boolean(window.objectVisualFixture));
    const set=value=>page.evaluate(value=>window.objectVisualFixture.setSnapshot(value),value);
    await page.evaluate(self=>window.objectVisualFixture.configureMap({immersive:true,personLabels:{[self]:'1号 · 高才'}}),p.self.entityRef);
    const settle=()=>page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
    const frame=async()=>{await settle();return canvasFrame(page);};
    const object=async()=>(await frame()).objects.find(value=>value.ref===target.entityRef);
    const select=async()=>{const f=await frame(),label=f.labels.find(value=>value.key===target.entityRef);assert.ok(label,'当前场景对象有可点击文字');await page.getByTestId('spatial-map').click({position:{x:label.x+label.width/2,y:label.y+label.height/2}});await settle();assert.equal((await page.evaluate(()=>window.objectVisualFixture.selections())).at(-1),target.entityRef);};
    const fallback=async()=>{const value=await object();assert.ok(value);assert.equal(value.file,undefined);assert.deepEqual(value.position,target.position);return value;};
    const overlaps=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
    const geometry=async()=>{const f=await frame(),o=f.objects.find(value=>value.ref===target.entityRef),b=o.bounds;return {fit:f.fit,view:f.view,viewport:f.viewport,image:o.file?{x:f.fit.x+(o.position.x+b.x)*f.fit.scale,y:f.fit.y+(o.position.y+b.y)*f.fit.scale,width:b.width*f.fit.scale,height:b.height*f.fit.scale}:null,labels:f.labels,pixels:await canvasPixels(page)};};
    await set(snapshot);await select();await until(()=>pending.length===1,'物件图像仍在途');await fallback();const pendingFit=(await frame()).fit;
    mode='good';await fulfill(pending.shift());await until(async()=>Boolean((await object())?.file),'偏移图像实际画入Canvas');
    const ready=await geometry();evidence.ready=ready;assert.deepEqual(ready.fit,pendingFit,'资源ready不移动镜头');assert.ok(ready.labels.every(label=>!overlaps(label,ready.image)),'姓名避开当前偏移图像');
    const imagePixel=await worldPixel(page,{x:target.position.x+asset.offset.x,y:target.position.y+asset.offset.y});await page.mouse.click(imagePixel.pixel.x,imagePixel.pixel.y);assert.equal((await page.evaluate(()=>window.objectVisualFixture.selections())).at(-1),target.entityRef,'偏移图像实际不透明区可选同一ref');
    check('偏移物件ready后实际像素、标签与alpha命中一致，加载不改变固定fit');
    const f=await frame();assert.deepEqual(f.view,{x:0,y:0,width:1600,height:1000});
    assert.ok(f.fit.x>=0&&f.fit.y>=0&&f.fit.x+1600*f.fit.scale<=f.viewport.width+.01&&f.fit.y+1000*f.fit.scale<=f.viewport.height+.01);
    const blank=f.fit.x>2?{x:1,y:f.viewport.height/2}:{x:f.viewport.width/2,y:1};assert.ok(f.fit.x>2||f.fit.y>2,'样本有世界外安全留白');await page.getByTestId('spatial-map').click({position:blank});assert.deepEqual(await page.evaluate(()=>window.objectVisualFixture.actions()),[],'世界外留白不发移动');
    const feedback=async()=>page.getByTestId('spatial-map').evaluate(async(canvas,position)=>{const f=(await import('/src/rendering/spatial-canvas.ts')).readCanvasFrame(canvas),cx=f.fit.x+position.x*f.fit.scale,cy=f.fit.y+(position.y-1)*f.fit.scale;const x=Math.floor((cx-27*f.fit.scale)*devicePixelRatio),y=Math.floor((cy-12*f.fit.scale)*devicePixelRatio),w=Math.ceil(54*f.fit.scale*devicePixelRatio),h=Math.ceil(24*f.fit.scale*devicePixelRatio),data=canvas.getContext('2d').getImageData(x,y,w,h).data;let green=0,red=0,black=0;for(let i=0;i<data.length;i+=4){if(Math.abs(data[i]-54)<16&&Math.abs(data[i+1]-94)<16&&Math.abs(data[i+2]-82)<16)green++;if(Math.abs(data[i]-150)<16&&Math.abs(data[i+1]-63)<16&&Math.abs(data[i+2]-47)<16)red++;if(data[i]<10&&data[i+1]<10&&data[i+2]<10)black++;}return {green,red,black,pixels:data.length/4};},p.self.position);
    const normal=await feedback();assert.ok(normal.green>0);await page.getByTestId('spatial-map').focus();await page.keyboard.press('Enter');await settle();const selected=await feedback();assert.ok(selected.red>normal.red);assert.ok(selected.black/selected.pixels<.1,'半透明选择反馈不绘成实心黑环');assert.deepEqual((await frame()).fit,ready.fit);evidence.feedback={normal,selected};check('完整世界固定fit、留白零移动；Enter选本人有真实强调像素且不驱动镜头');
    mode='failed';const failed=structuredClone(snapshot);failed.projection.targets[0].visualKey='ledger-error';await set(failed);await until(()=>page.getByRole('button',{name:'重新载入图像',exact:true}).isVisible(),'真实HTTP404进入回退');await fallback();
    mode='hold';await page.getByRole('button',{name:'重新载入图像',exact:true}).click();await until(()=>pending.length===1,'失败重试在途');await fallback();
    const hidden=structuredClone(failed);hidden.viewId='new-object-view';hidden.projection.targets[0].visualKey='constructor';await set(hidden);await select();await fallback();await fulfill(pending.shift());await page.waitForLoadState('networkidle');await fallback();
    mode='failed';const retry=structuredClone(snapshot);retry.projection.targets[0].visualKey='ledger-retry';await set(retry);await until(()=>page.getByRole('button',{name:'重新载入图像',exact:true}).isVisible(),'另一个当前资源真实失败');await fallback();mode='good';await page.getByRole('button',{name:'重新载入图像',exact:true}).click();await until(async()=>Boolean((await object())?.file),'当前资源重试恢复');
    const empty=structuredClone(snapshot);delete empty.projection.targets[0].visualKey;await set(empty);await select();await fallback();assert.deepEqual(await page.evaluate(()=>window.objectVisualFixture.actions()),[]);
    await set(null);assert.equal(await page.getByTestId('spatial-map').count(),0,'授权快照撤销时整张画布卸载');check('HTTP失败/重试在途/换view/未知key/迟到完成均不复活旧图；撤销清空命中与画面');
    evidence.assessment='PASS';
  } catch(error){evidence.assessment='FAIL';evidence.error=error.stack;throw error;}
  finally{await context?.close();await vite?.close();evidence.resourcesClosed=true;await saveJSON(resolve(output,'object-geometry-result.json'),evidence);}
}
