#!/usr/bin/env python3
"""只读核验固定归档、原始状态、输入快照和预声明目标；不启动 TLC 或项目测试。"""
import hashlib
import json
from pathlib import Path
import tarfile


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    package = Path(__file__).resolve().parent
    index = json.loads((package / 'results.json').read_text())
    manifest_bytes = (package / 'verification.json').read_bytes()
    manifest = json.loads(manifest_bytes)
    expectations = json.loads((package / 'expectations.json').read_text())
    artifact_manifest = json.loads((package / 'artifact-manifest.json').read_text())
    for item in artifact_manifest['files']:
        data = (package / item['path']).read_bytes()
        assert len(data) == item['bytes'] and sha(data) == item['sha256'], item['path']
    counts = {'positive': 0, 'negative-control': 0, 'witness': 0}
    covered, sensitive = set(), set()
    for archive_key, rows in [('final', index['runs']), ('history', index['history']['runs'])]:
        artifact = index['archives'][archive_key]
        data = (package / artifact['path']).read_bytes()
        assert len(data) == artifact['bytes'] and sha(data) == artifact['sha256']
        with tarfile.open(package / artifact['path']) as archive:
            if archive_key == 'final':
                assert sha(archive.extractfile('tool/run_tlc.py').read()) == index['tool']['runner_sha256']
            for row in rows:
                raw = {}
                for name, identity in row['raw'].items():
                    data = archive.extractfile(identity['path']).read()
                    assert len(data) == identity['bytes'] and sha(data) == identity['sha256']
                    raw[name] = data
                actual = json.loads(raw['result.json'])
                assert actual['status'] == row['status']
                assert actual['process'] == row['process']
                assert actual['statistics'] == row['statistics']
                assert actual['implementation_status'] == 'NOT_ASSESSED'
                assert actual['inputs']['manifest_sha256'] == sha(raw['manifest.json'])
                for item in actual['inputs']['files']:
                    snapshot = archive.extractfile(row['input_snapshot'] + '/' + item['path']).read()
                    assert sha(snapshot) == item['sha256'] and len(snapshot) == item['bytes']
                    if archive_key == 'final':
                        assert sha((package / 'model' / item['path']).read_bytes()) == item['sha256']
                if archive_key != 'final':
                    continue
                expectation = expectations[row['profile']]
                config = manifest['profiles'][row['profile']]
                messages = json.loads(raw['messages.json'])
                assert actual['profile'] == row['profile']
                assert actual['status'] == expectation['expected']
                assert actual['inputs']['manifest_sha256'] == sha(manifest_bytes)
                assert actual['inputs']['runner_sha256'] == index['tool']['runner_sha256']
                assert actual['tool']['sha256'] == index['tool']['sha256']
                assert actual['checks']['configured_invariants'] == config['expected_invariants'] == expectation['invariants']
                assert actual['checks']['configured_properties'] == []
                assert actual['checks']['checks_deadlock'] is False
                assert not actual['process']['timed_out'] and not actual['process']['interrupted']
                assert actual['statistics']['distinct_states'] >= expectation['minimum_distinct_states']
                if row['kind'] == 'positive':
                    assert actual['process']['exit_code'] == 0 and actual['completed']
                    assert actual['statistics']['remaining_states'] == 0
                    assert not any(m['code'] == 2110 for m in messages)
                    covered.update(expectation['invariants'])
                else:
                    assert actual['process']['exit_code'] == 12
                    assert len(expectation['invariants']) == 1
                    target = expectation['invariants'][0]
                    hits = [m['text'].strip() for m in messages if m['code'] == 2110]
                    assert hits == [f'Invariant {target} is violated.']
                    if row['kind'] == 'negative-control':
                        sensitive.add(target)
                counts[row['kind']] += 1
    assert counts == index['counts']
    assert len(index['history']['runs']) == 43
    assert covered == sensitive and len(covered) == 18
    assert set(expectations) == set(manifest['profiles']) == {r['profile'] for r in index['runs']}
    print(json.dumps({'归档核验': 'PASS', '正式记录': counts, '历史原件': 43,
                      '已启用且有具名负控的性质': len(covered), '源码对应': 'NOT_ASSESSED',
                      '新TLC运行': False}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
