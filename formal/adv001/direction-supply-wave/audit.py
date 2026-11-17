#!/usr/bin/env python3
"""只读核验本包归档、输入身份与目标反例；不启动 TLC 或项目测试。"""
import hashlib
import json
from pathlib import Path
import tarfile


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    package = Path(__file__).resolve().parent
    result = json.loads((package / 'results.json').read_text())
    inputs = json.loads((package / 'inputs.json').read_text())
    for artifact in [result['artifact'], result['exploration']['artifact'], inputs['archive']]:
        data = (package / artifact['path']).read_bytes()
        assert len(data) == artifact['bytes'] and sha(data) == artifact['sha256'], artifact['path']
    with tarfile.open(package / inputs['archive']['path']) as design:
        for item in inputs['design_inputs']:
            assert sha(design.extractfile('inputs/' + item['name']).read()) == item['sha256']
    count = {'positive': 0, 'negative-control': 0, 'witness': 0}
    covered, sensitive = set(), set()
    with tarfile.open(package / result['artifact']['path']) as archive:
        assert sha(archive.extractfile('tool/run_tlc.py').read()) == result['tool']['runner_sha256']
        for row in result['runs']:
            prefix = 'witness-' if row['group'] == 'witness' else ''
            manifest_bytes = (package / f'{prefix}verification.json').read_bytes()
            manifest = json.loads(manifest_bytes)
            expectation = json.loads((package / f'{prefix}expectations.json').read_text())[row['profile']]
            config = manifest['profiles'][row['profile']]
            raw = {}
            for name, identity in row['raw'].items():
                data = archive.extractfile(identity['path']).read()
                assert sha(data) == identity['sha256'] and len(data) == identity['bytes']
                raw[name] = data
            actual = json.loads(raw['result.json'])
            messages = json.loads(raw['messages.json'])
            assert actual['profile'] == row['profile']
            assert actual['status'] == expectation['expected_status']
            assert actual['implementation_status'] == 'NOT_ASSESSED'
            assert actual['process']['exit_code'] == expectation['expected_tlc_exit']
            assert not actual['process']['timed_out'] and not actual['process']['interrupted']
            assert actual['statistics']['distinct_states'] >= expectation['minimum_distinct_states']
            assert actual['checks']['configured_invariants'] == config['expected_invariants']
            assert actual['checks']['configured_properties'] == []
            assert actual['checks']['checks_deadlock'] is False
            assert actual['inputs']['manifest_sha256'] == sha(manifest_bytes) == sha(raw['manifest.json'])
            assert actual['inputs']['runner_sha256'] == result['tool']['runner_sha256']
            assert actual['tool']['sha256'] == result['tool']['sha256']
            for item in actual['inputs']['files']:
                snapshot = archive.extractfile(row['input_snapshot'] + '/' + item['path']).read()
                assert sha(snapshot) == item['sha256']
                assert sha((package / 'model' / item['path']).read_bytes()) == item['sha256']
            if expectation['target']:
                assert any(message['code'] == 2110 and message['text'].strip()
                           == f"Invariant {expectation['target']} is violated." for message in messages)
                if expectation['kind'] == 'negative-control':
                    sensitive.add(expectation['target'])
            else:
                assert actual['completed'] and actual['statistics']['remaining_states'] == 0
                covered.update(actual['checks']['configured_invariants'])
            count[expectation['kind']] += 1
    assert count == result['counts']
    assert covered == sensitive, sorted(covered - sensitive)
    print(json.dumps({'归档核验': 'PASS', '正式记录': count, '已启用且有目标负控的性质数': len(covered),
                      '源码对应': 'NOT_ASSESSED', '新TLC运行': False}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
