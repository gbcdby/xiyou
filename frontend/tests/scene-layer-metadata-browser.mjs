import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer as createVite } from 'vite';
import { chromium } from 'playwright';
import { sceneLayerFixtures } from './scene-layer-fixtures.mjs';
import { validSceneLayerGroup } from '../src/domain/gaolao-scene-layers.ts';
import { validateSpatial } from '../../protocol/spatial.mjs';
import { repository, sourceIdentity, saveJSON, sha256, until } from './network-support.mjs';

// 定点回归：输入必须是原真实运行保存的合法DTO，不连接世界动作端、不生成截图。
assert.ok(process.argv[2], '请显式给出已保存授权样本路径');
const sampleFile = resolve(process.argv[2]), bytes = await readFile(sampleFile), samples = JSON.parse(bytes);
validateSpatial('SnapshotV2', samples.fixed); validateSpatial('SnapshotV2', samples['door-open']);
const output = resolve(process.env.FRONTEND_EVIDENCE_DIR || resolve(repository, '.agent-output/scene-layer-fix/consumer'));
await mkdir(output, { recursive: true });
const report = { scope: 'R-SCENE-LAYER-022-001：真实Vue/Chromium，受控catalog及合法DTO；无图片产物、无世界动作端', source: await sourceIdentity(), sampleSource: { file: sampleFile, sha256: sha256(bytes) }, scenarios: [], screenshots: '未生成' };
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: process.env.CHROMIUM_ARGS ? JSON.parse(process.env.CHROMIUM_ARGS) : [] });
  for (const scenario of ['invalid-base-mapping', 'missing-door', 'missing-neutral-bounds', 'zero-neutral-width', 'missing-foreground', 'disabled', 'unknown-content', 'registered-road', 'valid-courtyard']) {
    const fixture = sceneLayerFixtures(), input = structuredClone(samples.fixed);
    input.projection.targets = input.projection.targets.filter(target => target.visualKey !== 'timber-door');
    if (scenario === 'invalid-base-mapping') fixture.group.base.worldRect.x = 1;
    if (scenario === 'missing-door') delete fixture.group.door;
    if (scenario === 'missing-neutral-bounds') delete fixture.group.door.neutralBounds;
    if (scenario === 'zero-neutral-width') fixture.group.door.neutralBounds.width = 0;
    if (scenario === 'missing-foreground') delete fixture.group.foreground;
    if (scenario === 'disabled') { delete fixture.group.door; fixture.group.enabled = false; }
    if (scenario === 'unknown-content') { delete fixture.group.door; input.projection.contentVersion = fixture.group.contentVersion = 'gaolaozhuang-tools-east-scene-v2'; }
    if (scenario === 'registered-road') {
      fixture.group.sceneId = 'gaolao-village-road'; delete fixture.group.door;
      fixture.catalog = { [fixture.group.sceneId]: fixture.group };
      const p = input.projection; p.scene.sceneId = p.self.sceneId = fixture.group.sceneId;
      const self = structuredClone(p.entities.find(entity => entity.entityRef === p.self.entityRef)); self.sceneId = p.self.sceneId; self.position = { ...p.self.position };
      for (const key of ['motionTrail', 'motionFromSceneTimeMs', 'motionThroughSceneTimeMs']) delete self[key];
      p.entities = [self]; p.targets = []; p.items = []; p.movement = null;
    }
    validateSpatial('SnapshotV2', input);
    const valid = ['registered-road', 'valid-courtyard'].includes(scenario), legacy = ['disabled', 'unknown-content'].includes(scenario);
    assert.equal(validSceneLayerGroup(fixture.group), valid);
    const observed = { scenario, validator: valid, pageErrors: [], requests: [], checks: [] };
    let vite, context, page, baseFails = scenario === 'valid-courtyard', doorFails = baseFails;
    const pendingOpen = [];
    try {
      vite = await createVite({ root: resolve(repository, 'frontend'), configFile: resolve(repository, 'frontend/vite.config.mjs'), configLoader: 'native', cacheDir: resolve(output, 'cache-' + scenario),
        plugins: [{ name: 'scene-metadata-regression', enforce: 'pre', load(id) {
          if (id === resolve(repository, 'frontend/src/assets/gaolao-scene-layers.json')) return JSON.stringify(fixture.catalog);
          if (id === resolve(repository, 'frontend/src/assets/gaolao-object-art.json')) return JSON.stringify(fixture.objectCatalog);
        }, configureServer(service) { service.middlewares.use((request, response, next) => {
          const path = new URL(request.url, 'http://localhost').pathname;
          if (legacy && path === '/assets/gaolaozhuang/scenes/courtyard.png') { response.statusCode = 503; response.end('受控旧背景失败，以核对原障碍fallback'); return; }
          if (!Object.hasOwn(fixture.files, path)) return next();
          const fail = baseFails && path === fixture.group.base.file || doorFails && path.includes('layer-door-');
          observed.requests.push({ path, fail }); response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Type', 'image/svg+xml');
          if (fail) { response.statusCode = 503; response.end('受控资源失败'); } else response.end(fixture.files[path]);
        }); } }], server: { host: '127.0.0.1', port: 0, fs: { allow: [repository] } } });
      await vite.listen(); context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, reducedMotion: 'reduce' });
      page = await context.newPage(); page.setDefaultTimeout(5000); page.on('pageerror', error => observed.pageErrors.push(error.message));
      await page.goto(vite.resolvedUrls.local[0] + 'tests/object-visual-fixture.html'); await page.waitForFunction(() => Boolean(window.objectVisualFixture));
      const set = async value => { validateSpatial('SnapshotV2', value); await page.evaluate(value => window.objectVisualFixture.setSnapshot(value), value); };
      const status = value => until(async () => await page.locator('.spatial-map').getAttribute('data-scene-layer-status') === value, scenario + ' 状态 ' + value);
      const count = (selector, expected) => until(async () => await page.locator(selector).count() === expected, scenario + ' ' + selector + '数量=' + expected);
      const retry = () => page.locator('.spatial-map-note').getByRole('button', { name: '重新载入图像', exact: true }).click();
      await set(input);
      if (scenario !== 'registered-road') {
        await status(legacy ? 'legacy' : 'failed'); await count('.spatial-geometric-fallback', 1);
        const observedMap = await page.evaluate(() => {
          const neutral = document.querySelector('.spatial-neutral-door');
          return { mapCount: document.querySelectorAll('.spatial-map').length, nativeDoorSlots: document.querySelectorAll('.spatial-neutral-door').length,
            neutralGeometry: neutral ? ['x','y','width','height'].map(key => Number(neutral.getAttribute(key))) : null,
            staticImages: document.querySelectorAll('.spatial-scene-base,.spatial-scene-floor,.spatial-scene-foreground').length,
            legacyBackgrounds: document.querySelectorAll('.spatial-scene-art').length, doorImages: document.querySelectorAll('.spatial-scene-door image').length,
            obstaclePolygons: [...document.querySelectorAll('.spatial-geometric-fallback .spatial-obstacle')].map(value => value.getAttribute('points')) };
        });
        const sealed = input.projection.scene.obstacles.find(value => value.obstacleId === 'sealed-door');
        observedMap.sealedDoorDrawn = observedMap.obstaclePolygons.includes(sealed.polygon.map(value => `${value.x},${value.y}`).join(' '));
        observedMap.fallbackObstacleCount = observedMap.obstaclePolygons.length; delete observedMap.obstaclePolygons;
        Object.assign(observed, observedMap);
        assert.equal(observedMap.mapCount, 1); assert.equal(observedMap.nativeDoorSlots, legacy ? 0 : 1);
        assert.equal(observedMap.sealedDoorDrawn, legacy);
        assert.equal(observedMap.staticImages + observedMap.legacyBackgrounds + observedMap.doorImages, 0);
        if (!legacy) assert.deepEqual(observedMap.neutralGeometry, valid ? [-40,-125,80,95] : [-40,-75,80,45]);
        if (!valid) assert.equal(observed.requests.length, 0, '非法或未启用的组不请求其资源');
        observed.checks.push('精确范围的几何/中性降级，无坏元数据渲染异常或未授权门图');
      } else {
        await status('ready'); assert.equal(await page.locator('.spatial-scene-base').count(), 1);
        assert.equal(await page.locator('.spatial-scene-door,.spatial-neutral-door').count(), 0);
        observed.checks.push('合法已登记庄外组不借用院落门槽');
      }

      if (!valid && !legacy) {
        await set(samples.fixed); await status('failed');
        const target = samples.fixed.projection.targets.find(value => value.visualKey === 'timber-door');
        const button = page.locator('.spatial-target[aria-label="选择' + target.name + '"]');
        assert.equal(await button.count(), 1); assert.equal(await button.locator('image').count(), 0);
        await button.focus(); await button.press('Enter');
        assert.equal((await page.evaluate(() => window.objectVisualFixture.selections())).at(-1), target.entityRef);
        await page.getByTestId('spatial-map').focus(); await page.getByTestId('spatial-map').press('ArrowRight');
        assert.deepEqual(await page.evaluate(() => window.objectVisualFixture.actions()), ['move']);
        observed.checks.push('原目标引用可选且普通门pass不重复图；地图仍能发出原移动意图');
      }
      if (scenario === 'valid-courtyard') {
        await set(samples.fixed); baseFails = false; await retry(); await status('ready');
        await until(async () => await page.locator('.spatial-map-note').getByRole('button', { name: '重新载入图像', exact: true }).count() === 1, '独立门失败可重试');
        assert.equal(await page.locator('.spatial-scene-base').count(), 1); assert.equal(await page.locator('.spatial-scene-door image').count(), 0);
        doorFails = false; await retry(); await status('ready'); await count('.spatial-scene-door [data-object-variant="closed"] image', 1);
        await page.route('**/tests/layer-door-open.svg*', route => { pendingOpen.push(route); });
        await set(samples['door-open']); await until(() => pendingOpen.length > 0, '当前open资源在途');
        assert.equal(await page.locator('.spatial-scene-door image').count(), 0);
        const unseen = structuredClone(input); unseen.viewId += '-current'; unseen.sessionId += '-current'; await set(unseen);
        for (const route of pendingOpen.splice(0)) await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: fixture.files['/tests/layer-door-open.svg'] });
        await status('ready'); await page.waitForLoadState('networkidle');
        assert.equal(await page.locator('.spatial-scene-door image').count(), 0); assert.equal(await page.locator('.spatial-neutral-door').count(), 1);
        assert.deepEqual(await page.evaluate(() => window.objectVisualFixture.actions()), []);
        observed.checks.push('合法组普通静态失败/门独立失败/重试/当前closed/换session-view后旧open不复活');
      }
      assert.deepEqual(observed.pageErrors, []); observed.assessment = 'PASS';
    } catch (error) { observed.assessment = 'FAIL'; observed.error = error.stack; }
    finally { await context?.close(); await vite?.close(); observed.resourcesClosed = true; }
    report.scenarios.push(observed); console.log(JSON.stringify(observed));
  }
  report.assessment = report.scenarios.every(value => value.assessment === 'PASS') ? 'PASS' : 'FAIL';
} catch (error) { report.assessment = 'FAIL'; report.error = error.stack; }
finally {
  await browser?.close(); report.resourcesClosed = true; report.sourceEnd = await sourceIdentity();
  assert.deepEqual(report.sourceEnd, report.source, '定点检查期间源码不变');
  await saveJSON(resolve(output, 'result.json'), report); console.log(JSON.stringify({ assessment: report.assessment, scenarios: report.scenarios.length, output }));
  if (report.assessment !== 'PASS') process.exitCode = 1;
}
