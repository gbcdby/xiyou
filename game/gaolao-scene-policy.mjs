/** 本人策略只处理已授权输入；系统身份与动态路径由可信适配层给出布尔资格。 */
function decideRescue({snapshot,knowledge,participant,eligibility,retreat}){
  const p=snapshot.projection,self=p.self,c=participant.consent,f=participant.follow;
  const defer=reason=>({kind:'defer',reason});
  const action=(stepKey,value)=>({kind:'action',stepKey,action:value});
  if(!eligibility.authorized||p.phase!=='Running'||p.paused)return defer('当前暂停、终态或本人资格不成立。');
  if(participant.safe||f?.status==='settled')return defer('本次救援已经完成；没有后续搬迁选择。');
  if(c?.status==='accepted'&&f?.status==='paused'&&participant.pause==='deviation')return action(`withdraw:${c.consentId}:${c.version}`,{kind:'withdraw_consent',consentId:c.consentId,expectedConsentVersion:c.version});
  if(f&&['accepted','following','arrived'].includes(f.status)){
    if(f.status==='arrived'&&eligibility.arrived&&eligibility.exitReachable&&eligibility.versionsCurrent)return action(`settlement:${f.followId}:${f.planVersion}`,{kind:'interact',targetRef:self.entityRef,operationId:'gz-confirm-settlement',expectedTargetRevision:self.resourceRevision,parameters:{consentId:c.consentId,expectedConsentVersion:c.version}});
    return defer('等待当前实际随行或自由出口。');
  }
  if(c?.purpose==='follow'&&c.status==='proposed'&&f?.status==='proposed'){
    if(!eligibility.versionsCurrent||!eligibility.leaderHuman||!eligibility.leaderOnline)return defer('本次安排的系统资格已变更，需要重新提议。');
    if(!knowledge.rescue||!knowledge.routesReady)return defer('缺少本人实际收到的联络或本次路线图记。');
    if(!eligibility.doorOpen)return defer('后宅通路尚未开放。');
    // 可见的越界拒绝不能被寻路受阻遮蔽；看不见/不在身边则只暂缓。
    const response=!eligibility.near||!eligibility.visible||!eligibility.los?'defer':!eligibility.inRoute?'decline':!eligibility.localPathReachable?'defer':'accept';
    return action(`response:${c.consentId}:${c.version}`,{kind:'respond_consent',consentId:c.consentId,expectedConsentVersion:c.version,response});
  }
  if(!participant.retreated&&knowledge.rescue){
    if(eligibility.atRetreat)return action('retreat-confirm',{kind:'interact',targetRef:self.entityRef,operationId:'gz-step-back',expectedTargetRevision:self.resourceRevision});
    if(['accepted','moving'].includes(p.movement?.status))return defer('等待本人实际退让到达。');
    if(self.sceneId!==retreat.sceneId||!eligibility.retreatReachable)return defer('当前没有合法的门内退让通路。');
    return action('retreat-navigation',{kind:'move_to',sceneId:retreat.sceneId,destination:retreat.position});
  }
  return defer('没有本人需要回应的新安排。');
}

const personalPurposes=['appearance','private_items'];
const rescueBranch=choice=>choice.action.kind==='respond_consent'||choice.action.kind==='withdraw_consent'||choice.action.operationId==='gz-confirm-settlement'?'follow':'rescue';

/** 个人选择只用本人收到的声明/本次摘要与相关系统资格，不用旁人的控制或在线模式。 */
function decidePersonal(input,purpose){
  const defer=reason=>({kind:'defer',reason}),p=input.snapshot.projection;
  if(!input.eligibility.authorized||p.phase!=='Running'||p.paused)return defer('当前暂停、终态或本人资格不成立。');
  const request=input.participant.personalRequests?.find(r=>r.purpose===purpose),source=input.knowledge.personal?.[purpose],g=input.eligibility.personal?.[purpose];
  if(!request)return defer('没有本人需要回应的新安排。');
  if(!source||!g||source.declaration.fields.find(f=>f.key==='permission-term')?.value!=='single_use')return defer('缺少本人对应声明或本次请求依据；没有作出人物决定。');
  const action=(type,value,reason)=>({kind:'action',branch:purpose,stepKey:`${purpose}:${request.consentId}:${request.version}:${request.lifecycleVersion}:${type}`,action:value,reason});
  const own={consentId:request.consentId,expectedConsentVersion:request.version};
  if(request.status==='accepted'&&request.lifecycle==='open'&&g.noticeCurrent&&['binding_invalidated','appearance_disclosed'].includes(request.reasonCode)){
    return action('withdraw',{kind:'withdraw_consent',...own},'这次执行安排已经结束；我撤回这份许可，请重新说明。');
  }
  if(request.status!=='proposed'||request.lifecycle!=='open')return defer('本人已有决定，没有新的提议或本份许可的中断通知。');
  if(!g.proposalCurrent||!g.scopeKnown)return defer('本次请求的身份、范围或版本已失效，需要重新提议。');
  const respond=(response,reason)=>action('response',{kind:'respond_consent',...own,response},reason);
  if(purpose==='private_items'&&!input.participant.safe)return respond('defer','先把我安顿好，再重新说这次取物。');
  if(!g.near||!g.visible||!g.los||!g.exitReachable)return respond('defer','这次先缓一缓，回到我这里或把当前出口恢复后再说。');
  if(request.permissionTerm==='reusable')return respond('decline','这一次说清楚我会考虑；以后再用，请再问我。');
  if(request.permissionTerm!=='single_use'||!g.safeCurrent)return defer('本次明确范围或本人安置依据不完整。');
  return respond('accept',purpose==='appearance'?'我同意这一次明确的借貌安排。':'我同意这次把列明的私物原样取回给我。');
}

/** 有限候选按安全步骤、通知撤回、原请求水位排序；适配层只预留其中一份。 */
export function gaolaoScenePolicyCandidates(input){
  const rescue=decideRescue(input);
  if(input.policyVersion!=='gaolao-cuilan-v2')return [rescue];
  const candidates=rescue.kind==='action'?[{...rescue,branch:rescueBranch(rescue)}]:[];
  const requests=[...(input.participant.personalRequests??[])].sort((a,b)=>{
    const priority=r=>r.status==='accepted'&&input.eligibility.personal?.[r.purpose]?.noticeCurrent?0:1;
    return priority(a)-priority(b)||(BigInt(a.sourceSeq)<BigInt(b.sourceSeq)?-1:BigInt(a.sourceSeq)>BigInt(b.sourceSeq)?1:a.purpose.localeCompare(b.purpose));
  });
  let waiting=rescue;
  for(const request of requests){const choice=decidePersonal(input,request.purpose);if(choice.kind==='action')candidates.push(choice);else waiting=choice;}
  return candidates.length?candidates:[waiting];
}

/** 提交重验限定原分支，不让另一用途的新待办改写已经准备的本人意图。 */
export function decideGaolaoScenePolicy(input,{branch=null}={}){
  if(input.policyVersion!=='gaolao-cuilan-v2')return decideRescue(input);
  if(personalPurposes.includes(branch))return decidePersonal(input,branch);
  if(branch){const rescue=decideRescue(input);return rescue.kind==='action'&&rescueBranch(rescue)===branch?{...rescue,branch}:{kind:'defer',reason:'原救援分支没有相同的当前动作。'};}
  return gaolaoScenePolicyCandidates(input)[0];
}
