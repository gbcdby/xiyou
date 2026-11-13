import test from 'node:test';
import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createAuthorityServer} from '../server.mjs';
import {startTestPostgres} from '../test-support/postgres.mjs';
import {scenePolicyRoom,openSceneDoor} from '../test-support/scene-policy-room.mjs';
import {deferred,until} from '../test-support/ai-room.mjs';
import {accepted} from '../test-support/gaolao-room.mjs';

async function reconnect(r,index){
  const socket=await r.network.openConnection(r.users[index].token,['spatial-v2']),snapshot=await r.network.subscribe(socket,r.sessionId);
  const response=await r.network.control(socket,JSON.stringify({schemaVersion:2,type:'control.resume',sessionId:r.sessionId,viewId:snapshot.viewId,actorRef:snapshot.projection.self.entityRef,nonce:crypto.randomUUID()}));assert.equal(response.schemaVersion,2);
  r.handles[index]=socket;r.actors.get(index).handle=socket;return response;
}
for(const window of ['before-begin','after-read','settling'])test(`GZ-SP05真实PG恢复${window}：原accept先收束，新来源/resume/提议保留且分别一次`,async t=>{
  const db=await startTestPostgres('scene-recovery',{outputSubdirectory:'scene-policy-implementation'}),clock={value:Date.parse('2026-11-13T12:00:00Z')},scope=new AsyncLocalStorage(),entered=deferred(),release=deferred();
  let server,r,armed=false,lost=false,held=false,originalId=null;
  const pool={query:(...a)=>db.pool.query(...a),connect:async()=>{const c=await db.pool.connect();if(window==='before-begin'&&scope.getStore()&&!held){held=true;entered.resolve();await release.promise;}return c;}};
  const hooks={async afterCommit({command,events}){
    if(armed&&!lost&&command==='spatial-intent-submit'&&events.some(e=>e.kind==='gaolao.chapter'&&Object.values(e.payload.chapter.consents).some(c=>c.purpose==='follow'&&c.status==='accepted'))){lost=true;originalId=events.find(e=>e.causedBy.principalId.startsWith('scene_role:')).causedBy.actionId;throw new Error('真实提交成功后的返回丢失');}
    if(window==='after-read'&&command==='scene-policy-recover'&&scope.getStore()&&!held){held=true;entered.resolve();await release.promise;}
  }};
  t.after(async()=>{release.resolve();await r?.network.close();await server?.close();await db.stop();});
  server=await createAuthorityServer({pool,now:()=>clock.value,hooks});r=await scenePolicyRoom(server,clock);await openSceneDoor(r);
  const recover=server.runtime.recoverScenePolicy.bind(server.runtime);
  server.runtime.recoverScenePolicy=handle=>lost?scope.run(true,async()=>{const result=await recover(handle);if(window==='settling'&&!held){held=true;entered.resolve();await release.promise;}return result;}):recover(handle);
  const notices=[];server.runtime.on('commit',n=>{if(n.sessionId===r.sessionId)notices.push(structuredClone(n));});
  armed=true;await r.propose('front-guest-room',0,{wait:false});await entered.promise;
  const original=(await db.pool.query('SELECT request,execution_context FROM spatial_intents WHERE session_id=$1 AND intent_id=$2',[r.sessionId,originalId])).rows[0];assert.ok(original);
  const prior=(await db.pool.query('SELECT receipt FROM action_receipts WHERE session_id=$1 AND client_action_id=$2',[r.sessionId,originalId])).rows[0].receipt.publicReceipt;assert.equal(prior.status,'Accepted');
  // 三类均为实际提交事件，不合成来源、不伪造paused返回值。
  r.handles[1].disconnect();await until(async()=>{await server.runtime.maintenance(r.sessionId);return (await r.state()).paused;},'真实离线必须暂停');
  await reconnect(r,1);assert.equal((await r.state()).paused,false);
  const own=(await r.snapshot(0)).projection,source=own.observations.find(o=>o.source?.label==='侧窗本人回应'),cuilan=await r.entity(0,'翠兰');
  accepted(await r.send(0,{kind:'share_evidence',evidenceRef:source.observationRef,recipientRefs:[cuilan.entityRef]}));
  const proposal=await r.propose('tea-back-room',0,{wait:false});assert.equal(proposal.status,'proposed');
  assert.equal((await db.pool.query("SELECT count(*) FROM spatial_intents WHERE session_id=$1 AND request->'action'->>'kind'='respond_consent'",[r.sessionId])).rows[0].count,'1','旧结果收束前不得产生新身份');
  assert.ok(BigInt(r.sceneStatus().pendingSemanticSeq)>0n);release.resolve();await r.drain();
  assert.equal((await r.snapshot('cuilan')).projection.chapter.consents.filter(c=>c.purpose==='follow').at(-1).status,'accepted');
  assert.deepEqual((await db.pool.query('SELECT request,execution_context FROM spatial_intents WHERE session_id=$1 AND intent_id=$2',[r.sessionId,originalId])).rows[0],original);
  assert.deepEqual(await server.runtime.internalReceipt(r.actors.get('cuilan').handle,originalId),prior);
  assert.equal((await db.pool.query("SELECT count(*) FROM spatial_intents WHERE session_id=$1 AND request->'action'->>'kind'='respond_consent'",[r.sessionId])).rows[0].count,'2');
  const count=r.sceneStatus().evaluations;await server.scenePolicy.recover(r.sessionId);await r.drain();assert.equal(r.sceneStatus().evaluations,count,'纯技术恢复不能重做选择');
  for(const notice of [...notices].reverse())server.runtime.emit('commit',notice);
  await r.drain();assert.equal(r.sceneStatus().evaluations,count,'重复/乱序送达已消费的真实通知不重新选择');
});

for(const failure of ['rollback-before-commit','lost-prepare-return'])test(`GZ-SP05预留事务 ${failure}：真实回滚或查回原预留，导航序号不重复`,async t=>{
  const db=await startTestPostgres('scene-prepare-fault',{outputSubdirectory:'scene-policy-implementation'}),clock={value:Date.parse('2026-11-13T21:00:00Z')};let server,r,armed=false,failed=false;
  const fail=({command})=>{if(armed&&!failed&&command==='scene-policy-prepare'){failed=true;throw Object.assign(new Error('限定预留事务故障'),{code:'40001'});}};
  const hooks=failure==='rollback-before-commit'?{beforeCommit:fail}:{afterCommit:fail};
  t.after(async()=>{await r?.network.close();await server?.close();await db.stop();});
  server=await createAuthorityServer({pool:db.pool,now:()=>clock.value,hooks});r=await scenePolicyRoom(server,clock);await r.go(0,r.C('C04'));armed=true;
  accepted(await r.interact(0,'侧窗联络点','gz-contact'));await r.drain();assert.ok(failed);
  const rows=(await db.pool.query("SELECT request,execution_context,scene_outcome FROM spatial_intents WHERE session_id=$1 AND execution_context->>'mode'='scene-policy'",[r.sessionId])).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].request.action.movementCommandSeq,'1');assert.equal(rows[0].scene_outcome.status,'Accepted');assert.equal(rows[0].execution_context.scenePolicyBasis.attempt,1);
  for(let i=0;i<10&&!(await r.state()).chapter.retreated;i++)await r.step(500);
  assert.equal((await r.state()).chapter.retreated,true);
});

test('GZ-SP05确定无动作的评估读后到返回前，真实新联络水位仍触发一次退让',async t=>{
  const db=await startTestPostgres('scene-no-action-race',{outputSubdirectory:'scene-policy-implementation'}),clock={value:Date.parse('2026-11-13T22:00:00Z')},entered=deferred(),release=deferred();let server,r,armed=false,held=false;
  const hooks={async afterCommit({command}){if(armed&&!held&&command==='scene-policy-prepare'){held=true;entered.resolve();await release.promise;}}};
  t.after(async()=>{release.resolve();await r?.network.close();await server?.close();await db.stop();});
  server=await createAuthorityServer({pool:db.pool,now:()=>clock.value,hooks});r=await scenePolicyRoom(server,clock);
  r.handles[1].disconnect();await until(async()=>{await server.runtime.maintenance(r.sessionId);return (await r.state()).paused;},'正常暂停');
  armed=true;await reconnect(r,1);await entered.promise;await r.go(0,r.C('C04'));accepted(await r.interact(0,'侧窗联络点','gz-contact'));assert.ok(BigInt(r.sceneStatus().pendingSemanticSeq)>0n);
  release.resolve();await r.drain();for(let i=0;i<10&&!(await r.state()).chapter.retreated;i++)await r.step(500);
  assert.equal((await r.state()).chapter.retreated,true);assert.equal((await db.pool.query("SELECT count(*) FROM spatial_intents WHERE session_id=$1 AND request->'action'->>'operationId'='gz-step-back'",[r.sessionId])).rows[0].count,'1');
});

test('GZ-SP05真实COMMIT丢返回加原生57014：有界保留原ID/请求/seq，显式恢复只收据',async t=>{
  const db=await startTestPostgres('scene-unknown',{outputSubdirectory:'scene-policy-implementation'}),clock={value:Date.parse('2026-11-13T13:00:00Z')},scope=new AsyncLocalStorage();
  let server,r,lost=false,armed=false,failQueries=100,lookups=0,id=null;
  const pool={query:(...a)=>db.pool.query(...a),connect:async()=>{
    const c=await db.pool.connect(),query=c.query.bind(c);
    c.query=async(text,...args)=>{
      if(scope.getStore()&&typeof text==='string'&&text.startsWith('SELECT receipt,semantic_digest,actor_id FROM action_receipts')&&failQueries-- >0){lookups++;await query("SET LOCAL statement_timeout='1ms'");await query('SELECT pg_sleep(0.04)');}
      return query(text,...args);
    };
    const release=c.release.bind(c);c.release=(...a)=>{c.query=query;c.release=release;return release(...a);};return c;
  }};
  const hooks={afterCommit({command,events}){if(armed&&!lost&&command==='spatial-intent-submit'&&events.some(e=>e.causedBy.principalId.startsWith('scene_role:'))){lost=true;id=events.find(e=>e.causedBy.principalId.startsWith('scene_role:')).causedBy.actionId;throw new Error('丢失原受理返回');}}};
  t.after(async()=>{failQueries=0;await r?.network.close();await server?.close();await db.stop();});
  server=await createAuthorityServer({pool,now:()=>clock.value,hooks});r=await scenePolicyRoom(server,clock);
  const recover=server.runtime.recoverScenePolicy.bind(server.runtime);server.runtime.recoverScenePolicy=h=>lost?scope.run(true,()=>recover(h)):recover(h);
  await r.go(0,r.C('C04'));armed=true;accepted(await r.interact(0,'侧窗联络点','gz-contact'));
  await until(()=>lookups===3&&r.sceneStatus().phase==='Unknown','初次失败后最多三次真实查询重试',4000);
  const before=(await db.pool.query('SELECT request,execution_context FROM spatial_intents WHERE session_id=$1 AND intent_id=$2',[r.sessionId,id])).rows[0],status=r.sceneStatus();assert.ok(before);assert.equal(before.request.action.kind,'move_to');
  assert.equal((await r.state()).chapter.retreated,false,'受理不是实际退让');
  await new Promise(resolve=>setTimeout(resolve,350));assert.equal(lookups,3);assert.equal(r.sceneStatus().intentId,id);assert.equal(r.sceneStatus().technicalRetries,3);
  failQueries=0;await server.scenePolicy.recover(r.sessionId);await r.drain();assert.equal(r.sceneStatus().lastReceipt.clientActionId,id);assert.equal(r.sceneStatus().evaluations,status.evaluations);
  assert.deepEqual((await db.pool.query('SELECT request,execution_context FROM spatial_intents WHERE session_id=$1 AND intent_id=$2',[r.sessionId,id])).rows[0],before);
  assert.equal((await db.pool.query('SELECT count(*) FROM action_receipts WHERE session_id=$1 AND client_action_id=$2',[r.sessionId,id])).rows[0].count,'1');
  for(let i=0;i<10&&!(await r.state()).chapter.retreated;i++)await r.step(1000);
  assert.equal((await r.state()).chapter.retreated,true);
});
