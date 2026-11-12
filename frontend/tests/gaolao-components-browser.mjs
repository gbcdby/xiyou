import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer as createVite } from 'vite';
import { repository, saveJSON, sha256, sourceIdentity } from './network-support.mjs';

const output = resolve(process.env.FRONTEND_EVIDENCE_DIR || resolve(repository, '.agent-output/adv001-33-a2/gaolao-components'));
await mkdir(output, { recursive: true });
const report = { scope: '真实Vue/Chromium与隔离组件受控DTO；不连接后端，不证明完整章节', source: await sourceIdentity(), startedAt: new Date().toISOString(), checks: [], pageErrors: [], screenshots: [] };
const reference = letter => 'R' + letter.repeat(32);
const check = name => { report.checks.push({ name, status: 'PASS' }); console.log(JSON.stringify({ check: name })); };
let vite; let browser; let page;
try {
  vite = await createVite({ root: resolve(repository, 'frontend'), configFile: resolve(repository, 'frontend/vite.config.mjs'), configLoader: 'native', cacheDir: resolve(output, 'vite-cache'), server: { host: '127.0.0.1', port: 0, fs: { allow: [repository] } } });
  await vite.listen();
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: process.env.CHROMIUM_ARGS ? JSON.parse(process.env.CHROMIUM_ARGS) : [] });
  report.browserVersion = browser.version(); page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 }); page.setDefaultTimeout(5000);
  page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.goto(`${vite.resolvedUrls.local[0]}tests/gaolao-fixture.html`);
  const chapter = page.getByRole('region', { name: '授权章节状态', exact: true });
  const comparison = page.getByRole('region', { name: '授权来源比较', exact: true });
  const recap = page.getByRole('region', { name: '授权历史复盘', exact: true });
  await chapter.getByRole('heading', { name: '带路与安置', exact: true }).waitFor();
  assert.doesNotMatch(await page.locator('body').innerText(), /孙悟空|借貌安排|R[a-z]{32}/, '未获知视角不靠组件标签泄露真身或引用');
  assert.match(await chapter.innerText(), /已到达，尚未确认安置/);
  assert.match(await chapter.innerText(), /尚未作出决定/);
  assert.match(await chapter.innerText(), /本人暂缓/);
  assert.equal(await chapter.locator('.gaolao-state-card').first().getByRole('button').count(), 0, '不能替第一位翠兰回应');
  assert.equal(await chapter.getByRole('button', { name: '我同意这次安排', exact: true }).count(), 1);
  await chapter.getByRole('button', { name: '我同意这次安排', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.gaolaoFixture.actions()[0]), { kind: 'respond_consent', consentId: reference('o'), expectedConsentVersion: '4', response: 'accept' });
  assert.match(await chapter.innerText(), /等待本人回应/, '发出意图不能乐观展示服务端接受');
  check('只展示授权身份与用途；到达/安置、未决/暂缓区分，本人按钮不替同名人物代签');

  await page.evaluate(() => window.gaolaoFixture.settle());
  assert.match(await chapter.innerText(), /已确认安置/);
  await page.evaluate(() => window.gaolaoFixture.withdraw());
  assert.match(await chapter.innerText(), /已撤回或被新安排替代/);
  const progress = chapter.locator('section').first();
  assert.match(await progress.innerText(), /翠兰已确认安置[\s\S]*已满足/, '撤回不回滚已确认安置事实');
  await chapter.getByRole('button', { name: '我确认本轮选择', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.gaolaoFixture.actions().at(-1)), { kind: 'confirm_end', proposalId: 'round-1', proposalVersion: '3' });
  await page.evaluate(() => window.gaolaoFixture.invalidateEnd());
  assert.equal(await chapter.getByRole('button', { name: '我确认本轮选择', exact: true }).count(), 0);
  assert.match(await chapter.innerText(), /同行人员变化，须重新提议/);
  await page.evaluate(() => window.gaolaoFixture.decide('declined'));
  assert.match(await chapter.innerText(), /本人已拒绝/);
  await page.evaluate(() => window.gaolaoFixture.decide('undecided'));
  assert.doesNotMatch(await chapter.innerText(), /本人已拒绝/, '未决不能显示成拒绝');
  check('撤回保留实际安置事实，在线确认轮失效即撤下按钮，未决与拒绝不混用');

  await comparison.getByRole('checkbox').nth(0).check(); await comparison.getByRole('checkbox').nth(1).check();
  assert.match(await comparison.innerText(), /他人陈述/);
  await comparison.getByRole('button', { name: '提交来源比较', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.gaolaoFixture.actions().at(-1)), { kind: 'interact', targetRef: reference('m'), operationId: 'gz-compare-sources', expectedTargetRevision: '12', parameters: { evidenceRefs: [reference('d'), reference('e')] } });
  assert.match(await comparison.innerText(), /他人陈述/, '比较意图不把陈述改成事实');
  await page.evaluate(() => window.gaolaoFixture.sourceDuplicate());
  assert.equal(await comparison.getByRole('button', { name: '提交来源比较', exact: true }).isDisabled(), true);
  await page.evaluate(() => window.gaolaoFixture.resetSources());
  await page.evaluate(() => window.gaolaoFixture.newView());
  assert.equal(await comparison.locator('input:checked').count(), 0, '换视图清除已选来源');
  await comparison.getByRole('checkbox').nth(0).check(); await comparison.getByRole('checkbox').nth(1).check();
  await page.evaluate(() => window.gaolaoFixture.removeSource());
  assert.equal(await comparison.getByRole('button', { name: '提交来源比较', exact: true }).isDisabled(), true);
  check('比较请求使用严格有限操作/当前版本/原引用；同源重复、来源消失与换视图不保留可提交旧选择');

  await page.evaluate(() => window.gaolaoFixture.reveal());
  assert.match(await chapter.innerText(), /已获知借貌安排/);
  assert.match(await recap.innerText(), /当时称呼：翠兰/);
  assert.doesNotMatch(await recap.innerText(), /孙悟空|借貌/);
  await page.evaluate(() => window.gaolaoFixture.recapError());
  assert.match(await recap.innerText(), /我想先看看安排/);
  assert.match(await recap.innerText(), /过程还未读完/);
  assert.doesNotMatch(await recap.innerText(), /过程已读完/);
  await recap.getByRole('button', { name: '重试读取过程', exact: true }).click();
  assert.equal(await page.evaluate(() => window.gaolaoFixture.loads()), 1);
  for (const [code, title] of [['GZ-E01', '自愿同行'], ['GZ-E02', '各走各路'], ['GZ-E03', '暂告一段']]) {
    await page.evaluate(code => window.gaolaoFixture.ending(code), code);
    assert.equal(await recap.getByRole('heading', { name: title, exact: true }).isVisible(), true);
    assert.match(await recap.innerText(), /翠兰已确认安置[\s\S]*已满足/);
  }
  check('后来合法获知不改写历史称呼，分页失败保留已读且明确未完，三类结果保留各自授权事实');

  const desktop = resolve(output, 'gaolao-components-desktop.png'); await page.screenshot({ path: desktop, fullPage: true });
  report.screenshots.push({ file: 'gaolao-components-desktop.png', sha256: sha256(await readFile(desktop)), viewport: { width: 1600, height: 1000 } });
  await page.setViewportSize({ width: 390, height: 844 });
  const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  assert.ok(widths.content <= widths.viewport, '窄视口不得横向溢出');
  const narrow = resolve(output, 'gaolao-components-narrow.png'); await page.screenshot({ path: narrow, fullPage: true });
  report.screenshots.push({ file: 'gaolao-components-narrow.png', sha256: sha256(await readFile(narrow)), viewport: { width: 390, height: 844 }, widths });
  await page.evaluate(() => window.gaolaoFixture.forbid());
  assert.equal(await chapter.count(), 0); assert.equal(await comparison.count(), 0);
  assert.doesNotMatch(await recap.innerText(), /翠兰|各走各路|暂告一段|我想先看看安排/);
  assert.equal(await recap.getByRole('button').count(), 0);
  check('桌面与窄视口实际渲染；明确撤权后章节、材料、授权结局和历史内容清空');
  assert.deepEqual(report.pageErrors, []); report.assessment = 'PASS';
} catch (error) {
  report.assessment = 'FAIL'; report.error = error.stack; console.error(error);
  if (page) await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
  await browser?.close(); await vite?.close(); report.finishedAt = new Date().toISOString(); report.resourcesClosed = true;
  await saveJSON(resolve(output, 'result.json'), report); console.log(JSON.stringify({ assessment: report.assessment, checks: report.checks.length, output }));
  if (report.assessment !== 'PASS') process.exitCode = 1;
}
