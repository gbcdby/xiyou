import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer as createVite } from 'vite';
import { createFullscreenFixture, fullscreenRefs } from './gaolao-fullscreen-fixture.mjs';
import { canvasFrame, canvasPixels, worldPixel } from './canvas-browser-support.mjs';
import { repository, sourceIdentity, saveJSON, sha256, until, sleep } from './network-support.mjs';

// GZ-FS-01..05 与 HC-01..05 作者自查：生产页面与受控授权 DTO。无截图替身，不代表真实后端/真人/全角色素材验收。
const output = resolve(process.env.FRONTEND_EVIDENCE_DIR || resolve(repository, '.agent-output/gaolao-fullscreen-browser'));
await mkdir(output, { recursive: true });
const report = { work_id: 'GZ-UX-01/HC-01', spec: 'GZ-UX-01 v0.9 HC-01，保留 FS-01..05', scope: '生产 Vue 路由、Canvas、Socket 客户端与真实 Chromium；受控公开 DTO，原图资源；不执行真实规则、PG、AI或全角色素材验收', source: await sourceIdentity(), startedAt: new Date().toISOString(), checks: [], pageErrors: [], screenshots: [], cases: [], cleanup: [] };
let fixture, vite, browser, context, page, activeCase;
const check = (id, name, details = {}) => { report.checks.push({ id, name, viewport: activeCase?.name, status: 'PASS', ...details }); console.log(JSON.stringify({ id, name, viewport: activeCase?.name, status: 'PASS' })); };
const state = () => page.evaluate(async () => structuredClone((await import('/src/state/spatial-store.ts')).spatialState.value));
const closeTo = (actual, expected, message, tolerance = 1) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}：${actual} / ${expected}`);
const map = () => page.getByTestId('spatial-map');
const returnButton = () => page.getByRole('button', { name: '回到角色', exact: true });
async function moreButton(name) {
  const expand = page.getByRole('button', { name: '展开工具栏', exact: true });
  if (await expand.isVisible()) await expand.click();
  const menu = page.locator('#gaolao-more-tools');
  if (!await menu.isVisible()) await page.getByRole('button', { name: '更多', exact: true }).click();
  return menu.getByRole('button', { name, exact: true });
}
const positionOf = frame => frame.actors.find(actor => actor.ref === fullscreenRefs.self)?.position;
const entryPlugin = {
  name: 'gaolao-fullscreen-test-entry',
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (request.url !== '/fullscreen-fixture') return next();
      response.setHeader('Content-Type', 'text/html;charset=utf-8');
      response.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><p>即将进入生产页面；本入口使用受控公开 DTO。</p><script>sessionStorage.setItem("xiyou.guest.v1",JSON.stringify({token:"fullscreen-fixture",userId:"fullscreen-user",name:"全屏镜头受控检查"}));location.replace("/spatial/fullscreen-fixture");</script></body></html>');
    });
  },
};

async function picture(name) {
  const file = `${activeCase.name}-${name}.png`; await page.screenshot({ path: resolve(output, file) });
  report.screenshots.push({ file, viewport: page.viewportSize(), sha256: sha256(await readFile(resolve(output, file))) });
}
async function dimensions() {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="spatial-map"]'), box = canvas.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height, innerWidth, innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, scrollX, scrollY };
  });
}
async function assertFullscreen() {
  const result = await dimensions();
  for (const [key, expected] of Object.entries({ x: 0, y: 0, width: result.innerWidth, height: result.innerHeight, scrollX: 0, scrollY: 0 })) closeTo(result[key], expected, `主场景 ${key} 必须覆盖整个可视窗口`);
  assert.ok(result.scrollWidth <= result.innerWidth + 1 && result.scrollHeight <= result.innerHeight + 1, '文档不能出现横向或纵向滚动');
  return result;
}
function assertCovered(frame) {
  const { fit, viewport, view } = frame;
  assert.ok(fit.x <= .5 && fit.y <= .5, '画面左上边缘不能露出场景外空白');
  assert.ok(fit.x + view.width * fit.scale >= viewport.width - .5 && fit.y + view.height * fit.scale >= viewport.height - .5, '画面右下边缘不能露出场景外空白');
}
async function stableFrame() {
  let prior = await canvasFrame(page);
  return until(async () => { await sleep(35); const next = await canvasFrame(page); const same = ['x', 'y', 'scale'].every(key => Math.abs(next.fit[key] - prior.fit[key]) < .05); prior = next; return same ? next : false; }, '镜头停止变化', 3000);
}

async function compactPreferences() {
  assert.equal(await page.getByTestId('gaolao-goal').count(), 0, '共同目标默认折叠，只保留下一步');
  assert.equal(await page.getByTestId('gaolao-next-step').isVisible(), true, '下一步始终可见');
  assert.equal(await page.getByTestId('gaolao-minimap').count(), 0, '地图默认收起');
  assert.equal(await page.getByRole('button', { name: '收起工具栏', exact: true }).isVisible(), true);
  assert.equal((await canvasFrame(page)).labels.length, 0, '默认不铺满场景名称');
  const before = await stableFrame(), wires = fixture.wires.length;
  await page.getByRole('button', { name: '任务详情', exact: true }).click();
  assert.equal(await page.getByTestId('gaolao-goal').isVisible(), true);
  await page.getByRole('button', { name: '展开地图', exact: true }).click();
  await page.getByTestId('gaolao-minimap').waitFor();
  await picture('expanded');
  await page.getByRole('button', { name: '收起工具栏', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '行囊', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '停步 / 取消后续操作', exact: true }).isVisible(), true, '收起后停步仍直接可达');
  assertSameView(await canvasFrame(page), before, '三个区域展开收起');
  await assertFullscreen(); assert.equal(fixture.wires.length, wires, '折叠操作不发世界命令');
  await page.reload();
  const resume = page.getByRole('button', { name: '恢复本人控制', exact: true });
  await map().waitFor(); if (await resume.isVisible()) await resume.click();
  await until(async () => (await state()).inputReady, '重载后的本人控制已恢复');
  await page.getByRole('button', { name: '收起详情', exact: true }).waitFor();
  await page.getByRole('button', { name: '收起地图', exact: true }).waitFor();
  await page.getByRole('button', { name: '展开工具栏', exact: true }).waitFor();
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('xiyou.gaolao-hud.v1')));
  assert.deepEqual(persisted, { guidanceExpanded: true, mapExpanded: true, dockExpanded: false }, '只记忆三个显示偏好');
  await page.getByRole('button', { name: '收起详情', exact: true }).click();
  await page.getByRole('button', { name: '收起地图', exact: true }).click();
  await picture('collapsed'); await assertFullscreen();
  await page.getByRole('button', { name: '展开工具栏', exact: true }).click();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button', { name: '展开工具栏', exact: true }).evaluate(button => button === document.activeElement), true, '底栏 Esc 收起后回焦工具入口');
  await page.getByRole('button', { name: '展开工具栏', exact: true }).click();
  check('GZ-HC-01/02/03', '默认精简、三个区域可展开收起，刷新记住偏好且停步保留');
}

async function contextualLabels() {
  const frame = await stableFrame(), self = await worldPixel(page, positionOf(frame), { round: true }), wires = fixture.wires.length;
  assert.equal(self.hit.tag, 'CANVAS', '本人脚底可用于真实指针命中');
  // 使用实际完成帧的脚底位置，固定屏幕偏移在缩小视口时会落入角色透明间隙。
  await page.mouse.move(self.pixel.x, self.pixel.y);
  await until(async () => (await canvasFrame(page)).labels.some(label => label.key === fullscreenRefs.self), '停止动画后悬停唤醒名称');
  const hovering = await canvasFrame(page), label = hovering.labels.find(label => label.key === fullscreenRefs.self);
  assert.equal(hovering.labels.length, 1, '悬停仅显示一个相关名称');
  const box = await map().boundingBox();
  await page.mouse.move(box.x + label.x + label.width / 2, box.y + label.y + label.height / 2);
  await page.mouse.down(); await sleep(90); await page.mouse.up();
  await page.locator('#spatial-selection-heading').waitFor();
  assert.equal(fixture.wires.length, wires, '按住名称跨绘制帧后松手只选择，不误发行走');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '任务详情', exact: true }).hover();
  await until(async () => (await canvasFrame(page)).labels.length === 0, '离开并取消选中后名称重新收起');
  assertSameView(await canvasFrame(page), frame, '悬停和选中名称');
  check('GZ-HC-04', '静止悬停唤醒、名称按住再松开、离开后隐藏均不改变世界动作和镜头');
}

async function startCapture() {
  await page.evaluate(async () => {
    const { SpatialCanvas } = await import('/src/rendering/spatial-canvas.ts');
    const original = SpatialCanvas.prototype.paint;
    const capture = window.__fullscreenCapture = { phase: 'ready', paints: [] };
    SpatialCanvas.prototype.paint = function(...args) {
      const result = Reflect.apply(original, this, args);
      if (result) {
        const [snapshot, , motionAt] = args;
        capture.paints.push({ at: performance.now(), motionAt, phase: capture.phase, serial: result.serial, instance: result.instance, sceneId: result.sceneId, fit: result.fit, viewport: result.viewport, view: result.view, self: result.actors.find(actor => actor.ref === snapshot.projection.self.entityRef), labels: result.labels.map(label => label.key), refs: [...result.actors.map(actor => actor.ref), ...result.objects.map(object => object.ref)] });
      }
      return result;
    };
    capture.restore = () => { SpatialCanvas.prototype.paint = original; };
  });
}
async function phase(name) { await page.evaluate(name => { window.__fullscreenCapture.phase = name; }, name); }
async function captured(name) { return page.evaluate(name => window.__fullscreenCapture.paints.filter(paint => paint.phase === name), name); }
async function finishCapture() {
  return page.evaluate(() => { const capture = window.__fullscreenCapture; if (!capture) return null; capture.restore(); return { paints: capture.paints }; });
}

async function barePoint({ clear = false } = {}) {
  return page.getByTestId('spatial-map').evaluate(async (canvas, clear) => {
    const frame = (await import('/src/rendering/spatial-canvas.ts')).readCanvasFrame(canvas), box = canvas.getBoundingClientRect();
    for (const yFraction of [.55, .62, .45, .7, .4]) for (const xFraction of [.5, .35, .65, .25, .75]) {
      const x = box.left + box.width * xFraction, y = box.top + box.height * yFraction;
      if (document.elementFromPoint(x, y) !== canvas) continue;
      const local = { x: x - box.left, y: y - box.top };
      const world = { x: (local.x - frame.fit.x) / frame.fit.scale, y: (local.y - frame.fit.y) / frame.fit.scale };
      if (clear && (frame.labels.some(label => local.x >= label.x - 12 && local.x <= label.x + label.width + 12 && local.y >= label.y - 12 && local.y <= label.y + label.height + 12)
        || [...frame.actors, ...frame.objects].some(item => Math.abs(item.position.x - world.x) < 125 && Math.abs(item.position.y - world.y) < 135))) continue;
      return { x, y, world };
    }
    throw new Error('当前布局没有可点击的世界画布热区');
  }, clear);
}
async function mouseDrag(dx = 120, dy = 28) {
  const from = await barePoint();
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 18 }); await page.mouse.up();
  return { from, dx, dy };
}
async function touchDrag(dx = 110, dy = 24) {
  const from = await barePoint(), cdp = await context.newCDPSession(page);
  const point = (x, y) => [{ x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 }];
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(from.x, from.y) });
    for (let i = 1; i <= 18; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(from.x + dx * i / 18, from.y + dy * i / 18) }); await sleep(12); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await cdp.detach(); }
  return { from, dx, dy };
}
async function waitSelf(position) {
  return until(async () => { const frame = await canvasFrame(page), actual = positionOf(frame); return actual && Math.hypot(actual.x - position.x, actual.y - position.y) < 1 ? frame : false; }, '受控已确认位移完成真实画面呈现', 6000);
}
function assertFollow(frame) {
  const self = frame.self?.position || positionOf(frame), { fit, viewport, view } = frame;
  assert.ok(self, '实际绘制含本人');
  const expected = {
    x: Math.max(viewport.width - view.width * fit.scale, Math.min(0, viewport.width / 2 - self.x * fit.scale)),
    y: Math.max(viewport.height - view.height * fit.scale, Math.min(0, viewport.height / 2 - self.y * fit.scale)),
  };
  closeTo(fit.x, expected.x, '镜头横向跟随同一绘制帧本人位置', .75);
  closeTo(fit.y, expected.y, '镜头纵向跟随同一绘制帧本人位置', .75);
  assertCovered(frame);
}
function assertSameView(actual, before, reason) {
  assert.deepEqual(actual.viewport, before.viewport, `${reason}不能改变画布尺寸`);
  assert.deepEqual(actual.view, before.view, `${reason}不能改变世界边界`);
  for (const key of ['x', 'y', 'scale']) closeTo(actual.fit[key], before.fit[key], `${reason}不能移动或缩放自由镜头`, .75);
}

async function panelsKeepCamera(before) {
  await phase('panels');
  const dock = page.locator('.spatial-tool-dock');
  const hudButton = dock.getByRole('button', { name: '行囊', exact: true }), hudBox = await hudButton.boundingBox(), world = await barePoint(), actions = fixture.wires.length;
  await page.mouse.move(hudBox.x + hudBox.width / 2, hudBox.y + hudBox.height / 2); await page.mouse.down(); await page.mouse.move(world.x, world.y, { steps: 10 }); await page.mouse.up();
  assertSameView(await canvasFrame(page), before, '从悬浮 UI 开始拖动'); assert.equal(fixture.wires.length, actions, 'UI 开始的输入不穿透至世界');
  const details = page.getByRole('button', { name: '任务详情', exact: true });
  if (await details.isVisible()) { await details.click(); assertSameView(await canvasFrame(page), before, '任务详情打开'); await assertFullscreen(); await page.getByRole('button', { name: '收起详情', exact: true }).click(); }
  for (const name of ['行囊', '手记', '交谈', '队伍']) {
    const button = dock.getByRole('button', { name, exact: true }); assert.equal(await button.count(), 1, `${name}入口唯一`);
    await button.click();
    await page.locator('#spatial-reading-pane').waitFor();
    await assertFullscreen(); assertSameView(await canvasFrame(page), before, `${name}打开`);
    if (name === '手记') {
      const pane = await page.locator('#spatial-reading-pane').evaluate(element => { const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, innerWidth, innerHeight }; });
      assert.ok(pane.x >= -1 && pane.y >= -1 && pane.right <= pane.innerWidth + 1 && pane.bottom <= pane.innerHeight + 1, '长手记面板必须留在视口内');
      await picture('notebook');
      await page.getByRole('button', { name: '更多', exact: true }).click();
      const objects = page.locator('#gaolao-more-tools').getByRole('button', { name: '场景对象', exact: true });
      assert.equal(await objects.evaluate(button => { const box = button.getBoundingClientRect(); return button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); }), true, '阅读面板不能遮住更多菜单的点击区域');
      await page.keyboard.press('Escape');
    }
    if (name === '交谈') {
      const wires = fixture.wires.length; await page.getByLabel('交谈内容', { exact: true }).fill('只检查键盘作用域');
      await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight'); await sleep(80);
      assert.equal(fixture.wires.length, wires, '文本框中的方向键不发送世界动作');
    }
    await page.keyboard.press('Escape'); await page.locator('#spatial-reading-pane').waitFor({ state: 'hidden' });
    assertSameView(await canvasFrame(page), before, `${name}关闭回焦`); await assertFullscreen();
  }
  const recap = await moreButton('回看'); assert.equal(await recap.isDisabled(), true, '运行态保留回看入口且遵守终态读取约束');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#gaolao-more-tools').count(), 0, 'Esc 可关闭更多菜单');
  assert.equal(await page.getByRole('button', { name: '更多', exact: true }).evaluate(button => button === document.activeElement), true, '菜单 Esc 返回更多入口');
  await page.getByRole('button', { name: '查看高才的角色信息', exact: true }).click();
  await page.locator('#spatial-reading-pane').waitFor(); await assertFullscreen();
  assertSameView(await canvasFrame(page), before, '身份详情打开'); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '停步 / 取消后续操作', exact: true }).click();
  await until(async () => (await state()).actions.some(action => action.status === 'accepted'), '先产生一条可读的受控停步收据');
  await (await moreButton('回执')).click();
  await page.locator('#spatial-receipts').waitFor(); assertSameView(await canvasFrame(page), before, '回执打开'); await assertFullscreen();
  await page.keyboard.press('Escape'); assertSameView(await canvasFrame(page), before, '回执关闭回焦');
  await (await moreButton('场景对象')).click();
  await page.getByRole('button', { name: '关闭对象区', exact: true }).waitFor();
  assert.equal(await map().getAttribute('data-label-mode'), 'all', '场景对象展开时恢复全部名称');
  assertSameView(await canvasFrame(page), before, '对象列表打开'); await assertFullscreen();
  await page.keyboard.press('Escape'); assertSameView(await canvasFrame(page), before, '对象列表关闭回焦');
  assert.equal(await map().getAttribute('data-label-mode'), 'contextual', '关闭对象区恢复按需名称');
  const navigator = page.locator('.gaolao-map-navigator'), expand = navigator.getByRole('button', { name: '展开地图', exact: true });
  if (await expand.isVisible()) await expand.click();
  await dock.getByRole('button', { name: '手记', exact: true }).click();
  assert.equal(await page.getByTestId('gaolao-minimap').count(), 0, '阅读时暂时收起地图');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('xiyou.gaolao-hud.v1')).mapExpanded), true, '临时收起不覆盖玩家地图偏好');
  await page.keyboard.press('Escape'); await page.getByTestId('gaolao-minimap').waitFor();
  const wires = fixture.wires.length;
  await navigator.getByRole('button', { name: '全部', exact: true }).click();
  await page.getByLabel('查看地图场景', { exact: true }).selectOption('gaolao-village-road');
  assert.equal(await page.getByTestId('gaolao-minimap').getAttribute('data-map-mode'), 'all');
  assert.equal(fixture.wires.length, wires, '仅查看全部地图不发送世界动作');
  assertSameView(await canvasFrame(page), before, '全部地图打开'); await assertFullscreen();
  await navigator.getByRole('button', { name: '当前', exact: true }).click();
  await picture('map');
  const collapse = navigator.getByRole('button', { name: '收起地图', exact: true }); if (await collapse.isVisible()) await collapse.click();
  assertSameView(await canvasFrame(page), before, '地图关闭');
  assert.equal(await returnButton().isVisible(), true, '面板回焦保持偏离状态及回到角色入口');
  check('GZ-FS-01/05、GZ-HC-03', '常用工具、身份、更多、对象、回执与地图可达，临时收起保留偏好，Esc 回焦不移动画布');
}

async function hitAndKeyboard() {
  await phase('inverse-and-hit');
  const ground = await barePoint({ clear: true }), target = await worldPixel(page, ground.world, { round: true });
  assert.equal(target.hit.tag, 'CANVAS', '点地热区未被悬浮 UI 截获');
  const before = fixture.wires.length;
  await page.mouse.click(target.pixel.x, target.pixel.y);
  await until(() => fixture.wires.length > before, '拖动后的点地请求');
  assert.equal(fixture.wires[before].request.action.kind, 'move_to');
  assert.deepEqual(fixture.wires[before].request.action.destination, target.mappedWorld, '点地坐标必须按已完成绘制的 camera fit 逆变换');
  const frame = await canvasFrame(page), self = await worldPixel(page, positionOf(frame), { round: true });
  assert.equal(self.hit.tag, 'CANVAS', '本人实际脚底应能在场景中点选');
  const count = fixture.wires.length; await page.mouse.click(self.pixel.x, self.pixel.y);
  await until(() => page.locator('#spatial-selection-heading').innerText().then(text => /你的位置/.test(text)), '拖动后点击本人实际脚底');
  assert.equal(fixture.wires.length, count, '实际人物命中只选取，不误发行走');
  await page.keyboard.press('Escape');
  await until(async () => (await state()).directionInput.ready, '键盘方向输入就绪');
  await map().focus(); const start = fixture.wires.length;
  await page.keyboard.down('ArrowRight'); await sleep(120); await page.keyboard.up('ArrowRight');
  await until(() => fixture.wires.slice(start).some(row => row.request.action.kind === 'stop_move'), '方向键松开停步');
  assert.ok(fixture.wires.slice(start).some(row => row.request.action.kind === 'move_direction'), '自由查看不取消既有键盘行走入口');
  check('GZ-FS-04/05', '拖动后点地逆变换、人物脚底命中和键盘方向/停步保持正确', { destination: target.mappedWorld });
}

async function cancelledGestures() {
  await phase('cancel');
  const start = await barePoint(), before = fixture.wires.length;
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 35, start.y + 15, { steps: 4 });
  // 浏览器真实鼠标先建立捕获；显式取消事件只测试浏览器取消分支，不冒充真机系统手势。
  await map().dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: start.x + 35, clientY: start.y + 15, buttons: 0 });
  const cancelled = await stableFrame();
  await page.mouse.move(start.x - 35, start.y - 15, { steps: 4 }); await page.mouse.up(); await sleep(80);
  assertSameView(await canvasFrame(page), cancelled, 'pointercancel 后无按键移动');
  assert.equal(fixture.wires.length, before, '取消拖动后不补发点击移动');
  const next = await barePoint();
  await page.mouse.move(next.x, next.y); await page.mouse.down(); await page.mouse.move(next.x + 30, next.y + 10, { steps: 4 });
  await page.locator('.spatial-tool-dock').getByRole('button', { name: '行囊', exact: true }).focus();
  const blurred = await stableFrame(); await page.mouse.move(next.x - 30, next.y - 10, { steps: 4 }); await page.mouse.up();
  assertSameView(await canvasFrame(page), blurred, '画布失焦后');
  assert.equal(fixture.wires.length, before, '失焦收束手势且不发世界动作');
  if (activeCase.touch) {
    const cdp = await context.newCDPSession(page), point = await barePoint();
    const touch = (id, x, y) => ({ id, x, y, radiusX: 1, radiusY: 1, force: 1 });
    try {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(1, point.x, point.y)] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(1, point.x + 25, point.y)] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(1, point.x + 25, point.y), touch(2, point.x + 55, point.y + 35)] });
      const multi = await stableFrame();
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(1, point.x + 65, point.y), touch(2, point.x + 95, point.y + 35)] });
      assertSameView(await canvasFrame(page), multi, '第二根手指中断拖动后');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      assert.equal(fixture.wires.length, before, '多指中断不产生移动/选择命令');
    } finally { await cdp.detach(); }
  }
  check('GZ-FS-02', '指针取消、画布失焦与触屏多指中断后无黏住拖动', { touch: activeCase.touch === true, cancellationScope: '真实输入建立拖动；pointercancel 分支通过显式浏览器事件注入' });
}

async function clampAndReturn() {
  await phase('edges');
  // 连续拖动至两端；实际 capture 仍跨 HUD，世界中心必须始终被边界约束。
  for (const delta of [[3000, 3000], [-3000, -3000]]) { await mouseDrag(...delta); assertCovered(await stableFrame()); }
  const boundaryFrames = await captured('edges'); assert.ok(boundaryFrames.length >= 4); boundaryFrames.forEach(assertCovered);
  const frame = await canvasFrame(page), offscreen = frame.actors.filter(actor => {
    const x = frame.fit.x + actor.position.x * frame.fit.scale, y = frame.fit.y + actor.position.y * frame.fit.scale;
    return x < -80 || x > frame.viewport.width + 80 || y < -100 || y > frame.viewport.height + 100;
  });
  for (const actor of offscreen) assert.ok(!frame.labels.some(label => label.key === actor.ref), '画外人物名字不能夹到画面边缘');
  assert.equal(frame.actors.length, fixture.snapshot().projection.sceneOverview.entities.length, '裁切只改变显示，不删除授权实体集合');
  if (activeCase.name === 'phone') assert.ok(offscreen.length > 0, '竖屏极限拖动必须实际覆盖画外人物');
  await picture('edge');
  await returnButton().waitFor(); await phase('return'); const start = await canvasFrame(page);
  await returnButton().click();
  await until(() => returnButton().count().then(count => count === 0), '回到角色完成后隐藏按钮');
  const centred = await stableFrame(); assertFollow(centred);
  const transition = await captured('return');
  const changed = Math.hypot(start.fit.x - centred.fit.x, start.fit.y - centred.fit.y);
  if (changed > 20) assert.ok(transition.filter(value => Math.hypot(value.fit.x - start.fit.x, value.fit.y - start.fit.y) > 1 && Math.hypot(value.fit.x - centred.fit.x, value.fit.y - centred.fit.y) > 1).length >= 2, '正常动态偏好下回中有真实连续过渡帧');
  await picture('returned');
  check('GZ-FS-03/04', '连续拖动边界无空白，画外标签不贴边；回中连续过渡并恢复跟随', { offscreen: offscreen.map(actor => actor.ref), returnFrames: transition.length });

  await mouseDrag(); await returnButton().waitFor(); await page.emulateMedia({ reducedMotion: 'reduce' });
  await returnButton().evaluate(button => button.addEventListener('click', () => { window.__fullscreenCapture.phase = 'reduced-return'; }, { once: true, capture: true }));
  await returnButton().click(); await until(() => returnButton().count().then(count => count === 0), '减少动态立即回中', 1000);
  assertFollow(await canvasFrame(page));
  const reduced = await captured('reduced-return');
  const final = reduced.at(-1); assert.ok(final); reduced.forEach(value => { closeTo(value.fit.x, final.fit.x, '减少动态不播放横向回中过渡', 1); closeTo(value.fit.y, final.fit.y, '减少动态不播放纵向回中过渡', 1); });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  check('GZ-FS-03', '减少动态偏好立即回中');
}

async function resizeAndScene() {
  await mouseDrag(); const before = await stableFrame();
  const oldCentre = { x: (before.viewport.width / 2 - before.fit.x) / before.fit.scale, y: (before.viewport.height / 2 - before.fit.y) / before.fit.scale };
  const viewport = { width: activeCase.viewport.width - 20, height: activeCase.viewport.height - 20 }; await page.setViewportSize(viewport);
  await until(async () => { const frame = await canvasFrame(page); return Math.abs(frame.viewport.width - viewport.width) < 1 && Math.abs(frame.viewport.height - viewport.height) < 1; }, '自由镜头 resize 完成');
  const resized = await stableFrame(); assertCovered(resized); await assertFullscreen();
  for (const [key, size] of [['x', 'width'], ['y', 'height']]) {
    const half = resized.viewport[size] / resized.fit.scale / 2;
    const expected = Math.max(half, Math.min(resized.view[size] - half, oldCentre[key]));
    const actual = (resized.viewport[size] / 2 - resized.fit[key]) / resized.fit.scale;
    closeTo(actual, expected, 'resize 保留原自由中心并约束边界', 1.5);
  }
  await page.getByRole('button', { name: '收起工具栏', exact: true }).click();
  fixture.changeScene();
  await until(() => page.getByTestId('spatial-map').evaluate(async canvas => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('主场景必须是真实 Canvas');
    // 换景先清除旧帧，再于下一绘制帧合成；等待期间允许尚无完成帧。
    const frame = (await import('/src/rendering/spatial-canvas.ts')).readCanvasFrame(canvas);
    return frame?.sceneId === 'gaolao-village-road';
  }), '公开 DTO 切换场景');
  await until(() => returnButton().count().then(count => count === 0), '换景重置为跟随');
  assertFollow(await stableFrame()); await assertFullscreen();
  assert.equal(await page.getByRole('button', { name: '展开工具栏', exact: true }).isVisible(), true, '换景保留工具栏收起偏好');
  await page.getByRole('button', { name: '展开工具栏', exact: true }).click();
  await picture('new-scene'); check('GZ-FS-03', 'resize 保留合法自由视角，换景复位跟随');
}

async function unknownReceipt() {
  await page.getByRole('button', { name: '收起工具栏', exact: true }).click();
  fixture.unknownNext(); const before = fixture.wires.length;
  await page.getByRole('button', { name: '停步 / 取消后续操作', exact: true }).click();
  await until(async () => (await state()).actions.some(action => action.status === 'unknown'), '受控停步结果未知');
  const wire = fixture.wires[before]; assert.equal(wire.request.action.kind, 'stop_move');
  const urgent = page.locator('.gaolao-urgent-receipts');
  assert.equal(await urgent.isVisible(), true, '工具栏收起时未知回执仍可见');
  assert.match(await urgent.innerText(), /1 条动作待确认/, '未知回执使用真实计数');
  await page.getByRole('button', { name: '查看高才的角色信息', exact: true }).click();
  await page.locator('#spatial-reading-pane').waitFor();
  assert.equal(await urgent.evaluate(button => { const box = button.getBoundingClientRect(); return button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); }), true, '阅读面板不能遮住未确认动作的直接恢复入口');
  await urgent.click();
  const row = page.locator(`[data-action-id="${wire.request.clientActionId}"]`);
  await row.getByRole('button', { name: '查询结果', exact: true }).click();
  await until(async () => (await state()).actions.find(action => action.id === wire.request.clientActionId)?.status === 'accepted', '原身份查询取得受控收据');
  assert.ok(fixture.queries.includes(wire.request.clientActionId));
  assert.equal((await state()).actions.find(action => action.id === wire.request.clientActionId).raw, wire.raw, '查询保留原请求身份与字节');
  await assertFullscreen(); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '展开工具栏', exact: true }).click();
  check('GZ-FS-05、GZ-HC-03', '收起底栏后停步与未知回执查询保持可达且保留原请求', { scope: '受控收据；不宣称真实后端幂等验证' });
}

async function terminalRecap() {
  const before = await stableFrame();
  fixture.publish(p => { p.phase = 'Finished'; p.self.canControl = false; p.ending = { title: '受控检查已结束', summary: '仅测试终态回看入口，不代表真实章节结局。', endingCode: 'GZ-E02', facts: [] }; });
  await until(async () => (await state()).snapshot.projection.phase === 'Finished', '受控终态已应用');
  await (await moreButton('回看')).click();
  await page.getByText('受控历史条目：只检查回看面板的可达性。', { exact: true }).waitFor();
  await assertFullscreen(); assertSameView(await canvasFrame(page), before, '终态回看打开');
  await page.keyboard.press('Escape'); assertSameView(await canvasFrame(page), before, '终态回看关闭');
  check('GZ-FS-05', '终态回看通过受控 HTTP 读取，面板留在视口内并可关闭');
}
async function openCase(spec) {
  fixture.reset(); activeCase = { ...spec, startedAt: new Date().toISOString() }; report.cases.push(activeCase);
  context = await browser.newContext({ viewport: spec.viewport, deviceScaleFactor: 1, hasTouch: spec.touch === true, recordVideo: { dir: resolve(output, 'video-work'), size: spec.viewport } });
  page = await context.newPage(); page.setDefaultTimeout(5000);
  page.on('pageerror', error => report.pageErrors.push({ viewport: spec.name, message: error.message }));
  await page.addInitScript(() => sessionStorage.setItem('xiyou.guest.v1', JSON.stringify({ token: 'fullscreen-fixture', userId: 'fullscreen-user', name: '全屏镜头受控检查' })));
  await page.goto(`${vite.resolvedUrls.local[0]}spatial/fullscreen-fixture`);
  await page.getByRole('button', { name: '恢复本人控制', exact: true }).click();
  await until(async () => (await state()).inputReady, '页面恢复本人控制');
  await until(async () => { const frame = await canvasFrame(page); return frame.layerStatus === 'ready' && frame.resources.every(resource => resource.status === 'ready'); }, '夹具实际引用的原始资源完成预解码');
  await compactPreferences();
  await until(async () => { const frame = await canvasFrame(page); return frame.layerStatus === 'ready' && frame.resources.every(resource => resource.status === 'ready'); }, '重载后原始资源完成预解码');
  await startCapture();
}
async function closeCase() {
  if (!context) return;
  activeCase.capture = await finishCapture().catch(error => ({ error: error.message }));
  activeCase.wires = structuredClone(fixture.wires); activeCase.queries = [...fixture.queries];
  const video = page.video(); await context.close(); context = null; page = null;
  if (video) { const file = `${activeCase.name}-camera.webm`; await video.saveAs(resolve(output, file)); activeCase.video = { file, scope: '本次同一生产页面的真实浏览器连续录制；受控DTO，非真人操作' }; }
  if (activeCase.assessment === 'PASS') assert.ok(activeCase.capture && !activeCase.capture.error, '已通过的镜头用例必须成功保存连续绘制证据');
}

async function runCase(spec) {
  await openCase(spec);
  activeCase.initial = await assertFullscreen(); activeCase.pixels = await canvasPixels(page); assertCovered(await canvasFrame(page));
  await picture('follow'); check('GZ-FS-01', 'Canvas 覆盖整个视口且文档无滚动', activeCase.initial);
  await contextualLabels();
  assert.equal(await returnButton().count(), 0, '初始跟随时不显示回到角色');
  await phase('follow-motion'); fixture.moveSelf({ x: 900, y: 630 }); await waitSelf({ x: 900, y: 630 });
  const following = await captured('follow-motion'); assert.ok(new Set(following.map(frame => frame.self.position.x.toFixed(2))).size >= 4, '跟随检查必须实际经过多个已确认插值位置'); following.forEach(assertFollow);
  const before = await stableFrame(), world = fixture.snapshot().projection.self.position, wireCount = fixture.wires.length;
  await phase('drag'); activeCase.drag = spec.touch ? await touchDrag() : await mouseDrag();
  const free = await stableFrame(); assertCovered(free);
  assert.ok(Math.hypot(free.fit.x - before.fit.x, free.fit.y - before.fit.y) > 8, '鼠标/手指拖动必须实际平移视角');
  assert.equal(fixture.wires.length, wireCount, '拖动结束不能发送行走/选取世界请求'); assert.deepEqual(fixture.snapshot().projection.self.position, world, '拖动不改变权威 DTO 位置');
  assert.equal(await page.locator('#spatial-selection-heading').count(), 0, '拖动未误选人物或物件');
  assert.equal(await returnButton().count(), 1); assert.equal(await returnButton().isVisible(), true);
  const self = positionOf(free), screen = { x: free.fit.x + self.x * free.fit.scale, y: free.fit.y + self.y * free.fit.scale };
  assert.ok(screen.x > 0 && screen.x < free.viewport.width && screen.y > 0 && screen.y < free.viewport.height, '本项实际覆盖本人仍可见但镜头偏离');
  await picture('free');
  await phase('free-motion'); fixture.moveSelf({ x: 800, y: 630 }); await waitSelf({ x: 800, y: 630 });
  const freeFrames = await captured('free-motion'); assert.ok(freeFrames.length >= 4); freeFrames.forEach(frame => assertSameView(frame, free, '自由取景期间本人行走'));
  check('GZ-FS-02/03', '同帧本人插值跟随；拖动不移动/选取，自由镜头在人物行走后保持', { touch: spec.touch === true, followFrames: following.length, freeFrames: freeFrames.length });
  await panelsKeepCamera(await stableFrame());
  await hitAndKeyboard(); await cancelledGestures(); await clampAndReturn(); await unknownReceipt(); await resizeAndScene(); await terminalRecap();
  activeCase.assessment = 'PASS';
}

try {
  fixture = await createFullscreenFixture();
  vite = await createVite({ root: resolve(repository, 'frontend'), configFile: resolve(repository, 'frontend/vite.config.mjs'), configLoader: 'native', cacheDir: resolve(output, 'vite-cache'), plugins: [entryPlugin], server: { host: '127.0.0.1', port: 0, fs: { allow: [repository] }, proxy: { '/api': { target: fixture.origin }, '/socket.io': { target: fixture.origin, ws: true } } } });
  await vite.listen();
  if (process.argv.includes('--serve-only')) {
    report.assessment = 'SERVE_ONLY'; report.environment = { node: process.version, baseURL: vite.resolvedUrls.local[0] };
    console.log(JSON.stringify({ mode: '仅启动真实页面与受控DTO，未执行自动浏览器断言', url: `${vite.resolvedUrls.local[0]}fullscreen-fixture`, instructions: '测试入口设置受控身份后跳转生产路由；点击恢复本人控制即可。退出使用 SIGINT/SIGTERM。' }));
    await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
  } else {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: process.env.CHROMIUM_ARGS ? JSON.parse(process.env.CHROMIUM_ARGS) : [] });
  report.environment = { node: process.version, chromium: browser.version(), playwright: '1.57.0', baseURL: vite.resolvedUrls.local[0] };
  for (const spec of [{ name: 'desktop-1440', viewport: { width: 1440, height: 900 } }, { name: 'desktop-1366', viewport: { width: 1366, height: 768 } }, { name: 'phone', viewport: { width: 390, height: 844 }, touch: true }, { name: 'landscape', viewport: { width: 844, height: 390 }, touch: true }]) {
    try { await runCase(spec); } catch (error) { activeCase.assessment = 'FAIL'; activeCase.error = error.stack; await picture('failure').catch(() => {}); throw error; } finally { await closeCase(); }
  }
  assert.deepEqual(report.pageErrors, []); report.assessment = 'PASS';
  }
} catch (error) {
  report.assessment = /Failed to launch|Executable doesn't exist|Operation not permitted/.test(error.message) ? 'ENVIRONMENT_BLOCKED' : 'FAIL'; report.error = error.stack;
  if (page) await picture('failure').catch(() => {}); console.error(error.stack); process.exitCode = 1;
} finally {
  for (const [name, close] of [['context', closeCase], ['browser', () => browser?.close()], ['vite', () => vite?.close()], ['fixture', () => fixture?.close()]]) {
    try { await close(); report.cleanup.push({ name, status: 'closed' }); } catch (error) { report.cleanup.push({ name, status: 'error', message: error.message }); if (report.assessment === 'PASS') report.assessment = 'FAIL_CLEANUP'; process.exitCode = 1; }
  }
  report.finishedAt = new Date().toISOString();
  try {
    report.sourceEnd = await sourceIdentity();
    report.sourceComparison = { before: sha256(report.source), after: sha256(report.sourceEnd) };
    assert.equal(report.sourceComparison.after, report.sourceComparison.before, '执行期间源码身份发生变化，本次证据不能跨候选标为通过');
  } catch (error) { report.assessment = 'FAIL_SOURCE_IDENTITY'; report.sourceError = error.message; process.exitCode = 1; }
  await saveJSON(resolve(output, 'result.json'), report); console.log(JSON.stringify({ assessment: report.assessment, output }));
}
