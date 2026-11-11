from pathlib import Path
import datetime, hashlib, json, os, subprocess, sys, time
root=Path(__file__).resolve().parents[2]
out=Path(__file__).resolve().parent
name=sys.argv[1]
command=sys.argv[2:]
env=os.environ.copy()
env['XIYOU_MOCK_EVIDENCE_DIR']=str(out / name)
def source():
    names=json.loads((root/'backend/evidence/mock-ai-20261111/source-manifest.json').read_text())['checkedBytes']
    return {name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in names}
source_before=source()
started=datetime.datetime.now(datetime.timezone.utc).isoformat()
clock=time.monotonic()
with (out / (name+'.txt')).open('w') as log:
    result=subprocess.run(command,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
report={'name':name,'command':command,'startedAt':started,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'elapsedSeconds':time.monotonic()-clock,'exitCode':result.returncode,'gitHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'gitTree':subprocess.check_output(['git','rev-parse','HEAD^{tree}'],cwd=root,text=True).strip(),'gitStatus':subprocess.check_output(['git','status','--short'],cwd=root,text=True).strip(),'sourceBefore':source_before,'sourceAfter':source(),'environment':{'XIYOU_MOCK_EVIDENCE_DIR':env['XIYOU_MOCK_EVIDENCE_DIR']}}
report['inputsUnchanged']=report['sourceBefore']==report['sourceAfter']
(out / (name+'.execution.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({key:report[key] for key in report if key not in ['sourceBefore','sourceAfter']},ensure_ascii=False))
print((out / (name+'.txt')).read_text()[-4000:])
sys.exit(result.returncode)
