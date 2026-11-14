import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {attachScenePolicies} from '../scene-policy-runtime.mjs';
import {until,deferred} from '../test-support/ai-room.mjs';

/** 调度接点替身只安排返回/通知窗口；不计为 authority、生产初始化或本人效果证据。 */
async function controller(t,{firstResult='Accepted',loseReturn=false,holdRecovery=false,failRecovery=false}={}){
  const runtime=new EventEmitter(),entered=deferred(),release=deferred(),log=[];
  let seq='0',requested=false,index=0,pending=null,lastReceipt=null,lost=false,recoveryHeld=false,recoveryFailures=0,prepareCount=0;
  const submitted=[],prepared=[];
  runtime.pool={async query(sql){return {rows:sql.includes('AS content_version')?[{content_version:'gaolaozhuang-scene-v3'}]:[{session_id:'scene-personal'}]};}};
  runtime.bindInternal=async()=>({actorId:'gz-cuilan'});
  runtime.recoverScenePolicy=async()=>{
    if(lost&&failRecovery){recoveryFailures++;throw Object.assign(new Error('限定恢复查询故障'),{code:'57014'});}
    if(lost&&holdRecovery&&!recoveryHeld){recoveryHeld=true;entered.resolve();await release.promise;}
    return {pending,receipts:lastReceipt?[lastReceipt]:[],phase:'Running'};
  };
  runtime.prepareScenePolicy=async()=>{
    prepareCount++;
    if(pending)return {kind:'recovery',intentId:pending};
    if(!requested||index===2)return {kind:'idle',reason:'没有未处理的当前步骤。',evaluatedThroughSeq:seq};
    pending=['appearance-original','private-original'][index];prepared.push(pending);
    return {kind:'prepared',intentId:pending,evaluatedThroughSeq:seq};
  };
  runtime.submitSpatialIntent=async(_handle,id)=>{
    assert.equal(id,pending,'只提交已预留的原身份');submitted.push(id);
    const status=index===0&&firstResult==='Rejected'?'Rejected':'Accepted',noChange=index===0&&firstResult==='NO_CHANGE';
    if(status==='Accepted'&&!noChange)seq=String(BigInt(seq)+1n);
    lastReceipt={clientActionId:id,status,observedSeq:seq,code:noChange?'NO_CHANGE':status==='Accepted'?'OK':'STALE_PRECONDITION',actionEventRange:status==='Accepted'&&!noChange?{first:seq,last:seq}:null};
    pending=null;index++;
    // 特意不送本次提交通知；已读的另一用途仍必须得到一次机会。
    if(loseReturn&&!lost){lost=true;throw Object.assign(new Error('原提交已完成但返回和通知均丢失'),{code:'OUTCOME_UNKNOWN'});}
    return lastReceipt;
  };
  const attachment=await attachScenePolicies({runtime,retryIntervalMs:5,log:(...args)=>log.push(args)});
  t.after(async()=>{release.resolve();failRecovery=false;await attachment.close();});
  const status=()=>attachment.status().actors[0];
  await until(()=>status()?.phase==='Idle'&&!status().bootstrap,'初始化扫描收束',1000);
  const signal=value=>{seq=value;runtime.emit('commit',{sessionId:'scene-personal',events:[],scenePolicyWake:{actorId:'gz-cuilan',throughSeq:value,relevant:true}});};
  return {runtime,attachment,status,submitted,prepared,log,entered:entered.promise,release:()=>release.resolve(),signal,
    request(){requested=true;signal('10');},get prepareCount(){return prepareCount;},get recoveryFailures(){return recoveryFailures;},allowRecovery(){failRecovery=false;}};
}

test('GZ-CS-08/12 调度合同：COMMIT 丢返回和通知后原身份恢复，原 pending 保留另一用途',async t=>{
  const c=await controller(t,{loseReturn:true,holdRecovery:true});c.request();await c.entered;
  c.release();await until(()=>c.status().phase==='Idle'&&c.status().pendingSemanticSeq==='0','原结果与剩余待办均收束',1000);
  assert.deepEqual(c.prepared,['appearance-original','private-original']);assert.deepEqual(c.submitted,c.prepared);
  const evaluations=c.prepareCount;await c.attachment.recover('scene-personal');await until(()=>c.status().phase==='Idle','纯恢复收束',1000);
  assert.equal(c.prepareCount,evaluations,'重复旧 Receipt 不新评估或发动作');
});

for(const firstResult of ['Rejected','NO_CHANGE'])test(`GZ-CS-12 调度合同：原 ${firstResult} 无新通知也不吞另一份已读待答`,async t=>{
  const c=await controller(t,{firstResult});c.request();await until(()=>c.status().phase==='Idle'&&c.status().pendingSemanticSeq==='0','有界扫描收束',1000);
  assert.deepEqual(c.prepared,['appearance-original','private-original']);assert.equal(c.submitted.length,2);
});

test('GZ-CS-08/12 调度合同：Unknown 期间更高通知只保存在 pending；旧 Receipt 在较高已消费水位后不再触发选择',async t=>{
  const c=await controller(t,{loseReturn:true,holdRecovery:true});c.request();await c.entered;
  c.signal('30');assert.equal(c.status().lastSemanticSeq,'0');assert.equal(c.status().pendingSemanticSeq,'30');assert.equal(c.prepared.length,1);
  c.release();await until(()=>c.status().phase==='Idle'&&c.status().pendingSemanticSeq==='0','较高语义与两用途收束',1000);
  assert.equal(c.submitted.length,2);c.signal('100');await until(()=>c.status().lastSemanticSeq==='100','真实新语义的无动作扫描已消费',1000);
  const count=c.prepareCount;await c.attachment.recover('scene-personal');await until(()=>c.status().phase==='Idle','历史结果读回',1000);
  for(const value of ['100','30','10'])c.runtime.emit('commit',{sessionId:'scene-personal',events:[],scenePolicyWake:{actorId:'gz-cuilan',throughSeq:value,relevant:true}});
  assert.equal(c.prepareCount,count);assert.equal(c.submitted.length,2);assert.equal(c.status().pendingSemanticSeq,'0');
});

test('GZ-CS-09/12 调度合同：Unknown 自动重试三次后只通知一次，pending 不续命自旋，显式恢复保留原身份',async t=>{
  const c=await controller(t,{loseReturn:true,failRecovery:true});c.request();
  await until(()=>c.status().phase==='Unknown'&&c.recoveryFailures===3,'原查询三次失败后待恢复',1000);
  assert.equal(c.log.length,1);assert.match(c.log[0][0],/重试已耗尽/);assert.equal(c.status().retryExhausted,true);
  const count=c.prepareCount;c.signal('50');await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(c.recoveryFailures,3);assert.equal(c.prepareCount,count);assert.equal(c.log.length,1);assert.equal(c.status().pendingSemanticSeq,'50');
  c.allowRecovery();await c.attachment.recover('scene-personal');await until(()=>c.status().phase==='Idle'&&c.status().pendingSemanticSeq==='0','显式恢复及原待办完成',1000);
  assert.deepEqual(c.submitted,['appearance-original','private-original']);assert.equal(c.status().retryExhausted,false);
});
