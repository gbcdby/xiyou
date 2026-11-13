import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthorityServer} from '../server.mjs';
import {startTestPostgres} from '../test-support/postgres.mjs';
import {scenePolicyRoom,openSceneDoor} from '../test-support/scene-policy-room.mjs';
import {deferred} from '../test-support/ai-room.mjs';
import {validateScenePolicyBasis} from '../scene-policy.mjs';

for(const change of ['unrelated','leader-far','leader-epoch','new-proposal'])test(`GZ-SP04原子重验 ${change}：原basis不改写且只按本次真实谓词选择`,async t=>{
  const db=await startTestPostgres('scene-atomic',{outputSubdirectory:'scene-policy-implementation'}),clock={value:Date.parse('2026-11-13T14:00:00Z')},entered=deferred(),release=deferred();let r,server,hold=false,originalId;
  t.after(async()=>{release.resolve();await r?.network.close();await server?.close();await db.stop();});
  server=await createAuthorityServer({pool:db.pool,now:()=>clock.value});r=await scenePolicyRoom(server,clock);await openSceneDoor(r);
  const submit=server.runtime.submitSpatialIntent.bind(server.runtime);
  server.runtime.submitSpatialIntent=async(h,id)=>{if(hold&&h.actorId===r.content.chapterRules.people.cuilan){hold=false;originalId=id;entered.resolve();await release.promise;}return submit(h,id);};
  hold=true;const old=await r.propose('front-guest-room',0,{wait:false});await entered.promise;
  const original=(await db.pool.query('SELECT request,execution_context FROM spatial_intents WHERE session_id=$1 AND intent_id=$2',[r.sessionId,originalId])).rows[0];
  for(const invalid of [{...original.execution_context.scenePolicyBasis,world:{}},{...original.execution_context.scenePolicyBasis,guards:{...original.execution_context.scenePolicyBasis.guards,remoteObstacle:false}},{...original.execution_context.scenePolicyBasis,sources:[{...original.execution_context.scenePolicyBasis.sources[0],privateItems:[]}]}])assert.throws(()=>validateScenePolicyBasis(invalid));
  if(change==='unrelated')for(const at of [r.C('C17'),r.C('C18'),r.C('C03')])await r.go(1,at);
  if(change==='leader-far')await r.go(0,r.C('C01'));
  if(change==='leader-epoch'){
    const snapshot=await r.snapshot(0);await r.network.control(r.handles[0],JSON.stringify({schemaVersion:2,type:'control.take',sessionId:r.sessionId,viewId:snapshot.viewId,actorRef:snapshot.projection.self.entityRef,nonce:crypto.randomUUID()}));
  }
  if(change==='new-proposal')await r.propose('tea-back-room',0,{wait:false});
  release.resolve();await r.drain();
  const receipt=await server.runtime.internalReceipt(r.actors.get('cuilan').handle,originalId);
  assert.equal(receipt.status,change==='unrelated'?'Accepted':'Rejected');assert.deepEqual((await db.pool.query('SELECT request,execution_context FROM spatial_intents WHERE session_id=$1 AND intent_id=$2',[r.sessionId,originalId])).rows[0],original);
  const p=(await r.snapshot('cuilan')).projection,current=p.chapter.consents.filter(c=>c.purpose==='follow').at(-1);
  assert.equal(current.status,change==='leader-far'?'deferred':change==='leader-epoch'?'proposed':'accepted');
  if(change==='leader-epoch'){
    assert.equal(p.chapter.follows[0].status,'paused');assert.equal((await r.propose('tea-back-room')).status,'accepted');
  }
  if(change==='unrelated'){
    assert.ok(BigInt(receipt.observedSeq)>BigInt(original.request.baseSeq));
    assert.equal((await db.pool.query("SELECT count(*) FROM spatial_intents WHERE session_id=$1 AND request->'action'->>'kind'='respond_consent'",[r.sessionId])).rows[0].count,'1');
  }
  if(change==='new-proposal')assert.equal(p.chapter.consents.find(c=>c.consentId===old.consentId).status,'withdrawn');
});

test('GZ-SP04/05新提议评估读后返回前路线资格变化，不得被旧计划缓存吞掉',async t=>{
  const db=await startTestPostgres('scene-return-race',{outputSubdirectory:'scene-policy-implementation'}),clock={value:Date.parse('2026-11-13T23:00:00Z')},entered=deferred(),release=deferred();let server,r,held=false;
  t.after(async()=>{release.resolve();await r?.network.close();await server?.close();await db.stop();});
  server=await createAuthorityServer({pool:db.pool,now:()=>clock.value});r=await scenePolicyRoom(server,clock);await openSceneDoor(r);await r.propose('front-guest-room');
  await r.go(0,{sceneId:'gaolao-courtyard',position:{x:690,y:410}});await r.drain();for(let i=0;i<3;i++)await r.step(500);
  server.runtime.hooks.afterCommit=async({command})=>{if(!held&&command==='scene-policy-prepare'){held=true;entered.resolve();await release.promise;}};
  await r.propose('tea-back-room',0,{wait:false});await entered.promise;
  await r.go(0,r.C('C11'));release.resolve();await r.drain();
  const c=(await r.snapshot('cuilan')).projection.chapter.consents.filter(c=>c.purpose==='follow').at(-1);assert.equal(c.status,'declined');
  const rows=(await db.pool.query("SELECT request,scene_outcome FROM spatial_intents WHERE session_id=$1 AND request->'action'->>'consentId'=$2",[r.sessionId,c.consentId])).rows;
  assert.equal(rows.length,2);assert.equal(rows.filter(x=>x.scene_outcome.status==='Rejected'&&x.request.action.response==='accept').length,1);assert.equal(rows.filter(x=>x.scene_outcome.status==='Accepted'&&x.request.action.response==='decline').length,1);
});

for(const change of ['new-proposal','leader-deviation'])test(`GZ-SP03到达→确认之间 ${change}，旧到达不能安置失效计划`,async t=>{
  const db=await startTestPostgres('scene-arrival',{outputSubdirectory:'scene-policy-implementation'}),clock={value:Date.parse('2026-11-13T15:00:00Z')},entered=deferred(),release=deferred();let server,r,held=false,originalId;
  t.after(async()=>{release.resolve();await r?.network.close();await server?.close();await db.stop();});
  server=await createAuthorityServer({pool:db.pool,now:()=>clock.value});r=await scenePolicyRoom(server,clock);await openSceneDoor(r);await r.propose('front-guest-room');
  const submit=server.runtime.submitSpatialIntent.bind(server.runtime);server.runtime.submitSpatialIntent=async(h,id)=>{
    if(!held&&h.actorId===r.content.chapterRules.people.cuilan){const row=(await db.pool.query('SELECT request FROM spatial_intents WHERE session_id=$1 AND intent_id=$2',[r.sessionId,id])).rows[0];if(row.request.action.operationId==='gz-confirm-settlement'){held=true;originalId=id;entered.resolve();await release.promise;}}
    return submit(h,id);
  };
  for(const at of [r.C('C01'),r.C('C13'),r.C('C11'),r.C('C12')])await r.go(0,at);
  await entered.promise;assert.equal((await r.state()).chapter.cuilanSafe,false);
  if(change==='new-proposal')await r.propose('tea-back-room',0,{wait:false});else await r.go(0,r.C('C15'));
  release.resolve();await r.drain();
  assert.equal((await server.runtime.internalReceipt(r.actors.get('cuilan').handle,originalId)).status,'Rejected');
  assert.equal((await r.state()).chapter.cuilanSafe,false);
  if(change==='leader-deviation'){assert.equal((await r.snapshot('cuilan')).projection.chapter.follows[0].status,'withdrawn');await r.go(0,r.C('C12'));assert.equal((await r.propose('tea-back-room')).status,'accepted');}
  assert.equal((await r.snapshot('cuilan')).projection.chapter.follows[0].status,'accepted');
  for(const at of [r.C('C13'),r.C('C20'),r.R('R02'),r.R('R06'),r.R('R04'),r.R('R05')]){await r.go(0,at);await r.drain();}
  for(let i=0;i<10&&!(await r.state()).chapter.cuilanSafe;i++)await r.step(500);
  assert.equal((await r.state()).chapter.safeRecord.destinationId,'tea-back-room');
});
