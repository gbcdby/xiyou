import subprocess, sys
commands = [
    ['node', 'protocol/scripts/generate.mjs', '--check'],
    ['node', 'content/scripts/generate.mjs', '--check'],
    ['python3', 'protocol/scripts/check-schema.py'],
    ['python3', 'content/scripts/check-schema.py'],
    ['git', 'diff', '--check'],
]
failed = False
for command in commands:
    print('执行：' + ' '.join(command), flush=True)
    result = subprocess.run(command)
    print('退出码：' + str(result.returncode), flush=True)
    failed |= result.returncode != 0
sys.exit(1 if failed else 0)
