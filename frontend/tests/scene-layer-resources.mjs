import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createServer as createVite } from 'vite';
import { sceneLayerFixtures } from './scene-layer-fixtures.mjs';
import { repository, until, saveJSON, sha256 } from './network-support.mjs';
import { validateSpatial } from '../../protocol/spatial.mjs';

/** 当前Vue消费者，输入为已保存授权样本与明确受控扰动；技术SVG不作正式艺术证据。 */
export async function checkSceneLayerResources({ browser, output, report, samples, phase = 'all' }) {
  const fixture = sceneLayerFixtures();
  const evidence = { scope: '当前Vue场景消费者；技术SVG、受控授权DTO扰动；不证明图片发布、真实权限或艺术', phase, fixture, checks: [], requests: [], screenshots: [] };
  const check = name => { evidence.checks.push({ name, status: 'PASS' }); report.checks.push({ name, status: 'PASS', scope: 'controlled-scene-consumer' }); console.log(JSON.stringify({ check: name })); };
  let vite, context, page;
  let staticMode = 'good', doorMode = 'good';
  const pending = [];
  const files = fixture.files;
  const fulfill = async (route, body) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: body ?? files[new URL(route.request().url()).pathname] });
  const keepOnlySelf = snapshot => {
    const p = snapshot.projection, entity = structuredClone(p.entities.find(value => value.entityRef === p.self.entityRef));
    assert.ok(entity, '受控扰动仍须保留合法self实体');
    entity.sceneId = p.self.sceneId; entity.position = structuredClone(p.self.position);
    for (const key of ['motionTrail', 'motionFromSceneTimeMs', 'motionThroughSceneTimeMs']) delete entity[key];
    p.entities = [entity];
  };
  const start = async catalog => {
    vite = await createVite({ root: resolve(repository, 'frontend'), configFile: resolve(repository, 'frontend/vite.config.mjs'), configLoader: 'native', cacheDir: resolve(output, catalog === fixture.catalog ? 'layer-vite-cache' : 'legacy-vite-cache'),
      plugins: [{ name: 'controlled-scene-catalog', enforce: 'pre', load(id) {
        if (id === resolve(repository, 'frontend/src/assets/gaolao-scene-layers.json')) return JSON.stringify(catalog);
        if (id === resolve(repository, 'frontend/src/assets/gaolao-object-art.json')) return JSON.stringify(catalog === fixture.catalog ? fixture.objectCatalog : {});
      } }],
      server: { host: '127.0.0.1', port: 0, fs: { allow: [repository] } } });
    await vite.listen();
    context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, reducedMotion: 'reduce' });
    page = await context.newPage(); page.setDefaultTimeout(5000);
    page.on('pageerror', error => report.pageErrors.push({ scope: 'scene-consumer', message: error.message }));
    await page.route('**/tests/layer-*.svg*', async route => {
      const file = new URL(route.request().url()).pathname, mode = file.includes('door-') ? doorMode : staticMode;
      evidence.requests.push({ file, mode, url: new URL(route.request().url()).pathname + new URL(route.request().url()).search });
      if (mode === 'hold') { pending.push(route); return; }
      if (mode === 'fail' || mode === 'bad-size' && file.includes('floor') || mode === 'corrupt' && file.includes('floor')) {
        if (mode === 'bad-size') await fulfill(route, '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>');
        else if (mode === 'corrupt') await fulfill(route, 'not-an-image');
        else await route.abort('failed');
        return;
      }
      await fulfill(route);
    });
    await page.goto(vite.resolvedUrls.local[0] + 'tests/object-visual-fixture.html');
    await page.waitForFunction(() => Boolean(window.objectVisualFixture));
  };
  const stop = async () => { await context?.close(); context = null; await vite?.close(); vite = null; pending.length = 0; };
  const set = value => { validateSpatial('SnapshotV2', value); return page.evaluate(value => window.objectVisualFixture.setSnapshot(value), value); };
  const count = (selector, expected, label) => until(async () => await page.locator(selector).count() === expected, label, 6000);
  const status = expected => until(async () => await page.locator('.spatial-map').getAttribute('data-scene-layer-status') === expected, '场景组状态 ' + expected, 6000);
  const retry = async () => page.locator('.spatial-map-note').getByRole('button', { name: '重新载入图像', exact: true }).click();
  const release = async () => { const routes = pending.splice(0); for (const route of routes) await fulfill(route); };
  const picture = async (locator, name) => { const file = resolve(output, name); const bytes = await locator.screenshot({ path: file }); const value = { file: name, sha256: sha256(bytes) }; evidence.screenshots.push(value); return value.sha256; };
  const closed = samples.fixed, open = samples['door-open'];
  assert.ok(closed && open, '输入必须有同一旧运行实际保存的闭门/开门授权样本');
  try {
    if (phase === 'all') {
    await start({});
    await set(closed); await status('legacy');
    assert.equal(await page.locator('.spatial-scene-art').getAttribute('href'), '/assets/gaolaozhuang/scenes/courtyard.png');
    assert.equal(await page.locator('.spatial-scene-door').count(), 0);
    await count('.spatial-target', closed.projection.targets.filter(value => value.sceneId === 'gaolao-courtyard').length, '旧目标数量');
    check('正式空catalog保留原院落背景、原目标与无新门槽');
    await stop();

    staticMode = 'hold'; doorMode = 'fail';
    await start(fixture.catalog); await set(closed);
    await until(() => pending.length === 4, '四份静态资源仍在加载');
    await status('pending'); assert.equal(await page.locator('.spatial-scene-art,.spatial-scene-base,.spatial-scene-foreground').count(), 0);
    assert.equal(await page.locator('.spatial-neutral-door').count(), 1);
    assert.equal(await page.locator('.spatial-geometric-fallback .spatial-obstacle').count(), closed.projection.scene.obstacles.filter(value => value.obstacleId !== 'sealed-door').length);
    await fulfill(pending.shift()); await fulfill(pending.shift());
    assert.equal(await page.locator('.spatial-scene-base').count(), 0, '部分完成不暴露半组');
    staticMode = 'good'; await release(); await status('ready');
    await count('.spatial-scene-base', 1, '完整底图'); await count('.spatial-scene-floor', 1, '完整地面'); await count('.spatial-scene-foreground', 1, '完整前沿');
    await page.locator('.spatial-map-note').getByRole('button', { name: '重新载入图像', exact: true }).waitFor();
    assert.equal(await page.locator('.spatial-scene-door image').count(), 0); assert.equal(await page.locator('.spatial-neutral-door').count(), 1);
    const target = closed.projection.targets.find(value => value.visualKey === 'timber-door');
    const doorTarget = page.locator('.spatial-target[aria-label="选择' + target.name + '"]');
    const hitRadius = await doorTarget.locator('.spatial-hit').getAttribute('r');
    await doorTarget.focus(); await doorTarget.press('Enter');
    assert.equal((await page.evaluate(() => window.objectVisualFixture.selections())).at(-1), target.entityRef);
    assert.deepEqual(await page.evaluate(() => window.objectVisualFixture.actions()), []);
    check('静态原子启用；门图独立失败仍保留静态与原引用/命中/选择');

    doorMode = 'good'; await retry(); await status('ready');
    await count('.spatial-scene-door [data-object-variant="closed"] image', 1, '仅一张当前closed帧');
    assert.equal(await doorTarget.locator('image').count(), 0, '通用target不重复门图');
    assert.equal(await doorTarget.locator('.spatial-hit').getAttribute('r'), hitRadius);
    doorMode = 'hold'; await set(open); await until(() => pending.length > 0, 'open帧在途');
    assert.equal(await page.locator('.spatial-scene-door image').count(), 0); assert.equal(await page.locator('.spatial-neutral-door').count(), 1);
    const invisible = structuredClone(open); invisible.projection.targets = invisible.projection.targets.filter(value => value.visualKey !== 'timber-door');
    await set(invisible); doorMode = 'good'; await release(); await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('.spatial-scene-door image').count(), 0);
    check('当前门改变/不可见先撤旧帧；迟到open不能复活，原门目标不复制');

    for (const failure of ['bad-size', 'corrupt', 'fail']) {
      staticMode = failure;
      const next = structuredClone(closed); next.viewId += '-' + failure;
      await set(next); await status('failed');
      assert.equal(await page.locator('.spatial-scene-base,.spatial-scene-floor,.spatial-scene-foreground,.spatial-scene-art,.spatial-scene-door image').count(), 0);
      assert.equal(await page.locator('.spatial-neutral-door').count(), 1);
      staticMode = 'good'; await retry(); await status('ready'); await count('.spatial-scene-door [data-object-variant="closed"] image', 1, '重试恢复当前门');
    }
    check('静态错误尺寸/损坏/网络失败均整组降级；原重试恢复、不发世界动作');

    staticMode = 'hold';
    const old = structuredClone(closed); old.viewId += '-old-load';
    await set(old); await until(() => pending.length === 4, '旧view静态组在途');
    staticMode = 'good';
    const newer = structuredClone(open); newer.viewId += '-new-load'; newer.sessionId += '-new-session';
    await set(newer);
    assert.equal(await page.locator('.spatial-scene-door image').count(), 0, '新会话未就绪先撤旧门帧');
    // 浏览器可合并同URL的在途字节；释放字节后仍须由当前代次取得资格。
    await release(); await status('ready'); await count('.spatial-scene-door [data-object-variant="open"] image', 1, '新会话只用当前open');
    await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('.spatial-scene-door [data-object-variant="closed"] image').count(), 0);
    check('新session/view后的旧静态load不能覆盖当前组或门态');
    } else {
      assert.equal(phase, 'remaining');
      await start(fixture.catalog); await set(closed); await status('ready');
    }

    staticMode = 'hold'; const leaving = structuredClone(closed); leaving.viewId += '-leaving'; await set(leaving); await until(() => pending.length === 4, '离场前旧组在途');
    const road = structuredClone(closed); road.viewId += '-road'; road.projection.scene.sceneId = 'gaolao-village-road'; road.projection.self.sceneId = 'gaolao-village-road'; keepOnlySelf(road); road.projection.items = []; road.projection.targets = []; road.projection.movement = null;
    await set(road); await status('legacy'); staticMode = 'good';
    // 已离场的旧组同时有迟到error与load，二者都不能给当前场景留下失败状态。
    await pending.shift().abort('failed'); await release(); await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('.spatial-scene-door,.spatial-scene-base').count(), 0);
    assert.equal(await page.locator('.spatial-map-note').getByRole('button', { name: '重新载入图像', exact: true }).count(), 0);
    const returnedBackground = new URL(await page.locator('.spatial-scene-art').getAttribute('href'), page.url());
    assert.equal(returnedBackground.pathname, '/assets/gaolaozhuang/scenes/village-road.png');
    assert.match(returnedBackground.search, /^(?:\?retry=[1-9]\d*)?$/, '只允许原图像重试参数');
    const foreign = structuredClone(closed); foreign.projection.contentVersion = 'gaolaozhuang-tools-east-scene-v2';
    await set(foreign); await status('legacy'); assert.equal(await page.locator('.spatial-scene-door').count(), 0);
    check('场景/未登记内容切换回原背景，迟到旧层load/error均不跨场景复活');

    await set(closed); await status('ready'); await page.getByRole('button', { name: '查看全图', exact: true }).click();
    for (const position of [{ x: 1320, y: 300 }, { x: 708, y: 640 }]) {
      const unknown = structuredClone(closed); unknown.projection.self.position = position; unknown.projection.movement = null; keepOnlySelf(unknown); unknown.projection.items = []; unknown.projection.targets = [];
      await set(unknown); await status('ready');
      const first = await picture(page.locator('.spatial-scene-door'), 'unknown-door-' + position.x + '-closed-world.png');
      const baseFirst = await picture(page.locator('.spatial-scene-layers'), 'unknown-static-' + position.x + '-closed-world.png');
      unknown.projection.scene.obstacles = unknown.projection.scene.obstacles.filter(value => value.obstacleId !== 'sealed-door');
      await set(unknown); await status('ready');
      assert.equal(await picture(page.locator('.spatial-scene-door'), 'unknown-door-' + position.x + '-open-world.png'), first);
      assert.equal(await picture(page.locator('.spatial-scene-layers'), 'unknown-static-' + position.x + '-open-world.png'), baseFirst);
    }
    check('后宅内/远庭未知门两世界：新增门槽与静态环境像素分别相同，不宣称全应用非干涉');

    const behind = structuredClone(closed); behind.projection.self.position = { x: 1320, y: 300 }; behind.projection.movement = null; keepOnlySelf(behind);
    await set(behind); await status('ready'); assert.equal(await page.locator('.spatial-scene-foreground').getAttribute('opacity'), '0.35');
    const depths = await page.locator('.spatial-map > [data-depth-y]').evaluateAll(nodes => nodes.map(node => Number(node.getAttribute('data-depth-y'))));
    assert.deepEqual(depths, [...depths].sort((a,b) => a-b));
    behind.projection.self.position.y = 400; keepOnlySelf(behind); await set(behind);
    assert.equal(await page.locator('.spatial-scene-foreground').getAttribute('opacity'), '1');
    check('前景与真实脚底稳定排序，只有当前保护对象被覆盖的小片淡化');

    const twins = structuredClone(samples.loose); twins.projection.self.position = { x: 1320, y: 300 }; twins.projection.movement = null; keepOnlySelf(twins);
    twins.projection.items = twins.projection.items.filter(value => value.location.kind === 'ground').slice(0,2);
    assert.equal(twins.projection.items.length, 2);
    for (const item of twins.projection.items) item.location.position = { x: 1320, y: 300 };
    await set(twins); await status('ready'); await count('.spatial-item', 2, '同点两实例');
    for (const item of twins.projection.items) {
      const node = page.locator('.spatial-item[aria-label="选择' + item.name + '"]'); await node.focus(); await node.press('Enter');
      assert.equal((await page.evaluate(() => window.objectVisualFixture.selections())).at(-1), item.entityRef);
      assert.equal(await node.getAttribute('transform'), 'translate(1320 300)');
    }
    twins.projection.items[0].location = { kind: 'held', ownerRef: twins.projection.self.entityRef };
    await set(twins); await count('.spatial-item', 1, 'held撤地图实例');
    twins.projection.items = []; await set(twins); await count('.spatial-item', 0, '授权撤去不留实例');
    assert.deepEqual(await page.evaluate(() => window.objectVisualFixture.actions()), []);
    check('分层保留同点两引用各自选择；held和撤去授权不留地图物件');
    await picture(page.locator('.spatial-map'), 'controlled-layer-final.png');
    evidence.assessment = 'PASS';
  } catch (error) {
    evidence.assessment = 'FAIL'; evidence.error = error.stack; throw error;
  } finally {
    await stop(); evidence.resourcesClosed = true;
    await saveJSON(resolve(output, 'scene-consumer-result.json'), evidence);
  }
}
