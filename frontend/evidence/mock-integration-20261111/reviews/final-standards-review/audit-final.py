"""独立核对本轮新合成执行归档；不读取任何需求轴报告，也不打开旧拒绝载荷。"""
from pathlib import Path
from collections import Counter, defaultdict
import datetime, gzip, hashlib, json, re, subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
BUNDLE = ROOT / '.agent-output/final-artifacts'
DOCS = ROOT / '.agent-output/final-docs'
CANDIDATE = 'fa87e221aa1e48cb19eeecc1beafcb83c0a7a21a'
TREE = '2d81686787d35d3a26747fbd7896ab1ec54c31ed'
report = {'kind': 'evidence_audit', 'reviewer': '/root/network_standards', 'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'candidate': CANDIDATE, 'tree': TREE, 'checks': [], 'notRead': []}
def read(path):
    assert 'requirements-review' not in str(path)
    return json.loads(Path(path).read_text())
def digest(data):
    return hashlib.sha256(data).hexdigest()
def check(name, ok, **detail):
    report['checks'].append({'name': name, 'assessment': 'PASS' if ok else 'FAIL', **detail})
def git(*args, cwd=ROOT):
    return subprocess.check_output(['git', *args], cwd=cwd, text=True).strip()

index = read(BUNDLE / 'artifact-index.json')
checked, skipped = [], []
for entry in index['files']:
    name = entry['path']
    if 'requirements-review' in name:
        skipped.append(name)
        continue
    data = (BUNDLE / name).read_bytes()
    checked.append({'path': name, 'sha256': digest(data), 'bytes': len(data), 'match': digest(data) == entry['sha256'] and len(data) == entry['bytes']})
check('归档索引实际字节', all(x['match'] for x in checked), indexed=len(index['files']), audited=len(checked), unreadOtherAxis=len(skipped), files=checked)
report['notRead'] = skipped
copies, skipped_copies = [], []
for entry in read(BUNDLE / 'archive-plan.json'):
    if 'requirements-review' in entry['source'] or 'requirements-review' in entry['archive']:
        skipped_copies.append(entry['archive'])
        continue
    original = Path(entry['source']).read_bytes()
    archived = (BUNDLE / entry['archive']).read_bytes()
    copies.append({'archive': entry['archive'], 'sha256': digest(archived), 'bytes': len(archived), 'match': original == archived and digest(archived) == entry['sha256'] and len(archived) == entry['bytes']})
check('原件原字节复制', all(x['match'] for x in copies), audited=len(copies), unreadOtherAxis=len(skipped_copies), files=copies)

source = read(BUNDLE / 'execution-source.json')
expected = source['localExecution']
executions = {
    'integration': read(BUNDLE / 'integration/result.json'),
    'network': read(ROOT / '.agent-output/mock-network-900/result.json'),
    'browser': read(BUNDLE / 'browser/result.json'),
    'independentIntegration': read(OUT / 'integration/result.json'),
}
inputs = expected['sourceHashes']
input_checks = {name: digest((ROOT / name).read_bytes()) == value for name, value in inputs.items()}
identities = {}
for name, result in executions.items():
    identity = result['source']
    identities[name] = {'commit': identity['commit'], 'tree': identity['tree'], 'status': identity['status'], 'inputs': len(identity['sourceHashes']), 'same': identity == expected, 'assessment': result['assessment'], 'resourcesClosed': result['resourcesClosed']}
check('四次执行同一固定输入', all(x['same'] and x['assessment'] == 'PASS' and x['resourcesClosed'] for x in identities.values()), identities=identities)
check('当前119摘要匹配执行输入', len(inputs) == 119 and all(input_checks.values()), count=len(inputs), mismatch=[k for k,v in input_checks.items() if not v])
tracked = []
for name in git('ls-tree', '-r', '--name-only', CANDIDATE, '--', 'backend', 'frontend', 'game', 'protocol', 'content', 'package.json', 'package-lock.json').splitlines():
    if '/evidence/' in name or not re.search(r'\.(?:mjs|mts|ts|vue|css|json|html|sql|py)$', name):
        continue
    original = subprocess.check_output(['git', 'show', CANDIDATE + ':' + name], cwd=ROOT)
    tracked.append({'path': name, 'match': (ROOT / name).read_bytes() == original, 'sha256': digest(original)})
check('冻结Git代码测试补充核对含mts和py', all(x['match'] for x in tracked), count=len(tracked), files=tracked)

groups = {}
for name, expected_count in [('backend',106),('protocol',23),('content',8),('frontend',53)]:
    meta = read(BUNDLE / 'checks' / (name + '.json'))
    text = (BUNDLE / 'checks' / (name + '.txt')).read_text()
    counts = {key: int(re.search(r'(?:ℹ|#) ' + key + r' (\d+)', text).group(1)) for key in ['tests','pass','fail','cancelled','skipped','todo']}
    groups[name] = {'command': meta['command'], 'sourceCommit': meta['sourceCommit'], 'sourceTree': meta['sourceTree'], 'exitCode': meta['exitCode'], **counts}
    assert counts['tests'] == expected_count
check('当前190测试原输出计数', sum(x['tests'] for x in groups.values()) == 190 and all(x['exitCode'] == 0 and x['sourceCommit'] == CANDIDATE and x['sourceTree'] == TREE and x['pass'] == x['tests'] and x['fail'] == x['cancelled'] == x['skipped'] == x['todo'] == 0 for x in groups.values()), groups=groups)
builds = {name: read(BUNDLE / 'checks' / (name + '.json')) for name in ['build','generated','schema']}
check('构建类型生成和Schema原命令', all(x['exitCode'] == 0 and x['sourceCommit'] == CANDIDATE and x['sourceTree'] == TREE for x in builds.values()), commands=builds)

long = executions['network']
summary = read(BUNDLE / 'network/summary.json')
projected = json.loads(json.dumps(long)); projected['traceIdentity'] = projected.pop('trace'); del projected['traceIdentity']['file']
summary_payload = {k:v for k,v in summary.items() if k not in ['archiveScope','sourceResultSha256']}
check('长测摘要字段与原件等值仅标注发布边界', summary_payload == projected and summary['sourceResultSha256'] == digest((ROOT / '.agent-output/mock-network-900/result.json').read_bytes()) and isinstance(summary['archiveScope'],str), sourceResultSha256=digest((ROOT / '.agent-output/mock-network-900/result.json').read_bytes()), transformation='trace改名traceIdentity并去file；增加archiveScope说明及sourceResultSha256，其余字段逐值不变。')
method = read(BUNDLE / 'network/archive-method.json')
trace_path = ROOT / '.agent-output/mock-network-900/trace.jsonl'
raw = trace_path.read_bytes(); compressed = trace_path.with_suffix('.jsonl.gz').read_bytes()
lines = raw.splitlines(keepends=True); rows = [json.loads(line) for line in lines]
chosen = b''.join(line for line,row in zip(lines,rows) if row['kind'] in method['selectedKinds'])
selected = (BUNDLE / 'network/assertions.jsonl').read_bytes()
check('新trace摘要及必要断言原行', digest(raw) == long['trace']['uncompressedSha256'] and digest(compressed) == long['trace']['sha256'] and gzip.decompress(compressed) == raw and len(rows) == long['trace']['records'] and len(raw) == long['trace']['bytes'] and chosen == selected and len(selected.splitlines()) == method['selectedRecords'] and method['sourceResultSha256'] == digest((ROOT / '.agent-output/mock-network-900/result.json').read_bytes()), records=len(rows), bytes=len(raw), selectedRecords=len(selected.splitlines()), selectedKindCounts=dict(Counter(json.loads(line)['kind'] for line in selected.splitlines())), compressedSha256=digest(compressed), rawSha256=digest(raw), selectedSha256=digest(selected))
checkpoints = [row for row in rows if row['kind'] == 'checkpoint']
check('同游标与持久前缀检查点', len(checkpoints) == len(long['checkpoints']) == 25 and all(len(c['comparisons']) == 5 and c['storedAtSameCursor'] and all(x['cursor'] == c['cursor'] for x in c['comparisons']) for c in checkpoints), count=len(checkpoints), comparisons=sum(len(c['comparisons']) for c in checkpoints), allStoredAtSameCursor=all(c['storedAtSameCursor'] for c in checkpoints), finalCursor=checkpoints[-1]['cursor'])
inbound_receipts = [row['value'] for row in rows if row['kind'] == 'inbound' and row.get('event') == 'player.action.request' and isinstance(row.get('value'),dict)]
windows = long['roleOpportunityWindows']
window_records = []
for w in windows:
    window_records.append({'window': w['window'], 'checkedAtMs': w['checkedAtMs'], 'roles': [c['role'] for c in w['choices']], 'match': w['fromMs'] <= w['checkedAtMs'] < w['fromMs'] + 120000 and sorted(c['role'] for c in w['choices']) == list('ABCDE') and all(c['receipt']['status'] == 'Accepted' and c['receipt'] in inbound_receipts for c in w['choices'])})
check('真实时长原期限与八职责窗口', long['actualDurationMs'] >= 900000 and long['requestedDurationMs'] == 900000 and [w['window'] for w in windows] == list(range(8)) and all(x['match'] for x in window_records) and long['environment']['clock'] == '默认 Date.now；未注入或快进时钟', actualDurationMs=long['actualDurationMs'], windows=window_records, finalPhase=long['final']['phase'], finalEvents=long['final']['eventCount'])
ack = next(c for c in long['cases'] if '原字节发送两次' in c['name'])
sends = [row for row in rows if row['kind'] == 'outbound' and row.get('event') == 'player.action.request' and json.loads(row['value']).get('clientActionId') == ack['actionId']]
check('实际31秒Grace与原字节重试', ack['proxyAfterMs'] >= 30000 and len(sends) == 2 and all(row['value'] == ack['raw'] for row in sends) and digest(ack['raw'].encode()) == ack['rawDigest'] and ack['effectCount'] == 1, proxyAfterMs=ack['proxyAfterMs'], sends=len(sends), effectCount=ack['effectCount'], rawDigest=ack['rawDigest'])
by_session = defaultdict(lambda: {'sent':set(),'accepted':set(),'rejected':set()})
for row in rows:
    if row['kind'] == 'outbound' and row.get('event') == 'player.action.request':
        v=json.loads(row['value']); by_session[v['sessionId']]['sent'].add(v['clientActionId'])
    if row['kind'] == 'inbound' and row.get('event') == 'player.action.request' and isinstance(row.get('value'),dict):
        v=row['value']
        if v.get('sessionId') and v.get('clientActionId'): by_session[v['sessionId']]['accepted' if v.get('status')=='Accepted' else 'rejected'].add(v['clientActionId'])
check('跨局与主局计数分别计算', True, kind='source_observation', perSession={k:{x:len(y) for x,y in v.items()} for k,v in by_session.items()}, mainSession=long['sessionId'], aggregateReportCounts=long['final']['counts'])

for name in ['integration','independentIntegration']:
    result = executions[name]; cases=result['cases']; actions={a['actionId']:a for a in result['actions']}; contribution_counts=Counter(c['role'] for c in result['contributions'])
    natural=[c for c in cases if 'material' in c]
    valid_contributions=all(c['actionId'] in actions and actions[c['actionId']]['receipt']['status']=='Accepted' and c['downstream'] and all('actionId' not in d or d['actionId'] in actions for d in c['downstream']) for c in result['contributions'])
    joint=next(c for c in cases if '旧AI迟到联合' in c['name'])
    check(name+'完整局因果与联合故障', result['assessment']=='PASS' and len(cases)==7 and len(natural)==3 and len(result['contributions'])==10 and contribution_counts==Counter(dict.fromkeys('ABCDE',2)) and valid_contributions and joint['sends']==2 and joint['effects']==1 and joint['oldIntentCode']=='DECISION_STALE' and result['sourceUnchanged'], elapsedMs=result['actualElapsedMs'], contributions=dict(contribution_counts), natural=[{k:c[k] for k in ['players','endingCode','material','completeEvidence','events','aiDecisions','clock']} for c in natural], deadline=[{k:c[k] for k in ['endingCode','clock']} for c in cases if c.get('endingCode')=='unresolved'], joint=joint)
browser=executions['browser']
browser_assertions=[x for x in browser['checks'] if 'status' in x]; screenshots=[x for x in browser['checks'] if 'screenshot' in x]
check('本候选浏览器真实结果', browser['assessment']=='PASS' and len(browser_assertions)==15 and all(x['status']=='PASS' for x in browser_assertions) and len(screenshots)==2 and all(digest((BUNDLE/'browser'/x['screenshot']).read_bytes())==x['sha256'] for x in screenshots) and not browser['pageErrors'] and not browser['databaseErrors'] and browser['resourcesClosed'], assertions=len(browser_assertions), screenshots=len(screenshots), elapsedMs=browser['elapsedMs'], chromium=browser['browserVersion'], node=browser['nodeVersion'], postgres=browser['postgresVersion'], imageHashes={name:digest((BUNDLE/'browser'/name).read_bytes()) for name in ['recap-desktop.png','recap-mobile.png']})
failure=read(BUNDLE/'failures/integration-r1/result.json')
failure_command=read(BUNDLE/'failures/integration-r1/execution.json')
old_inputs=failure['source']['sourceHashes']; original_commit=failure['source']['commit']
history_matches={name:digest(subprocess.check_output(['git','show',original_commit+':'+name],cwd=ROOT))==value for name,value in old_inputs.items()}
check('失败保留原候选输入与exit1', failure['assessment']=='FAIL' and failure_command['exitCode']==1 and all(history_matches.values()), source={k:v for k,v in failure['source'].items() if k!='sourceHashes'}, inputs=len(history_matches), mismatches=[k for k,v in history_matches.items() if not v], elapsedMs=failure['actualElapsedMs'], error=failure['error'])

ai=read(ROOT.parent/'xiyou-mock-ai/.agent-output/mock-ai-standards-review/targeted.execution.json')['sourceBefore']
ui=read(ROOT.parent/'xiyou-mock-ui/.agent-output/mock-ui-standards-review/browser/result.json')['source']['sourceHashes']
changes={label:[name for name,value in h.items() if digest((ROOT/name).read_bytes())!=value] for label,h in [('mockAI',ai),('recapUI',ui)]}
check('组件继承的精确差异', changes['mockAI']==['backend/runtime.mjs','backend/server.mjs','protocol/README.md','protocol/contracts.schema.json','protocol/fixtures/valid-v1.json','protocol/index.mjs','protocol/schema.mjs'] and changes['recapUI']==['frontend/tests/network-acceptance.mjs','package.json'], mockAIInputs=len(ai), recapUIInputs=len(ui), differences=changes, interpretation='AI的7项为已审新增独立recap入口/DTO/说明；UI的2项为新增mock命令及当前长测。当前106后端/23协议/53前端/8内容与整局浏览器另有本候选执行。')
core=git('rev-parse',CANDIDATE+':formal/core-rebuild'); previous_core=git('rev-parse','d7088ac7c58334454a3f0de8835b49d1e6be245c:formal/core-rebuild')
check('新核心模型及完整证据树不变', core==previous_core=='d0931a2d91b27f2276f95b4f58cd3d0525082cf0', currentTree=core, reviewedCandidate='d7088ac7c58334454a3f0de8835b49d1e6be245c', reviewedTree=previous_core, execution='本审查未重跑TLC。')
remote=read(OUT/'remote-tree-check.json')
boundary=git('rev-parse',CANDIDATE+':formal/boundary')
remote_boundary=next(x for x in remote['inheritedBoundaryFormal']['tree'] if x['path']=='boundary')['sha']
check('GitHub原始GitData身份与边界树', remote['publication']['tree']['sha']==TREE and remote['publication']['parents'][0]['sha']=='10fd0f93b069446d34b08fcddb171d98ee4c50a3' and boundary==remote_boundary, remoteCommit=remote['publication']['sha'], remoteTree=remote['publication']['tree']['sha'], boundaryCandidate=remote['inheritedBoundaryCommit']['sha'], boundaryTree=boundary)

projected_root=ROOT/'frontend/evidence/mock-integration-20261111'
def projected_exists(path):
    try:
        relative=path.relative_to(projected_root)
        return (BUNDLE/relative).exists()
    except ValueError:
        try:
            relative=path.relative_to(ROOT)
            if (DOCS/relative).exists(): return True
        except ValueError: pass
        return path.exists()
links=[]
documents=[(BUNDLE/'README.md',projected_root/'README.md')]+[(p,ROOT/p.relative_to(DOCS)) for p in DOCS.rglob('*.md')]
for physical,logical in documents:
    for target in re.findall(r'\[[^\]]*\]\(([^)]+)\)',physical.read_text()):
        if re.match(r'[a-z]+:',target): continue
        bare=target.split('#')[0]
        path=(logical.parent/bare).resolve() if bare else logical
        links.append({'from':str(logical.relative_to(ROOT)), 'target':target, 'exists':projected_exists(path)})
check('正式位置文档相对目标',all(x['exists'] for x in links),count=len(links),links=links)
doc_hashes={str(p.relative_to(DOCS)):digest(p.read_bytes()) for p in DOCS.rglob('*.md')}
report['documentCandidates']=doc_hashes
report['bundleIndexSha256']=digest((BUNDLE/'artifact-index.json').read_bytes())
report['bundleReadmeSha256']=digest((BUNDLE/'README.md').read_bytes())
report['matrixSha256']=digest((BUNDLE/'acceptance-matrix.json').read_bytes())
report['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
report['assessment']='PASS' if all(c['assessment']=='PASS' for c in report['checks']) else 'FAIL'
(OUT/'archive-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'assessment':report['assessment'],'checks':len(report['checks']),'failures':[c['name'] for c in report['checks'] if c['assessment']!='PASS'],'indexAudited':len(checked),'otherAxisUnread':len(skipped)},ensure_ascii=False))
