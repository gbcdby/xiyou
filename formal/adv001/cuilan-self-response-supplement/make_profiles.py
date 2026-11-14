#!/usr/bin/env python3
"""仅生成已声明补证配置；旧131项不改、不重新执行。"""
from pathlib import Path
import json
HERE=Path(__file__).resolve().parent
TOOL={'version':'v1.7.4 / TLC 2.19','sha256':'936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88'}
SOURCE={'commit':'1a7f45ddfeca0d25fb3714e1ce45980b225d5bde','tree':'6b0130cd6838bf052504994527f05e29aabf521e','revision':'CS-R2 supplement S1','mode':'check/design','base_formal_commit':'77ace28f526ce9ad905b1842b7353e48e251423c','implementation_status':'NOT_ASSESSED'}
ALL={};EXPECTED={}
def add(kind,name,params,invariants,properties=(),spec='Spec',target=None,minimum=100,note=''):
    profile=kind+'-'+name
    lines=['SPECIFICATION '+spec,'CONSTANTS']
    for k,v in params.items(): lines.append('  '+k+' = '+('TRUE' if v is True else 'FALSE' if v is False else json.dumps(v)))
    for heading,values in [('INVARIANTS',invariants),('PROPERTIES',properties)]:
        if values: lines += [heading]+['  '+x for x in values]
    lines+=['CHECK_DEADLOCK TRUE']
    (HERE/'model'/f'{profile}.cfg').write_text('\n'.join(lines)+'\n')
    neg=target is not None or name.startswith('negative-') or name.startswith('witness-')
    status='COUNTEREXAMPLE' if neg else 'PASS_WITHIN_SCOPE'
    profile_data={'config':profile+'.cfg','timeout_seconds':60,'workers':1,'heap_mb':512,
        'expected_invariants':list(invariants),'expected_properties':list(properties),'checks_deadlock':True,
        'scope':{'parameters':params,'minimum_distinct_states':minimum,'note':note,
                 'excluded':['生产实现精化/PG结果','无限请求/无限epoch/连续几何','原5项未完配置的重跑或改名']},
        'assumptions':['合法proposed及本人Accept需满足原CAS/Consent/Terms合同；本层不重新证明。',
                       '世界动作原子是实现义务，不是生产SQL已验证。','没有CONSTRAINT/VIEW/对称归约或随机模拟。']}
    if kind=='transport': profile_data['assumptions'] += ['payload是完整、合法、按observer过滤的不可分割值；同observer/view/seq唯一。','最新完整快照持续可投递时仅对DeliverLatest弱公平；不假设网络天然公平。']
    if kind=='recovery': profile_data['assumptions'] += ['沿原PersonalRecovery LiveSpec；有限故障/内部提交恢复通知弱公平。task来自当前合法领域语义。','原正常15984状态对照保留原R1身份复用；本新配置仅作真正时间性质敏感性检查。']
    ALL.setdefault(kind,{})[profile]=profile_data
    EXPECTED[profile]={'manifest':kind+'-verification.json','status':status,'raw_exit':13 if neg and properties else 12 if neg else 0,
        'invariants':list(invariants),'properties':list(properties),'minimum_distinct_states':minimum,'target':target,'note':note}
def negative(kind,name,params,target,spec='Spec'):
    add(kind,'negative-'+name,params,[target],spec=spec,target=target,minimum=1)

f=dict(ChangedActor='any',Fault='none',Probe='none')
fi=['TypeOK','GrantCurrent','AtomicEffects','ControlFrames','AuthorityUse','QuotaCorrect','CustodyStable',
    'AcquisitionEvidence','ResumptionReadOnly','ReceiptReadOnly','TerminalClosed']
for actor,name in [('C','subject'),('p1','requester-p1'),('p2','requester-p2'),('W','performer'),('any','shared')]:
    add('fence',name,dict(f,ChangedActor=actor),fi,minimum=1000,
        note='两用途/每用途旧新请求/两物；全配置保留一次Restart-Resume-Terminal。'+('任意四actor各变化一次；不是单actor结果的合并。' if actor=='any' else '单actor诊断切面，不冒充多个actor顺序组合。'))
for name,fault,target,actor in [
 ('type','type','TypeOK','any'),('miss-subject','miss-subject','GrantCurrent','C'),
 ('miss-performer','miss-performer','GrantCurrent','W'),('split-appearance','split-appearance','AtomicEffects','W'),
 ('split-private','split-private','AtomicEffects','C'),('overinvalidate','overinvalidate','ControlFrames','W'),
 ('refresh-proof','refresh-proof','ControlFrames','p1'),('stale-use','stale-use','AuthorityUse','p1'),
 ('retake','retake','QuotaCorrect','none'),('first-closes-all','first-closes-all','QuotaCorrect','none'),
 ('reassign','reassign-acquisition','CustodyStable','none'),('control-moves','control-moves-item','CustodyStable','C'),
 ('acquisition-evidence','reassign-acquisition','AcquisitionEvidence','none'),
 ('resume','resume-reactivates','ResumptionReadOnly','any'),('receipt','receipt-reactivates','ReceiptReadOnly','any'),
 ('terminal','terminal-residue','TerminalClosed','none')]:
    negative('fence',name,dict(f,ChangedActor=actor,Fault=fault),target)
for name,probe,actor in [
 ('performer-isolation','selective-preserved','W'),('requester-isolation','selective-preserved','p1'),
 ('restart-dual','restart-dual','any'),('terminal-dual','terminal-dual','any'),
 ('late-old-take','late-old-take','none'),('old-first-rejected','old-first-rejected','any'),
 ('two-actors-after-use','two-actors-after-use','any')]:
    add('fence','witness-'+name,dict(f,ChangedActor=actor,Probe=probe),['NoWitness'],target='NoWitness',minimum=1)

r=dict(ChangedActor='none',Fault='none',Probe='none')
ri=['SnapshotType','ReturnCompleteness','ObserverIsolation','AcquisitionIdentity','CurrentReferences','ReturnTargets','CompleteObservable']
add('returns','constructor',r,ri,spec='SnapshotSpec',minimum=1000,note='同一权威动作生成的最小动态切面；包含双持有人，不声称全世界组合。')
for name,fault,target in [
 ('type','snapshot-type','SnapshotType'),('omit-letter','return-omit-letter','ReturnCompleteness'),
 ('current-only','return-current-only','ReturnCompleteness'),('leak','return-leak','ObserverIsolation'),
 ('wrong-acquisition','return-wrong-acquisition','AcquisitionIdentity'),('old-view','return-old-view','CurrentReferences'),
 ('synthesize-owner','return-synthesize-owner','CurrentReferences'),('wrong-origin','return-wrong-origin','ReturnTargets'),
 ('drop-quota','snapshot-drop-quota','CompleteObservable')]:
    negative('returns',name,dict(r,Fault=fault),target,spec='SnapshotSpec')
for probe in ['mixed-holders','mixed-new-view-null','same-slot-two-items','restored-not-delivered']:
    add('returns','witness-'+probe,dict(r,Probe=probe),['NoReturnWitness'],spec='SnapshotSpec',target='NoReturnWitness',minimum=1)

t=dict(Fault='none',Probe='none')
ti=['TypeOK','ObserverBound','ViewBound','NoRollback','WholeSnapshot','ReceiptReadOnly']
add('transport','complete',t,ti,['EventuallyCurrent'],spec='LiveSpec',minimum=100,note='完整payload参数化equality接口；两observer/两view/三seq，不重放原七个后态。')
for fault,target in [('type','TypeOK'),('wrong-observer','ObserverBound'),('old-view','ViewBound'),('old-seq','NoRollback'),
                     ('partial-payload','WholeSnapshot'),('receipt-overwrite','ReceiptReadOnly')]:
    negative('transport',fault,dict(t,Fault=fault),target)
for fault in ['miss-same-slot','receipt-overwrite']:
    add('transport','negative-live-'+fault,dict(t,Fault=fault),[],['EventuallyCurrent'],spec='LiveSpec',minimum=1)
for probe in ['both-observers-current','late-old-accepted']:
    add('transport','witness-'+probe,dict(t,Probe=probe),['NoTransportWitness'],target='NoTransportWitness',minimum=1)

re=dict(Focus='appearance',MaxIntents=4,FailuresBefore=1,FailuresAfter=1,AllowRestart=True,Fault='consume-all',Probe='none')
add('recovery','negative-both-purposes-progress',re,
    ['TypeOK','SingleUnsettled','OriginalIdentityStable','ReceiptStable','EffectAtMostOnce','CapacitySufficient'],
    ['BothPurposesProgress'],spec='LiveSpec',minimum=1,
    note='真实时间反例；不启用会先截断的PendingPurposesPreserved，原LiveSpec公平性不改。')

modules={'fence':'SharedControlEffects.tla','returns':'ReturnSnapshotCut.tla','transport':'ObserverSnapshotTransport.tla','recovery':'PersonalRecovery.tla'}
for kind,profiles in ALL.items():
    (HERE/(kind+'-verification.json')).write_text(json.dumps({'schema_version':1,'tool':TOOL,'source':SOURCE,
        'model':{'root':'model','entry':modules[kind]},'profiles':profiles},ensure_ascii=False,indent=2)+'\n')
(HERE/'expectations.json').write_text(json.dumps(EXPECTED,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'new_profiles':len(EXPECTED),'positive':sum(x['status']=='PASS_WITHIN_SCOPE' for x in EXPECTED.values()),
                  'expected_counterexamples':sum(x['status']=='COUNTEREXAMPLE' for x in EXPECTED.values())},ensure_ascii=False))
