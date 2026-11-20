"""NSO唯一有界入口。无默认场、无自动重试；必须先有总控精确release。"""
from pathlib import Path
import datetime
import hashlib
import json
import os
import re
import sys
import time
import types

DIRECTORY = Path(__file__).resolve().parent
REPOSITORY = DIRECTORY.parents[2]
ENTRY_STARTED = time.monotonic()


def verified_module(name, filename, expected=None):
    path = DIRECTORY / filename
    manifest = json.loads((DIRECTORY / 'method-manifest.json').read_bytes())
    record = next(item for item in manifest['files'] if item['path'] == 'frontend/tests/normal-supply-observation/' + filename)
    data = path.read_bytes()
    actual = hashlib.sha256(data).hexdigest()
    if len(data) != record['bytes'] or actual != record['sha256'] or (expected and actual != expected):
        raise ValueError('方法源码绑定失败')
    module = types.ModuleType(name)
    module.__file__ = str(path)
    module.__package__ = ''
    module.__cached__ = module.__loader__ = module.__spec__ = None
    sys.modules[name] = module
    # 直接执行已核源码；不经过SourceFileLoader/get_code，不读取共享或本目录pyc。
    exec(compile(data, str(path), 'exec', dont_inherit=True, optimize=0), module.__dict__)
    return module


b = verified_module('xiyou_nso_binding_run', 'binding.py')


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def clean(report):
    return bool(report and all(report.get(key) is True for key in
                              ('rootReaped', 'directChildrenECHILD', 'descendantsGone', 'ownedGroupsGone')))


def digest_output(path, safe, deadline):
    path = Path(path)
    if not path.exists():
        return {'path': str(path), 'exists': False, 'sealed': False}
    if not safe:
        return {'path': str(path), 'exists': True, 'bytes': path.stat().st_size, 'sealed': False,
                'state': 'NOT_HASHED_CLEANUP_UNCONFIRMED'}
    return {'path': str(path), 'exists': True, 'sealed': True, **b.identity(path, deadline)}


def command_environment(value, input_path, release_path):
    actual = {**value['childEnvironmentBase'], 'XIYOU_NSO_INPUT': str(input_path),
              'XIYOU_NSO_INPUT_SHA256': b.identity(input_path)['sha256'],
              'XIYOU_NSO_RELEASE': str(release_path), 'XIYOU_NSO_RELEASE_SHA256': b.identity(release_path)['sha256'],
              'XIYOU_NSO_METHOD_SHA256': value['methodSHA256'], 'XIYOU_NSO_STAGE': value['stage']}
    b.require(not (set(actual) & b.FORBIDDEN_CHILD), '实际Node子环境含注入项')
    return actual


def run_owned(helper, command, env, output, prefix, budget):
    stdout_path, stderr_path = output / (prefix + '-stdout.log'), output / (prefix + '-stderr.log')
    with stdout_path.open('xb') as stdout, stderr_path.open('xb') as stderr:
        report = helper.run_owned(command, cwd=str(REPOSITORY), env=env, stdout=stdout, stderr=stderr,
                                  wall_seconds=budget['wallSeconds'], term_seconds=budget['termSeconds'],
                                  kill_seconds=budget['killSeconds'])
    b.atomic_json(output / (prefix + '-owned-processes.json'), report)
    return report


def verify_finite(output, value):
    diagnostic = output / 'diagnostic'
    b.require({item.name for item in diagnostic.iterdir()} == {'finite-result.json'}, '有限原件存在部分写入/额外文件')
    result = b.read_json(diagnostic / 'finite-result.json', 32768)
    b.require(result['format'] == 'NSO_FINITE_RESULT_V1' and result['naturalQualified'] is False
              and result['productHead'] == b.PRODUCT_HEAD and result['productTree'] == b.PRODUCT_TREE
              and result['methodSHA256'] == value['methodSHA256']
              and result['inputSHA256'] == b.identity(REPOSITORY.parent / 'finite-input.json')['sha256']
              and result['nodeVersion'] == 'v24.22.3', '有限原件身份不符')
    expected = [{'id': f'NSO-F{index:02d}', 'status': 'PASS'} for index in range(1, 33)]
    b.require(result['cases'] == expected, '有限32个外侧oracle未全通过')
    text = (output / 'normal-stdout.log').read_text()
    expected_counts = {'tests': 32, 'suites': 0, 'pass': 32, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}
    actual = {}
    for name, expected_count in expected_counts.items():
        values = re.findall(r'^# ' + name + r' (\d+)\s*$', text, re.M)
        b.require(len(values) == 1 and int(values[0]) == expected_count, '原生TAP总计不符')
        actual[name] = int(values[0])
    b.require(re.findall(r'^1\.\.(\d+)\s*$', text, re.M) == ['32'] and not re.search(r'^not ok\b', text, re.M), '原生TAP plan/失败不符')
    return {'assessment': 'FINITE_PASS', 'nativeTAP': actual, 'cases': 32, 'naturalQualified': False}


def verify_normal(output, value, input_path):
    diagnostic = output / 'diagnostic'
    b.require({item.name for item in diagnostic.iterdir()} == {'node-boundaries.json', 'page-boundaries.json', 'cold-status.json'},
              '诊断原件有缺失/部分写入/额外文件；不借既存valid字段覆盖写失败')
    cold = b.read_json(diagnostic / 'cold-status.json', 32768)
    identities = {'productHead': b.PRODUCT_HEAD, 'productTree': b.PRODUCT_TREE,
                  'methodSHA256': value['methodSHA256'], 'inputSHA256': b.identity(input_path)['sha256'],
                  'schemaSHA256': b.identity(DIRECTORY / 'schema.json')['sha256']}
    b.require(cold['format'] == 'NSO_COLD_V1' and cold['naturalQualified'] is False
              and cold['valid'] is True and cold['errors'] == [] and cold['exitFallback'] is False, '冷证据资格不成立')
    for name, identity_value in identities.items():
        b.require(cold[name] == identity_value, '冷证据身份不符')
    flags = ('harnessLoaded', 'enqueueLoaded', 'loaderRemoved', 'temporaryBridgeRemoved', 'nodeInstalled',
             'pageInstalled', 'collectionRequested', 'ownedApiCaptured', 'ownedApiDisposed', 'pageCollected',
             'pageWritten', 'nodeCollected', 'nodeWritten', 'harnessRestored', 'contextRestored', 'browserRestored', 'reloadRestored')
    b.require(all(cold[name] is True for name in flags) and cold['ownerHookCalls'] == cold['originalOwnerHookCalls'] == 1,
              '安装/收取/恢复不完整')
    method = b.read_json(DIRECTORY / 'method-manifest.json')
    b.require(cold['transformedModules'] == method['transforms'], '实际变换来源不符')
    schema = b.read_json(DIRECTORY / 'schema.json')
    raw_summaries = {}
    for realm in ('node', 'page'):
        path = diagnostic / (realm + '-boundaries.json')
        file_id = b.identity(path)
        raw = b.read_json(path, 16777216)
        b.require(file_id['bytes'] == cold[realm + 'Bytes'] and file_id['sha256'] == cold[realm + 'SHA256'], 'raw与cold摘要不符')
        b.require(raw['format'] == 'NSO_RAW_V1' and raw['realm'] == realm and raw['naturalQualified'] is False
                  and raw['kinds'] == schema['kinds'][realm] and raw['limits'] == schema['limits'], 'raw固定schema不符')
        for name, identity_value in identities.items():
            b.require(raw[name] == identity_value, 'raw身份不符')
        terminal = raw['terminal']
        b.require(terminal['valid'] is True and terminal['errors'] == [] and terminal['errorCount'] == 0
                  and terminal['dropped'] == terminal['unfinished'] == terminal['activeOnStop'] == terminal['restoreConflicts'] == 0
                  and terminal['restored'] == (2 if realm == 'node' else 4) and terminal['admissionClosed'] is None,
                  'raw截断/错误/恢复不足')
        b.require(terminal['recorded'] == len(raw['rows']) == terminal['seen']
                  and 0 < len(raw['rows']) <= 16384 and terminal['serializedBytes'] == file_id['bytes']
                  and file_id['bytes'] <= terminal['reservedBytes'] <= 16777216, 'raw行/字节账不闭合')
        by_kind = [0] * len(raw['kinds'])
        for index, row in enumerate(raw['rows'], 1):
            b.require(isinstance(row, list) and row[0] == index and type(row[1]) is int
                      and 0 <= row[1] < len(by_kind), 'raw行身份无效')
            kind = raw['kinds'][row[1]]
            b.require(len(row) == len(schema['common']) + len(schema['tails'][kind]), 'raw行字段未闭合')
            by_kind[row[1]] += 1
        b.require(by_kind == terminal['recordedByKind'] == terminal['seenByKind']
                  and terminal['droppedByKind'] == [0] * len(by_kind) and all(by_kind), 'raw接点未覆盖或分类账不闭合')
        raw_summaries[realm] = {'rows': len(raw['rows']), 'byKind': by_kind, **file_id}
    product = b.read_json(output / 'product/result.json', 33554432)
    b.require(product['scenario'] == 'normal' and product['source'] == product['sourceEnd']
              and not product.get('sourceChanged') and product['source']['commit'] == value['bindings']['git']['head']
              and product['source']['tree'] == value['bindings']['git']['headTree'] and product['source']['status'] == '', '原report来源未闭合')
    source_map = {item['path']: item['sha256'] for item in value['bindings']['sources']}
    b.require(all(source_map.get(path) == digest for path, digest in product['source']['sourceHashes'].items()), '原report来源与完整输入不符')
    b.require(product['environment'] == {'node': 'v24.22.3', 'chromium': '143.0.7499.4', 'dpr': 1}, '原report实际runtime不符')
    b.require(product['cleanup'] == [{'name': name, 'status': 'closed'} for name in ('room', 'browser', 'vite', 'server', 'postgres')], '原harness清理未全closed')
    # 原产品失败保留，诊断可有效但不能冒称原自然门通过；原report字节不改。
    b.require(product['assessment'] in ('PASS', 'FAIL'), '本场无可解释的正常产品退出范围')
    return {'assessment': 'OBSERVATION_VALID', 'raw': raw_summaries,
            'productAssessment': product['assessment'], 'productReportScopePreserved': product.get('scope'),
            'instrumented': True, 'naturalQualified': False,
            'scope': '当前首文档N1通知/N2证明边界与MI03；没有跨钟时延/OS独立exe观察'}


def preserve_product(output):
    deadline = time.monotonic() + 60
    product = output / 'product'
    result = {'product': b.scan_tree(product, deadline) if product.exists() else None, 'postgres': None}
    postgres = REPOSITORY / '.agent-output/ux-c-browser'
    if postgres.exists():
        result['postgres'] = b.scan_tree(postgres, deadline)
        target = output / 'postgres-logs'
        target.mkdir(exist_ok=False)
        for entry in result['postgres']['entries']:
            if entry['kind'] == 'file' and entry['path'].endswith('.log'):
                source = postgres / entry['path']
                destination = target / entry['path']
                destination.parent.mkdir(parents=True, exist_ok=True)
                with destination.open('xb') as handle:
                    handle.write(source.read_bytes())
                b.verify_identity(destination, entry, deadline)
        # 集群数据只保留完整路径/字节/摘要；日志原字节复制，数据库/凭据文件不外传。
    b.atomic_json(output / 'product-evidence-manifest.json', result)
    return {'state': 'COLLECTED_AFTER_OWNED_CLEANUP', 'productFiles': len(result['product']['entries']) if result['product'] else 0,
            'postgresEntries': len(result['postgres']['entries']) if result['postgres'] else 0}


def entry():
    b.require(sys.flags.isolated == 1 and len(sys.argv) == 2 and sys.argv[1] in ('finite', 'ci'), '仅允许固定-I finite/ci入口')
    stage = 'finite' if sys.argv[1] == 'finite' else 'normal'
    is_ci = stage == 'normal'
    if is_ci:
        runner_temp = Path(os.environ['RUNNER_TEMP'])
        b.require(runner_temp.is_absolute() and runner_temp.is_dir() and not runner_temp.is_symlink(), 'CI临时根不符')
        output = runner_temp / 'xiyou-nso-16099-v1'
        release_path = DIRECTORY / 'normal-release.json'
        input_path = output / 'input.json'
        ci = b.ci_identity()
    else:
        output = REPOSITORY.parent / 'runs/finite'
        release_path = REPOSITORY.parent / 'finite-release.json'
        input_path = REPOSITORY.parent / 'finite-input.json'
        ci = None
    method, method_id = b.load_method(ENTRY_STARTED + 60)
    release = b.read_json(release_path, 32768)
    b.release_check(release, stage, method_id['sha256'], b.identity(input_path)['sha256'] if not is_ci else None)
    b.require(not output.exists(), '输出目录已存在；禁止覆盖、重试或退还既有消费')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.mkdir(exist_ok=False)
    record = {'format': 'NSO_EXECUTION_V1', 'stage': stage, 'instrumented': is_ci, 'naturalQualified': False,
              'startedAt': utc(), 'methodSHA256': method_id['sha256'], 'release': b.file_ref(release_path),
              'ci': ci, 'setupAttemptConsumed': is_ci, 'normalAttemptConsumed': False,
              'finiteAttemptConsumed': not is_ci, 'retries': 0, 'previousAttemptsRefunded': False,
              'setupBudget': b.SETUP_BUDGET if is_ci else None, 'budget': b.BUDGETS[stage],
              'nodeStarted': False, 'nodeExitCode': None, 'runnerExitCode': 125,
              'coldCollectionSafe': True, 'evidenceCollection': 'NOT_STARTED', 'evidenceCollectionAttempted': False, 'errors': []}
    b.atomic_json(output / 'attempt.json', {key: record[key] for key in
                  ('stage', 'startedAt', 'setupAttemptConsumed', 'normalAttemptConsumed', 'finiteAttemptConsumed', 'retries', 'previousAttemptsRefunded', 'setupBudget', 'budget')})
    start = ENTRY_STARTED
    helper = None
    setup_report = normal_report = None
    setup_entered = normal_entered = False
    before = after = value = None
    product_allowed = False
    try:
        for name in ('tmp',):
            (output / name).mkdir(exist_ok=False)
        if is_ci:
            stamp = Path(os.environ['RUNNER_TEMP']) / 'xiyou-nso-job-start'
            job_started = float(stamp.read_text().strip())
            # 最多1260秒本步骤，且整个job1680秒前结束，留下至少120秒原件上传余量。
            b.require(0 <= time.time() - job_started <= 360, '前置action已耗尽明确余量；不开始准备')
            step_deadline = start + 1260
            job_deadline = time.monotonic() + (1680 - (time.time() - job_started))
            outer_deadline = min(step_deadline, job_deadline)
            b.require(outer_deadline - time.monotonic() >= 1240, '外层余量不足以容纳准备/冻结/normal/冷核')
            record['outerWindow'] = {'stepSeconds': 1260, 'jobFinishBeforeSeconds': 1680, 'uploadReserveSeconds': 120}
            startup_deadline = min(start + 60, outer_deadline)
            source_before_setup = b.source_binding('normal', startup_deadline)
            runtime = b.runtime_binding('normal', startup_deadline)
            b.atomic_json(output / 'source-before-setup.json', source_before_setup)
            for directory in (REPOSITORY / 'node_modules', REPOSITORY / 'frontend/node_modules', REPOSITORY / '.agent-output/ux-c-browser'):
                b.require(not directory.exists(), '安装/产品输出必须从本次独立不存在目录开始')
            cache = output / 'browser-cache'
            b.require(not cache.exists(), 'browser cache不是本次独占目录')
            cache.mkdir()
            npm_cli = Path(runtime['node']['physicalPath']).parent.parent / 'lib/node_modules/npm/bin/npm-cli.js'
            npm_package = npm_cli.parent.parent / 'package.json'
            b.require(b.read_json(npm_package).get('name') == 'npm', 'setup-node安装器来源不符')
            config_directory = output / 'npm-config'
            config_directory.mkdir(exist_ok=False)
            config_sources = {}
            for role in ('user', 'global'):
                path = config_directory / (role + '.npmrc')
                with path.open('xb'):
                    pass
                config_sources[role] = b.file_ref(path)
                b.require(config_sources[role]['bytes'] == 0
                          and config_sources[role]['sha256'] == b.sha_bytes(b''), 'npm配置必须是本场独占空文件')
            setup_environment = {'PATH': str(Path(runtime['node']['physicalPath']).parent) + ':/usr/bin:/bin',
                                 'LANG': 'C.UTF-8', 'TZ': 'UTC', 'CI': 'true', 'TMPDIR': str(output / 'tmp'),
                                 'PLAYWRIGHT_BROWSERS_PATH': str(cache), 'NPM_CONFIG_CACHE': str(output / 'npm-cache'),
                                 'NPM_CONFIG_USERCONFIG': config_sources['user']['path'],
                                 'NPM_CONFIG_GLOBALCONFIG': config_sources['global']['path'], 'DEBIAN_FRONTEND': 'noninteractive'}
            setup_input = {'format': 'NSO_SETUP_INPUT_V1', 'repository': str(REPOSITORY), 'output': str(output),
                           'node': runtime['node'], 'npmCLI': b.file_ref(npm_cli),
                           'methodSHA256': method_id['sha256'], 'releaseSHA256': b.identity(release_path)['sha256'],
                           'npmConfigs': config_sources, 'commandEnvironment': setup_environment}
            b.atomic_json(output / 'setup-input.json', setup_input)
            b.atomic_json(output / 'setup-runtime.json', {'runtime': runtime, 'npmPackage': b.file_ref(npm_package),
                          'parentEnvironment': b.parent_fingerprints()})
            helper = verified_module('xiyou_nso_owned_setup', 'owned_processes.py', b.HELPER_SHA)
            setup_child = {**setup_environment, 'XIYOU_NSO_SETUP_INPUT': str(output / 'setup-input.json'),
                           'XIYOU_NSO_SETUP_INPUT_SHA256': b.identity(output / 'setup-input.json')['sha256']}
            if os.environ.get('LD_LIBRARY_PATH'):
                setup_child['LD_LIBRARY_PATH'] = os.environ['LD_LIBRARY_PATH']
            setup_entered = True
            setup_report = run_owned(helper, [runtime['python']['physicalPath'], '-I', str(DIRECTORY / 'setup-driver.py')],
                                     setup_child, output, 'setup', b.SETUP_BUDGET)
            record['setup'] = {'exitCode': setup_report.get('root', {}).get('exitCode'),
                               'elapsedSeconds': setup_report['elapsedSeconds'], 'clean': clean(setup_report),
                               'qualified': setup_report['supervisionQualified']}
            b.require(clean(setup_report), '准备后代清理未确认，禁止冷取证和normal')
            b.require(setup_report['supervisionQualified'] and record['setup']['exitCode'] == 0, '准备失败/信号/超时；normal未开始')
            config_after = {role: b.file_ref(config_directory / (role + '.npmrc')) for role in ('user', 'global')}
            b.atomic_json(output / 'setup-npm-config-after.json', config_after)
            b.require(config_after == config_sources, '准备改变了本场固定空npm配置')
            source_after_setup = b.source_binding('normal', min(time.monotonic() + 60, outer_deadline))
            b.atomic_json(output / 'source-after-setup.json', source_after_setup)
            b.require(source_before_setup == source_after_setup, '安装改变了产品/方法来源')
            b.require(outer_deadline - time.monotonic() >= 400, '冻结+normal132秒+冷核的余量不足')
            value = b.make_input('normal', output, cache, release_path, min(time.monotonic() + 120, outer_deadline - 280))
            b.atomic_json(input_path, value)
            before = value['bindings']
            b.atomic_json(output / 'source-before.json', before)
            b.require(outer_deadline - time.monotonic() >= 280, 'normal132秒及冷核余量不足，不claim normal')
            b.atomic_json(output / 'normal-attempt.json', {'allocationId': release['allocationId'], 'startedAt': utc(),
                          'attemptConsumed': True, 'budget': b.BUDGETS['normal'], 'retries': 0,
                          'inputSHA256': b.identity(input_path)['sha256'], 'releaseSHA256': b.identity(release_path)['sha256']})
            record['normalAttemptConsumed'] = True
        else:
            cache = None
            value = b.read_json(input_path, 33554432)
            b.require(value['format'] == 'NSO_INPUT_V1' and value['stage'] == 'finite'
                      and value['repository'] == str(REPOSITORY) and value['outputDirectory'] == str(output)
                      and value['methodSHA256'] == method_id['sha256'] and value['releaseSHA256'] is None, '有限冻结输入不符')
            before = b.snapshot('finite', output, deadline=time.monotonic() + 120)
            b.require(before == value['bindings'] and before['git']['effectiveTree'] == release['candidateTree'], '有限实际来源/候选tree不等于已释放输入')
            b.require(value['childEnvironmentBase'] == b.child_base('finite', output, before['runtime']), '有限实际子环境规则不符')
            b.atomic_json(output / 'source-before.json', before)
            helper = verified_module('xiyou_nso_owned_finite', 'owned_processes.py', b.HELPER_SHA)
        b.require(not (output / 'diagnostic').exists() and not (output / 'product').exists(), '本场产品原件目录已存在')
        if is_ci:
            b.require(not (REPOSITORY / '.agent-output/ux-c-browser').exists(), '原PG输出目录不是本场独占')
        environment = command_environment(value, input_path, release_path)
        command = [before['runtime']['node']['physicalPath']]
        if is_ci:
            command += ['--import', str(DIRECTORY / 'preload.mjs'), str(REPOSITORY / 'frontend/tests/client-experience-browser.mjs'), 'normal']
        else:
            command += ['--test-reporter=tap', str(DIRECTORY / 'finite-check.mjs')]
        record['command'] = command
        record['childEnvironment'] = environment
        record['input'] = b.file_ref(input_path)
        record['helperSourceLoad'] = {'path': str(DIRECTORY / 'owned_processes.py'), 'bytes': 22190,
                                     'sha256': b.HELPER_SHA, 'mode': 'VERIFIED_SOURCE_BYTES_COMPILE', 'pycRead': False}
        product_allowed = True
        normal_entered = True
        normal_report = run_owned(helper, command, environment, output, 'normal', b.BUDGETS[stage])
        record['nodeStarted'] = normal_report['rootSpawned']
        record['nodeExitCode'] = normal_report.get('root', {}).get('exitCode')
        record['nodeElapsedSeconds'] = normal_report['elapsedSeconds']
        b.require(clean(normal_report), '本场后代/进程组清理未确认，禁止冷收取')
        # 后续所有hash/parse只在已证clean边界之后；原错误/负退出仍保留。
        record['coldCollectionSafe'] = True
        after_deadline = time.monotonic() + (60 if is_ci else 120)
        after = b.snapshot(stage, output, cache, deadline=after_deadline)
        b.atomic_json(output / 'source-after.json', after)
        record['sourceStable'] = before == after
        b.require(record['sourceStable'], '本场源/依赖/二进制/完整cache前后变化')
        if is_ci:
            record['evidenceCollectionAttempted'] = True
            record['evidenceCollection'] = preserve_product(output)
        else:
            record['evidenceCollection'] = '有限原件不含产品/PG目录；仅本场diagnostic和原生TAP'
        b.require(normal_report['supervisionQualified'], '监督信号/负退出/错误/残留使方法无效')
        record['qualification'] = verify_normal(output, value, input_path) if is_ci else verify_finite(output, value)
        b.require(record['nodeExitCode'] in (0, 1) if is_ci else record['nodeExitCode'] == 0, '原Node退出状态不符')
        if is_ci:
            b.require((record['nodeExitCode'] == 0) == (record['qualification']['productAssessment'] == 'PASS'), '原产品assessment与Node退出不一致')
        record['runnerExitCode'] = record['nodeExitCode']
    except BaseException as failure:
        record['errors'].append({'type': type(failure).__name__, 'message': str(failure)[:512]})
        record['runnerExitCode'] = 125
    finally:
        setup_safe = not setup_entered or clean(setup_report)
        normal_safe = not normal_entered or clean(normal_report)
        record['coldCollectionSafe'] = setup_safe and normal_safe
        if not record['coldCollectionSafe']:
            record['evidenceCollection'] = 'NOT_COLLECTED_CLEANUP_UNCONFIRMED'
        elif product_allowed and is_ci and not record['evidenceCollectionAttempted']:
            # 有清理证明的失败场仍保留本场原件；从未批准的既有目录不在此路径。
            try:
                if not (output / 'product-evidence-manifest.json').exists():
                    record['evidenceCollectionAttempted'] = True
                    record['evidenceCollection'] = preserve_product(output)
            except BaseException as failure:
                record['errors'].append({'type': type(failure).__name__, 'message': '本场冷原件收取失败'})
                record['runnerExitCode'] = 125
        logs = [('stdout', 'normal-stdout.log', normal_safe), ('stderr', 'normal-stderr.log', normal_safe)]
        if is_ci:
            logs += [('setupStdout', 'setup-stdout.log', setup_safe), ('setupStderr', 'setup-stderr.log', setup_safe)]
        log_deadline = time.monotonic() + 20
        for name, filename, safe in logs:
            try:
                record[name] = digest_output(output / filename, safe, log_deadline)
            except BaseException as failure:
                record[name] = {'path': str(output / filename), 'sealed': False, 'state': 'COLD_LOG_HASH_FAILED'}
                record['errors'].append({'type': type(failure).__name__, 'message': '本场日志封口失败'})
                record['runnerExitCode'] = 125
        record['finishedAt'] = utc()
        record['totalElapsedSeconds'] = time.monotonic() - start
        b.atomic_json(output / 'execution.json', record)
        if is_ci and os.environ.get('GITHUB_OUTPUT'):
            with Path(os.environ['GITHUB_OUTPUT']).open('a') as handle:
                handle.write('evidence_safe=' + ('true' if record['coldCollectionSafe'] else 'false') + '\n')
        print(json.dumps({'stage': stage, 'nodeExitCode': record['nodeExitCode'], 'runnerExitCode': record['runnerExitCode'],
                          'naturalQualified': False, 'coldCollectionSafe': record['coldCollectionSafe'],
                          'output': str(output)}, ensure_ascii=False))
    return record['runnerExitCode']


if __name__ == '__main__':
    raise SystemExit(entry())
