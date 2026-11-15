#!/usr/bin/env python3
"""仅生成 #62 新形式输入；不会覆盖旧 profile 或旧运行。"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MODEL = ROOT / "model"
TOOL = {"version": "v1.7.4 / TLC 2.19",
        "sha256": "936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88"}
SOURCE = {"commit": "3a3001325553b5116db65234190fd681bac7eaf4",
          "mode": "check/design", "ticket": "https://github.com/gbcdby/xiyou/issues/62",
          "implementation_status": "NOT_ASSESSED"}
SHARED = ["TypeOK", "GrantCurrent", "AtomicEffects", "ControlFrames", "AuthorityUse",
          "QuotaCorrect", "CustodyStable", "AcquisitionEvidence", "ResumptionReadOnly",
          "ReceiptReadOnly", "TerminalClosed", "SourceInputClosed"]
SIGNATURE = ["CaptureMatches", "EmptyStale", "ActorProjection", "RestartProjection",
             "CaptureInDomain", "ActorDomainClosed", "RestartDomainClosed"]


def manifest(entry, definitions, output, note):
    profiles = {}
    for name, fault, invariants, timeout, minimum in definitions:
        constants = {"Fault": fault}
        if entry == "SharedControlQuotient.tla":
            constants.update({"ChangedActor": "any", "Probe": "none"})
        cfg = "SPECIFICATION Spec\nCONSTANTS\n"
        cfg += "".join(f'  {key} = "{value}"\n' for key, value in constants.items())
        cfg += "INVARIANTS\n" + "".join(f"  {name}\n" for name in invariants)
        (MODEL / f"{name}.cfg").write_text(cfg)
        profiles[name] = {
            "config": f"{name}.cfg", "timeout_seconds": timeout,
            "workers": 1, "heap_mb": 1024,
            "expected_invariants": invariants, "expected_properties": [],
            "checks_deadlock": True,
            "scope": {
                "parameters": constants, "minimum_distinct_states": minimum,
                "note": note,
                "excluded": ["无界版本/ABA", "生产源码精化", "完整网络/客户端组合", "真人与真实模型评价"],
            },
            "assumptions": [
                "固定有限2用途/每用途2请求/2物/4个独立actor；新profile不重写旧结果。",
                "TLC普通BFS；无CONSTRAINT、VIEW、对称归约、模拟或Java覆盖。",
                "独立的原子世界动作合同保持；模型不证明真实SQL事务。"
            ],
        }
    (ROOT / output).write_text(json.dumps({
        "schema_version": 1, "tool": TOOL, "source": SOURCE,
        "model": {"root": "model", "entry": entry},
        "profiles": profiles,
    }, ensure_ascii=False, indent=2) + "\n")


manifest("SignatureProjectionLemmas.tla", [
    ("closure-signature-domain", "none", SIGNATURE, 120, 100),
    ("closure-signature-negative-actor", "skip-actor", ["ActorProjection"], 60, 1),
    ("closure-signature-negative-restart", "skip-restart", ["RestartProjection"], 60, 1),
], "closure-signature-verification.json",
         "对全部逐坐标不来自未来的有限签名直接检查捕获、失效与域闭包；不是业务可达图。")
manifest("SignatureProjectionSensitivity.tla", [
    ("closure-signature-sensitivity-domain", "none", SIGNATURE, 120, 100),
    ("closure-signature-negative-capture-match", "capture-stale-generation", ["CaptureMatches"], 60, 1),
    ("closure-signature-negative-empty", "empty-is-current", ["EmptyStale"], 60, 1),
    ("closure-signature-negative-capture-domain", "capture-future-epoch", ["CaptureInDomain"], 60, 1),
    ("closure-signature-negative-actor-domain", "actor-epoch-rollback", ["ActorDomainClosed"], 60, 1),
    ("closure-signature-negative-restart-domain", "restart-generation-rollback", ["RestartDomainClosed"], 60, 1),
], "closure-sensitivity-verification.json",
         "STD-001独立敏感性副本；none展开为固定原引理，具体错误构造不改变断言方向，原模型和旧运行保留。")
manifest("SharedControlQuotient.tla", [
    ("closure-shared-quotient", "none", SHARED, 300, 1000),
    ("closure-shared-negative-subject", "miss-subject", ["GrantCurrent"], 60, 1),
    ("closure-shared-negative-performer", "miss-performer", ["GrantCurrent"], 60, 1),
    ("closure-shared-negative-refresh-proof", "refresh-proof", ["ControlFrames"], 60, 1),
    ("closure-shared-negative-overinvalidate", "overinvalidate", ["ControlFrames"], 60, 1),
    ("closure-shared-negative-split-appearance", "split-appearance", ["AtomicEffects"], 60, 1),
    ("closure-shared-negative-split-private", "split-private", ["AtomicEffects"], 60, 1),
    ("closure-shared-negative-custody", "reassign-acquisition", ["CustodyStable"], 60, 1),
    ("closure-shared-negative-source-domain", "reassign-acquisition", ["SourceInputClosed"], 60, 1),
    ("closure-shared-negative-quota", "first-closes-all", ["QuotaCorrect"], 60, 1),
    ("closure-shared-negative-receipt", "receipt-reactivates", ["ReceiptReadOnly"], 60, 1),
], "closure-shared-verification.json",
         "签名相等商；所有四actor可依任意顺序各变化一次，共享Restart/Resume/Terminal，旧新身份和两物保持。")

RETURNS = ["SnapshotType", "ReturnCompleteness", "ObserverIsolation", "AcquisitionIdentity",
           "CurrentReferences", "ReturnTargets", "CompleteObservable"]
return_profiles = {}
for name, part, fault, invariants, minimum in [
    ("closure-return-rows", "rows", "none", RETURNS, 1000),
    ("closure-return-requests", "requests", "none", RETURNS, 1000),
    ("closure-return-negative-current-only", "rows", "return-current-only", ["ReturnCompleteness"], 1),
    ("closure-return-negative-omit-item", "rows", "return-omit-letter", ["ReturnCompleteness"], 1),
    ("closure-return-negative-observer", "rows", "return-leak", ["ObserverIsolation"], 1),
    ("closure-return-negative-acquisition", "rows", "return-wrong-acquisition", ["AcquisitionIdentity"], 1),
    ("closure-return-negative-view", "rows", "return-old-view", ["CurrentReferences"], 1),
    ("closure-return-negative-null", "rows", "return-synthesize-owner", ["CurrentReferences"], 1),
    ("closure-return-negative-origin", "rows", "return-wrong-origin", ["ReturnTargets"], 1),
    ("closure-return-negative-quota", "requests", "snapshot-drop-quota", ["CompleteObservable"], 1),
    ("closure-return-negative-type", "rows", "snapshot-type", ["SnapshotType"], 1),
]:
    cfg = f'SPECIFICATION Spec\nCONSTANTS\n  DomainPart = "{part}"\n  Fault = "{fault}"\nINVARIANTS\n'
    cfg += "".join(f"  {inv}\n" for inv in invariants)
    (MODEL / f"{name}.cfg").write_text(cfg)
    return_profiles[name] = {
        "config": f"{name}.cfg", "timeout_seconds": 120,
        "workers": 1, "heap_mb": 1024,
        "expected_invariants": invariants, "expected_properties": [],
        "checks_deadlock": True,
        "scope": {"parameters": {"DomainPart": part, "Fault": fault},
                  "minimum_distinct_states": minimum,
                  "note": "纯函数输入的字段依赖分解；与源模型域闭包及逐字段合成论证分别交付。",
                  "excluded": ["全部世界历史笛卡尔积", "动态网络传输组合", "生产DTO精化"]},
        "assumptions": [
            "两物/两观察者/每用途旧新请求；rows含两view、每物两revision和nullable owner。",
            "requests按任一用途的两请求状态及任意taken/completed值枚举；另一用途的对应由字段独立性论证。",
            "普通BFS、无CONSTRAINT/VIEW/对称归约；合法输入点为纯函数检查终态，无业务活性声明。"
        ],
    }
(ROOT / "closure-returns-verification.json").write_text(json.dumps({
    "schema_version": 1, "tool": TOOL, "source": SOURCE,
    "model": {"root": "model", "entry": "ReturnInputDomain.tla"},
    "profiles": return_profiles,
}, ensure_ascii=False, indent=2) + "\n")
