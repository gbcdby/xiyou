import test from 'node:test';
import assert from 'node:assert/strict';
import { SpatialCanvas, readCanvasFrame } from '../src/rendering/spatial-canvas.ts';
import { ConfirmedMotion } from '../src/domain/spatial-motion.ts';
import { sceneLayerCatalog, sceneGroupAssets } from '../src/domain/gaolao-scene-layers.ts';
import { spatialSnapshot } from './spatial-fixture.mjs';
import { context, picture } from './background-raster-fakes.mjs';
function harness(t,geometry={width:1226,height:684,dpr:1}) {
  const oldDoc=globalThis.document,oldPath=globalThis.Path2D,made=[];let captureFailure=false;
  function create(){const ctx=context();let width=0,height=0;const canvas={dataset:{},ctx,getContext:()=>new Proxy(ctx,{get:(o,k)=>o[k]??(()=>{})})};Object.defineProperties(canvas,{width:{get:()=>width,set:v=>{width=v;ctx.resetNativeState();}},height:{get:()=>height,set:v=>{height=v;ctx.resetNativeState();}}});ctx.canvas=canvas;return canvas;}
  globalThis.document={createElement(){const c=create();if(captureFailure){const draw=c.ctx.drawImage;c.ctx.drawImage=function(...args){draw.apply(this,args);throw new Error('捕获设施故障');};}made.push(c);return c;}};globalThis.Path2D=class{};
  t.after(()=>{globalThis.document=oldDoc;globalThis.Path2D=oldPath;});
  const snapshot=spatialSnapshot(),p=snapshot.projection;Object.assign(p,{contentVersion:'gaolaozhuang-scene-v2',chapterVersion:'gaolao-v1',mapVersion:'gaolao-layout-v1.1',reducerVersion:'gaolao-world-v2'});Object.assign(p.scene,{sceneId:'gaolao-courtyard',width:1600,height:1000});p.self.sceneId=p.scene.sceneId;for(const e of p.entities)e.sceneId=p.scene.sceneId;
  const group=sceneLayerCatalog[p.scene.sceneId],images=new Map(sceneGroupAssets(group).map(a=>[a.file,{...picture(a.file),naturalWidth:a.pixelSize.width,naturalHeight:a.pixelSize.height}]));let ready=true;
  const assets={ensure(){},ready:()=>ready,failed:()=>ready?[]:[group.base.file],resources:()=>[],actorFrame:()=>null,image:file=>images.get(file)||null,opaqueAt:()=>true};
  const front=create(),renderer=new SpatialCanvas(front,assets),motion=new ConfirmedMotion();renderer.prepare(snapshot);renderer.resize(geometry.width,geometry.height,geometry.dpr);motion.update(snapshot,0);
  const paint=beforeFrontWrite=>renderer.paint(snapshot,motion,0,{reducedMotion:true,beforeFrontWrite});
  return {snapshot,group,images,made,front,buffer:made[0],renderer,motion,paint,assets,create,setReady:v=>{ready=v;},setCaptureFailure:v=>{captureFailure=v;}};
}
const baseDraws=h=>h.buffer.ctx.draws.filter(d=>d.args[0]===h.images.get(h.group.base.file));

test('C2：完整renderer首次仍在原buffer采样base，命中root恢复，原frame和封口次序保持',t=>{
  const h=harness(t);t.after(()=>h.renderer.dispose());let boundaries=0;
  const first=h.paint(()=>{boundaries++;assert.equal(h.front.ctx.draws.length,0);assert.equal(readCanvasFrame(h.front),null);});assert.deepEqual(readCanvasFrame(h.front),first);
  const cached=h.made.find(c=>c!==h.buffer&&c.ctx.draws.some(d=>d.args[0]===h.buffer));assert.ok(cached,'捕获原buffer，而不是原base图片');assert.equal(cached.ctx.draws.length,1);assert.equal(baseDraws(h).length,1);assert.equal(h.buffer.ctx.stateDepth(),0);
  const old=readCanvasFrame(h.front),baseCount=baseDraws(h).length,cacheOps=cached.ctx.operations.slice();const second=h.paint(()=>{boundaries++;assert.deepEqual(readCanvasFrame(h.front),old);assert.equal(h.front.ctx.draws.length,1);});assert.equal(second.serial,first.serial+1);assert.deepEqual({...second,serial:first.serial},first);
  assert.equal(baseDraws(h).length,baseCount);assert.deepEqual(cached.ctx.operations,cacheOps);const restored=h.buffer.ctx.draws.filter(d=>d.args[0]===cached);assert.equal(restored.length,1);assert.equal(restored[0].clipToken,'root');assert.deepEqual(restored[0].matrix,{a:1,b:0,c:0,d:1,e:0,f:0});assert.equal(boundaries,2);assert.equal(second.sceneImages.filter(v=>v.kind==='base').length,1);assert.deepEqual(readCanvasFrame(h.front),second);
});

test('C4：未完成paint后scope/clear/同backing CSS与DPR均不能恢复资格，真实buffer重置才恢复',t=>{
  const h=harness(t);h.paint();const cached=h.made.at(-1),error=new Error('原beforeFrontWrite错误'),old=readCanvasFrame(h.front),writes=h.front.ctx.draws.length;
  assert.throws(()=>h.paint(()=>{throw error;}),e=>e===error);assert.equal(cached.width,0);assert.equal(h.front.ctx.draws.length,writes);assert.deepEqual(readCanvasFrame(h.front),old);
  const count=h.made.length;h.renderer.clear();h.snapshot.viewId+='-scope';h.renderer.prepare(h.snapshot);h.renderer.resize(1226.1,684,1);h.paint();assert.equal(h.made.length,count);h.renderer.resize(1226.1,684,1.00001);h.paint();assert.equal(h.made.length,count);
  h.renderer.resize(1227,684,1);h.paint();assert.equal(h.made.length,count+1);assert.ok(h.made.at(-1).width>0);h.renderer.dispose();
});

test('C5：捕获设施失败继续同一次原paint，下帧仍原图，无双重目标写',t=>{
  const h=harness(t);h.setCaptureFailure(true);const frame=h.paint();assert.equal(frame.layerStatus,'ready');assert.equal(h.front.ctx.draws.length,1);assert.equal(baseDraws(h).length,1);assert.equal(h.made.at(-1).width,0);
  h.setCaptureFailure(false);const count=h.made.length;h.paint();assert.equal(h.made.length,count);assert.equal(baseDraws(h).length,2);assert.equal(h.front.ctx.draws.length,2);assert.equal(h.buffer.ctx.stateDepth(),0);h.renderer.dispose();
});

test('C6：恢复目标可能已写后抛错，不当帧补画，保存旧front/frame并恢复自有save',t=>{
  const h=harness(t);h.paint();const cached=h.made.at(-1),original=h.buffer.ctx.drawImage,error=new Error('恢复已可能写入');let attempts=0;
  const old=readCanvasFrame(h.front),writes=h.front.ctx.draws.length,raw=baseDraws(h).length;
  h.buffer.ctx.drawImage=function(...args){original.apply(this,args);if(args[0]===cached){attempts++;throw error;}};
  assert.throws(h.paint,e=>e===error);assert.equal(attempts,1);assert.equal(baseDraws(h).length,raw);assert.equal(h.front.ctx.draws.length,writes);assert.deepEqual(readCanvasFrame(h.front),old);assert.equal(h.buffer.ctx.stateDepth(),0);assert.equal(h.buffer.ctx.clipToken,'root');assert.equal(cached.width,0);
  h.buffer.ctx.drawImage=original;const count=h.made.length;h.paint();assert.equal(h.made.length,count);assert.equal(baseDraws(h).length,raw+1);h.renderer.dispose();
});

test('C7：原foreground异常留下实际未知clip，clear不修复或伪造已知；真实backing重置恢复',t=>{
  const h=harness(t),floor=h.images.get(h.group.foreground[0].file),original=h.buffer.ctx.drawImage,error=new Error('原foreground失败');
  h.buffer.ctx.drawImage=function(...args){original.apply(this,args);if(args[0]===floor)throw error;};
  assert.throws(h.paint,e=>e===error);assert.ok(h.buffer.ctx.stateDepth()>0);assert.notEqual(h.buffer.ctx.clipToken,'root');assert.equal(h.front.ctx.draws.length,0);assert.equal(h.made.at(-1).width,0);
  h.buffer.ctx.drawImage=original;const count=h.made.length,clip=h.buffer.ctx.clipToken;h.renderer.clear();assert.equal(h.buffer.ctx.clipToken,clip);h.snapshot.viewId+='-new';h.renderer.prepare(h.snapshot);h.paint();assert.equal(h.made.length,count,'未正常结束的context不能重新捕获');assert.equal(h.buffer.ctx.clipToken,clip);
  h.renderer.resize(1227,684,1);assert.equal(h.buffer.ctx.clipToken,'root');h.paint();assert.equal(h.made.length,count+1);h.renderer.dispose();
});

test('C10：实际CSS失效释放，组pending/错尺寸/同URL新image/无scene与dispose不复用旧背景',t=>{
  const h=harness(t);h.paint();let old=h.made.at(-1);h.renderer.resize(1226.1,684,1);assert.equal(old.width,0);h.paint();old=h.made.at(-1);
  h.setReady(false);assert.notEqual(h.paint().layerStatus,'ready');assert.equal(old.width,0);h.setReady(true);h.images.set(h.group.base.file,{...h.images.get(h.group.base.file)});h.paint();old=h.made.at(-1);
  h.images.get(h.group.base.file).naturalWidth++;assert.notEqual(h.paint().layerStatus,'ready');assert.equal(old.width,0);h.images.get(h.group.base.file).naturalWidth--;h.paint();old=h.made.at(-1);
  const writes=h.front.ctx.draws.length,frame=readCanvasFrame(h.front);h.renderer.dispose();assert.equal(old.width,0);assert.equal(h.front.ctx.draws.length,writes);assert.deepEqual(readCanvasFrame(h.front),frame);h.paint();old=h.made.at(-1);h.snapshot.projection.scene=null;assert.equal(h.paint(),null);assert.equal(old.width,0);assert.equal(readCanvasFrame(h.front),null);
});

test('C12：公开resize重复同参数仍复用背景，不能把无变化observer回调变成冷捕获',t=>{
  const h=harness(t);h.paint();const cached=h.made.at(-1),count=h.made.length,baseCount=baseDraws(h).length,ops=cached.ctx.operations.slice();
  h.renderer.resize(1226,684,1);assert.equal(cached.width,1226,'相同CSS/DPR/backing不得释放缓存');h.paint();
  assert.equal(h.made.length,count);assert.equal(baseDraws(h).length,baseCount);assert.deepEqual(cached.ctx.operations,ops);h.renderer.dispose();
});
