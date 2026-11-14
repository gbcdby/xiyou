import test from 'node:test';
import assert from 'node:assert/strict';
import {loadContent} from '../../content/index.mjs';
import {personalSources} from '../../game/gaolao-personal-contract.mjs';
import {decideGaolaoScenePolicy} from '../../game/gaolao-scene-policy.mjs';

const content=await loadContent('gaolaozhuang-scene-v3');
const sources=Object.fromEntries(personalSources(content).map(s=>[s.purpose,s.knowledge]));
function input(purpose='appearance',permissionTerm='single_use'){
  return {policyVersion:'gaolao-cuilan-v2',snapshot:{projection:{phase:'Running',paused:false,self:{entityRef:'S'.repeat(40),resourceRevision:'4',sceneId:'gaolao-courtyard'}}},
    knowledge:{rescue:true,routesReady:true,personal:sources},participant:{safe:true,retreated:true,consent:null,follow:{status:'settled'},personalRequests:[{
      purpose,consentId:'C'.repeat(40),version:'1',lifecycleVersion:'1',lifecycle:'open',status:'proposed',reasonCode:null,sourceSeq:'10',permissionTerm,
    }]},eligibility:{authorized:true,personal:{[purpose]:{proposalCurrent:true,scopeKnown:true,safeCurrent:true,near:true,visible:true,los:true,exitReachable:true,noticeCurrent:false}}},retreat:content.chapterRules.retreat};
}

test('GZ-CS-01/02：安置完成后仍由生产纯策略回应本次借貌，不沿 settled 提前退出',()=>{
  const choice=decideGaolaoScenePolicy(input());
  assert.equal(choice.kind,'action');
  assert.equal(choice.branch,'appearance');
  assert.deepEqual(choice.action,{kind:'respond_consent',consentId:'C'.repeat(40),expectedConsentVersion:'1',response:'accept'});
  assert.equal(choice.stepKey,`appearance:${'C'.repeat(40)}:1:1:response`);
});
