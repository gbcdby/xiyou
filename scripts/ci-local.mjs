// 本地 CI runner：把 .github/workflows 的门槛命令镜像为可直接本地执行的顺序检查。
// 目标：日常验证在本地分钟级完成，云端只做合并前背书。远端 workflow 仍是最终依据。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const jobArg = argv.includes('--job') ? argv[argv.indexOf('--job') + 1] : 'all';
const doInstall = argv.includes('--install');
const wantInstall = argv.includes('--install-only');
// 开发迭代时可临时跳过干净树门禁；浏览器用例内部的 sourceIdentity 仍会自行核对，标记此模式不视为 CI 等价。
const allowDirty = argv.includes('--allow-dirty');
const evidenceRoot = resolve(repo, '.agent-output/ci-local');
// CI 固定 Python 3.12 + jsonschema 4.26.0；本地用项目内 venv（scripts/ci-local.mjs --install 创建）。
const ciPython = resolve(evidenceRoot, '../ci-local-venv/bin/python');
const pythonCmd = existsSync(ciPython) ? ciPython : '/opt/homebrew/bin/python3.12';

const baseEnv = {
  ...process.env,
  CI: 'true',
  CHROMIUM_ARGS: '[]',
};
delete baseEnv.CHROMIUM_PATH; // 与 CI 一致：用 Playwright 锁定的 Chromium 143（rev1200）

// 单个 step：命令数组 + 额外 env。命令整体交给 bash -c，保留 CI 里的管道/tee 语义。
const step = (name, cmd, env = {}) => ({ name, cmd, env });
const ev = name => resolve(evidenceRoot, name);
const mkdir = name => mkdirSync(ev(name), { recursive: true });

const jobs = {
  core: {
    name: '协议、规则、联机与前端构建',
    steps: [
      ...(doInstall || wantInstall ? [step('安装已锁定依赖与 CI Python venv', 'npm ci && npm ci --prefix frontend && (/opt/homebrew/bin/python3.12 -m venv .agent-output/ci-local-venv || true) && .agent-output/ci-local-venv/bin/python -m pip install --disable-pip-version-check jsonschema==4.26.0')] : []),
      step('协议与内容生成产物 --check', 'node protocol/scripts/generate.mjs --check && node protocol/scripts/generate-spatial.mjs --check && node content/scripts/generate.mjs --check'),
      step('协议与内容行为 + Schema + TS 消费', `npm run test:protocol && npm run test:content && ${pythonCmd} protocol/scripts/check-schema.py && ${pythonCmd} content/scripts/check-schema.py && frontend/node_modules/.bin/tsc --noEmit --strict --module nodenext --target es2022 protocol/tests/consumer.mts`),
      step('后端真实 PostgreSQL 与 HTTP/Socket.IO', 'npm run test:backend'),
      step('前端行为、类型与生产构建', 'npm test --prefix frontend && npm run build --prefix frontend'),
    ],
  },
  browser_static: {
    name: '首章静态资源浏览器',
    needs: 'core',
    steps: [
      step('静态资源浏览器验收', 'node frontend/tests/static-release-browser.mjs 2>&1 | tee "$FRONTEND_EVIDENCE_DIR/stdout.log"', () => { mkdir('browser-static-release'); return { FRONTEND_EVIDENCE_DIR: ev('browser-static-release'), VITE_GAOLAO_CONTENT_VERSION: 'gaolaozhuang-scene-v2' }; }),
    ],
  },
  browser_spatial: {
    name: '多人空间与对象几何浏览器',
    needs: 'core',
    steps: [
      step('多人空间浏览器检查', 'node frontend/tests/spatial-browser-check.mjs', () => { mkdir('browser-spatial'); return { FRONTEND_EVIDENCE_DIR: ev('browser-spatial') }; }),
    ],
  },
  browser_direction: {
    name: '连续输入与新模式多人浏览器',
    needs: 'core',
    steps: [
      step('对象栅格严格 RGBA 回归', 'node frontend/tests/object-raster-browser-check.mjs --freeze-only --output "$FRONTEND_EVIDENCE_DIR" 2>&1 | tee "$FRONTEND_EVIDENCE_DIR/stdout.log" && node frontend/tests/object-raster-browser-check.mjs --manifest "$FRONTEND_EVIDENCE_DIR/input-manifest.json" --output "$FRONTEND_EVIDENCE_DIR" 2>&1 | tee -a "$FRONTEND_EVIDENCE_DIR/stdout.log"', () => { mkdir('browser-object-raster'); return { FRONTEND_EVIDENCE_DIR: ev('browser-object-raster') }; }),
      step('背景捕获严格 RGBA 回归', 'node frontend/tests/background-raster-browser-check.mjs --freeze-only --output "$FRONTEND_EVIDENCE_DIR" 2>&1 | tee "$FRONTEND_EVIDENCE_DIR/stdout.log" && node frontend/tests/background-raster-browser-check.mjs --manifest "$FRONTEND_EVIDENCE_DIR/input-manifest.json" --output "$FRONTEND_EVIDENCE_DIR" 2>&1 | tee -a "$FRONTEND_EVIDENCE_DIR/stdout.log"', () => { mkdir('browser-background-raster'); return { FRONTEND_EVIDENCE_DIR: ev('browser-background-raster') }; }),
      step('呈现生命周期组件回归', 'npm run test:browser:presentation-lifecycle --prefix frontend', () => { mkdir('browser-presentation-lifecycle'); return { FRONTEND_EVIDENCE_DIR: ev('browser-presentation-lifecycle') }; }),
      step('推送通知异常连续确认回归', 'node frontend/tests/spatial-rpc-push-notify-browser.mjs 2>&1 | tee "$FRONTEND_EVIDENCE_DIR/stdout.log"', () => { mkdir('browser-rpc-push-notify'); return { FRONTEND_EVIDENCE_DIR: ev('browser-rpc-push-notify') }; }),
      step('scene-v3 动态验收 normal', 'node frontend/tests/client-experience-browser.mjs', () => { mkdir('browser-client-experience'); return { FRONTEND_EVIDENCE_DIR: ev('browser-client-experience'), VITE_GAOLAO_CONTENT_VERSION: 'gaolaozhuang-scene-v3' }; }),
      step('scene-v3 动态验收 late', 'node frontend/tests/client-experience-browser.mjs late-accepted-se-180', () => { mkdir('browser-direction-late'); return { FRONTEND_EVIDENCE_DIR: ev('browser-direction-late'), VITE_GAOLAO_CONTENT_VERSION: 'gaolaozhuang-scene-v3' }; }),
      step('scene-v3 动态验收 five-person', 'node frontend/tests/client-experience-browser.mjs five-person', () => { mkdir('browser-direction-five'); return { FRONTEND_EVIDENCE_DIR: ev('browser-direction-five'), VITE_GAOLAO_CONTENT_VERSION: 'gaolaozhuang-scene-v3' }; }),
    ],
  },
  browser_legacy: {
    name: '旧版 A2 章节浏览器',
    needs: 'core',
    steps: [
      step('旧版 A2 高老庄 2/5 人 + 授权复盘', 'npm run test:browser:gaolao --prefix frontend', () => { mkdir('browser-gaolao'); return { FRONTEND_EVIDENCE_DIR: ev('browser-gaolao'), VITE_GAOLAO_CONTENT_VERSION: 'gaolaozhuang-v1' }; }),
    ],
  },
  browser_retention: {
    name: '未决请求与恢复浏览器',
    needs: 'core',
    steps: [
      step('未决请求、持久恢复与原样重试', 'npm run test:browser:spatial-retention --prefix frontend', () => { mkdir('browser-retention'); return { FRONTEND_EVIDENCE_DIR: ev('browser-retention') }; }),
    ],
  },
  cuilan: {
    name: '翠兰本人生产流程',
    steps: [
      step('翠兰检查器与控制边界', 'node --test frontend/tests/cuilan-self-response-*.test.mjs'),
      step('真实 PG/进程故障恢复', 'CUILAN_EXPECTED_TREE="$(git rev-parse HEAD^{tree})" npm run test:fault:cuilan-restart --prefix frontend', () => { mkdir('cuilan-process-restart'); return { CUILAN_RESTART_EVIDENCE_DIR: ev('cuilan-process-restart') }; }),
      step('两人本人流程 + 三人租约故障', 'CUILAN_EXPECTED_TREE="$(git rev-parse HEAD^{tree})" npm run test:browser:cuilan-self-response --prefix frontend', () => { mkdir('browser-cuilan-self-response'); return { FRONTEND_EVIDENCE_DIR: ev('browser-cuilan-self-response') }; }),
    ],
  },
};

const allJobs = Object.keys(jobs);
const selected = jobArg === 'all' ? allJobs : jobArg.split(',');
for (const j of selected) if (!jobs[j]) { console.error(`未知 job: ${j}（可选 ${allJobs.join(',')}）`); process.exit(2); }

// CI 的 sourceIdentity 硬门禁：git status 必须干净。
if (!wantInstall && !allowDirty) {
  const status = spawnSync('git', ['status', '--short'], { cwd: repo, encoding: 'utf8' });
  if (status.stdout.trim()) {
    console.error('工作树不干净（与 CI 门禁一致，sourceIdentity 要求 status 为空）：\n' + status.stdout);
    console.error('请先提交改动；确属本地开发迭代可用 --allow-dirty，但该次结果不等价于 CI。');
    process.exit(2);
  }
}
mkdirSync(evidenceRoot, { recursive: true });

const results = [];
const t0 = Date.now();
let failed = false;
for (const key of selected) {
  const job = jobs[key];
  console.log(`\n=== JOB ${key}：${job.name} ===`);
  const jobStart = Date.now();
  for (const s of job.steps) {
    const envExtra = typeof s.env === 'function' ? s.env() : s.env;
    const env = { ...baseEnv, ...envExtra };
    const stepStart = Date.now();
    console.log(`  > ${s.name}`);
    const r = spawnSync(s.cmd, { cwd: repo, env, shell: '/bin/bash', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const ms = Date.now() - stepStart;
    const ok = r.status === 0;
    if (!ok) {
      const tail = (r.stderr || r.stdout || '').split('\n').slice(-25).join('\n');
      console.error(`  ✗ ${s.name}（${ms}ms, rc=${r.status}）\n${tail}`);
    } else {
      console.log(`  ✓ ${s.name}（${ms}ms）`);
    }
    results.push({ job: key, step: s.name, ok, ms });
    if (!ok) { failed = true; break; } // 与 CI needs 依赖一致：本 job 失败即停，不跑后续 step
  }
  console.log(`  --- job ${key} 用时 ${Date.now() - jobStart}ms ---`);
}

console.log('\n=== 汇总 ===');
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.job}/${r.step} ${r.ms}ms`);
console.log(`总用时 ${Date.now() - t0}ms`);
process.exit(failed ? 1 : 0);
