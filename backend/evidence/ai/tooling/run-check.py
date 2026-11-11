import datetime, json, pathlib, subprocess, sys, time, signal, hashlib, os

name, *command = sys.argv[1:]
root = pathlib.Path(__file__).resolve().parent
start = datetime.datetime.now(datetime.timezone.utc).isoformat()
clock = time.monotonic()
inputs = {}
for directory in ['backend', 'game', 'protocol', 'content']:
    for source in pathlib.Path(directory).rglob('*'):
        if source.is_file() and 'evidence' not in source.parts and source.suffix in ['.mjs', '.sql', '.json', '.ts']:
            inputs[str(source)] = hashlib.sha256(source.read_bytes()).hexdigest()
child_env = os.environ.copy()
if name.startswith('final-'):
    child_env['XIYOU_AI_EVIDENCE_DIR'] = str(root / 'captures')
    child_env['XIYOU_AI_SOURCE_COMMIT'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
with (root / (name + '.log')).open('w') as output:
    child = subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT, env=child_env)
    try:
        code = child.wait(timeout=180)
    except (subprocess.TimeoutExpired, KeyboardInterrupt):
        child.send_signal(signal.SIGINT)
        try:
            code = child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            child.kill()
            code = child.wait()
record = {'name': name, 'command': command, 'startedAt': start,
          'durationSeconds': round(time.monotonic() - clock, 3),
          'exitCode': code if code >= 0 else None,
          'signal': -code if code < 0 else None, 'sourceInputs': inputs}
(root / (name + '.json')).write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({key:value for key,value in record.items() if key != 'sourceInputs'}, ensure_ascii=False))
print((root / (name + '.log')).read_text()[-7500:])
sys.exit(0)
