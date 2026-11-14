import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {canonicalize} from '../../protocol/index.mjs';
import {loadContent} from '../../content/index.mjs';
import {recoverScenePolicy} from '../scene-policy.mjs';
import {personalFixture,proposePersonalFixture,personalBasisFixture} from '../test-support/scene-personal-fixture.mjs';

async function contractRecovery({status='Accepted',range={first:'101',last:'105'},badIdentity=false}={}){
  const content=await loadContent('gaolaozhuang-scene-v3'),state=personalFixture(content),c=proposePersonalFixture(state,content,'appearance');
  const principal={sessionId:'session',actorId:c.subjectId,principalKind:'scene_role',principalId:'scene_role:'+c.subjectId};
  const request={schemaVersion:2,sessionId:'session',viewId:'V'.repeat(40),actorRef:'S'.repeat(40),clientActionId:'scene-a',controlEpoch:'1',baseSeq:'100',action:{kind:'respond_consent',consentId:c.consentId,expectedConsentVersion:'1',response:'accept'}};
  const digest=createHash('sha256').update(canonicalize(request)).digest('hex'),basis=personalBasisFixture(state,content,'appearance',{requestDigest:digest});
  const receipt={schemaVersion:2,sessionId:'session',clientActionId:'scene-a',status,code:status==='Accepted'?'OK':'STALE_PRECONDITION',observedSeq:'105',actionEventRange:range,result:{}};
  const row={intent_id:'scene-a',request,request_text_encoding:null,execution_context:{mode:'scene-policy',scenePolicyBasis:basis},scene_outcome:null};
  const prior={actor_id:c.subjectId,semantic_digest:badIdentity?'f'.repeat(64):digest,receipt:{publicReceipt:receipt}};
  const before=structuredClone({request:row.request,context:row.execution_context});let updates=0;
  const client={async query(sql){
    if(sql.startsWith('SELECT * FROM spatial_intents'))return {rows:[row]};
    if(sql.startsWith('SELECT receipt,semantic_digest,actor_id'))return {rows:[prior]};
    if(sql.startsWith('UPDATE spatial_intents SET scene_outcome')){updates++;row.scene_outcome=receipt;return {rows:[]};}
    throw new Error('合同检查不允许新增查询或动作：'+sql);
  }};
  const runtime={internal:()=>principal,authorizeInternal:async()=>{},locked:async(_id,_command,operation)=>operation({content,state,client})};
  const result=await recoverScenePolicy(runtime,{});
  assert.deepEqual({request:row.request,context:row.execution_context},before,'恢复不改写原意图/basis');assert.equal(updates,1);
  return {result,receipt};
}

test('GZ-CS-08 恢复合同：原 v2 本人 Accepted 只收束原结果，不从历史 Receipt 创建新语义',async()=>{
  const {result,receipt}=await contractRecovery();assert.deepEqual(result,{pending:null,receipts:[receipt],phase:'Running'});
});
test('GZ-CS-08 恢复合同：Rejected、无实际动作范围和错原摘要均不能补送成功语义',async()=>{
  for(const options of [{status:'Rejected',range:null},{range:null}])assert.equal((await contractRecovery(options)).result.personalResultSeq,undefined);
  await assert.rejects(contractRecovery({badIdentity:true}),{code:'ACTION_ID_REUSE'});
});
