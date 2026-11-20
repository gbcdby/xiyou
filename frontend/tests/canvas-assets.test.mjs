import test from 'node:test';
import assert from 'node:assert/strict';
import { CanvasAssets } from '../src/rendering/canvas-assets.ts';
import { spriteResourcePaths } from '../src/domain/gaolao-art.ts';
import { sceneFit, worldPoint, screenPoint } from '../src/domain/spatial-canvas-geometry.ts';
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('GZ-UX-AC-02：帧预载不完整或单帧失败时稳定站姿，绘制不创建Image，重试只补失败资源',async()=>{
  const requests=[]; const cache=new CanvasAssets(()=>{const image={naturalWidth:362,naturalHeight:543,decode:async()=>{},onload:null,onerror:null,src:''};requests.push(image);return image;});
  const paths=spriteResourcePaths('gaocai');cache.ensure(paths);assert.equal(requests.length,45);
  for(const image of requests.filter(i=>i.src.includes('/idle/')))image.onload();await flush();
  for(const distance of [0,20,50,100]) assert.match(cache.actorFrame('gaocai','S',true,distance,false).href,/idle\/s\.png$/);
  const bad=requests.find(i=>i.src.includes('/walk/s/03.png'));
  for(const image of requests.filter(i=>i.src.includes('/walk/')))image===bad?image.onerror():image.onload();await flush();
  for(let distance=0;distance<600;distance+=5)assert.match(cache.actorFrame('gaocai','S',true,distance,false).href,/idle\/s\.png$/);
  cache.ensure(paths);assert.equal(requests.length,45);cache.retry(paths);assert.equal(requests.length,46);requests.at(-1).onload();await flush();
  assert.match(cache.actorFrame('gaocai','S',true,50,false).href,/walk\/s\//);assert.equal(cache.failed(paths).length,0);
});

test('GZ-UX-AC-02/03：固定fit含letterbox，DPR不改变逻辑点击坐标',()=>{
  const fit=sceneFit({width:1600,height:1000},{width:1000,height:800});
  assert.deepEqual(fit,{scale:.625,x:0,y:87.5});
  const pixel=screenPoint({x:1250,y:425},fit);assert.deepEqual(worldPoint(pixel,fit,{width:1600,height:1000}),{x:1250,y:425});
  assert.equal(worldPoint({x:10,y:20},fit,{width:1600,height:1000}),null);
  assert.deepEqual(sceneFit({width:1600,height:1000},{width:1000,height:800}),fit);
});
