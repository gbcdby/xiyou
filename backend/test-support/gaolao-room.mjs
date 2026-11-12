import assert from 'node:assert/strict';
import { loadContent } from '../../content/index.mjs';
import { validateSpatial } from '../../protocol/spatial.mjs';
export async function gaolaoRoom(runtime,clock,count=2,contentVersion='gaolaozhuang-v1'){
  const content=await loadContent(contentVersion),users=[],handles=[],actors=new Map(),caps=['spatial-v2'];
  for(let i=0;i<count;i++)users.push(await runtime.guest({name:`同行者${i+1}`}));
  const {sessionId}=await runtime.create(users[0].token,{nonce:crypto.randomUUID(),contentVersion,capabilities:caps});
  for(const u of users)await runtime.join(u.token,sessionId,{nonce:crypto.randomUUID(),capabilities:caps});
  await runtime.start(users[0].token,sessionId,{nonce:'start'});
  for(let i=0;i<count;i++){const h=await runtime.openConnection(users[i].token,caps),s=await runtime.subscribe(h,sessionId);await runtime.control(h,JSON.stringify({schemaVersion:2,type:'control.resume',sessionId,viewId:s.viewId,actorRef:s.projection.self.entityRef,nonce:crypto.randomUUID()}));handles.push(h);actors.set(i,{handle:h,token:users[i].token,seq:0,epoch:null});}
  for(const [key,id] of Object.entries(content.chapterRules.people)){const npc=content.npcs.find(n=>n.characterId===id);actors.set(key,{handle:await runtime.bindInternal(sessionId,id,npc.actorKind==='scene_role'?'scene_role':'core_npc'),internal:true});}
  const snapshot=async key=>{const actor=actors.get(key);return actor.internal?runtime.observeInternal(actor.handle):runtime.snapshot(actor.token,sessionId,caps);};
  const raw=async(key,action,overrides={})=>{const s=await snapshot(key);return JSON.stringify({schemaVersion:2,sessionId,viewId:s.viewId,actorRef:s.projection.self.entityRef,clientActionId:crypto.randomUUID(),controlEpoch:s.projection.self.controlEpoch,baseSeq:s.snapshotSeq,action,...overrides});};
  const send=async(key,action)=>{const a=actors.get(key);if(a.internal){const id=crypto.randomUUID();await runtime.reserveSpatialIntent(a.handle,id,action);return runtime.submitSpatialIntent(a.handle,id);}return runtime.submit(a.handle,await raw(key,action));};
  const step=async(ms=1000)=>{clock.value+=ms;for(const h of handles)await runtime.heartbeat(h);await runtime.maintenance(sessionId);};
  const move=async(key,sceneId,position)=>{const a=actors.get(key),s=await snapshot(key),command={kind:'move_to',sceneId,destination:position};if(!a.internal){if(a.epoch!==s.projection.self.controlEpoch){a.epoch=s.projection.self.controlEpoch;a.seq=0;}command.movementCommandSeq=String(++a.seq);}const receipt=await send(key,command);assert.equal(receipt.status,'Accepted',`导航 ${key}: ${receipt.code} 至 ${JSON.stringify(position)}`);for(let i=0;i<30;i++){await step(1000);const current=(await snapshot(key)).projection;validateSpatial('ProjectionV2',current);if(current.movement?.status==='arrived')return current;if(['blocked','cancelled'].includes(current.movement?.status))throw new Error(`导航中止 ${key}: ${current.movement.reason}`);}throw new Error('导航未在有限步内到达。');};
  const go=async(key,where)=>{const s=await snapshot(key);if(s.projection.self.sceneId!==where.sceneId){const current=content.scenes.find(x=>x.sceneId===s.projection.self.sceneId),exit=current.exits.find(x=>x.destinationSceneId===where.sceneId);assert.ok(exit);await move(key,current.sceneId,current.anchors.find(x=>x.anchorId===exit.anchorId).position);}return move(key,where.sceneId,where.position);};
  const entity=async(key,name)=>{const s=await snapshot(key);const e=[...s.projection.entities,...s.projection.targets,...s.projection.items].find(x=>x.name===name);assert.ok(e,`当前授权目标缺失：${key} ${name}`);return e;};
  const interact=async(key,name,operationId,parameters)=>{const e=name==='self'?(await snapshot(key)).projection.self:await entity(key,name);return send(key,{kind:'interact',targetRef:e.entityRef,operationId,expectedTargetRevision:e.resourceRevision,...(parameters?{parameters}:{})});};
  const at=(sceneId,anchorId)=>{const s=content.scenes.find(x=>x.sceneId===sceneId);return {sceneId,position:s.anchors.find(x=>x.anchorId===anchorId).position};};
  return {role:roleId=>content.chapterRules.partyRoles[String(count)].findIndex(group=>group.includes(roleId)),runtime,clock,content,sessionId,users,handles,actors,snapshot,raw,send,step,move,go,entity,interact,at,C:id=>at('gaolao-courtyard',id),R:id=>at('gaolao-village-road',id)};
}
export function accepted(receipt,label='动作'){assert.equal(receipt.status,'Accepted',label+' '+receipt.code);return receipt;}
export async function take(r,key,name){const i=await r.entity(key,name);return accepted(await r.send(key,{kind:'take_item',itemRef:i.entityRef,expectedItemRevision:i.resourceRevision}),'拿取'+name);}
export async function share(r,key,sourceId,recipientName){const s=await r.snapshot(key),source=r.content.chapterRules.sources.find(x=>x.sourceId===sourceId),o=s.projection.observations.findLast(x=>x.source?.label===(source?.label??sourceId));assert.ok(o,'来源存在 '+sourceId);const to=await r.entity(key,recipientName);return accepted(await r.send(key,{kind:'share_evidence',evidenceRef:o.observationRef,recipientRefs:[to.entityRef]}),'分享'+sourceId);}
export async function openDoor(r,{fallback=false}={}){
  const carer=r.role('B'),craft=r.role('C');
  await r.go(carer,r.C('C04'));accepted(await r.interact(carer,'侧窗联络点','gz-contact'));
  await r.go(carer,r.C('C01'));accepted(await r.interact(carer,'铜封门','gz-check-seal'));
  await r.go('wukong',r.C('C01'));
  await share(r,carer,'侧窗本人回应','孙悟空');await share(r,carer,'亲自在门外检查铜封','孙悟空');
  await r.go('cuilan',r.C('C06'));accepted(await r.interact('cuilan','self','gz-step-back'));
  const brace=r.content.items.find(i=>i.itemId==='gz-brace'),rope=r.content.items.find(i=>i.itemId==='gz-rope');
  await r.go(carer,brace);await take(r,carer,'公共门撑');await r.go(craft,rope);await take(r,craft,'公共绳索');
  await r.go(carer,r.C('C02'));await r.go(craft,r.C('C03'));
  for(const i of [carer,craft])accepted(await r.send(i,{kind:'cooperate',operationId:'gz-lock-support',operationVersion:'0',phase:'ready'}));
  if(fallback){const target=await r.entity('wukong','铜封门'),id=crypto.randomUUID();await r.runtime.reserveSpatialFallback(r.actors.get('wukong').handle,id,{kind:'interact',targetRef:target.entityRef,operationId:'gz-break-seal',expectedTargetRevision:target.resourceRevision},'model_timeout');accepted(await r.runtime.submitSpatialIntent(r.actors.get('wukong').handle,id));}
  else accepted(await r.interact('wukong','铜封门','gz-break-seal'));
  await r.go(carer,r.C('C08'));
}
export async function startFollow(r,destinationId='front-guest-room'){
  const leader=r.role('B');
  const s=await r.snapshot(leader),c=await r.entity(leader,'翠兰');accepted(await r.send(leader,{kind:'propose_follow',subjectRef:c.entityRef,leaderRef:s.projection.self.entityRef,destinationId,expectedConsentVersion:'0'}));
  const own=await r.snapshot('cuilan'),consent=own.projection.chapter.consents.find(x=>x.purpose==='follow');accepted(await r.send('cuilan',{kind:'respond_consent',consentId:consent.consentId,expectedConsentVersion:consent.version,response:'accept'}));
}
export async function rescue(r,destinationId='front-guest-room'){
  await openDoor(r);await startFollow(r,destinationId);
  const destination=r.content.chapterRules.safeDestinations.find(d=>d.destinationId===destinationId);
  await r.go(r.role('B'),destination);
  for(let i=0;i<30;i++){await r.step(1000);const follow=(await r.snapshot('cuilan')).projection.chapter.follows[0];if(follow.status==='arrived'){accepted(await r.interact('cuilan','self','gz-confirm-settlement',{consentId:follow.consentId,expectedConsentVersion:follow.consentVersion}));return follow;}}
  throw new Error('随行没有实际到达。');
}
export async function cleanupPublic(r){
  const craft=r.role('C');
  await r.go(craft,r.C('C01'));accepted(await r.interact(craft,'门撑承力点','gz-release-support'));
  for(const name of ['公共门撑','公共绳索'])await take(r,craft,name);
  await r.go(craft,r.C('C14'));
  for(const name of ['公共门撑','公共绳索']){const item=await r.entity(craft,name);accepted(await r.interact(craft,'公共工具借还架','gz-return-public',{itemRef:item.entityRef,expectedItemRevision:item.resourceRevision}));}
}
export async function disguise(r){
  const carer=r.role('B');
  await r.go(carer,r.content.chapterRules.safeDestinations[0]);accepted(await r.interact(carer,'翠兰','gz-request-appearance',{destinationId:'rear-meeting',expectedConsentVersion:'0'}));
  const consent=(await r.snapshot('cuilan')).projection.chapter.consents.findLast(c=>c.purpose==='appearance');accepted(await r.send('cuilan',{kind:'respond_consent',consentId:consent.consentId,expectedConsentVersion:consent.version,response:'accept'}));
  await r.go('wukong',r.C('C10'));await r.go(carer,r.C('C10'));
  const permission=(await r.snapshot('wukong')).projection.chapter.consents.findLast(c=>c.purpose==='appearance');accepted(await r.interact('wukong','self','gz-apply-appearance',{consentId:permission.consentId,expectedConsentVersion:permission.version}));
  await r.go('bajie',r.C('C10'));
  return permission;
}
export async function gatherSources(r){
  const ledger=r.role('D'),witness=r.role('E');
  await r.go(ledger,r.C('C15'));accepted(await r.interact(ledger,'灶房旧饭账','gz-read-ledger'));
  await r.go(witness,r.R('R03'));accepted(await r.interact(witness,'茶棚见证人','gz-hear-witness'));
  await r.go(0,r.C('C19'));for(const actor of new Set([ledger,witness]))await r.go(actor,r.C('C19'));if(ledger!==0)await share(r,ledger,'old-ledger',(await r.snapshot(0)).projection.self.name);if(witness!==0)await share(r,witness,'tea-witness',(await r.snapshot(0)).projection.self.name);
}
export async function investigate(r){
  await gatherSources(r);
  for(const key of ['tang','bajie','wukong'])await r.go(key,r.C('C19'));
  accepted(await r.interact('tang','self','gz-show-passage'));await share(r,'tang','travel-document',(await r.snapshot(0)).projection.self.name);await share(r,'tang','travel-document','猪刚鬣');
  const s=await r.snapshot(0),refs=['灶房旧饭账原件','茶棚常驻见证人的亲历证言'].map(label=>s.projection.observations.findLast(o=>o.source?.label===label).observationRef);accepted(await r.interact(0,'庄口会面点','gz-compare-sources',{evidenceRefs:refs}));
  for(const name of ['唐僧','猪刚鬣'])for(const source of ['old-ledger','tea-witness','旧饭账与独立证言的现场比较'])await share(r,0,source,name);
  for(const [key,name] of [['tang','唐僧'],['bajie','猪刚鬣']]){accepted(await r.interact(0,name,'gz-invite-meeting',{destinationId:'front-meeting',expectedConsentVersion:'0'}));const c=(await r.snapshot(key)).projection.chapter.consents.findLast(c=>c.purpose==='meeting');accepted(await r.send(key,{kind:'respond_consent',consentId:c.consentId,expectedConsentVersion:c.version,response:'accept'}));}
  accepted(await r.interact('tang','self','gz-confirm-meeting'));accepted(await r.interact('bajie','self','gz-confirm-meeting'));
}
export async function endTogether(r){
  for(const [key,operationId] of [['tang','gz-recruitment-decision'],['bajie','gz-membership-decision']]){accepted(await r.interact(key,'self',operationId,{expectedDecisionVersion:'0',response:'accept'}));await share(r,key,'本人提交的决定','孙悟空');}
  accepted(await r.interact(0,'庄口会面点','gz-plan-departure'));
  for(const key of ['tang','wukong','bajie'])await r.go(key,r.content.chapterRules.departure);
  accepted(await r.interact('bajie','self','gz-join-party'));
}
export async function confirmEnd(r,scope){
  const old=(await r.snapshot(0)).projection.chapter.endProposal;
  accepted(await r.send(0,{kind:'request_end',proposalId:crypto.randomUUID(),proposalVersion:old?.proposalVersion??'0',scope}));
  for(let i=1;i<r.users.length;i++){const e=(await r.snapshot(i)).projection.chapter.endProposal;accepted(await r.send(i,{kind:'confirm_end',proposalId:e.proposalId,proposalVersion:e.proposalVersion}));}
}
export async function endSeparately(r,pending=true){
  await r.go(0,r.C('C19'));for(const key of ['tang','wukong','bajie'])await r.go(key,r.C('C19'));
  if(pending)await confirmEnd(r,'recruitment');else accepted(await r.interact('bajie','self','gz-membership-decision',{expectedDecisionVersion:'0',response:'decline'}));
  accepted(await r.interact(0,'庄口会面点','gz-plan-departure'));
  for(const key of ['tang','wukong'])await r.go(key,r.content.chapterRules.departure);await r.go('bajie',r.content.chapterRules.waiting[0]);
  accepted(await r.interact('tang','self','gz-finish-separation'));
}
export async function fullChapter(r,{route='public',ending='GZ-E01',pending=true}={}){
  await rescue(r);await cleanupPublic(r);
  if(route==='disguise'){await disguise(r);accepted(await r.send('wukong',{kind:'speak',text:'请说说你在这里等候谁。',channel:'public',recipientRefs:[]}));accepted(await r.interact('wukong','self','gz-release-appearance'));}
  if(ending==='GZ-E01'){await investigate(r);await endTogether(r);}else{await gatherSources(r);await endSeparately(r,pending);}
}
