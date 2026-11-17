import test from 'node:test';
import assert from 'node:assert/strict';
import { SpatialCanvas, readCanvasFrame } from '../src/rendering/spatial-canvas.ts';
import { CanvasAssets } from '../src/rendering/canvas-assets.ts';
import { ConfirmedMotion } from '../src/domain/spatial-motion.ts';
import { spatialSnapshot } from './spatial-fixture.mjs';

test('GZ-UX-AC-02/03：每帧一次完整合成，移动/选择不重置画布尺寸或取景，真实同场对象入绘制清单', t => {
  const oldDocument=globalThis.document,oldPath=globalThis.Path2D;
  const makeCanvas=()=>{
    let width=0,height=0;const calls=[],resizes=[];
    const context=new Proxy({drawImage(...args){calls.push(args);},isPointInPath(){return false;}},{get(target,key){return target[key]??(()=>{});},set(target,key,value){target[key]=value;return true;}});
    return {dataset:{},calls,resizes,get width(){return width;},set width(value){resizes.push(['width',value]);width=value;},get height(){return height;},set height(value){resizes.push(['height',value]);height=value;},getContext(){return context;}};
  };
  globalThis.document={createElement:()=>makeCanvas()};globalThis.Path2D=class{constructor(path){this.path=path;}};
  t.after(()=>{globalThis.document=oldDocument;globalThis.Path2D=oldPath;});
  let requests=0;const canvas=makeCanvas(),renderer=new SpatialCanvas(canvas,new CanvasAssets(()=>{requests++;throw new Error('未知造型不应请求图片');})),motion=new ConfirmedMotion();
  const snapshot=spatialSnapshot();snapshot.projection.entities.push({entityRef:'other_00000000000000000000000000000',name:'同场远处的人',appearanceEpoch:'0',sceneId:'yard',position:{x:900,y:700},facing:'W'});
  motion.update(snapshot,0);renderer.prepare(snapshot);renderer.resize(1000,900,2);
  let boundaries=0;
  const first=renderer.paint(snapshot,motion,0,{reducedMotion:false,beforeFrontWrite(){
    boundaries++;assert.equal(canvas.calls.length,0,'同步边界必须先于首次前台写入');assert.equal(readCanvasFrame(canvas),null);
  }}),writes=canvas.resizes.length;
  assert.equal(boundaries,1,'每次成功合成只通知一次前台写前边界');
  assert.equal(canvas.calls.length,1);assert.equal(first.actors.length,2);assert.deepEqual(first.view,{x:0,y:0,width:1000,height:800});
  assert.equal(canvas.width,2000);assert.equal(canvas.height,1800);
  const changed=structuredClone(snapshot);changed.projection.sceneTimeMs+=100;changed.projection.self.position={x:118,y:100};changed.projection.movement={sceneId:'yard',path:[{x:100,y:100},{x:136,y:100}],status:'moving'};
  motion.update(changed,100);renderer.prepare(changed);renderer.resize(1000,900,2);
  const second=renderer.paint(changed,motion,150,{reducedMotion:false,selected:'other_00000000000000000000000000000',beforeFrontWrite(){
    boundaries++;assert.equal(canvas.calls.length,1);assert.deepEqual(readCanvasFrame(canvas),first,'buffer准备期间仍保留上次成功前台帧');
  }});
  assert.equal(boundaries,2);
  assert.equal(canvas.calls.length,2);assert.equal(canvas.resizes.length,writes);assert.deepEqual(second.fit,first.fit);assert.deepEqual(second.view,first.view);assert.equal(requests,0);
  assert.deepEqual(readCanvasFrame(canvas),second);
  const actor=second.actors.find(a=>a.ref===snapshot.projection.self.entityRef);
  assert.equal(actor.position.x,109);assert.equal(actor.moving,true);
  assert.equal(renderer.hit({x:actor.position.x,y:actor.position.y+50}),actor.ref,'DPR下按实际画出的脚底命中');
  assert.throws(()=>renderer.paint(changed,motion,160,{reducedMotion:false,beforeFrontWrite(){throw new Error('受控封口失败');}}),/受控封口失败/);
  assert.equal(canvas.calls.length,2,'回调失败不得继续前台写入');assert.deepEqual(readCanvasFrame(canvas),second);
  const absent=structuredClone(changed);absent.projection.scene=null;
  assert.equal(renderer.paint(absent,motion,200,{reducedMotion:false}),null);assert.equal(readCanvasFrame(canvas),null);assert.equal(renderer.hit({x:actor.position.x,y:actor.position.y+50}),null);assert.equal(canvas.dataset.renderedEntities,'0','当前场景撤销时不能残留旧画面或命中对象');
});
