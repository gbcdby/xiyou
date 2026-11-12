#!/usr/bin/env python3
"""固定 ADV-001 模型配置及运行前判据；不执行业务代码。"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TOOL = {"version": "v1.7.4 / TLC 2.19", "sha256": "936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88"}
MODELS = {
    "MovementCommands": {
        "invariants": ["TypeOK", "CommandOrder", "StopFence", "ReceiptStable", "EpochFence"],
        "parameters": "1唯一控制源，order配置4命令(甲/乙/停止/新丙)，control/recovery配置3命令；发出/处理/ACK独立；1请求丢失、1ACK丢失、1原样重试、1换控或重启。",
        "negative": {"type":"TypeOK", "late":"CommandOrder", "stop-no-fence":"StopFence", "replay":"ReceiptStable", "epoch":"EpochFence", "reset-water":"CommandOrder"},
        "witness": ["NoOutOfOrderWitness","NoUnknownRetryWitness","NoStopRejectWitness","NoAckRetryWitness","NoNewAfterStopWitness","NoOldEpochRejectedWitness","NoNewEpochAcceptedWitness","NoRestartPreservesReceiptWitness"],
        "covered": ["同epoch较旧命令迟到首次处理", "未知请求原样重试", "停止持久围栏与之后合法新移动", "ACK丢失后的幂等结果", "控制/恢复epoch隔离与Receipt持久"],
    },
    "Movement": {
        "invariants": ["TypeOK", "ArrivalCurrent", "ArrivalPhysical", "PausedTimeStable"],
        "parameters": "1名可控移动者，2次目的地请求，坐标0..2，1次掉线/重连、1次重启，epoch0..3，2个场景时间tick；旧回调可乱序。",
        "negative": {"type":"TypeOK", "stale":"ArrivalCurrent", "teleport":"ArrivalPhysical", "paused-clock":"PausedTimeStable"},
        "witness": ["NoArrivalWitness","NoReplacedArrivalWitness","NoRecoverArrivalWitness"],
        "covered": ["替换/停止/控制交还/重启与迟到到达", "服务端位置到达门槛", "人数不足时剧情时间暂停"],
    },
    "Consent": {
        "invariants": ["TypeOK", "SettlementAuthorized", "SafetyDurable"],
        "parameters": "真实翠兰与悟空2实体，2位带路者，2安置点，2代提议，3种回应身份，最多2个乱序回调。",
        "negative": {"type":"TypeOK", "impersonation":"SettlementAuthorized", "fake":"SettlementAuthorized", "stale":"SettlementAuthorized", "rollback":"SafetyDurable"},
        "witness": ["NoSafeWitness","NoReplanSafeWitness","NoWithdrawSafeWitness"],
        "covered": ["真实本人接受", "同外貌实体不能替代安置", "撤回/改约与旧到达", "已安置事实不回滚"],
    },
    "Resources": {
        "invariants": ["TypeOK", "SingleOwner", "EffectOnce", "PreparedDurable", "CooperationAuthorized", "ReclaimAuthorized"],
        "parameters": "2位玩家，1公共或私人物，1领回请求，1重放，1掉线/托管/重连，1恢复，2人合作准备。",
        "negative": {"type":"TypeOK", "duplicate-owner":"SingleOwner", "repeat-effect":"EffectOnce", "unlock":"PreparedDurable", "premature":"CooperationAuthorized", "reclaim":"ReclaimAuthorized"},
        "witness": ["NoReclaimWitness","NoLockedRecoveryWitness","NoReclaimReconnectWitness"],
        "covered": ["唯一归属", "同操作重放无第二效果", "合作就位与锁定持久", "离线公共物领回/重连竞争", "私人和远距/宽限内拒绝"],
    },
    "Identity": {
        "invariants": ["TypeOK", "NoIdentityLeak", "EventAudienceFixed", "HistoryAsObserved", "ReferenceTargetStable"],
        "parameters": "2观察者，真实悟空/翠兰2实体，1次变身/获知/视图重建，1事件，8类输出出口，1次引用操作。",
        "negative": {"type":"TypeOK", "raw-id":"NoIdentityLeak", "true-name":"NoIdentityLeak", "late-audience":"EventAudienceFixed", "rewrite-history":"HistoryAsObserved", "by-name":"ReferenceTargetStable", "stale-ref":"ReferenceTargetStable"},
        "witness": ["NoDisguisedHistoryWitness","NoLateReplayWitness","NoRefTransferWitness"],
        "covered": ["按观察者各出口隐藏真身", "发生时受众", "历史按当时视角保留", "同名不重定向及过期引用拒绝"],
    },
    "Scheduler": {
        "invariants": ["TypeOK", "BudgetRespected"],
        "parameters": "唐僧/悟空/八戒3名持续合资格自主角色，预算1及2，1有限待办集合，Settle分别记录ok/timeout/invalid结果。",
        "negative": {"type":"TypeOK", "overbook":"BudgetRespected"},
        "witness": ["NoAllServedWitness"],
        "covered": ["预算上限", "在声明公平性下有限待办不饿死第三角色"],
    },
}
expectations = []
for name, data in MODELS.items():
    profiles = {}
    def add(profile, fault="none", invariants=None, properties=None, constants=None, expect="PASS_WITHIN_SCOPE", lower=1, raw=0, classification=None):
        inv = data["invariants"] if invariants is None else invariants
        props = [] if properties is None else properties
        consts = {"Fault":json.dumps(fault)}
        if name == "Resources": consts["Public"] = "TRUE"
        if name == "Scheduler": consts["Budget"] = "1"
        if name == "MovementCommands": consts.update({"Scenario":"\"order\"","MaxCommands":"4"})
        consts.update(constants or {})
        cfg = f"{name}.{profile}.cfg"
        text = "SPECIFICATION Spec\nCONSTANTS\n" + "".join(f"  {key} = {value}\n" for key,value in consts.items())
        if inv: text += "INVARIANTS\n" + "".join(f"  {item}\n" for item in inv)
        if props: text += "PROPERTIES\n" + "".join(f"  {item}\n" for item in props)
        text += "CHECK_DEADLOCK TRUE\n"
        (ROOT/"model"/cfg).write_text(text)
        profiles[profile] = {
            "config":cfg, "timeout_seconds":90, "workers":1, "heap_mb":512,
            "expected_invariants":inv, "expected_properties":props, "checks_deadlock":True,
            "scope":{"parameters":data["parameters"],"covered_interleavings_and_faults":data["covered"],
                     "excluded_behaviors":["真实数据库/网络/解析/几何/自然语言/完整章节", "任意规模及无限次故障", "所有子模型的完整组合"],
                     "liveness":"有限待办公平调度" if props else "NOT_CHECKED"},
            "assumptions":["单Session原子权威提交；已提交状态可靠保留；有限模型不是实现证明。"] +
                          (["全部三角色持续合资格；Dispatch及每角色Settle弱公平，处理或超时最终释放槽。"] if name=="Scheduler" else []),
        }
        expectations.append({"model":name,"profile":profile,"expected_status":expect,"expected_raw_exit":raw,
                             "distinct_state_min":lower,"target_invariants":inv,"target_properties":props,
                             "classification":classification or ("positive" if expect=="PASS_WITHIN_SCOPE" else "witness" if profile.startswith("witness") else "negative")})
    if name=="MovementCommands":
        add("positive",lower=100)
        add("positive-control",constants={"Scenario":"\"control\"","MaxCommands":"3"},lower=100)
        add("positive-recovery",constants={"Scenario":"\"recovery\"","MaxCommands":"3"},lower=100)
    elif name=="Scheduler":
        add("positive-1",properties=["NoStarvation"],lower=30)
        add("positive-2",properties=["NoStarvation"],constants={"Budget":"2"},lower=30)
    else:
        add("positive",lower=100)
        if name=="Resources": add("positive-private",constants={"Public":"FALSE"},lower=100)
    for fault, invariant in data["negative"].items():
        constants = {}
        if name=="MovementCommands" and fault in {"epoch","reset-water"}:
            constants={"Scenario":"\"control\"" if fault=="epoch" else "\"recovery\"","MaxCommands":"3"}
        add("negative-"+fault,fault=fault,invariants=[invariant],constants=constants,expect="COUNTEREXAMPLE",raw=12)
    if name=="Resources": add("negative-private-reclaim",fault="reclaim",invariants=["ReclaimAuthorized"],constants={"Public":"FALSE"},expect="COUNTEREXAMPLE",raw=12)
    if name=="Scheduler": add("negative-starve",fault="starve",invariants=[],properties=["NoStarvation"],expect="COUNTEREXAMPLE",raw=13)
    for witness in data["witness"]:
        constants = {}
        if name=="MovementCommands" and witness in {"NoOldEpochRejectedWitness","NoNewEpochAcceptedWitness","NoRestartPreservesReceiptWitness"}:
            constants={"Scenario":"\"recovery\"" if witness=="NoRestartPreservesReceiptWitness" else "\"control\"","MaxCommands":"3"}
        add("witness-"+witness,invariants=[witness],constants=constants,expect="COUNTEREXAMPLE",raw=12)
    if name=="Consent":
        add("witness-control-block-replan",fault="block-replan",invariants=["NoReplanSafeWitness"],lower=100,classification="witness-control")
    if name=="MovementCommands":
        for fault, witness, constants in [
                ("block-ack-retry", "NoAckRetryWitness", {}),
                ("block-new-after-stop", "NoNewAfterStopWitness", {}),
                ("block-old-epoch-handle", "NoOldEpochRejectedWitness", {"Scenario":"\"control\"", "MaxCommands":"3"})]:
            add("witness-control-"+fault, fault=fault, invariants=[witness], constants=constants,
                lower=100, classification="witness-control")
    manifest = {"schema_version":1,"feature":"ADV-001 "+name,"tool":TOOL,
                "model":{"root":"model","entry":name+".tla"},"profiles":profiles}
    (ROOT/(name.lower()+".json")).write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n")
(ROOT/"expectations.json").write_text(json.dumps(expectations,ensure_ascii=False,indent=2)+"\n")
print(f"已生成{len(MODELS)}个清单、{len(expectations)}项运行前判据。")
