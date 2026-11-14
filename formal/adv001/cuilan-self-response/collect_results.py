#!/usr/bin/env python3
"""只汇总本任务真实TLC证据；不运行/模拟业务，不把超时重分类为通过。"""
from __future__ import annotations
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
MODULES = {'cas':'PersonalCAS.tla','consent':'PersonalConsent.tla','recovery':'PersonalRecovery.tla',
           'effects':'PersonalEffects.tla','terms':'PersonalTerms.tla',
           'authority':'AuthorityEffects.tla','projection':'PersonalProjection.tla'}

def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def read_run(path: Path, root: Path) -> dict:
    r = json.loads((path/'result.json').read_text())
    manifest = json.loads((path/'manifest.json').read_text())
    lines = (path/'tlc.log').read_text(errors='replace').splitlines()
    progress = [line for line in lines if line.startswith('Progress(')]
    pattern = r'Progress\((\d+)\).*?([\d,]+) states generated.*?([\d,]+) distinct states found.*?([\d,]+) states left on queue'
    parsed = []
    for line in progress:
        match = re.search(pattern, line)
        if match:
            numbers = [int(value.replace(',','')) for value in match.groups()]
            parsed.append(dict(zip(['depth','generated_states','distinct_states','remaining_states'], numbers)))
    own = next((profile for name,profile in manifest.get('profiles',{}).items() if name==r['profile']),{})
    return {
        'run':str(path.relative_to(root)), 'profile':r['profile'], 'run_id':r.get('run_id'),
        'source':manifest.get('source'), 'model_entry':manifest.get('model',{}).get('entry'),
        'status':r['status'], 'reason':r.get('reason'), 'completed':r.get('completed'),
        'raw_exit':r.get('process',{}).get('exit_code'), 'timeout_seconds':own.get('timeout_seconds'),
        'duration_seconds':r.get('duration_seconds'), 'statistics':r.get('statistics'),
        'last_partial_progress':parsed[-1] if parsed else None,
        'maximum_logged_depth':max((p['depth'] for p in parsed),default=None),
        'fingerprint_and_runtime':next((line for line in lines if 'search Model-Checking with fp ' in line),None),
        'warnings':r.get('warning_codes'), 'errors':r.get('error_codes'),
        'configured_invariants':r.get('checks',{}).get('configured_invariants'),
        'configured_properties':r.get('checks',{}).get('configured_properties'),
        'checks_deadlock':r.get('checks',{}).get('checks_deadlock'),
        'parameters':r.get('scope',{}).get('parameters'), 'command':r.get('command'),
        'input_hashes':{item['path']:item['sha256'] for item in r.get('inputs',{}).get('files',[])},
        'evidence_hashes':{name:digest(path/name) for name in ['result.json','manifest.json','messages.json','tlc.log']},
    }

def main() -> None:
    parser=argparse.ArgumentParser()
    parser.add_argument('--runs',required=True)
    parser.add_argument('--out',required=True)
    args=parser.parse_args()
    root=Path(args.runs).resolve()
    expectations=json.loads((HERE/'expectations.json').read_text())
    all_runs={}
    for file in sorted(list(root.glob('*/result.json'))+list(root.glob('*/*/result.json'))):
        all_runs[str(file.parent.relative_to(root))]=read_run(file.parent,root)
    matrix_entries={}
    for file in sorted(root.glob('*/matrix-results.json')):
        for row in json.loads(file.read_text()):
            matrix_entries[file.parent.name+'/'+row['profile']]=row
    selected=[]
    for profile,expected in expectations.items():
        kind=profile.split('-',1)[0]
        if kind in ['cas','consent','recovery']: group='matrix-r1'
        elif kind=='terms': group='r2-terms-final'
        elif kind=='effects':
            group=next((g for g in ['r2-effects-positive','r2-effects-controls','r2-gates-small'] if g+'/'+profile in all_runs),None)
        elif kind=='authority': group='r2-components-300' if profile in ['authority-restart-private','authority-both'] else 'r2-components'
        elif kind=='projection': group='r2-components-300' if profile=='projection-negative-receipt-liveness' else 'r2-components'
        key=str(group)+'/'+profile
        if key not in all_runs: raise ValueError('缺失真实运行: '+key)
        run=all_runs[key]
        if run['raw_exit'] is None: raise ValueError('运行尚未结束: '+key)
        if key not in matrix_entries: raise ValueError('缺少wrapper最终判据: '+key)
        entry=dict(run, expected=expected, meets_expectation=matrix_entries[key]['meets_expectation'])
        dependencies=[MODULES[kind]]+(['PersonalEffects.tla'] if kind=='authority' else [])+[profile+'.cfg']
        entry['current_model_dependencies_match']={name:digest(HERE/'model'/name)==run['input_hashes'].get(name) for name in dependencies}
        if not all(entry['current_model_dependencies_match'].values()): raise ValueError('当前模型与运行快照不一致: '+key)
        selected.append(entry)
    result={
        'schema_version':1, 'subject':'GZ-SCENE-CUILAN-SELF-RESPONSE-001',
        'mode':'design/check', 'implementation_status':'NOT_ASSESSED', 'independent_model_review':'NOT_RUN',
        'run_root':str(root),
        'source_r1':json.loads((HERE/'source-files.json').read_text()),
        'source_r2':json.loads((HERE/'source-r2.json').read_text()),
        'selected_summary':{'profiles':len(selected),'meets_expectation':sum(x['meets_expectation'] for x in selected),
                            'statuses':dict(Counter(x['status'] for x in selected)),
                            'by_kind':dict(Counter(x['profile'].split('-',1)[0] for x in selected))},
        'historical_summary':{'runs':len(all_runs),'statuses':dict(Counter(x['status'] for x in all_runs.values()))},
        'selected':selected,'all_runs':list(all_runs.values()),
        'note':'selected按最终模型选择实跑结果；R1模块仍保留R1绑定。all_runs保留所有诊断、原边界超时和旧候选；不可把COUNTEREXAMPLE负控/见证当正向穷尽。超时statistics为空时只展示日志下界。'
    }
    Path(args.out).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'selected':result['selected_summary'],'history':result['historical_summary']},ensure_ascii=False))

if __name__=='__main__': main()
