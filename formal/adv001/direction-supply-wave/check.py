#!/usr/bin/env python3
"""逐个运行有限配置；目标反例与正向完成分别核对，不改 runner 原状态。"""
import argparse
import json
from pathlib import Path
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--jar', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--profile', action='append')
    parser.add_argument('--kind', choices=['positive', 'negative-control', 'witness'], action='append')
    parser.add_argument('--supplement', action='store_true', help='只跑严格先后关系的补充见证')
    args = parser.parse_args()
    package = Path(__file__).resolve().parent
    runner = package.parents[2] / '.agents/skills/worker-tla/scripts/run_tlc.py'
    prefix = 'witness-' if args.supplement else ''
    manifest_path = package / f'{prefix}verification.json'
    manifest = json.loads(manifest_path.read_text())
    expectations = json.loads((package / f'{prefix}expectations.json').read_text())
    output = args.out.resolve()
    output.mkdir(parents=True, exist_ok=False)
    rows, matched = [], set()
    for name, profile in manifest['profiles'].items():
        expectation = expectations[name]
        if args.profile and name not in args.profile:
            continue
        if args.kind and expectation['kind'] not in args.kind:
            continue
        matched.add(name)
        target = output / name
        process = subprocess.run([
            sys.executable, str(runner), '--manifest', str(manifest_path),
            '--profile', name, '--jar', str(args.jar.resolve()), '--out', str(target),
        ], check=False)
        result = json.loads((target / 'result.json').read_text())
        messages_file = target / 'messages.json'
        messages = json.loads(messages_file.read_text()) if messages_file.exists() else []
        stats = result.get('statistics', {})
        count = stats.get('distinct_states')
        checks = result.get('checks', {})
        ok = (result['status'] == expectation['expected_status']
              and result['process']['exit_code'] == expectation['expected_tlc_exit']
              and result['implementation_status'] == 'NOT_ASSESSED'
              and isinstance(count, int) and count >= expectation['minimum_distinct_states']
              and checks.get('configured_invariants') == profile['expected_invariants']
              and checks.get('configured_properties') == []
              and checks.get('checks_deadlock') is False)
        if expectation['target']:
            ok = ok and any(message['code'] == 2110 and message['text'].strip()
                            == f"Invariant {expectation['target']} is violated." for message in messages)
        else:
            ok = ok and result['completed'] and stats['remaining_states'] == 0
        rows.append({'profile': name, 'kind': expectation['kind'], 'expectation_matched': bool(ok),
                     'runner_exit': process.returncode, 'actual_status': result['status'],
                     'distinct_states': count, 'target': expectation['target'],
                     'raw_result': str(target / 'result.json')})
        print(f"{name}：{'符合预声明' if ok else '不符合预声明'}；{result['status']}；{count} 状态", flush=True)
    missing = sorted(set(args.profile or []) - matched)
    summary = {'profiles': rows, 'unknown_profiles': missing,
               'all_expectations_matched': bool(rows) and not missing
               and all(row['expectation_matched'] for row in rows)}
    (output / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
    return 0 if summary['all_expectations_matched'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
