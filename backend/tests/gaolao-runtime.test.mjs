import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {startTestPostgres} from '../test-support/postgres.mjs';
import {createRuntime} from '../runtime.mjs';
import {gaolaoRoom,accepted} from '../test-support/gaolao-room.mjs';
let db,runtime;const clock={value:Date.parse('2026-11-12T18:00:00Z')};
before(async()=>{db=await startTestPostgres('gaolao-runtime',{outputSubdirectory:'adv001-32'});runtime=await createRuntime({pool:db.pool,now:()=>clock.value});});
after(async()=>{await runtime?.close();await db?.stop();});
test('真实PG：章节角色装配、内部scene_role身份及严格授权DTO',async()=>{
  const r=await gaolaoRoom(runtime,clock,2),s=await r.snapshot(0);
  assert.deepEqual(s.projection.chapter.responsibilities,['A','B','D']);
  assert.equal(s.projection.reducerVersion,'gaolao-world-v1');
  await assert.rejects(runtime.bindInternal(r.sessionId,r.content.chapterRules.people.cuilan,'core_npc'),{code:'FORBIDDEN'});
  for(const bad of ['gz-wukong','gz-cuilan','principalId','actorKind','characterId'])assert.ok(!JSON.stringify(s).includes(bad),bad);
  assert.deepEqual(await runtime.replay(r.sessionId),(await db.pool.query('SELECT state FROM sessions WHERE session_id=$1',[r.sessionId])).rows[0].state);
  const own=await r.snapshot('cuilan');assert.equal(own.projection.self.name,'翠兰');
  const prepared=await runtime.prepareDecisionContext(r.actors.get('bajie').handle);assert.equal(prepared.decision.schemaVersion,2);assert.deepEqual(prepared.context.decision,{decisionId:prepared.decision.decisionId});
  assert.equal((await runtime.prepareDecision(r.actors.get('bajie').handle)).schemaVersion,2);
  await assert.rejects(runtime.prepareDecisionContext(r.actors.get('cuilan').handle),{code:'FORBIDDEN'});
});
test('真实PG：受信非移动意图保留NUL原文与原Receipt，系统终止后复盘仍完整',async()=>{
  const r=await gaolaoRoom(runtime,clock,2),handle=r.actors.get('bajie').handle,intentId=crypto.randomUUID(),text='原文\u0000与字面\\0、\\u0000均保留。',action={kind:'speak',text,channel:'public',recipientRefs:[]};
  const reserved=await runtime.reserveSpatialIntent(handle,intentId,action);assert.equal(reserved.action.text,text);
  assert.deepEqual(await runtime.reserveSpatialIntent(handle,intentId,action),reserved);const receipt=accepted(await runtime.submitSpatialIntent(handle,intentId));assert.deepEqual(await runtime.submitSpatialIntent(handle,intentId),receipt);assert.deepEqual(await runtime.internalReceipt(handle,intentId),receipt);
  assert.equal((await r.snapshot('bajie')).projection.claims.find(c=>c.text===text).text,text);
  const own=(await r.snapshot('bajie')).projection.self;await r.go(0,{sceneId:own.sceneId,position:own.position});accepted(await r.send('bajie',action));
  const reason='技术终止\u0000保留原文';await runtime.abortSession(r.sessionId,reason);const s=await r.snapshot(0),recap=await runtime.recap(r.users[0].token,r.sessionId,{throughSeq:s.snapshotSeq});assert.equal(s.projection.phase,'Aborted');assert.equal(recap.ending.summary,reason);assert.ok(recap.entries.some(e=>e.text===text));assert.ok(recap.entries.some(e=>e.text===reason));
});
test('真实PG：铜封安全前置、两人锁撑、本人随行实际到内室后确认且可重放',async()=>{
  const {rescue}=await import('../test-support/gaolao-room.mjs');const r=await gaolaoRoom(runtime,clock,2);await rescue(r);
  const state=await runtime.replay(r.sessionId);assert.equal(state.chapter.cuilanSafe,true);assert.equal(state.chapter.safeRecord.subjectId,r.content.chapterRules.people.cuilan);assert.equal(state.chapter.follows[r.content.chapterRules.people.cuilan].status,'settled');
  assert.equal(state.targets['gz-door'].fields.find(f=>f.key==='open').value,true);assert.equal(state.cooperations['gz-lock-support'].phase,'locked');
  assert.deepEqual(state,(await db.pool.query('SELECT state FROM sessions WHERE session_id=$1',[r.sessionId])).rows[0].state);
});
test('真实PG：完整公开查证与本人双决定、真实离庄后原子入队',async()=>{
  const {fullChapter}=await import('../test-support/gaolao-room.mjs');const r=await gaolaoRoom(runtime,clock,2);await fullChapter(r);
  const s=await r.snapshot(0);assert.equal(s.projection.ending.endingCode,'GZ-E01');assert.equal(s.projection.phase,'Finished');
  const recap=await runtime.recap(r.users[0].token,r.sessionId,{throughSeq:s.snapshotSeq});assert.equal(recap.schemaVersion,2);assert.ok(recap.entries.length);
  const late=await r.send(0,{kind:'wait'});assert.equal(late.code,'STALE_CONTROL');assert.equal((await runtime.replay(r.sessionId)).ending.endingCode,'GZ-E01');
});
test('真实PG：并发随行提议只接纳一个；代答、撤回旧确认、改约和掉线围栏',async()=>{
  const {openDoor}=await import('../test-support/gaolao-room.mjs'),r=await gaolaoRoom(runtime,clock,3);await openDoor(r);await r.go(1,r.C('C08'));
  const reqs=await Promise.all([0,1].map(async i=>{const s=await r.snapshot(i),c=await r.entity(i,'翠兰');return r.raw(i,{kind:'propose_follow',subjectRef:c.entityRef,leaderRef:s.projection.self.entityRef,destinationId:'front-guest-room',expectedConsentVersion:'0'});}));
  const receipts=await Promise.all(reqs.map((raw,i)=>runtime.submit(r.handles[i],raw)));assert.equal(receipts.filter(r=>r.status==='Accepted').length,1);assert.equal(receipts.filter(r=>r.code==='CONSENT_STALE').length,1);
  let own=(await r.snapshot('cuilan')).projection,c=own.chapter.consents.find(c=>c.purpose==='follow');
  assert.equal((await r.send(0,{kind:'respond_consent',consentId:c.consentId,expectedConsentVersion:c.version,response:'accept'})).code,'STALE_REFERENCE');
  accepted(await r.send('cuilan',{kind:'respond_consent',consentId:c.consentId,expectedConsentVersion:c.version,response:'accept'}));
  own=(await r.snapshot('cuilan')).projection;c=own.chapter.consents.find(c=>c.purpose==='follow');
  const staleId=crypto.randomUUID();await runtime.reserveSpatialIntent(r.actors.get('cuilan').handle,staleId,{kind:'interact',targetRef:own.self.entityRef,operationId:'gz-confirm-settlement',expectedTargetRevision:own.self.resourceRevision,parameters:{consentId:c.consentId,expectedConsentVersion:c.version}});
  accepted(await r.send('cuilan',{kind:'withdraw_consent',consentId:c.consentId,expectedConsentVersion:c.version}));assert.equal((await runtime.submitSpatialIntent(r.actors.get('cuilan').handle,staleId)).status,'Rejected');
  own=(await r.snapshot('cuilan')).projection;assert.equal(own.chapter.follows[0].status,'withdrawn');
  const latest=own.chapter.consents.find(c=>c.purpose==='follow'),s=await r.snapshot(0),real=await r.entity(0,'翠兰');accepted(await r.send(0,{kind:'propose_follow',subjectRef:real.entityRef,leaderRef:s.projection.self.entityRef,destinationId:'tea-back-room',expectedConsentVersion:latest.version}));
  c=(await r.snapshot('cuilan')).projection.chapter.consents.findLast(c=>c.purpose==='follow');assert.equal(c.status,'proposed');accepted(await r.send('cuilan',{kind:'respond_consent',consentId:c.consentId,expectedConsentVersion:c.version,response:'accept'}));
  await runtime.disconnect(r.handles[0]);await runtime.maintenance(r.sessionId);own=(await r.snapshot('cuilan')).projection;assert.equal(own.chapter.follows[0].status,'paused');assert.equal((await runtime.replay(r.sessionId)).chapter.cuilanSafe,false);
});
test('真实PG：茶棚目的地必须跨场景走到真实后间；安置后撤回不抹去安全事实',async()=>{
  const {rescue}=await import('../test-support/gaolao-room.mjs'),r=await gaolaoRoom(runtime,clock,2);await rescue(r,'tea-back-room');let s=await r.snapshot('cuilan');assert.equal(s.projection.self.sceneId,'gaolao-village-road');assert.deepEqual(s.projection.self.position,{...r.R('R05').position});const f=s.projection.chapter.follows[0];accepted(await r.send('cuilan',{kind:'withdraw_consent',consentId:f.consentId,expectedConsentVersion:f.consentVersion}));assert.equal((await runtime.replay(r.sessionId)).chapter.cuilanSafe,true);
});
test('真实PG：同貌双实体、旧引用、owner、内部工具、发生时台词与授权复盘隔离',async()=>{
  const {rescue,cleanupPublic,disguise,take,confirmEnd}=await import('../test-support/gaolao-room.mjs'),r=await gaolaoRoom(runtime,clock,3);await r.go(2,r.R('R03'));await rescue(r);await cleanupPublic(r);
  await r.go(0,r.C('C14'));await take(r,0,'公共绳索');await disguise(r);await r.go(2,r.C('C10'));
  const known=await r.snapshot(0),unknown=await r.snapshot('bajie');assert.ok(known.projection.entities.some(e=>e.name==='孙悟空（借貌）'));assert.ok(unknown.projection.entities.some(e=>e.name==='翠兰'));
  const safe=x=>{for(const forbidden of ['孙悟空','gz-wukong','characterId','actorKind','principalId','appearanceName'])assert.ok(!JSON.stringify(x).includes(forbidden),forbidden);};safe(unknown);safe(await runtime.spatialContext(r.actors.get('bajie').handle));
  const rope=await r.entity(0,'公共绳索'),bajie=await r.entity(0,'猪刚鬣');accepted(await r.send(0,{kind:'transfer_item',itemRef:rope.entityRef,expectedItemRevision:rope.resourceRevision,recipientRef:bajie.entityRef}));
  const ownRope=await r.entity('bajie','公共绳索'),fake=await r.entity('bajie','翠兰');const receipt=accepted(await r.send('bajie',{kind:'transfer_item',itemRef:ownRope.entityRef,expectedItemRevision:ownRope.resourceRevision,recipientRef:fake.entityRef}));safe(receipt);assert.equal((await runtime.replay(r.sessionId)).items['gz-rope'].location.characterId,r.content.chapterRules.people.wukong);
  const owner=(await r.snapshot('bajie')).projection.items.find(i=>i.name==='公共绳索');assert.equal(owner.location.ownerRef,fake.entityRef);
  await r.go('cuilan',r.C('C10'));const doubles=(await r.snapshot('bajie')).projection.entities.filter(e=>e.name==='翠兰');assert.equal(doubles.length,2);assert.notEqual(doubles[0].entityRef,doubles[1].entityRef);assert.deepEqual(doubles[0].availableOperations,doubles[1].availableOperations);
  assert.equal((await r.interact('wukong','self','gz-confirm-settlement',{consentId:(await r.snapshot('cuilan')).projection.chapter.follows[0].consentId,expectedConsentVersion:'2'})).code,'RULE_VIOLATION');
  accepted(await r.send('wukong',{kind:'speak',text:'我在此等你把旧事说清楚。',channel:'public',recipientRefs:[]}));accepted(await r.send(0,{kind:'speak',text:'队聊知道孙悟空，不是现场证据。',channel:'team',recipientRefs:[]}));assert.ok(!(await r.snapshot('bajie')).projection.claims.some(c=>c.text.includes('队聊')));
  await r.go(2,r.R('R03'));accepted(await r.interact(0,'孙悟空（借貌）','gz-reveal-identity'));
  assert.ok((await r.snapshot('bajie')).projection.entities.some(e=>e.name==='孙悟空（借貌）'));assert.equal((await r.snapshot('bajie')).projection.claims.find(c=>c.text==='我在此等你把旧事说清楚。').speakerName,'翠兰');
  await confirmEnd(r,'chapter');const final=await r.snapshot(2),recap=await runtime.recap(r.users[2].token,r.sessionId,{throughSeq:final.snapshotSeq});assert.equal(recap.entries.find(e=>e.text==='我在此等你把旧事说清楚。').speakerName,'翠兰');assert.ok(!recap.entries.some(e=>e.text.includes('现场获知：眼前')));
});
test('真实PG：借貌用途限制真实会面范围，撤回使旧外观引用与计划失效',async()=>{
  const {rescue,disguise}=await import('../test-support/gaolao-room.mjs'),r=await gaolaoRoom(runtime,clock,2);await rescue(r);await disguise(r);
  const denied=await r.send('wukong',{kind:'move_to',sceneId:'gaolao-courtyard',destination:r.C('C19').position});assert.equal(denied.code,'CONSENT_REQUIRED');
  const c=(await r.snapshot('cuilan')).projection.chapter.consents.findLast(c=>c.purpose==='appearance'),before=await r.snapshot('bajie'),ref=before.projection.entities.find(e=>e.name==='翠兰').entityRef;
  accepted(await r.send('cuilan',{kind:'withdraw_consent',consentId:c.consentId,expectedConsentVersion:c.version}));assert.equal((await r.send('bajie',{kind:'inspect',targetRef:ref})).code,'STALE_REFERENCE');assert.equal((await runtime.replay(r.sessionId)).chapter.cuilanSafe,true);
});
test('真实PG：借貌改约立即撤销旧许可的外貌，旧受信操作不能复用',async()=>{
  const {rescue,disguise}=await import('../test-support/gaolao-room.mjs'),r=await gaolaoRoom(runtime,clock,2);await rescue(r);await disguise(r);
  const own=await r.snapshot('wukong'),old=own.projection.chapter.consents.findLast(c=>c.purpose==='appearance'),intentId=crypto.randomUUID();
  await runtime.reserveSpatialIntent(r.actors.get('wukong').handle,intentId,{kind:'interact',targetRef:own.projection.self.entityRef,operationId:'gz-apply-appearance',expectedTargetRevision:own.projection.self.resourceRevision,parameters:{consentId:old.consentId,expectedConsentVersion:old.version}});
  await r.go(r.role('B'),r.content.chapterRules.safeDestinations[0]);accepted(await r.interact(r.role('B'),'翠兰','gz-request-appearance',{destinationId:'front-meeting',expectedConsentVersion:old.version}));
  const state=await runtime.replay(r.sessionId);assert.equal(state.chapter.disguise,null);assert.equal(state.characters[r.content.chapterRules.people.wukong].appearanceName,'孙悟空');assert.equal(state.chapter.cuilanSafe,true);
  assert.equal((await runtime.submitSpatialIntent(r.actors.get('wukong').handle,intentId)).status,'Rejected');
});
test('真实PG：声明变体×2/3/4/5职责的完整章，2/5人乔装/直接及同行/分别',async()=>{
  const {fullChapter}=await import('../test-support/gaolao-room.mjs');
  const cases=[];for(const count of [2,5])for(const route of ['public','disguise'])for(const ending of ['GZ-E01','GZ-E02'])cases.push({count,route,ending,version:route==='public'?'gaolaozhuang-v1':'gaolaozhuang-tools-east-v1'});
  for(const count of [3,4])for(const version of ['gaolaozhuang-v1','gaolaozhuang-tools-east-v1'])cases.push({count,route:'public',ending:'GZ-E01',version});
  for(const c of cases){const r=await gaolaoRoom(runtime,clock,c.count,c.version);await fullChapter(r,c);const state=await runtime.replay(r.sessionId);assert.equal(state.ending.endingCode,c.ending,JSON.stringify(c));assert.equal(state.chapter.cuilanSafe,true);assert.equal(state.ending.facts.find(f=>f.key==='returned').value,true);for(const m of state.members){const actions=(await db.pool.query("SELECT count(*) FROM action_receipts WHERE session_id=$1 AND actor_id=$2 AND receipt->'publicReceipt'->>'status'='Accepted'",[r.sessionId,m.characterId])).rows[0].count;assert.ok(Number(actions)>=2,'每个真实客户端实际参与 '+JSON.stringify(c));}}
});
test('真实PG：重复同一来源、口令与未送达不能替代知情条件；Claim不升级',async()=>{
  const {rescue}=await import('../test-support/gaolao-room.mjs'),r=await gaolaoRoom(runtime,clock,2);await rescue(r);
  await r.go(0,r.C('C15'));for(let i=0;i<2;i++)accepted(await r.interact(0,'灶房旧饭账','gz-read-ledger'));await r.go(0,r.C('C19'));
  const notes=(await r.snapshot(0)).projection.observations.filter(o=>o.source?.kind==='archive').slice(-2);assert.equal(notes[0].source.sourceRef,notes[1].source.sourceRef);
  assert.equal((await r.interact(0,'庄口会面点','gz-compare-sources',{evidenceRefs:notes.map(o=>o.observationRef)})).code,'NOT_READY');
  accepted(await r.send(0,{kind:'make_claim',text:'我知道名字和暗号，所以已经查证并入队。',channel:'public',recipientRefs:[]}));
  assert.equal((await r.interact('tang','self','gz-recruitment-decision',{expectedDecisionVersion:'0',response:'accept'})).code,'NOT_READY');assert.equal((await runtime.replay(r.sessionId)).chapter.accountsCompared,false);
  await r.go(1,r.R('R03'));accepted(await r.interact(1,'茶棚见证人','gz-hear-witness'));await r.go(1,r.C('C19'));
  const witness=(await r.snapshot(1)).projection.observations.find(o=>o.source?.kind==='testimony'),receiver=await r.entity(1,(await r.snapshot(0)).projection.self.name);accepted(await r.send(1,{kind:'share_evidence',evidenceRef:witness.observationRef,recipientRefs:[receiver.entityRef]}));const received=(await r.snapshot(0)).projection.observations.find(o=>o.source?.kind==='testimony');assert.equal(received.category,'Claim');assert.equal(received.source.sourceRef,witness.source.sourceRef);
  accepted(await r.interact(0,'庄口会面点','gz-compare-sources',{evidenceRefs:[notes[0].observationRef,received.observationRef]}));assert.equal((await r.interact('bajie','self','gz-confirm-meeting')).code,'NOT_READY');assert.equal((await runtime.replay(r.sessionId)).chapter.accountsCompared,false);
});
test('真实PG：未决招徒的安全分别不要求证据齐全，也不把沉默写成拒绝',async()=>{
  const {rescue,cleanupPublic,endSeparately}=await import('../test-support/gaolao-room.mjs'),r=await gaolaoRoom(runtime,clock,2);await rescue(r);await cleanupPublic(r);await endSeparately(r,true);const state=await runtime.replay(r.sessionId);assert.equal(state.ending.endingCode,'GZ-E02');assert.equal(state.chapter.accountsCompared,false);assert.deepEqual(state.chapter.decisions,{});assert.equal(state.chapter.recruitmentEnded,true);
});
test('真实PG：成员变化使未完成结束轮失效；全员确认才以真实进展结束',async()=>{
  const r=await gaolaoRoom(runtime,clock,3);accepted(await r.send(0,{kind:'request_end',proposalId:'end-round',proposalVersion:'0',scope:'chapter'}));const e=(await r.snapshot(1)).projection.chapter.endProposal;assert.equal(e.status,'pending');assert.equal((await r.snapshot(0)).projection.phase,'Running');
  await runtime.disconnect(r.handles[2]);assert.equal((await r.send(1,{kind:'confirm_end',proposalId:e.proposalId,proposalVersion:e.proposalVersion})).code,'STALE_PRECONDITION');
  accepted(await r.send(0,{kind:'request_end',proposalId:'end-round-2',proposalVersion:e.proposalVersion,scope:'chapter'}));const changed=(await r.snapshot(1)).projection.chapter.endProposal;accepted(await r.send(1,{kind:'confirm_end',proposalId:changed.proposalId,proposalVersion:changed.proposalVersion}));const state=await runtime.replay(r.sessionId);assert.equal(state.ending.endingCode,'GZ-E03');assert.equal(state.ending.facts.find(f=>f.key==='safe').value,false);
});
test('真实PG：只剩一人先等待宽限，到期仅可结束未完成章',async()=>{
  const r=await gaolaoRoom(runtime,clock,2);await runtime.disconnect(r.handles[1]);assert.equal((await r.send(0,{kind:'request_end',proposalId:'end-alone',proposalVersion:'0',scope:'chapter'})).code,'NOT_READY');clock.value+=6000;await runtime.heartbeat(r.handles[0]);await runtime.maintenance(r.sessionId);accepted(await r.send(0,{kind:'request_end',proposalId:'end-after-grace',proposalVersion:'0',scope:'chapter'}));assert.equal((await r.snapshot(0)).projection.ending.endingCode,'GZ-E03');
});
test('真实PG：受控故障走相同救援入口，不能代收徒/加入；撤回取消离庄计划',async()=>{
  const {openDoor,startFollow,rescue,cleanupPublic,investigate,share}=await import('../test-support/gaolao-room.mjs'),first=await gaolaoRoom(runtime,clock,2);await openDoor(first,{fallback:true});assert.equal((await runtime.replay(first.sessionId)).targets['gz-door'].fields.find(f=>f.key==='open').value,true);
  const r=await gaolaoRoom(runtime,clock,2);await rescue(r);await cleanupPublic(r);await investigate(r);
  for(const [key,op] of [['tang','gz-recruitment-decision'],['bajie','gz-membership-decision']]){const s=await r.snapshot(key),id=crypto.randomUUID();await runtime.reserveSpatialFallback(r.actors.get(key).handle,id,{kind:'interact',targetRef:s.projection.self.entityRef,operationId:op,expectedTargetRevision:s.projection.self.resourceRevision,parameters:{expectedDecisionVersion:'0',response:'accept'}},'ineffective_twice');assert.equal((await runtime.submitSpatialIntent(r.actors.get(key).handle,id)).code,'RULE_VIOLATION');accepted(await r.interact(key,'self',op,{expectedDecisionVersion:'0',response:'accept'}));await share(r,key,'本人提交的决定','孙悟空');}
  accepted(await r.interact(0,'庄口会面点','gz-plan-departure'));const nav=crypto.randomUUID();await runtime.reserveSpatialFallback(r.actors.get('bajie').handle,nav,{kind:'move_to',sceneId:'gaolao-courtyard',destination:r.C('C20').position},'model_timeout');accepted(await runtime.submitSpatialIntent(r.actors.get('bajie').handle,nav));
  accepted(await r.interact('tang','self','gz-recruitment-decision',{expectedDecisionVersion:'1',response:'withdraw'}));await r.step(2000);const state=await runtime.replay(r.sessionId);assert.equal(state.chapter.departureArrangement,null);assert.equal(state.characters[r.content.chapterRules.people.bajie].movement.status,'cancelled');assert.equal((await r.interact('bajie','self','gz-join-party')).code,'NOT_READY');assert.equal(state.chapter.cuilanSafe,true);
});
