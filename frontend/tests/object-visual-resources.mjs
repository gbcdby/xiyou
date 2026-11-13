import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer as createVite } from 'vite';
import { repository, until, sha256, saveJSON } from './network-support.mjs';

/** 隔离消费者部署：只覆盖静态目录模块，测试 SVG 由浏览器拦截返回，生产目录始终为空。 */
export async function checkObjectResources({ browser, output, report, samples }) {
  const base = samples.loose, held = samples.held, fixed = samples.fixed;
  const catalog = { 'timber-brace': { contentVersion: base.projection.contentVersion, mapVersion: base.projection.mapVersion, sceneId: base.projection.scene.sceneId, variants: {
    loose: { file: '/tests/controlled-object.svg', width: 40, height: 40, pivot: { x: 20, y: 20 }, scale: 1, layer: 'object' },
    icon: { file: '/tests/controlled-object-icon.svg', width: 40, height: 40, pivot: { x: 20, y: 20 }, scale: 1, layer: 'object' },
  } } };
  const evidence = { scope: '真实Vue消费者；授权样本来自本次真实GUI，变体/同key/新view是受控扰动，测试SVG不是正式美术', catalog, catalogSha256: sha256(catalog), requests: [], checks: [] };
  let vite, context;
  const check = name => { evidence.checks.push({ name, status: 'PASS' }); report.checks.push({ name, status: 'PASS', scope: 'controlled-consumer' }); };
  try {
    vite = await createVite({ root: resolve(repository, 'frontend'), configFile: resolve(repository, 'frontend/vite.config.mjs'), configLoader: 'native', cacheDir: resolve(output, 'resource-vite-cache'),
      plugins: [{ name: 'controlled-object-catalog', enforce: 'pre', load(id) { if (id === resolve(repository, 'frontend/src/assets/gaolao-object-art.json')) return JSON.stringify(catalog); } }],
      server: { host: '127.0.0.1', port: 0, fs: { allow: [repository] } } });
    await vite.listen(); context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on('pageerror', error => report.pageErrors.push({ scope: 'controlled-consumer', message: error.message }));
    let mode = 'fail', ordinal = 0; const pending = [];
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect x="4" y="10" width="32" height="20" fill="#53806f"/></svg>';
    const complete = route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg });
    await page.route('**/tests/controlled-object*.svg*', async route => {
      ordinal++; evidence.requests.push({ url: new URL(route.request().url()).pathname + new URL(route.request().url()).search, mode, ordinal });
      if (mode === 'hold' && !route.request().url().includes('-icon')) { pending.push(route); return; }
      if (mode === 'fail' || mode === 'fail-ground' && !route.request().url().includes('-icon')) await route.abort('failed'); else await complete(route);
    });
    await page.goto(`${vite.resolvedUrls.local[0]}tests/object-visual-fixture.html`);
    await page.waitForFunction(() => Boolean(window.objectVisualFixture));
    const set = value => page.evaluate(value => window.objectVisualFixture.setSnapshot(value), value);
    const map = page.locator('.spatial-map');
    const count = (locator, expected, label) => until(async () => await locator.count() === expected, label, 5000);
    const pictured = async name => { const path = resolve(output, name); await page.screenshot({ path, fullPage: true }); report.screenshots.push({ file: name, sha256: sha256(await readFile(path)), scope: 'controlled-consumer' }); };
    await set(base);
    await page.locator('.spatial-map-note').getByRole('button', { name: '重新载入图像', exact: true }).waitFor();
    assert.equal(await map.locator('.spatial-object-art image').count(), 0);
    const brace = base.projection.items.find(item => item.visualKey === 'timber-brace');
    const braceNode = map.locator('.spatial-item[aria-label="选择公共门撑"]');
    const hitRadius = await braceNode.locator('.spatial-hit').getAttribute('r');
    await braceNode.focus(); await braceNode.press('Enter');
    assert.equal((await page.evaluate(() => window.objectVisualFixture.selections())).at(-1), brace.entityRef);
    mode = 'good'; await page.locator('.spatial-map-note').getByRole('button', { name: '重新载入图像', exact: true }).click();
    await count(map.locator('.spatial-object-art image'), 1, '失败重试仅加载已登记资源');
    assert.equal(await braceNode.locator('.spatial-hit').getAttribute('r'), hitRadius);
    assert.equal(await map.locator('.spatial-object-art image').evaluate(node => getComputedStyle(node).pointerEvents), 'none');
    assert.deepEqual(await page.evaluate(() => window.objectVisualFixture.actions()), []);
    await pictured('controlled-resource-retry.png'); check('受控文件失败仍能键盘选同一对象；重试不发世界动作且原命中区不变');

    await set(held); await count(map.locator('.spatial-object-art image'), 0, '持有后撤去地面层');
    await count(page.locator('.spatial-inventory-art image'), 1, '本人行囊消费原物件引用');
    mode = 'hold'; await set(base); await until(() => pending.length === 1, '原散放资源仍在加载');
    await set(held); await complete(pending.shift());
    await page.waitForLoadState('networkidle');
    assert.equal(await map.locator('.spatial-object-art image').count(), 0);
    check('散放请求迟到完成不能复活held地面实例，行囊独立');

    await set(base); await until(() => pending.length === 1, '固定前慢资源');
    await set(fixed); await complete(pending.shift()); await page.waitForLoadState('networkidle');
    assert.equal(await map.locator('.spatial-object-art image').count(), 0);
    assert.equal(await map.locator('.spatial-item path').count(), 2, '缺fixed变体只保留两件授权占位');
    check('当前fixed缺层不使用loose旧图，迟到完成不能覆盖新状态');

    await set(base); await until(() => pending.length === 1, '隐藏前慢资源');
    const hidden = structuredClone(base); hidden.projection.items = hidden.projection.items.filter(item => item.entityRef !== brace.entityRef);
    await set(hidden); await complete(pending.shift()); await page.waitForLoadState('networkidle');
    assert.equal(await map.locator('.spatial-item[aria-label="选择公共门撑"]').count(), 0);
    await set(base); await until(() => pending.length === 1, '旧view慢资源');
    const next = structuredClone(base); next.viewId = 'object-fixture-new-view'; next.projection.items.forEach(item => { item.visualKey = 'constructor'; });
    await set(next); await complete(pending.shift()); await page.waitForLoadState('networkidle');
    assert.equal(await map.locator('.spatial-object-art image').count(), 0);
    const requestCount = evidence.requests.length;
    await set(next); await page.waitForLoadState('networkidle'); assert.equal(evidence.requests.length, requestCount);
    assert.equal(await page.getByRole('button', { name: '重新载入图像', exact: true }).count(), 0);
    check('隐藏/换view撤销旧实例；constructor未知键不请求资源且不遗留错误');

    const twins = structuredClone(base); twins.viewId = 'object-fixture-twins'; twins.projection.items.forEach(item => { item.visualKey = 'timber-brace'; });
    mode = 'good'; await set(twins);
    await count(map.locator('.spatial-object-art image'), 2, '同key两个ref各有独立实例');
    const instances = await map.locator('.spatial-item .spatial-object-art').evaluateAll(nodes => nodes.map(node => ({ identity: JSON.parse(node.dataset.objectInstance), ready: Boolean(node.querySelector('image')) })));
    assert.equal(instances.length, 2); assert.notDeepEqual(instances[0].identity, instances[1].identity);
    for (const object of twins.projection.items) { const node = map.locator(`.spatial-item[aria-label="选择${object.name}"]`); await node.focus(); await node.press('Enter'); assert.equal((await page.evaluate(() => window.objectVisualFixture.selections())).at(-1), object.entityRef); }
    // 浏览器可合并同 URL 的请求；用同key的地面/行囊两种已登记变体隔离失败，不假设每实例都发独立HTTP。
    const split = structuredClone(twins); split.viewId = 'object-fixture-split';
    split.projection.items[1].location = { kind: 'held', ownerRef: split.projection.self.entityRef };
    mode = 'fail-ground'; await set(split);
    await count(map.locator('.spatial-object-art image'), 0, '地面变体失败');
    await count(page.locator('.spatial-inventory-art image'), 1, '同key另一个ref的行囊变体继续可见');
    await page.locator('.spatial-map-note').getByRole('button', { name: '重新载入图像', exact: true }).waitFor();
    split.projection.items = split.projection.items.slice(1);
    await set(split); await until(async () => await page.getByRole('button', { name: '重新载入图像', exact: true }).count() === 0, '删除失败实例同时删除错误统计');
    assert.equal(await page.locator('.spatial-inventory-art image').count(), 1);
    check('同key不同ref独立选择、失败与删除，剩余实例不受影响');

    mode = 'fail'; await set(held);
    const inventory = page.locator('.spatial-inventory-pane'); await inventory.getByRole('button', { name: '重新载入图像', exact: true }).waitFor();
    mode = 'good'; await inventory.getByRole('button', { name: '重新载入图像', exact: true }).click();
    await count(inventory.locator('image'), 1, '行囊失败重试');
    assert.deepEqual(await page.evaluate(() => window.objectVisualFixture.actions()), []);
    await set(null); assert.equal(await page.locator('.spatial-object-art').count(), 0);
    check('行囊独立回退/重试不发动作，撤销视图清空全部地图与图标');
    evidence.assessment = 'PASS';
  } catch (error) { evidence.assessment = 'FAIL'; evidence.error = error.stack; throw error; }
  finally { await context?.close(); await vite?.close(); await saveJSON(resolve(output, 'controlled-resource-result.json'), evidence); }
}
