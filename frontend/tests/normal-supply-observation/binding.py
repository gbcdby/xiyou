"""NSO的只读输入合同。调用方核源码字节后直接编译本模块，不读取pyc。"""
from pathlib import Path
import hashlib
import json
import os
import platform
import re
import shutil
import stat
import subprocess
import sys
import sysconfig
import time

METHOD = Path(__file__).resolve().parent
REPOSITORY = METHOD.parents[2]
METHOD_REL = 'frontend/tests/normal-supply-observation'
WORKFLOW = '.github/workflows/normal-supply-observation.yml'
PRODUCT_HEAD = '16099e191fdc80c52849aa1d67cd075ccca4e01e'
PRODUCT_TREE = '31f82d6478e2ced1d27875c75160eef626ffe0bf'
BRANCH = 'diagnostic/d66-normal-supply-16099-v1'
HELPER_SHA = '9aa8daf4a171a65c2d18acb2391d599f426842431108622f82c379c79a7eda07'
LOCAL_NODE_SHA = 'acbe4b8d9153b841ed0697cbfc4f93e767386620edb745ab9358306c0a6f31aa'
BUDGETS = {'finite': {'wallSeconds': 10, 'termSeconds': 2, 'killSeconds': 1},
           'normal': {'wallSeconds': 120, 'termSeconds': 10, 'killSeconds': 2}}
SETUP_BUDGET = {'wallSeconds': 720, 'termSeconds': 10, 'killSeconds': 2}
HEX64 = re.compile(r'^[a-f0-9]{64}$')
HEX40 = re.compile(r'^[a-f0-9]{40}$')
PARENT_NAMES = ('NODE_PATH', 'NODE_OPTIONS', 'NODE_V8_COVERAGE', 'NODE_INSPECT_RESUME_ON_START',
                'CHROMIUM_PATH', 'CHROMIUM_ARGS', 'PLAYWRIGHT_BROWSERS_PATH', 'LD_PRELOAD',
                'LD_LIBRARY_PATH', 'PYTHONPATH', 'PYTHONHOME', 'pythonLocation')
FORBIDDEN_CHILD = set(PARENT_NAMES) - {'PLAYWRIGHT_BROWSERS_PATH'}


def require(condition, code):
    if not condition:
        raise ValueError(code)


def tick(deadline):
    require(deadline is None or time.monotonic() < deadline, '冷只读阶段超过截止')


def sha_bytes(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path, limit=16777216):
    path = Path(path)
    require(path.is_file() and not path.is_symlink() and path.stat().st_size <= limit, 'JSON文件形状/界无效')
    return json.loads(path.read_bytes())


def identity(path, deadline=None, maximum=1073741824):
    path = Path(path)
    tick(deadline)
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_size <= maximum, '输入必须是有界普通文件')
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        while True:
            tick(deadline)
            block = handle.read(1048576)
            if not block:
                break
            digest.update(block)
    after = path.lstat()
    require((before.st_dev, before.st_ino, before.st_mode, before.st_size, before.st_mtime_ns)
            == (after.st_dev, after.st_ino, after.st_mode, after.st_size, after.st_mtime_ns), '读取期间输入变化')
    return {'bytes': before.st_size, 'sha256': digest.hexdigest(), 'mode': stat.S_IMODE(before.st_mode)}


def file_ref(path, deadline=None):
    path = Path(path)
    physical = path.resolve(strict=True)
    return {'path': str(path), 'physicalPath': str(physical), **identity(physical, deadline)}


def verify_identity(path, expected, deadline=None):
    actual = identity(path, deadline)
    require(all(actual[key] == expected[key] for key in ('bytes', 'sha256')), '冻结文件字节变化')
    if 'mode' in expected:
        require(actual['mode'] == expected['mode'], '冻结文件mode变化')
    return actual


def atomic_json(path, value):
    path = Path(path)
    data = (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + '\n').encode()
    require(len(data) <= 33554432, '方法账本超过32MiB')
    temporary = path.with_name(path.name + '.part')
    with temporary.open('xb') as handle:
        handle.write(data)
        handle.flush()
    os.link(temporary, path)
    temporary.unlink()
    return {'bytes': len(data), 'sha256': sha_bytes(data)}


def parent_fingerprints():
    # 只记录存在性/长度/摘要；父搜索路径不继承，不输出其内容。
    return {name: {'present': name in os.environ,
                   'bytes': len(os.environ.get(name, '').encode()),
                   'sha256': sha_bytes(os.environ.get(name, '').encode()) if name in os.environ else None}
            for name in PARENT_NAMES}


def git(*arguments, deadline=None):
    tick(deadline)
    remaining = 10 if deadline is None else min(10, max(.001, deadline - time.monotonic()))
    environment = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC',
                   'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
                   'GIT_ALLOW_PROTOCOL': '', 'GIT_NO_LAZY_FETCH': '1'}
    result = subprocess.run(['/usr/bin/git', *arguments], cwd=REPOSITORY, env=environment,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=remaining, check=False)
    require(result.returncode == 0, '本地Git身份读取失败')
    return result.stdout


def load_method(deadline=None):
    manifest_path = METHOD / 'method-manifest.json'
    manifest = read_json(manifest_path)
    require(manifest['format'] == 'NSO_METHOD_V1' and manifest['productHead'] == PRODUCT_HEAD
            and manifest['productTree'] == PRODUCT_TREE and manifest['diagnosticBranch'] == BRANCH,
            '方法固定范围不符')
    require(manifest['budgets'] == BUDGETS and manifest['setupBudget'] == SETUP_BUDGET, '方法预算不符')
    paths = []
    for item in manifest['files']:
        path = item['path']
        require(path == WORKFLOW or (path.startswith(METHOD_REL + '/') and '..' not in Path(path).parts), '方法路径不在闭集')
        require(path not in (METHOD_REL + '/normal-release.json', METHOD_REL + '/method-manifest.json'), '方法manifest自引用或实际release混入')
        verify_identity(REPOSITORY / path, item, deadline)
        paths.append(path)
    require(paths == sorted(set(paths)), '方法清单重复或非规范顺序')
    require(identity(METHOD / 'owned_processes.py', deadline)['sha256'] == HELPER_SHA, '监督源码不是已审同字节')
    require(identity(METHOD / 'owned_processes.py', deadline)['bytes'] == 22190, '监督源码长度不符')
    return manifest, identity(manifest_path, deadline)


def source_binding(stage, deadline=None):
    method, method_id = load_method(deadline)
    product = read_json(METHOD / 'product-manifest.json')
    require(product['format'] == 'NSO_PRODUCT_BASE_V1' and product['head'] == PRODUCT_HEAD
            and product['tree'] == PRODUCT_TREE and len(product['files']) == 2041, '产品基线清单不符')
    expected = {item['path']: item for item in product['files']}
    require(len(expected) == 2041, '产品路径不唯一')
    expected.update({item['path']: item for item in method['files']})
    expected[METHOD_REL + '/method-manifest.json'] = method_id
    if stage == 'normal':
        expected[METHOD_REL + '/normal-release.json'] = identity(METHOD / 'normal-release.json', deadline)
    require(len(expected) == 2041 + len(method['files']) + 1 + (stage == 'normal'), '方法覆盖了产品路径')
    head = git('rev-parse', 'HEAD', deadline=deadline).decode().strip()
    head_tree = git('rev-parse', 'HEAD^{tree}', deadline=deadline).decode().strip()
    parents = git('show', '-s', '--format=%P', 'HEAD', deadline=deadline).decode().strip().split()
    index_tree = git('write-tree', deadline=deadline).decode().strip()
    status_text = git('status', '--porcelain=v1', '--untracked-files=all', deadline=deadline).decode()
    require(not git('diff', '--name-only', deadline=deadline), '存在未stage源码差量')
    raw = git('ls-files', '--stage', '-z', deadline=deadline)
    index = {}
    for part in raw.split(b'\0'):
        if not part:
            continue
        left, name = part.split(b'\t', 1)
        mode, oid, slot = left.decode().split()
        path = name.decode()
        require(slot == '0' and mode == '100644' and path not in index, 'index含冲突/不允许模式')
        index[path] = {'mode': mode, 'blob': oid}
    require(set(index) == set(expected), '全树不等于原产品加唯一方法闭集')
    baseline = {}
    for part in git('ls-tree', '-r', '-z', PRODUCT_TREE, deadline=deadline).split(b'\0'):
        if not part:
            continue
        left, name = part.split(b'\t', 1)
        mode, kind, oid = left.decode().split()
        baseline[name.decode()] = {'mode': mode, 'blob': oid}
    require(set(baseline) == {item['path'] for item in product['files']}, '原Git产品tree缺失或变化')
    for item in product['files']:
        require(baseline[item['path']] == index[item['path']]
                == {'mode': item['gitMode'], 'blob': item['gitBlob']}, '产品路径非原基线字节')
    if stage == 'finite':
        require(head == PRODUCT_HEAD and head_tree == PRODUCT_TREE, '有限宿主不是当前产品基线HEAD')
        # 新方法应已stage；不允许其他未跟踪代码、删除或混入历史worktree。
        permitted = {'A  ' + path for path in set(expected) - set(baseline)}
        require(set(status_text.splitlines()) == permitted, '有限index之外存在额外状态')
    else:
        require(head == os.environ.get('GITHUB_SHA') and parents == [PRODUCT_HEAD]
                and head_tree == index_tree and status_text == '', '诊断提交/单父/clean不符')
    sources = []
    for path, item in sorted(expected.items()):
        actual = verify_identity(REPOSITORY / path, item, deadline)
        blob = hashlib.sha1(b'blob ' + str(actual['bytes']).encode() + b'\0' + (REPOSITORY / path).read_bytes()).hexdigest()
        require(index[path]['blob'] == blob, 'index与工作字节不符')
        sources.append({'path': path, **actual, 'gitBlob': blob, 'gitMode': '100644'})
    return {'sources': sources, 'git': {'head': head, 'headTree': head_tree, 'parents': parents,
            'effectiveTree': index_tree, 'status': status_text}, 'methodSHA256': method_id['sha256']}


def scan_tree(directory, deadline=None, maximum_files=150000, maximum_bytes=4294967296):
    directory = Path(directory)
    require(directory.is_dir() and not directory.is_symlink(), '依赖/证据目录必须独立存在')
    root = directory.resolve(strict=True)
    entries = []
    total = 0
    def visit(folder):
        nonlocal total
        tick(deadline)
        for item in sorted(os.scandir(folder), key=lambda item: item.name):
            tick(deadline)
            path = Path(item.path)
            relative = path.relative_to(root).as_posix()
            status = path.lstat()
            require(len(entries) < maximum_files, '文件清单数量超过固定上界')
            if stat.S_ISLNK(status.st_mode):
                target = os.readlink(path)
                resolved = path.resolve(strict=True)
                require(resolved.is_relative_to(root), 'symlink指向独立目录之外')
                entries.append({'path': relative, 'kind': 'symlink', 'target': target,
                                'resolvedRelative': resolved.relative_to(root).as_posix(), 'mode': stat.S_IMODE(status.st_mode)})
            elif stat.S_ISDIR(status.st_mode):
                entries.append({'path': relative, 'kind': 'directory', 'mode': stat.S_IMODE(status.st_mode)})
                visit(path)
            else:
                value = identity(path, deadline)
                total += value['bytes']
                require(total <= maximum_bytes, '文件清单字节总量超过固定上界')
                entries.append({'path': relative, 'kind': 'file', **value})
    visit(root)
    return {'root': str(root), 'bytes': total, 'entries': entries}


def runtime_binding(stage, deadline=None):
    require(sys.platform == 'linux' and platform.machine() == 'x86_64', '监督仅支持已审Linux x64')
    wanted_python = '3.12.14' if stage == 'finite' else '3.12.16'
    require(platform.python_version() == wanted_python and sys.flags.isolated == 1, 'Python版本或-I隔离不符')
    require(not os.environ.get('LD_PRELOAD'), '父进程存在未批准LD_PRELOAD')
    if stage == 'normal':
        require(os.environ.get('pythonLocation') == sys.base_prefix, 'setup-python来源不符')
        require(os.environ.get('LD_LIBRARY_PATH', '') in ('', str(Path(sys.base_prefix) / 'lib')), 'Python库路径不是已选runtime/lib')
    else:
        require(not os.environ.get('LD_LIBRARY_PATH'), '本地有限父Python库注入不符')
    node = Path(shutil.which('node') or '/不存在的Node').resolve(strict=True)
    node_id = file_ref(node, deadline)
    require(node_id['mode'] & 0o111, 'Node无执行权限')
    node_id['expectedVersion'] = '24.22.3'
    if stage == 'finite':
        require(node_id['sha256'] == LOCAL_NODE_SHA and node_id['bytes'] == 126951512, '本地Node不是已回读同字节24.22.3')
        node_id['versionEvidence'] = '既有物理字节身份；本场Node入口再核process.version'
    else:
        prefix = node.parent.parent
        header = prefix / 'include/node/node_version.h'
        text = header.read_text()
        for key, value in [('MAJOR', '24'), ('MINOR', '22'), ('PATCH', '3')]:
            require(re.search(r'^#define NODE_' + key + r'_VERSION\s+' + value + r'\s*$', text, re.M), 'Node安装header版本不符')
        node_id['header'] = file_ref(header, deadline)
        node_id['versionEvidence'] = '精确setup-node+安装header+本场Node入口process.version；非仅目录名'
    python_id = file_ref(Path(sys.executable), deadline)
    python_id.update({'version': platform.python_version(), 'prefix': sys.base_prefix, 'isolated': True})
    # 可搬迁runtime的编译期LIBDIR可能仍为/install/lib；使用实际选中prefix的同名库。
    library = Path(sys.base_prefix) / 'lib' / sysconfig.get_config_var('LDLIBRARY')
    require(library.exists(), '选中Python共享库缺失')
    python_id['sharedLibrary'] = file_ref(library, deadline)
    python_id['sharedLibraryEvidence'] = '选中实际runtime/prefix/lib文件身份；非OS loaded-library观察'
    return {'node': node_id, 'python': python_id,
            'host': {'system': platform.system(), 'machine': platform.machine(), 'kernel': platform.release(),
                     'imageOS': os.environ.get('ImageOS'), 'imageVersion': os.environ.get('ImageVersion')},
            'scope': '选中runtime/共享Python库；不声称冻结整个宿主系统或OS动态库闭包'}


def package_version(path, name, version):
    value = read_json(path)
    require(value.get('name') == name and value.get('version') == version, '实际锁包来源/版本不符')
    return {'name': name, 'version': version, 'path': str(Path(path).resolve()), **identity(path)}


def normal_dependencies(cache, deadline=None):
    root_deps = REPOSITORY / 'node_modules'
    front_deps = REPOSITORY / 'frontend/node_modules'
    packages = [package_version(root_deps / name / 'package.json', name, version) for name, version in
                [('embedded-postgres', '18.6.0-beta.19'), ('@embedded-postgres/linux-x64', '18.6.0-beta.19'),
                 ('socket.io', '4.8.4'), ('socket.io-client', '4.8.4'), ('pg', '8.23.1')]]
    packages += [package_version(front_deps / name / 'package.json', name, version) for name, version in
                 [('playwright', '1.57.0'), ('playwright-core', '1.57.0'), ('socket.io-client', '4.8.4'), ('vite', '8.3.8')]]
    browsers_path = front_deps / 'playwright-core/browsers.json'
    browsers = {item['name']: item for item in read_json(browsers_path)['browsers']}
    require(browsers['chromium-headless-shell']['revision'] == '1200'
            and browsers['chromium-headless-shell']['browserVersion'] == '143.0.7499.4'
            and browsers['ffmpeg']['revision'] == '1011', 'Playwright锁内browser descriptor不符')
    cache = Path(cache)
    headless = cache / 'chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell'
    ffmpeg = cache / 'ffmpeg-1011/ffmpeg-linux'
    pg = root_deps / '@embedded-postgres/linux-x64/native/bin'
    binaries = {name: file_ref(path, deadline) for name, path in
                [('chromiumHeadless', headless), ('ffmpeg', ffmpeg), ('postgres', pg / 'postgres'),
                 ('initdb', pg / 'initdb'), ('pgCtl', pg / 'pg_ctl')]}
    for name, item in binaries.items():
        require(item['mode'] & 0o111, '实际native binary无执行权限')
        prefix = Path(item['physicalPath']).open('rb').read(20)
        require(prefix[:4] == b'\x7fELF' and int.from_bytes(prefix[18:20], 'little') == 62, '实际native binary不是Linux x64 ELF')
    marker = headless.parents[1] / 'DEPENDENCIES_VALIDATED'
    require(marker.is_file() and not marker.is_symlink() and marker.stat().st_size == 0, '默认host validation marker缺失；禁止先试启动')
    require(-60 <= time.time() - marker.stat().st_mtime < 3600, '默认host validation marker不够新鲜')
    require((headless.parents[1] / 'INSTALLATION_COMPLETE').is_file()
            and (cache / 'ffmpeg-1011/INSTALLATION_COMPLETE').is_file(), 'Playwright下载完整标志缺失')
    selection_sources = ['lib/server/browserType.js', 'lib/server/chromium/chromium.js',
                         'lib/server/chromium/videoRecorder.js', 'lib/server/registry/index.js', 'browsers.json']
    return {'root': scan_tree(root_deps, deadline), 'frontend': scan_tree(front_deps, deadline),
            'browserCache': scan_tree(cache, deadline), 'packages': packages, 'binaries': binaries,
            'selection': {'type': 'DEFAULT_HEADLESS_REGISTRY', 'headless': True, 'channel': None,
                          'CHROMIUM_PATH': 'ABSENT', 'CHROMIUM_ARGS': 'ABSENT',
                          'PLAYWRIGHT_BROWSERS_PATH': str(cache), 'expectedBrowserVersion': '143.0.7499.4',
                          'sourceFiles': [file_ref(front_deps / 'playwright-core' / name, deadline) for name in selection_sources],
                          'hostValidationMarker': {**file_ref(marker, deadline), 'mtimeNs': marker.stat().st_mtime_ns},
                          'evidenceLevel': '源码+选项+env推导选择并冻结实际文件；非OS独立exe观察'}}


def child_base(stage, output, runtime, cache=None):
    output = Path(output)
    environment = {'PATH': str(Path(runtime['node']['physicalPath']).parent) + ':/usr/bin:/bin',
                   'LANG': 'C.UTF-8', 'TZ': 'UTC', 'CI': 'true', 'TMPDIR': str(output / 'tmp'),
                   'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
                   'GIT_ALLOW_PROTOCOL': '', 'GIT_NO_LAZY_FETCH': '1',
                   'XIYOU_NSO_OUTPUT': str(output / 'diagnostic')}
    if stage == 'normal':
        environment.update({'FRONTEND_EVIDENCE_DIR': str(output / 'product'), 'PLAYWRIGHT_BROWSERS_PATH': str(cache)})
    require(not (set(environment) & FORBIDDEN_CHILD), '实际child env含未批准注入项')
    return environment


def snapshot(stage, output, cache=None, deadline=None):
    source = source_binding(stage, deadline)
    runtime = runtime_binding(stage, deadline)
    dependencies = normal_dependencies(cache, deadline) if stage == 'normal' else None
    return {'sources': source['sources'], 'git': source['git'], 'runtime': runtime,
            'dependencies': dependencies, 'methodSHA256': source['methodSHA256']}


def make_input(stage, output, cache=None, release_path=None, deadline=None):
    binding = snapshot(stage, output, cache, deadline)
    return {'format': 'NSO_INPUT_V1', 'stage': stage, 'repository': str(REPOSITORY),
            'productHead': PRODUCT_HEAD, 'productTree': PRODUCT_TREE, 'naturalQualified': False,
            'methodSHA256': binding['methodSHA256'],
            'releaseSHA256': identity(release_path, deadline)['sha256'] if stage == 'normal' else None,
            'outputDirectory': str(output), 'bindings': binding,
            'childEnvironmentBase': child_base(stage, output, binding['runtime'], cache),
            'parentEnvironment': parent_fingerprints(),
            'environmentRule': '父变量只摘要；Node显式构造closed child env，不修改全局环境'}


def release_check(release, stage, method_sha, input_sha=None):
    keys = {'format', 'state', 'allocationId', 'stage', 'scenario', 'productHead', 'productTree',
            'diagnosticBranch', 'methodSHA256', 'inputSHA256', 'candidateTree', 'attempts', 'retries',
            'previousAttemptsRefunded', 'budget', 'setupBudget', 'reviews', 'finiteEvidence', 'firstMethodPushOnly'}
    require(set(release) == keys, 'release不是固定字段数据')
    require(release['format'] == 'NSO_RELEASE_V1'
            and release['state'] == ('ROOT_RELEASE_NSO_FINITE_ONCE' if stage == 'finite' else 'ROOT_RELEASE_NSO_NORMAL_ONCE')
            and release['allocationId'] == ('NSO_FINITE_V1_ONCE' if stage == 'finite' else 'NSO_NORMAL_V1_ONCE')
            and release['stage'] == stage and release['scenario'] == ('finite-32' if stage == 'finite' else 'normal')
            and release['productHead'] == PRODUCT_HEAD and release['productTree'] == PRODUCT_TREE
            and release['diagnosticBranch'] == BRANCH and release['methodSHA256'] == method_sha
            and release['attempts'] == 1 and release['retries'] == 0 and release['previousAttemptsRefunded'] is False
            and release['budget'] == BUDGETS[stage], 'release范围/身份/预算不符')
    require(set(release['reviews']) == {'requirements', 'standards'}, 'release缺独立两轴')
    for axis in ('requirements', 'standards'):
        item = release['reviews'][axis]
        require(set(item) == {'scope', 'sha256', 'conclusion'} and item['conclusion'] == 'PASS'
                and item['scope'] == 'STATIC_NSO_COMPLETE_METHOD_' + axis.upper()
                and HEX64.fullmatch(item['sha256']), 'release独审身份/scope不符')
    if stage == 'finite':
        require(release['setupBudget'] is None and release['finiteEvidence'] is None
                and release['inputSHA256'] == input_sha and HEX40.fullmatch(release['candidateTree'])
                and release['firstMethodPushOnly'] is False, '有限释放身份/独立范围不符')
    else:
        require(release['setupBudget'] == SETUP_BUDGET and release['inputSHA256'] is None
                and release['candidateTree'] is None and release['firstMethodPushOnly'] is True, 'normal释放或动态冻结规则不符')
        value = release['finiteEvidence']
        require(set(value) == {'executionSHA256', 'independentReviewSHA256', 'scope', 'conclusion'}
                and value['scope'] == 'NSO_FINITE_32_EXECUTION_EVIDENCE' and value['conclusion'] == 'PASS'
                and HEX64.fullmatch(value['executionSHA256']) and HEX64.fullmatch(value['independentReviewSHA256']), 'normal缺本方法有限实际独审引用')


def ci_identity():
    require(os.environ.get('GITHUB_EVENT_NAME') == 'push' and os.environ.get('GITHUB_RUN_ATTEMPT') == '1'
            and os.environ.get('GITHUB_REPOSITORY') == 'gbcdby/xiyou'
            and os.environ.get('GITHUB_REF') == 'refs/heads/' + BRANCH, '只允许精确诊断分支首个具名方法push attempt1')
    require(os.environ.get('GITHUB_WORKFLOW_REF') == 'gbcdby/xiyou/' + WORKFLOW + '@refs/heads/' + BRANCH, 'workflow来源不符')
    event = read_json(os.environ['GITHUB_EVENT_PATH'], 8388608)
    require(event.get('created') is False and event.get('deleted') is False and event.get('forced') is False
            and event.get('before') == PRODUCT_HEAD and event.get('after') == os.environ.get('GITHUB_SHA')
            and event.get('ref') == 'refs/heads/' + BRANCH, '不是本分支16099基线到准确方法候选的非强制更新')
    require(HEX40.fullmatch(event['after']) and os.environ.get('GITHUB_RUN_ID', '').isdigit(), 'CI提交/run身份无效')
    return {'event': 'push', 'attempt': 1, 'runId': os.environ['GITHUB_RUN_ID'],
            'head': event['after'], 'ref': event['ref'], 'created': False, 'forced': False,
            'before': event['before'], 'eventSHA256': identity(os.environ['GITHUB_EVENT_PATH'])['sha256']}
