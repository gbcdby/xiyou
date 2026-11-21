import assert from 'node:assert/strict';

// 从真实页面的可见操作和 HTTP 边界验收；房间和身份均为受控样本。
export async function checkLobbyLayout(context, baseURL, output) {
  const checks = []; const errors = [];
  const identity = { token: 'lobby-layout-fixture', userId: 'lobby-layout-user', name: '青禾'.repeat(12) };
  const rooms = Array.from({ length: 10 }, (_, index) => ({
    sessionId: index === 9 ? 'ROOM-' + 'x'.repeat(123) : `LAYOUT-ROOM-${index + 1}`,
    name: `${index + 1} 号样本 · ${index === 9 ? '山水相逢'.repeat(18) : '高老庄同行'}`,
    phase: ['Lobby', 'Running', 'Finished', 'Aborted'][index % 4], playerCount: index === 4 ? 5 : 2,
  }));
  async function settled(page) {
    await page.evaluate(() => document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
  }
  async function oneScreen(page, name) {
    await settled(page);
    const geometry = await page.evaluate(() => {
      const visible = element => element.getClientRects().length > 0;
      const rect = element => { const r = element.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
      const d = document.documentElement;
      return {
        viewport: { width: d.clientWidth, height: d.clientHeight }, document: { width: d.scrollWidth, height: d.scrollHeight },
        panels: [...document.querySelectorAll('.lr-entry,.lr-rooms,.lr-room-window')].filter(visible).map(element => ({ name: element.className, width: element.clientWidth, scrollWidth: element.scrollWidth, height: element.clientHeight, scrollHeight: element.scrollHeight })),
        controls: [...document.querySelectorAll('.lobby-page button,.lobby-page input,.lobby-page select')].filter(visible).map(element => ({ name: element.getAttribute('aria-label') || element.id || element.textContent.trim(), ...rect(element) })),
      };
    });
    assert.ok(geometry.document.width <= geometry.viewport.width, `${name} 文档横向溢出`);
    assert.ok(geometry.document.height <= geometry.viewport.height, `${name} 文档纵向溢出：${JSON.stringify(geometry)}`);
    for (const panel of geometry.panels) {
      assert.ok(panel.scrollWidth <= panel.width + 1 && panel.scrollHeight <= panel.height + 1, `${name} 任务区滚动：${JSON.stringify(panel)}`);
    }
    for (const control of geometry.controls) {
      assert.ok(control.top >= 0 && control.left >= 0 && control.right <= geometry.viewport.width + 1 && control.bottom <= geometry.viewport.height + 1, `${name} 控件不在一屏：${JSON.stringify(control)}`);
    }
    checks.push({ name, geometry });
  }
  async function openPage(viewport, signedIn = true) {
    const page = await context.newPage(); await page.setViewportSize(viewport); page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    if (signedIn) await page.addInitScript(value => sessionStorage.setItem('xiyou.guest.v1', JSON.stringify(value)), identity);
    let currentRooms = rooms; const writes = [];
    await page.route('**/api/**', async route => {
      const request = route.request(); const path = new URL(request.url()).pathname;
      if (request.method() === 'GET' && path === '/api/sessions') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(currentRooms) }); return;
      }
      if (request.method() === 'POST') writes.push({ path, body: request.postDataJSON() });
      // 失败重试用于观察完整房号、nonce 和提示，不生成成功成员或世界。
      await route.abort('connectionrefused');
    });
    await page.goto(baseURL);
    await page.getByRole('heading', { name: '高老庄', exact: true }).waitFor();
    await settled(page);
    return { page, writes, setRooms(value) { currentRooms = value; } };
  }

  for (const viewport of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    const fixture = await openPage(viewport); const { page, writes } = fixture;
    try {
      await page.getByRole('button', { name: '创建同行房间', exact: true }).waitFor();
      await oneScreen(page, `${viewport.width}×${viewport.height} 入局操作一屏`);
      if (viewport.width === 390) await page.getByRole('tab', { name: /寻找房间/ }).click();
      await page.getByRole('button', { name: '下一页房间', exact: true }).waitFor();
      const seen = []; let traversedPages = 0;
      while (true) {
        await oneScreen(page, `${viewport.width}×${viewport.height} 房间第 ${++traversedPages} 页一屏`);
        const ids = await page.locator('.lr-room-row').evaluateAll(rows => rows.map(row => row.dataset.roomId));
        assert.ok(ids.length > 0 && ids.length < rooms.length, '多房间应分页呈现'); seen.push(...ids);
        const full = page.locator('[data-room-id="LAYOUT-ROOM-5"]');
        if (await full.count()) assert.ok(await full.getByRole('button', { name: '加入', exact: true }).isDisabled(), '等待房间满员不可加入');
        if (await page.getByRole('button', { name: '下一页房间', exact: true }).isDisabled()) break;
        assert.ok(traversedPages < rooms.length, '分页不能循环或漏掉终点');
        await page.getByRole('button', { name: '下一页房间', exact: true }).click();
      }
      assert.deepEqual(seen, rooms.map(room => room.sessionId), '全部阶段、房间与顺序均应可达且不重复');
      assert.equal(writes.length, 0, '翻页不得发出创建或加入请求');
      const finalRoom = page.locator('.lr-room-row').filter({ has: page.getByRole('button', { name: `查看房间详情：${rooms[9].name}`, exact: true }) });
      const detailsButton = finalRoom.getByRole('button', { name: /^查看房间详情/ });
      await detailsButton.focus(); await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: '房间详情' }); await dialog.waitFor();
      assert.equal(await dialog.getByText(rooms[9].sessionId, { exact: true }).count(), 1);
      assert.equal(await dialog.getByText(rooms[9].name, { exact: true }).count(), 1);
      await page.keyboard.press('Escape');
      assert.equal(await detailsButton.evaluate(element => element === document.activeElement), true, '关闭详情后回到原按钮');
      await finalRoom.getByRole('button', { name: '进入', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: '尚未连接到服务' }).waitFor();
      assert.equal(writes.at(-1).path, `/api/sessions/${rooms[9].sessionId}/join`);
      assert.equal(writes.at(-1).body.capabilities, undefined, '已知旧房间仍走原协议，即使在后续分页');
      const firstNonce = writes.at(-1).body.nonce;
      await finalRoom.getByRole('button', { name: '进入', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: '尚未连接到服务' }).waitFor();
      assert.equal(writes.at(-1).body.nonce, firstNonce, '失败重试保留加入幂等标识');
      await oneScreen(page, `${viewport.width}×${viewport.height} 加入失败提示一屏`);
      fixture.setRooms(rooms.slice(0, 1));
      await page.getByRole('button', { name: '刷新房间列表' }).click();
      await page.getByRole('status').filter({ hasText: '第 1 / 1 页' }).waitFor();
      assert.deepEqual(await page.locator('.lr-room-row').evaluateAll(rows => rows.map(row => row.dataset.roomId)), [rooms[0].sessionId]);
      assert.equal(await page.getByRole('button', { name: '下一页房间' }).isDisabled(), true);
      fixture.setRooms([]); await page.getByRole('button', { name: '刷新房间列表' }).click();
      await page.getByRole('heading', { name: '等一位发起同行的人' }).waitFor();
      await oneScreen(page, `${viewport.width}×${viewport.height} 空列表一屏`);
      await page.screenshot({ path: `${output}/lobby-layout-${viewport.width}.png`, fullPage: true });
      checks.push({ name: `${viewport.width}×${viewport.height} 分页完整、详情可读、原房号与nonce、刷新缩页`, traversedPages, roomIds: seen, writes });
    } finally { await page.close(); }
  }

  const draftFixture = await openPage({ width: 390, height: 844 }, false);
  try {
    const { page } = draftFixture;
    await page.getByLabel('你的称呼', { exact: true }).fill('保留称呼');
    await page.getByRole('tab', { name: /开始同行/ }).focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await page.getByRole('tab', { name: /寻找房间/ }).getAttribute('aria-selected'), 'true');
    await page.getByRole('button', { name: '先留下称呼' }).click();
    assert.equal(await page.getByLabel('你的称呼', { exact: true }).inputValue(), '保留称呼');
    assert.equal(await page.getByLabel('你的称呼', { exact: true }).evaluate(element => element === document.activeElement), true);
    await page.getByRole('button', { name: '以此名同行' }).click();
    await page.getByRole('alert').filter({ hasText: '尚未连接到服务' }).waitFor();
    await page.getByRole('tab', { name: /寻找房间/ }).click();
    await page.getByRole('alert').filter({ hasText: '尚未连接到服务' }).waitFor();
    await page.getByRole('tab', { name: /开始同行/ }).click();
    assert.equal(await page.getByLabel('你的称呼', { exact: true }).inputValue(), '保留称呼');
    await oneScreen(page, '手机未登录称呼和失败提示切换后保留');
  } finally { await draftFixture.page.close(); }

  const joinedFixture = await openPage({ width: 390, height: 844 });
  try {
    const { page } = joinedFixture;
    await page.getByLabel('选择行程').selectOption('region');
    await page.getByLabel('房间号', { exact: true }).fill('  draft-room-原始号  ');
    await page.getByRole('tab', { name: /寻找房间/ }).click();
    await page.getByRole('tab', { name: /寻找房间/ }).focus(); await page.keyboard.press('Home');
    assert.equal(await page.getByRole('tab', { name: /开始同行/ }).getAttribute('aria-selected'), 'true');
    assert.equal(await page.getByLabel('选择行程').inputValue(), 'region');
    assert.equal(await page.getByLabel('房间号', { exact: true }).inputValue(), '  draft-room-原始号  ');
    await page.getByRole('button', { name: '加入', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '尚未连接到服务' }).waitFor();
    assert.equal(decodeURIComponent(joinedFixture.writes.at(-1).path), '/api/sessions/draft-room-原始号/join');
    await page.getByRole('button', { name: '查看请求未完成详情' }).click();
    await page.getByRole('dialog', { name: '请求未完成' }).waitFor();
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '查看请求未完成详情' }).evaluate(element => element === document.activeElement), true);
    checks.push({ name: '手机页签保留称呼、模式、房号和错误，箭头与Home可用，完整错误可阅读并回焦', passed: true });
  } finally { await joinedFixture.page.close(); }
  const largeTextFixture = await openPage({ width: 390, height: 844 });
  try {
    const { page } = largeTextFixture;
    // 仅放大文字，不改变视口；先统一取原字号，避免父子字号重复乘算。
    await page.evaluate(() => {
      const sizes = [...document.querySelectorAll('body *')].filter(element => element instanceof HTMLElement).map(element => [element, parseFloat(getComputedStyle(element).fontSize)]);
      for (const [element, size] of sizes) element.style.setProperty('font-size', `${size * 2}px`, 'important');
    });
    await settled(page);
    await page.getByRole('tab', { name: /寻找房间/ }).click();
    assert.equal(await page.getByRole('tab', { name: /寻找房间/ }).getAttribute('aria-selected'), 'true', '大字章节不能覆盖任务页签');
    await page.getByRole('tab', { name: /开始同行/ }).click();
    await page.getByRole('button', { name: '创建同行房间', exact: true }).focus();
    const focus = await page.getByRole('button', { name: '创建同行房间', exact: true }).evaluate(element => {
      const r = element.getBoundingClientRect(); const panel = element.closest('section'); const p = panel.getBoundingClientRect();
      const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
      return { visible: r.top >= p.top + panel.clientTop && r.bottom <= p.top + panel.clientTop + panel.clientHeight, hit: hit === element || element.contains(hit), documentWidth: document.documentElement.scrollWidth, viewportWidth: document.documentElement.clientWidth };
    });
    assert.ok(focus.visible && focus.hit, '大字滚动后焦点操作应完整可见且能命中');
    assert.ok(focus.documentWidth <= focus.viewportWidth, '大字回退不横向溢出');
    checks.push({ name: '手机200%文字下页签没有被章节覆盖，滚动后焦点操作完整可达', focus });
  } finally { await largeTextFixture.page.close(); }
  assert.deepEqual(errors, [], '大厅验收不得产生页面异常');
  return checks;
}
