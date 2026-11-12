#!/usr/bin/env python3
"""在新目录运行模型矩阵并核对预声明判据；日志保持原字节。"""
import argparse
import concurrent.futures
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent


def same_checks(actual, target):
    """性质顺序不影响语义；缺字段、重复项或非字符串不视为相同集合。"""
    return (isinstance(actual, list) and isinstance(target, list)
            and all(isinstance(item, str) and item for item in actual + target)
            and len(actual) == len(set(actual)) and len(target) == len(set(target))
            and set(actual) == set(target))


def assess_result(expect, result, log):
    """新运行和原始证据重审共用判据；不改写 TLC 结果和日志。"""
    checks = result.get('checks', {})
    inventory = {
        field: {'actual': checks.get(field), 'target': expect[target],
                'matches': same_checks(checks.get(field), expect[target])}
        for field, target in [
            ('configured_invariants', 'target_invariants'),
            ('configured_properties', 'target_properties'),
            ('expected_invariants', 'target_invariants'),
            ('expected_properties', 'target_properties')]
    }
    inventory_matches = all(item['matches'] for item in inventory.values())
    raw = result.get('process', {}).get('exit_code')
    stats = result.get('statistics', {})
    passed = (inventory_matches and checks.get('checks_deadlock') is True
              and result.get('status') == expect['expected_status']
              and raw == expect['expected_raw_exit']
              and (stats.get('distinct_states') or 0) >= expect['distinct_state_min'])
    if expect['expected_status'] == 'PASS_WITHIN_SCOPE':
        passed = passed and result.get('completed') is True and stats.get('remaining_states') == 0
    elif expect['expected_raw_exit'] == 12:
        # 见证也是指定不变量的反例；不能由另一个可达性质代替。
        passed = passed and bool(expect['target_invariants'])
        passed = passed and all(f'Invariant {target} is violated.' in log
                                for target in expect['target_invariants'])
    elif expect['expected_raw_exit'] == 13:
        # TLC 2.19 的时序反例不输出性质名；必须仅启用预声明的唯一性质。
        passed = (passed and not expect['target_invariants']
                  and len(expect['target_properties']) == 1 and '@STARTMSG 2116:' in log)
    else:
        passed = False
    return {'actual_status': result.get('status'), 'actual_raw_exit': raw,
            'statistics': stats, 'check_inventory': inventory,
            'check_inventory_matches': inventory_matches, 'meets_expectation': bool(passed)}


def run(expect, args):
    name = expect['model'].lower()+'-'+expect['profile']
    out = args.out/name
    proc = subprocess.run([sys.executable, str(ROOT.parents[1]/'.agents/skills/worker-tla/scripts/run_tlc.py'), '--manifest',
        str(ROOT/(expect['model'].lower()+'.json')), '--profile', expect['profile'],
        '--jar', str(args.jar.resolve()), '--out', str(out.resolve())],capture_output=True,text=True)
    result_path=out/'result.json'
    result=json.loads(result_path.read_text()) if result_path.exists() else {}
    log=(out/'tlc.log').read_text() if (out/'tlc.log').exists() else ''
    row={**expect, **assess_result(expect, result, log), 'result':name+'/result.json',
         'result_sha256':hashlib.sha256(result_path.read_bytes()).hexdigest() if result_path.exists() else None,
         'runner_exit':proc.returncode}
    (out/'runner-console.txt').write_text(proc.stdout+proc.stderr)
    print(json.dumps({k:row[k] for k in ['model','profile','actual_status','actual_raw_exit','statistics','meets_expectation']},ensure_ascii=False),flush=True)
    return row


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--jar', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--model', choices=['MovementCommands','Movement','Consent','Resources','Identity','Scheduler'])
    parser.add_argument('--jobs', type=int, default=3)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=False)
    expectations = json.loads((ROOT/'expectations.json').read_text())
    if args.model:
        expectations = [e for e in expectations if e['model'] == args.model]
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as pool:
        rows = list(pool.map(lambda expect: run(expect, args), expectations))
    (args.out/'matrix-results.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
    return 0 if rows and all(r['meets_expectation'] for r in rows) else 1


if __name__ == '__main__':
    sys.exit(main())
