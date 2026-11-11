from pathlib import Path
import datetime, json, os, subprocess, sys, time
root=Path(__file__).resolve().parents[2]
out=Path(__file__).resolve().parent
name=sys.argv[1]
command=sys.argv[2:]
env=os.environ.copy()
if name == 'browser':
    env['FRONTEND_EVIDENCE_DIR']=str(out / 'browser')
    env['PLAYWRIGHT_MODULE']='/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
    env['CHROMIUM_PACKAGE']='/workspace/scratch/17ff92cde78f/xiyou-network/.agent-output/browser-deps/node_modules/@sparticuz/chromium/build/index.js'
started=datetime.datetime.now(datetime.timezone.utc).isoformat()
clock=time.monotonic()
with (out / (name+'.txt')).open('w') as log:
    result=subprocess.run(command,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
report={'name':name,'command':command,'startedAt':started,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'elapsedSeconds':time.monotonic()-clock,'exitCode':result.returncode,'gitHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'gitTree':subprocess.check_output(['git','rev-parse','HEAD^{tree}'],cwd=root,text=True).strip(),'gitStatus':subprocess.check_output(['git','status','--short'],cwd=root,text=True).strip()}
if name=='browser': report['environment']={key:env[key] for key in ['FRONTEND_EVIDENCE_DIR','PLAYWRIGHT_MODULE','CHROMIUM_PACKAGE']}
(out / (name+'.execution.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False))
print((out / (name+'.txt')).read_text()[-3000:])
sys.exit(result.returncode)
