import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createServer as createVite } from 'vite';
import { spatialSnapshot } from './spatial-fixture.mjs';
import { sceneLayerFixtures } from './scene-layer-fixtures.mjs';
import { repository, until, saveJSON } from './network-support.mjs';

/** 实际Vue布局与资源生命周期回归；技术SVG只作已知几何输入，不作美术或世界事实证明。 */
export async function checkObjectGeometry({ browser, output, report }) {
  const layers = sceneLayerFixtures(), snapshot = spatialSnapshot(), p = snapshot.projection;
  p.contentVersion = layers.group.contentVersion; p.mapVersion = layers.group.mapVersion;
  p.scene = { ...p.scene, sceneId: layers.group.sceneId, width: 1600, height: 1000 };
  p.self = { ...p.self, name: '高才', appearanceId: 'gaocai', sceneId: p.scene.sceneId, position: { x: 315, y: 390 } };
  p.entities = [{ ...p.entities[0], name: p.self.name, appearanceId: 'gaocai', sceneId: p.self.sceneId, position: { ...p.self.position } }];
  const target = { entityRef: 'R' + 'b'.repeat(32), name: '灶房旧饭账', visualKey: 'ledger-book', sceneId: p.scene.sceneId, position: { x: 260, y: 405 }, resourceRevision: '1', fields: [], availableOperations: [] };
  p.targets = [target];
  const asset = { file: '/tests/geometry-book.svg', width: 1254, height: 1254, pivot: { x: 624, y: 645 }, scale: 26 / 1126, offset: { x: 32, y: -100 }, layer: 'object' };
  const catalog = { ...layers.objectCatalog, 'ledger-book': { contentVersion: p.contentVersion, mapVersion: p.mapVersion, sceneId: p.scene.sceneId, variants: { default: asset } } };
  const evidence = { scope: 'GZ-OBJ-VIS-001 / GZ-SCENE-FEEDBACK-001：真实Vue、技术SVG、当前实例加载/撤回、姓名/HUD几何与分层反馈样式', checks: [], requests: [] };
  const check = name => { evidence.checks.push({ name, status: 'PASS' }); report.checks.push({ name, status: 'PASS', scope: 'controlled-object-geometry' }); };
  let vite, context, page, mode = 'hold'; const pending = [];
  const body = '<svg xmlns="http://www.w3.org/2000/svg" width="1254" height="1254"><rect x="60" y="129" width="1126" height="1004" fill="#49687c"/></svg>';
  const fulfill = route => route.fulfill({ status: 200, contentType: 'image/svg+xml', headers: { 'Cache-Control': 'no-store' }, body });
  try {
    vite = await createVite({ root: resolve(repository, 'frontend'), configFile: resolve(repository, 'frontend/vite.config.mjs'), configLoader: 'native', cacheDir: resolve(output, 'geometry-vite-cache'),
      plugins: [{ name: 'controlled-object-geometry', enforce: 'pre', load(id) {
        if (id === resolve(repository, 'frontend/src/assets/gaolao-object-art.json')) return JSON.stringify(catalog);
        if (id === resolve(repository, 'frontend/src/assets/gaolao-scene-layers.json')) return JSON.stringify(layers.catalog);
      } }], server: { host: '127.0.0.1', port: 0, fs: { allow: [repository] } } });
    await vite.listen(); context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    page = await context.newPage(); page.on('pageerror', error => report.pageErrors.push({ scope: 'object-geometry', message: error.message }));
    await page.route('**/tests/layer-*.svg*', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: layers.files[new URL(route.request().url()).pathname] }));
    await page.route('**/tests/geometry-book.svg*', async route => {
      evidence.requests.push({ mode, url: new URL(route.request().url()).pathname + new URL(route.request().url()).search });
      if (mode === 'hold') pending.push(route); else if (mode === 'failed') await route.fulfill({ status: 404, body: '受控缺图' }); else await fulfill(route);
    });
    await page.goto(vite.resolvedUrls.local[0] + 'tests/object-visual-fixture.html');
    await page.waitForFunction(() => Boolean(window.objectVisualFixture));
    const set = value => page.evaluate(value => window.objectVisualFixture.setSnapshot(value), value);
    await page.evaluate(self => window.objectVisualFixture.configureMap({ immersive: true, personLabels: { [self]: '1号 · 高才' }, cameraArea: { x: 360, y: 132, width: 804, height: 727, reserved: [{ x: 30, y: 132, width: 310, height: 187 }] } }), p.self.entityRef);
    const select = async () => { const node = page.locator('.spatial-target'); await node.focus(); await node.press('Enter'); };
    const settle = () => page.evaluate(async () => { await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); });
    const geometry = async () => { await settle(); return page.evaluate(() => {
      const viewport = document.querySelector('.spatial-map-viewport').getBoundingClientRect(), svg = document.querySelector('.spatial-map'), matrix = svg.getScreenCTM();
      const rect = n => { const r = n.getBoundingClientRect(); return { x: r.x - viewport.x, y: r.y - viewport.y, width: r.width, height: r.height }; };
      const image = document.querySelector('.spatial-target .spatial-object-art image');
      const point = new DOMPoint(260, 405).matrixTransform(matrix);
      return { hud: window.objectVisualFixture.geometry(), image: image ? rect(image) : null, labels: [...document.querySelectorAll('.spatial-map-label')].map(rect), fallback: { x: point.x - viewport.x - 18 * matrix.a - 8, y: point.y - viewport.y - 18 * matrix.a - 8, width: 36 * matrix.a + 16, height: 36 * matrix.a + 16 } };
    }); };
    const contains = (a, b) => a.x <= b.x + .01 && a.y <= b.y + .01 && a.x + a.width >= b.x + b.width - .01 && a.y + a.height >= b.y + b.height - .01;
    const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    const fallback = async () => { const g = await geometry(); assert.equal(g.image, null); assert.ok(g.hud.protectedRegions.some(r => Object.keys(g.fallback).every(k => Math.abs(r[k] - g.fallback[k]) < .01)), '未真正显示图像时保留原36x36保护范围'); return g; };
    await set(snapshot); await select(); await until(() => pending.length === 1, '物件图像仍在途'); await fallback();
    mode = 'good'; await fulfill(pending.shift()); await until(async () => await page.locator('.spatial-target image').count() === 1, '原图像实际绘出');
    const ready = await geometry(); evidence.ready = ready;
    assert.ok(ready.hud.protectedRegions.some(r => contains(r, ready.image)), 'HUD保护包含偏离权威点的当前图像');
    assert.ok(ready.labels.every(r => !overlaps(r, ready.image)), '姓名避开当前图像');
    check('偏移物件真正ready后姓名与HUD使用图像边界');
    await page.getByRole('button', { name: '查看全图', exact: true }).click();
    const full = await geometry(); assert.ok(!overlaps(full.image, { x: 30, y: 132, width: 310, height: 187 }));
    assert.ok(full.labels.every(r => !overlaps(r, full.image)));
    const fullWorld = await page.locator('.spatial-map').evaluate(svg => {
      const matrix = svg.getScreenCTM(), viewport = svg.getBoundingClientRect();
      const first = new DOMPoint(0, 0).matrixTransform(matrix), last = new DOMPoint(1600, 1000).matrixTransform(matrix);
      const blank = [5, viewport.width - 5].flatMap(x => [.2, .4, .6, .8].map(f => ({ x: viewport.x + x, y: viewport.y + viewport.height * f }))).find(point => {
        const world = new DOMPoint(point.x, point.y).matrixTransform(matrix.inverse());
        return (world.x < 0 || world.y < 0 || world.x > 1600 || world.y > 1000) && document.elementFromPoint(point.x, point.y) === svg;
      });
      return { first: { x: first.x, y: first.y }, last: { x: last.x, y: last.y }, viewport: viewport.toJSON(), blank };
    });
    assert.ok(fullWorld.first.x >= fullWorld.viewport.x - .001 && fullWorld.first.y >= fullWorld.viewport.y - .001 && fullWorld.last.x <= fullWorld.viewport.right + .001 && fullWorld.last.y <= fullWorld.viewport.bottom + .001, '全图保留整个世界');
    assert.ok(fullWorld.blank, '全图安全留白可独立核对'); await page.mouse.click(fullWorld.blank.x, fullWorld.blank.y);
    assert.deepEqual(await page.evaluate(() => window.objectVisualFixture.actions()), [], '世界外留白不发移动');
    await page.getByRole('button', { name: '跟随角色', exact: true }).click(); assert.equal(await page.locator('.spatial-target.selected').count(), 1);
    const restored = await geometry(); assert.ok(restored.labels.every(r => !overlaps(r, restored.image)));
    evidence.fullMap = { ...full, fullWorld }; check('选中物全图避开固定HUD且等比保留整个世界，留白点击与切回跟随不发动作');

    await until(async () => await page.locator('.spatial-map').getAttribute('data-scene-layer-status') === 'ready', '完整场景组已启用');
    const ringStyle = () => page.locator('.spatial-layer-feedback ellipse').first().evaluate(n => { const s = getComputedStyle(n); return { fill: s.fill, stroke: s.stroke, strokeWidth: s.strokeWidth }; });
    const normal = await ringStyle(); assert.equal(normal.fill, 'rgba(255, 247, 228, 0.24)'); assert.equal(normal.stroke, 'rgb(54, 94, 82)'); assert.equal(normal.strokeWidth, '2px');
    const selfNode = page.locator('.spatial-person[data-spatial-self="true"]'); await selfNode.focus(); await selfNode.press('Enter'); await settle();
    const selected = await ringStyle(); assert.equal(selected.stroke, 'rgb(150, 63, 47)'); assert.equal(selected.strokeWidth, '3px'); assert.equal(selected.fill, normal.fill);
    await select(); await page.keyboard.press('Tab'); await selfNode.focus(); await settle(); assert.equal(await selfNode.evaluate(n => n.matches(':focus-visible')), true);
    const focused = await ringStyle(); assert.equal(focused.stroke, selected.stroke); assert.equal(focused.strokeWidth, selected.strokeWidth);
    evidence.feedback = { normal, selected, focused }; check('分层反馈沿用原半透明绿边及选中/键盘聚焦强调，不出现实心黑环');

    await page.locator('.spatial-target image').evaluate(node => node.dispatchEvent(new Event('error'))); await fallback();
    mode = 'hold'; await page.locator('.spatial-map-note').getByRole('button', { name: '重新载入图像', exact: true }).click();
    await until(() => pending.length === 1, '重试仍在途'); await fallback();
    await page.getByRole('button', { name: '查看全图', exact: true }).click(); assert.equal(await page.locator('.spatial-map').getAttribute('viewBox'), '0 0 1600 1000', '未ready保持原全图回退');
    await page.getByRole('button', { name: '跟随角色', exact: true }).click();
    const hidden = structuredClone(snapshot); hidden.viewId = 'new-object-view'; hidden.projection.targets[0].visualKey = 'constructor';
    await set(hidden); await select(); await fallback(); await fulfill(pending.shift()); await page.waitForLoadState('networkidle'); await fallback();
    mode = 'failed'; await set(snapshot); await select(); await page.locator('.spatial-map-note').getByRole('button', { name: '重新载入图像', exact: true }).waitFor(); await fallback();
    mode = 'good'; await page.locator('.spatial-map-note').getByRole('button', { name: '重新载入图像', exact: true }).click(); await until(async () => await page.locator('.spatial-target image').count() === 1, '缺图重试恢复');
    const empty = structuredClone(snapshot); delete empty.projection.targets[0].visualKey; await set(empty); await select(); await fallback();
    assert.deepEqual(await page.evaluate(() => window.objectVisualFixture.actions()), []);
    assert.equal((await page.evaluate(() => window.objectVisualFixture.selections())).at(-1), target.entityRef);
    await set(null); assert.equal(await page.locator('.spatial-object-art').count(), 0);
    check('显示错误、重试在途、换view、未知/空key及迟到完成均恢复fallback，不保留旧图像保护框');
    evidence.assessment = 'PASS';
  } catch (error) { evidence.assessment = 'FAIL'; evidence.error = error.stack; throw error; }
  finally { await context?.close(); await vite?.close(); evidence.resourcesClosed = true; await saveJSON(resolve(output, 'object-geometry-result.json'), evidence); }
}
