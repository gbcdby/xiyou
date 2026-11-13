import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthorityServer} from '../server.mjs';
import {startTestPostgres} from '../test-support/postgres.mjs';
import {scenePolicyRoom,openSceneDoor} from '../test-support/scene-policy-room.mjs';
import {deferred} from '../test-support/ai-room.mjs';

async function setup(t){
  const db=await startTestPostgres('scene-remedy',{outputSubdirectory:'scene-policy-implementation'}),clock={value:Date.parse('2026-11-13T11:00:00Z')};
  const server=await createAuthorityServer({pool:db.pool,now:()=>clock.value});let r;
  t.after(async()=>{await r?.network.close();await server.close();await db.stop();});
  r=await scenePolicyRoom(server,clock);await openSceneDoor(r);return {db,clock,server,r};
}
for(const position of [{x:645,y:320},{x:645,y:340},{x:645,y:365},{x:650,y:390}])test(`GZ-SP04/08真实前院支线 ${JSON.stringify(position)} 首次改约茶棚，换领路者经本人C13`,async t=>{
  const {r,server}=await setup(t);assert.equal((await r.propose('front-guest-room')).status,'accepted');
  await r.go(0,r.C('C13'));await r.go(0,{sceneId:'gaolao-courtyard',position});await r.drain();
  for(let i=0;i<3;i++)await r.step(500);
  let state=await r.state(),subject=state.characters[r.content.chapterRules.people.cuilan];assert.deepEqual(subject.position,position);assert.equal(state.chapter.cuilanSafe,false);
  await r.go(1,{sceneId:subject.sceneId,position});assert.equal((await r.propose('tea-back-room',1)).status,'accepted');
  state=await r.state();let follow=state.chapter.follows[subject.characterId];assert.deepEqual(follow.policyRoute.sourceIds,['cuilan-route-front-v1','cuilan-route-tea-v1']);
  assert.equal(follow.policyRoute.frontExitDone,false);
  const exits=[];const onCommit=notice=>{if(notice.sessionId===r.sessionId)for(const e of notice.events)if(e.kind==='spatial.actor'&&e.payload.actor.characterId===subject.characterId)exits.push(e.payload.actor.position);};server.runtime.on('commit',onCommit);
  for(const at of [r.C('C13'),r.C('C20'),r.R('R02'),r.R('R06'),r.R('R04'),r.R('R05')]){await r.go(1,at);await r.drain();}
  for(let i=0;i<12&&!(await r.state()).chapter.cuilanSafe;i++)await r.step(500);
  state=await r.state();follow=state.chapter.follows[subject.characterId];assert.equal(state.chapter.cuilanSafe,true,JSON.stringify(follow));assert.equal(follow.policyRoute.frontExitDone,true);assert.ok(exits.some(p=>p.x===645&&p.y===390),'必须有本人真实C13位置事件');assert.equal(follow.destinationId,'tea-back-room');
});
test('GZ-SP08真实defer/新提议accept，越界withdraw/近距decline及庄外改选前院补救',async t=>{
  const {r,server,db}=await setup(t),entered=deferred(),release=deferred(),prepare=server.runtime.prepareScenePolicy.bind(server.runtime);let hold=true;
  t.after(()=>release.resolve());
  server.runtime.prepareScenePolicy=async handle=>{if(hold){hold=false;entered.resolve();await release.promise;}return prepare(handle);};
  await r.propose('tea-back-room',0,{wait:false});await entered.promise;
  await r.go(0,r.C('C01'));release.resolve();await r.drain();
  let own=(await r.snapshot('cuilan')).projection;assert.equal(own.chapter.consents.filter(c=>c.purpose==='follow').at(-1).status,'deferred');
  await r.go(0,r.C('C08'));assert.equal((await r.propose('tea-back-room')).status,'accepted');
  for(const at of [r.C('C01'),r.C('C20'),r.R('R02'),{sceneId:'gaolao-village-road',position:{x:1000,y:460}}]){await r.go(0,at);await r.drain();}
  for(let i=0;i<4;i++)await r.step(500);
  const before=(await r.snapshot('cuilan')).projection.self.position;
  await r.go(0,{sceneId:'gaolao-village-road',position:{x:1050,y:460}});await r.drain();
  own=(await r.snapshot('cuilan')).projection;assert.equal(own.chapter.consents.filter(c=>c.purpose==='follow').at(-1).status,'withdrawn');assert.deepEqual(own.self.position,before);
  assert.equal((await r.propose('tea-back-room')).status,'declined');
  await r.go(0,{sceneId:'gaolao-village-road',position:before});assert.equal((await r.propose('front-guest-room')).status,'accepted');
  const f=(await r.state()).chapter.follows[r.content.chapterRules.people.cuilan];assert.deepEqual(f.policyRoute.sourceIds,['cuilan-route-front-v1','cuilan-route-tea-v1']);
  for(const at of [r.R('R01'),r.C('C21'),r.C('C13'),r.C('C11'),r.C('C12')]){await r.go(0,at);await r.drain();}
  for(let i=0;i<10&&!(await r.state()).chapter.cuilanSafe;i++)await r.step(500);
  assert.equal((await r.state()).chapter.safeRecord?.destinationId,'front-guest-room');
  assert.equal((await db.pool.query('SELECT count(*) FROM ai_runs WHERE session_id=$1',[r.sessionId])).rows[0].count,'0');
});
