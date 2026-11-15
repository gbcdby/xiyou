#!/usr/bin/env python3
"""STD-001：生成独立故障副本；原签名引理和全部旧运行字节保持。"""
from pathlib import Path
import argparse
import hashlib
import json

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'model/SignatureProjectionLemmas.tla'
TARGET = ROOT / 'model/SignatureProjectionSensitivity.tla'
SOURCE_SHA = '28197b9588bcea3a4b514c764749ca520ecfb69d35f1748f6c3cbd05e71dcd44'


def build():
    raw = SOURCE.read_bytes()
    if hashlib.sha256(raw).hexdigest() != SOURCE_SHA:
        raise SystemExit('签名引理源已变化，须重审副本与原性质的关系。')
    text = raw.decode()
    changes = []

    def replace(label, before, after, count=1):
        nonlocal text
        if text.count(before) != count:
            raise SystemExit(f'{label} 匹配数不符，拒绝生成。')
        text = text.replace(before, after)
        changes.append({'obligation': label, 'before': before, 'after': after, 'matches': count})

    replace('模块身份', 'MODULE SignatureProjectionLemmas', 'MODULE SignatureProjectionSensitivity')
    replace('故障副本说明', 'CONSTANT Fault', '''(* R-ISSUE62-STD-001 独立故障副本：原输入域、断言方向和两个旧故障分支不变。
   Fault=none 时以下构造函数展开为固定原模块表达式；错误仅修改被检查的输入构造，
   不把断言反置或改为FALSE。原SignatureProjectionLemmas及旧证据不修改。 *)
CONSTANT Fault''')
    replace('区分被测捕获与参考当前签名',
            '''Sig(q,g,es) == [generation|->g,
               epochs|->[a \\in Actors|->IF a \\in Dependencies(q) THEN es[a] ELSE 0]]
Matches(s,q,g,es) == s=Sig(q,g,es)''',
            '''ReferenceSig(q,g,es) == [generation|->g,
               epochs|->[a \\in Actors|->IF a \\in Dependencies(q) THEN es[a] ELSE 0]]
(* 捕获时读错旧代号，或把尚未发生的C控制版本提前写进proof。 *)
Sig(q,g,es) ==
 IF Fault="capture-stale-generation" THEN ReferenceSig(q,g-1,es)
 ELSE IF Fault="capture-future-epoch" THEN
      [ReferenceSig(q,g,es) EXCEPT !.epochs["C"]=es["C"]+1]
 ELSE ReferenceSig(q,g,es)
(* 未建立proof却错误填入当前签名，会把空值当成可用的证明。 *)
EmptySignature(q,g,es) ==
 IF Fault="empty-is-current" THEN ReferenceSig(q,g,es)
 ELSE [generation|->0,epochs|->[a \\in Actors|->0]]
(* 控制/恢复错误地重置计数器；旧捕获值遂来自新环境的未来。 *)
AdvanceEpoch(es,a) == [es EXCEPT ![a]=IF Fault="actor-epoch-rollback" THEN 0 ELSE 2]
RestartGeneration(g) == IF Fault="restart-generation-rollback" THEN 0 ELSE 2
Matches(s,q,g,es) == s=ReferenceSig(q,g,es)''')
    replace('空签名构造注入',
            '[generation|->0,epochs|->[a \\in Actors|->0]],\n                      request,currentGeneration,currentEpochs)',
            'EmptySignature(request,currentGeneration,currentEpochs),\n                      request,currentGeneration,currentEpochs)')
    replace('ActorProjection使用实际步进输出',
            'LET after==[currentEpochs EXCEPT ![a]=2]',
            'LET after==AdvanceEpoch(currentEpochs,a)')
    replace('RestartProjection使用实际恢复输出',
            'Matches(stored,request,2,currentEpochs)=',
            'Matches(stored,request,RestartGeneration(currentGeneration),currentEpochs)=')
    replace('ActorDomainClosed使用实际步进输出',
            'NoFuture(stored,request,currentGeneration,[currentEpochs EXCEPT ![a]=2])',
            'NoFuture(stored,request,currentGeneration,AdvanceEpoch(currentEpochs,a))')
    replace('RestartDomainClosed使用实际恢复输出',
            'NoFuture(stored,request,2,currentEpochs)',
            'NoFuture(stored,request,RestartGeneration(currentGeneration),currentEpochs)')
    return text.encode(), changes


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--audit', type=Path)
    args = parser.parse_args()
    raw, changes = build()
    if args.check:
        if not TARGET.exists() or TARGET.read_bytes() != raw:
            raise SystemExit('签名故障副本与固定生成规则不同。')
    else:
        TARGET.write_bytes(raw)
    result = {
        'finding': 'R-ISSUE62-STD-001', 'source_sha256': SOURCE_SHA,
        'target_sha256': hashlib.sha256(raw).hexdigest(), 'changed_fragments': changes,
        'normal_equivalence': [
            'Fault=none: Sig=ReferenceSig，且ReferenceSig逐字等于原Sig。',
            'Fault=none: EmptySignature展开为原全0签名，AdvanceEpoch展开为原a:=2，RestartGeneration展开为原2。',
            'Matches始终比较正确当前ReferenceSig；被测错误不会同时篡改参考值。',
            'Init/Next/vars/NF输入域、七个断言方向、原skip-actor/skip-restart分支逐字保留。',
        ],
        'scope': '故障仅改捕获/空值/actor步进/restart输出；不用断言反转或常量FALSE。',
    }
    if args.audit:
        args.audit.parent.mkdir(parents=True, exist_ok=True)
        args.audit.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({'status': 'MATCHED' if args.check else 'GENERATED',
                      'target_sha256': result['target_sha256'], 'changes': len(changes)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
