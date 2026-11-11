#!/usr/bin/env python3
"""核对 fallback 固定输入、真实状态和目标反例；不替代独立语义审查。"""
import hashlib
import json
from pathlib import Path
import re


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    base = Path(__file__).resolve().parent
    root = base.parents[2]
    manifest = json.loads((base / 'verification.json').read_text())
    index = json.loads((base / 'results.json').read_text())
    errors = []
    checks = []
    rows = index['runs']
    if len(rows) != len(manifest['profiles']) or {r['profile'] for r in rows} != set(manifest['profiles']):
        errors.append('当前结果未逐项覆盖清单')
    for row in rows:
        profile = row['profile']
        before = len(errors)
        def check(ok, message):
            if not ok:
                errors.append(profile + ': ' + message)
        result_path = base / row['result']
        result = json.loads(result_path.read_text())
        original_path = base / row['manifest']
        original = json.loads(original_path.read_text())
        inputs = base / row['input']
        expected = manifest['profiles'][profile]
        log = (base / row['log']).read_text()
        check(result['inputs']['manifest_sha256'] == digest(original_path), '原始清单摘要不匹配')
        check(original['profiles'][profile] == expected, '运行条件不属于当前候选')
        check(result['inputs']['runner_sha256'] == digest(root / '.agents/skills/worker-tla/scripts/run_tlc.py'), 'runner 已改变')
        check(result['tool']['sha256'] == manifest['tool']['sha256'], '工具摘要不匹配')
        for entry in result['inputs']['files']:
            check(digest(inputs / entry['path']) == entry['sha256'], '输入摘要不匹配: ' + entry['path'])
        for name in [manifest['model']['entry'], expected['config']]:
            check((inputs / name).read_bytes() == (base / 'model' / name).read_bytes(), '输入不是当前模型/CFG: ' + name)
        check(result['checks']['configured_invariants'] == expected['expected_invariants'], '实际不变量集合不匹配')
        check(result['checks']['configured_properties'] == expected['expected_properties'], '实际活性集合不匹配')
        check(result['checks']['checks_deadlock'] is True, '未开启死锁检查')
        check(result['mode'] == 'modelcheck' and '-modelcheck' in result['command'], '不是受控 BFS 全量检查')
        check(result['implementation_status'] == 'NOT_ASSESSED', '实现状态被改写')
        check(bool(result.get('finished_at')), '运行没有最终报告')
        check(row['status'] == result['status'] and row['raw_tlc_exit_code'] == result['process']['exit_code'], '索引状态或退出码不匹配')
        check(row['statistics'] == result['statistics'] and row['distinct_states'] == result['statistics']['distinct_states'], '索引统计不匹配')
        check((result_path.parent / 'messages.json').is_file(), '缺原始结构化消息')
        raw = result['process']['exit_code']
        if profile == 'deadlock':
            check(result['status'] == 'COUNTEREXAMPLE' and raw == 11 and 'Deadlock reached' in log, '未命中真实死锁')
        elif profile.startswith('negative-') and expected['expected_properties']:
            check(result['status'] == 'COUNTEREXAMPLE' and raw == 13 and 'Temporal properties were violated' in log, '未命中真实活性反例')
        elif profile.startswith(('negative-', 'witness-')):
            target = expected['expected_invariants'][0]
            check(result['status'] == 'COUNTEREXAMPLE' and raw == 12 and f'Invariant {target} is violated' in log, '未命中目标不变量')
        else:
            check(result['status'] == 'PASS_WITHIN_SCOPE' and raw == 0 and result['completed'], '正向未完整通过')
            check(result['statistics']['remaining_states'] == 0, '队列非零')
            check(result['statistics']['distinct_states'] >= expected['scope']['distinct_state_min'], '低于预声明状态下限')
        checks.append({'profile': profile, 'evidence_consistent': len(errors) == before, 'result_sha256': digest(result_path)})
    negative_targets = {p['expected_invariants'][0] for name, p in manifest['profiles'].items()
                        if name.startswith('negative-') and p['expected_invariants']}
    for target in manifest['profiles']['positive']['expected_invariants']:
        if target not in negative_targets:
            errors.append('启用安全性质缺目标负对照: ' + target)
    # 结构化消息保留原始状态文本。本检查只读取必要字段，验证目标链的时间顺序。
    causal_checks = []
    for profile in ['negative-lost_receipt', 'witness-crash-retry-fallback']:
        row = next(r for r in rows if r['profile'] == profile)
        messages = json.loads((base / row['result']).with_name('messages.json').read_text())
        states = [m['text'] for m in messages if m['code'] == 2217]
        snapshots = []
        for state in states:
            count = len(re.findall(r'kind\s*\|->\s*"fallback"', state))
            crash = int(re.search(r'crashes\s*\|->\s*(\d+)', state).group(1))
            up = re.search(r'up\s*\|->\s*(TRUE|FALSE)', state).group(1) == 'TRUE'
            stage = re.search(r'stage\s*\|->\s*"([^"]+)"', state).group(1)
            snapshots.append({'state': int(state.split(':', 1)[0]), 'fallback_effects': count,
                              'crashes': crash, 'up': up, 'stage': stage})
        first_effect = next((i for i, s in enumerate(snapshots) if s['fallback_effects'] == 1 and s['crashes'] == 0), None)
        crash_at = next((i for i, s in enumerate(snapshots) if s['fallback_effects'] == 1 and s['crashes'] == 1 and not s['up']), None)
        valid = (first_effect is not None and crash_at is not None and first_effect < crash_at
                 and any(s['up'] and s['crashes'] == 1 for s in snapshots[crash_at + 1:]))
        if profile == 'negative-lost_receipt':
            valid = valid and snapshots[-1]['fallback_effects'] == 2
        else:
            valid = valid and snapshots[-1]['fallback_effects'] == 1 and 'crashAfterFallback |-> TRUE' in states[-1]
        if not valid:
            errors.append(profile + ': 提交→崩溃→恢复→原键重试因果链不完整')
        causal_checks.append({'profile': profile, 'causal_order_confirmed': valid, 'trace': snapshots})
    output = {'evidence_consistent': not errors, 'checked_profiles': len(rows),
              'model_sha256': digest(base / 'model/Fallback.tla'), 'checks': checks,
              'causal_checks': causal_checks, 'errors': errors,
              'finding': 'R-vs001-p04-VIS-001', 'finding_status': 'FIX_REPORTED',
              'independent_review': 'NOT_RUN', 'implementation_status': 'NOT_ASSESSED'}
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == '__main__':
    raise SystemExit(main())
