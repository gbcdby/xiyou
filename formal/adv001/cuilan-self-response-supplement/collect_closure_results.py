#!/usr/bin/env python3
"""只读收集 #62 实际执行；不重跑、不改写旧结果、不生成独审结论。"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
EFFECTS = HERE.parent / 'cuilan-self-response'
DEPS = {
    'SharedControlQuotient.tla': (HERE, ['SharedControlQuotient.tla']),
    'SignatureProjectionLemmas.tla': (HERE, ['SignatureProjectionLemmas.tla']),
    'SignatureProjectionSensitivity.tla': (HERE, ['SignatureProjectionSensitivity.tla']),
    'ReturnInputDomain.tla': (HERE, ['ReturnInputDomain.tla', 'ReturnSnapshotOperators.tla']),
    'PersonalEffectsHistoryQuotient.tla': (EFFECTS, ['PersonalEffectsHistoryQuotient.tla']),
    'PersonalEffectsLifeQuotient.tla': (EFFECTS, ['PersonalEffectsLifeQuotient.tla']),
    'AuthorityEffectsHistoryQuotient.tla': (
        EFFECTS, ['AuthorityEffectsHistoryQuotient.tla', 'PersonalEffectsHistoryQuotient.tla']),
}
SOURCES = {
    HERE / 'model/SharedControlEffects.tla': '151baf3544b2401bc0fdb2f0ce3fdf8e0feb449024227f2b35dee6e7bd3c7108',
    HERE / 'model/ReturnSnapshotOperators.tla': '52c903cd0b7006ca66a7796bde9031811a163e7d78a8720eba71bab2abcd6cb2',
    EFFECTS / 'model/PersonalEffects.tla': '4c20bde2577d87e539caddd60eaa58ac4fc9b6b27cd04f7c142a6afe31b94602',
    EFFECTS / 'model/AuthorityEffects.tla': '96fb85b6509524cab9b28cacf4aca41ca0ae1996f53aa0da0ab246017cb54dfc',
    HERE / 'model/SignatureProjectionLemmas.tla': '28197b9588bcea3a4b514c764749ca520ecfb69d35f1748f6c3cbd05e71dcd44',
}
SELECTED_POSITIVES = {
    'signature-domain-r1', 'shared-quotient-domain-r2', 'return-rows-r1',
    'return-requests-r1', 'effects-private-quotient-r1',
    'effects-cooperative-quotient-r1', 'authority-both-quotient-r1',
    'effects-restart-private-life-quotient-r1',
    'closure-signature-sensitivity-domain-std001-r1',
}
NEW_PROPERTIES = [
    'SourceInputClosed', 'CaptureMatches', 'EmptyStale', 'ActorProjection',
    'RestartProjection', 'CaptureInDomain', 'ActorDomainClosed', 'RestartDomainClosed',
]
PROGRESS = re.compile(
    r'Progress\((\d+)\).*?([\d,]+) states generated.*?'
    r'([\d,]+) distinct states found.*?([\d,]+) states left on queue')


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical_sha(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def read_run(path: Path) -> dict:
    data = json.loads((path / 'result.json').read_text())
    manifest = json.loads((path / 'manifest.json').read_text())
    if data['process']['exit_code'] is None or data['finished_at'] is None:
        raise ValueError(f'运行未结束，不冻结索引：{path.name}')
    if sha(path / 'manifest.json') != data['inputs']['manifest_sha256']:
        raise ValueError(f'运行清单摘要不符：{path.name}')
    profile = manifest['profiles'][data['profile']]
    inputs = {row['path']: row['sha256'] for row in data['inputs']['files']}
    for name, digest in inputs.items():
        if sha(path / 'input' / name) != digest:
            raise ValueError(f'历史输入快照变更：{path.name}/{name}')
    checks = data['checks']
    exact = (checks['configured_invariants'] == profile['expected_invariants']
             == checks['expected_invariants']
             and checks['configured_properties'] == profile['expected_properties']
             == checks['expected_properties']
             and checks['checks_deadlock'] is True)
    if not exact:
        raise ValueError(f'运行性质与预声明不一致：{path.name}')
    entry = manifest['model']['entry']
    model_root, dependencies = DEPS[entry]
    required = dependencies + [profile['config']]
    current = {name: sha(model_root / 'model' / name) == inputs[name]
               for name in required}
    negative = '-negative-' in data['profile']
    selected = negative or path.name in SELECTED_POSITIVES
    if selected and not all(current.values()):
        raise ValueError(f'选定运行的当前传递依赖不同：{path.name}')
    log = (path / 'tlc.log').read_text()
    progress = [dict(zip(['depth', 'generated_states', 'distinct_states', 'remaining_states'],
                        (int(v.replace(',', '')) for v in match.groups())))
                for match in PROGRESS.finditer(log)]
    violations = re.findall(r'Invariant (\w+) is violated', log)
    process, stats = data['process'], data['statistics']
    if negative:
        met = (data['status'] == 'COUNTEREXAMPLE' and process['exit_code'] == 12
               and bool(set(violations) & set(profile['expected_invariants'])))
    else:
        met = (data['status'] == 'PASS_WITHIN_SCOPE' and process['exit_code'] == 0
               and data['completed'] is True and stats.get('remaining_states') == 0
               and (stats.get('distinct_states') or 0) >= profile['scope']['minimum_distinct_states'])
    if selected and not met:
        raise ValueError(f'选定证据未达到其预声明判据：{path.name}')
    return {
        'run': path.name, 'profile': data['profile'], 'run_id': data['run_id'],
        'source': manifest['source'], 'model_entry': entry,
        'category': 'SAFETY_NEGATIVE' if negative else 'POSITIVE',
        'selected_for_property_evidence': selected,
        'status': data['status'], 'reason': data['reason'], 'completed': data['completed'],
        'process': process, 'started_at': data['started_at'], 'finished_at': data['finished_at'],
        'duration_seconds': data['duration_seconds'], 'statistics': stats,
        'progress_history': progress, 'last_partial_progress': progress[-1] if progress else None,
        'complete_depth': next((int(m.group(1)) for m in re.finditer(
            r'depth of the complete state graph search is (\d+)', log)), None),
        'violated_invariants': violations, 'meets_run_expectation': met,
        'checks': checks, 'profile_parameters': profile,
        'tool': data['tool'], 'command': data['command'],
        'fingerprint_and_runtime': next((line for line in log.splitlines()
                                         if 'search Model-Checking with fp ' in line), None),
        'message_codes': data['message_codes'], 'error_codes': data['error_codes'],
        'warning_codes': data['warning_codes'],
        'manifest_sha256': data['inputs']['manifest_sha256'],
        'transitive_input_hashes': {name: inputs[name] for name in required},
        'snapshot_file_count': len(inputs),
        'all_snapshot_hashes_verified': True,
        'full_snapshot_hash_table_sha256': canonical_sha(inputs),
        'current_dependencies_match': current,
        'evidence_hashes': {name: sha(path / name)
                            for name in ['result.json', 'manifest.json', 'messages.json', 'tlc.log']},
        'raw_evidence_directory': str(path),
    }


def write_report(result: dict, path: Path) -> None:
    selected = [row for row in result['all_runs'] if row['selected_for_property_evidence']]
    positives = [row for row in selected if row['category'] == 'POSITIVE']
    negatives = [row for row in selected if row['category'] == 'SAFETY_NEGATIVE']
    lines = [
        '# #62 实际运行结果与候选边界', '',
        '本表由 `collect_closure_results.py` 读取实际 result/manifest/messages/tlc.log 和输入快照生成。'
        '原候选已接受独立审查；本次 STD-001 差量待独立复审，作者不填独审结论。'
        '源模型对应及七项逐一裁决点见 [PROOF_CLOSURE.md](PROOF_CLOSURE.md)。', '',
        f"共 {len(result['all_runs'])} 次实际运行："
        f"{result['historical_summary']['statuses']}。选定 {len(selected)} 次当前证据："
        f'{len(positives)} 个正常检查完整结束，{len(negatives)} 个负控全部真实 rc12 命中预声明性质。'
        '负控反例不计作正常图 PASS，原历史七项结果不改写。', '',
        '## 选定正向结果', '',
        '| profile | distinct / generated / queue | 秒 | 原始返回码 | 性质 |',
        '| --- | ---: | ---: | ---: | --- |',
    ]
    for row in positives:
        stats = row['statistics']
        checks = row['checks']
        lines.append(f"| {row['profile']} | {stats['distinct_states']:,} / {stats['generated_states']:,} / "
                     f"{stats['remaining_states']} | {row['duration_seconds']:.3f} | 0 | "
                     f"{len(checks['expected_invariants'])} 不变量、{len(checks['expected_properties'])} 时间性质 |")
    lines.extend([
        '',
        '上述状态数分别属于不同检查，不能相加解释为一个完整产品状态空间。'
        'signature 是 NF 直接输入域；原模块与 STD-001 副本 none 的两次 3500 点检查分别记录；'
        'return 两项是纯函数输入因子；'
        'shared 是同一个四 actor/两用途/共享 Restart/Terminal 图；'
        'private、restart-private、cooperative 保留完整 cache。'
        'authority-both 本身不检查缓存消费，effects-both 的安全结论另依赖 §4 的 α 模拟与缓存归纳。', '',
        '## 本轮保留的历史与未完成运行', '',
        '| run | 实际状态 | 真实终局或最后进度下界 | 解释 |',
        '| --- | --- | --- | --- |',
    ])
    for row in result['all_runs']:
        if row['selected_for_property_evidence']:
            continue
        stats = row['statistics'] if row['status'] == 'PASS_WITHIN_SCOPE' else row['last_partial_progress']
        explanation = ('新增 SourceInputClosed 前的 11 性质版本；当前证据使用 r2。'
                       if row['run'] == 'shared-quotient-r1'
                       else '300 秒到期；下界不是终局，完整 cache 图未获穷尽。')
        lines.append(f"| {row['run']} | {row['status']} / rc{row['process']['exit_code']} | "
                     f"{stats['distinct_states']:,} distinct / {stats['remaining_states']:,} queue | {explanation} |")
    lines.extend([
        '',
        '`effects-both-life-quotient-r1` 的 INCONCLUSIVE 原样保留。'
        '候选组合证明只有在独审接受 η、α、15 条权威性质保持和第 16 条缓存相等归纳后，'
        '才可用于原有限安全义务；不能把本次超时改成 PASS。', '',
        '已生成但未运行的替代配置：' + '、'.join(f'`{x}`' for x in result['configured_but_not_run']) + '。'
        '它们没有取代 life 商实际运行，也未计入任何结果。', '',
        '## 定向负控', '',
        '| profile | 实际违反 | 真实返回码 | 秒 |',
        '| --- | --- | ---: | ---: |',
    ])
    for row in negatives:
        lines.append(f"| {row['profile']} | {', '.join(row['violated_invariants'])} | "
                     f"{row['process']['exit_code']} | {row['duration_seconds']:.3f} |")
    lines.extend([
        '',
        '纯输入域的初态反例可能没有终局状态统计，原 result.json 的 null 保持；'
        '不能以缺失计数自行填写 1 状态或 PASS。Probe 见证仍使用原版本与原结果，'
        '没有在擦除相关位的新模型上声称复现旧见证。', '',
        '## R-ISSUE62-STD-001 差量补证', '',
        '原候选的六项新属性缺少自身目标的负控，这是工程标准缺口。'
        '新增六条具体构造错误的负控和一个签名副本 none 小域正向；'
        '原正常模型、旧 cfg、原 36 次运行及 26 条原负控全部保留。'
        '没有重新运行大图或以反转断言制造反例。'
        '逐项覆盖和旧证据适用性见 `STD001_SENSITIVITY.json`、`STD001_REUSE_AUDIT.json`，'
        '具体故障及 none 展开关系见 PROOF_CLOSURE §8。'
        '这里只记录作者修正证据，finding 是否关闭仍由独审裁决。', '',
        '## 身份、资源与复算', '',
        '`CLOSURE_RUN_INDEX.json` 含精确模型及传递依赖/配置摘要、执行命令、TLC 指纹、'
        '原始四种证据文件 SHA、每次真实状态和超时下界。'
        '复制到 closure 的 effects/authority cfg 已逐字比较原 cfg；历史原模型摘要也重新核实。', '',
        '每进程 1 worker / 1024 MiB 最大堆，最多并行两个；JVM 本地和 off-heap 内存未测量。'
        '普通 BFS、死锁检查启用，无 CONSTRAINT/VIEW/对称约简/随机模拟/Java override。'
        'TLC 2.19、OpenJDK 21.0.13，jar SHA-256：'
        '`936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`。', '',
        '在仓库根目录设置同摘要 `TLA_JAR` 路径，生成审计与单项复算示例：', '',
        '```sh',
        'python3 formal/adv001/cuilan-self-response/build_history_quotient.py --check',
        'python3 formal/adv001/cuilan-self-response-supplement/build_quotient.py --check',
        'python3 .agents/skills/worker-tla/scripts/run_tlc.py \\',
        '  --manifest formal/adv001/cuilan-self-response-supplement/closure-shared-verification.json \\',
        '  --profile closure-shared-quotient --jar "$TLA_JAR" \\',
        '  --out .agent-output/issue62-reproduction/new-shared-run',
        '```', '',
        '每次输出必须为全新目录。原始证据封存摘要见 `CLOSURE_EVIDENCE.json`；'
        '索引只是绝对目录前缀规范化的派生物，原日志本身未替换路径或重写。', '',
        '本轮不修改 Spec/业务/项目测试，也不宣告生产实现、真实 UI、SQL 原子性、'
        '网络无限交错或真人体验通过。停止新增运行的原因是剩余义务已形成具体可审的模型关系；'
        '若独审发现对应关系缺口，再针对该缺口补证。', '',
    ])
    path.write_text('\n'.join(lines))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--runs', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    runs_root = args.runs.resolve()
    for path, expected in SOURCES.items():
        if sha(path) != expected:
            raise ValueError(f'原始模型身份变化：{path.name}')
    rows = [read_run(path.parent) for path in sorted(runs_root.glob('*/result.json'))]
    found = {row['run'] for row in rows}
    if not SELECTED_POSITIVES <= found:
        raise ValueError('缺少已声明的正向实际运行')
    manifests = list(HERE.glob('closure-*-verification.json')) + list(EFFECTS.glob('closure-*-verification.json'))
    defined = {name for manifest in manifests
               for name in json.loads(manifest.read_text())['profiles']}
    actual = {row['profile'] for row in rows}
    cfg_pairs = {}
    for path in sorted((EFFECTS / 'model').glob('closure-*.cfg')):
        original = path.name.removeprefix('closure-life-').removeprefix('closure-')
        source = path.with_name(original)
        equal = path.read_bytes() == source.read_bytes()
        if not equal:
            raise ValueError(f'复制配置发生变化：{path.name}')
        cfg_pairs[path.name] = {'original': original, 'sha256': sha(path), 'byte_identical': True}
    selected = [row for row in rows if row['selected_for_property_evidence']]
    sensitivity = {
        prop: [{'run': row['run'], 'run_id': row['run_id'], 'profile': row['profile'],
                'raw_exit': row['process']['exit_code'],
                'log_sha256': row['evidence_hashes']['tlc.log']}
               for row in selected
               if row['category'] == 'SAFETY_NEGATIVE' and prop in row['violated_invariants']
               and row['process']['exit_code'] == 12]
        for prop in NEW_PROPERTIES
    }
    if any(not evidence for evidence in sensitivity.values()):
        raise ValueError('新增属性缺少自身目标的真实rc12负控；不输出完整候选索引。')
    result = {
        'schema_version': 1, 'subject': 'xiyou #62 七项形式未决：作者候选证据',
        'base_commit': '3a3001325553b5116db65234190fd681bac7eaf4',
        'base_tree': 'd16f5538f65e80a85aa563ced2bc3cd373db4d09',
        'implementation_status': 'NOT_ASSESSED', 'independent_review': 'PENDING_STD001_DELTA_REVIEW',
        'historical_original_results': 'UNCHANGED',
        'source_hashes': {str(path.relative_to(REPO)): digest for path, digest in SOURCES.items()},
        'proof_document_sha256': sha(HERE / 'PROOF_CLOSURE.md'),
        'runner_sha256': sha(REPO / '.agents/skills/worker-tla/scripts/run_tlc.py'),
        'collector_sha256': sha(Path(__file__)),
        'evidence_archive': json.loads((HERE / 'CLOSURE_EVIDENCE.json').read_text())
            if (HERE / 'CLOSURE_EVIDENCE.json').exists() else None,
        'configuration_copies': cfg_pairs,
        'new_property_sensitivity': sensitivity,
        'selected_summary': {'runs': len(selected), 'statuses': dict(Counter(row['status'] for row in selected)),
                             'all_meet_run_expectation': all(row['meets_run_expectation'] for row in selected)},
        'historical_summary': {'runs': len(rows), 'statuses': dict(Counter(row['status'] for row in rows))},
        'configured_but_not_run': sorted(defined - actual),
        'all_runs': rows,
        'notes': [
            '仅选择精确当前传递依赖、全部预声明性质、终局或指定反例匹配的实际运行。',
            'shared-quotient-r1 的旧输入仅保留历史；SourceInputClosed 使用 r2 另行穷尽。',
            'effects-both life 商超时保持 INCONCLUSIVE；组合候选证明不能改写该状态。',
            '完整输入哈希表仍在原 result.json；本公开索引只列传递依赖及全表摘要。',
            '所有 run 的 result/manifest/messages/log 和输入快照均在原始证据封存包中。',
            '正向有限穷尽与负控反例均不构成独立审查或生产实现通过。',
        ],
        'publication': {
            'kind': 'DERIVED_PORTABLE_INDEX_NOT_RAW_LOG',
            'path_mapping': {'run_root': '${ISSUE62_RUN_ROOT}', 'worktree': '${WORKTREE}'},
            'scope': '仅递归替换上述两个绝对路径前缀；原件哈希与实际命令其余参数不变。',
        },
    }
    content = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    # 原始日志可以搬到审查者目录；仍按运行时路径归一化命令，不能误用当前checkout替代。
    replacements = {str(runs_root): '${ISSUE62_RUN_ROOT}', str(REPO): '${WORKTREE}'}
    for raw in sorted(runs_root.glob('*/result.json')):
        data = json.loads(raw.read_text())
        old_runs = str(Path(data['inputs']['snapshot_directory']).parent.parent)
        original_model = Path(data['inputs']['model_root'])
        replacements[old_runs] = '${ISSUE62_RUN_ROOT}'
        replacements[str(original_model.parents[3])] = '${WORKTREE}'
    for prefix in sorted(replacements, key=len, reverse=True):
        content = content.replace(prefix, replacements[prefix])
    args.out.write_text(content)
    sensitivity_file = args.out.with_name('STD001_SENSITIVITY.json')
    sensitivity_file.write_text(json.dumps({
        'finding': 'R-ISSUE62-STD-001',
        'original_candidate': '4c9957349800767efc4a9668d29fc8c896cd5e2d',
        'author_status': 'EVIDENCE_READY_FOR_INDEPENDENT_REVIEW',
        'independent_finding_status': 'NOT_DECIDED_BY_AUTHOR',
        'properties': sensitivity,
        'note': '8个新增属性各有真实rc12；其中ActorProjection/RestartProjection复用原运行，另外6项为本次差量。',
    }, ensure_ascii=False, indent=2)+'\n')
    if args.report:
        write_report(result, args.report)
    print(json.dumps({'selected': result['selected_summary'], 'history': result['historical_summary'],
                      'not_run': result['configured_but_not_run']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
