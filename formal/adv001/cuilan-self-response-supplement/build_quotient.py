#!/usr/bin/env python3
"""由固定共享模型构造签名相等商；原模型与历史结果不修改。"""
from pathlib import Path
import argparse
import hashlib
import json

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "model" / "SharedControlEffects.tla"
TARGET = ROOT / "model" / "SharedControlQuotient.tla"
SOURCE_SHA = "151baf3544b2401bc0fdb2f0ce3fdf8e0feb449024227f2b35dee6e7bd3c7108"


def build():
    original = SOURCE.read_bytes()
    if hashlib.sha256(original).hexdigest() != SOURCE_SHA:
        raise SystemExit("共享源模型已变化，须重新审查投影义务。")
    text = original.decode()
    changes = []

    def replace(label, before, after, count=1):
        nonlocal text
        found = text.count(before)
        if found != count:
            raise SystemExit(f"{label} 匹配数错误：{found}，期望 {count}")
        text = text.replace(before, after)
        changes.append({"obligation": label, "matches": found,
                        "before": before, "after": after})

    replace("模块身份", "MODULE SharedControlEffects", "MODULE SharedControlQuotient")
    replace("说明",
            "(* CS-R2补证：两用途与逐物世界保留；控制依赖按每份不可变proof捕获。",
            "(* #62签名商：binding/proof分别为原签名是否等于当前Signature的投影位。\n"
            "   原签名字节没有被修改；投影位随epoch/generation变化不表示改写原proof。\n"
            "   正常语义映射只对Fault=none成立；故障配置是该商模型的敏感性检查。\n"
            "   四actor、旧新请求、两用途、两物、全部原共享动作及原身份仍保留。\n"
            "   原模型sha256: " + SOURCE_SHA + "\n"
            "   CS-R2补证：两用途与逐物世界保留；控制依赖按每份不可变proof捕获。")
    replace("当前匹配", "proof[q]=Signature(q)", "proof[q]")
    replace("初态proposal",
            r"binding=[q \in Requests|->IF q[2]=1 THEN Signature(q) ELSE EmptySignature]",
            r"binding=[q \in Requests|->q[2]=1]")
    replace("初态proof",
            r"proof=[q \in Requests|->EmptySignature]",
            r"proof=[q \in Requests|->FALSE]")
    replace("Accept守卫", "binding[q]=Signature(q)", "binding[q]")
    replace("NewRequest捕获", "![<<p,2>>]=Signature(<<p,2>>)", "![<<p,2>>]=TRUE")
    replace("ActorChange签名投影",
            r'''np==IF Fault="refresh-proof" THEN [q \in Requests|->IF q \in affected /\ stage[q]="accepted"
                  THEN [proof[q] EXCEPT !.epochs[a]=2] ELSE proof[q]] ELSE proof''',
            r'''np==[q \in Requests|->IF a \notin Dependencies(q) THEN proof[q]
               ELSE IF Fault="refresh-proof" /\ stage[q]="accepted" THEN proof[q] ELSE FALSE]''')
    replace("ActorChange binding反映新环境",
            r"/\ epochs'=[epochs EXCEPT ![a]=2]",
            r"""/\ epochs'=[epochs EXCEPT ![a]=2]
       /\ binding'=[q \in Requests|->IF a \in Dependencies(q) THEN FALSE ELSE binding[q]]""")
    replace("禁止原proof改写与投影位变化分离",
            r"!.proofChanged=@ \/ np#proof,!.controlMoved=@ \/ nh#holder,",
            r'''!.proofChanged=@ \/ (Fault="refresh-proof" /\
                    (\E q \in affected:stage[q]="accepted")),!.controlMoved=@ \/ nh#holder,''')
    replace("ActorChange frame",
            r"UNCHANGED <<binding,slot,acquired,originalAcquired,taken,completed,used,generation,phase,restarted>>",
            r"UNCHANGED <<slot,acquired,originalAcquired,taken,completed,used,generation,phase,restarted>>")
    replace("Restart匹配位失效",
            r"""/\ generation'=2 /\ restarted'=TRUE /\ phase'="paused"
 /\ grants'={}""",
            r"""/\ generation'=2 /\ restarted'=TRUE /\ phase'="paused"
 /\ binding'=[q \in Requests|->FALSE] /\ proof'=[q \in Requests|->FALSE]
 /\ grants'={}""")
    replace("Restart frame",
            r"UNCHANGED <<binding,proof,slot,holder,acquired,originalAcquired,taken,completed,used,epochs>>",
            r"UNCHANGED <<slot,holder,acquired,originalAcquired,taken,completed,used,epochs>>")
    replace("投影变量类型",
            r"TypeOK == holder \in",
            r"TypeOK == binding \in [Requests->BOOLEAN] /\ proof \in [Requests->BOOLEAN] /\ holder \in")
    replace("完整Source输入域闭包",
            'NoWitness == IF Probe="two-actors-after-use" THEN',
            r'''(* 为纯返还构造域提供完整源类型/取得依据；不是把性质当搜索约束。 *)
SourceInputClosed ==
 /\ stage \in [Requests->{"absent","proposed","accepted","closed"}]
 /\ slot \in [Purposes->1..2]
 /\ holder \in [Items->{"origin","owner","p1","p2"}]
 /\ acquired \in [Items->({"private_items"} \X (1..2)) \cup {None}]
 /\ taken \in [Requests->SUBSET Items] /\ completed \in [Requests->SUBSET Items]
 /\ (\A q \in Requests:q[1]="appearance" => (taken[q]={} /\ completed[q]={}))
 /\ GrantCurrent /\ AcquisitionEvidence
NoWitness == IF Probe="two-actors-after-use" THEN''')
    return text.encode(), changes


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--audit", type=Path)
    args = parser.parse_args()
    content, changes = build()
    if args.check:
        if not TARGET.exists() or TARGET.read_bytes() != content:
            raise SystemExit("签名商与固定生成规则不一致。")
    else:
        TARGET.write_bytes(content)
    if args.audit:
        args.audit.parent.mkdir(parents=True, exist_ok=True)
        args.audit.write_text(json.dumps({
            "source": str(SOURCE.relative_to(ROOT)),
            "source_sha256": SOURCE_SHA,
            "target": str(TARGET.relative_to(ROOT)),
            "target_sha256": hashlib.sha256(content).hexdigest(),
            "changed_fragments": changes,
            "unchanged_text": "所有未列片段逐字保留；不是TLA语义精化证明。",
            "mapping_scope": "正常Fault=none；有限单调epoch/generation，无ABA。",
        }, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"status": "MATCHED" if args.check else "GENERATED",
                      "changes": len(changes),
                      "target_sha256": hashlib.sha256(content).hexdigest()},
                     ensure_ascii=False))


if __name__ == "__main__":
    main()
