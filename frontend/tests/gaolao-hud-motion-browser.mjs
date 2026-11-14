import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer as createVite } from 'vite';
import { startTestPostgres } from '../../backend/test-support/postgres.mjs';
import { createAuthorityServer } from '../../backend/server.mjs';
import { openDoor, startFollow, accepted } from '../../backend/test-support/gaolao-room.mjs';
import { repository, sourceIdentity, saveJSON, sha256, until } from './network-support.mjs';
import { browserRoom, snapshot, clientState, openReading, closeReading } from './gaolao-real-support.mjs';

const output = resolve(process.env.FRONTEND_EVIDENCE_DIR || resolve(repository, '.agent-output/hud-std001/motion'));
await mkdir(output, { recursive: true });
const report = { scope: 'R-33-HUD-STD-001 作者限修自查：真实PG/HTTP/Socket/Vue，正常玩家可见UI；NPC仅官方受信受控策略。逐rAF同时检查背景覆盖和16px，不代替独立复审。', source: await sourceIdentity(), startedAt: new Date().toISOString(), checks: [], samples: [], humanActions: [], npcActions: [], recapResponses: [], pageErrors: [], screenshots: [], videos: [], windowErrors: [] };
let database, server, vite, browser, room;
const pendingImages = [];
async function capture(page, name) {
  const file = name + '.png'; await page.screenshot({ path: resolve(output, file) });
  report.screenshots.push({ file, sha256: sha256(await readFile(resolve(output, file))), capturedAt: new Date().toISOString() });
}
async function stable(page) {
  await page.evaluate(() => document.fonts.ready);
  await until(() => page.evaluate(() => {
    const map = document.querySelector('.spatial-map-viewport'), guide = document.querySelector('.spatial-label-guides');
    if (!map || !guide) return false;
    const b = map.getBoundingClientRect(), v = guide.viewBox.baseVal;
    return b.width > 0 && Math.abs(b.width - v.width) < 1 && Math.abs(b.height - v.height) < 1;
  }), '实际ResizeObserver尺寸已更新');
}
async function displayedAt(page, position) {
  await until(() => page.evaluate(position => {
    const person = document.querySelector('[data-spatial-self]'), frame = person?.querySelector('[data-art-frame]');
    if (!person) return false;
    const m = person.transform.baseVal.consolidate()?.matrix;
    return m && Math.abs(m.e - position.x) < .01 && Math.abs(m.f - position.y) < .01 && frame?.getAttribute('data-art-moving') !== 'true';
  }, position), '原精确目的地已实际绘制并停步');
}
async function sample(page, name, action) {
  await stable(page);
  await page.evaluate(async name => {
    const { spatialState } = await import('/src/state/spatial-store.ts');
    const data = { name, running: true, frames: [], errors: [], dimensionTransitions: [], firstFailureReported: false, selectedOnStart: document.querySelector('svg.spatial-map')?.__vueParentComponent?.props?.selected };
    window.__hudMotion = data;
    const rect = node => { const b = node.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
    const visible = node => { const b = node.getBoundingClientRect(), s = getComputedStyle(node); return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const gap = (a, b) => Math.max(a.x - b.x - b.width, b.x - a.x - a.width, a.y - b.y - b.height, b.y - a.y - a.height);
    function frame(now) {
      if (!data.running) return;
      try {
        const snapshot = spatialState.value.snapshot, p = snapshot?.projection, map = document.querySelector('svg.spatial-map'), image = document.querySelector('.spatial-scene-art'), guide = document.querySelector('.spatial-label-guides');
        if (p && map && image && guide) {
          const mapRect = rect(map), background = rect(image), v = guide.viewBox.baseVal;
          if (Math.abs(mapRect.width - v.width) >= 1 || Math.abs(mapRect.height - v.height) >= 1) data.dimensionTransitions.push({ now, map: mapRect, guide: { width: v.width, height: v.height } });
          else {
            // 仅只读公开投影、实际当前帧与DOM；不调用生产布局函数或写任何世界/客户端状态。
            const props = map.__vueParentComponent?.props || {}, people = [p.self, ...p.entities];
            const refs = new Set([p.self.entityRef, props.selected, ...(p.chapter?.follows || []).filter(f => ['accepted', 'following', 'paused', 'arrived'].includes(f.status)).map(f => f.subjectRef)]);
            const names = new Set(people.filter(person => refs.has(person.entityRef)).map(person => (props.personLabels?.[person.entityRef] || person.name) + (person.entityRef === p.self.entityRef ? ' · 你' : '')));
            const regions = [], poses = [];
            for (const node of document.querySelectorAll('.spatial-person')) {
              const person = people.find(person => node.__vnode?.key === person.entityRef + ':' + person.appearanceEpoch);
              if (!person || !refs.has(person.entityRef)) continue;
              const art = node.querySelector('[data-art-frame]'), shape = node.querySelector('image,.spatial-actor-fallback');
              if (shape) regions.push({ kind: 'body', name: node.getAttribute('aria-label'), ...rect(shape) });
              poses.push({ name: node.getAttribute('aria-label'), world: node.getAttribute('transform'), frame: art?.getAttribute('data-art-frame'), moving: art?.getAttribute('data-art-moving'), mirror: art?.getAttribute('transform') });
            }
            for (const node of document.querySelectorAll('.spatial-target.selected,.spatial-item.selected')) { const shape = node.querySelector('rect,path'); if (shape) regions.push({ kind: 'target', name: node.getAttribute('aria-label'), ...rect(shape) }); }
            for (const node of document.querySelectorAll('.spatial-map-label')) if (node.classList.contains('self') || node.classList.contains('selected') || names.has(node.getAttribute('title'))) regions.push({ kind: 'name', name: node.textContent.trim(), ...rect(node) });
            const cards = [...document.querySelectorAll('.spatial-sidebar,.spatial-follow-strip,.spatial-receipts')].filter(visible).map(node => ({ kind: node.className, ...rect(node) }));
            const violations = [];
            for (const card of cards) for (const region of regions) if (gap(card, region) < 15.9) violations.push({ gap: gap(card, region), card, region });
            const covered = background.x <= mapRect.x + .1 && background.y <= mapRect.y + .1 && background.x + background.width >= mapRect.x + mapRect.width - .1 && background.y + background.height >= mapRect.y + mapRect.height - .1;
            const intersection = Math.max(0, Math.min(background.x + background.width, mapRect.x + mapRect.width) - Math.max(background.x, mapRect.x)) * Math.max(0, Math.min(background.y + background.height, mapRect.y + mapRect.height) - Math.max(background.y, mapRect.y));
            const entry = { now, snapshotSeq: snapshot.snapshotSeq, sceneId: p.self.sceneId, movement: p.movement?.status, selected: props.selected, originalSelectionAuthorized: [...p.targets, ...p.items, ...p.entities].some(value => value.entityRef === data.selectedOnStart), viewBox: map.getAttribute('viewBox'), map: mapRect, background, covered, coverRatio: intersection / (mapRect.width * mapRect.height), cards, regions, poses, violations };
            data.frames.push(entry);
            if ((!covered || violations.length) && !data.firstFailureReported) { data.firstFailureReported = true; void window.__saveHudFailure(name); }
          }
        }
      } catch (error) { data.errors.push(error.stack || String(error)); }
      requestAnimationFrame(now => queueMicrotask(() => frame(now)));
    }
    requestAnimationFrame(now => queueMicrotask(() => frame(now)));
  }, name);
  let error;
  try { await action(); } catch (failure) { error = failure; }
  const data = await page.evaluate(async () => { await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); window.__hudMotion.running = false; return structuredClone(window.__hudMotion); });
  report.samples.push(data);
  await capture(page, name + '-end');
  if (error) throw error;
  assert.ok(data.frames.length >= 5, name + '必须有连续真实绘制帧');
  assert.equal(data.errors.length, 0, name + '采样无异常');
  assert.equal(data.frames.filter(frame => !frame.covered).length, 0, name + '所有稳定视口帧必须由真实场景背景完整覆盖');
  assert.equal(data.frames.filter(frame => frame.violations.length).length, 0, name + '所有动态浮卡同时满足16px');
  if (name === 'desktop-selected-door-to-c14') assert.ok(data.frames.every(frame => !frame.originalSelectionAuthorized || frame.selected === data.selectedOnStart), '原铜封门仍授权可见时，每帧保持原选择，不靠清目标通过');
  report.checks.push({ name, status: 'PASS', frames: data.frames.length, movingFrames: data.frames.filter(frame => frame.poses.some(pose => pose.moving === 'true')).length });
}
try {
  assert.equal(report.source.status, '', '产品和载体冻结后运行');
  database = await startTestPostgres('hud-std001', { outputSubdirectory: 'hud-std001' });
  server = await createAuthorityServer({ pool: database.pool }); const address = await server.listen(0), origin = 'http://127.0.0.1:' + address.port;
  vite = await createVite({ root: resolve(repository, 'frontend'), configFile: resolve(repository, 'frontend/vite.config.mjs'), configLoader: 'native', cacheDir: resolve(output, 'vite-cache'), server: { host: '127.0.0.1', port: 0, fs: { allow: [repository] }, proxy: { '/api': { target: origin }, '/socket.io': { target: origin, ws: true } } } });
  await vite.listen(); const baseURL = 'http://127.0.0.1:' + vite.httpServer.address().port;
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: process.env.CHROMIUM_ARGS ? JSON.parse(process.env.CHROMIUM_ARGS) : [] }); report.browserVersion = browser.version();
  const recordingBrowser = { newContext: async options => {
    const context = await browser.newContext({ ...options, recordVideo: { dir: resolve(output, 'recordings'), size: { width: 1600, height: 1000 } } });
    await context.addInitScript(() => { window.__hudErrors = []; window.addEventListener('error', event => window.__hudErrors.push({ message: event.message, time: performance.now() })); });
    return context;
  } };
  room = await browserRoom({ server, browser: recordingBrowser, baseURL, count: 2, report });
  const carer = room.role('B'), page = room.pages[carer];
  for (const current of room.pages) await current.exposeFunction('__saveHudFailure', name => { const pending = capture(current, name + '-first-failure'); pendingImages.push(pending); return pending; });
  await stable(page); await until(() => page.locator('[data-spatial-self] [data-art-frame]').count(), '已公开高才帧已加载');
  const go = room.go; let originalPath = false;
  room.go = async (key, where) => {
    if (key === carer && where.sceneId === room.C('C14').sceneId && where.position.x === 315 && where.position.y === 390 && !originalPath) {
      originalPath = true;
      assert.equal(await page.locator('.spatial-target.selected').getAttribute('aria-label'), '选择铜封门', '复现原选中目标，不清除选择来规避');
      let value;
      await sample(page, 'desktop-selected-door-to-c14', async () => { value = await go(key, where); await displayedAt(page, where.position); });
      return value;
    }
    return go(key, where);
  };
  await openDoor(room); assert.ok(originalPath); room.go = go;
  await page.setViewportSize({ width: 390, height: 844 }); await stable(page);
  await sample(page, 'narrow-edge-receipt-reading', async () => {
    const retained = (await clientState(page)).actions.filter(action => action.receipt); assert.ok(retained.length > 0);
    await closeReading(page); await page.getByRole('button', { name: '动作确认', exact: true }).click();
    const restore = page.locator('.spatial-receipts.hud-card-collapsed').getByRole('button', { name: '取消选择并展开', exact: true });
    if (await restore.isVisible()) {
      await capture(page, 'narrow-receipt-recovery-before');
      const before = await clientState(page); await restore.click();
      await until(() => page.locator('.spatial-receipts:not(.hud-card-collapsed)').isVisible(), '玩家明确取消旧选择后，原收据区实际展开');
      const after = await clientState(page);
      assert.deepEqual(after.actions.map(({ id, raw, receipt }) => ({ id, raw, receipt })), before.actions.map(({ id, raw, receipt }) => ({ id, raw, receipt })), '恢复只改本地选择，原请求字节/nonce/收据保留且不新增动作');
      assert.deepEqual(after.queuedAction, before.queuedAction, '有效导航后续意图不被恢复入口取消');
      report.recovery = { label: '取消选择并展开', before: { selected: true, requests: before.actions.length, queuedAction: before.queuedAction }, after: { requests: after.actions.length, queuedAction: after.queuedAction }, requestsUnchanged: true };
    }
    const receiptItem = page.locator('.spatial-receipts li[data-action-id="' + retained.at(-1).id + '"]');
    await receiptItem.scrollIntoViewIfNeeded(); assert.equal(await receiptItem.isVisible(), true); await capture(page, 'narrow-receipt-recovery-after');
    const parcel = await room.entity(carer, '私人包裹');
    const refused = await room.send(carer, { kind: 'take_item', itemRef: parcel.entityRef, expectedItemRevision: parcel.resourceRevision });
    assert.equal(refused.status, 'Rejected'); assert.equal(refused.code, 'CONSENT_REQUIRED');
    const view = await until(async () => { const s = await snapshot(page); return BigInt(s.snapshotSeq) >= BigInt(refused.observedSeq) ? s : false; }, '原拒绝收据水位已到本端');
    assert.deepEqual(view.projection.items.find(item => item.entityRef === parcel.entityRef).location, parcel.location);
    assert.equal(await page.locator('.spatial-receipts').count(), 0);
    const beforeReading = await clientState(page);
    const restored = await openReading(page, '手记');
    if (restored) {
      const afterReading = await clientState(page);
      assert.deepEqual(afterReading.actions.map(({ id, raw, receipt }) => ({ id, raw, receipt })), beforeReading.actions.map(({ id, raw, receipt }) => ({ id, raw, receipt })), '真实阅读恢复入口不新增动作或改变原请求/收据');
      assert.deepEqual(afterReading.queuedAction, beforeReading.queuedAction, '阅读恢复保留有效后续意图');
      assert.equal(await page.locator('svg.spatial-map').evaluate(map => map.__vueParentComponent.props.selected), '', '只在用户点击准确恢复按钮后取消旧选择');
      report.readingRecovery = { label: '取消选择并展开', selectedBefore: '私人包裹', selectedAfter: '', requestsBefore: beforeReading.actions.length, requestsAfter: afterReading.actions.length, requestsUnchanged: true, queuedActionUnchanged: true };
    }
    assert.ok(await page.locator('.spatial-notebook article').count()); await capture(page, 'narrow-reading'); await closeReading(page);
  });
  await page.setViewportSize({ width: 1600, height: 1000 }); await stable(page);
  await startFollow(room);
  await sample(page, 'desktop-follow-upper-edge', async () => {
    await room.go(carer, room.C('C10')); await displayedAt(page, room.C('C10').position);
    assert.equal(await page.getByRole('button', { name: '暂停带路', exact: true }).count(), 0);
  });
  await page.setViewportSize({ width: 390, height: 844 }); await stable(page);
  await sample(page, 'narrow-follow-to-guest-room', async () => {
    await room.go(carer, room.C('C11')); await displayedAt(page, room.C('C11').position);
    await room.go(carer, room.C('C12')); await displayedAt(page, room.C('C12').position);
    const arrived = await until(async () => { const f = (await room.snapshot('cuilan')).projection.chapter.follows[0]; return f.status === 'arrived' ? f : false; }, '本人实际随行到达');
    const before = await clientState(page);
    await page.locator('.spatial-follow-strip.hud-card-collapsed').getByRole('button', { name: '查看安排', exact: true }).click();
    const status = page.locator('.spatial-reading-pane').getByText('◇已到达，尚未确认安置', { exact: true });
    await status.scrollIntoViewIfNeeded(); assert.equal(await status.isVisible(), true);
    const after = await clientState(page);
    assert.deepEqual(after.actions.map(({ id, raw, receipt }) => ({ id, raw, receipt })), before.actions.map(({ id, raw, receipt }) => ({ id, raw, receipt })), '随行短卡只打开授权安排，不代替本人确认或发出世界动作');
    assert.deepEqual(after.queuedAction, before.queuedAction);
    report.followReading = { label: '查看安排', visibleStatus: (await status.innerText()).trim(), requestsBefore: before.actions.length, requestsAfter: after.actions.length, requestsUnchanged: true };
    await capture(page, 'narrow-follow-reading');
    accepted(await room.interact('cuilan', 'self', 'gz-confirm-settlement', { consentId: arrived.consentId, expectedConsentVersion: arrived.consentVersion }));
  });
  report.sourceEnd = await sourceIdentity(); assert.deepEqual(report.sourceEnd, report.source, '运行期间源码不变'); report.assessment = 'PASS';
} catch (error) {
  report.assessment = 'FAIL'; report.error = error.stack || String(error); console.error(report.error); process.exitCode = 1;
  if (room) report.failedUI = await Promise.all(room.pages.map(page => page.evaluate(async () => {
    const { spatialState } = await import('/src/state/spatial-store.ts');
    const map = document.querySelector('svg.spatial-map'), card = document.querySelector('.spatial-sidebar,.spatial-receipts');
    return { snapshot: spatialState.value.snapshot, selected: map?.__vueParentComponent?.props?.selected, cameraArea: map?.__vueParentComponent?.props?.cameraArea,
      card: card ? { kind: card.getAttribute('data-reading-kind'), className: card.className, style: card.getAttribute('style'), marginTop: getComputedStyle(card).marginTop } : null,
      objectButtons: [...document.querySelectorAll('.spatial-object-list button')].map(node => ({ text: node.textContent.trim(), visible: node.getBoundingClientRect().height > 0 })),
      heading: document.getElementById('spatial-selection-heading')?.textContent };
  })));
} finally {
  await Promise.allSettled(pendingImages);
  if (room) {
    for (const page of room.pages) report.windowErrors.push(await page.evaluate(() => window.__hudErrors).catch(() => ['页面已不可读取']));
    const videos = room.pages.map(page => page.video()); await room.close();
    for (let i = 0; i < videos.length; i++) if (videos[i]) { const file = 'actual-ui-' + (i + 1) + '.webm'; await videos[i].saveAs(resolve(output, file)); report.videos.push({ file, sha256: sha256(await readFile(resolve(output, file))) }); }
  }
  if (report.assessment === 'PASS' && (report.pageErrors.length || report.windowErrors.some(errors => errors.length))) { report.assessment = 'FAIL'; report.error = '真实页面出现错误，不能标为通过'; process.exitCode = 1; }
  report.sourceEnd ||= await sourceIdentity();
  await browser?.close(); await vite?.close(); await server?.close(); await database?.stop();
  report.finishedAt = new Date().toISOString(); await saveJSON(resolve(output, 'result.json'), report);
  console.log(JSON.stringify({ assessment: report.assessment, checks: report.checks, evidence: output }));
}
