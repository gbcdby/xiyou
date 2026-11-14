#!/usr/bin/env python3
"""生成本任务的有限配置与事先判据；不执行项目业务或修改候选 Spec。"""
from pathlib import Path
import json

HERE = Path(__file__).resolve().parent
TOOL = {'version': 'v1.7.4 / TLC 2.19', 'sha256': '936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88'}
SOURCE = {'commit': '76d98e137f5220518b072650ba6af8001966ea23', 'tree': '18287fbcde9590c6ce83a82ee747dfafaccdfe46', 'revision': 'CS-R1', 'mode': 'design/check', 'implementation_status': 'NOT_ASSESSED'}
SOURCE_R2 = {'commit':'1a7f45ddfeca0d25fb3714e1ce45980b225d5bde','tree':'6b0130cd6838bf052504994527f05e29aabf521e','revision':'CS-R2','mode':'design/check','implementation_status':'NOT_ASSESSED'}
ALL = {}
EXPECT = {}

def add(kind, name, params, invariants, properties=(), status='PASS_WITHIN_SCOPE', target=None, minimum=10, note=''):
    profile = f'{kind}-{name}'
    prefix = 'Authority' if kind=='authority' else ''
    lines = ['SPECIFICATION ' + prefix + ('LiveSpec' if properties else 'Spec'), 'CONSTANTS']
    for key, value in params.items():
        literal = 'TRUE' if value is True else 'FALSE' if value is False else json.dumps(value)
        lines.append(f'  {key} = {literal}')
    for heading, entries in [('INVARIANTS', invariants), ('PROPERTIES', properties)]:
        if entries:
            lines.append(heading)
            lines.extend('  '+entry for entry in entries)
    lines.append('CHECK_DEADLOCK TRUE')
    (HERE/'model'/f'{profile}.cfg').write_text('\n'.join(lines)+'\n')
    ALL.setdefault(kind, {})[profile] = {
        'config': f'{profile}.cfg', 'timeout_seconds': 60, 'workers': 1, 'heap_mb': 512,
        'expected_invariants': list(invariants), 'expected_properties': list(properties), 'checks_deadlock': True,
        'scope': {'parameters': params, 'minimum_distinct_states': minimum, 'note': note,
                  'excluded': ['生产源码对应/SQL事务隔离', '精确几何及人物可玩性', '全产品组合证明', '无限历史和任意多次重启']},
        'assumptions': ['动作世界效果和原Receipt为同一权威事务；这是实现义务。',
                        '所有请求身份/用途/来源摘要抽象为有限值，不证明鉴权或摘要算法。',
                        '本配置没有CONSTRAINT、VIEW、对称归约或随机模拟。'] +
            (['活性只对已允许评估的有限语义/内部提交/恢复/已提交首次通知加弱公平；不假设旁观NPC离开。'] if kind=='recovery' and properties else []) +
            (['归还活性条件是持有人真实合作到达/有效引用持续成立，并对正常交回动作弱公平；不承诺离线者回来。'] if kind in ['effects','authority'] and properties else []) +
            (['仅对最新完整快照送达加弱公平；已有传输view/generation/seq规则是组合接口义务，未对应生产源码。'] if kind=='projection' else [])}
    EXPECT[profile] = {'manifest': f'{kind}-verification.json', 'status': status,
                      'raw_exit': 0 if status=='PASS_WITHIN_SCOPE' else (13 if properties else 12),
                      'invariants': list(invariants), 'properties': list(properties),
                      'minimum_distinct_states': minimum, 'target': target, 'note': note}

def negative(kind,name,params,target,note=''):
    add(kind,'negative-'+name,params,[target],status='COUNTEREXAMPLE',target=target,note=note)

def witness(kind,name,params,note=''):
    add(kind,'witness-'+name,dict(params,Probe=name),['NoWitness'],status='COUNTEREXAMPLE',target='NoWitness',note=note)

cas=dict(SamePurpose=False,Fault='none',Probe='none')
ci=['TypeOK','SingleCommitPerPublicRevision','NoThirdPartyOverwrite']
add('cas','different-purpose',cas,ci,minimum=20)
add('cas','same-purpose',dict(cas,SamePurpose=True),ci,minimum=10)
negative('cas','type',dict(cas,Fault='type'),'TypeOK')
negative('cas','skip-cas',dict(cas,Fault='skip-cas'),'SingleCommitPerPublicRevision')
negative('cas','overwrite',dict(cas,SamePurpose=True,Fault='overwrite'),'NoThirdPartyOverwrite')
witness('cas','concurrent',cas)
witness('cas','both-purposes',cas)

co=dict(Focus='appearance',FirstChoice='accepted',OtherChoice='accepted',NewRequester='p1',Event='requester-epoch',Fault='none',Probe='none')
coi=['TypeOK','OwnDecisionOnly','PurposeRequestIsolation','ScopeBinding','ActiveRequiresCurrent',
     'ReceiptDoesNotReactivate','EffectAtMostOnce','DecisionBasisRechecked','NoThirdPartyReplacement',
     'OwnerCanCloseInvalidated','SafetyAndHistoryDurable']
add('consent','appearance',co,coi,minimum=30000)
add('consent','private',dict(co,Focus='private_items'),coi,minimum=30000)
for event in ['owner-epoch','source','local','pause','terminal','revoke']:
    add('consent',event,dict(co,Event=event),coi,minimum=1000)
add('consent','third-party',dict(co,NewRequester='p2'),coi,minimum=1000)
for choice in ['declined','deferred']:
    add('consent',choice,dict(co,FirstChoice=choice,OtherChoice=choice,Event='none'),coi,minimum=1000)
for fault,target,event in [
 ('type','TypeOK','none'),('cancel-as-withdraw','OwnDecisionOnly','none'),
 ('wrong-request','PurposeRequestIsolation','none'),('wrong-withdraw','PurposeRequestIsolation','requester-epoch'),
 ('wrong-scope','ScopeBinding','none'),('skip-invalidation','ActiveRequiresCurrent','requester-epoch'),
 ('receipt-reactivates','ReceiptDoesNotReactivate','none'),('repeat-effect','EffectAtMostOnce','none'),
 ('stale-basis','DecisionBasisRechecked','local'),('third-party','NoThirdPartyReplacement','none'),
 ('old-participant-epoch','OwnerCanCloseInvalidated','requester-epoch'),('rollback','SafetyAndHistoryDurable','requester-epoch')]:
    negative('consent',fault,dict(co,Fault=fault,Event=event,NewRequester='p2' if fault=='third-party' else 'p1'),target)
for probe in ['both-accepted','cancel-before','accept-before','stale-response','stale-withdraw','c2-after-epoch','replay-closed']:
    witness('consent',probe,dict(co,Focus='private_items'))
for choice in ['declined','deferred']:
    witness('consent',choice,dict(co,FirstChoice=choice,OtherChoice=choice,Event='none'))

ef=dict(UsePurpose='private_items',ProjectionMode='item-ledger',Fault='none',Probe='none',EnableEnvironment=False)
efi=['TypeOK','AtomicAppearanceStop','AtomicPrivateStop','PurposeAndTakerAuthorized','CustodyProvenance','PrivateOwnerOnly',
     'RestitutionEnabled','ReturnEntryRetained','ReceiptNeverReactivates','ConfirmedProjectionOnly','SafetyAndKnowledgeDurable',
     'CompletedItemNotRetaken','RemainingItemEntitlement','ReturnPreservesClosureCause','ReturnContextPrivate','CurrentReturnReference']
add('effects','private',ef,efi,minimum=1000,note='R2物件级投影；删除无关全局历史计数，加入逐物消费/完整观察投影/两view/历史裁剪。旧模型结果保留。')
add('effects','appearance',dict(ef,UsePurpose='appearance'),efi,minimum=100)
add('effects','restart-private',dict(ef,EnableEnvironment=True),efi,minimum=1000)
add('effects','both',dict(ef,UsePurpose='both'),efi,minimum=1000,note='两用途世界效果的有限交错，仍非全产品组合精化。')
add('effects','cooperative-return',ef,efi,['CooperativeReturns','ProjectionEventuallyCurrent'],minimum=1000)
add('effects','r1-current-only',dict(ef,ProjectionMode='current-only'),['ReturnEntryRetained'],status='COUNTEREXAMPLE',target='ReturnEntryRetained',note='R1设计缺口探针；不是隔离缺陷实现，也不是生产运行失败。')
for fault,target,purpose in [
 ('type','TypeOK','private_items'),('split-stop','AtomicAppearanceStop','appearance'),
 ('split-private','AtomicPrivateStop','private_items'),('cross-purpose','PurposeAndTakerAuthorized','appearance'),
 ('wrong-taker','PurposeAndTakerAuthorized','private_items'),('old-capability','PurposeAndTakerAuthorized','private_items'),
 ('reassign-custody','CustodyProvenance','private_items'),('public-return','PrivateOwnerOnly','private_items'),
 ('return-needs-active','RestitutionEnabled','private_items'),('receipt-reactivates','ReceiptNeverReactivates','private_items'),
 ('ui-receipt-overwrite','ConfirmedProjectionOnly','private_items'),('rollback','SafetyAndKnowledgeDurable','private_items'),
 ('retake-completed','CompletedItemNotRetaken','private_items'),('first-item-closes-all','RemainingItemEntitlement','private_items'),
 ('return-rewrites-history','ReturnPreservesClosureCause','private_items'),('leak-return','ReturnContextPrivate','private_items'),
 ('stale-return-view','CurrentReturnReference','private_items'),('history-trims-return','ReturnEntryRetained','private_items')]:
    negative('effects',fault,dict(ef,Fault=fault,UsePurpose=purpose),target)
for probe in ['old-return','old-return-new-slot','new-slot-old-custody','late-old-receipt','restored-origin',
              'first-return-second-held','new-grant-retake','old-return-refresh-prune']:
    witness('effects',probe,ef)
witness('effects','appearance-stopped',dict(ef,UsePurpose='appearance'))
witness('effects','restart-new',dict(ef,EnableEnvironment=True))
add('effects','negative-live-return',dict(ef,Fault='return-needs-active'),[],['CooperativeReturns'],status='COUNTEREXAMPLE')
add('effects','negative-missed-projection',dict(ef,Fault='miss-return-projection'),[],['ProjectionEventuallyCurrent'],status='COUNTEREXAMPLE')

re=dict(Focus='appearance',MaxIntents=4,FailuresBefore=1,FailuresAfter=1,AllowRestart=True,Fault='none',Probe='none')
rei=['TypeOK','SingleUnsettled','OriginalIdentityStable','ReceiptStable','EffectAtMostOnce','PendingPurposesPreserved','CapacitySufficient']
add('recovery','appearance',re,rei,['BothPurposesProgress'],minimum=10000)
add('recovery','private',dict(re,Focus='private_items'),rei,['BothPurposesProgress'],minimum=10000)
add('recovery','expanded-capacity',dict(re,MaxIntents=5),rei,['BothPurposesProgress'],minimum=10000,note='容量从4到5；检查原边界未阻断必需新尝试。')
add('recovery','retry-bound',dict(re,FailuresBefore=4,FailuresAfter=0),rei,minimum=10000,note='允许技术故障超过3次，检查进入人工待恢复且身份仍保留；不承诺活性。')
for fault,target in [('type','TypeOK'),('unknown-new-id','SingleUnsettled'),('rewrite-original','OriginalIdentityStable'),
                     ('receipt-after-validation','ReceiptStable'),('repeat-effect','EffectAtMostOnce'),
                     ('consume-all','PendingPurposesPreserved'),('recovery-drops-other','PendingPurposesPreserved')]:
    negative('recovery',fault,dict(re,Fault=fault),target)
negative('recovery','capacity',dict(re,MaxIntents=2),'CapacitySufficient','故意过小容量应使义务报错，不能让边界挡住工作后声称通过。')
for probe in ['both-complete','unknown-before','unknown-after','new-while-unknown','restart-recovered']:
    witness('recovery',probe,re)
witness('recovery','retry-exhausted',dict(re,FailuresBefore=4,FailuresAfter=0))

te=dict(InitialSettled=True,FirstTerm='reusable',CorruptPurpose='none',Fault='none',Probe='none')
tei=['TypeOK','ScopeTermImmutable','NoReusableGrant','StrictTermBasis','OnlyOwnerDeclines','NoReusableUse']
add('terms','reusable-remedy',te,tei,minimum=100)
add('terms','single-use',dict(te,FirstTerm='single_use'),tei,minimum=10)
add('terms','before-settlement',dict(te,InitialSettled=False),tei,minimum=100)
for fault,target in [('type','TypeOK'),('edit-old-scope','ScopeTermImmutable'),('generic-grant','NoReusableGrant'),
                     ('drop-term-basis','StrictTermBasis'),('schema-declines','OnlyOwnerDeclines')]:
    negative('terms',fault,dict(te,Fault=fault),target)
witness('terms','both-remedies',te)
witness('terms','private-deferred',dict(te,InitialSettled=False))
witness('terms','authority-rejected',te)
witness('terms','single-use-permitted',te)
for purpose in ['appearance','private_items']:
    add('terms','use-defense-'+purpose,dict(te,CorruptPurpose=purpose),
        ['TypeOK','ScopeTermImmutable','StrictTermBasis','OnlyOwnerDeclines','NoReusableUse'],minimum=10,
        note='独立使用守卫的故障注入切面：上游已错误保存reusable accepted；不声称该初态是正常设计可达。NoReusableGrant有意不适用于此故障切面。')
    negative('terms','use-defense-'+purpose,dict(te,CorruptPurpose=purpose,Fault='skip-use-term'),'NoReusableUse',
             '与相同故障切面正对照，仅移除使用时single_use重验。')

# 权威组件保留同一世界后态及所有规则动作；服务器接受合法归还不依赖UI已收到缓存。
# 此组件正向穷尽不替代PersonalEffects完整客户端组合的INCONCLUSIVE。
ai=[x for x in efi if x!='ConfirmedProjectionOnly']
add('authority','private',ef,ai,minimum=1000,note='R2服务器Effects组件；完整归还集合派生包含在观察接口中，缓存消费不在本组件。')
add('authority','restart-private',dict(ef,EnableEnvironment=True),ai,minimum=1000)
add('authority','both',dict(ef,UsePurpose='both'),ai,minimum=1000)
add('authority','cooperative-return',ef,ai,['CooperativeReturns'],minimum=1000)
negative('authority','current-only',dict(ef,ProjectionMode='current-only'),'ReturnEntryRetained')
negative('authority','first-item-closes-all',dict(ef,Fault='first-item-closes-all'),'RemainingItemEntitlement')
negative('authority','retake-completed',dict(ef,Fault='retake-completed'),'CompletedItemNotRetaken')
witness('authority','new-grant-retake',ef)
witness('authority','old-return-new-slot',ef)

pr=dict(Outcome='owner',Fault='none',Probe='none')
pri=['TypeOK','CompleteSnapshot','NoRollback','CurrentViewOnly','ReceiptDoesNotChangeSnapshot']
add('projection','owner',pr,pri,['EventuallyCurrent'],minimum=100,note='七个合法私物后态的完整快照传输实例；非所有Effects历史的组合证明。')
add('projection','origin',dict(pr,Outcome='origin'),pri,['EventuallyCurrent'],minimum=100)
for fault,target in [('type','TypeOK'),('current-only','CompleteSnapshot'),('stale-view','CompleteSnapshot'),
                     ('accept-old-seq','NoRollback'),('accept-old-view','CurrentViewOnly'),
                     ('receipt-overwrite','ReceiptDoesNotChangeSnapshot')]:
    negative('projection',fault,dict(pr,Fault=fault),target)
for probe in ['new-view-old-holding','late-accepted','same-slot-change']:
    witness('projection',probe,pr)
witness('projection','origin-not-delivered',dict(pr,Outcome='origin'))
add('projection','negative-receipt-liveness',dict(pr,Fault='receipt-overwrite'),[],['EventuallyCurrent'],
    status='COUNTEREXAMPLE',note='旧Accepted持续晚到可与合法最新投影交替；若错误写当前快照，弱公平送达也无法最终稳定。')

for name in ['effects-restart-private','effects-both']:
    ALL['effects'][name]['timeout_seconds']=300
    ALL['effects'][name]['scope']['time_budget_note']='root针对已出现60秒超时的具体剩余风险授权有界增至300秒；旧运行不改写。'

for name in ['authority-restart-private','authority-both']:
    ALL['authority'][name]['timeout_seconds']=300
    ALL['authority'][name]['scope']['time_budget_note']='同一重启/双用途具体风险的权威分层；原60秒独立结果保留，仅补一次300秒。'

for kind, profiles in ALL.items():
    module={'cas':'PersonalCAS','consent':'PersonalConsent','effects':'PersonalEffects','recovery':'PersonalRecovery','terms':'PersonalTerms',
            'authority':'AuthorityEffects','projection':'PersonalProjection'}[kind]
    (HERE/f'{kind}-verification.json').write_text(json.dumps({'schema_version':1,'tool':TOOL,'source':SOURCE_R2 if kind in ['effects','terms','authority','projection'] else SOURCE,
        'model':{'root':'model','entry':module+'.tla'},'profiles':profiles},ensure_ascii=False,indent=2)+'\n')
(HERE/'expectations.json').write_text(json.dumps(EXPECT,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'profiles':len(EXPECT),'positive':sum(v['status']=='PASS_WITHIN_SCOPE' for v in EXPECT.values()),
                  'expected_counterexamples':sum(v['status']=='COUNTEREXAMPLE' for v in EXPECT.values())},ensure_ascii=False))
