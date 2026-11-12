import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {startTestPostgres} from '../test-support/postgres.mjs';
import {createRuntime} from '../runtime.mjs';
import {gaolaoRoom,accepted,take,openDoor,startFollow} from '../test-support/gaolao-room.mjs';

let db,runtime;
const clock={value:Date.parse('2026-11-12T20:00:00Z')},caps=['spatial-v2'];
before(async()=>{db=await startTestPostgres('gaolao-recovery',{outputSubdirectory:'adv001-32'});runtime=await createRuntime({pool:db.pool,now:()=>clock.value});});
after(async()=>{await runtime?.close();await db?.stop();});

test('真实PG：A2公共物领回与重连两种提交次序、宽限和原Receipt',async()=>{
  for(const reclaimFirst of [true,false]){
    const r=await gaolaoRoom(runtime,clock,3),place=r.content.items.find(i=>i.itemId==='gz-brace');
    await r.go(0,place);await r.go(1,place);await take(r,0,'公共门撑');
    const holderName=(await r.snapshot(0)).projection.self.name;
    await runtime.disconnect(r.handles[0]);
    let item=await r.entity(1,'公共门撑'),holder=await r.entity(1,holderName);
    assert.equal(item.reclaimHolderEpoch,undefined);
    assert.equal((await r.send(1,{kind:'reclaim_public_item',itemRef:item.entityRef,holderRef:holder.entityRef,expectedItemRevision:item.resourceRevision,expectedHolderEpoch:'0'})).status,'Rejected');
    clock.value+=6000;for(const h of r.handles.slice(1))await runtime.heartbeat(h);await runtime.maintenance(r.sessionId);
    item=await r.entity(1,'公共门撑');holder=await r.entity(1,holderName);assert.ok(item.reclaimHolderEpoch);
    const raw=await r.raw(1,{kind:'reclaim_public_item',itemRef:item.entityRef,holderRef:holder.entityRef,expectedItemRevision:item.resourceRevision,expectedHolderEpoch:item.reclaimHolderEpoch});
    const fresh=await runtime.openConnection(r.users[0].token,caps),snapshot=await runtime.subscribe(fresh,r.sessionId);
    const resume=()=>runtime.control(fresh,JSON.stringify({schemaVersion:2,type:'control.resume',sessionId:r.sessionId,viewId:snapshot.viewId,actorRef:snapshot.projection.self.entityRef,nonce:crypto.randomUUID()}));
    let receipt;
    if(reclaimFirst){receipt=await runtime.submit(r.handles[1],raw);await resume();}
    else{await resume();receipt=await runtime.submit(r.handles[1],raw);}
    assert.equal(receipt.status,reclaimFirst?'Accepted':'Rejected');
    assert.deepEqual(await runtime.submit(r.handles[1],raw),receipt);
    assert.deepEqual(await runtime.receipt(r.users[1].token,r.sessionId,JSON.parse(raw).clientActionId),receipt);
    const state=await runtime.replay(r.sessionId);assert.equal(state.items['gz-brace'].location.characterId,state.members[reclaimFirst?1:0].characterId);assert.equal(state.items['gz-brace'].resourceRevision,reclaimFirst?'2':'1');
    assert.deepEqual(state,(await db.pool.query('SELECT state FROM sessions WHERE session_id=$1',[r.sessionId])).rows[0].state);
  }
});

test('真实PG：私物许可绑定本人、物品与请求者，不能套用随行或公共领回',async()=>{
  const r=await gaolaoRoom(runtime,clock,3);await openDoor(r);
  await r.go(1,r.C('C01'));let locked=await r.entity(1,'公共门撑');assert.equal((await r.send(1,{kind:'take_item',itemRef:locked.entityRef,expectedItemRevision:locked.resourceRevision})).code,'RULE_VIOLATION');
  const place=r.content.items.find(i=>i.itemId==='gz-parcel');for(const key of [0,1,'cuilan'])await r.go(key,place);
  let parcel=await r.entity(0,'私人包裹');assert.equal((await r.send(0,{kind:'take_item',itemRef:parcel.entityRef,expectedItemRevision:parcel.resourceRevision})).code,'CONSENT_REQUIRED');
  accepted(await r.interact(0,'翠兰','gz-request-private-items',{itemRefs:[parcel.entityRef],expectedConsentVersion:'0'}));
  let c=(await r.snapshot('cuilan')).projection.chapter.consents.findLast(c=>c.purpose==='private_items');
  assert.equal((await r.send('gao',{kind:'respond_consent',consentId:c.consentId,expectedConsentVersion:c.version,response:'accept'})).code,'STALE_REFERENCE');
  accepted(await r.send('cuilan',{kind:'respond_consent',consentId:c.consentId,expectedConsentVersion:c.version,response:'accept'}));
  const letter=await r.entity(0,'私人信件');assert.equal((await r.send(0,{kind:'take_item',itemRef:letter.entityRef,expectedItemRevision:letter.resourceRevision})).code,'CONSENT_REQUIRED');
  const foreignParcel=await r.entity(1,'私人包裹');assert.equal((await r.send(1,{kind:'take_item',itemRef:foreignParcel.entityRef,expectedItemRevision:foreignParcel.resourceRevision})).code,'CONSENT_REQUIRED');
  await take(r,0,'私人包裹');
  assert.ok(!(await r.snapshot(1)).projection.items.some(i=>i.name==='私人包裹'));
  const heldParcel=await r.entity(0,'私人包裹');
  const holderName=(await r.snapshot(0)).projection.self.name;await runtime.disconnect(r.handles[0]);clock.value+=6000;for(const h of r.handles.slice(1))await runtime.heartbeat(h);await runtime.maintenance(r.sessionId);
  const holder=await r.entity(1,holderName),state=await runtime.replay(r.sessionId),epoch=state.characters[state.members[0].characterId].controlEpoch;
  assert.equal((await r.send(1,{kind:'reclaim_public_item',itemRef:foreignParcel.entityRef,holderRef:holder.entityRef,expectedItemRevision:heldParcel.resourceRevision,expectedHolderEpoch:epoch})).code,'STALE_REFERENCE');
  assert.equal((await runtime.replay(r.sessionId)).items['gz-parcel'].location.characterId,state.members[0].characterId);
});

test('真实PG：重启不补跑随行，旧安置和NUL意图被epoch挡住，原Receipt仍可恢复',async()=>{
  const r=await gaolaoRoom(runtime,clock,2);await openDoor(r);await startFollow(r);
  const text='重启前\u0000原文与字面\\0',action={kind:'speak',text,channel:'public',recipientRefs:[]},pendingId=crypto.randomUUID(),doneId=crypto.randomUUID();
  const original=await runtime.reserveSpatialIntent(r.actors.get('bajie').handle,pendingId,action);
  await runtime.reserveSpatialIntent(r.actors.get('bajie').handle,doneId,action);const doneReceipt=accepted(await runtime.submitSpatialIntent(r.actors.get('bajie').handle,doneId));
  const own=(await r.snapshot('cuilan')).projection,c=own.chapter.consents.findLast(c=>c.purpose==='follow'),settlementId=crypto.randomUUID();
  await runtime.reserveSpatialIntent(r.actors.get('cuilan').handle,settlementId,{kind:'interact',targetRef:own.self.entityRef,operationId:'gz-confirm-settlement',expectedTargetRevision:own.self.resourceRevision,parameters:{consentId:c.consentId,expectedConsentVersion:c.version}});
  const before=await runtime.replay(r.sessionId);await runtime.close();clock.value+=60_000;runtime=await createRuntime({pool:db.pool,now:()=>clock.value});
  const recovered=await runtime.replay(r.sessionId);assert.equal(recovered.sceneTimeMs,before.sceneTimeMs);assert.deepEqual(recovered.characters[r.content.chapterRules.people.cuilan].position,before.characters[r.content.chapterRules.people.cuilan].position);assert.equal(recovered.chapter.follows[r.content.chapterRules.people.cuilan].status,'paused');assert.equal(recovered.chapter.cuilanSafe,false);
  const bajie=await runtime.bindInternal(r.sessionId,r.content.chapterRules.people.bajie,'core_npc'),cuilan=await runtime.bindInternal(r.sessionId,r.content.chapterRules.people.cuilan,'scene_role');
  assert.deepEqual(await runtime.reserveSpatialIntent(bajie,pendingId,action),original);assert.deepEqual(await runtime.submitSpatialIntent(bajie,doneId),doneReceipt);assert.deepEqual(await runtime.internalReceipt(bajie,doneId),doneReceipt);
  assert.equal((await runtime.submitSpatialIntent(bajie,pendingId)).code,'STALE_CONTROL');assert.equal((await runtime.submitSpatialIntent(cuilan,settlementId)).code,'STALE_CONTROL');
  for(const user of r.users){const h=await runtime.openConnection(user.token,caps),s=await runtime.subscribe(h,r.sessionId);await runtime.control(h,JSON.stringify({schemaVersion:2,type:'control.resume',sessionId:r.sessionId,viewId:s.viewId,actorRef:s.projection.self.entityRef,nonce:crypto.randomUUID()}));}
  const freshId=crypto.randomUUID();await runtime.reserveSpatialIntent(bajie,freshId,action);accepted(await runtime.submitSpatialIntent(bajie,freshId));assert.ok((await runtime.observeInternal(bajie)).projection.claims.filter(c=>c.text===text).length===2);
  const row=(await db.pool.query('SELECT request_text_encoding FROM spatial_intents WHERE session_id=$1 AND intent_id=$2',[r.sessionId,pendingId])).rows[0];assert.equal(row.request_text_encoding,'nul-escaped-v1');
});
