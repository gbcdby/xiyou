import test from 'node:test';
import assert from 'node:assert/strict';
import { directionFromKeys, ContinuousDirection, DIRECTION_INTERVAL_MS, DIRECTION_RECEIPT_DEADLINE_MS } from '../src/domain/spatial-direction.ts';
import { directionTarget } from '../src/domain/spatial-navigation.ts';
import { spatialSnapshot } from './spatial-fixture.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));
function clock() {
  let now = 0, next = 1; const jobs = new Map();
  return { now: () => now, setTimeout(callback, delay) { const id = next++; jobs.set(id, { callback, at: now + delay }); return id; }, clearTimeout(id) { jobs.delete(id); }, async advance(through) {
    while (true) { const item = [...jobs].sort((a,b) => a[1].at-b[1].at).find(([,job]) => job.at <= through); if (!item) break; jobs.delete(item[0]); now = item[1].at; item[1].callback(); await flush(); }
    now = through; await flush();
  } };
}

test('GZ-UX-AC-05：持键集合合成、松一键保留另一轴、对向抵消', () => {
  const held = new Set(['ArrowUp']); assert.deepEqual(directionFromKeys(held), { x: 0, y: -1 });
  held.add('ArrowRight'); assert.deepEqual(directionFromKeys(held), { x: 1, y: -1 });
  held.delete('ArrowUp'); assert.deepEqual(directionFromKeys(held), { x: 1, y: 0 });
  held.add('ArrowLeft'); assert.equal(directionFromKeys(held), null);
  held.add('ArrowDown'); assert.deepEqual(directionFromKeys(held), { x: 0, y: 1 });
});

test('GZ-UX-AC-05：固定时钟调度独立于30/60/120Hz，重复按键不加速，斜向规范化', async () => {
  const traces = [];
  for (const hz of [30,60,120]) {
    const time = clock(), moves = [], stops = [];
    const controller = new ContinuousDirection({ clock: time, send: async direction => { moves.push({ at: time.now(), direction }); }, stop: async () => { stops.push(time.now()); } });
    controller.set({ x: 1, y: -1 }); await flush();
    for (let frame = 1; frame <= hz; frame++) { controller.set({ x: 1, y: -1 }); await time.advance(frame*1000/hz); }
    controller.set(null); await flush(); await time.advance(2000);
    assert.equal(stops.length, 1); assert.ok(moves.length <= 1+1000/DIRECTION_INTERVAL_MS);
    for (const move of moves) assert.ok(Math.abs(Math.hypot(move.direction.x,move.direction.y)-1)<1e-9);
    traces.push(moves);
  }
  assert.deepEqual(traces[0], traces[1]); assert.deepEqual(traces[1], traces[2]);
});

test('GZ-UX-AC-05：短按立即stop，不等旧move收据；慢请求有界且只保留最新方向', async () => {
  const time = clock(), calls = []; let finish;
  const controller = new ContinuousDirection({ clock: time, send: direction => { calls.push({ kind: 'move', direction }); return new Promise(resolve => { finish=resolve; }); }, stop: async () => { calls.push({ kind: 'stop' }); } });
  controller.set({ x: 1,y:0 }); await time.advance(20); controller.set(null); await flush();
  assert.deepEqual(calls.map(c=>c.kind), ['move','stop']); await time.advance(1000); assert.equal(calls.length,2);
  finish(); await flush();
  controller.set({x:0,y:-1}); controller.set({x:-1,y:0}); await time.advance(1000+DIRECTION_RECEIPT_DEADLINE_MS+100);
  assert.equal(calls.filter(c=>c.kind==='move').length,2, '未决移动没有形成按键请求队列');
  assert.equal(calls.filter(c=>c.kind==='stop').length,2);
  finish(); await flush(); controller.clear();
});

test('GZ-UX-AC-05：未知收据终止续发并请求停步，清理后迟到完成不能复活输入', async () => {
  const time = clock(), calls = [], errors = [];
  const controller = new ContinuousDirection({ clock:time, send:async()=>{ calls.push('move'); throw new Error('结果未知'); }, stop:async()=>{calls.push('stop');}, fail: message=>errors.push(message) });
  controller.set({x:1,y:0}); await flush(); await time.advance(3000);
  assert.deepEqual(calls,['move','stop']); assert.equal(errors.length,1);
  controller.clear(); await time.advance(5000); assert.deepEqual(calls,['move','stop']);
});

test('GZ-UX-AC-05：在途期间快反向只发送最新方向，前方细墙裁短而不绕墙', async () => {
  const time=clock(), vectors=[];let finish;
  const controller=new ContinuousDirection({clock:time,send:direction=>{vectors.push(direction);return vectors.length===1?new Promise(resolve=>{finish=resolve;}):Promise.resolve();},stop:async()=>{}});
  controller.set({x:1,y:0});controller.set({x:0,y:-1});controller.set({x:-1,y:0});await time.advance(50);finish();await flush();await time.advance(100);
  assert.deepEqual(vectors,[{x:1,y:0},{x:-1,y:0}]);controller.clear();
  const scene=spatialSnapshot().projection.scene;
  scene.obstacles=[{obstacleId:'thin-wall',polygon:[{x:110,y:0},{x:111,y:0},{x:111,y:800},{x:110,y:800}],exceptAreas:[]}];
  assert.deepEqual(directionTarget(scene,{x:100,y:100},{x:1,y:0}),{x:109,y:100});
  assert.equal(directionTarget(scene,{x:109,y:100},{x:1,y:0}),null);
});

test('R66-STD-001：快速move与慢stop共用有界窗口，反复短按不积累停步请求', async () => {
  const time=clock(), calls=[]; let finishStop;
  const controller=new ContinuousDirection({clock:time,send:async()=>{calls.push('move');},stop:()=>{calls.push('stop');return new Promise(resolve=>{finishStop=resolve;});}});
  controller.set({x:1,y:0}); await flush(); controller.set(null); await flush();
  for(let i=1;i<=8;i++){await time.advance(i*150);controller.set({x:1,y:0});await flush();controller.set(null);await flush();}
  assert.deepEqual(calls,['move','stop'],'一个停步未决期间不能创建新的move/stop');
  finishStop(); await flush(); controller.set({x:0,y:1});await flush();
  assert.deepEqual(calls,['move','stop','move'],'明确停步完成后新的按键才能开始新一段');controller.clear();
});

test('R66-STD-001：旧stop变为未知时清除持键意图，迟到失败不复活续发', async () => {
  const time=clock(), calls=[], errors=[]; let rejectStop;
  const controller=new ContinuousDirection({clock:time,send:async()=>{calls.push('move');},stop:()=>{calls.push('stop');return new Promise((_resolve,reject)=>{rejectStop=reject;});},fail:message=>errors.push(message)});
  controller.set({x:1,y:0});await flush();controller.set(null);await flush();
  await time.advance(150);controller.set({x:0,y:1});await flush();rejectStop(new Error('ACK丢失'));await flush();await time.advance(3000);
  assert.deepEqual(calls,['move','stop']);assert.ok(errors.some(message=>/停步.*确认/.test(message)));controller.clear();
});
