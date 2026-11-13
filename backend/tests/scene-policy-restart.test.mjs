import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthorityServer} from '../server.mjs';
import {startTestPostgres} from '../test-support/postgres.mjs';
import {scenePolicyRoom,resumeSceneRoom,openSceneDoor} from '../test-support/scene-policy-room.mjs';
import {until,deferred} from '../test-support/ai-room.mjs';
import {accepted} from '../test-support/gaolao-room.mjs';
import {scenePolicyInput} from '../scene-policy.mjs';

for(const y of [340,365,390])test(`GZ-SP06真实服务退出段 ${y} 重启，旧计划暂停、换领路者新提议才继续`,async t=>{
  const db=await startTestPostgres('scene-restart',{outputSubdirectory:'scene-policy-implementation'}),clock={value:Date.parse('2026-11-13T16:00:00Z')};let server,r;
  t.after(async()=>{await r?.network.close();await server?.close();await db.stop();});
  server=await createAuthorityServer({pool:db.pool,now:()=>clock.value});r=await scenePolicyRoom(server,clock);await openSceneDoor(r);await r.propose('front-guest-room');
  await r.go(0,r.C('C13'));await r.go(0,{sceneId:'gaolao-courtyard',position:{x:y===390?650:645,y}});await r.drain();for(let i=0;i<3;i++)await r.step(500);
  await r.propose('tea-back-room');
  const before=await r.state(),old=before.chapter.follows[r.content.chapterRules.people.cuilan],requestCount=(await db.pool.query("SELECT count(*) FROM spatial_intents WHERE session_id=$1 AND execution_context->>'mode'='scene-policy'",[r.sessionId])).rows[0].count;
  await r.network.close();await server.close();clock.value+=60000;
  server=await createAuthorityServer({pool:db.pool,now:()=>clock.value});
  await until(()=>server.scenePolicy.status().actors[0]?.phase==='Idle'&&!server.scenePolicy.status().actors[0].bootstrap,'暂停启动仍完成登记与原结果核对');
  const paused=await server.runtime.replay(r.sessionId);assert.equal(paused.paused,true);assert.equal(paused.chapter.follows[old.subjectId].status,'paused');assert.deepEqual(paused.characters[old.subjectId].position,before.characters[old.subjectId].position);
  assert.equal((await db.pool.query("SELECT count(*) FROM spatial_intents WHERE session_id=$1 AND execution_context->>'mode'='scene-policy'",[r.sessionId])).rows[0].count,requestCount,'重启原结果核对不能创建新选择');
  r=await resumeSceneRoom(server,clock,r);assert.equal((await r.snapshot('cuilan')).projection.chapter.follows[0].status,'paused');
  await r.go(1,{sceneId:'gaolao-courtyard',position:before.characters[old.subjectId].position});assert.equal((await r.propose('tea-back-room',1)).status,'accepted');
  let current=(await r.state()).chapter.follows[old.subjectId];assert.notEqual(current.consentId,old.consentId);assert.notEqual(current.subjectEpoch,old.subjectEpoch);assert.equal(current.policyRoute.frontExitDone,false);
  for(const at of [r.C('C13'),r.C('C20'),r.R('R02'),r.R('R06'),r.R('R04'),r.R('R05')]){await r.go(1,at);await r.drain();}
  for(let i=0;i<10&&!(await r.state()).chapter.cuilanSafe;i++)await r.step(500);
  assert.equal((await r.state()).chapter.safeRecord?.destinationId,'tea-back-room');
});

test('GZ-SP01/07本人图记越过256窗口仍沿原来源；稳定following/无关移动不逐tick评估',async t=>{
  const db=await startTestPostgres('scene-durable-source',{outputSubdirectory:'scene-policy-implementation'}),clock={value:Date.parse('2026-11-13T17:00:00Z')};let server,r;
  t.after(async()=>{await r?.network.close();await server?.close();await db.stop();});
  server=await createAuthorityServer({pool:db.pool,now:()=>clock.value});r=await scenePolicyRoom(server,clock);await openSceneDoor(r);await r.propose('front-guest-room');
  await r.go(0,r.C('C01'));await r.drain();for(let i=0;i<3;i++)await r.step(500);
  const count=r.sceneStatus().evaluations;for(let i=0;i<20;i++)await r.step(50);await r.go(1,r.C('C18'));await r.drain();assert.equal(r.sceneStatus().evaluations,count);
  const handle=r.actors.get('cuilan').handle,read=()=>server.runtime.locked(r.sessionId,{kind:'scene-source-check'},tx=>scenePolicyInput(tx,server.runtime.internal(handle))),original=(await read()).sources;
  // 真实分享本人已经收到的救援来源；不塞观察数组、不改 provenance。
  const p=(await r.snapshot(0)).projection,source=p.observations.find(o=>o.source?.label==='侧窗本人回应'),c=await r.entity(0,'翠兰');
  for(let i=0;i<260;i++)accepted(await r.send(0,{kind:'share_evidence',evidenceRef:source.observationRef,recipientRefs:[c.entityRef]}));
  await r.drain();const own=(await r.snapshot('cuilan')).projection;assert.equal(own.observations.length,256);assert.ok(!own.observations.some(o=>o.source?.kind==='archive'));
  const after=await read();assert.deepEqual(after.sources,original);assert.equal(after.input.knowledge.routesReady,true);assert.equal(after.input.knowledge.rescue,true);
  assert.equal((await db.pool.query("SELECT count(*) FROM world_events WHERE session_id=$1 AND event->>'kind'='spatial.observation' AND event->'payload'->'observation'->'source'->>'label' IN ('前院客房路线图记','庄口至茶棚路线图记')",[r.sessionId])).rows[0].count,'2');
  const identity=r;await r.network.close();await server.close();server=await createAuthorityServer({pool:db.pool,now:()=>clock.value});r=await resumeSceneRoom(server,clock,identity);
  const newHandle=r.actors.get('cuilan').handle,fresh=await server.runtime.locked(r.sessionId,{kind:'scene-source-check'},tx=>scenePolicyInput(tx,server.runtime.internal(newHandle)));assert.deepEqual(fresh.sources,original);
  assert.equal((await db.pool.query('SELECT count(*) FROM ai_runs WHERE session_id=$1',[r.sessionId])).rows[0].count,'0');
});

test('GZ-SP05/06核对标记COMMIT返回丢失仍恢复原Receipt；终态只恢复原结果',async t=>{
  const db=await startTestPostgres('scene-settle-unknown',{outputSubdirectory:'scene-policy-implementation'}),clock={value:Date.parse('2026-11-13T18:00:00Z')};let server,r,lost=false,armed=false;
  const hooks={afterCommit({command}){if(armed&&!lost&&command==='scene-policy-recover'){lost=true;throw new Error('核对标记已提交但返回丢失');}}};
  t.after(async()=>{await r?.network.close();await server?.close();await db.stop();});
  server=await createAuthorityServer({pool:db.pool,now:()=>clock.value,hooks});r=await scenePolicyRoom(server,clock);await r.go(0,r.C('C04'));armed=true;accepted(await r.interact(0,'侧窗联络点','gz-contact'));await r.drain();assert.ok(lost);
  const receipt=r.sceneStatus().lastReceipt;assert.equal(receipt.status,'Accepted');assert.equal(r.sceneStatus().intentId,null);assert.deepEqual(await server.runtime.internalReceipt(r.actors.get('cuilan').handle,receipt.clientActionId),receipt);
  const beforeCount=(await db.pool.query("SELECT count(*) FROM spatial_intents WHERE session_id=$1 AND execution_context->>'mode'='scene-policy'",[r.sessionId])).rows[0].count;
  await server.runtime.abortSession(r.sessionId,'本次测试按技术终止收束。');const state=await r.state();await server.scenePolicy.recover(r.sessionId);
  assert.equal((await r.state()).sessionSeq,state.sessionSeq);assert.equal((await db.pool.query("SELECT count(*) FROM spatial_intents WHERE session_id=$1 AND execution_context->>'mode'='scene-policy'",[r.sessionId])).rows[0].count,beforeCount);
});

test('GZ-SP06重启前已预留未提交：原旧epoch请求依法拒绝，新提议重建后走通',async t=>{
  const db=await startTestPostgres('scene-old-reservation',{outputSubdirectory:'scene-policy-implementation'}),clock={value:Date.parse('2026-11-13T19:00:00Z')};let server,r;
  t.after(async()=>{await r?.network.close();await server?.close();await db.stop();});
  server=await createAuthorityServer({pool:db.pool,now:()=>clock.value});r=await scenePolicyRoom(server,clock);await openSceneDoor(r);
  await server.scenePolicy.close();await r.propose('front-guest-room',0,{wait:false});
  // 故障窗口停在生产prepare的真实持久预留之后；没有测试构造的回应动作。
  const prepared=await server.runtime.prepareScenePolicy(r.actors.get('cuilan').handle);assert.equal(prepared.kind,'prepared');
  const original=(await db.pool.query('SELECT request,execution_context FROM spatial_intents WHERE session_id=$1 AND intent_id=$2',[r.sessionId,prepared.intentId])).rows[0];
  const old=r;await r.network.close();await server.close();server=await createAuthorityServer({pool:db.pool,now:()=>clock.value});
  await until(()=>server.scenePolicy.status().actors[0]?.phase==='Idle'&&!server.scenePolicy.status().actors[0]?.bootstrap,'重启先终结旧预留');
  const receipt=server.scenePolicy.status().actors[0].lastReceipt;assert.equal(receipt.clientActionId,prepared.intentId);assert.equal(receipt.code,'STALE_CONTROL');
  assert.deepEqual((await db.pool.query('SELECT request,execution_context FROM spatial_intents WHERE session_id=$1 AND intent_id=$2',[old.sessionId,prepared.intentId])).rows[0],original);
  r=await resumeSceneRoom(server,clock,old);assert.equal((await r.snapshot('cuilan')).projection.chapter.follows[0].status,'paused');assert.equal((await r.propose('tea-back-room')).status,'accepted');
  for(const at of [r.C('C01'),r.C('C20'),r.R('R02'),r.R('R06'),r.R('R04'),r.R('R05')]){await r.go(0,at);await r.drain();}
  for(let i=0;i<10&&!(await r.state()).chapter.cuilanSafe;i++)await r.step(500);
  assert.equal((await r.state()).chapter.safeRecord.destinationId,'tea-back-room');
});

test('GZ-SP06两真人实际结束后原准备迟到：只留拒绝Receipt，终态seq与世界不变',async t=>{
  const db=await startTestPostgres('scene-terminal-late',{outputSubdirectory:'scene-policy-implementation'}),clock={value:Date.parse('2026-11-13T20:00:00Z')},entered=deferred(),release=deferred();let server,r,id,held=false;
  t.after(async()=>{release.resolve();await r?.network.close();await server?.close();await db.stop();});
  server=await createAuthorityServer({pool:db.pool,now:()=>clock.value});r=await scenePolicyRoom(server,clock);await openSceneDoor(r);
  const submit=server.runtime.submitSpatialIntent.bind(server.runtime);server.runtime.submitSpatialIntent=async(h,intentId)=>{if(h.actorId===r.content.chapterRules.people.cuilan&&!held){held=true;id=intentId;entered.resolve();await release.promise;}return submit(h,intentId);};
  await r.propose('front-guest-room',0,{wait:false});await entered.promise;
  accepted(await r.send(0,{kind:'request_end',proposalId:crypto.randomUUID(),proposalVersion:'0',scope:'chapter'}));
  const end=(await r.snapshot(1)).projection.chapter.endProposal;accepted(await r.send(1,{kind:'confirm_end',proposalId:end.proposalId,proposalVersion:end.proposalVersion}));
  const finished=await r.state();assert.equal(finished.phase,'Finished');release.resolve();await r.drain();
  assert.equal((await server.runtime.internalReceipt(r.actors.get('cuilan').handle,id)).status,'Rejected');assert.deepEqual(await r.state(),finished);
});
