#!/usr/bin/env python3
"""运行本包明确列出的有限配置，保留 runner 原始状态和预期反例。"""
import argparse
import json
from pathlib import Path
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--jar', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--group', choices=['authority', 'supply'], action='append')
    parser.add_argument('--profile', action='append')
    args = parser.parse_args()
    package = Path(__file__).resolve().parent
    runner = package.parents[2] / '.agents/skills/worker-tla/scripts/run_tlc.py'
    output = args.out.resolve()
    output.mkdir(parents=True, exist_ok=False)
    rows = []
    matched = set()
    for group in args.group or ['authority', 'supply']:
        manifest_path = package / f'{group}-verification.json'
        manifest = json.loads(manifest_path.read_text())
        expectations = json.loads((package / f'{group}-expectations.json').read_text())
        for name, profile in manifest['profiles'].items():
            expectation = expectations[name]
            if args.profile:
                if name not in args.profile:
                    continue
                matched.add(name)
            elif not expectation.get('gate', True):
                continue
            target = output / group / name
            process = subprocess.run([
                sys.executable, str(runner), '--manifest', str(manifest_path),
                '--profile', name, '--jar', str(args.jar.resolve()), '--out', str(target),
            ], check=False)
            result = json.loads((target / 'result.json').read_text())
            messages_path = target / 'messages.json'
            messages = json.loads(messages_path.read_text()) if messages_path.exists() else []
            distinct = result.get('statistics', {}).get('distinct_states')
            checks = result.get('checks', {})
            ok = (
                result['status'] == expectation['expected_status']
                and result['process']['exit_code'] == expectation['expected_tlc_exit']
                and isinstance(distinct, int)
                and distinct >= expectation['minimum_distinct_states']
                and checks.get('configured_invariants') == profile['expected_invariants']
                and checks.get('configured_properties') == profile['expected_properties']
                and checks.get('checks_deadlock') == profile['checks_deadlock']
            )
            if expectation['target']:
                ok = ok and any(
                    message['code'] == 2110
                    and message['text'].strip() == f"Invariant {expectation['target']} is violated."
                    for message in messages
                )
            else:
                ok = ok and result['completed'] and result['statistics']['remaining_states'] == 0
            rows.append({'group': group, 'profile': name, 'expectation_matched': bool(ok),
                         'runner_exit': process.returncode, 'actual_status': result['status'],
                         'raw_result': str(target / 'result.json')})
            print(f"{group}/{name}：{'符合预声明' if ok else '不符合预声明'}；原状态 {result['status']}", flush=True)
    missing = sorted(set(args.profile or []) - matched)
    summary = {'profiles': rows, 'unknown_profiles': missing,
               'all_expectations_matched': bool(rows) and not missing and all(row['expectation_matched'] for row in rows)}
    (output / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
    return 0 if summary['all_expectations_matched'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
