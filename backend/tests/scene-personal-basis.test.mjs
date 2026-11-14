import test from 'node:test';
import assert from 'node:assert/strict';
import {loadContent} from '../../content/index.mjs';
import {personalScopeDigest,personalDecisionBinding,personalSources} from '../../game/gaolao-personal-contract.mjs';
import {validateScenePolicyBasis} from '../scene-policy.mjs';
import {personalFixture,proposePersonalFixture,invalidatedPersonalFixture,personalBasisFixture} from '../test-support/scene-personal-fixture.mjs';

const content=await loadContent('gaolaozhuang-scene-v3');
function basis(){
  const scope={destinationId:'front-meeting',permissionTerm:'single_use',usage:'inquiry_meeting',radius:90},scopeDigest=personalScopeDigest('appearance',scope),consentId='C'.repeat(40);
  const proposalBinding={subjectId:'gz-cuilan',subjectEpoch:'1',requesterId:'human-a',requesterEpoch:'1',performerId:'gz-wukong',performerEpoch:'1',scopeDigest,contentVersion:content.contentVersion,chapterVersion:content.chapterVersion,mapVersion:content.mapVersion,policyVersion:'gaolao-cuilan-v2',consentVersion:'1',requestActionId:'request-a',requestDigest:'a'.repeat(64),sourceSeq:'10',requestObservationRef:'Q'.repeat(40),receivedSeq:'11'};
  const consent={consentId,subjectId:'gz-cuilan',requesterId:'human-a',performerId:'gz-wukong',purpose:'appearance',scope,version:'1',status:'proposed'};
  const record={consentId,lifecycleVersion:'1',lifecycle:'open',reasonCode:null,transitionActor:'human-a',transitionSeq:'11',proposalBinding,execution:{state:'none',acceptedProof:null,appearanceStarted:false,appearanceEnded:false,itemUses:[]},notice:null};
  const personal=personalDecisionBinding({chapter:{consentSlots:{'gz-cuilan:appearance':consentId},consents:{[consentId]:consent},personalRequests:{[consentId]:record}}},'gz-cuilan','appearance'),source=personalSources(content)[0];
  return {policyVersion:'gaolao-cuilan-v2',branch:'appearance',stepKey:`appearance:${consentId}:1:1:response`,actionId:'scene-a',requestDigest:'b'.repeat(64),evaluatedThroughSeq:'20',contentVersion:content.contentVersion,chapterVersion:content.chapterVersion,mapVersion:content.mapVersion,
    subjectEpoch:'1',viewId:'V'.repeat(40),subjectRef:'S'.repeat(40),subjectRevision:'5',previousIntentId:null,attempt:1,personal,
    sources:[{sourceId:source.sourceId,sourceRevision:source.sourceRevision,sourceRef:'R'.repeat(40),observationRef:'O'.repeat(40),sourceSeq:'1',receivedSeq:'1',digest:source.digest}],
    safeRecord:{subjectId:'gz-cuilan',consentId:'F'.repeat(40),consentVersion:'2',followId:'L'.repeat(40),planVersion:'3',destinationId:'front-guest-room',sourceSeq:'9'},
    guards:{authorized:true,proposalCurrent:true,scopeKnown:true,safeCurrent:true,near:true,visible:true,los:true,exitReachable:true,noticeCurrent:false}};
}

test('GZ-CS-08：v2 完整个人 basis 使用冻结 F1 binding，而非 follow 槽或裁剪摘要',()=>{
  const value=basis();assert.deepEqual(validateScenePolicyBasis(value),value);
});

test('GZ-CS-08/10：v2 parser 拒绝未知/缺失字段、错分支与来源串用',()=>{
  for(const mutate of [
    b=>{b.world={};},b=>{delete b.subjectRevision;},b=>{delete b.personal.lifecycleVersion;},
    b=>{delete b.personal.proposalBinding.requestObservationRef;},b=>{b.personal.scope.permissionTerm='reusable';},
    b=>{b.branch='private_items';},b=>{b.sources[0].sourceId='cuilan-private-items-v1';},
    b=>{delete b.sources[0].sourceRevision;},b=>{b.sources[0].knowledge={};},b=>{b.guards.bystanderOnline=true;},
    b=>{b.consent={purpose:'follow'};},b=>{b.policyVersion='gaolao-cuilan-v3';},
  ]){const value=structuredClone(basis());mutate(value);assert.throws(()=>validateScenePolicyBasis(value));}
});

test('GZ-CS-08：accepted basis 不允许缺实际 proof',()=>{
  const value=structuredClone(basis());value.personal.status='accepted';
  assert.throws(()=>validateScenePolicyBasis(value));
});
test('GZ-CS-05/08：完整撤回 basis 保留原 proof 与通知，本人新 epoch 不改写旧参与者；原提议版本不能冒充接受',()=>{
  const state=personalFixture(content),c=proposePersonalFixture(state,content,'appearance');invalidatedPersonalFixture(state,content,c);
  state.characters[c.subjectId].controlEpoch='2';state.characters[c.requesterId].controlEpoch='3';
  const good=personalBasisFixture(state,content,'appearance');assert.doesNotThrow(()=>validateScenePolicyBasis(good));
  for(const mutate of [b=>{b.personal.acceptedProof.consentVersion='1';},b=>{b.personal.acceptedProof.requesterEpoch='3';},b=>{b.personal.notice.acceptedConsentVersion='1';},b=>{b.personal.notice=null;}]){
    const value=structuredClone(good);mutate(value);assert.throws(()=>validateScenePolicyBasis(value));
  }
});
test('GZ-CS-01/08：准备依据不能包含晚于本次实际评估的本人来源',()=>{
  const value=structuredClone(basis());value.sources[0].receivedSeq='200';
  assert.throws(()=>validateScenePolicyBasis(value));
});
