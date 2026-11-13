import {loadContent} from '../content/index.mjs';

const attachments=new WeakMap();
const greater=(a,b)=>BigInt(a)>BigInt(b);
const max=(a,b)=>greater(a,b)?a:b;
const terminal=phase=>['Finished','Aborted'].includes(phase);
const technical=error=>error.code==='OUTCOME_UNKNOWN'||/^(08|53|57|58)/.test(error.code??'')||['40001','40P01','ECONNRESET','EPIPE','ETIMEDOUT'].includes(error.code);

/** 独立场景策略执行器；没有 Gateway、ai_runs 或模型预算入口。 */
export async function attachScenePolicies({runtime,retryIntervalMs=100,log=()=>{}}){
  if(attachments.has(runtime))return attachments.get(runtime);
  if(!Number.isSafeInteger(retryIntervalMs)||retryIntervalMs<1)throw new Error('场景重试间隔必须为正整数。');
  const actors=new Map(),registrations=new Map(),tasks=new Set();
  let closed=false,closing;
  const track=promise=>{tasks.add(promise);promise.finally(()=>tasks.delete(promise)).catch(()=>{});return promise;};
  const consume=(a,through)=>{a.lastSemanticSeq=max(a.lastSemanticSeq,through);if(!greater(a.pendingSemanticSeq,through))a.pendingSemanticSeq='0';a.bootstrap=false;};
  function enqueue(a,retry=false){
    if(closed||a.running||a.timer||a.terminal||a.phase==='Unavailable'||a.phase==='Unknown'&&a.retries>=3&&!retry)return;
    a.running=true;track(run(a).finally(()=>{a.running=false;if(!closed&&!a.terminal&&!a.timer&&a.phase==='Idle'&&(a.bootstrap||greater(a.pendingSemanticSeq,a.lastSemanticSeq)))enqueue(a);}));
  }
  function wake(a,seq){
    if(a.terminal||!greater(seq,a.lastSemanticSeq))return;
    a.pendingSemanticSeq=max(a.pendingSemanticSeq,seq);enqueue(a);
  }
  async function recoverOriginal(a){
    const recovered=await runtime.recoverScenePolicy(a.handle);a.recoveries++;
    for(const receipt of recovered.receipts){a.lastReceipt=receipt;a.intentId=null;}
    if(recovered.pending){
      a.intentId=recovered.pending;
      a.lastReceipt=await runtime.submitSpatialIntent(a.handle,recovered.pending);
      const settled=await runtime.recoverScenePolicy(a.handle);a.recoveries++;
      if(settled.pending)throw Object.assign(new Error('原场景步骤结果仍待核对。'),{code:'OUTCOME_UNKNOWN'});
      for(const receipt of settled.receipts)a.lastReceipt=receipt;
      a.intentId=null;
    }
    if(terminal(recovered.phase)){a.terminal=true;a.bootstrap=false;a.pendingSemanticSeq='0';}
    a.intentId=null;a.needsRecovery=false;a.error=null;
  }
  async function run(a){
    a.phase='Running';
    try{
      if(a.needsRecovery)await recoverOriginal(a);
      if(closed||a.terminal){a.phase='Idle';return;}
      if(!a.bootstrap&&!greater(a.pendingSemanticSeq,a.lastSemanticSeq)){a.phase='Idle';return;}
      const prepared=await runtime.prepareScenePolicy(a.handle,{semanticSeq:a.pendingSemanticSeq});a.evaluations++;
      if(prepared.kind==='recovery'){a.needsRecovery=true;a.intentId=prepared.intentId;await recoverOriginal(a);a.phase='Idle';return;}
      // 返回不能覆盖在读前、读后或 COMMIT 返回期间收到的更晚语义。
      consume(a,prepared.consumeThroughSeq??prepared.evaluatedThroughSeq);a.reason=prepared.reason??null;
      if(prepared.kind==='prepared'){
        a.intentId=prepared.intentId;a.needsRecovery=true;
        a.lastReceipt=await runtime.submitSpatialIntent(a.handle,prepared.intentId);
        await recoverOriginal(a);
      }
      a.retries=0;a.phase='Idle';
    }catch(error){
      a.error=error.code??'INTERNAL_ERROR';
      if(technical(error)){
        a.phase='Unknown';a.needsRecovery=true;
        if(!closed&&!a.terminal&&a.retries<3){a.retries++;a.timer=setTimeout(()=>{a.timer=null;enqueue(a,true);},retryIntervalMs);a.timer.unref?.();}
      }else{a.phase='Unavailable';log('场景本人策略停止，保留原步骤等待核查。',{sessionId:a.sessionId,code:a.error});}
    }
  }
  async function register(sessionId){
    if(closed||actors.has(sessionId))return;
    if(registrations.has(sessionId))return registrations.get(sessionId);
    const promise=(async()=>{
      const row=(await runtime.pool.query("SELECT state->>'contentVersion' AS content_version FROM sessions WHERE session_id=$1 AND state->>'phase'='Running' AND content_snapshot->'chapterRules'->'sceneRolePolicies' IS NOT NULL",[sessionId])).rows[0];
      if(!row||closed)return;
      const content=await loadContent(row.content_version),policy=content.chapterRules.sceneRolePolicies[0],handle=await runtime.bindInternal(sessionId,policy.actorId,'scene_role');
      if(closed)return;
      const a={sessionId,actorId:policy.actorId,handle,phase:'Idle',running:false,terminal:false,bootstrap:true,needsRecovery:true,retries:0,timer:null,lastSemanticSeq:'0',pendingSemanticSeq:'0',intentId:null,evaluations:0,recoveries:0,lastReceipt:null,error:null};
      actors.set(sessionId,a);enqueue(a);
    })();
    registrations.set(sessionId,promise);
    promise.finally(()=>registrations.delete(sessionId)).catch(()=>{});return promise;
  }
  const onCommit=notice=>{
    if(closed)return;
    const a=actors.get(notice.sessionId);
    if(!a){if(notice.scenePolicyWake?.relevant||notice.events.some(e=>['spatial.started','control.changed'].includes(e.kind)))track(register(notice.sessionId)).catch(error=>log('场景角色登记暂未完成。',{code:error.code??'INTERNAL_ERROR'}));return;}
    if(notice.events.some(e=>['session.finished','session.aborted'].includes(e.kind))){a.terminal=true;a.bootstrap=false;a.pendingSemanticSeq='0';clearTimeout(a.timer);a.timer=null;return;}
    if(a.terminal)return;
    // 资格差来自这个实际事务的起点/终点，不用在途旧快照猜新提议的路线。
    const signal=notice.scenePolicyWake;
    if(signal?.actorId===a.actorId&&signal.relevant)wake(a,signal.throughSeq);
    let paused=notice.spatialPauseBefore;
    for(const event of notice.events)if(event.kind==='spatial.clock'){
      if(paused===true&&event.payload.paused===false)wake(a,event.sessionSeq);
      paused=event.payload.paused;
    }
  };
  runtime.on('commit',onCommit);
  const attachment={register,status(){return {closed,actors:[...actors.values()].map(a=>({sessionId:a.sessionId,actorId:a.actorId,phase:a.phase,intentId:a.intentId,error:a.error,lastReceipt:a.lastReceipt,evaluations:a.evaluations,recoveries:a.recoveries,technicalRetries:a.retries,lastSemanticSeq:a.lastSemanticSeq,pendingSemanticSeq:a.pendingSemanticSeq,bootstrap:a.bootstrap}))};},
    recover(sessionId){const a=actors.get(sessionId);if(!a||closed)return;clearTimeout(a.timer);a.timer=null;a.retries=0;a.needsRecovery=true;a.phase='Idle';if(a.terminal){a.running=true;return track(recoverOriginal(a).finally(()=>{a.running=false;}));}enqueue(a);},
    close(){if(closing)return closing;closed=true;runtime.off('commit',onCommit);for(const a of actors.values()){clearTimeout(a.timer);a.timer=null;}return closing=(async()=>{await Promise.allSettled([...registrations.values()]);while(tasks.size)await Promise.allSettled([...tasks]);attachments.delete(runtime);})();}
  };
  attachments.set(runtime,attachment);
  try{const rows=(await runtime.pool.query("SELECT session_id FROM sessions WHERE state->>'phase'='Running' AND content_snapshot->'chapterRules'->'sceneRolePolicies' IS NOT NULL")).rows;await Promise.all(rows.map(r=>register(r.session_id)));return attachment;}
  catch(error){await attachment.close();throw error;}
}
