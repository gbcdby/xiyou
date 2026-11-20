"""仅由已释放CI准备监督入口启动；三条固定安装命令，失败即停，不启动产品。"""
from pathlib import Path
import hashlib
import json
import os
import stat
import subprocess
import sys

method = Path(__file__).resolve().parent
repository = method.parents[2]
def require(value, message):
    if not value:
        raise ValueError(message)

def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def write(path, value):
    part = path.with_name(path.name + '.part')
    with part.open('x') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    os.link(part, path)
    part.unlink()

require(sys.flags.isolated == 1 and len(sys.argv) == 1, '准备入口仅允许固定-I命令')
input_path = Path(os.environ['XIYOU_NSO_SETUP_INPUT'])
require(input_path.is_absolute() and digest(input_path) == os.environ['XIYOU_NSO_SETUP_INPUT_SHA256'], '准备输入摘要不符')
value = json.loads(input_path.read_bytes())
require(set(value) == {'format', 'repository', 'output', 'node', 'npmCLI', 'releaseSHA256', 'methodSHA256', 'npmConfigs', 'commandEnvironment'}, '准备字段不是闭集')
require(value['format'] == 'NSO_SETUP_INPUT_V1' and value['repository'] == str(repository)
        and digest(method / 'method-manifest.json') == value['methodSHA256']
        and digest(method / 'normal-release.json') == value['releaseSHA256'], '准备来源不符')
release = json.loads((method / 'normal-release.json').read_bytes())
require(release['state'] == 'ROOT_RELEASE_NSO_NORMAL_ONCE' and release['methodSHA256'] == value['methodSHA256'], '准备未获本场释放')
for key in ('node', 'npmCLI'):
    require(digest(value[key]['physicalPath']) == value[key]['sha256'], '准备工具字节不符')
environment = value['commandEnvironment']
require(set(environment) == {'PATH', 'LANG', 'TZ', 'CI', 'TMPDIR', 'PLAYWRIGHT_BROWSERS_PATH',
                            'NPM_CONFIG_CACHE', 'NPM_CONFIG_USERCONFIG', 'NPM_CONFIG_GLOBALCONFIG', 'DEBIAN_FRONTEND'}, '安装子环境不是固定闭集')
output = Path(value['output'])
require(set(value['npmConfigs']) == {'user', 'global'}, 'npm配置来源不是固定两件')
for role, environment_key in [('user', 'NPM_CONFIG_USERCONFIG'), ('global', 'NPM_CONFIG_GLOBALCONFIG')]:
    path = output / 'npm-config' / (role + '.npmrc')
    expected = value['npmConfigs'][role]
    require(not path.is_symlink() and path.is_file() and path.resolve() == path
            and expected['path'] == expected['physicalPath'] == environment[environment_key] == str(path), 'npm配置实际路径/环境不符')
    require(path.stat().st_size == expected['bytes'] == 0
            and digest(path) == expected['sha256'] == hashlib.sha256(b'').hexdigest()
            and stat.S_IMODE(path.stat().st_mode) == expected['mode'], 'npm配置空字节身份不符')
require(environment['NPM_CONFIG_USERCONFIG'] != environment['NPM_CONFIG_GLOBALCONFIG'], 'npm配置source必须不同')
steps = output / 'setup-steps'
steps.mkdir(exist_ok=False)
node = value['node']['physicalPath']
npm = value['npmCLI']['physicalPath']
commands = [
    ('root-lock', [node, npm, 'ci', '--no-audit', '--no-fund'], repository),
    ('frontend-lock', [node, npm, 'ci', '--no-audit', '--no-fund'], repository / 'frontend'),
    ('playwright-lock', [node, str(repository / 'frontend/node_modules/playwright/cli.js'),
                         'install', '--with-deps', 'chromium'], repository / 'frontend'),
]
for index, (name, command, directory) in enumerate(commands, 1):
    write(steps / f'{index:02d}-{name}-started.json', {'step': name, 'command': command, 'cwd': str(directory), 'attempt': 1})
    result = subprocess.run(command, cwd=directory, env=environment, check=False)
    write(steps / f'{index:02d}-{name}-finished.json', {'step': name, 'exitCode': result.returncode})
    if result.returncode != 0:
        raise SystemExit(result.returncode if result.returncode > 0 else 125)
