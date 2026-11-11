#!/usr/bin/env python3
"""只读核对边界模型的固定输入、原始结果和目标性质，不代替独立语义审查。"""
import hashlib
import json
from pathlib import Path


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    root = Path(__file__).resolve().parent
    runner = root.parents[1] / '.agents/skills/worker-tla/scripts/run_tlc.py'
    errors = []
    checked = []
    for name in ['isolation', 'reconnect', 'visibility', 'deadlock']:
        base = root / name
        manifest = json.loads((base / 'verification.json').read_text())
        index = json.loads((base / 'results.json').read_text())
        rows = index['runs']
        if {r['profile'] for r in rows} != set(manifest['profiles']):
            errors.append(name + ': 结果索引未完整覆盖清单')
        if len({r['profile'] for r in rows}) != len(rows):
            errors.append(name + ': 结果索引存在重复profile')
        for row in rows:
            profile = row['profile']
            label = name + '/' + profile
            before = len(errors)
            result_path = base / row['result']
            evidence = result_path.parent
            result = json.loads(result_path.read_text())
            original = json.loads((evidence / 'manifest.json').read_text())
            expected = manifest['profiles'][profile]
            log = (evidence / 'tlc.log').read_text()
            def check(condition, message):
                if not condition:
                    errors.append(label + ': ' + message)
            check(result['inputs']['manifest_sha256'] == digest(evidence / 'manifest.json'), '原始清单摘要不符')
            check(result['inputs']['runner_sha256'] == digest(runner), 'runner已变化')
            check(result['tool']['sha256'] == manifest['tool']['sha256'], '工具摘要不符')
            check(original['profiles'][profile] == expected, '本profile运行条件与当前清单不符')
            for entry in result['inputs']['files']:
                source = evidence / 'input' / entry['path']
                check(digest(source) == entry['sha256'], '输入快照摘要不符: ' + entry['path'])
            entry = manifest['model']['entry']
            check((evidence / 'input' / entry).read_bytes() == (base / 'model' / entry).read_bytes(), '模型不属于当前候选')
            check((evidence / 'input' / expected['config']).read_bytes() == (base / 'model' / expected['config']).read_bytes(), 'CFG不属于当前候选')
            check(result['checks']['configured_invariants'] == expected['expected_invariants'], '实际不变量集合不符')
            check(result['checks']['configured_properties'] == expected['expected_properties'], '实际活性集合不符')
            check(result['checks']['checks_deadlock'] is True, '未启用死锁检查')
            check(result['mode'] == 'modelcheck' and '-modelcheck' in result['command'], '不是受控全量模型检查')
            check(result['implementation_status'] == 'NOT_ASSESSED', '混淆实现状态')
            check((evidence / 'messages.json').is_file(), '缺少完整结构化原始消息')
            check(row['status'] == result['status'], '索引状态不符')
            check(row['raw_tlc_exit_code'] == result['process']['exit_code'], '索引原始退出码不符')
            check(row['distinct_states'] == result['statistics']['distinct_states'], '索引状态数不符')
            raw = result['process']['exit_code']
            if profile.startswith('negative-') or profile.startswith('witness-') or profile == 'deadlock':
                check(result['status'] == 'COUNTEREXAMPLE', '预期反例未取得')
                if profile == 'deadlock':
                    check(raw == 11 and 'Deadlock reached' in log, '未取得真实死锁反例')
                elif expected['expected_properties']:
                    check(raw == 13 and 'Temporal properties were violated' in log, '未取得真实活性反例')
                else:
                    target = expected['expected_invariants'][0]
                    check(raw == 12 and f'Invariant {target} is violated' in log, '未取得目标不变量反例')
            else:
                check(result['status'] == 'PASS_WITHIN_SCOPE' and raw == 0 and result['completed'], '正向检查未完整通过')
                check(result['statistics']['remaining_states'] == 0, '正向队列未清空')
                check(result['statistics']['distinct_states'] >= expected['scope']['distinct_state_min'], '未达到预声明状态下限')
            checked.append({'profile': label, 'evidence_consistent': len(errors) == before, 'result_sha256': digest(result_path)})
    print(json.dumps({'evidence_consistent': not errors, 'checked_profiles': len(checked), 'checks': checked, 'errors': errors, 'semantic_review': 'NOT_RUN', 'implementation_status': 'NOT_ASSESSED'}, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == '__main__':
    raise SystemExit(main())
