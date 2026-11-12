import assert from 'node:assert/strict';
import { loadContent } from '../../content/index.mjs';
import { validateSpatial } from '../../protocol/spatial.mjs';
import { until, sleep } from './network-support.mjs';

export const snapshot = page => page.evaluate(async () => (await import('/src/state/spatial-store.ts')).spatialState.value.snapshot);
export const clientState = page => page.evaluate(async () => {
  const s = (await import('/src/state/spatial-store.ts')).spatialState.value;
  return { connection: s.connection, inputReady: s.inputReady, message: s.message, queuedAction: s.queuedAction, actions: s.actions };
});
const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const samePosition = (a, b) => a?.x === b?.x && a?.y === b?.y;
const operationLabels = {
  'gz-contact': '联系门内的人', 'gz-check-seal': '检查铜封', 'gz-try-key': '试用普通钥匙',
  'gz-read-ledger': '阅读旧饭账', 'gz-hear-witness': '询问见证人', 'gz-release-support': '撤收门撑',
  'gz-check-appearance': '核验同貌人物', 'gz-reveal-identity': '当面说明已知身份', 'gz-plan-departure': '通知离庄安排',
};

export async function closeReading(page) {
  const pane = page.locator('.spatial-reading-pane');
  if (await pane.count()) await pane.getByRole('button', { name: /^关闭/ }).click();
}
export async function openReading(page, label) {
  await closeReading(page);
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.locator('.spatial-reading-pane').waitFor();
}

/** 读取当前授权对象以找到玩家可见的文字入口；不解析真实角色ID或跨观察者引用。 */
export async function selectObject(page, reference) {
  await closeReading(page);
  const p = (await snapshot(page)).projection;
  const target = [...p.targets, ...p.items, ...p.entities].find(entity => entity.entityRef === reference);
  assert.ok(target, '目标必须出现在当前玩家授权投影中');
  const buttons = page.locator('.spatial-object-list').getByRole('button');
  const texts = await buttons.allTextContents();
  const candidates = texts.map((text, index) => ({ text: text.trim(), index })).filter(entry => entry.text === target.name || new RegExp('^\\d+号 · ' + escapeRegex(target.name) + '$').test(entry.text));
  if (candidates.length === 1) {
    await buttons.nth(candidates[0].index).click();
  } else {
    // 同名时通过实际地图位置选中，再读取可见编号；不凭真身帮助玩家挑选。
    assert.ok(target.position && target.sceneId === p.self.sceneId, '同名目标须在当前地图可见');
    const map = page.getByTestId('spatial-map'); await map.scrollIntoViewIfNeeded();
    const pixel = await map.evaluate((svg, position) => { const point = new DOMPoint(position.x, position.y).matrixTransform(svg.getScreenCTM()); return { x: Math.round(point.x), y: Math.round(point.y) }; }, target.position);
    await page.mouse.click(pixel.x, pixel.y);
  }
  const label = (await page.locator('#spatial-selection-heading').innerText()).trim();
  assert.ok(label === target.name || label.endsWith(' · ' + target.name), '选中卡必须显示目标的当前授权称呼');
  return label;
}

async function visibleRecipient(page, reference, selectLabel) {
  // 选择只使用刚从实际地图/对象卡读出的可见标签，避免 selectOption(ref) 绕过可辨认性。
  const p = (await snapshot(page)).projection;
  const target = p.entities.find(entity => entity.entityRef === reference);
  assert.ok(target, '收件人必须来自当前授权投影');
  const texts = await page.getByLabel(selectLabel, { exact: true }).locator('option').allTextContents();
  const matches = texts.filter(text => {
    const visibleName = selectLabel === '本次带路者' && reference === p.self.entityRef ? text.replace(/（你）$/, '') : text;
    return visibleName === target.name || new RegExp('^\\d+号 · ' + escapeRegex(target.name) + '$').test(visibleName);
  });
  assert.equal(matches.length, 1, '普通流程必须能按唯一当前可见标签选择收件人；同貌交接另以实际地图选中卡执行');
  await page.getByLabel(selectLabel, { exact: true }).selectOption({ label: matches[0] });
  return matches[0];
}

export async function waitHumanReceipt(page, previousIds, expected, report, player, label) {
  const draft = await until(async () => (await clientState(page)).actions.find(draft => {
    if (previousIds.includes(draft.id)) return false;
    const action = JSON.parse(draft.raw).action;
    return action.kind === expected.kind && (expected.operationId === undefined || action.operationId === expected.operationId);
  }), label + '已从页面发出');
  const settled = await until(async () => (await clientState(page)).actions.find(action => action.id === draft.id)?.receipt, label + '真实收据');
  const request = JSON.parse(draft.raw);
  validateSpatial('PublicEnvelope', request); validateSpatial('ReceiptV2', settled);
  report.humanActions.push({ player, label, request, receipt: settled });
  for (const field of ['targetRef', 'itemRef', 'recipientRef', 'evidenceRef', 'subjectRef', 'leaderRef', 'destinationId']) {
    if (expected[field] !== undefined) assert.deepEqual(request.action[field], expected[field], label + '使用原授权字段 ' + field);
  }
  if (expected.parameters !== undefined) assert.deepEqual(request.action.parameters, expected.parameters, label + '有限操作参数保持');
  if (expected.recipientRefs !== undefined) assert.deepEqual(request.action.recipientRefs, expected.recipientRefs, label + '收件引用保持');
  return settled;
}

/** 把公共人类意图映射为真正可见的页面操作。这里绝不调用 spatialClient.send/move。 */
export async function humanAction(page, action, report, player) {
  const previousIds = (await clientState(page)).actions.map(draft => draft.id);
  let label = action.kind;
  if (action.kind === 'move_to') {
    await closeReading(page);
    const p = (await snapshot(page)).projection;
    assert.equal(p.self.sceneId, action.sceneId, '跨场景移动须先经过实际出口按钮');
    const anchor = p.scene.anchors.find(anchor => samePosition(anchor.position, action.destination));
    assert.ok(anchor, '当前测试导航只使用真实公开锚点，不改目标补绿');
    label = '前往' + anchor.label;
    await page.locator('.spatial-object-list').getByRole('button', { name: label, exact: true }).click();
  } else if (action.kind === 'take_item') {
    await selectObject(page, action.itemRef); label = '走近并拿取';
    await page.getByRole('button', { name: label, exact: true }).click();
  } else if (action.kind === 'transfer_item') {
    const p = (await snapshot(page)).projection; const item = p.items.find(item => item.entityRef === action.itemRef);
    await openReading(page, '行囊'); await visibleRecipient(page, action.recipientRef, '交接给');
    label = '交给对方'; await page.locator('.spatial-inventory li').filter({ has: page.getByRole('heading', { name: item.name, exact: true }) }).getByRole('button', { name: label, exact: true }).click();
  } else if (action.kind === 'put_item') {
    const item = (await snapshot(page)).projection.items.find(item => item.entityRef === action.itemRef);
    assert.ok(item); await openReading(page, '行囊'); label = '放在脚边';
    await page.locator('.spatial-inventory li').filter({ has: page.getByRole('heading', { name: item.name, exact: true }) }).getByRole('button', { name: label, exact: true }).click();
  } else if (action.kind === 'share_evidence') {
    const observation = (await snapshot(page)).projection.observations.find(observation => observation.observationRef === action.evidenceRef);
    assert.ok(observation?.shareable, '只能选择当前允许分享的观察');
    await openReading(page, '手记'); await visibleRecipient(page, action.recipientRefs[0], '分享给');
    const record = page.locator('.spatial-notebook article').filter({ has: page.locator('.spatial-record-statement').filter({ hasText: observation.statement }) });
    assert.ok(await record.count(), '当前材料通过可见原文选择');
    label = '分享给选定对象'; await record.last().getByRole('button', { name: label, exact: true }).click();
  } else if (action.kind === 'cooperate') {
    await closeReading(page); label = action.phase === 'ready' ? '我已就位' : action.phase === 'prepare' ? '参与准备' : '取消准备';
    await page.getByRole('button', { name: label, exact: true }).click();
  } else if (action.kind === 'propose_follow') {
    await selectObject(page, action.subjectRef);
    await page.getByLabel('随行目的地', { exact: true }).selectOption(action.destinationId);
    await visibleRecipient(page, action.leaderRef, '本次带路者');
    const button = page.getByRole('button', { name: /^(提出|重新提议)随行安排$/ }); label = await button.innerText(); await button.click();
  } else if (action.kind === 'request_end') {
    await openReading(page, '进展'); label = action.scope === 'chapter' ? '提议暂告一段' : '提议结束招徒';
    await page.getByRole('button', { name: label, exact: true }).click();
  } else if (action.kind === 'confirm_end') {
    await openReading(page, '进展'); label = '我确认本轮选择'; await page.getByRole('button', { name: label, exact: true }).click();
  } else if (action.kind === 'speak') {
    await openReading(page, '交谈'); await page.getByLabel('交谈范围', { exact: true }).selectOption(action.channel);
    if (action.channel === 'directed') await visibleRecipient(page, action.recipientRefs[0], '交谈对象');
    await page.getByLabel('交谈内容', { exact: true }).fill(action.text); label = '说话'; await page.getByRole('button', { name: label, exact: true }).click();
  } else if (action.kind === 'interact') {
    await selectObject(page, action.targetRef);
    const area = page.locator('.gaolao-interaction');
    if (action.operationId === 'gz-compare-sources') {
      const observations = (await snapshot(page)).projection.observations;
      for (const reference of action.parameters.evidenceRefs) {
        const observation = observations.find(observation => observation.observationRef === reference);
        assert.ok(observation?.source); const card = page.locator('.gaolao-source-card').filter({ has: page.getByText(observation.source.label, { exact: true }) });
        assert.equal(await card.count(), 1); await card.getByRole('checkbox').check();
      }
      label = '提交来源比较'; await page.getByRole('button', { name: label, exact: true }).click();
    } else if (['gz-request-appearance', 'gz-invite-meeting'].includes(action.operationId)) {
      await area.getByLabel('会面地点', { exact: true }).selectOption(action.parameters.destinationId);
      label = action.operationId === 'gz-request-appearance' ? '请求本次借貌' : '邀请本人会面'; await area.getByRole('button', { name: label, exact: true }).click();
    } else if (action.operationId === 'gz-request-private-items') {
      const items = (await snapshot(page)).projection.items;
      for (const reference of action.parameters.itemRefs) {
        const item = items.find(item => item.entityRef === reference);
        assert.ok(item && !item.publicBorrowable, '私物请求只从当前授权可见物件选择');
        const checkbox = area.getByRole('checkbox', { name: item.name, exact: true });
        assert.equal(await checkbox.count(), 1, '私物在当前表单内必须可按可见名称唯一选择');
        await checkbox.check();
      }
      label = '请求整理选定私物'; await area.getByRole('button', { name: label, exact: true }).click();
    } else if (action.operationId === 'gz-return-public') {
      const item = (await snapshot(page)).projection.items.find(item => item.entityRef === action.parameters.itemRef);
      assert.ok(item); await area.getByLabel('本次归还物件', { exact: true }).selectOption({ label: item.name });
      label = '归还选定公用物'; await area.getByRole('button', { name: label, exact: true }).click();
    } else {
      label = operationLabels[action.operationId]; assert.ok(label, '人类操作必须有明确可见入口，不能代执行NPC本人意图');
      await area.getByRole('button', { name: label, exact: true }).click();
    }
  } else if (action.kind === 'inspect') {
    await selectObject(page, action.targetRef); label = '在当前位置查看'; await page.getByRole('button', { name: label, exact: true }).click();
  } else throw new Error('未映射为真实UI的人类动作：' + action.kind);
  return waitHumanReceipt(page, previousIds, action, report, player, label);
}

export async function browserRoom({ server, browser, baseURL, count, contentVersion = 'gaolaozhuang-v1', report }) {
  const content = await loadContent(contentVersion), pages = [], contexts = [], users = [], actors = new Map();
  let sessionId;
  for (let index = 0; index < count; index++) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 }); contexts.push(context);
    const page = await context.newPage(); pages.push(page); page.setDefaultTimeout(5000);
    page.on('pageerror', error => report.pageErrors.push({ count, player: index, message: error.message }));
    page.on('response', async response => {
      if (!response.url().includes('/recap?')) return;
      try {
        const text = await response.text(); const result = JSON.parse(text);
        if (response.ok()) validateSpatial('RecapV2', result);
        report.recapResponses.push({ player: index, sessionId, status: response.status(), query: new URL(response.url()).search, bytes: Buffer.byteLength(text), value: result });
      } catch (error) { report.pageErrors.push({ count, player: index, message: '复盘响应无法验证：' + error.message }); }
    });
    await page.goto(baseURL); await page.getByLabel('你的称呼', { exact: true }).fill(`章节${count}人旅伴${index + 1}`); await page.getByRole('button', { name: '以此名同行' }).click();
    if (index === 0) {
      // 内容变体须由 VITE_GAOLAO_CONTENT_VERSION 选择，页面只有真实的高老庄入口。
      await page.getByLabel('选择行程', { exact: true }).selectOption('gaolao');
      await page.getByRole('button', { name: '创建同行房间', exact: true }).click(); await page.waitForURL(/\/spatial\/[^/]+$/); sessionId = new URL(page.url()).pathname.split('/').at(-1);
    } else {
      await page.getByLabel('房间号', { exact: true }).fill(sessionId); await page.locator('.join-form').getByRole('button', { name: '加入', exact: true }).click(); await page.waitForURL(/\/spatial\/[^/]+$/);
    }
    await until(async () => (await snapshot(page))?.projection.phase === 'Lobby', '浏览器得到真实章节大厅');
    users.push(await page.evaluate(() => JSON.parse(sessionStorage.getItem('xiyou.guest.v1'))));
    actors.set(index, { page, token: users[index].token });
  }
  assert.equal(new Set(users.map(user => user.userId)).size, count, '每个浏览器使用独立账号');
  await pages[0].getByRole('heading', { name: `${count} 位旅伴已相聚` }).waitFor();
  await pages[0].getByRole('button', { name: '开始同行（房主）', exact: true }).click();
  for (const page of pages) {
    await page.getByRole('button', { name: '恢复本人控制', exact: true }).click();
    await until(async () => (await clientState(page)).inputReady, '页面取得当前角色控制');
  }
  for (const page of pages) await until(async () => !(await snapshot(page)).projection.paused, '所有玩家恢复后场景实际运行');
  for (const [key, actorId] of Object.entries(content.chapterRules.people)) {
    const configured = content.npcs.find(npc => npc.characterId === actorId);
    actors.set(key, { handle: await server.runtime.bindInternal(sessionId, actorId, configured.actorKind === 'scene_role' ? 'scene_role' : 'core_npc'), internal: true });
  }
  const read = async key => {
    const actor = actors.get(key); const value = actor.internal ? await server.runtime.observeInternal(actor.handle) : await snapshot(actor.page);
    validateSpatial('SnapshotV2', value); return value;
  };
  const send = async (key, action) => {
    const actor = actors.get(key);
    if (!actor.internal) return humanAction(actor.page, action, report, key);
    const intentId = crypto.randomUUID(); const reserved = await server.runtime.reserveSpatialIntent(actor.handle, intentId, action);
    const receipt = await server.runtime.submitSpatialIntent(actor.handle, intentId);
    report.npcActions.push({ role: key, intentId, action: reserved.action, receipt });
    return receipt;
  };
  const move = async (key, sceneId, position) => {
    const actor = actors.get(key); const before = (await read(key)).projection.movement?.movementCommandSeq;
    const receipt = await send(key, { kind: 'move_to', sceneId, destination: position });
    assert.equal(receipt.status, 'Accepted', '本次路线受理：' + receipt.code);
    return until(async () => {
      const p = (await read(key)).projection;
      if (p.movement?.movementCommandSeq === before) return false;
      if (['blocked', 'cancelled'].includes(p.movement?.status)) throw new Error(`实际导航中止 ${key}: ${p.movement.reason}`);
      return p.movement?.status === 'arrived' && p.self.sceneId === sceneId && samePosition(p.self.position, position) ? p : false;
    }, '真实路线到达原精确目标');
  };
  const go = async (key, where) => {
    let s = await read(key);
    if (s.projection.self.sceneId !== where.sceneId) {
      const scene = content.scenes.find(scene => scene.sceneId === s.projection.self.sceneId), exit = scene.exits.find(exit => exit.destinationSceneId === where.sceneId);
      assert.ok(exit, '跨场景须存在公开出口');
      if (actors.get(key).internal) await move(key, scene.sceneId, scene.anchors.find(anchor => anchor.anchorId === exit.anchorId).position);
      else {
        const page = pages[key]; await closeReading(page);
        const beforeIds = (await clientState(page)).actions.map(action => action.id);
        const visibleScene = (await snapshot(page)).projection.scene;
        const exitIndex = visibleScene.exits.findIndex(visibleExit => visibleExit.exitId === exit.exitId);
        assert.ok(exitIndex >= 0, '实际出口必须出现在当前授权场景');
        const exitLabel = visibleScene.anchors.find(anchor => anchor.anchorId === exit.anchorId)?.label || '出口 ' + (exitIndex + 1);
        await page.getByRole('button', { name: '走向出口 · ' + exitLabel, exact: true }).click();
        await waitHumanReceipt(page, beforeIds, { kind: 'move_to' }, report, key, '实际走向场景出口');
        await until(async () => (await read(key)).projection.self.sceneId === where.sceneId, '浏览器实际跨过出口');
        s = await read(key);
      }
    }
    return move(key, where.sceneId, where.position);
  };
  const entity = async (key, name) => {
    const p = (await read(key)).projection;
    const matches = [...p.entities, ...p.targets, ...p.items].filter(entity => entity.name === name);
    assert.equal(matches.length, 1, `流程目标须由当前授权称呼唯一确定：${key} ${name}`); return matches[0];
  };
  const interact = async (key, name, operationId, parameters) => {
    const e = name === 'self' ? (await read(key)).projection.self : await entity(key, name);
    return send(key, { kind: 'interact', targetRef: e.entityRef, operationId, expectedTargetRevision: e.resourceRevision, ...(parameters ? { parameters } : {}) });
  };
  const at = (sceneId, anchorId) => ({ sceneId, position: content.scenes.find(scene => scene.sceneId === sceneId).anchors.find(anchor => anchor.anchorId === anchorId).position });
  return { count, pages, contexts, users, content, sessionId, actors, runtime: server.runtime, snapshot: read, send, move, go, entity, interact, role: roleId => content.chapterRules.partyRoles[String(count)].findIndex(group => group.includes(roleId)), at, C: id => at('gaolao-courtyard', id), R: id => at('gaolao-village-road', id), step: async (ms = 1000) => sleep(ms), close: async () => { for (const context of contexts) await context.close(); } };
}
