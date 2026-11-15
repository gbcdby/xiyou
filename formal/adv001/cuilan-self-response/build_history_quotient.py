#!/usr/bin/env python3
"""#62 固定历史标签商：不删除完整缓存、归还守卫或活性公平性。"""
from pathlib import Path
import argparse
import hashlib
import json

ROOT = Path(__file__).resolve().parent
MODEL = ROOT / "model"
SOURCES = {
    "PersonalEffects.tla": "4c20bde2577d87e539caddd60eaa58ac4fc9b6b27cd04f7c142a6afe31b94602",
    "AuthorityEffects.tla": "96fb85b6509524cab9b28cacf4aca41ca0ae1996f53aa0da0ab246017cb54dfc",
}


def build():
    data = {}
    for name, expected in SOURCES.items():
        raw = (MODEL / name).read_bytes()
        if hashlib.sha256(raw).hexdigest() != expected:
            raise SystemExit(f"{name} 已变化，须重新审查所有消费者。")
        data[name] = raw.decode()
    text = data["PersonalEffects.tla"]
    changes = []

    def replace(label, before, after, count=1):
        nonlocal text
        found = text.count(before)
        if found != count:
            raise SystemExit(f"{label} 匹配数 {found}，期望 {count}")
        text = text.replace(before, after)
        changes.append({"obligation": label, "matches": found,
                        "before": before, "after": after})

    replace("模块身份", "MODULE PersonalEffects", "MODULE PersonalEffectsHistoryQuotient")
    replace("适用域",
            "CONSTANTS UsePurpose, ProjectionMode, Fault, Probe, EnableEnvironment",
            "CONSTANTS UsePurpose, ProjectionMode, Fault, Probe, EnableEnvironment\n"
            "(* #62：仅规范化r.reason、四个仅供Probe的e位及ui.receiptSeen。\n"
            "   完整ui.observed/ui.confirmed、Observable、NormalReturn守卫、旧新身份与公平性原样保留。\n"
            "   不适用于Probe见证配置；原见证字节/结果仍保留。 *)\n"
            'ASSUME Probe="none"')
    replace("停用原因只写标签", r"!.reason=kind]", r'!.reason="none"]')
    replace("返还原因标签映射",
            r'!.reason=IF r[x].grant \/ Fault="return-rewrites-history" THEN "fulfilled" ELSE @]',
            r'!.reason="none"]')
    replace("停止见证位", r"!.stoppedActive=@ \/ disguise=q,", r"!.stoppedActive=FALSE,")
    replace("旧请求归还见证位",
            r'!.returnedClosed=@ \/ (target="owner" /\ ~r[q].grant),',
            r"!.returnedClosed=FALSE,")
    replace("放回见证位", r'!.restored=@ \/ target="origin",', r"!.restored=FALSE,")
    replace("收据历史展示位", r"!.receiptSeen=TRUE,", r"!.receiptSeen=FALSE,")
    replace("晚到见证位",
            r"!.lateOld=@ \/ (q[2]=1 /\ slot[q[1]]=2 /\ ui.observed.slot[q[1]]=2 /\ ~r[q].grant)]",
            r"!.lateOld=FALSE]")
    authority = data["AuthorityEffects.tla"]
    authority = authority.replace("MODULE AuthorityEffects", "MODULE AuthorityEffectsHistoryQuotient", 1)
    authority = authority.replace("EXTENDS PersonalEffects", "EXTENDS PersonalEffectsHistoryQuotient", 1)
    outputs = {
        "PersonalEffectsHistoryQuotient.tla": text.encode(),
        "AuthorityEffectsHistoryQuotient.tla": authority.encode(),
    }
    life = text.replace("MODULE PersonalEffectsHistoryQuotient",
                        "MODULE PersonalEffectsLifeQuotient", 1)
    life_changes = [
        ('life|->IF q[2]=1 THEN "open" ELSE "absent"',
         'life|->IF q[2]=1 THEN "open" ELSE "closed"'),
        ('ELSE IF kind="cancelled" THEN "cancelled" ELSE "closed",',
         'ELSE "closed",'),
        ('![<<p,1>>].life="superseded",', '![<<p,1>>].life="closed",'),
    ]
    for before, after in life_changes:
        if life.count(before) != 1:
            raise SystemExit("life投影匹配数不为1，须重核其消费者。")
        life = life.replace(before, after)
        changes.append({"obligation": "life非open标签投影",
                        "target_model": "PersonalEffectsLifeQuotient.tla",
                        "before": before, "after": after, "matches": 1})
    outputs["PersonalEffectsLifeQuotient.tla"] = life.encode()
    return outputs, changes


def profiles():
    """原配置的规格、性质和常量逐字复用；新清单保留旧清单来源。"""
    for family, entry, names in [
        ("effects", "PersonalEffectsHistoryQuotient.tla", [
            "effects-private", "effects-restart-private", "effects-both", "effects-cooperative-return",
            "effects-negative-ui-receipt-overwrite", "effects-negative-stale-return-view",
            "effects-negative-history-trims-return", "effects-negative-first-item-closes-all",
        ]),
        ("authority", "AuthorityEffectsHistoryQuotient.tla", ["authority-both"]),
    ]:
        old = json.loads((ROOT / f"{family}-verification.json").read_text())
        new = {k: v for k, v in old.items() if k not in ["profiles", "model", "source"]}
        new["source"] = {
            "commit": "3a3001325553b5116db65234190fd681bac7eaf4",
            "ticket": "https://github.com/gbcdby/xiyou/issues/62",
            "mode": "check/design", "implementation_status": "NOT_ASSESSED",
        }
        new["model"] = {"root": "model", "entry": entry}
        new["profiles"] = {}
        for name in names:
            profile = json.loads(json.dumps(old["profiles"][name]))
            target = "closure-" + name
            (MODEL / f"{target}.cfg").write_bytes((MODEL / profile["config"]).read_bytes())
            profile["config"] = target + ".cfg"
            profile["heap_mb"] = 1024
            profile["timeout_seconds"] = 300 if "negative" not in name else 60
            profile["scope"]["note"] = (
                "新历史标签商；原配置规格/常量/性质逐字不变，完整缓存及归还守卫仍在。"
                "原旧运行保持原身份。"
            )
            profile["scope"]["erased"] = ["r.reason", "e.returnedClosed", "e.restored",
                                         "e.lateOld", "e.stoppedActive", "ui.receiptSeen"]
            profile["scope"]["transfer_requires"] = "Probe=none；PROOF_CLOSURE中的逐动作商关系/启用性/公平性保持。"
            new["profiles"][target] = profile
        (ROOT / f"closure-{family}-verification.json").write_text(
            json.dumps(new, ensure_ascii=False, indent=2) + "\n")
    source = json.loads((ROOT / "closure-effects-verification.json").read_text())
    source["model"]["entry"] = "PersonalEffectsLifeQuotient.tla"
    source["profiles"] = {
        key.replace("closure-", "closure-life-", 1): value
        for key, value in source["profiles"].items()
        if key in {"closure-effects-both", "closure-effects-restart-private"}
    }
    for name, profile in source["profiles"].items():
        original_cfg = MODEL / profile["config"]
        profile["config"] = name + ".cfg"
        (MODEL / profile["config"]).write_bytes(original_cfg.read_bytes())
        profile["scope"]["erased"].append("r.life中所有非open标签合为closed")
        profile["scope"]["transfer_requires"] += " life的全部读谓词仅与open比较；其他状态/完整缓存保留。"
    template = next(iter(source["profiles"].values()))
    original_effects = json.loads((ROOT / "effects-verification.json").read_text())
    for name in ["effects-negative-old-capability", "effects-negative-return-rewrites-history"]:
        profile = json.loads(json.dumps(original_effects["profiles"][name]))
        target = "closure-life-" + name
        (MODEL / f"{target}.cfg").write_bytes((MODEL / profile["config"]).read_bytes())
        profile.update(config=target + ".cfg", heap_mb=1024, timeout_seconds=60)
        profile["scope"]["erased"] = list(template["scope"]["erased"])
        profile["scope"]["transfer_requires"] = template["scope"]["transfer_requires"]
        profile["scope"]["note"] = "life标签商定向负控；旧capability防线和未擦除的闭合原因违规监视器。"
        source["profiles"][target] = profile
    (ROOT / "closure-life-verification.json").write_text(
        json.dumps(source, ensure_ascii=False, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--audit", type=Path)
    args = parser.parse_args()
    outputs, changes = build()
    for name, content in outputs.items():
        path = MODEL / name
        if args.check:
            if not path.exists() or path.read_bytes() != content:
                raise SystemExit(f"{name} 与固定生成规则不一致。")
        else:
            path.write_bytes(content)
    if not args.check:
        profiles()
    result = {
        "sources": SOURCES,
        "outputs": {name: hashlib.sha256(data).hexdigest() for name, data in outputs.items()},
        "changed_fragments": changes,
        "scope": "Probe=none；全部未列片段逐字保持，规格/常量/性质原样复用。",
        "not_claimed": "语法再生成不独自构成语义精化证明；见逐动作保持论证与独审。",
    }
    if args.audit:
        args.audit.parent.mkdir(parents=True, exist_ok=True)
        args.audit.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"status": "MATCHED" if args.check else "GENERATED",
                      "outputs": result["outputs"], "changes": len(changes)},
                     ensure_ascii=False))


if __name__ == "__main__":
    main()
