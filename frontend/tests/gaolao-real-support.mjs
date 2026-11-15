import assert from 'node:assert/strict';
import { loadContent } from '../../content/index.mjs';
import { validateSpatial } from '../../protocol/spatial.mjs';
import { until, sleep } from './network-support.mjs';
import { canvasFrame, worldPixel } from './canvas-browser-support.mjs';
import { beginSelectionClick, endSelectionClick } from './cuilan-click-observation.mjs';

export const snapshot = page => page.evaluate(async () => (await import('/src/state/spatial-store.ts')).spatialState.value.snapshot);
export const clientState = page => page.evaluate(async () => {
  const s = (await import('/src/state/spatial-store.ts')).spatialState.value;
  return { connection: s.connection, inputReady: s.inputReady, message: s.message, queuedAction: s.queuedAction, navigation: s.navigation, actions: s.actions };
});
const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const samePosition = (a, b) => a?.x === b?.x && a?.y === b?.y;
const operationLabels = {
  'gz-contact': '联系门内的人', 'gz-check-seal': '检查铜封', 'gz-try-key': '试用普通钥匙',
  'gz-read-ledger': '阅读旧饭账', 'gz-hear-witness': '询问见证人', 'gz-release-support': '撤收门撑',
  'gz-check-appearance': '核验同貌人物', 'gz-reveal-identity': '当面说明已知身份', 'gz-plan-departure': '通知离庄安排',
};
const productionNpcKeys = Object.freeze(['tang', 'wukong', 'bajie']);

export async function closeReading(page) {
  const pane = page.locator('.spatial-reading-pane');
  if (await pane.count()) {
    const condensed = page.locator('.spatial-sidebar.hud-card-collapsed').getByRole('button', { name: '关闭暂收浮卡', exact: true });
    if (await condensed.isVisible()) await condensed.click();
    else await pane.getByRole('button', { name: /^关闭/ }).click();
  }
}
export async function openReading(page, label) {
  await closeReading(page);
  const visibleLabel = label==='进展' && await page.getByRole('button',{name:'队伍',exact:true}).count() ? '队伍' : label;
  await page.getByRole('button', { name: visibleLabel, exact: true }).click();
  const restore = page.locator('.spatial-sidebar.hud-card-collapsed').getByRole('button', { name: '取消选择并展开', exact: true });
  const restored = await restore.isVisible();
  if (restored) await restore.click();
  await page.locator('.spatial-reading-pane').waitFor();
  return restored;
}

/** 固定HUD按需打开对象列表；不通过隐藏实体DOM选择。 */
export async function openObjects(page) {
  const entry = page.getByRole('button', { name: '场景对象', exact: true });
  if (await entry.count()) await entry.click();
  const restore = page.locator('.spatial-sidebar.hud-card-collapsed').getByRole('button', { name: '取消选择并展开', exact: true });
  if (await restore.isVisible()) await restore.click();
}

/** 读取当前授权对象以找到玩家可见的文字入口；不解析真实角色ID或跨观察者引用。 */
export async function selectObject(page, reference) {
  await closeReading(page);
  await openObjects(page);
  const p = await page.evaluate(async()=>{const s=(await import('/src/state/spatial-store.ts')).spatialState.value.snapshot;return (await import('/src/domain/spatial-display.ts')).sceneDisplayProjection(s.projection);});
  const target = [...p.targets, ...p.items, ...p.entities].find(entity => entity.entityRef === reference);
  assert.ok(target, '目标必须出现在当前玩家授权投影中');
  const buttons = page.locator('.spatial-object-list').getByRole('button');
  const texts = await buttons.allTextContents();
  const candidates = texts.map((text, index) => ({ text: text.trim(), index })).filter(entry => entry.text === target.name || new RegExp('^\\d+号 · ' + escapeRegex(target.name) + '$').test(entry.text));
  if (candidates.length === 1) {
    const observed = beginSelectionClick(page, { reference, branch: 'object-button' });
    try { await buttons.nth(candidates[0].index).click(); endSelectionClick(observed, 'returned'); }
    catch (error) { endSelectionClick(observed, 'threw', error); throw error; }
  } else {
    // 同名/同脚点时点实际绘出的编号标签；不凭真身、插入顺序或隐藏DOM挑选。
    assert.ok(target.position && target.sceneId === p.self.sceneId, '同名目标须在当前地图可见');
    const map = page.getByTestId('spatial-map'); await map.scrollIntoViewIfNeeded();
    const label=(await canvasFrame(page)).labels.find(value=>value.key===reference&&value.selectable);
    if(label) {
      const observed = beginSelectionClick(page, { reference, branch: 'map-label' });
      try { await map.click({position:{x:label.x+label.width/2,y:label.y+label.height/2}}); endSelectionClick(observed, 'returned'); }
      catch (error) { endSelectionClick(observed, 'threw', error); throw error; }
    } else {
      const {pixel}=await worldPixel(page,target.position);
      const observed = beginSelectionClick(page, { reference, branch: 'map-position' });
      try { await page.mouse.click(pixel.x,pixel.y); endSelectionClick(observed, 'returned'); }
      catch (error) { endSelectionClick(observed, 'threw', error); throw error; }
    }
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
    if (expected.clientActionId !== undefined && draft.id !== expected.clientActionId) return false;
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
  // 内容解码器的 Position 可为 null-prototype；仍逐值严格比较同一 {x,y}，不把原型当坐标语义。
  if (expected.destination !== undefined) assert.deepEqual(request.action.destination, { x: expected.destination.x, y: expected.destination.y }, label + '实际屏幕点选目标保持');
  if (expected.recipientRefs !== undefined) assert.deepEqual(request.action.recipientRefs, expected.recipientRefs, label + '收件引用保持');
  return settled;
}

/** 要操作的对象卡暂收时，经可见接近入口恢复；纯选择与原地查看不调用此步骤。 */
async function revealObjectAction(page, reference, control, report, player) {
  const approach = page.locator('.spatial-sidebar.hud-card-collapsed').getByRole('button', { name: '走近并查看', exact: true });
  await until(async () => await control.isVisible() || await approach.isVisible(), '对象操作或短卡接近入口可见', 5000);
  if (await approach.isVisible()) {
    const beforeInspect = (await clientState(page)).actions.map(draft => draft.id);
    await approach.click();
    const receipt = await waitHumanReceipt(page, beforeInspect, { kind: 'inspect', targetRef: reference }, report, player, '短卡走近并查看');
    assert.equal(receipt.status, 'Accepted', '正常走近后必须确认同一对象可查看');
    await control.waitFor();
  }
}

/** 把公共人类意图映射为真正可见的页面操作。这里绝不调用 spatialClient.send/move。 */
export async function humanAction(page, action, report, player) {
  const previousIds = (await clientState(page)).actions.map(draft => draft.id);
  let label = action.kind, expectedAction=action;
  if (action.kind === 'move_to') {
    await closeReading(page);
    await openObjects(page);
    const p = (await snapshot(page)).projection;
    assert.equal(p.self.sceneId, action.sceneId, '跨场景移动须先经过实际出口按钮');
    const anchor=(p.mapCatalog?.find(scene=>scene.sceneId===p.scene.sceneId)?.anchors||[]).find(anchor=>samePosition(anchor.position,action.destination));
    const anchorButton=anchor?page.locator('.spatial-object-list').getByRole('button',{name:'前往'+anchor.label,exact:true}):null;
    if(anchorButton&&await anchorButton.count()){label='前往'+anchor.label;await anchorButton.click();}
    else {
      // 内部剧情/样例锚点不再是公开按钮；真实用户仍能在当前地图点同一位置。
      // 记录屏幕离散误差，实际到达继续严格核对该次发送目标，不换一个更方便的位置。
      const close=page.getByRole('button',{name:'关闭对象区',exact:true});if(await close.isVisible())await close.click();
      const map=page.locator('.gaolao-map-navigator'),expand=map.getByRole('button',{name:'展开地图',exact:true});if(await expand.isVisible())await expand.click();
      await map.getByRole('button',{name:'当前',exact:true}).click();const canvas=page.getByTestId('gaolao-minimap');await canvas.waitFor();
      const location=await canvas.evaluate((canvas,{scene,position})=>{const b=canvas.getBoundingClientRect(),scale=Math.min((b.width-16)/scene.width,(b.height-16)/scene.height),x=(b.width-scene.width*scale)/2,y=(b.height-scene.height*scale)/2;const pixel={x:Math.round(b.left+x+position.x*scale),y:Math.round(b.top+y+position.y*scale)};return {pixel,scale,mappedWorld:{x:Math.round((pixel.x-b.left-x)/scale),y:Math.round((pixel.y-b.top-y)/scale)}};},{scene:p.scene,position:action.destination});
      const tolerance=.5/location.scale+.5;assert.ok(Math.abs(location.mappedWorld.x-action.destination.x)<=tolerance&&Math.abs(location.mappedWorld.y-action.destination.y)<=tolerance);
      (report.pointerChecks??=[]).push({player,requested:action.destination,...location,tolerance});expectedAction={...action,destination:location.mappedWorld};label='当前地图点击原位置';await page.mouse.click(location.pixel.x,location.pixel.y);
    }
  } else if (action.kind === 'take_item') {
    await selectObject(page, action.itemRef); label = '走近并拿取';
    const take = page.getByRole('button', { name: label, exact: true });
    await revealObjectAction(page, action.itemRef, take, report, player);
    await take.click();
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
    await closeReading(page); await openObjects(page); label = action.phase === 'ready' ? '我已就位' : action.phase === 'prepare' ? '参与准备' : '取消准备';
    await page.getByRole('button', { name: label, exact: true }).click();
  } else if (action.kind === 'propose_follow') {
    await selectObject(page, action.subjectRef);
    await revealObjectAction(page, action.subjectRef, page.getByLabel('随行目的地', { exact: true }), report, player);
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
    await revealObjectAction(page, action.targetRef, area, report, player);
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
  return waitHumanReceipt(page, previousIds, expectedAction, report, player, label);
}

export async function browserRoom({ server, browser, baseURL, count, contentVersion, profile = 'legacy-controlled-v1', report, beforeSession = async () => {}, observe = (target, event, listener) => target.on(event, listener) }) {
  assert.ok(['legacy-controlled-v1', 'production-cuilan-v1'].includes(profile), '未知高老庄浏览器 profile，不得静默降级为受控本人');
  const production = profile === 'production-cuilan-v1';
  assert.ok(!production || typeof contentVersion === 'string', '生产 profile 必须显式固定内容版本，不得沿用旧回归默认值');
  if (contentVersion === undefined) contentVersion = 'gaolaozhuang-v1';
  const content = await loadContent(contentVersion), pages = [], contexts = [], users = [], actors = new Map();
  let sessionId;
  for (let index = 0; index < count; index++) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 }); contexts.push(context);
    const page = await context.newPage(); pages.push(page); page.setDefaultTimeout(5000);
    observe(page, 'pageerror', error => report.pageErrors.push({ count, player: index, message: error.message }));
    observe(page, 'response', async response => {
      if (!response.url().includes('/recap?')) return;
      try {
        const text = await response.text(); const result = JSON.parse(text);
        if (response.ok()) validateSpatial('RecapV2', result);
        report.recapResponses.push({ player: index, sessionId, status: response.status(), query: new URL(response.url()).search, bytes: Buffer.byteLength(text), value: result });
      } catch (error) { report.pageErrors.push({ count, player: index, message: '复盘响应无法验证：' + error.message }); }
    });
    await page.goto(baseURL); await page.getByLabel('你的称呼', { exact: true }).fill(`章节${count}人旅伴${index + 1}`); await page.getByRole('button', { name: '以此名同行' }).click();
    // 测试观察器在真实页面已登录、尚未挂载 SpatialMap 时安装；原调用缺省无副作用。
    await beforeSession(page, index);
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
  const npcKeys = production ? productionNpcKeys : Object.keys(content.chapterRules.people);
  // 身份来自初始化时已核的内容；重启后不能从返回的可写 content 对象重新解释角色。
  const npcBindings = Object.freeze(npcKeys.map(key => {
    const actorId = content.chapterRules.people[key], configured = content.npcs.find(npc => npc.characterId === actorId);
    if (production) assert.equal(configured?.actorKind, key === 'bajie' ? 'chapter_autonomous' : 'persistent_core', '生产 profile 只能绑定登记的三自主 NPC');
    return Object.freeze({ key, actorId, kind: configured.actorKind === 'scene_role' ? 'scene_role' : 'core_npc' });
  }));
  const bindControlledNpcs = async () => {
    for (const { key, actorId, kind } of npcBindings) {
      actors.set(key, { handle: await server.runtime.bindInternal(sessionId, actorId, kind), internal: true });
    }
  };
  await bindControlledNpcs();
  (report.harnessProfiles ??= []).push({ sessionId, count, profile, expectedContentVersion: contentVersion, controlledNpcRoles: [...npcKeys] });
  // 所有被 move/go/interact 捕获的路径都从这里取 actor；外层覆盖 room.send 无法改变该边界。
  const actorFor = key => {
    if (production && !(Number.isInteger(key) && key >= 0 && key < count) && !productionNpcKeys.includes(key)) {
      throw new Error('生产 profile 不允许操作该角色：' + String(key));
    }
    const actor = actors.get(key);
    assert.ok(actor, '当前 profile 未登记该角色：' + String(key));
    return actor;
  };
  const read = async key => {
    const actor = actorFor(key); const value = actor.internal ? await server.runtime.observeInternal(actor.handle) : await snapshot(actor.page);
    validateSpatial('SnapshotV2', value); return value;
  };
  const send = async (key, action) => {
    const actor = actorFor(key);
    if (!actor.internal) return humanAction(actor.page, action, report, key);
    const intentId = crypto.randomUUID(); const reserved = await server.runtime.reserveSpatialIntent(actor.handle, intentId, action);
    const receipt = await server.runtime.submitSpatialIntent(actor.handle, intentId);
    report.npcActions.push({ profile, role: key, intentId, action: reserved.action, receipt });
    return receipt;
  };
  const move = async (key, sceneId, position) => {
    const receipt = await send(key, { kind: 'move_to', sceneId, destination: position });
    assert.equal(receipt.status, 'Accepted', '本次路线受理：' + receipt.code);
    const expectedPosition=actorFor(key).internal?position:report.humanActions.findLast(value=>value.receipt.clientActionId===receipt.clientActionId).request.action.destination;
    return until(async () => {
      const current = await read(key), p = current.projection;
      // 控制恢复后 commandSeq 可从 1 重新开始；本次 Receipt 的路线身份不跨 epoch 混用。
      if (BigInt(current.snapshotSeq) < BigInt(receipt.observedSeq)
        || p.movement?.movementId !== receipt.result.movementId
        || p.movement?.planVersion !== receipt.result.planVersion) return false;
      if (['blocked', 'cancelled'].includes(p.movement?.status)) throw new Error(`实际导航中止 ${key}: ${p.movement.reason}`);
      return p.movement?.status === 'arrived' && p.self.sceneId === sceneId && samePosition(p.self.position, expectedPosition) ? p : false;
    }, '真实路线精确到达本次UI发送目标');
  };
  const go = async (key, where) => {
    let s = await read(key);
    if (s.projection.self.sceneId !== where.sceneId) {
      const scene = content.scenes.find(scene => scene.sceneId === s.projection.self.sceneId), exit = scene.exits.find(exit => exit.destinationSceneId === where.sceneId);
      assert.ok(exit, '跨场景须存在公开出口');
      if (actorFor(key).internal) await move(key, scene.sceneId, scene.anchors.find(anchor => anchor.anchorId === exit.anchorId).position);
      else {
        const page = pages[key]; await closeReading(page); await openObjects(page);
        const beforeIds = (await clientState(page)).actions.map(action => action.id);
        const visibleScene = (await snapshot(page)).projection.scene;
        const exitIndex = visibleScene.exits.findIndex(visibleExit => visibleExit.exitId === exit.exitId);
        assert.ok(exitIndex >= 0, '实际出口必须出现在当前授权场景');
        const visibleCatalog=(await snapshot(page)).projection.mapCatalog?.find(scene=>scene.sceneId===visibleScene.sceneId);
        const exitLabel = visibleCatalog?.anchors.find(anchor => anchor.anchorId === exit.anchorId)?.label || '场景出口 ' + (exitIndex + 1);
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
  return {
    count, pages, contexts, users, content, sessionId, profile,
    // 旧回归保留原接口；生产 profile 不交出可篡改 actor 表或可任意 bind/reserve 的 runtime。
    ...(!production ? { actors, runtime: server.runtime } : {}),
    ...(production ? { rebindControlledNpcs: bindControlledNpcs } : {}),
    snapshot: read, send, move, go, entity, interact,
    role: roleId => content.chapterRules.partyRoles[String(count)].findIndex(group => group.includes(roleId)),
    at, C: id => at('gaolao-courtyard', id), R: id => at('gaolao-village-road', id),
    step: async (ms = 1000) => sleep(ms),
    close: async () => { for (const context of contexts) await context.close(); },
  };
}
