"""独立标准轴：仅执行冻结候选已有完整局脚本，保留执行身份及源码摘要。"""
from pathlib import Path
import datetime, hashlib, json, os, subprocess, time

root = Path(__file__).resolve().parents[2]
out = Path(__file__).resolve().parent
expected = json.loads((root / '.agent-output/mock-integration-r2/result.json').read_text())['source']
def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()
def git(*args):
    return subprocess.check_output(['git', *args], cwd=root, text=True).strip()
def hashes():
    return {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in expected['sourceHashes']}
before = {'commit': git('rev-parse', 'HEAD'), 'tree': git('rev-parse', 'HEAD^{tree}'), 'status': git('status', '--short'), 'sourceHashes': hashes()}
assert before == expected
env = os.environ.copy()
env['MOCK_EVIDENCE_DIR'] = str(out / 'integration')
command = ['node', 'frontend/tests/mock-integration.mjs']
record = {'kind': 'runtime_execution', 'reviewer': '/root/network_standards', 'command': command, 'cwd': str(root), 'environmentOverrides': {'MOCK_EVIDENCE_DIR': env['MOCK_EVIDENCE_DIR']}, 'startedAt': utc(), 'sourceBefore': before}
start = time.monotonic()
with (out / 'integration.txt').open('w') as log:
    run = subprocess.run(command, cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT)
record.update({'finishedAt': utc(), 'elapsedMs': (time.monotonic() - start) * 1000, 'exitCode': run.returncode, 'sourceAfter': {'commit': git('rev-parse', 'HEAD'), 'tree': git('rev-parse', 'HEAD^{tree}'), 'status': git('status', '--short'), 'sourceHashes': hashes()}})
record['sourceUnchanged'] = record['sourceBefore']['sourceHashes'] == record['sourceAfter']['sourceHashes']
record['logSha256'] = hashlib.sha256((out / 'integration.txt').read_bytes()).hexdigest()
(out / 'integration.execution.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({k: record[k] for k in ['startedAt', 'finishedAt', 'elapsedMs', 'exitCode', 'sourceUnchanged']}, ensure_ascii=False))
raise SystemExit(run.returncode if record['sourceUnchanged'] else 1)
