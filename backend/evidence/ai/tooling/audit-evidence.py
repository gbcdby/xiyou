from pathlib import Path
import hashlib, json, re, subprocess

folder=Path('backend/evidence/ai')
source=json.loads((folder/'source-manifest.json').read_text())
for item in source['files']:
    assert hashlib.sha256(Path(item['path']).read_bytes()).hexdigest()==item['sha256'], item['path']
aggregate=hashlib.sha256(''.join(row['path']+' '+row['sha256']+'\n' for row in source['files']).encode()).hexdigest()
assert aggregate==source['aggregateSha256']
links=[]
for filename in ['backend/README.md','backend/ai/README.md','backend/evidence/ai/implementation-result.md']:
    document=Path(filename)
    for target in re.findall(r'\]\(([^)]+)\)', document.read_text()):
        if re.match(r'^https?://',target): continue
        resolved=(document.parent/target.split('#')[0]).resolve()
        assert resolved.exists(), (filename,target)
        links.append({'document':filename,'target':target})
contexts=0
def forbidden(value):
    if isinstance(value,dict):
        assert not set(value).intersection({'audience','userId','connectionId','password','token','token_hash','content_snapshot'})
        for v in value.values(): forbidden(v)
    elif isinstance(value,list):
        for v in value: forbidden(v)
for capture in (folder/'captures').glob('*.json'):
    value=json.loads(capture.read_text());assert value['sourceCommit']==source['sourceCommit']
    for run in value['runs']:
        context=run['context'];forbidden(context);contexts+=1
        assert context['sessionId']==run['session_id'] and context['actorId']==run['actor_id'] and context['principalKind']==run['principal_kind']
        assert [o['observationId'] for o in context['memory']['observations']]==context['decision']['observationIds']
        assert all(o['observerId']==run['actor_id'] and int(o['source']['sourceSeq'])<=int(context['snapshotSeq']) for o in context['memory']['observations'])
        assert all(b['holderId']==run['actor_id'] for b in context['memory']['beliefs'])
        assert all(g['holderId']==run['actor_id'] for g in context['memory']['goals'])
        if run['principal_kind']=='proxy': assert all(c['channel']!='private' for c in context['memory']['claims'])
base='5d3e16fa46c4719471092d0567e9bfd1e28737f7'
legacy=subprocess.check_output(['git','ls-tree','-r','--name-only',base,'--','backend/evidence'],text=True).splitlines()
for name in legacy:
    original=subprocess.check_output(['git','show',base+':'+name])
    assert original==Path(name).read_bytes(),name
assert not subprocess.check_output(['git','ls-files','node_modules'],text=True).strip()
assert subprocess.run(['git','check-ignore','-q','node_modules']).returncode==0
assert not subprocess.check_output(['git','diff',base,'HEAD','--name-only','--','protocol','content','formal','docs/specs','game/types.ts'],text=True).strip()
result={'sourceManifest':'PASS','sourceFiles':len(source['files']),'sourceAggregateSha256':aggregate,'relativeLinks':'PASS','checkedLinkCount':len(links),'capturedContextIsolation':'PASS','capturedContexts':contexts,'legacyEvidenceUnchanged':'PASS','legacyEvidenceFiles':len(legacy),'protectedPathsUnchanged':'PASS','nodeModulesTracked':False,'localDependencyLinkIgnored':True,'scope':'只读产物审计；不替代业务回归或独立审查。'}
(folder/'audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False,indent=2))
