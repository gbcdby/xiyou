import test from 'node:test';
import assert from 'node:assert/strict';
import {loadContent} from '../../content/index.mjs';
import {personalScenePolicyState,scenePolicyWake} from '../scene-policy.mjs';
import {decideGaolaoScenePolicy} from '../../game/gaolao-scene-policy.mjs';
import {personalFixture,proposePersonalFixture,invalidatedPersonalFixture} from '../test-support/scene-personal-fixture.mjs';

function choose(state,content,options){
  const own=content.chapterRules.people.cuilan,read=personalScenePolicyState(state,content,own);
  return decideGaolaoScenePolicy({policyVersion:'gaolao-cuilan-v2',snapshot:{projection:{phase:state.phase,paused:state.paused,self:{entityRef:'S'.repeat(40),resourceRevision:'5',sceneId:state.characters[own].sceneId}}},
    participant:{safe:state.chapter.cuilanSafe,retreated:true,consent:null,follow:{status:state.chapter.cuilanSafe?'settled':'following'},personalRequests:read.requests},
    knowledge:{rescue:false,routesReady:false,personal:read.knowledge},eligibility:{authorized:state.characters[own].mode==='CoreNPCControlled',personal:read.guards},retreat:content.chapterRules.retreat},options);
}

for(const version of ['gaolaozhuang-scene-v3','gaolaozhuang-tools-east-scene-v3'])for(const safe of ['front-guest-room','tea-back-room'])test(`GZ-CS-01/02/03 来源合同：${version}/${safe} 三会面点与两物均保留本人接受/拒绝路径`,async()=>{
  const content=await loadContent(version);
  for(const destinationId of content.chapterRules.meetingDestinations.map(d=>d.destinationId))for(const [term,response] of [['single_use','accept'],['reusable','decline']]){
    const state=personalFixture(content,{destinationId:safe});proposePersonalFixture(state,content,'appearance',{destinationId,term});
    const decision=choose(state,content);assert.equal(decision.kind,'action',decision.reason);assert.equal(decision.action.response,response);
  }
  for(const itemIds of [['gz-parcel'],['gz-letter'],['gz-parcel','gz-letter']])for(const [term,response] of [['single_use','accept'],['reusable','decline']]){
    const state=personalFixture(content,{destinationId:safe});proposePersonalFixture(state,content,'private_items',{itemIds,term});
    Object.defineProperty(state,'items',{get(){throw new Error('本人选择不得读取远处当前物件');}});
    assert.equal(choose(state,content).action.response,response);
  }
});

test('GZ-CS-03：随行尚未到达时可明确暂缓私物，已 deferred 不因安置自动接受',async()=>{
  const content=await loadContent('gaolaozhuang-scene-v3'),state=personalFixture(content,{safe:false}),c=proposePersonalFixture(state,content,'private_items');
  assert.equal(choose(state,content).action.response,'defer');
  c.status='deferred';c.version='2';state.chapter.personalRequests[c.consentId].lifecycle='closed';state.chapter.personalRequests[c.consentId].reasonCode='owner_deferred';
  const settled=personalFixture(content);state.chapter.cuilanSafe=true;state.chapter.safeRecord=settled.chapter.safeRecord;
  assert.equal(choose(state,content).kind,'defer');
});

test('GZ-CS-05/08：确切停权通知优先；本人恢复后可撤回，不要求旧请求者/执行者 epoch、近距或在线',async()=>{
  const content=await loadContent('gaolaozhuang-scene-v3'),state=personalFixture(content),old=proposePersonalFixture(state,content,'appearance',{sourceSeq:'25'});
  invalidatedPersonalFixture(state,content,old);proposePersonalFixture(state,content,'private_items',{sourceSeq:'10'});
  state.characters['human-a'].controlEpoch='2';state.characters['human-a'].mode='GracePeriod';state.chapter.onlineActorIds=['human-b'];state.characters[content.chapterRules.people.wukong].controlEpoch='2';
  state.characters[content.chapterRules.people.cuilan].controlEpoch='2';
  const choice=choose(state,content);assert.equal(choice.branch,'appearance');assert.equal(choice.action.kind,'withdraw_consent');assert.equal(choice.action.expectedConsentVersion,'2');
  state.chapter.personalRequests[old.consentId].notice=null;assert.equal(choose(state,content).kind,'defer','只有系统失效、没有本人收到通知时不伪作撤回');
});

test('GZ-CS-01/08/12：逐用途来源落窗、错源阻塞及按原 sourceSeq 选择，另一用途/旁人不改变原分支谓词',async()=>{
  const content=await loadContent('gaolaozhuang-scene-v3'),state=personalFixture(content),own=content.chapterRules.people.cuilan;
  const appearance=proposePersonalFixture(state,content,'appearance',{sourceSeq:'30'});proposePersonalFixture(state,content,'private_items',{sourceSeq:'20',term:'reusable'});
  assert.equal(state.observations[own].length,0);assert.equal(choose(state,content).branch,'private_items');
  assert.equal(choose(state,content,{branch:'appearance'}).action.response,'accept');
  const before=structuredClone(state);state.characters[content.chapterRules.people.tang].position=structuredClone(state.characters[own].position);state.characters[content.chapterRules.people.tang].mode='Revoked';state.sessionSeq='101';
  assert.equal(choose(state,content,{branch:'appearance'}).action.response,'accept');
  assert.equal(scenePolicyWake({row:{state:before},state,content}).relevant,false,'旁观角色单纯停留或隐藏控制变化不成为本人的 C5 依赖');
  delete state.chapter.provenance[own]['O'.repeat(40)];
  assert.equal(choose(state,content,{branch:'appearance'}).kind,'defer');assert.equal(choose(state,content).action.response,'decline','缺一用途的本人来源不代拒绝，也不吞另一份合法待办');
  assert.equal(appearance.status,'proposed');
});

test('GZ-CS-08/09：旧提议控制绑定、取消、缺字段和终态都不能得到新同意',async()=>{
  const content=await loadContent('gaolaozhuang-scene-v3');
  for(const change of ['epoch','cancel','pause','terminal','missing-record']){
    const state=personalFixture(content),c=proposePersonalFixture(state,content,'appearance');
    if(change==='epoch')state.characters['human-a'].controlEpoch='2';
    if(change==='cancel'){const r=state.chapter.personalRequests[c.consentId];r.lifecycle='cancelled';r.reasonCode='requester_cancelled';r.transitionActor='human-a';}
    if(change==='pause')state.paused=true;
    if(change==='terminal')state.phase='Finished';
    if(change==='missing-record'){delete state.chapter.personalRequests[c.consentId];assert.throws(()=>choose(state,content));}else assert.equal(choose(state,content).kind,'defer',change);
  }
});

test('GZ-CS-02/03：合法送达后请求者离位得到本人暂缓，隐藏控制失效只使原提议不可继续',async()=>{
  const content=await loadContent('gaolaozhuang-scene-v3');
  for(const purpose of ['appearance','private_items']){
    const state=personalFixture(content);proposePersonalFixture(state,content,purpose,{term:'reusable'});
    state.characters['human-a'].sceneId='gaolao-village-road';state.characters['human-a'].position={x:1060,y:610};
    const choice=choose(state,content);assert.equal(choice.action.response,'defer','当前近距条件优先于期限偏好');
    state.characters['human-a'].controlEpoch='2';assert.equal(choose(state,content).kind,'defer','失效提议不被包装成本人拒绝或暂缓');
  }
  assert.throws(()=>personalScenePolicyState(personalFixture(content),content,content.chapterRules.people.bajie),'钉耙本人的授权不能套翠兰策略');
});
