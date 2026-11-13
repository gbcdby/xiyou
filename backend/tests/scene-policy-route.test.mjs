import test from 'node:test';
import assert from 'node:assert/strict';
import {loadContent,validateContent} from '../../content/index.mjs';
import {COURT,ROAD,FRONT,TEA,routeOrigin,createPolicyRoute,checkPolicyLeader,policyLocalPath,routeSources,actualFrontExit,positionPermitted} from '../../game/gaolao-policy-route.mjs';
import {pointAlongPath} from '../../game/spatial-geometry.mjs';

const content=await loadContent('gaolaozhuang-scene-v2'),actor=(sceneId,x,y)=>({sceneId,position:{x,y},movement:null}),state={mapVersion:content.mapVersion};
test('GZ-SP04：B闭集优先、共有边界/过道多点和区域倒序不改变本次资料依据',()=>{
  for(const [x,y] of [[645,320],[645,327],[645,340],[645,365],[615,385],[650,390],[645,395]]){
    const subject=actor(COURT,x,y),reversed=structuredClone(content);reversed.scenes[0].walkableAreas.reverse();
    assert.equal(routeOrigin(content,subject),'front-branch');assert.equal(routeOrigin(reversed,subject),'front-branch');
    const r=createPolicyRoute(state,content,subject,subject,'tea-back-room');assert.deepEqual(r.sourceIds,[FRONT,TEA]);
    assert.equal(r.frontExitDone,false);assert.equal(r.origin,'front-branch');
  }
  const exit=actor(COURT,645,390),r=createPolicyRoute(state,content,exit,exit,'tea-back-room');assert.equal(r.frontExitDone,true);assert.equal(actualFrontExit(content,exit),true);
  assert.deepEqual(createPolicyRoute(state,content,actor(COURT,690,410),actor(COURT,690,410),'tea-back-room').sourceIds,[TEA]);
});
test('GZ-SP04/06：领路者先行不代本人完成C13；退出后公共交叠合法且不重开支线',()=>{
  const subject=actor(COURT,645,365),leader=actor(COURT,645,390),r=createPolicyRoute(state,content,subject,leader,'tea-back-room');
  const ahead=checkPolicyLeader(content,r,actor(COURT,700,420));assert.ok(ahead);assert.equal(ahead.frontExitDone,false);
  const local=policyLocalPath(content,ahead,subject,actor(COURT,700,420),()=>false);assert.deepEqual({...local.goal},{x:645,y:390});
  const moved=pointAlongPath(local.path,10000);assert.equal(moved.arrived,true);assert.equal(actualFrontExit(content,{...subject,position:moved.position}),true);
  ahead.frontExitDone=true;
  assert.equal(positionPermitted(content,ahead,actor(COURT,650,390)),true);assert.equal(positionPermitted(content,ahead,actor(COURT,645,350)),false);
  const reproposed=createPolicyRoute(state,content,actor(COURT,645,365),leader,'tea-back-room');assert.equal(reproposed.frontExitDone,false);
});
test('GZ-SP04：整段路经越界即停，两端均合法不能掩盖私自返回支线或绕行东侧',()=>{
  const subject=actor(ROAD,1000,460),r=createPolicyRoute(state,content,subject,subject,'tea-back-room');
  const bent={...actor(ROAD,1000,500),movement:{movementId:'new-path',sceneId:ROAD,path:[subject.position,{x:1100,y:460},{x:1000,y:500}],travelled:1000}};
  assert.equal(checkPolicyLeader(content,r,bent),null);
  const c=actor(COURT,645,390),exit=createPolicyRoute(state,content,c,c,'tea-back-room');
  assert.equal(checkPolicyLeader(content,exit,{...c,position:{x:650,y:390},movement:{movementId:'bad-backtrack',sceneId:COURT,path:[c.position,{x:645,y:350},{x:650,y:390}],travelled:200}}),null);
});
test('GZ-SP01/07：图记仅有限公开静态资料；旧内容不新增，私密节点配置被拒绝',async()=>{
  assert.equal((await loadContent('gaolaozhuang-v1')).chapterRules.sceneRolePolicies,undefined);
  const sources=routeSources(content),raw=JSON.stringify(sources);
  for(const secret of ['C07','R03','R07','R11','gz-wukong','privateItems','old-ledger','tea-witness','obstacles'])assert.ok(!raw.includes(secret),secret);
  assert.deepEqual(sources.map(s=>s.sourceId),[FRONT,TEA]);
  const bad=structuredClone(content);bad.chapterRules.routeSpecs[0].anchors.push({sceneId:COURT,anchorId:'C07'});assert.throws(()=>validateContent(bad),/白名单/);
});
