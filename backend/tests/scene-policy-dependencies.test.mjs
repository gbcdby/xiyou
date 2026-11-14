import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthorityServer} from '../server.mjs';
import {startTestPostgres} from '../test-support/postgres.mjs';
import {scenePolicyRoom,openSceneDoor} from '../test-support/scene-policy-room.mjs';
import {deferred} from '../test-support/ai-room.mjs';

async function setup(t){
  const db=await startTestPostgres('scene-dependencies',{outputSubdirectory:'scene-policy-std001-fix'}),clock={value:Date.parse('2026-11-13T23:50:00Z')};
  let server,r;const releases=[];
  t.after(async()=>{for(const release of releases)release();await r?.network.close();await server?.close();await db.stop();});
  server=await createAuthorityServer({pool:db.pool,now:()=>clock.value});r=await scenePolicyRoom(server,clock);await openSceneDoor(r);
  return {db,server,r,releases};
}
async function holdAction({db,server,r,releases},matches){
  const entered=deferred(),release=deferred(),submit=server.runtime.submitSpatialIntent.bind(server.runtime);let original,id;
  server.runtime.submitSpatialIntent=async(handle,intentId)=>{
    if(!original&&handle.actorId===r.content.chapterRules.people.cuilan){
      const row=(await db.pool.query('SELECT request,execution_context FROM spatial_intents WHERE session_id=$1 AND intent_id=$2',[r.sessionId,intentId])).rows[0];
      if(matches(row.request.action)){original=row;id=intentId;entered.resolve();await release.promise;}
    }
    return submit(handle,intentId);
  };
  releases.push(()=>release.resolve());
  return {entered:entered.promise,release:()=>release.resolve(),get original(){return original;},get id(){return id;}};
}
async function unchangedOriginal({db,server,r},gate,status){
  const receipt=await server.runtime.internalReceipt(r.actors.get('cuilan').handle,gate.id);
  assert.equal(receipt.status,status);
  assert.deepEqual((await db.pool.query('SELECT request,execution_context FROM spatial_intents WHERE session_id=$1 AND intent_id=$2',[r.sessionId,gate.id])).rows[0],gate.original,'完整原请求、basis、动作摘要与身份不改写');
  assert.equal((await db.pool.query('SELECT count(*) FROM action_receipts WHERE session_id=$1 AND client_action_id=$2',[r.sessionId,gate.id])).rows[0].count,'1');
  return receipt;
}

for(const destination of ['front-guest-room','tea-back-room'])test(`GZ-SP04/07 ${destination} 撤回在途领路者实际返回：本人偏离结果仍有效，原ID一次撤回`,async t=>{
  const env=await setup(t),{r,server,db}=env;await r.propose(destination);
  const gate=await holdAction(env,a=>a.kind==='withdraw_consent');
  await r.go(0,r.C('C15'));await gate.entered;
  assert.equal((await r.state()).chapter.follows[r.content.chapterRules.people.cuilan].policyPause,'deviation');
  const notices=[];server.runtime.on('commit',n=>{if(n.sessionId===r.sessionId)notices.push(structuredClone(n));});
  await r.go(0,r.C('C08'));gate.release();await r.drain();
  await unchangedOriginal(env,gate,'Accepted');
  const state=await r.state(),follow=state.chapter.follows[r.content.chapterRules.people.cuilan];
  assert.equal(follow.status,'withdrawn');assert.equal(state.chapter.consents[follow.consentId].status,'withdrawn');
  assert.equal((await db.pool.query("SELECT count(*) FROM spatial_intents WHERE session_id=$1 AND request->'action'->>'kind'='withdraw_consent'",[r.sessionId])).rows[0].count,'1');
  const count=r.sceneStatus().evaluations;
  for(const n of [...notices].reverse())for(let i=0;i<2;i++)server.runtime.emit('commit',n);
  await r.drain();for(const at of [r.C('C17'),r.C('C18'),r.C('C03')])await r.go(1,at);await r.step(500);
  assert.equal(r.sceneStatus().evaluations,count,'重复/倒序旧通知、旁观者移动与普通clock不新评估');
  assert.equal((await db.pool.query('SELECT count(*) FROM ai_runs WHERE session_id=$1',[r.sessionId])).rows[0].count,'0');
});

test('GZ-SP04/05撤回在途领路者epoch变化：旧basis拒绝，新合法边界保留并只重评一次',async t=>{
  const env=await setup(t),{r,server,db}=env;await r.propose('front-guest-room');
  const gate=await holdAction(env,a=>a.kind==='withdraw_consent');await r.go(0,r.C('C15'));await gate.entered;
  const notices=[];server.runtime.on('commit',n=>{if(n.sessionId===r.sessionId)notices.push(structuredClone(n));});
  const snapshot=await r.snapshot(0);
  await r.network.control(r.handles[0],JSON.stringify({schemaVersion:2,type:'control.take',sessionId:r.sessionId,viewId:snapshot.viewId,actorRef:snapshot.projection.self.entityRef,nonce:crypto.randomUUID()}));
  const changed=await r.state(),follow=changed.chapter.follows[r.content.chapterRules.people.cuilan];
  assert.notEqual(changed.characters[follow.leaderId].controlEpoch,gate.original.execution_context.scenePolicyBasis.leaderEpoch);
  assert.ok(notices.some(n=>n.scenePolicyWake?.relevant),'仅真实epoch变更必须产生语义通知');
  const through=r.sceneStatus().pendingSemanticSeq;assert.ok(BigInt(through)>BigInt(gate.original.request.baseSeq));
  gate.release();await r.drain();assert.equal((await unchangedOriginal(env,gate,'Rejected')).code,'STALE_PRECONDITION');
  assert.equal((await r.state()).chapter.follows[follow.subjectId].status,'withdrawn');
  const rows=(await db.pool.query("SELECT intent_id,execution_context,scene_outcome FROM spatial_intents WHERE session_id=$1 AND request->'action'->>'kind'='withdraw_consent' ORDER BY (execution_context->'scenePolicyBasis'->>'attempt')::integer",[r.sessionId])).rows;
  assert.equal(rows.length,2);assert.equal(rows[0].scene_outcome.status,'Rejected');assert.equal(rows[1].scene_outcome.status,'Accepted');
  assert.equal(rows[1].execution_context.scenePolicyBasis.previousIntentId,gate.id);assert.ok(BigInt(r.sceneStatus().lastSemanticSeq)>=BigInt(through));
});

test('GZ-SP04撤回在途有真正新提议：保留旧拒绝，不把旧偏离结果用于撤回新许可',async t=>{
  const env=await setup(t),{r}=env;await r.propose('front-guest-room');
  const gate=await holdAction(env,a=>a.kind==='withdraw_consent');await r.go(0,r.C('C15'));await gate.entered;
  const state=await r.state(),subject=state.characters[r.content.chapterRules.people.cuilan];
  await r.go(0,{sceneId:subject.sceneId,position:subject.position});const proposed=await r.propose('tea-back-room',0,{wait:false});
  gate.release();await r.drain();assert.equal((await unchangedOriginal(env,gate,'Rejected')).code,'STALE_PRECONDITION');
  const current=await r.state(),follow=current.chapter.follows[subject.characterId];
  assert.equal(follow.consentId,proposed.consentId);assert.equal(current.chapter.consents[proposed.consentId].status,'accepted');
});

test('GZ-SP03到达确认在途领路者沿合法路线离开近距：实际到达和自由出口不因无关资格变化丢失',async t=>{
  const env=await setup(t),{r}=env;await r.propose('front-guest-room');
  const gate=await holdAction(env,a=>a.operationId==='gz-confirm-settlement');
  for(const at of [r.C('C01'),r.C('C13'),r.C('C11'),r.C('C12')])await r.go(0,at);await gate.entered;
  const before=await r.state(),subject=before.characters[r.content.chapterRules.people.cuilan];
  await r.go(0,r.C('C13'));const moved=await r.state();
  assert.equal(moved.chapter.follows[subject.characterId].status,'arrived');assert.deepEqual(moved.characters[subject.characterId].position,subject.position);
  gate.release();await r.drain();await unchangedOriginal(env,gate,'Accepted');
  const final=await r.state();assert.equal(final.chapter.cuilanSafe,true);assert.equal(final.chapter.safeRecord.destinationId,'front-guest-room');
});
