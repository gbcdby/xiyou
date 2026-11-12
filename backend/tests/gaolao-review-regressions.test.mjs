import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {startTestPostgres} from '../test-support/postgres.mjs';
import {createRuntime} from '../runtime.mjs';
import {gaolaoRoom,accepted,openDoor,rescue,cleanupPublic,investigate,confirmEnd,share} from '../test-support/gaolao-room.mjs';
let db,runtime;
const clock={value:Date.parse('2026-11-13T02:00:00Z')};
before(async()=>{db=await startTestPostgres('gaolao-review-regressions',{outputSubdirectory:'adv001-32-r2'});runtime=await createRuntime({pool:db.pool,now:()=>clock.value});});
after(async()=>{await runtime?.close();await db?.stop();});

async function meeting(r,key='tang',destinationId='front-meeting'){
  const person=(await r.snapshot(key)).projection.self;await r.go(0,{sceneId:person.sceneId,position:person.position});
  const old=(await r.snapshot(key)).projection.chapter.consents.findLast(c=>c.purpose==='meeting');
  accepted(await r.interact(0,person.name,'gz-invite-meeting',{destinationId,expectedConsentVersion:old?.version??'0'}));
  const c=(await r.snapshot(key)).projection.chapter.consents.findLast(c=>c.purpose==='meeting');
  accepted(await r.send(key,{kind:'respond_consent',consentId:c.consentId,expectedConsentVersion:c.version,response:'accept'}));
  return (await r.snapshot(key)).projection.chapter.consents.findLast(c=>c.purpose==='meeting');
}

test('R-32-REQ-002：全员结束未决招徒后不得新作接受，实际收尾仍可完成E02',async()=>{
  const r=await gaolaoRoom(runtime,clock,2);await rescue(r);await cleanupPublic(r);await investigate(r);await confirmEnd(r,'recruitment');
  const before=await runtime.replay(r.sessionId);assert.equal(before.chapter.recruitmentEnded,true);assert.deepEqual(before.chapter.decisions,{});assert.equal(before.phase,'Running');
  for(const [key,op] of [['tang','gz-recruitment-decision'],['bajie','gz-membership-decision']])assert.equal((await r.interact(key,'self',op,{expectedDecisionVersion:'0',response:'accept'})).status,'Rejected');
  accepted(await r.interact(0,'庄口会面点','gz-plan-departure'));assert.equal((await runtime.replay(r.sessionId)).chapter.departureArrangement.branch,'GZ-E02');
  for(const key of ['tang','wukong'])await r.go(key,r.content.chapterRules.departure);await r.go('bajie',r.content.chapterRules.waiting[0]);accepted(await r.interact('tang','self','gz-finish-separation'));
  const ended=await runtime.replay(r.sessionId);assert.equal(ended.ending.endingCode,'GZ-E02');assert.deepEqual(ended.chapter.decisions,{});
});

test('R-32-REQ-003：本人撤回会面同事务取消关联导航，原Receipt重试不复活',async()=>{
  const r=await gaolaoRoom(runtime,clock,2);await rescue(r);const c=await meeting(r),d=r.content.chapterRules.meetingDestinations.find(x=>x.destinationId==='front-meeting'),handle=r.actors.get('tang').handle,intentId=crypto.randomUUID();
  await runtime.reserveSpatialIntent(handle,intentId,{kind:'move_to',sceneId:d.sceneId,destination:d.position});const original=accepted(await runtime.submitSpatialIntent(handle,intentId)),before=(await r.snapshot('tang')).projection;
  accepted(await r.send('tang',{kind:'withdraw_consent',consentId:c.consentId,expectedConsentVersion:c.version}));const after=(await r.snapshot('tang')).projection;assert.equal(after.movement.status,'cancelled');
  await r.step(5000);assert.deepEqual((await r.snapshot('tang')).projection.self.position,before.self.position);assert.deepEqual(await runtime.submitSpatialIntent(handle,intentId),original);assert.equal((await r.snapshot('tang')).projection.movement.status,'cancelled');
});

test('R-32-REQ-002：结束选择挡住旧预留决定和入队，取消旧离庄但保留无关导航与原结果',async()=>{
  const r=await gaolaoRoom(runtime,clock,2);await rescue(r);await cleanupPublic(r);await investigate(r);
  const oldAccept=crypto.randomUUID(),tang=r.actors.get('tang').handle,own=(await r.snapshot('tang')).projection.self;
  await runtime.reserveSpatialIntent(tang,oldAccept,{kind:'interact',targetRef:own.entityRef,operationId:'gz-recruitment-decision',expectedTargetRevision:own.resourceRevision,parameters:{expectedDecisionVersion:'0',response:'accept'}});
  await confirmEnd(r,'recruitment');assert.equal((await runtime.submitSpatialIntent(tang,oldAccept)).status,'Rejected');

  const ready=await gaolaoRoom(runtime,clock,2);await rescue(ready);await cleanupPublic(ready);await investigate(ready);const acceptedIds=[];
  for(const [key,op] of [['tang','gz-recruitment-decision'],['bajie','gz-membership-decision']]){
    const id=crypto.randomUUID(),s=(await ready.snapshot(key)).projection.self,handle=ready.actors.get(key).handle;
    await runtime.reserveSpatialIntent(handle,id,{kind:'interact',targetRef:s.entityRef,operationId:op,expectedTargetRevision:s.resourceRevision,parameters:{expectedDecisionVersion:'0',response:'accept'}});
    acceptedIds.push({handle,id,receipt:accepted(await runtime.submitSpatialIntent(handle,id))});await share(ready,key,'本人提交的决定','孙悟空');
  }
  accepted(await ready.interact(0,'庄口会面点','gz-plan-departure'));
  const p=ready.C('C20'),bajie=ready.actors.get('bajie').handle,pendingMove=crypto.randomUUID(),pendingJoin=crypto.randomUUID(),self=(await ready.snapshot('bajie')).projection.self;
  await runtime.reserveSpatialIntent(bajie,pendingMove,{kind:'move_to',sceneId:p.sceneId,destination:p.position});
  await runtime.reserveSpatialIntent(bajie,pendingJoin,{kind:'interact',targetRef:self.entityRef,operationId:'gz-join-party',expectedTargetRevision:self.resourceRevision});
  accepted(await ready.send('tang',{kind:'move_to',sceneId:p.sceneId,destination:p.position}));accepted(await ready.send('wukong',{kind:'move_to',sceneId:ready.C('C15').sceneId,destination:ready.C('C15').position}));
  const unrelated=(await ready.snapshot('wukong')).projection.movement;
  await confirmEnd(ready,'recruitment');assert.equal((await ready.snapshot('tang')).projection.movement.status,'cancelled');assert.equal((await ready.snapshot('wukong')).projection.movement.movementId,unrelated.movementId);assert.equal((await ready.snapshot('wukong')).projection.movement.status,'accepted');
  assert.equal((await runtime.submitSpatialIntent(bajie,pendingMove)).code,'NOT_READY');assert.equal((await runtime.submitSpatialIntent(bajie,pendingJoin)).code,'NOT_READY');
  for(const old of acceptedIds)assert.deepEqual(await runtime.submitSpatialIntent(old.handle,old.id),old.receipt);
  accepted(await ready.interact('tang','self','gz-recruitment-decision',{expectedDecisionVersion:'1',response:'withdraw'}));
  assert.equal((await ready.interact('tang','self','gz-recruitment-decision',{expectedDecisionVersion:'2',response:'accept'})).status,'Rejected');assert.equal((await runtime.replay(ready.sessionId)).phase,'Running');
});

test('R-32-REQ-003：改约废止旧预留及旧活动路线，新许可可导航，无关导航不被撤回取消',async()=>{
  const r=await gaolaoRoom(runtime,clock,2);await rescue(r);let c=await meeting(r);const old=r.content.chapterRules.meetingDestinations.find(d=>d.destinationId==='front-meeting'),handle=r.actors.get('tang').handle,pendingId=crypto.randomUUID();
  accepted(await r.send('tang',{kind:'move_to',sceneId:old.sceneId,destination:old.position}));
  await runtime.reserveSpatialIntent(handle,pendingId,{kind:'move_to',sceneId:old.sceneId,destination:old.position});
  accepted(await r.interact(0,'唐僧','gz-invite-meeting',{destinationId:'rear-meeting',expectedConsentVersion:c.version}));assert.equal((await r.snapshot('tang')).projection.movement.status,'cancelled');assert.equal((await runtime.submitSpatialIntent(handle,pendingId)).code,'CONSENT_STALE');
  c=(await r.snapshot('tang')).projection.chapter.consents.findLast(c=>c.purpose==='meeting');accepted(await r.send('tang',{kind:'respond_consent',consentId:c.consentId,expectedConsentVersion:c.version,response:'accept'}));
  const revised=r.content.chapterRules.meetingDestinations.find(d=>d.destinationId==='rear-meeting');await r.go('tang',revised);assert.deepEqual((await r.snapshot('tang')).projection.self.position,{...revised.position});
  c=(await r.snapshot('tang')).projection.chapter.consents.findLast(c=>c.purpose==='meeting');accepted(await r.send('tang',{kind:'move_to',sceneId:r.C('C15').sceneId,destination:r.C('C15').position}));const ordinary=(await r.snapshot('tang')).projection.movement;
  accepted(await r.send('tang',{kind:'withdraw_consent',consentId:c.consentId,expectedConsentVersion:c.version}));assert.equal((await r.snapshot('tang')).projection.movement.movementId,ordinary.movementId);assert.equal((await r.snapshot('tang')).projection.movement.status,'accepted');await r.step(5000);assert.equal((await r.snapshot('tang')).projection.movement.status,'arrived');
});

test('R-32-STD-003：257次合法改约不使快照、上下文、同步或重订阅失效',async()=>{
  const r=await gaolaoRoom(runtime,clock,2);await openDoor(r);const initial=await r.snapshot(0),subject=initial.projection.entities.find(e=>e.name==='翠兰');let lastValid=initial;
  for(let index=0;index<257;index++){
    const request={schemaVersion:2,sessionId:r.sessionId,viewId:initial.viewId,actorRef:initial.projection.self.entityRef,clientActionId:'capacity-'+index,controlEpoch:initial.projection.self.controlEpoch,baseSeq:initial.snapshotSeq,action:{kind:'propose_follow',subjectRef:subject.entityRef,leaderRef:initial.projection.self.entityRef,destinationId:index%2?'tea-back-room':'front-guest-room',expectedConsentVersion:String(index)}};
    accepted(await runtime.submit(r.handles[0],JSON.stringify(request)));if(index===255)lastValid=await r.snapshot(0);
  }
  const state=await runtime.replay(r.sessionId);assert.equal(Object.keys(state.chapter.consents).length,257);const currentId=state.chapter.consentSlots[r.content.chapterRules.people.cuilan+':follow'];
  const snapshot=await r.snapshot(0);assert.ok(snapshot.projection.chapter.consents.length<=256);assert.ok(snapshot.projection.chapter.consents.some(c=>c.consentId===currentId&&c.version==='257'));
  const context=await runtime.spatialContext(r.actors.get('cuilan').handle);assert.ok(context.projection.chapter.consents.some(c=>c.consentId===currentId));
  await runtime.sync(r.handles[0],JSON.stringify({schemaVersion:2,type:'sync.request',sessionId:r.sessionId,viewId:initial.viewId,cursor:lastValid.snapshotSeq}));
  const fresh=await runtime.openConnection(r.users[0].token,['spatial-v2']);await runtime.subscribe(fresh,r.sessionId);
});

test('R-32-STD-003：旧但仍有效的许可不被历史挤掉，超出窗口的本人记录仍可授权分页',async()=>{
  const r=await gaolaoRoom(runtime,clock,3);await rescue(r);const actor=r.role('B');await r.go(2,r.content.chapterRules.safeDestinations[0]);
  accepted(await r.interact(actor,'翠兰','gz-request-appearance',{destinationId:'rear-meeting',expectedConsentVersion:'0'}));let appearance=(await r.snapshot('cuilan')).projection.chapter.consents.findLast(c=>c.purpose==='appearance');accepted(await r.send('cuilan',{kind:'respond_consent',consentId:appearance.consentId,expectedConsentVersion:appearance.version,response:'accept'}));
  appearance=(await r.snapshot('cuilan')).projection.chapter.consents.findLast(c=>c.purpose==='appearance');const initial=await r.snapshot(actor),subject=initial.projection.entities.find(e=>e.name==='翠兰'),follow=initial.projection.chapter.consents.findLast(c=>c.purpose==='follow');
  const early=initial.projection.observations.findLast(o=>o.fields.some(f=>f.key==='consent'&&f.value===appearance.consentId)&&o.fields.some(f=>f.key==='status'&&f.value==='accepted')),outsider=await r.entity(actor,(await r.snapshot(2)).projection.self.name);assert.equal(early.shareable,false);
  assert.equal((await r.send(actor,{kind:'share_evidence',evidenceRef:early.observationRef,recipientRefs:[outsider.entityRef]})).code,'STALE_REFERENCE');assert.equal((await r.send(2,{kind:'share_evidence',evidenceRef:early.observationRef,recipientRefs:[(await r.snapshot(2)).projection.self.entityRef]})).code,'STALE_REFERENCE');
  assert.ok(!(await r.snapshot(2)).projection.observations.some(o=>o.fields.some(f=>f.key==='consent'&&f.value===appearance.consentId)));
  for(let i=0;i<513;i++)accepted(await runtime.submit(r.handles[actor],JSON.stringify({schemaVersion:2,sessionId:r.sessionId,viewId:initial.viewId,actorRef:initial.projection.self.entityRef,clientActionId:'pinned-'+i,controlEpoch:initial.projection.self.controlEpoch,baseSeq:initial.snapshotSeq,action:{kind:'propose_follow',subjectRef:subject.entityRef,leaderRef:initial.projection.self.entityRef,destinationId:i%2?'tea-back-room':'front-guest-room',expectedConsentVersion:String(BigInt(follow.version)+BigInt(i))}})));
  const current=(await r.snapshot(actor)).projection,p=current.chapter;assert.equal(p.consents.length,256);assert.ok(p.consents.some(c=>c.consentId===appearance.consentId&&c.status==='accepted'&&c.version===appearance.version));assert.ok(!current.observations.some(o=>o.observationRef===early.observationRef));const state=await runtime.replay(r.sessionId);assert.equal(Object.keys(state.chapter.consents).length,515);
  await confirmEnd(r,'chapter');const final=await r.snapshot(actor),entries=[];let beforeSeq;
  do{const page=await runtime.recap(r.users[actor].token,r.sessionId,{throughSeq:final.snapshotSeq,...(beforeSeq?{beforeSeq}:{})});entries.push(...page.entries);beforeSeq=page.nextBeforeSeq;}while(beforeSeq);
  const original=entries.find(e=>e.entryRef===early.observationRef);assert.ok(original);assert.equal(original.text,early.statement);assert.deepEqual(JSON.parse(JSON.stringify(original.fields)),JSON.parse(JSON.stringify(early.fields)));assert.equal(original.category,early.category);
  assert.ok(entries.some(e=>e.fields.some(f=>f.key==='consent'&&f.value===follow.consentId)&&e.fields.some(f=>f.key==='status'&&f.value==='accepted')));
  const other=await r.snapshot(2),privatePage=await runtime.recap(r.users[2].token,r.sessionId,{throughSeq:other.snapshotSeq});assert.ok(!privatePage.entries.some(e=>e.fields.some(f=>f.key==='consent')));
});

test('R-32-REQ-002：三人真实到位后结束招徒，旧预留最终入队不能改写E02收束方向',async()=>{
  const r=await gaolaoRoom(runtime,clock,2);await rescue(r);await cleanupPublic(r);await investigate(r);
  for(const [key,op] of [['tang','gz-recruitment-decision'],['bajie','gz-membership-decision']]){accepted(await r.interact(key,'self',op,{expectedDecisionVersion:'0',response:'accept'}));await share(r,key,'本人提交的决定','孙悟空');}
  accepted(await r.interact(0,'庄口会面点','gz-plan-departure'));for(const key of ['tang','wukong','bajie'])await r.go(key,r.content.chapterRules.departure);
  const handle=r.actors.get('bajie').handle,id=crypto.randomUUID(),self=(await r.snapshot('bajie')).projection.self;await runtime.reserveSpatialIntent(handle,id,{kind:'interact',targetRef:self.entityRef,operationId:'gz-join-party',expectedTargetRevision:self.resourceRevision});
  await confirmEnd(r,'recruitment');assert.equal((await runtime.submitSpatialIntent(handle,id)).code,'NOT_READY');const state=await runtime.replay(r.sessionId);assert.equal(state.phase,'Running');assert.equal(state.chapter.recruitmentEnded,true);assert.equal(state.ending,null);
});
