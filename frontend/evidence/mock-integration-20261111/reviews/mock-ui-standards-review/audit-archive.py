from pathlib import Path
import hashlib, json, re, subprocess
from urllib.parse import unquote

root = Path(__file__).resolve().parents[2]
out = Path(__file__).resolve().parent
archive = root / 'frontend/evidence/mock-recap-20261111'
head = 'b221ab89784b197431cf682b0c9036e46bb03932'
executed = '7e28d72fbdbfee88df6c5b709e519354b54820fd'
base = 'cf6f880f292d835f1644cd2e8f215fcf8aff512f'
sha = lambda data: hashlib.sha256(data).hexdigest()
git = lambda *args: subprocess.check_output(['git', *args], cwd=root)
manifest = json.loads((archive / 'manifest.json').read_text())
browser = json.loads((archive / 'browser/result.json').read_text())
checks = json.loads((archive / 'checks/result.json').read_text())
independent = json.loads((out / 'browser/result.json').read_text())
problems = []

artifact_results = []
original_results = []
for name, declared in manifest['artifacts'].items():
    data = (archive / name).read_bytes()
    ok = sha(data) == declared['sha256'] and len(data) == declared['bytes']
    artifact_results.append({'path': name, 'match': ok, 'sha256': sha(data), 'bytes': len(data)})
    if not ok: problems.append('归档摘要不符：' + name)
    parts = Path(name).parts
    original = None
    if parts[0] == 'tdd': original = root / '.agent-output/mock-ui' / parts[-1]
    elif parts[0] == 'checks': original = root / '.agent-output/mock-ui/frozen-checks' / parts[-1]
    elif parts[0] == 'browser': original = root / '.agent-output/mock-ui/browser-r5' / parts[-1]
    elif parts[0] == 'failures':
        folder = root / '.agent-output/mock-ui' / parts[1]
        original = folder / parts[-1]
        if not original.exists() and parts[-1] == 'stale-view.png':
            original = next((candidate for candidate in folder.glob('*.png') if sha(candidate.read_bytes()) == declared['sha256']), original)
    if original is not None:
        matches = original.exists() and original.read_bytes() == data
        original_results.append({'archive': name, 'original': str(original.relative_to(root)), 'exactBytes': matches})
        if not matches: problems.append('原始输出与归档不一致：' + name)

inputs = checks['inputs']
assert inputs == browser['source']['sourceHashes']
source_results = []
for name, declared in inputs.items():
    row = {'path': name, 'declared': declared}
    for label, data in [('worktree', (root / name).read_bytes()), ('executedCommit', git('show', executed + ':' + name)), ('reviewCommit', git('show', head + ':' + name))]:
        row[label] = sha(data) == declared
    row['independentBrowser'] = independent['source']['sourceHashes'].get(name) == declared
    if not all(row[key] for key in ['worktree', 'executedCommit', 'reviewCommit', 'independentBrowser']): problems.append('输入身份不符：' + name)
    source_results.append(row)

schema = json.loads((root / 'protocol/contracts.schema.json').read_text())
prior = json.loads(git('show', base + ':protocol/contracts.schema.json'))
unchanged = {name: definition == schema['$defs'].get(name) for name, definition in prior['$defs'].items()}
if not all(unchanged.values()): problems.append('既有定义发生变化')

failures = []
for name in ['browser-r1', 'browser-r2', 'browser-r3']:
    record = json.loads((archive / 'failures' / name / 'result.json').read_text())
    execution = json.loads((archive / 'failures' / name / 'execution.json').read_text())
    failures.append({'run': name, 'assessment': record['assessment'], 'exitCode': execution['exitCode'], 'source': {key: record['source'][key] for key in ['commit', 'tree', 'status']}, 'sourceFiles': len(record['source']['sourceHashes']), 'error': record['error'], 'resourcesClosed': record['resourcesClosed']})
    if record['assessment'] != 'FAIL' or execution['exitCode'] == 0: problems.append('失败历史被改写：' + name)

links = []
for name in ['backend/recap.md', 'frontend/README.md', 'protocol/README.md', 'frontend/evidence/mock-recap-20261111/README.md']:
    path = root / name
    for target in re.findall(r'\]\(([^)]+)\)', path.read_text()):
        if '://' in target or target.startswith('#'): continue
        destination = (path.parent / unquote(target.split('#')[0])).resolve()
        exists = destination.exists()
        links.append({'document': name, 'target': target, 'exists': exists})
        if not exists: problems.append('本地链接缺失：' + name + ' -> ' + target)

counts = {}
for name in ['backend', 'frontend', 'protocol']:
    log = (archive / 'checks' / (name + '.txt')).read_text()
    counts[name] = {key: int(re.findall(r'(?:ℹ |# )' + key + r' (\d+)', log)[-1]) for key in ['tests', 'pass', 'fail']}

diff = subprocess.run(['git', 'diff', '--check', base, head], cwd=root, capture_output=True, text=True)
source_diff = subprocess.run(['git', 'diff', '--check', base, head, '--', '.', ':!frontend/evidence/'], cwd=root, capture_output=True, text=True)
report = {
    'kind': 'source_inspection', 'status': 'OBSERVED', 'assessment': 'PASS' if not problems and source_diff.returncode == 0 else 'FAIL',
    'reviewHead': git('rev-parse', 'HEAD').decode().strip(), 'reviewTree': git('rev-parse', 'HEAD^{tree}').decode().strip(), 'worktreeStatus': git('status', '--short').decode().strip(),
    'executedCommit': executed, 'executedTree': git('rev-parse', executed + '^{tree}').decode().strip(), 'baseCommit': base,
    'artifactCount': len(artifact_results), 'artifacts': artifact_results,
    'originalOutputCount': len(original_results), 'originalOutputs': original_results,
    'sourceCount': len(source_results), 'sources': source_results,
    'unchangedPriorDefinitionCount': sum(unchanged.values()), 'unchangedPriorDefinitions': unchanged,
    'newDefinitions': sorted(set(schema['$defs']) - set(prior['$defs'])),
    'executionToArchiveChangedPaths': git('diff', '--name-only', executed, head).decode().splitlines(),
    'authorCounts': counts, 'authorBrowser': {'checks': sum(check.get('status') == 'PASS' for check in browser['checks']), 'screenshots': sum('screenshot' in check for check in browser['checks']), 'elapsedMs': browser['elapsedMs'], 'assessment': browser['assessment']},
    'independentBrowser': {'checks': sum(check.get('status') == 'PASS' for check in independent['checks']), 'screenshots': sum('screenshot' in check for check in independent['checks']), 'elapsedMs': independent['elapsedMs'], 'assessment': independent['assessment'], 'source': {key: independent['source'][key] for key in ['commit','tree','status']}, 'resourcesClosed': independent['resourcesClosed'], 'pageErrors': independent['pageErrors'], 'databaseErrors': independent['databaseErrors']},
    'failureHistory': failures, 'links': links,
    'diffCheckAll': {'exitCode': diff.returncode, 'output': diff.stdout + diff.stderr},
    'diffCheckExcludingRawEvidence': {'exitCode': source_diff.returncode, 'output': source_diff.stdout + source_diff.stderr},
    'sourceObligationReferencesRead': {'ref': 'c78066d9b95eb3657293fd26a6a5d8b325846b38', 'method': 'GitHub fetch_file 只读实际 README', 'blobs': {'isolation': 'a6bfec711187df18b2686318cc02606be09aba60', 'reconnect': '7cf13753d73c3f56348c3b57312cd6ea68a28aa8', 'visibility': 'b163a8e7fbddd0c9188b62b73cd60e11aa1a69c8'}},
    'problems': problems,
}
(out / 'archive-audit.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({key: report[key] for key in ['assessment','reviewHead','reviewTree','worktreeStatus','artifactCount','sourceCount','unchangedPriorDefinitionCount','newDefinitions','authorCounts','authorBrowser','independentBrowser','problems']}, ensure_ascii=False, indent=2))
raise SystemExit(0 if report['assessment'] == 'PASS' else 1)
