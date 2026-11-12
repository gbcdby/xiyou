import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSpatial } from '../spatial.mjs';
const ref = 'R' + 'a'.repeat(32);
test('高老庄有限动作：随行、本人回应及全员结束具有版本字段', () => {
  for (const action of [
    {kind:'propose_follow',subjectRef:ref,leaderRef:ref,destinationId:'front-guest-room',expectedConsentVersion:'0'},
    {kind:'respond_consent',consentId:ref,expectedConsentVersion:'1',response:'accept'},
    {kind:'withdraw_consent',consentId:ref,expectedConsentVersion:'2'},
    {kind:'request_end',proposalId:'ending-1',proposalVersion:'0',scope:'recruitment'},
    {kind:'confirm_end',proposalId:'ending-1',proposalVersion:'1'},
    {kind:'interact',targetRef:ref,operationId:'gz-confirm-settlement',expectedTargetRevision:'1',parameters:{consentId:ref,expectedConsentVersion:'2'}},
  ]) assert.deepEqual(validateSpatial('ActionV2', action), action);
});
test('高老庄有限动作：外部不能提交本人身份、到达或世界事实', () => {
  for (const extra of [{principalKind:'scene_role'},{subjectId:'cuilan'},{arrived:true},{CuilanSafe:true}])
    assert.throws(() => validateSpatial('ActionV2',{kind:'respond_consent',consentId:ref,expectedConsentVersion:'1',response:'accept',...extra}));
  assert.throws(() => validateSpatial('ActionV2',{kind:'interact',targetRef:ref,operationId:'gz-confirm-settlement',expectedTargetRevision:'1',parameters:{CuilanSafe:true}}));
});

test('高老庄operationId判别参数，缺参、混用途和未知章节操作在解析时拒绝',()=>{
  const base={kind:'interact',targetRef:ref,expectedTargetRevision:'0'};
  for(const x of [
    {operationId:'gz-confirm-settlement'},
    {operationId:'gz-step-back',parameters:{expectedDecisionVersion:'0',response:'accept'}},
    {operationId:'gz-request-appearance',parameters:{itemRef:ref,expectedItemRevision:'0'}},
    {operationId:'gz-invent-world'},
    {operationId:'legacy-operation',parameters:{consentId:ref,expectedConsentVersion:'1'}},
  ]) assert.throws(()=>validateSpatial('ActionV2',{...base,...x}));
  validateSpatial('ActionV2',{...base,operationId:'legacy-operation'});
});
test('授权复盘保留合法中文大页，原始请求继续受64KiB与重复键约束',async()=>{
  const {parseSpatial}=await import('../spatial.mjs');
  const recap={schemaVersion:2,type:'session.recap',sessionId:'session-test',throughSeq:'20',phase:'Finished',ending:{title:'暂告一段',summary:'按真实进展。'},entries:Array.from({length:12},(_,i)=>({entryRef:ref,eventSeq:String(20-i),category:'Claim',text:'证'.repeat(2000),fields:[]})),nextBeforeSeq:null};
  assert.ok(Buffer.byteLength(JSON.stringify(recap))>65536);assert.equal(JSON.stringify(parseSpatial('RecapV2',JSON.stringify(recap))),JSON.stringify(recap));
  assert.throws(()=>parseSpatial('RecapV2',JSON.stringify(recap).replace('"throughSeq":"20"','"throughSeq":"20","throughSeq":"20"')));
  assert.throws(()=>parseSpatial('PublicEnvelope',JSON.stringify({payload:'证'.repeat(30000)})));
});
