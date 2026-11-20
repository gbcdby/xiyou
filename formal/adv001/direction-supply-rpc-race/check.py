#!/usr/bin/env python3
"""复跑显式选定的配置；保留固定 runner 的原始状态，不将见证改标 PASS。"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tarfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--jar', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--profile', action='append', required=True)
    args = parser.parse_args()
    package = Path(__file__).resolve().parent
    index = json.loads((package / 'results.json').read_text())
    expected = json.loads((package / 'expectations.json').read_text())
    unknown = sorted(set(args.profile) - set(expected))
    if unknown:
        parser.error('未知配置：' + ', '.join(unknown))
    if hashlib.sha256(args.jar.read_bytes()).hexdigest() != index['tool']['sha256']:
        parser.error('jar SHA 与固定工具不符')
    output = args.out.resolve()
    output.mkdir(parents=True, exist_ok=False)
    with tarfile.open(package / index['archives']['final']['path']) as archive:
        runner_bytes = archive.extractfile('tool/run_tlc.py').read()
    assert hashlib.sha256(runner_bytes).hexdigest() == index['tool']['runner_sha256']
    runner = output / 'run_tlc.py'
    runner.write_bytes(runner_bytes)
    rows = []
    for name in dict.fromkeys(args.profile):
        target = output / name
        with (output / (name + '.runner.log')).open('w') as stdout:
            process = subprocess.run([sys.executable, str(runner), '--manifest',
                                      str(package / 'verification.json'), '--profile', name,
                                      '--jar', str(args.jar.resolve()), '--out', str(target)],
                                     stdout=stdout, stderr=subprocess.STDOUT, check=False)
        actual = json.loads((target / 'result.json').read_text())
        messages = json.loads((target / 'messages.json').read_text())
        expectation = expected[name]
        positive = name.startswith('positive-')
        ok = (actual['status'] == expectation['expected']
              and actual['implementation_status'] == 'NOT_ASSESSED'
              and actual['checks']['configured_invariants'] == expectation['invariants']
              and actual['checks']['configured_properties'] == []
              and actual['checks']['checks_deadlock'] is False
              and actual['statistics']['distinct_states'] >= expectation['minimum_distinct_states']
              and not actual['process']['timed_out'] and not actual['process']['interrupted'])
        if positive:
            ok = ok and actual['process']['exit_code'] == 0 and actual['completed'] and actual['statistics']['remaining_states'] == 0
        else:
            target_name = expectation['invariants'][0]
            ok = ok and actual['process']['exit_code'] == 12 and [m['text'].strip() for m in messages if m['code'] == 2110] == [f'Invariant {target_name} is violated.']
        rows.append({'profile': name, 'expectation_matched': bool(ok), 'runner_exit': process.returncode,
                     'actual_status': actual['status'], 'statistics': actual['statistics']})
        print(json.dumps(rows[-1], ensure_ascii=False), flush=True)
    (output / 'summary.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
    return 0 if all(row['expectation_matched'] for row in rows) else 1


if __name__ == '__main__':
    raise SystemExit(main())
