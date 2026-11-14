#!/usr/bin/env python3
"""Index only new supplementary TLC runs; never relabel the original 131 profiles."""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
DEPS = {
    'fence': ['SharedControlEffects.tla'],
    'returns': ['ReturnSnapshotCut.tla', 'ReturnSnapshotOperators.tla', 'SharedControlEffects.tla'],
    'transport': ['ObserverSnapshotTransport.tla'],
    'recovery': ['PersonalRecovery.tla'],
}
OVERRIDES = {
    'fence-shared': 'shared-extension',
    'fence-performer': 'initial-corrected',
    'fence-negative-type': 'initial-corrected',
    'returns-negative-type': 'return-source-version',
    'returns-witness-mixed-holders': 'return-source-version',
    'returns-constructor': 'return-source-version',
    'transport-negative-type': 'initial',
    'transport-complete': 'initial-corrected',
    'recovery-negative-both-purposes-progress': 'initial-corrected',
}


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def classify(profile: str, expected: dict) -> str:
    if '-witness-' in profile:
        return 'REACHABILITY_WITNESS'
    if expected['raw_exit'] == 13:
        return 'TEMPORAL_NEGATIVE'
    if expected['raw_exit'] == 12:
        return 'SAFETY_NEGATIVE'
    return 'POSITIVE'


def read_run(path: Path, root: Path) -> dict:
    data = json.loads((path / 'result.json').read_text())
    manifest = json.loads((path / 'manifest.json').read_text())
    log = (path / 'tlc.log').read_text(errors='replace').splitlines()
    progress = []
    pattern = r'Progress\((\d+)\).*?([\d,]+) states generated.*?([\d,]+) distinct states found.*?([\d,]+) states left on queue'
    for line in log:
        match = re.search(pattern, line)
        if match:
            values = [int(value.replace(',', '')) for value in match.groups()]
            progress.append(dict(zip(['depth', 'generated_states', 'distinct_states', 'remaining_states'], values)))
    profile = manifest.get('profiles', {}).get(data['profile'], {})
    inputs = {item['path']: item['sha256'] for item in data.get('inputs', {}).get('files', [])}
    input_ok = {name: (path / 'input' / name).is_file() and sha(path / 'input' / name) == digest
                for name, digest in inputs.items()}
    if not all(input_ok.values()):
        raise ValueError('Historical snapshot hash mismatch: ' + str(path))
    return {
        'run': str(path.relative_to(root)), 'profile': data['profile'], 'run_id': data.get('run_id'),
        'source': manifest.get('source'), 'model_entry': manifest.get('model', {}).get('entry'),
        'status': data['status'], 'reason': data.get('reason'), 'completed': data.get('completed'),
        'raw_exit': data.get('process', {}).get('exit_code'), 'timeout_seconds': profile.get('timeout_seconds'),
        'started_at': data.get('started_at'), 'finished_at': data.get('finished_at'),
        'duration_seconds': data.get('duration_seconds'), 'statistics': data.get('statistics'),
        'last_partial_progress': progress[-1] if progress else None, 'progress_history': progress,
        'maximum_logged_depth': max((row['depth'] for row in progress), default=None),
        'fingerprint_and_runtime': next((line for line in log if 'search Model-Checking with fp ' in line), None),
        'warnings': data.get('warning_codes'), 'errors': data.get('error_codes'),
        'message_codes': data.get('message_codes'), 'tool': data.get('tool'),
        'checks': data.get('checks'), 'parameters': data.get('scope', {}).get('parameters'),
        'command': data.get('command'), 'input_hashes': inputs,
        'all_input_hashes_verified': all(input_ok.values()),
        'evidence_hashes': {name: sha(path / name) for name in ['result.json', 'manifest.json', 'messages.json', 'tlc.log']},
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--runs', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    root = Path(args.runs).resolve()
    expectations = json.loads((HERE / 'expectations.json').read_text())
    all_runs = {str(file.parent.relative_to(root)): read_run(file.parent, root)
                for file in sorted(root.glob('*/*/result.json'))}
    if any(run['raw_exit'] is None for run in all_runs.values()):
        raise ValueError('A supplementary run is still active; do not freeze a partial index')
    selected = []
    for name, expected in expectations.items():
        key = OVERRIDES.get(name, 'matrix') + '/' + name
        if key not in all_runs:
            raise ValueError('No real selected run: ' + key)
        run = all_runs[key]
        kind = name.split('-', 1)[0]
        required = DEPS[kind] + [name + '.cfg']
        current = {f: sha(HERE / 'model' / f) == run['input_hashes'].get(f) for f in required}
        if not all(current.values()):
            raise ValueError('Selected run has stale transitive model/config inputs: ' + key)
        checks = run['checks']
        exact = (checks.get('configured_invariants') == expected['invariants']
                 and checks.get('expected_invariants') == expected['invariants']
                 and checks.get('configured_properties') == expected['properties']
                 and checks.get('expected_properties') == expected['properties']
                 and checks.get('checks_deadlock') is True)
        met = exact and run['status'] == expected['status'] and run['raw_exit'] == expected['raw_exit']
        messages = json.loads((root / key / 'messages.json').read_text())
        stats = run['statistics']
        if expected['raw_exit'] == 0:
            met = (met and run['completed'] is True and stats.get('remaining_states') == 0
                   and (stats.get('distinct_states') or 0) >= expected['minimum_distinct_states'])
        elif expected['raw_exit'] == 12:
            met = met and any(expected['target'] in message['text'] and 'violated' in message['text']
                              for message in messages)
        else:
            met = met and 2116 in (run['message_codes'] or []) and len(expected['properties']) == 1
        selected.append(dict(run, category=classify(name, expected), expected=expected,
                             checks_exact=exact, meets_expectation=bool(met),
                             current_model_dependencies_match=current))
    result = {
        'schema_version': 1, 'subject': 'GZ-SCENE-CUILAN-SELF-RESPONSE-001 / CS-R2 supplement S1',
        'mode': 'check/design', 'implementation_status': 'NOT_ASSESSED',
        'independent_supplement_review': 'NOT_RUN', 'run_root': str(root),
        'source_bindings': json.loads((HERE / 'source-bindings.json').read_text()),
        'selected_summary': {
            'profiles': len(selected), 'meets_expectation': sum(row['meets_expectation'] for row in selected),
            'statuses': dict(Counter(row['status'] for row in selected)),
            'categories': dict(Counter(row['category'] for row in selected)),
            'by_kind': dict(Counter(row['profile'].split('-', 1)[0] for row in selected)),
        },
        'historical_summary': {'runs': len(all_runs), 'statuses': dict(Counter(row['status'] for row in all_runs.values()))},
        'selected': selected, 'all_runs': list(all_runs.values()),
        'note': 'Only new supplementary profiles. Original 131/178/5-INCONCLUSIVE unchanged. '
                'Counterexamples of a negated reachability predicate are witnesses, not positive graph completion. '
                'Timeout statistics are null; logged progress is a lower bound. Selected runs require exact current transitive dependencies. '
                'The one 300s shared run is explicitly authorized; its original 60s run remains historical.',
    }
    Path(args.out).write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'selected': result['selected_summary'], 'history': result['historical_summary']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
