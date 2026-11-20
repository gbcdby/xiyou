// #66 固定完整背景像素夹具；保留原8对/16次renderer调用，计量不进入此门槛。
import { SpatialCanvas as BaselineCanvas, readCanvasFrame as readA } from '/src/rendering/__background-raster-baseline.ts';
import { SpatialCanvas as CandidateCanvas, readCanvasFrame as readB } from '/src/rendering/spatial-canvas.ts';
import { CanvasAssets } from '/src/rendering/canvas-assets.ts';
import { ConfirmedMotion } from '/src/domain/spatial-motion.ts';
import { sceneLayerCatalog } from '/src/domain/gaolao-scene-layers.ts';
import { screenPoint } from '/src/domain/spatial-canvas-geometry.ts';
import { spatialSnapshot } from './spatial-fixture.mjs';
import input from './fixtures/background-raster/matrix.json';

const ensure=(v,message)=>{if(!v)throw new Error(message);};
const same=(a,b,message)=>ensure(JSON.stringify(a)===JSON.stringify(b),message);
const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
const jsonSha=value=>sha(new TextEncoder().encode(JSON.stringify(value)));
const ctx=canvas=>{const c=canvas.getContext('2d');ensure(c,'必须建立默认2D context');return c;};
const format=c=>c.getContextAttributes();
const mv=m=>['a','b','c','d','e','f'].map(k=>m[k]);
const isCanvas=v=>v instanceof HTMLCanvasElement;
const active=set=>[...set].filter(c=>c.width>0&&c.height>0);
const release=c=>{c.width=0;c.height=0;c.remove();};
const surfaces=new Set(), renderers=new Set(), failures=[];
const report={classification:input.scope,assessment:'NOT_RUN',pixelRows:[],pixelPairs:0,errors:[],cleanup:[],qualification:{},pixelRendererPaintCalls:0,limits:input.limits};
let started=false, cancelled=false, deadline=Infinity;
const check=()=>{ensure(!cancelled,'隔离检查已取消');ensure(performance.now()<deadline,'超过65秒主体预算');};
function canvas(width=1,height=1){const c=document.createElement('canvas');c.width=width;c.height=height;surfaces.add(c);ensure(surfaces.size<=256,'临时Canvas计数超限');return c;}
function fixture(sceneId,state,ordinal=0){
  const value=spatialSnapshot(),p=value.projection,s=input.rendererCases[state];
  Object.assign(p,{contentVersion:'gaolaozhuang-scene-v2',chapterVersion:'gaolao-v1',mapVersion:'gaolao-layout-v1.1',reducerVersion:'gaolao-world-v2',variantId:'two',sceneTimeMs:1000+ordinal*50});value.snapshotSeq=String(10+ordinal);
  Object.assign(p.scene,{sceneId,name:'base隔离技术夹具',width:1600,height:1000,walkableAreas:[{areaId:'ground',polygon:[{x:0,y:0},{x:1600,y:0},{x:1600,y:1000},{x:0,y:1000}]}]});
  Object.assign(p.self,{sceneId,position:{...s.self},appearanceId:'gaocai'});p.entities=[{entityRef:p.self.entityRef,name:p.self.name,appearanceEpoch:p.self.appearanceEpoch,appearanceId:'gaocai',sceneId,position:{...s.self},facing:'S'}];
  const item=sceneId==='gaolao-courtyard'?'cloth-parcel':'farm-rake';
  p.items=[{entityRef:'item_0000000000000000000000000000000',name:'受控物件',visualKey:item,location:{kind:'ground',sceneId,position:{...s.parcel}},resourceRevision:'0',transferable:false,publicBorrowable:false,fields:[]}];
  p.targets=sceneId==='gaolao-courtyard'?[{entityRef:'door_0000000000000000000000000000000',name:'受控门',visualKey:'timber-door',sceneId,position:{x:1250,y:425},resourceRevision:'0',availableOperations:[],fields:[{key:'open',label:'后宅开放',value:s.open}]}]:[];
  return value;
}
const selected=(snapshot,state)=>state?snapshot.projection.self.entityRef:snapshot.projection.items[0].entityRef;
function createArm(arm,assets,geometry){
  const front=canvas(),made=[],original=Document.prototype.createElement;let renderer;
  Document.prototype.createElement=function(...args){const value=Reflect.apply(original,this,args);if(isCanvas(value)){made.push(value);surfaces.add(value);}return value;};
  try {renderer=new (arm==='A'?BaselineCanvas:CandidateCanvas)(front,assets);} finally {Document.prototype.createElement=original;}
  ensure(made.length===1,'原renderer构造仅创建buffer');renderer.resize(geometry.width,geometry.height,geometry.dpr);front.style.width=geometry.width+'px';front.style.height=geometry.height+'px';renderers.add(renderer);
  return {arm,renderer,front,buffer:made[0],motion:new ConfirmedMotion(),read:arm==='A'?readA:readB,ordinal:0};
}
function closeArm(v){v.renderer.dispose();renderers.delete(v.renderer);release(v.front);release(v.buffer);}
function pair(assets,geometry){return {A:createArm('A',assets,geometry),B:createArm('B',assets,geometry)};}
function closePair(p){closeArm(p.A);closeArm(p.B);}
async function ready(assets,paths,label){const start=performance.now();while(!assets.ready(paths)){check();ensure(performance.now()-start<20000,label+'超过20秒加载预算');ensure(assets.failed(paths).length===0,label+'有原图failed');await new Promise(resolve=>setTimeout(resolve,10));}ensure(performance.now()-start<20000,label+'完成时超过20秒加载预算');}
function frameBrief(frame,snapshot){return {snapshotSeq:snapshot.snapshotSeq,serial:frame.serial,instance:frame.instance,sceneId:frame.sceneId,viewport:frame.viewport,fit:frame.fit,layerStatus:frame.layerStatus,base:frame.sceneImages.find(v=>v.kind==='base'),actors:frame.actors.map(v=>({ref:v.ref,position:v.position,facing:v.facing,moving:v.moving,distance:v.distance,art:v.art}))};}
function trace(fn){
  const proto=CanvasRenderingContext2D.prototype,names=['drawImage','fillRect','clearRect','setTransform','translate','scale','clip'],originals=Object.fromEntries(names.map(n=>[n,proto[n]])),create=Document.prototype.createElement,calls=[],allocations=[];
  for(const name of names)proto[name]=function(...args){ensure(calls.length<1024,'单paint观测超过1024条');calls.push({name,target:this.canvas,source:name==='drawImage'?args[0]:null,args:name==='drawImage'?args.slice(1):args,matrix:name==='drawImage'?mv(this.getTransform()):null,fillStyle:name==='fillRect'?this.fillStyle:null});return Reflect.apply(originals[name],this,args);};
  Document.prototype.createElement=function(...args){const value=Reflect.apply(create,this,args);if(isCanvas(value)){allocations.push(value);surfaces.add(value);ensure(surfaces.size<=256,'临时Canvas计数超限');}return value;};
  try{return {value:fn(calls),calls,allocations};}finally{for(const name of names)proto[name]=originals[name];Document.prototype.createElement=create;}
}
async function compare(id,a,b,extra={}){
  check();same([a.width,a.height],[b.width,b.height],'完整backing一致');const left=ctx(a).getImageData(0,0,a.width,a.height).data,right=ctx(b).getImageData(0,0,b.width,b.height).data;
  let differentBytes=0,differentPixels=0,maximumDifference=0;const first=[];
  for(let i=0;i<left.length;i+=4){let mismatch=false;for(let k=0;k<4;k++)if(left[i+k]!==right[i+k]){differentBytes++;mismatch=true;maximumDifference=Math.max(maximumDifference,Math.abs(left[i+k]-right[i+k]));}if(mismatch){differentPixels++;if(first.length<12)first.push({x:(i/4)%a.width,y:Math.floor(i/4/a.width),A:[...left.slice(i,i+4)],B:[...right.slice(i,i+4)]});}}
  const row={id,...extra,width:a.width,height:a.height,comparedBytes:left.length,differentBytes,differentPixels,maximumDifference,first,A:await sha(left),B:await sha(right),status:differentBytes===0?'PASS':'FAIL'};report.pixelRows.push(row);report.pixelPairs++;
  if(differentBytes){if(!failures.length)failures.push({id,A:a.toDataURL('image/png'),B:b.toDataURL('image/png')});throw new Error(id+'：严格RGBA出现差异，停止候选资格');}return row;
}

function backgroundObservation(t,v,baseImage,sets,expected,geometry){
  for(const c of t.calls.filter(c=>c.name==='drawImage')){
    if(c.source===v.buffer&&c.target!==v.front)sets.background.add(c.target);
    if(c.source instanceof HTMLImageElement&&input.objectPaths.includes(new URL(c.source.currentSrc||c.source.src,location.href).pathname)&&c.target!==v.buffer&&c.target!==v.front)sets.scratch.add(c.target);
    if(sets.scratch.has(c.source)&&c.target!==v.buffer&&c.target!==v.front)sets.tiles.add(c.target);
  }
  const backgrounds=active(sets.background),scratch=active(sets.scratch),tiles=active(sets.tiles);
  ensure(backgrounds.length<=1&&backgrounds.every(c=>c.width*c.height<=4194304),'完整背景单图4Mi预算');
  ensure(scratch.length<=1&&scratch.every(c=>c.width*c.height<=4194304),'对象原scratch预算');
  ensure(tiles.length<=32&&tiles.every(c=>c.width*c.height<=262144)&&tiles.reduce((sum,c)=>sum+c.width*c.height,0)<=1048576,'对象原tile预算');
  ensure(backgrounds.every(c=>!sets.scratch.has(c)&&!sets.tiles.has(c)),'两缓存资源身份互斥');
  const captures=t.calls.filter(c=>c.name==='drawImage'&&c.source===v.buffer&&sets.background.has(c.target));
  const restores=t.calls.filter(c=>c.name==='drawImage'&&sets.background.has(c.source)&&c.target===v.buffer);
  const imageToBuffer=t.calls.filter(c=>c.name==='drawImage'&&c.source===baseImage&&c.target===v.buffer);
  const imageToCache=t.calls.filter(c=>c.name==='drawImage'&&c.source instanceof HTMLImageElement&&sets.background.has(c.target));
  const cacheOps=t.calls.filter(c=>sets.background.has(c.target));
  const papers=t.calls.filter(c=>c.name==='fillRect'&&c.target===v.buffer&&c.fillStyle==='#eee3cb'&&JSON.stringify(c.args)===JSON.stringify([0,0,geometry.width,geometry.height]));
  const firstClip=t.calls.findIndex(c=>c.name==='clip'&&c.target===v.buffer);
  ensure(imageToCache.length===0,'不得在新背景缓存中重新采样Image');
  for(const c of captures){same(c.args,[0,0],'完整原buffer捕获');same(c.matrix,[1,0,0,1,0,0],'捕获identity');}
  for(const c of restores){same(c.args,[0,0],'完整背景恢复');same(c.matrix,[1,0,0,1,0,0],'恢复identity');ensure(t.calls.indexOf(c)<firstClip,'恢复必须在原scene clip之前');}
  if(expected==='miss'){
    ensure(backgrounds.length===1&&captures.length===1&&restores.length===0&&imageToBuffer.length===1&&papers.length===1,'miss完整保留原paper/base并捕获原buffer');
    ensure(t.calls.indexOf(imageToBuffer[0])<t.calls.indexOf(captures[0]),'捕获在原base完成之后');
    const laterImages=t.calls.filter(c=>c.name==='drawImage'&&c.target===v.buffer&&c.source instanceof HTMLImageElement&&c.source!==baseImage);
    ensure(laterImages.every(c=>t.calls.indexOf(c)>t.calls.indexOf(captures[0])),'捕获在其它scene图/actor原图之前');
  }else if(expected==='hit'){
    ensure(backgrounds.length===1&&captures.length===0&&restores.length===1&&imageToBuffer.length===0&&papers.length===0,'hit只恢复已有完整背景');
    ensure(cacheOps.length===0&&!t.allocations.some(c=>sets.background.has(c)),'hit零缓存操作/分配');
  }else{
    ensure(expected==='fallback'&&backgrounds.length===0&&captures.length===0&&restores.length===0&&imageToBuffer.length===1&&papers.length===1,'不完整覆盖必须真实原路径，不能假称cache通过');
  }
  return {expected,qualificationReason:expected==='fallback'?'ORIGINAL_PAPER_DOES_NOT_COVER_WHOLE_BACKING':'COMPLETE_PAPER_COVERAGE',originalBaseDraws:imageToBuffer.length,sourceImagesToCache:imageToCache.length,bufferCaptures:captures.length,backgroundRestores:restores.length,paperFills:papers.length,cacheOps:cacheOps.length,backgroundPixels:backgrounds.reduce((sum,c)=>sum+c.width*c.height,0),objectScratchPixels:scratch.reduce((sum,c)=>sum+c.width*c.height,0),objectTiles:tiles.length,objectTilePixels:tiles.reduce((sum,c)=>sum+c.width*c.height,0)};
}
function pixelPaint(v,snapshot,options){report.pixelRendererPaintCalls++;ensure(report.pixelRendererPaintCalls<=16,'像素阶段renderer调用超出16次固定上限');return v.renderer.paint(snapshot,v.motion,0,options);}
async function paintPair(id,p,assets,snapshot,state,sets,expected,geometry){
  check();const before={A:p.A.read(p.A.front),B:p.B.read(p.B.front)},traces={};let boundaries=0;
  for(const arm of ['A','B']){
    const v=p[arm];v.renderer.prepare(snapshot);v.motion.update(snapshot,0);
    traces[arm]=trace(calls=>pixelPaint(v,snapshot,{selected:selected(snapshot,state),reducedMotion:true,beforeFrontWrite(){boundaries++;ensure(calls.filter(c=>c.name==='drawImage'&&c.target===v.front).length===0,'封口前无front写');same(v.read(v.front),before[arm],'封口前frame仍为旧值');}}));
    const front=traces[arm].calls.filter(c=>c.name==='drawImage'&&c.target===v.front);ensure(front.length===1&&front[0].source===v.buffer,'原唯一完整front copy');same(front[0].args,[0,0],'原front提交参数');same(front[0].matrix,[1,0,0,1,0,0],'原front identity');
  }
  const fa=traces.A.value,fb=traces.B.value;same(fa,fb,'完整frame metadata相等');ensure(boundaries===2,'每边恰好一次封口');
  const baseImage=assets.image(sceneLayerCatalog[snapshot.projection.scene.sceneId].base.file),observation=backgroundObservation(traces.B,p.B,baseImage,sets,expected,geometry);
  const hits=[];for(const object of fa.objects)for(const [x,y] of [[0,0],[.25,.25],[.5,.5],[.75,.75],[1,1]]){const point=screenPoint({x:object.position.x+object.bounds.x+x*object.bounds.width,y:object.position.y+object.bounds.y+y*object.bounds.height},fa.fit),a=p.A.renderer.hit(point),b=p.B.renderer.hit(point);same(a,b,'原alpha hit相等');hits.push({point,A:a,B:b});}
  await compare(id,p.A.front,p.B.front,{category:'full-renderer-background-capture',frame:frameBrief(fa,snapshot),frameHash:await jsonSha(fa),sceneImages:fa.sceneImages,hits,observation,frontWrites:[1,1]});
}
const sets=()=>({background:new Set(),scratch:new Set(),tiles:new Set()});
async function rendererPixels(assets){
  const geometries=input.geometries;
  report.qualification.pixelGeometryClasses=geometries.map(g=>({id:g.id,width:g.width,height:g.height,dpr:g.dpr,expected:g.id==='G1'||g.id==='G4'?'CAPTURE_AND_HIT':'ORIGINAL_FALLBACK'}));
  for(const g of geometries){const p=pair(assets,g),resources=sets();try{
    for(const [ordinal,state,phase] of [[0,0,'first'],[1,1,'repeat']]){
      const expected=g.expected[ordinal];
      await paintPair(`gaolao-courtyard-${g.id}-${phase}`,p,assets,fixture('gaolao-courtyard',state,ordinal),state,resources,expected,g);
    }
  }finally{closePair(p);ensure(active(resources.background).length===0&&active(resources.scratch).length===0&&active(resources.tiles).length===0,'每组renderer派生缓存释放');}}
}
function dispose(){cancelled=true;for(const renderer of renderers)renderer.dispose();renderers.clear();for(const c of surfaces)release(c);document.querySelector('#stage')?.replaceChildren();}
async function run(){
  ensure(!started,'此页面入口只能执行一次');started=true;deadline=performance.now()+input.limits.bodyMs;report.startedAt=performance.now();const assets=new CanvasAssets();
  try{
    report.phase='load';const paths=Object.keys(input.assets);ensure(paths.length===63&&paths.length<=65,'原63 PNG allowlist不增');assets.ensure(paths);await ready(assets,paths,'冻结原资源');
    for(const [file,meta] of Object.entries(input.assets)){const image=assets.image(file);ensure(image&&image.naturalWidth===meta.width&&image.naturalHeight===meta.height,'实际PNG尺寸:'+file);}report.qualification.readyOriginalImages=paths.length;
    check();report.phase='pixels';report.qualification.freshPixelContexts=true;
    await rendererPixels(assets);ensure(report.pixelPairs===8,'固定8对不能跳过');ensure(report.pixelRendererPaintCalls===16,'固定16次完整renderer像素调用');
    check();report.assessment='PASS';report.phase='complete';
  }catch(error){report.assessment='FAIL';report.errors.push(error.stack||String(error));throw error;}
  finally{
    report.finishedAt=performance.now();
    const completed=new Set(report.pixelRows.map(row=>row.id));
    report.notReached=input.geometries.flatMap(g=>input.phases.map(phase=>`gaolao-courtyard-${g.id}-${phase}`)).filter(id=>!completed.has(id));
    dispose();report.cleanup.push({name:'page-owned-renderers-and-canvases',status:'released'});
  }
  return report;
}
window.backgroundRasterChecks={run,evidence:()=>structuredClone(report),failures:()=>failures,dispose};
