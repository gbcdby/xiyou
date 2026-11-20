// GZ-UX-01：正式 scene-v3 真实页面动态入口；普通人类操作全部走可见UI。
// 两个独立账号、真实PG/HTTP/Socket/Canvas；无真实LLM，不代替真人试玩或全角色艺术验收。
import assert from 'node:assert/strict';
import { writeSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer as createVite } from 'vite';
import { chromium } from 'playwright';
import { startTestPostgres } from '../../backend/test-support/postgres.mjs';
import { createAuthorityServer } from '../../backend/server.mjs';
import { repository, sourceIdentity, saveJSON, sha256, until, sleep } from './network-support.mjs';
import { browserRoom, snapshot, clientState, openReading, closeReading, openObjects } from './gaolao-real-support.mjs';
import { assertPaintContinuity, canvasFrame, canvasPixels } from './canvas-browser-support.mjs';
import { validateSpatial } from '../../protocol/spatial.mjs';
import { observeDirectionConnections, installPresentationObservation, assertPresentationEvidence, assertShortDirectionPlan, observeDirectionSubmissions, installDirectionObservation, beginDirectionObservations, collectAcceptedLateEvidence, assertAcceptedLateEvidence, assertFivePersonSupply } from './direction-browser-support.mjs';

const scenario=process.argv[2]??'normal';
assert.ok(['normal','late-accepted-se-180','five-person'].includes(scenario),'未知方向验收场景');
const count=scenario==='five-person'?5:2;
const output=resolve(process.env.FRONTEND_EVIDENCE_DIR||resolve(repository,'.agent-output/ci/browser-client-experience'+(scenario==='normal'?'':'-'+scenario)));
await mkdir(output,{recursive:true});
const report={work_id:'GZ-UX-01',scenario,count,contentVersion:'gaolaozhuang-scene-v3',scope:`自然CI真实Chromium、生产Vue与scene-v3、独立${count}账号；人工操作由浏览器自动化执行，不是真人/真实provider/全角色美术验收`,source:await sourceIdentity(),startedAt:new Date().toISOString(),checks:[],pageErrors:[],humanActions:[],npcActions:[],recapResponses:[],wireActions:[],httpAssets:[],screenshots:[],cleanup:[]};
let database,server,vite,browser,room,page,video,directionConnections,directionSubmissions,fault=null;
const check=(id,name,details={})=>{report.checks.push({id,name,status:'PASS',...details});console.log(JSON.stringify({id,name,status:'PASS'}));};
const position=async()=>structuredClone((await snapshot(page)).projection.self.position);
const actions=async()=> (await clientState(page)).actions;
const waitSettled=()=>until(async()=>!(await actions()).some(action=>action.status==='waiting'),'已发动作收据完成');
const stop=async()=>{await page.getByRole('button',{name:'停步 / 取消后续操作',exact:true}).click();await waitSettled();};
const sceneRefs=p=>[...p.sceneOverview.entities,...p.sceneOverview.items,...p.sceneOverview.targets].map(value=>value.entityRef).sort();
const drawRefs=f=>[...f.actors.map(value=>value.ref),...f.objects.map(value=>value.ref)].sort();
async function picture(name){const file=resolve(output,name);await page.screenshot({path:file});report.screenshots.push({file:name,sha256:sha256(await readFile(file))});}
async function phase(name){await page.evaluate(name=>{window.uxCapture.phase=name;window.uxCapture.phaseAt=performance.now();},name);directionSubmissions?.mark(name);}
async function startCapture(){await page.evaluate(async()=>{
  const {readCanvasFrame,SpatialCanvas}=await import('/src/rendering/spatial-canvas.ts'),canvas=document.querySelector('[data-testid="spatial-map"]');
  const {ConfirmedMotion}=await import('/src/domain/spatial-motion.ts');
  const probe=document.createElement('canvas');probe.width=32;probe.height=20;const context=probe.getContext('2d',{willReadFrequently:true});
  const capture=window.uxCapture={running:true,phase:'ready',phaseAt:performance.now(),frames:[],paints:[],updates:[],errors:[]};
  // 测试专用只读包装：原 this/参数/返回值不变，分别保留插值时钟、实际绘制时刻与采样 rAF。
  const originalRAF=window.requestAnimationFrame;let callbackRAFAt=null;
  function observedRAF(callback){return originalRAF.call(window,function(rafAt){const prior=callbackRAFAt;callbackRAFAt=rafAt;try{return callback.call(this,rafAt);}finally{callbackRAFAt=prior;}});}
  window.requestAnimationFrame=observedRAF;
  const originalPaint=SpatialCanvas.prototype.paint,rendererIds=new WeakMap();let nextRendererId=0;
  function observedPaint(...args){
    const startedAt=performance.now(),frame=originalPaint.apply(this,args),finishedAt=performance.now();
    if(capture.running&&frame){const snapshot=args[0],p=snapshot.projection;if(!rendererIds.has(this))rendererIds.set(this,++nextRendererId);capture.paints.push({phase:capture.phase,rendererId:rendererIds.get(this),serial:frame.serial,instance:frame.instance,sceneId:frame.sceneId,viewId:snapshot.viewId,controlEpoch:p.self.controlEpoch,appearanceEpoch:p.self.appearanceEpoch,rafAt:callbackRAFAt,motionAt:args[2],startedAt,finishedAt,snapshotSeq:snapshot.snapshotSeq,sceneTimeMs:p.sceneTimeMs,self:frame.actors.find(actor=>actor.ref===p.self.entityRef)});}
    return frame;
  }
  SpatialCanvas.prototype.paint=observedPaint;
  const originalUpdate=ConfirmedMotion.prototype.update;
  function observedUpdate(...args){
    const snapshot=args[0],p=snapshot.projection,startedAt=performance.now();
    const input=structuredClone({phase:capture.phase,at:args[1],startedAt,snapshotSeq:snapshot.snapshotSeq,viewId:snapshot.viewId,sceneTimeMs:p.sceneTimeMs,paused:p.paused,self:p.self,movement:p.movement,person:p.sceneOverview?.entities.find(value=>value.entityRef===p.self.entityRef)??p.entities.find(value=>value.entityRef===p.self.entityRef)});
    const result=originalUpdate.apply(this,args);input.finishedAt=performance.now();if(capture.running)capture.updates.push(input);return result;
  }
  ConfirmedMotion.prototype.update=observedUpdate;
  capture.restore=()=>{if(window.requestAnimationFrame===observedRAF)window.requestAnimationFrame=originalRAF;if(SpatialCanvas.prototype.paint===observedPaint)SpatialCanvas.prototype.paint=originalPaint;if(ConfirmedMotion.prototype.update===observedUpdate)ConfirmedMotion.prototype.update=originalUpdate;};
  const take=now=>{if(!capture.running)return;try{const frame=readCanvasFrame(canvas),s=window.uxSpatial.spatialState.value.snapshot;if(frame&&s){context.clearRect(0,0,32,20);context.drawImage(canvas,0,0,32,20);const rgba=context.getImageData(0,0,32,20).data,colors=new Set();let opaque=0;for(let i=0;i<rgba.length;i+=4){if(rgba[i+3])opaque++;colors.add([rgba[i],rgba[i+1],rgba[i+2],rgba[i+3]].join(','));}const self=frame.actors.find(actor=>actor.ref===s.projection.self.entityRef),paint=capture.paints.at(-1);capture.frames.push({at:now,readAt:performance.now(),phase:capture.phase,phaseElapsed:now-capture.phaseAt,serial:frame.serial,instance:frame.instance,sceneId:frame.sceneId,snapshotSeq:s.snapshotSeq,sceneTimeMs:s.projection.sceneTimeMs,paint:paint?.serial===frame.serial&&paint.instance===frame.instance?{motionAt:paint.motionAt,startedAt:paint.startedAt,finishedAt:paint.finishedAt,snapshotSeq:paint.snapshotSeq,sceneTimeMs:paint.sceneTimeMs}:null,fit:frame.fit,view:frame.view,viewport:frame.viewport,refs:[...frame.actors.map(actor=>actor.ref),...frame.objects.map(object=>object.ref)].sort(),self,opaque,colors:colors.size});}}catch(error){capture.errors.push(error.message);}requestAnimationFrame(take);};requestAnimationFrame(take);
});}
async function stopCapture(){return page.evaluate(()=>{const capture=window.uxCapture;capture.running=false;capture.restore();return {frames:capture.frames,paints:capture.paints,updates:capture.updates,errors:capture.errors};});}
async function currentMapPoint(destination){
  const map=page.locator('.gaolao-map-navigator'),expand=map.getByRole('button',{name:'展开地图',exact:true});if(await expand.isVisible())await expand.click();
  await map.getByRole('button',{name:'当前',exact:true}).click();
  const scene=(await snapshot(page)).projection.scene;
  const point=await page.getByTestId('gaolao-minimap').evaluate((canvas,{scene,destination})=>{const box=canvas.getBoundingClientRect(),scale=Math.min((box.width-16)/scene.width,(box.height-16)/scene.height),x=(box.width-scene.width*scale)/2,y=(box.height-scene.height*scale)/2;const pixel={x:Math.round(box.left+x+destination.x*scale),y:Math.round(box.top+y+destination.y*scale)};return {pixel,destination:{x:Math.round((pixel.x-box.left-x)/scale),y:Math.round((pixel.y-box.top-y)/scale)}};},{scene,destination});
  const before=(await actions()).map(action=>action.id);await page.mouse.click(point.pixel.x,point.pixel.y);
  const draft=await until(async()=>(await actions()).find(action=>!before.includes(action.id)&&JSON.parse(action.raw).action.kind==='move_to'),'当前地图点击发出真实move');assert.deepEqual(JSON.parse(draft.raw).action.destination,point.destination);return {draft,destination:point.destination};
}
async function exerciseMotion(initial,first){
  await picture('scene-v3-desktop.png');await page.bringToFront();await page.getByTestId('spatial-map').focus();
  if(directionSubmissions)await beginDirectionObservations(server.runtime,room);
  const assetsBefore=report.httpAssets.length,actionsBefore=(await actions()).map(action=>action.id),start=Date.now();await startCapture();
  await phase('right');await page.keyboard.down('ArrowRight');for(let i=0;i<5;i++){await sleep(100);await page.keyboard.down('ArrowRight');}
  await phase('diagonal');await page.keyboard.down('ArrowDown');await sleep(350);
  const diagonalHold=Date.now();await until(async()=>page.evaluate(()=>Boolean(window.uxCapture?.frames?.some(frame=>frame.phase==='diagonal'&&frame.self?.facing==='SE'))),'斜向已由真实Canvas应用',2000);
  await phase('down-only');await page.keyboard.up('ArrowRight');await sleep(450);
  const downHold=Date.now();await until(async()=>page.evaluate(()=>Boolean(window.uxCapture?.frames?.some(frame=>frame.phase==='down-only'&&frame.self?.facing==='S'))),'下向已由真实Canvas应用',2000);
  report.motionHold={diagonalExtraMs:Date.now()-diagonalHold,downExtraMs:Date.now()-downHold};
  await phase('stopped');await page.keyboard.up('ArrowDown');await waitSettled();await sleep(250);
  const capture=await stopCapture();report.motion=capture;report.presentation=await page.evaluate(()=>window.uxPresentation.stop());await saveJSON(resolve(output,'result-before-cleanup.json'),report);
  report.presentationSummary=assertPresentationEvidence(report.presentation);
  const timelineUpdates=capture.updates.filter(update=>update.person?.motionTimeline?.length);
  assert.ok(timelineUpdates.length>0,'新模式必须实际收到已执行分段时间线');
  for(const update of timelineUpdates)validateSpatial('SceneEntityViewV1',update.person);
  report.timelineQualification={updates:timelineUpdates.length,firstSeq:timelineUpdates[0].snapshotSeq,lastSeq:timelineUpdates.at(-1).snapshotSeq};
  assert.deepEqual(capture.errors,[]);assert.ok(capture.frames.length>=20);
  const stable=capture.frames.filter(frame=>frame.sceneId===first.sceneId);const fixed=stable[0];for(const f of stable){assert.deepEqual(f.fit,fixed.fit);assert.deepEqual(f.view,fixed.view);assert.deepEqual(f.viewport,fixed.viewport);assert.deepEqual(f.refs,fixed.refs);assert.ok(f.opaque>600&&f.colors>8,'每次实际呈现均为完整非空场景');}
  const moving=stable.filter(frame=>['right','diagonal','down-only'].includes(frame.phase)&&frame.self?.moving);assert.ok(moving.length>=10);
  assert.ok(assertPaintContinuity(capture).length>=10,'每次实际paint均保留并按其motionAt检查连续速度');
  const acceptedCoverage=direction=>{
    const row=report.wireActions.filter(value=>{
      if(value.receipt?.status!=='Accepted'||actionsBefore.includes(value.receipt.clientActionId))return false;
      const action=JSON.parse(value.raw).action;
      return action.kind==='move_direction'&&action.direction===direction;
    }).at(0);
    assert.ok(row?.receipt?.observedSeq!==undefined,`缺少 ${direction} Accepted 覆盖线`);
    return BigInt(row.receipt.observedSeq);
  };
  const anchoredWindow=(frames,phase,facing,coverage,label)=>{
    const applied=frames.filter(frame=>frame.phase===phase&&frame.self?.facing===facing
      &&BigInt(frame.paint?.snapshotSeq??frame.snapshotSeq)>=coverage);
    const anchor=applied[0];
    assert.ok(anchor,`${label} 未观察到实际应用 ${facing} 的帧`);
    assert.ok(applied.length>=3,`${label} 锚后窗证据不足：${applied.length} 帧`);
    report.motionWindows={...(report.motionWindows??{}),[label]:{anchorAt:anchor.at,anchorSeq:anchor.snapshotSeq,frames:applied.length,spanMs:applied.at(-1).at-anchor.at}};
    return applied;
  };
  const diagonal=anchoredWindow(stable,'diagonal','SE',acceptedCoverage('SE'),'diagonal'),vertical=anchoredWindow(stable,'down-only','S',acceptedCoverage('S'),'down-only');assert.ok(diagonal.at(-1).self.position.x>diagonal[0].self.position.x&&diagonal.at(-1).self.position.y>diagonal[0].self.position.y);assert.ok(vertical.at(-1).self.position.y>vertical[0].self.position.y+10);assert.ok(Math.abs(vertical.at(-1).self.position.x-vertical[0].self.position.x)<4,'松开右键后仍沿下键行走');
  assert.equal(report.httpAssets.length,assetsBefore,'移动不重新请求图片');const movementActions=(await actions()).filter(action=>!actionsBefore.includes(action.id)).map(action=>JSON.parse(action.raw).action);assert.ok(movementActions.length<=Math.ceil((Date.now()-start)/100)+3,'按键repeat不形成额外请求洪峰');assert.equal(movementActions.at(-1).kind,'stop_move');
  const directional=movementActions.filter(action=>action.kind!=='stop_move');assert.ok(directional.length>0);assert.ok(directional.every(action=>action.kind==='move_direction'&&action.sceneId===initial.projection.self.sceneId&&action.mapVersion===initial.projection.mapVersion));
  assert.deepEqual(directional.map(action=>action.direction).filter((value,index,array)=>index===0||value!==array[index-1]),['E','SE','S']);
  const acceptedDirections=report.wireActions.filter(row=>row.receipt.status==='Accepted'&&!actionsBefore.includes(row.receipt.clientActionId)).map(row=>JSON.parse(row.raw).action).filter(action=>action.kind==='move_direction');
  for(const direction of ['E','SE','S'])assert.ok(acceptedDirections.some(action=>action.direction===direction),'本阶段必须真实Accepted方向 '+direction);
  const stopped=await position();await sleep(300);assert.deepEqual(await position(),stopped);check('AC02','真实Canvas每帧完整合成、固定fit、实体不因走动消失且图片缓存复用',{frames:capture.frames.length});
  await sleep(120);const shortStart=await position(),shortIds=(await actions()).map(action=>action.id);
  if(directionSubmissions){
    const movementDrafts=(await actions()).filter(action=>!actionsBefore.includes(action.id)),movementRequests=movementDrafts.map(draft=>JSON.parse(draft.raw)),stopReceipt=movementDrafts.at(-1).receipt;
    if(scenario==='five-person')await until(async()=>{const readers=await Promise.all(room.pages.map(p=>p.evaluate(()=>window.uxDirection.read())));return readers.every(reader=>reader.applications.some(row=>row.result==='applied'&&BigInt(row.after)>=BigInt(stopReceipt.observedSeq)&&row.person?.moving===false));},'五个真实页面实际应用终止前缀');
    report.directionClients=await Promise.all(room.pages.map(p=>p.evaluate(()=>window.uxDirection.read())));report.directionServer=directionSubmissions.read();assert.deepEqual(report.directionServer.errors,[],'只读供给观察不得丢失证据');
    for(let index=0;index<room.pages.length;index++){const current=await directionConnections.qualify(room.pages[index],room.users[index].userId,'after-motion-'+index),initial=report.directionQualification[index];for(const key of ['connectionId','viewId','controlEpoch'])assert.equal(current[key],initial[key],'运动期间保留同一实际安装绑定');report.directionQualification.push(current);}
    if(scenario==='late-accepted-se-180'){
      report.lateAcceptance=await collectAcceptedLateEvidence(database.pool,directionSubmissions,report.directionClients[0],movementRequests);
      report.lateSummary=assertAcceptedLateEvidence(report.lateAcceptance);check('AC05-late','原Accepted双轴SE的180ms迟到ACK跨DOWN，新S抢先Accepted且不复活旧轴',report.lateSummary);
    }else{
      report.fiveSupply=assertFivePersonSupply({readers:report.directionClients,sends:report.directionServer.sends,stop:stopReceipt,finalPosition:await position()});check('AC05-five','五个当前新模式读者真实连续应用主运动者及终止前缀',report.fiveSupply);
    }
  }
  const beforeShort=await server.runtime.replay(room.sessionId),shortActorId=beforeShort.members.find(member=>member.userId===room.users[0].userId).characterId,shortActor=beforeShort.characters[shortActorId];
  const shortAuthority={actorId:shortActorId,position:{...shortActor.position},controlEpoch:shortActor.controlEpoch,sceneId:shortActor.sceneId,mapVersion:beforeShort.mapVersion,movementStatus:shortActor.movement?.status??null};
  await page.keyboard.down('ArrowRight');await sleep(20);await page.keyboard.up('ArrowRight');await waitSettled();
  const shortDrafts=(await actions()).filter(action=>!shortIds.includes(action.id)),short=shortDrafts.map(action=>JSON.parse(action.raw).action);assert.deepEqual(short.map(action=>action.kind),['move_direction','stop_move']);assert.ok(BigInt(short[1].movementCommandSeq)>BigInt(short[0].movementCommandSeq));const shortEnd=await position();assert.ok(Math.hypot(shortEnd.x-shortStart.x,shortEnd.y-shortStart.y)<=36);
  const afterShort=(await server.runtime.replay(room.sessionId)).characters[shortActorId];
  report.shortDirection=await assertShortDirectionPlan(database.pool,shortDrafts,{sessionId:room.sessionId,before:shortAuthority,clientStart:shortStart,clientEnd:shortEnd,after:{position:{...afterShort.position},controlEpoch:afterShort.controlEpoch}});
  return {short,movementActions};
}

async function run(){
  assert.equal(report.source.status,'','浏览器证据必须对应干净冻结候选');
  database=await startTestPostgres('client-experience',{outputSubdirectory:'ux-c-browser'});server=await createAuthorityServer({pool:database.pool,spatialDirection:{checkpointMs:50}});
  directionConnections=observeDirectionConnections(server.runtime);
  const submit=server.runtime.submit.bind(server.runtime);
  server.runtime.submit=async function(...args){const raw=args[1],request=JSON.parse(raw),receipt=await Reflect.apply(submit,this,args);report.wireActions.push({receivedAt:Date.now(),raw,receipt});if(fault&&!fault.request&&request.action.kind==='stop_move'){fault.request=request;fault.raw=raw;fault.receipt=receipt;return {schemaVersion:2,code:'OUTCOME_UNKNOWN',message:'受控传输故障：停步已提交，确认未送达。'};}return receipt;};
  if(scenario!=='normal')directionSubmissions=observeDirectionSubmissions(server.runtime,{late:scenario==='late-accepted-se-180'});
  const origin=`http://127.0.0.1:${(await server.listen(0)).port}`;
  vite=await createVite({root:resolve(repository,'frontend'),configFile:resolve(repository,'frontend/vite.config.mjs'),configLoader:'native',cacheDir:resolve(output,'vite-cache'),define:{'import.meta.env.VITE_GAOLAO_CONTENT_VERSION':JSON.stringify(report.contentVersion)},server:{host:'127.0.0.1',port:0,fs:{allow:[repository]},proxy:{'/api':{target:origin},'/socket.io':{target:origin,ws:true}}}});await vite.listen();
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:process.env.CHROMIUM_ARGS?JSON.parse(process.env.CHROMIUM_ARGS):[]});report.environment={node:process.version,chromium:browser.version(),dpr:1};
  let index=0;const instrumented={async newContext(options){const owner=index++===0,context=await browser.newContext({...options,...(owner?{recordVideo:{dir:resolve(output,'video-work'),size:{width:1280,height:800}}}:{})});if(owner)context.on('page',p=>{video=p.video();p.on('request',request=>{const path=new URL(request.url()).pathname;if(path.startsWith('/assets/gaolaozhuang/'))report.httpAssets.push(path);});});return context;}};
  room=await browserRoom({server,browser:instrumented,baseURL:`http://127.0.0.1:${vite.httpServer.address().port}`,count,contentVersion:report.contentVersion,profile:'production-cuilan-v1',report,beforeSession:async(page,index)=>{if(index===0)await installPresentationObservation(page);if(scenario!=='normal')await installDirectionObservation(page);}});page=room.pages[0];
  report.directionQualification=[];
  for(let index=0;index<room.pages.length;index++)report.directionQualification.push(await directionConnections.qualify(room.pages[index],room.users[index].userId,'initial-'+index));
  await page.evaluate(async()=>{window.uxSpatial=await import('/src/state/spatial-store.ts');});
  const initial=await snapshot(page);assert.equal(initial.projection.contentVersion,report.contentVersion);assert.equal(initial.projection.reducerVersion,'gaolao-world-v2');assert.ok(initial.projection.sceneOverview);assert.equal(initial.projection.mapCatalog.length,2);
  await until(async()=>{const f=await canvasFrame(page);return f.layerStatus==='ready'&&f.resources.every(resource=>resource.status==='ready');},'正式场景和当前人物资源预解码完成');
  const first=await canvasFrame(page);assert.deepEqual(drawRefs(first),sceneRefs(initial.projection));assert.deepEqual(first.view,{x:0,y:0,width:initial.projection.scene.width,height:initial.projection.scene.height});
  const pixels=await canvasPixels(page);assert.ok(initial.projection.sceneOverview.entities.length+initial.projection.sceneOverview.targets.length>initial.projection.entities.length+initial.projection.targets.length,'正式样本含远处/隔墙公共对象');
  check('AC01','scene-v3正式入口同场公开对象完整绘制，真实感知仍保留范围',{drawn:drawRefs(first).length,pixels});
  assert.ok((await page.getByTestId('gaolao-goal').innerText()).trim());assert.ok((await page.getByTestId('gaolao-next-step').innerText()).trim());
  const guide=page.locator('.gaolao-guide-action');assert.equal(await guide.count(),1);const guideLabel=await guide.innerText();await guide.click();
  await until(async()=>Boolean((await clientState(page)).navigation)||await page.locator('.spatial-sidebar').isVisible(),'下一步有真实定位或查看入口');if((await clientState(page)).navigation)await stop();
  const closeObjects=page.getByRole('button',{name:'关闭对象区',exact:true});if(await closeObjects.isVisible())await closeObjects.click();await closeReading(page);
  check('AC06','共同目标、下一步和可操作定位入口可见',{guideLabel});
  for(const name of ['行囊','手记','交谈','队伍','回看'])assert.equal(await page.locator('.spatial-tool-dock').getByRole('button',{name,exact:true}).count(),1);
  assert.equal(await page.locator('.spatial-follow-strip,.gaolao-party-strip,.spatial-current-objective').count(),0);assert.equal(await page.getByTestId('movement-status').count(),1);
  const beforePanel=await canvasFrame(page);await openReading(page,'手记');assert.deepEqual((await canvasFrame(page)).fit,beforePanel.fit);await closeReading(page);assert.deepEqual((await canvasFrame(page)).fit,beforePanel.fit);check('AC04','单一工具与状态入口，阅读面板开合不改变主场景');
  const {short,movementActions}=await exerciseMotion(initial,first);
  if(scenario!=='normal'){report.aiRunCount=Number((await database.pool.query('SELECT count(*) n FROM ai_runs WHERE session_id=$1',[room.sessionId])).rows[0].n);assert.equal(report.aiRunCount,0);assert.deepEqual(report.pageErrors,[]);report.assessment='PASS';return;}
  await sleep(120);await page.keyboard.down('ArrowLeft');await sleep(180);await page.getByLabel('地图目的地',{exact:true}).focus();await page.keyboard.up('ArrowLeft');await waitSettled();const blurPosition=await position();await sleep(250);assert.deepEqual(await position(),blurPosition);const panelCount=(await actions()).length;await page.keyboard.press('ArrowRight');await sleep(130);assert.equal((await actions()).length,panelCount,'地图select独占方向键');
  await openReading(page,'交谈');await page.getByLabel('交谈内容',{exact:true}).fill('键盘范围检查');await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowRight');assert.equal((await actions()).length,panelCount,'文本输入不驱动世界移动');await closeReading(page);
  check('AC05','持续持键、组合与松单键、短按停步、失焦与面板/文本输入隔离',{short,movementActions:movementActions.length});
  // 真实提交后把一次ACK改为未知；原收据仍由真实HTTP查询取回，不伪造世界状态。
  fault={};await page.getByTestId('spatial-map').focus();await page.keyboard.down('ArrowLeft');await sleep(40);await page.keyboard.up('ArrowLeft');await until(async()=>fault.request&&(await actions()).some(action=>action.id===fault.request.clientActionId&&action.status==='unknown'),'停步真实提交后结果未知');
  const pendingId=fault.request.clientActionId,wireCount=report.wireActions.length;await page.keyboard.down('ArrowRight');await sleep(250);await page.keyboard.up('ArrowRight');assert.equal(report.wireActions.length,wireCount,'未知stop不续发新方向');assert.match(await page.getByTestId('gaolao-next-step').innerText(),/确认/);await page.getByRole('button',{name:'查询待确认动作',exact:true}).click();await page.locator(`[data-action-id="${pendingId}"]`).getByRole('button',{name:'查询结果',exact:true}).click();await until(async()=>(await actions()).find(action=>action.id===pendingId)?.status==='accepted','原停步收据实际HTTP查询完成');assert.equal((await actions()).find(action=>action.id===pendingId).raw,fault.raw);assert.equal(Number((await database.pool.query('SELECT count(*) n FROM action_receipts WHERE session_id=$1 AND client_action_id=$2',[room.sessionId,pendingId])).rows[0].n),1);report.unknownRecovery={raw:fault.raw,receipt:fault.receipt,worldEffects:1};fault=null;await page.getByRole('button',{name:'关闭动作确认',exact:true}).click();check('AC05-recovery','未知停步冻结续发，查询原身份恢复且世界效果一次');
  const map=page.locator('.gaolao-map-navigator'),beforeMap=(await actions()).map(action=>action.id);await map.getByRole('button',{name:'全部',exact:true}).click();assert.equal(await page.getByTestId('gaolao-minimap').getAttribute('data-map-mode'),'all');await page.getByLabel('查看地图场景',{exact:true}).selectOption('gaolao-village-road');await page.getByLabel('地图目的地',{exact:true}).selectOption('R03');await sleep(100);assert.deepEqual((await actions()).map(action=>action.id),beforeMap,'仅选择远场与地点不移动');assert.doesNotMatch(await map.innerText(),/本人包裹|乔装|样例|脚底/);
  await map.getByRole('button',{name:'沿出口前往',exact:true}).click();await until(async()=>{const p=(await snapshot(page)).projection;return p.self.sceneId==='gaolao-village-road'&&p.self.position.x===700&&p.self.position.y===415&&!(await clientState(page)).navigation;},'沿真实出口到达远场地点且视觉确认完成',30000);
  const route=(await actions()).filter(action=>!beforeMap.includes(action.id)).map(action=>JSON.parse(action.raw).action);assert.deepEqual(route.map(action=>action.kind),['move_to','move_to','move_to']);assert.deepEqual(route.map(action=>action.sceneId),['gaolao-courtyard','gaolao-village-road','gaolao-village-road']);assert.deepEqual(route[0].destination,{x:1425,y:880});assert.deepEqual(route[1].destination,{x:850,y:900});assert.deepEqual(route[2].destination,{x:700,y:415});
  const arrived=await snapshot(page);assert.deepEqual(drawRefs(await canvasFrame(page)),sceneRefs(arrived.projection));await picture('scene-v3-map-route.png');
  await page.getByLabel('查看地图场景',{exact:true}).selectOption('gaolao-courtyard');await page.getByLabel('地图目的地',{exact:true}).selectOption('C19');await map.getByRole('button',{name:'沿出口前往',exact:true}).click();await stop();const cancelCount=(await actions()).length;await sleep(500);assert.equal((await clientState(page)).navigation,null);assert.equal((await actions()).length,cancelCount,'手动停步取消后续crossing');
  const current=await currentMapPoint({x:740,y:435});await until(async()=>{const p=(await snapshot(page)).projection;return p.movement?.movementCommandSeq===JSON.parse(current.draft.raw).action.movementCommandSeq&&p.movement.status==='arrived'&&p.self.position.x===current.destination.x&&p.self.position.y===current.destination.y;},'当前地图实际点选并行走到达');check('AC03','当前/全部地图、只选不走、合法出口三段前往、手动取消',{route,currentDestination:current.destination});
  const oldEpoch=(await snapshot(page)).projection.self.controlEpoch;await page.reload();await page.getByRole('button',{name:'恢复本人控制',exact:true}).click();await until(async()=>{const state=await clientState(page);return state.inputReady&&state.directionInput.ready;},'刷新后控制源与方向输入均已就绪');assert.ok(BigInt((await snapshot(page)).projection.self.controlEpoch)>BigInt(oldEpoch));
  report.directionQualification.push(await directionConnections.qualify(page,room.users[0].userId,'reload'));
  const recoveryIds=(await actions()).map(action=>action.id);await page.getByTestId('spatial-map').focus();await page.keyboard.down('ArrowRight');await sleep(80);await page.keyboard.up('ArrowRight');await waitSettled();
  const recoveredActions=(await actions()).filter(action=>!recoveryIds.includes(action.id));assert.ok(recoveredActions.some(draft=>JSON.parse(draft.raw).action.kind==='move_direction'&&draft.receipt?.status==='Accepted'));assert.equal(JSON.parse(recoveredActions.at(-1).raw).action.kind,'stop_move');check('AC03-recovery','刷新重新建立控制周期且旧导航不复活');
  await page.setViewportSize({width:390,height:844});await until(async()=>{const frame=await canvasFrame(page);return frame.viewport.width<390;},'窄屏真实Canvas完成resize');report.narrow={pixels:await canvasPixels(page),...await page.evaluate(()=>({viewport:innerWidth,content:document.documentElement.scrollWidth}))};assert.ok(report.narrow.content<=report.narrow.viewport);await map.getByRole('button',{name:'展开地图',exact:true}).click();assert.equal(await page.getByTestId('gaolao-minimap').isVisible(),true);await openReading(page,'行囊');assert.equal(await page.getByTestId('gaolao-minimap').count(),0,'窄屏阅读区与展开地图互斥');await page.locator('#spatial-reading-pane').waitFor();await picture('scene-v3-narrow.png');await closeReading(page);
  report.aiRunCount=Number((await database.pool.query('SELECT count(*) n FROM ai_runs WHERE session_id=$1',[room.sessionId])).rows[0].n);assert.equal(report.aiRunCount,0);assert.deepEqual(report.pageErrors,[]);assert.deepEqual(new Set(report.checks.map(value=>value.id)),new Set(['AC01','AC02','AC03','AC04','AC05','AC06','AC05-recovery','AC03-recovery']));report.assessment='PASS';
}
try{await run();} catch(error){report.assessment=/Operation not permitted|Failed to launch|Executable doesn't exist/.test(error.message)?'ENVIRONMENT_BLOCKED':'FAIL';report.error=error.stack;console.error(error.stack);if(page)await picture('scene-v3-failure.png').catch(()=>{});process.exitCode=1;}
finally {
  if(page){const interrupted=await page.evaluate(()=>{const capture=window.uxCapture;if(!capture)return null;capture.running=false;capture.restore?.();return {frames:capture.frames,paints:capture.paints,updates:capture.updates,errors:capture.errors};}).catch(()=>null);if(interrupted&&!report.motion)report.motion=interrupted;const presentation=await page.evaluate(()=>window.uxPresentation?.stop()).catch(()=>null);if(presentation&&!report.presentation)report.presentation=presentation;}
  if(directionSubmissions){report.directionServer=directionSubmissions.read();report.directionClientsFinal=await Promise.all((room?.pages??[]).map(p=>p.evaluate(()=>window.uxDirection?.stop()).catch(error=>({error:error.message}))));directionSubmissions.close();}
  directionConnections?.close();
  await saveJSON(resolve(output,'result-before-cleanup.json'),report);
  for(const [name,close] of [['room',()=>room?.close()],['browser',()=>browser?.close()],['vite',()=>vite?.close()],['server',()=>server?.close()],['postgres',()=>database?.stop()]]){try{await close();report.cleanup.push({name,status:'closed'});if(name==='room'&&video){try{await video.saveAs(resolve(output,'scene-v3-demo.webm'));report.video={file:'scene-v3-demo.webm',scope:'本次同一真实页面操作录像；不代替测试断言或真人验收'};}catch(error){report.videoError=error.message;}}}catch(error){report.cleanup.push({name,status:'error',message:error.message});if(report.assessment==='PASS')report.assessment='FAIL_CLEANUP';process.exitCode=1;}}
  report.finishedAt=new Date().toISOString();report.sourceEnd=await sourceIdentity();if(JSON.stringify(report.sourceEnd)!==JSON.stringify(report.source)){report.sourceChanged=true;if(report.assessment==='PASS')report.assessment='FAIL_SOURCE_IDENTITY';process.exitCode=1;}await saveJSON(resolve(output,'result.json'),report);writeSync(1,JSON.stringify({assessment:report.assessment,checks:report.checks.length,output})+'\n');if(process.exitCode&&process.exitCode!==0)process.exit(process.exitCode);
}
