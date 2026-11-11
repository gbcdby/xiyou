#!/usr/bin/env python3
"""运行冻结输入的 fallback 模型配置，并核对真实 raw TLC 目标。"""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys


def expected_result(profile, definition, result, log):
    raw = result['process']['exit_code']
    if profile == 'deadlock':
        return result['status'] == 'COUNTEREXAMPLE' and raw == 11 and 'Deadlock reached' in log
    if profile.startswith('negative-') and definition['expected_properties']:
        return result['status'] == 'COUNTEREXAMPLE' and raw == 13 and 'Temporal properties were violated' in log
    if profile.startswith(('negative-', 'witness-')):
        target = definition['expected_invariants'][0]
        return result['status'] == 'COUNTEREXAMPLE' and raw == 12 and f'Invariant {target} is violated' in log
    return (result['status'] == 'PASS_WITHIN_SCOPE' and raw == 0 and result['completed']
            and result['statistics']['remaining_states'] == 0
            and result['statistics']['distinct_states'] >= definition['scope']['distinct_state_min'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--jar', type=Path, required=True)
    parser.add_argument('--run-id', required=True)
    parser.add_argument('--profiles', nargs='+')
    args = parser.parse_args()
    if Path(args.run_id).name != args.run_id or args.run_id in {'.', '..'}:
        parser.error('run-id 必须是单个目录名')
    base = Path(__file__).resolve().parent
    root = base.parents[2]
    manifest = json.loads((base / 'verification.json').read_text())
    profiles = args.profiles or list(manifest['profiles'])
    if set(profiles) - set(manifest['profiles']):
        parser.error('存在未声明配置')
    output = root / '.agent-output/fallback' / args.run_id
    output.mkdir(parents=True, exist_ok=False)
    frozen = output / 'source'
    frozen.mkdir()
    shutil.copytree(base / 'model', frozen / 'model')
    shutil.copy2(base / 'verification.json', frozen / 'verification.json')
    rows = []
    for profile in profiles:
        destination = output / profile
        command = [sys.executable, str(root / '.agents/skills/worker-tla/scripts/run_tlc.py'),
                   '--manifest', str(frozen / 'verification.json'), '--profile', profile,
                   '--jar', str(args.jar.resolve()), '--out', str(destination)]
        process = subprocess.run(command, capture_output=True, text=True)
        (output / (profile + '.runner.stdout')).write_text(process.stdout)
        (output / (profile + '.runner.stderr')).write_text(process.stderr)
        result = json.loads((destination / 'result.json').read_text())
        log = (destination / 'tlc.log').read_text() if (destination / 'tlc.log').is_file() else ''
        valid = expected_result(profile, manifest['profiles'][profile], result, log)
        row = {'profile': profile, 'status': result['status'], 'raw_tlc_exit_code': result['process']['exit_code'],
               'distinct_states': result['statistics']['distinct_states'], 'expected_result_observed': valid,
               'runner_exit_code': process.returncode, 'result': str(destination / 'result.json')}
        rows.append(row)
        print(json.dumps(row, ensure_ascii=False), flush=True)
        (output / 'summary.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
    return 0 if all(row['expected_result_observed'] for row in rows) else 1


if __name__ == '__main__':
    raise SystemExit(main())
