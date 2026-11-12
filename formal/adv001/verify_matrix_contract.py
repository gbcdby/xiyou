#!/usr/bin/env python3
"""用真实 TLC 反证矩阵不能接受删减检查或换掉见证；不运行业务测试。"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
RUNNER = Path('.agents/skills/worker-tla/scripts/run_tlc.py')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--jar', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=False)
    expectations = json.loads((ROOT/'expectations.json').read_text())
    manifest = json.loads((ROOT/'movement.json').read_text())
    rows = []
    for name, profile, replacement, raw in [
            ('positive-only-type', 'positive', 'TypeOK', 0),
            ('witness-replaced-target', 'witness-NoArrivalWitness', 'NoReplacedArrivalWitness', 12)]:
        base = args.out/name
        project = base/'project'
        formal = project/'formal/adv001'
        model = formal/'model'
        model.mkdir(parents=True)
        (project/RUNNER).parent.mkdir(parents=True)
        shutil.copy2(ROOT.parents[1]/RUNNER, project/RUNNER)
        shutil.copy2(ROOT/'run_matrix.py', formal/'run_matrix.py')
        shutil.copy2(ROOT/'model/Movement.tla', model/'Movement.tla')
        expect = next(e for e in expectations if e['model'] == 'Movement' and e['profile'] == profile)
        (formal/'expectations.json').write_text(json.dumps([expect], ensure_ascii=False, indent=2)+'\n')
        mutant = json.loads(json.dumps(manifest))
        mutant['profiles'] = {profile: mutant['profiles'][profile]}
        mutant['profiles'][profile]['expected_invariants'] = [replacement]
        cfg = mutant['profiles'][profile]['config']
        (model/cfg).write_text('SPECIFICATION Spec\nCONSTANTS\n  Fault = "none"\nINVARIANTS\n  '
                              + replacement+'\nCHECK_DEADLOCK TRUE\n')
        (formal/'movement.json').write_text(json.dumps(mutant, ensure_ascii=False, indent=2)+'\n')
        run = base/'run'
        process = subprocess.run([sys.executable, str(formal/'run_matrix.py'), '--jar',
                                  str(args.jar.resolve()), '--out', str(run.resolve()), '--jobs', '1'],
                                 capture_output=True, text=True)
        (base/'matrix-console.txt').write_text(process.stdout+process.stderr)
        row = json.loads((run/'matrix-results.json').read_text())[0]
        detected = (process.returncode == 1 and row['actual_raw_exit'] == raw
                    and row['actual_status'] == expect['expected_status']
                    and row['statistics']['distinct_states'] >= expect['distinct_state_min']
                    and row['check_inventory_matches'] is False and row['meets_expectation'] is False)
        rows.append({'case': name, 'target_profile': profile, 'mutated_invariants': [replacement],
                     'matrix_exit': process.returncode, 'actual_raw_exit': row['actual_raw_exit'],
                     'distinct_states': row['statistics']['distinct_states'], 'detected': detected,
                     'result': str((run/'matrix-results.json').relative_to(args.out)),
                     'result_sha256': hashlib.sha256((run/'matrix-results.json').read_bytes()).hexdigest()})
        print(json.dumps(rows[-1], ensure_ascii=False), flush=True)
    (args.out/'validator-results.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2)+'\n')
    return 0 if all(row['detected'] for row in rows) else 1


if __name__ == '__main__':
    sys.exit(main())
