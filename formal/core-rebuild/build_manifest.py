#!/usr/bin/env python3
"""生成固定核心模型检查清单；仅组织 TLC 输入，不运行产品代码。"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
COMMON = [
    "TypeOK", "AtMostOneEffect", "ReceiptPayloadBinding", "AtomicCommitBundle",
    "AckRequiresCommit", "TerminalBlocksNewEffects",
    "ContinuousCommittedSequence", "PreconditionDiscipline",
]
HANDOFF = ["NoDualControl", "ControlNonceIdempotent", "FreshDecisionOnly", "DecisionSettlesOnce"]
PROFILES = {}
EXPECT = {}

def scope_for(profile, pattern, fault, probe):
    label = fault if fault != "none" else probe
    cases = {
        "payload_overwrite": "payload", "payload-conflict": "payload",
        "published": "publication",
        "partial_ai": "ai-package", "atomic-package-rejected": "ai-package",
        "old_proxy": "ai-epoch", "decision_epoch": "ai-epoch", "epoch-late-ai": "ai-epoch",
        "decision_generation": "ai-generation", "generation-late-ai": "ai-generation",
        "decision_revision": "ai-revision", "revision-late-ai": "ai-revision",
        "decision_deadline": "ai-expiry", "deadline-late-ai": "ai-expiry",
        "decision_status": "ai-cancel",
        "decision-cancelled": "ai-cancel",
        "ai_terminal": "ai-terminal", "terminal-late-ai": "ai-terminal",
        "ai-committed": "ai-expiry", "ai-after-unrelated": "ai-unrelated",
        "no_timeout": "ai-expiry", "decision-expired": "ai-expiry",
        "invalid-ai-rejected": "ai-invalid",
    }
    if label in cases:
        return cases[label]
    if profile == "composed":
        return "combined"
    if profile == "handoff":
        return "control"
    return "receipt" if pattern == "idempotence" else pattern

def add(name, profile="composed", pattern="competition", fault="none", probe="none",
        invariants=None, properties=None, result="PASS_WITHIN_SCOPE", raw=0, minimum=1,
        scenario=None):
    invariants = invariants if invariants is not None else COMMON + ["SingleEffectiveOwner"] + HANDOFF
    properties = properties or []
    scenario = scenario or scope_for(profile, pattern, fault, probe)
    active_keys = 2 if scenario in {"competition", "ending", "future", "combined", "publication"} else 1
    configuration = (
        f'SPECIFICATION {"LiveSpec" if properties else "Spec"}\n'
        f'CONSTANTS Profile = "{profile}" Pattern = "{pattern}" Scenario = "{scenario}" Fault = "{fault}" Probe = "{probe}"\n'
        "CHECK_DEADLOCK TRUE\n"
        + ("INVARIANTS " + " ".join(invariants) + "\n" if invariants else "")
        + ("PROPERTIES " + " ".join(properties) + "\n" if properties else "")
    )
    (ROOT / "model" / f"{name}.cfg").write_text(configuration)
    PROFILES[name] = {
        "config": f"{name}.cfg",
        "timeout_seconds": 360 if name == "live-composed" else 180,
        "workers": 1,
        "heap_mb": 1024,
        "expected_invariants": invariants,
        "expected_properties": properties,
        "checks_deadlock": True,
        "scope": {
            "profile": profile, "pattern": pattern, "scenario": scenario,
            "fault": fault, "probe": probe,
            "actors": 2, "items": 2 if profile == "ownership" else 1,
            "allocated_request_keys": 2, "active_request_keys": active_keys,
            "physical_connections_for_handoff_role": 2,
            "proxy_decisions": 0 if profile == "ownership" or scenario == "control" else 1,
            "session_deadline_ticks": 120, "seconds_per_tick": 10,
            "time_advance": "事件驱动到下个grace/decision/session期限及117/119末段切点",
            "grace_ticks": 3, "decision_timeout_ticks": 1,
            "distinct_state_min": minimum,
            "covered_interleavings_and_faults": [
                "接收、预检、事务提交、ACK、发布各自可交错",
                "receipt/combined场景的一次崩溃、一次丢ACK及未确认请求原样恢复",
                "receipt/payload场景另有一次已确认请求的显式重试",
                "同版本物品竞争、控制围栏、自然/异常/到期终局",
                "故障隔离和可达探针按本配置常量限定",
            ],
            "excluded_behaviors": [
                "任意规模、真实数据库或业务源码的形式证明",
                "任意自然语言、秘密可见性、跨Session及完整fallback（独立#7负责）",
                "多轮无限控制往返、多次新计划与多进程调度",
                "非本scenario的独立刺激；具体分解边界见README覆盖矩阵",
            ],
            "liveness": properties or "NOT_CHECKED",
        },
        "assumptions": [
            "服务端权威；合成参与者身份和有限请求集在初态固定",
            "正确事务一步写入世界、事件、Receipt和outbox；这是实现义务",
            "一逻辑tick为10秒；只推进到期限及末段切点，不调用真实时钟",
        ] + ([
            "有限崩溃和丢ACK后稳定；恢复、接收、预检、提交、ACK、期限处理弱公平",
            "不要求供应商返回；Pending决定依赖公平计时及到期收束",
        ] if properties else []),
    }
    EXPECT[name] = {"status": result, "raw_exit": raw, "invariants": invariants,
                    "properties": properties, "distinct_state_min": minimum}

for pattern in ["competition", "idempotence", "ending", "future"]:
    add("ownership-" + pattern, "ownership", pattern,
        invariants=COMMON + ["SingleEffectiveOwner"], minimum=200)
add("handoff", "handoff", "idempotence", invariants=COMMON + HANDOFF, minimum=500)
add("composed", minimum=500)
for scenario in ["payload", "publication"]:
    add("ownership-" + scenario, "ownership", "idempotence",
        scenario=scenario, invariants=COMMON + ["SingleEffectiveOwner"], minimum=200)
for scenario in ["ai-epoch", "ai-generation", "ai-revision", "ai-unrelated",
                 "ai-cancel", "ai-invalid", "ai-package", "ai-expiry", "ai-terminal"]:
    add("handoff-" + scenario, "handoff", "idempotence",
        scenario=scenario, invariants=COMMON + HANDOFF, minimum=500)
for profile, pattern in [("ownership","idempotence"), ("handoff","idempotence"), ("composed","competition")]:
    add("live-" + profile, profile, pattern, invariants=["TypeOK"],
        properties=["AdmittedRequestResolves"] + ([] if profile == "ownership" else ["DecisionResolvesOrExpires"]),
        minimum=200, scenario="ai-expiry" if profile == "handoff" else None)

NEGATIVES = [
    ("type","TypeOK","ownership","idempotence"),
    ("duplicate_owner","SingleEffectiveOwner","ownership","competition"),
    ("stale_item","SingleEffectiveOwner","ownership","competition"),
    ("split_receipt","AtMostOneEffect","ownership","idempotence"),
    ("payload_overwrite","ReceiptPayloadBinding","ownership","idempotence"),
    ("split_bundle","AtomicCommitBundle","ownership","idempotence"),
    ("split_terminal","AtomicCommitBundle","ownership","ending"),
    ("partial_ai","AtomicCommitBundle","handoff","idempotence"),
    ("early_ack","AckRequiresCommit","ownership","idempotence"),
    ("old_human","NoDualControl","handoff","idempotence"),
    ("stale_disconnect","NoDualControl","handoff","idempotence"),
    ("old_proxy","NoDualControl","handoff","idempotence"),
    ("control_nonce","ControlNonceIdempotent","handoff","idempotence"),
    ("decision_epoch","FreshDecisionOnly","handoff","idempotence"),
    ("decision_generation","FreshDecisionOnly","handoff","idempotence"),
    ("decision_revision","FreshDecisionOnly","handoff","idempotence"),
    ("decision_deadline","FreshDecisionOnly","handoff","idempotence"),
    ("decision_status","FreshDecisionOnly","handoff","idempotence"),
    ("ai_terminal","FreshDecisionOnly","handoff","idempotence"),
    ("post_terminal","TerminalBlocksNewEffects","ownership","idempotence"),
    ("deadline_control","TerminalBlocksNewEffects","handoff","idempotence"),
    ("sequence_gap","ContinuousCommittedSequence","ownership","idempotence"),
    ("sequence_repeat","ContinuousCommittedSequence","ownership","idempotence"),
    ("future_base","PreconditionDiscipline","ownership","future"),
]
for fault, invariant, profile, pattern in NEGATIVES:
    add("negative-" + fault, profile, pattern, fault=fault,
        invariants=[invariant], result="COUNTEREXAMPLE", raw=12)
add("negative-stale-item-precondition", "ownership", "competition", "stale_item",
    invariants=["PreconditionDiscipline"], result="COUNTEREXAMPLE", raw=12)
add("negative-decision-finality", "handoff", "idempotence", "decision_status",
    invariants=["DecisionSettlesOnce"], result="COUNTEREXAMPLE", raw=12)
for fault, profile, prop in [("no_retry","ownership","AdmittedRequestResolves"),
                             ("no_timeout","handoff","DecisionResolvesOrExpires")]:
    add("negative-" + fault, profile, "idempotence", fault,
        invariants=["TypeOK"], properties=[prop], result="COUNTEREXAMPLE", raw=13)
add("negative-deadlock", "ownership", "idempotence", "deadlock",
    invariants=["TypeOK"], result="COUNTEREXAMPLE", raw=11)

WITNESSES = [
    ("take-success","ownership","competition"),
    ("item-conflict","ownership","competition"),
    ("same-receipt","ownership","idempotence"),
    ("payload-conflict","ownership","idempotence"),
    ("crash-before-commit","ownership","idempotence"),
    ("crash-after-commit","ownership","idempotence"),
    ("recovered","ownership","idempotence"),
    ("published","ownership","idempotence"),
    ("manual-ending","ownership","ending"),
    ("deadline-reject","ownership","idempotence"),
    ("future-reject","ownership","future"),
    ("grace","handoff","idempotence"),
    ("proxy","handoff","idempotence"),
    ("returned","handoff","idempotence"),
    ("explicit-take","handoff","idempotence"),
    ("resume-held","handoff","idempotence"),
    ("control-nonce-retry","handoff","idempotence"),
    ("old-disconnect-rejected","handoff","idempotence"),
    ("control-reject","handoff","idempotence"),
    ("ai-committed","handoff","idempotence"),
    ("ai-after-unrelated","handoff","idempotence"),
    ("epoch-late-ai","handoff","idempotence"),
    ("generation-late-ai","handoff","idempotence"),
    ("revision-late-ai","handoff","idempotence"),
    ("deadline-late-ai","handoff","idempotence"),
    ("terminal-late-ai","handoff","idempotence"),
    ("atomic-package-rejected","handoff","idempotence"),
    ("decision-expired","handoff","idempotence"),
    ("invalid-ai-rejected","handoff","idempotence"),
    ("decision-cancelled","handoff","idempotence"),
    ("aborted","ownership","ending"),
    ("effect-crash-handoff-retry","composed","competition"),
]
for probe, profile, pattern in WITNESSES:
    add("witness-" + probe, profile, pattern, probe=probe,
        invariants=["WitnessAbsent"], result="COUNTEREXAMPLE", raw=12)
add("witness-effect-crash-retry-negative", "ownership", "idempotence", "split_receipt",
    "effect-crash-retry-negative", invariants=["WitnessAbsent"],
    result="COUNTEREXAMPLE", raw=12)
add("witness-partial-bundle-crash", "ownership", "idempotence", "split_bundle",
    "partial-bundle-crash", invariants=["WitnessAbsent"],
    result="COUNTEREXAMPLE", raw=12)
add("witness-early-ack-crash", "ownership", "idempotence", "early_ack",
    "early-ack-crash", invariants=["WitnessAbsent"],
    result="COUNTEREXAMPLE", raw=12)

manifest = {
    "schema_version": 1, "feature": "vs001-core-rebuild-20261111",
    "tool": {"version": "v1.7.4 / TLC 2.19",
             "sha256": "936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88"},
    "model": {"root": "model", "entry": "Core.tla"},
    "requirements": {"source": "docs/specs/m0-protocol.md",
        "baseline": "6c2a0b9f6d137ad5fbd41721659404333ad8e16d",
        "ids": ["INV-00","INV-01","INV-02","INV-03","INV-04","INV-05",
                "INV-06","INV-07","INV-08","INV-12","LIVE-01","LIVE-03"]},
    "profiles": PROFILES,
}
(ROOT / "verification.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
(ROOT / "expectations.json").write_text(json.dumps(EXPECT, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"profiles": len(PROFILES), "model": "Core.tla"}))
