from pathlib import Path
from collections import Counter
import datetime, hashlib, json, math, re, shutil, subprocess

root = Path.cwd()
temporary = root / '.agent-output/ai'
target = root / 'backend/evidence/ai'
for name in ['raw', 'captures', 'tooling']:
    (target / name).mkdir(parents=True, exist_ok=True)
source_commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
source_tree = subprocess.check_output(['git', 'rev-parse', 'HEAD^{tree}'], text=True).strip()
def save(name, value):
    (target / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
for path in sorted(temporary.iterdir()):
    if path.suffix in ['.log', '.json']:
        shutil.copyfile(path, target / 'raw' / path.name)
for path in sorted((temporary / 'captures').glob('*.json')):
    shutil.copyfile(path, target / 'captures' / path.name)
for name in ['run-check.py', 'check-static.py']:
    shutil.copyfile(temporary / name, target / 'tooling' / name)

started = datetime.datetime.fromisoformat(json.loads((temporary / 'final-backend.json').read_text())['startedAt']).timestamp()
clusters = []
for path in sorted((root / '.agent-output/postgres-tests').glob('*/postgres.log')):
    if path.parent.stat().st_ctime >= started - 1:
        name = 'postgres-' + path.parent.name + '.log'
        shutil.copyfile(path, target / 'raw' / name)
        text = path.read_text()
        clusters.append({'label': path.parent.name, 'raw': 'raw/' + name, 'shutdownObserved': 'database system is shut down' in text, 'postgresVersion': re.search(r'starting PostgreSQL ([^ ]+)', text).group(1)})
assert len(clusters) == 8 and all(c['shutdownObserved'] for c in clusters)
save('process-lifecycle.json', {'finalBackend': {'exitCode': 0, 'signal': None}, 'ownedFinalClusters': clusters, 'pendingExecHandles': [], 'interruptedEarlierCheck': {'check': 'context-current-02', 'toolSessionId': 28125, 'toolExitCode': 130, 'signal': '未捕获', 'reason': '测试屏障误用 kind 而非 command，手动中止后修正；不是产品失败或通过', 'oldPortProbe': {'port': 41725, 'connectResult': 111, 'meaning': '连接拒绝'}, 'shutdownLogAvailable': False}, '说明': '所有最终检查执行句柄已读回结束；崩溃子进程的实际退出码及空信号另见 captures/crash.json。'})

all_runs = []; counters = Counter()
for path in sorted((target / 'captures').glob('*.json')):
    value = json.loads(path.read_text()); all_runs += value['runs']
    assert value['sourceCommit'] == source_commit
    for gateway in value.get('gateways', []):
        counters.update({key: gateway['metrics'][key] for key in ['calls', 'externalCalls', 'valid', 'invalid', 'timeouts', 'cancelled', 'providerErrors']})
    if 'exits' in value:
        for child in value['exits']:
            counters.update({key: child['metricsAtProviderEntry'][key] for key in ['calls', 'externalCalls']})
        for run in value['runs']:
            counters.update({{'Valid': 'valid', 'Invalid': 'invalid', 'Timeout': 'timeouts', 'Cancelled': 'cancelled', 'ProviderError': 'providerErrors'}[run['model_result']['status']]: 1})
latencies = sorted(run['model_result']['durationMs'] for run in all_runs if run['model_result'] and 'durationMs' in run['model_result'])
metrics = {'scope': '最终真实 PostgreSQL／HTTP／Socket.IO 及子进程检查中的受控供应商；不含独立 Gateway 单元检查', 'counters': dict(counters), 'latencySampleCount': len(latencies), 'p50Ms': latencies[math.ceil(len(latencies) * .5) - 1], 'p95Ms': latencies[math.ceil(len(latencies) * .95) - 1], 'invalidFormatRate': counters['invalid'] / counters['calls'], 'originalReceipts': dict(Counter(run['outcome']['receipt']['status'] for run in all_runs if run['outcome'] and run['outcome'].get('receipt'))), 'runStatuses': dict(Counter(run['status'] for run in all_runs)), 'latencyBoundary': '38 次受控调用有 37 条持久耗时样本；1 次调用在成员撤权后不能写入新结果元数据，取消仍由 Gateway 指标观测。分位数仅对这 37 条计算，不当作真实模型表现或 SLO。', 'actualModel': {'status': 'BLOCKED', 'execution': 'NOT_RUN', 'externalCalls': 0, 'provider': None, 'endpoint': None, 'modelId': None, 'credentials': '未提供', 'spendingAuthorization': '未提供'}}
save('metrics.json', metrics)

names = subprocess.check_output(['git', 'ls-files'], text=True).splitlines()
files = []
for name in names:
    source = Path(name)
    included = name.startswith(('backend/', 'game/', 'protocol/', 'content/')) and not name.startswith('backend/evidence/')
    included |= name in ['package.json', 'package-lock.json', 'AGENTS.md', 'docs/engineering.md', 'docs/agents/workflow.md', 'docs/agents/doc-layout.md', '.agents/skills/worker-implement/SKILL.md', '.agents/skills/worker-implement/references/execution-rules.md']
    included |= name.startswith('docs/specs/') and source.suffix == '.md'
    if included and source.is_file():
        files.append({'path': name, 'sha256': hashlib.sha256(source.read_bytes()).hexdigest()})
files.sort(key=lambda row: row['path'])
aggregate = hashlib.sha256(''.join(row['path'] + ' ' + row['sha256'] + '\n' for row in files).encode()).hexdigest()
external = []
for name in ['visibility', 'fallback']:
    source = Path('/workspace/scratch/f9401eff266e/.agent-output/boundary-fix/worktree/formal/boundary') / name / 'README.md'
    external.append({'commit': '2a23c6ea31ea04dee9271612afe9c4248e93efb9', 'path': f'formal/boundary/{name}/README.md', 'sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'relation': '总控已释放的只读实施义务；未复制原始模型日志'})
save('source-manifest.json', {'sourceCommit': source_commit, 'sourceTree': source_tree, 'aggregateAlgorithm': '按 path 排序；每行 path + 空格 + sha256 + 换行 的 UTF-8 SHA-256', 'aggregateSha256': aggregate, 'files': files, 'externalInputs': external})

checks = []
for name, count in [('backend', 82), ('protocol', 21), ('content', 8), ('static', None)]:
    value = json.loads((target / 'raw' / f'final-{name}.json').read_text())
    assert value['exitCode'] == 0 and value['signal'] is None
    for filename, sha in value['sourceInputs'].items():
        assert hashlib.sha256(Path(filename).read_bytes()).hexdigest() == sha
    checks.append({'name': name, 'status': 'PASS', 'count': count, 'exitCode': 0, 'signal': None, 'command': value['command'], 'startedAt': value['startedAt'], 'durationSeconds': value['durationSeconds'], 'raw': f'raw/final-{name}.log', 'execution': f'raw/final-{name}.json'})
issue = next(issue for issue in json.loads(Path('/workspace/scratch/f9401eff266e/xiyou/.agent-output/auto/issue-snapshot.json').read_text()) if issue['number'] == 9)
save('ticket-input.json', {key: issue[key] for key in ['number', 'title', 'body', 'html_url', 'updated_at']})
save('self-check.json', {'workId': 'vs001-p06', 'ticket': 'https://github.com/gbcdby/xiyou/issues/9', 'specRevision': '6c2a0b9f6d137ad5fbd41721659404333ad8e16d', 'runtimeBase': '5d3e16fa46c4719471092d0567e9bfd1e28737f7', 'sourceCommit': source_commit, 'sourceTree': source_tree, 'sourceAggregateSha256': aggregate, 'authorOutcome': 'COMPLETE_CONTROLLED_SCOPE', 'ticketCompletion': 'BLOCKED_REAL_MODEL', 'singleAiRuntime': 'NOT_RELEASED', 'ver04': 'PARTIAL_CONTROLLED_ONLY', 'requirementsReview': 'NOT_RUN', 'standardsReview': 'NOT_RUN', 'actualExternalModelCalls': 0, 'environment': {'node': '24.22.1', 'postgresql': '18.6', 'pg': '8.23.1', 'socketIo': '4.8.4', 'embeddedPostgres': '18.6.0-beta.19'}, 'checks': checks, 'metrics': 'metrics.json', 'lifecycle': 'process-lifecycle.json', 'rawEvidence': 'raw/', 'controlledInputsAndResults': ['captures/network.json', 'captures/orchestrator.json', 'captures/crash.json'], 'legacyEvidence': {'e32c579': '保持原身份和原字节', 'review-fix-r1': '保持 5d3 基线原身份和原字节；本次 82 项包含原 38 项回归'}, 'limitations': ['实际供应商、endpoint、模型标识、凭据与费用授权均缺失；真实模型未运行', '受控函数只证明接口和围栏，不证明自然语言真实性、人物表现或实际模型质量', '不是独立需求／标准审查；未自行把任何 finding 标成 VERIFIED', '#10 双 NPC 策略、#11 完整局、#8 浏览器联调与 900 秒、真人验收未执行', '未推送、创建 PR、合并或部署；未上传受阻 formal/core 原始材料']})
print(json.dumps({'sourceCommit': source_commit, 'sourceTree': source_tree, 'sourceFiles': len(files), 'aggregateSha256': aggregate, 'metrics': metrics, 'finalClusters': len(clusters)}, ensure_ascii=False, indent=2))
