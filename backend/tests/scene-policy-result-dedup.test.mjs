import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthorityServer} from '../server.mjs';
import {attachScenePolicies} from '../scene-policy-runtime.mjs';
import {startTestPostgres} from '../test-support/postgres.mjs';
import {scenePolicyRoom,openSceneDoor} from '../test-support/scene-policy-room.mjs';
import {deferred,until} from '../test-support/ai-room.mjs';

async function resume(r,index=1){
  const handle=await r.network.openConnection(r.users[index].token,['spatial-v2']),s=await r.network.subscribe(handle,r.sessionId);
  await r.network.control(handle,JSON.stringify({schemaVersion:2,type:'control.resume',sessionId:r.sessionId,viewId:s.viewId,actorRef:s.projection.self.entityRef,nonce:crypto.randomUUID()}));
  r.handles[index]=handle;r.actors.get(index).handle=handle;
}
async function rejectedWithdrawal(t,{unknown=false}={}){
  const db=await startTestPostgres('scene-result-dedup',{outputSubdirectory:'scene-policy-std002-fix'}),clock={value:Date.parse('2026-11-13T23:55:00Z')};
  const entered=deferred(),submitRelease=deferred(),recoverEntered=deferred(),recoverRelease=deferred(),releases=[()=>submitRelease.resolve(),()=>recoverRelease.resolve()],controllers=[];
  let server,r,id,original,armed=false,lost=false,recoverHeld=false;
  t.after(async()=>{for(const release of releases)release();for(const controller of controllers)await controller.close();await r?.network.close();await server?.close();await db.stop();});
  server=await createAuthorityServer({pool:db.pool,now:()=>clock.value});r=await scenePolicyRoom(server,clock);await openSceneDoor(r);await r.propose('front-guest-room');
  const submit=server.runtime.submitSpatialIntent.bind(server.runtime),recover=server.runtime.recoverScenePolicy.bind(server.runtime);
  server.runtime.submitSpatialIntent=async(handle,intentId)=>{
    if(!original&&handle.actorId===r.content.chapterRules.people.cuilan){
      const row=(await db.pool.query('SELECT request,execution_context FROM spatial_intents WHERE session_id=$1 AND intent_id=$2',[r.sessionId,intentId])).rows[0];
      if(row.request.action.kind==='withdraw_consent'){original=row;id=intentId;entered.resolve();await submitRelease.promise;}
    }
    return submit(handle,intentId);
  };
  server.runtime.hooks.afterCommit=({command})=>{if(unknown&&armed&&!lost&&command==='spatial-intent-submit'){lost=true;throw new Error('原拒绝已COMMIT但返回丢失');}};
  server.runtime.recoverScenePolicy=async handle=>{if(lost&&!recoverHeld){recoverHeld=true;recoverEntered.resolve();await recoverRelease.promise;}return recover(handle);};
  await r.go(0,r.C('C15'));await entered.promise;
  r.handles[1].disconnect();await until(async()=>{await server.runtime.maintenance(r.sessionId);return (await r.state()).paused;},'非领路者真实断连后暂停');
  armed=true;submitRelease.resolve();if(unknown)await recoverEntered.promise;else await r.drain();
  const receipt=(await db.pool.query('SELECT receipt FROM action_receipts WHERE session_id=$1 AND client_action_id=$2',[r.sessionId,id])).rows[0].receipt.publicReceipt;
  assert.equal(receipt.status,'Rejected');assert.equal(receipt.code,'STALE_PRECONDITION');
  const rows=async()=>(await db.pool.query("SELECT intent_id,request,execution_context,scene_outcome FROM spatial_intents WHERE session_id=$1 AND request->'action'->>'kind'='withdraw_consent' ORDER BY (execution_context->'scenePolicyBasis'->>'attempt')::integer",[r.sessionId])).rows;
  const notices=[];server.runtime.on('commit',n=>{if(n.sessionId===r.sessionId)notices.push(structuredClone(n));});
  return {db,server,r,id,original,receipt,rows,notices,releases,controllers,recoverRelease};
}
async function completedOnce(env){
  const {db,server,r,id,original,receipt,rows,notices}=env;await r.drain();
  const state=await r.state();assert.equal(state.chapter.follows[r.content.chapterRules.people.cuilan].status,'withdrawn');
  const attempts=await rows();assert.equal(attempts.length,2);assert.equal(attempts[0].scene_outcome.status,'Rejected');assert.equal(attempts[1].scene_outcome.status,'Accepted');
  assert.equal(attempts[1].execution_context.scenePolicyBasis.previousIntentId,id);assert.equal(attempts[1].execution_context.scenePolicyBasis.attempt,2);
  for(const [key,value] of Object.entries(original.execution_context.scenePolicyBasis))if(!['actionId','requestDigest','evaluatedThroughSeq','previousIntentId','attempt'].includes(key))assert.deepEqual(attempts[1].execution_context.scenePolicyBasis[key],value,`当前同一依据 ${key} 的新尝试来自真实resume`);
  assert.notEqual(attempts[1].request.clientActionId,id);assert.deepEqual(attempts[1].request.action,original.request.action);assert.ok(BigInt(attempts[1].request.baseSeq)>BigInt(receipt.observedSeq));
  assert.deepEqual({request:attempts[0].request,execution_context:attempts[0].execution_context},original);
  assert.deepEqual(await server.runtime.internalReceipt(r.actors.get('cuilan').handle,id),receipt,'原Rejected不能被新成功改写');
  const count=r.sceneStatus().evaluations;await server.scenePolicy.recover(r.sessionId);await r.drain();assert.equal(r.sceneStatus().evaluations,count,'纯恢复不重做正常评估');
  for(const notice of [...notices].reverse())for(let i=0;i<2;i++)server.runtime.emit('commit',notice);
  await r.drain();await r.go(1,r.C('C18'));await r.step(500);assert.equal(r.sceneStatus().evaluations,count,'已消费通知、无关移动和clock不生成重试');
  r.handles[1].disconnect();await until(async()=>{await server.runtime.maintenance(r.sessionId);return (await r.state()).paused;},'成功后正常暂停');
  await resume(r);await r.drain();assert.equal((await rows()).length,2,'成功步骤遇新的真实resume仍不重复');
  assert.equal((await db.pool.query('SELECT count(*) FROM action_receipts WHERE session_id=$1 AND client_action_id=$2',[r.sessionId,id])).rows[0].count,'1');
  assert.equal((await db.pool.query('SELECT count(*) FROM ai_runs WHERE session_id=$1',[r.sessionId])).rows[0].count,'0');
}

for(const timing of ['before-read','late-notice'])test(`GZ-SP05 Rejected后初始化捕获旧语义，真实resume ${timing}仍只产生一次新尝试`,async t=>{
  const env=await rejectedWithdrawal(t),{server,r,receipt,rows,releases,controllers}=env;
  await server.scenePolicy.recover(r.sessionId);await r.drain();assert.equal((await rows()).length,1,'无新语义的原结果恢复不生成动作');
  await server.scenePolicy.close();
  const prepareEntered=deferred(),prepareRelease=deferred(),noticeEntered=deferred(),noticeRelease=deferred();releases.push(()=>prepareRelease.resolve(),()=>noticeRelease.resolve());
  const prepare=server.runtime.prepareScenePolicy.bind(server.runtime);let captured,firstResult,first=true,resumeSeq;
  server.runtime.prepareScenePolicy=async(handle,options)=>{
    if(first){first=false;captured=structuredClone(options);prepareEntered.resolve();await prepareRelease.promise;firstResult=await prepare(handle,options);return firstResult;}
    return prepare(handle,options);
  };
  server.scenePolicy=await attachScenePolicies({runtime:server.runtime});controllers.push(server.scenePolicy);await prepareEntered.promise;
  assert.equal(captured.semanticSeq,'0','真实新登记在初始化时还没有收到resume');
  if(timing==='late-notice')server.runtime.hooks.afterCommit=async({command,events})=>{
    const event=events.find(e=>e.kind==='spatial.clock'&&e.payload.paused===false);
    if(command==='control.resume'&&event&&!resumeSeq){resumeSeq=event.sessionSeq;noticeEntered.resolve();await noticeRelease.promise;}
  };
  const resuming=resume(r);
  if(timing==='late-notice'){
    await noticeEntered.promise;assert.equal((await r.state()).paused,false,'resume真实COMMIT，只有通知返回暂存');
    prepareRelease.resolve();await r.drain();assert.equal((await rows()).length,1);
    assert.ok(BigInt(firstResult.evaluatedThroughSeq)>=BigInt(resumeSeq),'本次实际读态已包含恢复');
    assert.ok(BigInt(r.sceneStatus().lastSemanticSeq)<BigInt(resumeSeq),'等待旧拒绝后的语义不能提前消费尚未收到的resume');
    noticeRelease.resolve();await resuming;
  }else{
    await resuming;assert.ok(BigInt(r.sceneStatus().pendingSemanticSeq)>BigInt(receipt.observedSeq));prepareRelease.resolve();
  }
  await completedOnce(env);assert.equal(firstResult.kind,'idle');assert.equal(firstResult.consumeThroughSeq,'0');
});

test('GZ-SP05 原Rejected COMMIT返回丢失时收到resume，先收束原身份再独立新尝试',async t=>{
  const env=await rejectedWithdrawal(t,{unknown:true}),{r,rows,receipt,recoverRelease}=env;
  await resume(r);assert.ok(BigInt(r.sceneStatus().pendingSemanticSeq)>BigInt(receipt.observedSeq));
  assert.equal((await rows()).length,1,'原Unknown未收束前不得产生第二动作身份');
  recoverRelease.resolve();await completedOnce(env);
});
