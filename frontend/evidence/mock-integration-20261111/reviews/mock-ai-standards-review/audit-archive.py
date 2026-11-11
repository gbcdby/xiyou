from pathlib import Path
import hashlib, json, re, subprocess

root = Path(__file__).resolve().parents[2]
out = Path(__file__).resolve().parent
archive = root / 'backend/evidence/mock-ai-20261111'
original = root / '.agent-output/mock-ai'
base = 'cf6f880f292d835f1644cd2e8f215fcf8aff512f'
implementation = '71aad48878c532521919c72511c023285785d7e7'
head = 'ce57d0f172b5a447cf16069ed1255fd009ecc931'
prior = 'c2511f4a81d29502aed4c122cd701d3c3632d237'
sha = lambda data: hashlib.sha256(data).hexdigest()
git = lambda *args: subprocess.check_output(['git', *args], cwd=root)
read = lambda path: json.loads(path.read_text())
problems = []
manifest = read(archive / 'source-manifest.json')
window = read(archive / 'window.json')
raw_window = read(original / 'real-window.json')

inputs = []
for name, declared in manifest['checkedBytes'].items():
    checks = {label: sha(data) == declared for label, data in [
        ('implementation', git('show', implementation + ':' + name)),
        ('archiveCommit', git('show', head + ':' + name)),
        ('worktree', (root / name).read_bytes()),
    ]}
    inputs.append({'path': name, 'sha256': declared, **checks})
    if not all(checks.values()): problems.append('输入不符：' + name)

window_inputs = raw_window['sourceBefore']
window_sources_match = (window_inputs == raw_window['sourceAfter'] and
    all(manifest['checkedBytes'].get(name) == value for name, value in window_inputs.items()))
window_summary_match = window == {key: value for key, value in raw_window.items() if key not in ['sourceBefore', 'sourceAfter']}
if not window_sources_match or not window_summary_match: problems.append('60秒窗口来源或摘要不符')

raw_pairs = {
    'targeted-green.txt': 'fix-green/command.log', 'targeted-red.txt': 'fix-red/command.log',
    'backend.txt': 'backend-final.log', 'budget-original.txt': 'priority-original/command.log',
    'window-command.txt': 'real-window-command.log', 'process.txt': 'mock-process.log',
    'probes/budget-original.test.mjs.txt': 'priority-original/budget-original.test.mjs',
    'probes/priority-sequence.mjs.txt': 'fix-probes/priority-probe.mjs',
    'probes/route-sequence.mjs.txt': 'fix-probes/route-replay-probe.mjs',
}
copies = []
for dest, source in raw_pairs.items():
    exact = (archive / dest).read_bytes() == (original / source).read_bytes()
    copies.append({'archive': dest, 'original': str((original / source).relative_to(root)), 'exactBytes': exact})
    if not exact: problems.append('原字节不符：' + dest)

policy = read(archive / 'policy-witnesses.json')
raw_policy = read(original / 'fix-green/policy-evidence.json')
policy_matches = []
for witness in policy['proposals']:
    source = next(item for item in raw_policy['proposals'] if item['decisionId'] == witness['decisionId'])
    projected = {key: source[key] for key in witness}
    projected['tools'] = [tool['kind'] for tool in source['tools']]
    policy_matches.append(projected == witness)
if not all(policy_matches): problems.append('策略见证摘取不符')
assert policy['observedProposalCount'] == len(raw_policy['proposals'])
assert policy['waitProposalCount'] == sum(len(item['tools']) == 1 and item['tools'][0]['kind'] == 'wait' for item in raw_policy['proposals'])

progress = read(archive / 'progress-after.json')
raw_progress = read(original / 'fix-green/progress-evidence.json')
progress_summary_keys = ['status','clock','maxCallsPerSession','totalCalls','callsAtRoute','callsAfterRoute','phase','ending','npcRegions','elapsedMs','resourcesClosed']
progress_summary_match = all(progress[key] == raw_progress[key] for key in progress_summary_keys)
progress_decisions_match = True
for witness in progress['decisions']:
    source = next(item for item in raw_progress['steps'] if item['decisionId'] == witness['decisionId'])
    expected = {key: source[key] for key in ['actorId','decisionId','contextDigest','outputDigest','receivedRoute']}
    expected['tools'] = [tool['kind'] for tool in source['tools']]
    expected['receipt'] = {'status': source['receipt']['status'], 'code': source['receipt']['code'], 'range': source['receipt']['actionEventRange']}
    progress_decisions_match &= expected == witness
if not progress_summary_match or not progress_decisions_match: problems.append('推进摘要摘取不符')

budget = read(archive / 'budget-before.json')
raw_budget = read(original / 'priority-original/full-budget-evidence.json')
budget_checks = {
    'statusRemainsFail': budget['status'] == 'FAIL',
    'oldProviderMatches': sha(git('show', prior + ':backend/ai/mock-provider.mjs')) == budget['subject']['providerSha256'],
    'originalProbeMatches': sha((archive / 'probes/budget-original.test.mjs.txt').read_bytes()) == budget['subject']['probeSha256'],
    'callsPreserved': budget['totalCalls'] == 120 and budget['callsAfterRoute'] == 108 and budget['routeAwareShares'] == 104,
    'timeoutDisclosed': '120000ms' in budget['runnerBoundary'] and 'cancelled' in budget['runnerBoundary'],
    'originalOutcomeAndCountsMatch': all(budget[key] == raw_budget[key] for key in ['status','clock','maxCallsPerSession','callsAtRoute','totalCalls','callsAfterRoute','routeAwareShares','phase','npcRegions','failure','elapsedMs','resourcesClosed','routeReceipt']),
    'originalDecisionCountMatches': budget['observedDecisionCount'] == len(raw_budget['steps']),
}
if not all(budget_checks.values()): problems.append('旧预算失败身份或边界不符')

sequence = read(archive / 'review-sequences-after.json')
priority_raw = read(original / 'fix-probes/priority-probe.json')
route_raw = read(original / 'fix-probes/route-replay-probe.json')
sequence_checks = {
    'priorityScript': sha((archive / 'probes/priority-sequence.mjs.txt').read_bytes()) == sequence['priority']['inputScriptSha256'],
    'routeScript': sha((archive / 'probes/route-sequence.mjs.txt').read_bytes()) == sequence['route']['inputScriptSha256'],
    'priorityCountsAndOutcome': all(sequence['priority'][key] == priority_raw[key] for key in ['status','schedulingIntervalMs','maxCallsPerSession','totalCalls','final']),
    'routeCountsAndOutcome': sequence['route']['decisions'] == len(route_raw['decisions']) and all(sequence['route'][key] == route_raw[key] for key in ['status','moves','final','replayedWithoutNewInput']),
}
if not all(sequence_checks.values()): problems.append('作者序列摘要与原输入/结果不符')

protected = ['backend/ai/context.mjs','backend/ai/gateway.mjs','backend/ai/orchestrator.mjs','backend/ai/persistence.mjs','backend/ai/output.mjs','backend/runtime.mjs','backend/decisions.mjs','backend/server.mjs','backend/main.mjs','game','protocol','content','backend/migrations','package-lock.json']
unchanged = {name: git('rev-parse', base + ':' + name) == git('rev-parse', implementation + ':' + name) for name in protected}
if not all(unchanged.values()): problems.append('继承运行或权限输入变化')

links = []
for name in ['backend/ai/mock.md','backend/ai/README.md','backend/evidence/mock-ai-20261111/README.md']:
    file = root / name
    for target in re.findall(r'\]\(([^)]+)\)', file.read_text()):
        if '://' in target or target.startswith('#'): continue
        exists = (file.parent / target.split('#')[0]).resolve().exists()
        links.append({'document': name, 'target': target, 'exists': exists})
        if not exists: problems.append('相对链接缺失：' + name + ' -> ' + target)

counts = {}
for name in ['targeted-red','targeted-green','backend','budget-original']:
    content = (archive / (name + '.txt')).read_text()
    counts[name] = {key: int(re.findall(r'(?:ℹ |# )' + key + r' (\d+)', content)[-1]) for key in ['tests','pass','fail','cancelled']}

delta_before = json.loads(git('show', implementation + ':backend/evidence/mock-ai-20261111/budget-before.json'))
budget_delta_only_link = {key: value for key,value in budget.items() if key != 'runnerBoundary'} == {key: value for key,value in delta_before.items() if key != 'runnerBoundary'} and budget['runnerBoundary'] == delta_before['runnerBoundary'].replace('targeted-red.log', 'targeted-red.txt')
delta = git('diff','--name-only',implementation,head).decode().splitlines()
assert all(name.startswith('backend/evidence/mock-ai-20261111/') for name in delta)
assert budget_delta_only_link
diff = subprocess.run(['git','diff','--check',base,head],cwd=root,text=True,capture_output=True)
source_diff = subprocess.run(['git','diff','--check',base,head,'--','.',':!backend/evidence/'],cwd=root,text=True,capture_output=True)
report = {
    'kind':'source_inspection','status':'OBSERVED','assessment':'PASS' if not problems and source_diff.returncode == 0 else 'FAIL',
    'baseCommit':base,'implementation':implementation,'implementationTree':git('rev-parse',implementation+'^{tree}').decode().strip(),'reviewHead':git('rev-parse','HEAD').decode().strip(),'reviewTree':git('rev-parse','HEAD^{tree}').decode().strip(),'worktreeStatus':git('status','--short').decode().strip(),
    'sourceCount':len(inputs),'sources':inputs,'unchangedInheritedObjects':unchanged,
    'archiveFiles':[{'path':str(path.relative_to(archive)),'sha256':sha(path.read_bytes()),'bytes':path.stat().st_size} for path in sorted(archive.rglob('*')) if path.is_file()],
    'rawCopies':copies,'rawCopyCount':len(copies),
    'window':{'inputCount':len(window_inputs),'sourceBeforeAfterMatchManifest':window_sources_match,'summaryEqualsOriginalExceptRelocatedSourceHashes':window_summary_match,'assessment':window['status'],'observedMs':window['observedMs'],'totalCalls':window['totalCalls'],'playerActionsDuringWindow':window['playerActionsDuringWindow'],'process':window['process'],'databaseConnectionsClosed':window['databaseConnectionsClosed']},
    'policy':{'originalProposals':len(raw_policy['proposals']),'originalWaits':policy['waitProposalCount'],'archivedWitnesses':len(policy_matches),'allWitnessesFaithfullyProjected':all(policy_matches)},
    'progress':{'summaryMatch':progress_summary_match,'decisionsMatch':progress_decisions_match,'totalCalls':progress['totalCalls'],'callsAfterRoute':progress['callsAfterRoute'],'ending':progress['ending']['endingCode']},
    'budgetBefore':budget_checks,'authorSequenceChecks':sequence_checks,'counts':counts,'links':links,
    'evidenceOnlyDelta':delta,'budgetDeltaOnlyLogLink':budget_delta_only_link,
    'diffCheckAll':{'exitCode':diff.returncode,'output':diff.stdout+diff.stderr},'sourceDocsDiffCheck':{'exitCode':source_diff.returncode,'output':source_diff.stdout+source_diff.stderr},'problems':problems,
}
(out/'archive-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({key:report[key] for key in ['assessment','reviewHead','reviewTree','worktreeStatus','sourceCount','rawCopyCount','window','policy','progress','budgetBefore','authorSequenceChecks','counts','problems']},ensure_ascii=False,indent=2))
raise SystemExit(0 if report['assessment']=='PASS' else 1)
