import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer as createVite } from 'vite';
import { chromium } from 'playwright';
import { startTestPostgres } from '../../backend/test-support/postgres.mjs';
import { createAuthorityServer } from '../../backend/server.mjs';
import { accepted, take, share } from '../../backend/test-support/gaolao-room.mjs';
import { repository, sourceIdentity, saveJSON, sha256, until } from './network-support.mjs';
import { browserRoom, snapshot, selectObject, openReading, closeReading } from './gaolao-real-support.mjs';
import { checkObjectResources } from './object-visual-resources.mjs';

const baseline = process.argv.includes('--baseline');
const output = resolve(process.env.FRONTEND_EVIDENCE_DIR || resolve(repository, '.agent-output/object-visuals/browser'));
await mkdir(output, { recursive: true });
const report = { scope: '首章物件接线：真实Vue/两账号/HTTP/Socket/PostgreSQL；不是正式素材或真人艺术验收', baseline, source: await sourceIdentity(), checks: [], humanActions: [], npcActions: [], recapResponses: [], pageErrors: [], screenshots: [], cleanup: [] };
let database, server, vite, browser, room;
const check = (name, details = {}) => { report.checks.push({ name, status: 'PASS', ...details }); console.log(JSON.stringify({ check: name })); };
async function picture(page, name) { const path = resolve(output, name); await page.screenshot({ path, fullPage: true }); report.screenshots.push({ file: name, sha256: sha256(await readFile(path)) }); }
async function state(name, player = 0) {
  const current = await snapshot(room.pages[player]); report.samples ??= {}; report.samples[name] = current;
  const visibleGround = current.projection.items.filter(item => item.location.kind === 'ground' && item.location.sceneId === current.projection.scene.sceneId);
  await until(async () => await room.pages[player].locator('.spatial-item').count() === visibleGround.length, name + '地面数量与当前投影相等');
  assert.equal(await room.pages[player].locator('.spatial-object-art image').count(), 0, '正式目录为空，只显示占位');
  for (const item of visibleGround) {
    const transform = await room.pages[player].locator(`.spatial-item[aria-label="选择${item.name}"]`).getAttribute('transform');
    assert.equal(transform, `translate(${item.location.position.x} ${item.location.position.y})`);
  }
  return current.projection;
}
try {
  database = await startTestPostgres('object-visual-ui', { outputSubdirectory: 'object-visuals' });
  server = await createAuthorityServer({ pool: database.pool });
  const origin = `http://127.0.0.1:${(await server.listen(0)).port}`;
  vite = await createVite({ root: resolve(repository, 'frontend'), configFile: resolve(repository, 'frontend/vite.config.mjs'), configLoader: 'native', cacheDir: resolve(output, 'vite-cache'), server: { host: '127.0.0.1', port: 0, fs: { allow: [repository] }, proxy: { '/api': { target: origin }, '/socket.io': { target: origin, ws: true } } } });
  await vite.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: process.env.CHROMIUM_ARGS ? JSON.parse(process.env.CHROMIUM_ARGS) : [] });
  room = await browserRoom({ server, browser, baseURL: `http://127.0.0.1:${vite.httpServer.address().port}`, count: 2, contentVersion: 'gaolaozhuang-scene-v2', report });
  await room.go(0, room.C('C14'));
  const item = await room.entity(0, '公共门撑');
  await selectObject(room.pages[0], item.entityRef);
  accepted(await room.send(0, { kind: 'inspect', targetRef: item.entityRef }));
  const current = await snapshot(room.pages[0]);
  if (baseline) {
    assert.ok([...current.projection.items, ...current.projection.targets].every(value => !Object.hasOwn(value, 'visualKey')));
    assert.ok(await room.pages[0].locator('.spatial-item > path').count());
    report.checks.push({ name: '旧生产入口仅有授权菱形/方块，正常选中与查看可用', status: 'OBSERVED', itemRef: item.entityRef });
  } else {
    const r = room, page = r.pages[0];
    // 翠兰只由生产 scene policy 行动，测试不得代她回应或移动。
    const send = r.send, go = r.go;
    r.send = (actor, ...args) => { assert.notEqual(actor, 'cuilan'); return send(actor, ...args); };
    r.go = (actor, ...args) => { assert.notEqual(actor, 'cuilan'); return go(actor, ...args); };
    const ground = await state('loose');
    assert.equal(ground.items.find(item => item.name === '公共门撑').visualKey, 'timber-brace');
    assert.equal(ground.items.find(item => item.name === '公共绳索').visualKey, 'hemp-rope');
    await picture(page, 'loose-selected.png');
    await r.go(0, r.C('C04')); accepted(await r.interact(0, '侧窗联络点', 'gz-contact'));
    await until(async () => (await server.runtime.replay(r.sessionId)).chapter.retreated, '生产本人实际退让确认', 20000);
    await r.go(0, r.C('C01')); accepted(await r.interact(0, '铜封门', 'gz-check-seal')); await r.go('wukong', r.C('C01'));
    await share(r, 0, '侧窗本人回应', '孙悟空'); await share(r, 0, '亲自在门外检查铜封', '孙悟空');
    for (const [player, name] of [[0, '公共门撑'], [1, '公共绳索']]) { await r.go(player, r.C('C14')); await take(r, player, name); }
    const held = await state('held'); assert.equal(held.items.find(item => item.visualKey === 'timber-brace').location.kind, 'held');
    await openReading(page, '行囊'); assert.equal(await page.locator('.spatial-inventory').getByRole('heading', { name: '公共门撑', exact: true }).count(), 1);
    await picture(page, 'held-inventory.png'); await closeReading(page);
    await r.go(0, r.C('C02')); await r.go(1, r.C('C03'));
    const cooperation = async (phase, expected) => {
      const current = (await r.snapshot(0)).projection.cooperations[0];
      accepted(await r.send(0, { kind: 'cooperate', operationId: current.operationId, operationVersion: current.operationVersion, phase }));
      await until(async () => (await r.snapshot(0)).projection.cooperations[0].readyCount === expected, '真实协作总人数 ' + expected);
      const labels = page.locator('.spatial-cooperation').getByRole('button', { name: /^前往位置/ });
      assert.equal(await labels.count(), 2); assert.deepEqual(await labels.evaluateAll(nodes => nodes.map(node => node.className)), ['text-button', 'text-button']);
    };
    assert.equal((await r.snapshot(0)).projection.cooperations[0].readyCount, 0);
    await cooperation('prepare', 0); await cooperation('ready', 1); await cooperation('cancel', 0); await cooperation('ready', 1);
    const second = (await r.snapshot(1)).projection.cooperations[0];
    accepted(await r.send(1, { kind: 'cooperate', operationId: second.operationId, operationVersion: second.operationVersion, phase: 'ready' }));
    await until(async () => (await r.snapshot(0)).projection.cooperations[0].phase === 'locked', '两人正常就位后权威固定');
    const fixed = await state('fixed');
    for (const key of ['timber-brace', 'hemp-rope']) { const tool = fixed.items.find(item => item.visualKey === key); assert.deepEqual(tool.location, { kind: 'ground', sceneId: 'gaolao-courtyard', position: { x: 1250, y: 425 } }); assert.equal(tool.fields.find(field => field.key === 'fixed').value, true); }
    assert.equal(fixed.targets.find(target => target.visualKey === 'timber-door').fields.find(field => field.key === 'open').value, false);
    await picture(page, 'fixed-placeholders.png');
    await r.go(0, r.C('C04'));
    assert.ok((await r.snapshot(1)).projection.items.filter(item => ['timber-brace', 'hemp-rope'].includes(item.visualKey)).every(item => item.fields.some(field => field.key === 'fixed' && field.value === true)));
    await r.go(0, r.C('C01')); accepted(await r.interact('wukong', '铜封门', 'gz-break-seal'));
    await until(async () => (await r.snapshot(0)).projection.targets.find(target => target.visualKey === 'timber-door')?.fields.some(field => field.key === 'open' && field.value === true), '确认门开放后展示结果');
    await state('door-open');
    accepted(await r.interact(0, '门撑承力点', 'gz-release-support'));
    const released = await state('released');
    for (const key of ['timber-brace', 'hemp-rope']) { const tool = released.items.find(item => item.visualKey === key); assert.equal(tool.location.kind, 'ground'); assert.deepEqual(tool.location.position, { x: 1250, y: 425 }); assert.ok(!tool.fields.some(field => field.key === 'fixed')); }
    assert.equal(released.targets.find(target => target.visualKey === 'support-point').fields.find(field => field.key === 'locked').value, true);
    assert.equal(released.cooperations[0].phase, 'locked');
    await page.getByRole('button', { name: '附近对象与出口', exact: true }).click();
    const history = page.locator('.spatial-cooperation .spatial-status');
    await history.scrollIntoViewIfNeeded(); assert.match(await history.innerText(), /协作已提交/);
    assert.match(await page.locator('.spatial-selection .spatial-fields').innerText(), /协作已提交[\s\S]*已满足/);
    assert.doesNotMatch(await page.locator('.spatial-selection .spatial-fields').innerText(), /门撑锁定/);
    await picture(page, 'released-history.png');
    for (const name of ['公共门撑', '公共绳索']) await take(r, 0, name);
    await state('held-again'); await r.go(0, r.C('C14'));
    for (const name of ['公共门撑', '公共绳索']) { const item = await r.entity(0, name); accepted(await r.interact(0, '公共工具借还架', 'gz-return-public', { itemRef: item.entityRef, expectedItemRevision: item.resourceRevision })); }
    const returned = await state('returned');
    for (const key of ['timber-brace', 'hemp-rope']) { const tool = returned.items.find(item => item.visualKey === key); assert.equal(tool.location.kind, 'ground'); assert.deepEqual(tool.location.position, { x: 315, y: 390 }); assert.ok(!tool.fields.some(field => field.key === 'fixed')); }
    assert.ok(returned.items.every(item => item.location.kind !== 'held' || item.location.ownerRef !== returned.self.entityRef));
    await picture(page, 'returned-ground.png');
    assert.ok(report.npcActions.every(action => action.role !== 'cuilan'));
    check('scene-v2正常UI：选物/拾取/本人行囊/prepare-ready-cancel/独立固定/本人退让后开门/撤收/再拾取/实际归还', { humanReceipts: report.humanActions.length, productionCuilan: true, emptyReleasedCatalog: true });
    await saveJSON(resolve(output, 'authorized-samples.json'), report.samples);
    await checkObjectResources({ browser, output, report, samples: report.samples });
  }
  report.snapshot = current;
  const image = resolve(output, 'ground-selection.png'); await room.pages[0].screenshot({ path: image, fullPage: true });
  report.screenshots.push({ file: 'ground-selection.png', sha256: sha256(await readFile(image)) });
  assert.deepEqual(report.pageErrors, []);
  report.sourceEnd = await sourceIdentity(); assert.deepEqual(report.sourceEnd, report.source, '检查期间源码保持同一身份');
  report.assessment = 'PASS';
} catch (error) {
  report.assessment = 'FAIL'; report.error = error.stack; console.error(error);
  for (const [index, page] of (room?.pages || []).entries()) await page.screenshot({ path: resolve(output, `failure-${index}.png`), fullPage: true }).catch(() => {});
} finally {
  for (const [name, close] of [['browser', () => browser?.close()], ['vite', () => vite?.close()], ['server', () => server?.close()], ['postgres', () => database?.stop()]]) { await close(); report.cleanup.push(name); }
  report.resourcesClosed = true; await saveJSON(resolve(output, 'result.json'), report);
  console.log(JSON.stringify({ assessment: report.assessment, checks: report.checks.length, output })); if (report.assessment !== 'PASS') process.exitCode = 1;
}
