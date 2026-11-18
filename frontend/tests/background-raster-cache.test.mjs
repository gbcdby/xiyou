import test from 'node:test';
import assert from 'node:assert/strict';
import { BackgroundRasterCache } from '../src/rendering/background-raster-cache.ts';
import { context, picture, bounds, transform, facility, identity, format } from './background-raster-fakes.mjs';
const scene={width:1600,height:1000};
const paper=(c,t)=>{c.setTransform(t.viewport.dpr,0,0,t.viewport.dpr,0,0);c.fillStyle='#eee3cb';};
const originalBase=(c,img,t,b)=>{c.save();c.translate(t.fit.x,t.fit.y);c.scale(t.fit.scale,t.fit.scale);c.beginPath();c.rect(0,0,scene.width,scene.height);c.clip();c.drawImage(img,b.x,b.y,b.width,b.height);};

test('C1：原buffer完成背景后才捕获，hit在root clip以identity恢复，永不重采样原图到cache',()=>{
  const made=facility(),cache=new BackgroundRasterCache(()=>made.create()),target=context(),image=picture(),t=transform(),b=bounds();paper(target,t);
  assert.equal(cache.begin(target,image,b,t,scene),false);assert.equal(made.surfaces.length,0,'miss不抢先创建或绘制另一背景');assert.equal(target.draws.length,0);
  originalBase(target,image,t,b);const matrix={...target.matrix},clip=target.clipToken;
  cache.capture(target);assert.equal(made.surfaces.length,1);
  const surface=made.surfaces[0];assert.deepEqual([surface.width,surface.height],[1226,684]);assert.deepEqual(surface.ctx.draws.map(d=>d.args),[[target.canvas,0,0]],'source是原buffer，不是原Image');
  assert.deepEqual(surface.ctx.draws[0].matrix,identity);assert.deepEqual(target.matrix,matrix);assert.equal(target.clipToken,clip);target.restore();cache.finish(true);
  const ops=surface.ctx.operations.slice();paper(target,t);const before=target.draws.length;
  assert.equal(cache.begin(target,image,b,t,scene),true);assert.equal(target.draws.length,before+1);assert.deepEqual(target.draws.at(-1).args,[surface,0,0]);assert.equal(target.draws.at(-1).clipToken,'root');assert.deepEqual(target.draws.at(-1).matrix,identity);assert.deepEqual(surface.ctx.operations,ops);assert.equal(made.surfaces.length,1);
  cache.finish(true);cache.clear();assert.deepEqual([surface.width,surface.height],[0,0]);
});

test('C3：覆盖资格由真实paper边界决定，G2/G3原路径，向下round的分数尺寸可捕获',()=>{
  for(const [name,width,height,dpr,eligible] of [['G1',1226,684,1,true],['G2',980.5,612.25,1.25,false],['G3',799.5,600.25,2,false],['G4',980.25,612.15,1.25,true]]){
    const made=facility(),cache=new BackgroundRasterCache(()=>made.create()),c=context(),image=picture(),t={viewport:{width,height,dpr},fit:{x:0,y:0,scale:.5}};c.canvas.width=Math.round(width*dpr);c.canvas.height=Math.round(height*dpr);paper(c,t);
    assert.equal(cache.begin(c,image,bounds(),t,scene),false);cache.capture(c);cache.finish(true);assert.equal(made.surfaces.length,eligible?1:0,name);assert.equal(cache.begin(c,image,bounds(),t,scene),eligible,name);cache.finish(true);cache.clear();
  }
});

test('C8：完整格式/状态/容量资格与失效释放，未知clip不由clear或成功fallback复活',()=>{
  const img=picture(),b=bounds(),t=transform();
  for(const patch of [{alpha:false},{colorSpace:'display-p3'},{colorType:'float16'},{colorType:undefined},{willReadFrequently:true},{desynchronized:true}]){const made=facility(),cache=new BackgroundRasterCache(()=>made.create()),c=context({...format,...patch});paper(c,t);assert.equal(cache.begin(c,img,b,t,scene),false);cache.capture(c);assert.equal(made.surfaces.length,0);}
  for(const change of [c=>c.globalAlpha=.5,c=>c.globalCompositeOperation='copy',c=>c.fillStyle='transparent',c=>c.filter='blur(1px)',c=>c.shadowColor='black',c=>c.shadowBlur=1,c=>c.shadowOffsetX=1,c=>c.shadowOffsetY=1,c=>c.matrix.e=.1,c=>c.matrix.b=.1]){const made=facility(),cache=new BackgroundRasterCache(()=>made.create()),c=context();paper(c,t);change(c);assert.equal(cache.begin(c,img,b,t,scene),false);cache.capture(c);assert.equal(made.surfaces.length,0);}
  const made=facility(),cache=new BackgroundRasterCache(()=>{assert.ok(made.surfaces.every(c=>c.width===0),'先释放旧图');return made.create();}),c=context(),big={viewport:{width:2048,height:2048,dpr:1},fit:t.fit};c.canvas.width=c.canvas.height=2048;paper(c,big);assert.equal(cache.begin(c,img,b,big,scene),false);cache.capture(c);cache.finish(true);let old=made.surfaces.at(-1);assert.equal(old.width*old.height,4194304);
  c.canvas.width=2049;big.viewport.width=2049;assert.equal(cache.begin(c,img,b,big,scene),false);cache.capture(c);assert.equal(old.width,0);assert.equal(made.surfaces.length,1);
  c.canvas.width=1226;c.canvas.height=684;paper(c,t);cache.begin(c,img,b,t,scene);cache.capture(c);cache.finish(true);old=made.surfaces.at(-1);
  cache.finish(false);assert.equal(old.width,0);for(const change of [()=>cache.clear(),()=>cache.finish(true)]){change();assert.equal(cache.begin(c,picture(),b,t,scene),false);cache.capture(c);assert.equal(made.surfaces.length,2);}
  cache.contextReset();assert.equal(cache.begin(c,img,b,t,scene),false);cache.capture(c);cache.finish(true);assert.equal(cache.begin(c,img,b,t,scene),true);cache.clear();
});

test('C9：设施异常不写原buffer，同代不重复分配；错误alias不得清空原buffer',()=>{
  for(const stage of ['create','context','format','copy','alias']){
    const target=context(),t=transform(),img=picture(),made=facility();let calls=0;
    const cache=new BackgroundRasterCache(()=>{calls++;if(stage==='create')throw new Error(stage);if(stage==='alias')return target.canvas;const c=made.create();if(stage==='context')c.getContext=()=>null;if(stage==='format')c.ctx.getContextAttributes=()=>({...format,alpha:false});if(stage==='copy')c.ctx.drawImage=()=>{throw new Error(stage);};return c;});paper(target,t);
    cache.begin(target,img,bounds(),t,scene);cache.capture(target);cache.finish(true);assert.equal(target.draws.length,0);assert.deepEqual([target.canvas.width,target.canvas.height],[1226,684]);assert.ok(made.surfaces.every(c=>c.width===0));
    assert.equal(cache.begin(target,img,bounds(),t,scene),false);cache.capture(target);assert.equal(calls,1,stage);cache.clear();
  }
});
