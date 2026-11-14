#!/usr/bin/env python3
"""复用固定 runner；核对实际性质、原始退出码和本模型运行前判据。"""
from __future__ import annotations
import argparse
import concurrent.futures
import hashlib
import json
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--jar', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--profile', action='append')
    parser.add_argument('--jobs', type=int, default=2)
    args = parser.parse_args()
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=False)
    manifest = json.loads((HERE / 'verification.json').read_text())
    expectations = json.loads((HERE / 'expectations.json').read_text())
    names = args.profile or list(manifest['profiles'])
    if not set(names) <= set(expectations):
        raise ValueError('配置没有预声明判据')
    def run(name):
        destination = out / name
        command = [sys.executable, str(ROOT / '.agents/skills/worker-tla/scripts/run_tlc.py'),
                   '--manifest', str(HERE / 'verification.json'), '--profile', name,
                   '--jar', str(Path(args.jar).resolve()), '--out', str(destination)]
        process = subprocess.run(command, cwd=ROOT, text=True, capture_output=True)
        result_file = destination / 'result.json'
        if not result_file.exists():
            return {'profile': name, 'meets_expectation': False, 'stdout': process.stdout,
                    'stderr': process.stderr, 'runner_exit': process.returncode}
        result = json.loads(result_file.read_text())
        expected = expectations[name]
        checks = result.get('checks', {})
        messages = json.loads((destination / 'messages.json').read_text())
        raw = result.get('process', {}).get('exit_code')
        exact_checks = (checks.get('configured_invariants') == expected['invariants']
                        and checks.get('expected_invariants') == expected['invariants']
                        and checks.get('configured_properties') == expected['properties']
                        and checks.get('expected_properties') == expected['properties']
                        and checks.get('checks_deadlock') is True)
        met = exact_checks and result['status'] == expected['status'] and raw == expected['raw_exit']
        states = result.get('statistics', {})
        if expected['status'] == 'PASS_WITHIN_SCOPE':
            met = met and result.get('completed') is True and states.get('remaining_states') == 0
            met = met and states.get('distinct_states', 0) >= expected['minimum_distinct_states']
        elif expected['raw_exit'] == 12:
            met = met and any(expected['target'] in message['text'] and 'violated' in message['text']
                              for message in messages)
        else:
            met = met and 2116 in result.get('message_codes', []) and expected['properties'] == ['SemanticProgress']
        entry = {'profile': name, 'status': result['status'], 'raw_exit': raw,
                 'runner_exit': process.returncode, 'distinct_states': states.get('distinct_states'),
                 'remaining_states': states.get('remaining_states'), 'checks_exact': exact_checks,
                 'meets_expectation': bool(met), 'result': str(result_file.relative_to(out)),
                 'result_sha256': hashlib.sha256(result_file.read_bytes()).hexdigest()}
        print(json.dumps(entry, ensure_ascii=False), flush=True)
        return entry
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(2, max(1, args.jobs))) as pool:
        rows = list(pool.map(run, names))
    (out / 'matrix-results.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
    return 0 if all(row['meets_expectation'] for row in rows) else 1

if __name__ == '__main__':
    raise SystemExit(main())
