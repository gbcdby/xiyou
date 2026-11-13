/** 本人策略只处理已授权输入；系统身份与动态路径由可信适配层给出布尔资格。 */
export function decideGaolaoScenePolicy({snapshot,knowledge,participant,eligibility,retreat}){
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
