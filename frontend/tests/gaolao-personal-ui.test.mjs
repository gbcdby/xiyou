import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSpatial, gaolaoPersonalProfiles } from '../../protocol/spatial.mjs';
import { readFile } from 'node:fs/promises';
import * as actions from '../src/domain/gaolao-actions.ts';
import { objectArtContext, selectObjectArt } from '../src/domain/gaolao-object-art.ts';
import { selectSceneLayerGroup, selectSceneDoor } from '../src/domain/gaolao-scene-layers.ts';
import { SPATIAL_CAPABILITIES } from '../src/network/spatial-capabilities.ts';
import { SpatialSessionClient } from '../src/network/spatial-session.ts';
import { spatialBatch } from './spatial-fixture.mjs';

const ref = letter => letter.repeat(40);
const actor = (letter, name) => ({ entityRef: ref(letter), name, appearanceEpoch: '0', sceneId: 'gaolao-courtyard', position: { x: 100, y: 100 }, facing: 'S', resourceRevision: '17', availableOperations: [] });
const offer = () => ({ offerRef: ref('O'), subjectRef: ref('C'), sourceRef: ref('S'), sourceRevision: '1', options: [{ optionRef: ref('P'), label: '包裹', handling: 'retrieve_to_owner' }, { optionRef: ref('L'), label: '信件', handling: 'retrieve_to_owner' }] });
function projection() {
  const self = actor('H', '旅伴');
  const person = { ...actor('C', '眼前的人'), availableOperations: ['gz-request-appearance', 'gz-request-private-items', 'gz-describe-private-items'] };
  return validateSpatial('ProjectionV2', {
    protocolCapability: 'spatial-v2', contentVersion: 'gaolaozhuang-scene-v3', reducerVersion: 'gaolao-world-v2', chapterVersion: 'gaolaozhuang-chapter-v3', mapVersion: 'gaolao-layout-v1.1', variantId: 'west-tools',
    phase: 'Running', sceneTimeMs: 0, paused: false, self: { ...self, controlEpoch: '2', canControl: true, capabilities: [], movementCommandHighWater: '0' }, entities: [self, person],
    items: [], targets: [], scene: null, movement: null, observations: [], claims: [], cooperations: [], objectives: [], ending: null,
    chapter: { chapterId: 'gaolaozhuang', responsibilities: ['A'], progress: [], consents: [], follows: [], decisions: [], destinations: ['rear-meeting', 'front-meeting', 'road-meeting'].map(destinationId => ({ destinationId, label: destinationId, purpose: 'meeting', sceneId: 'gaolao-courtyard', position: { x: 300, y: 200 } })), endProposal: null, publicItems: [], personalRequests: [], privateItemOffers: [offer()], privateReturns: [] },
  });
}

test('新借貌询问用公开人物 CAS，期限两种均可提交且不补私有版本零或本人同意', () => {
  const p = projection(), person = p.entities[1], before = structuredClone(p);
  assert.equal(typeof actions.requestPersonalAppearance, 'function', '需要正常页面消费的新询问构造器');
  for (const destination of p.chapter.destinations) for (const permissionTerm of ['single_use', 'reusable']) {
    const result = actions.requestPersonalAppearance(person, destination.destinationId, permissionTerm, p, true);
    assert.deepEqual(result, { kind: 'interact', targetRef: ref('C'), operationId: 'gz-request-appearance', expectedTargetRevision: '17', parameters: { destinationId: destination.destinationId, permissionTerm } });
    assert.doesNotThrow(() => validateSpatial('ActionV2', result));
  }
  assert.deepEqual(p, before, '表单不编辑权威请求或预写本人回应');
  for (const wrong of [{ ...p, paused: true }, { ...p, phase: 'Finished' }, { ...p, variantId: 'east-tools' }, { ...p, reducerVersion: 'gaolao-world-v1' }]) assert.equal(actions.requestPersonalAppearance(person, 'front-meeting', 'single_use', wrong, true), null);
  assert.equal(actions.requestPersonalAppearance(person, 'unknown', 'single_use', p, true), null);
  assert.equal(actions.requestPersonalAppearance(person, 'front-meeting', 'single_use', p, false), null);
  assert.equal(actions.isGaolaoProjection({ ...p, reducerVersion: 'gaolao-world-v1' }), false, '新版本不能借旧解释器进入HUD');
});

test('正常私物询问只选本人目录名目，无须物件同屏；旧八戒请求不套新协议', () => {
  const p = projection(), person = p.entities[1], before = structuredClone(p);
  assert.equal(typeof actions.describePersonalItems, 'function');
  assert.deepEqual(actions.describePersonalItems(person, p, true), { kind: 'interact', targetRef: ref('C'), operationId: 'gz-describe-private-items', expectedTargetRevision: '17' });
  for (const permissionTerm of ['single_use', 'reusable']) for (const selected of [[ref('P')], [ref('L')], [ref('P'), ref('L')]]) {
    const result = actions.requestPersonalItems(person, ref('O'), selected, permissionTerm, p, true);
    assert.deepEqual(result.parameters, { offerRef: ref('O'), itemOptionRefs: selected, permissionTerm });
    assert.equal(result.expectedTargetRevision, '17');
    assert.doesNotThrow(() => validateSpatial('ActionV2', result));
  }
  for (const selected of [[], [ref('P'), ref('P')], [ref('x')]]) assert.equal(actions.requestPersonalItems(person, ref('O'), selected, 'single_use', p, true), null);
  assert.equal(actions.requestPersonalItems(person, ref('z'), [ref('P')], 'single_use', p, true), null);
  assert.equal(actions.requestPersonalItems({ ...person, entityRef: ref('B'), availableOperations: ['gz-request-private-items'] }, ref('O'), [ref('P')], 'single_use', p, true), null);
  assert.deepEqual(p, before);
});

function withRequest(p, purpose = 'appearance') {
  const consent = { consentId: ref('Q'), subjectRef: ref('C'), requesterRef: ref('H'), purpose, scope: {}, version: '5', status: 'accepted', sourceSeq: '19' };
  const request = { consentId: consent.consentId, purpose, lifecycleVersion: '7', lifecycle: 'open', executionState: 'ready', reasonCode: null, reason: '', permissionTerm: 'single_use', scope: purpose === 'appearance' ? { destinationId: 'front-meeting', performerLabel: '悟空', usage: 'inquiry_meeting' } : { handling: 'retrieve_to_owner', ownerLabel: '本人', items: [{ label: '包裹', origin: null }] } };
  p.chapter.consents = [consent]; p.chapter.personalRequests = [request];
  return { consent, request };
}

test('取消和改约须明确使用自己的当前请求两版本，不把系统状态改成本人撤回', () => {
  const p = projection(), { consent, request } = withRequest(p), before = structuredClone(p);
  assert.equal(typeof actions.cancelPersonalRequest, 'function');
  const replacement = { consentId: ref('Q'), expectedConsentVersion: '5', expectedLifecycleVersion: '7' };
  assert.deepEqual(actions.cancelPersonalRequest(p, ref('Q'), true), { kind: 'cancel_personal_request', ...replacement });
  assert.equal(actions.requestPersonalAppearance(p.entities[1], 'road-meeting', 'reusable', p, true), null, '开放的自己的安排须明确选择改约');
  assert.deepEqual(actions.requestPersonalAppearance(p.entities[1], 'road-meeting', 'reusable', p, true, ref('Q')).parameters, { destinationId: 'road-meeting', permissionTerm: 'reusable', replacement });
  assert.equal(actions.requestPersonalAppearance(p.entities[1], 'road-meeting', 'single_use', p, true, ref('x')), null);
  assert.deepEqual(p, before);
  consent.requesterRef = ref('X');
  assert.equal(actions.cancelPersonalRequest(p, ref('Q'), true), null);
  assert.equal(actions.requestPersonalAppearance(p.entities[1], 'road-meeting', 'single_use', p, true, ref('Q')), null);
  consent.requesterRef = ref('H'); consent.purpose = 'follow'; assert.equal(actions.cancelPersonalRequest(p, ref('Q'), true), null); consent.purpose = 'appearance';
  consent.requesterRef = ref('H'); request.lifecycle = 'cancelled'; request.executionState = 'ended'; request.reasonCode = 'requester_cancelled';
  const feedback = actions.personalRequestFeedback(request, consent);
  assert.equal(feedback.decision, '本人已同意'); assert.match(feedback.lifecycle, /请求者.*取消/); assert.doesNotMatch(feedback.lifecycle, /本人已撤回/);
  assert.equal(actions.cancelPersonalRequest(p, ref('Q'), true), null);
  assert.equal(actions.requestPersonalAppearance(p.entities[1], 'road-meeting', 'single_use', p, true).parameters.permissionTerm, 'single_use');
  consent.status = 'withdrawn'; assert.equal(actions.personalRequestFeedback(request, consent).decision, '本人已撤回');
});

function addReturns(p) {
  const origin = { sceneId: 'gaolao-courtyard', position: { x: 1180, y: 330 }, label: '本人说明的原放物处' };
  p.items = ['p', 'l'].map(letter => ({ entityRef: ref(letter), name: letter === 'p' ? '包裹' : '信件', location: { kind: 'held', ownerRef: p.self.entityRef }, resourceRevision: '12', transferable: true, publicBorrowable: false, fields: [] }));
  p.chapter.privateReturns = ['p', 'l'].map(letter => ({ returnContextId: ref(letter.toUpperCase()), originalConsentId: ref('Z'), acceptedConsentVersion: '4', sourceLifecycleVersion: '3', itemRef: ref(letter), itemRevision: '12', mode: 'return_only', ownerLabel: '真实物主', ownerRef: ref('C'), origin }));
  return p;
}

test('归还两入口只在真实 v3 近距构造普通动作，远距/缺位置须先正常行走与同步', async () => {
  // 公开空间距离按精确内容身份绑定；不能为 UI 另造更宽的服务器可提交范围。
  for (const profile of gaolaoPersonalProfiles) {
    const content = JSON.parse(await readFile(new URL(`../../content/fixtures/${profile.contentVersion}.json`, import.meta.url), 'utf8'));
    assert.equal(content.movement.interactionRadius, 90, 'UI 距离前置须与已登记内容的真实半径一致');
    const p = addReturns(projection());
    for (const key of ['contentVersion', 'chapterVersion', 'reducerVersion', 'mapVersion', 'variantId']) p[key] = profile[key];
    p.entities[1].position = { x: 300, y: 100 };
    const before = structuredClone(p);
    assert.equal(actions.privateReturnAction(p, ref('P'), 'owner', true), null, '可见且同场景的远处物主不能直接提交');
    assert.equal(actions.privateReturnAction(p, ref('L'), 'origin', true), null, '原处已知不代表已经走到原处');
    assert.equal(actions.privateReturnEntries(p).length, 2, '远距只限制提交，不能删除归还入口');
    assert.deepEqual(p, before);

    p.entities[1].position = { x: 190, y: 100 };
    assert.deepEqual(actions.privateReturnAction(p, ref('P'), 'owner', true), { kind: 'transfer_item', itemRef: ref('p'), expectedItemRevision: '12', recipientRef: ref('C') }, '半径边界以内可构造原普通交还动作');
    p.entities[1].position.x = 191;
    assert.equal(actions.privateReturnAction(p, ref('P'), 'owner', true), null, '半径之外不能借同场景直接发出');
    p.self.position = { x: 1090, y: 330 };
    assert.deepEqual(actions.privateReturnAction(p, ref('L'), 'origin', true), { kind: 'put_item', itemRef: ref('l'), expectedItemRevision: '12', sceneId: 'gaolao-courtyard', position: { x: 1180, y: 330 } }, '近距放回仍使用登记原处，不能换成脚边');
    p.self.position.x = 1089;
    assert.equal(actions.privateReturnAction(p, ref('L'), 'origin', true), null);
    p.self.position = null;
    assert.equal(actions.privateReturnAction(p, ref('P'), 'owner', true), null);
    assert.equal(actions.privateReturnAction(p, ref('L'), 'origin', true), null, '未知当前位置不能推定距离');
  }
});

test('行囊从独立逐物集合归还，当前槽换人或历史为空仍保留两件，放回必须用登记原处', () => {
  const p = addReturns(projection()); withRequest(p, 'private_items'); p.chapter.consents[0].requesterRef = ref('X');
  const before = structuredClone(p);
  assert.equal(typeof actions.privateReturnAction, 'function');
  assert.equal(actions.privateReturnEntries(p).length, 2);
  assert.deepEqual(actions.privateReturnAction(p, ref('P'), 'owner', true), { kind: 'transfer_item', itemRef: ref('p'), expectedItemRevision: '12', recipientRef: ref('C') });
  const nearOrigin = structuredClone(p); nearOrigin.self.position = { x: 1100, y: 330 };
  assert.deepEqual(actions.privateReturnAction(nearOrigin, ref('L'), 'origin', true), { kind: 'put_item', itemRef: ref('l'), expectedItemRevision: '12', sceneId: 'gaolao-courtyard', position: { x: 1180, y: 330 } });
  assert.deepEqual(p, before, '构造动作不乐观移除持物或返还项');
  p.chapter.consents = []; p.chapter.personalRequests = [];
  assert.equal(actions.privateReturnEntries(p).length, 2);
  p.chapter.privateReturns[0].ownerRef = null;
  assert.equal(actions.privateReturnAction(p, ref('P'), 'owner', true), null, '不按名字寻找同貌者代收');
  p.self.position = { x: 1100, y: 330 };
  assert.equal(actions.privateReturnAction(p, ref('P'), 'origin', true).kind, 'put_item');
  assert.equal(actions.privateReturnAction(p, ref('L'), 'owner', false), null);
  assert.equal(actions.privateReturnAction({ ...p, phase: 'Finished' }, ref('L'), 'origin', true), null, '终态只展示真实剩余事项');
  assert.equal(actions.privateReturnAction({ ...p, self: { ...p.self, sceneId: 'gaolao-village-road' } }, ref('L'), 'origin', true), null, '先回到登记原处的场景，不能跨场景放物');
  p.items.shift(); p.chapter.privateReturns.shift();
  assert.equal(actions.privateReturnEntries(p).length, 1, '归还第一件不能删除第二件');
  assert.equal(actions.privateReturnAction(p, ref('P'), 'origin', true), null, '旧上下文不能操作已消失物件');
});

test('新默认精确五维配置复用同几何正式物件/两场景，east和未知混装不借默认资源', () => {
  assert.ok(SPATIAL_CAPABILITIES.includes('gaolao-personal-consent-v1'));
  const p = projection(); p.scene = { sceneId: 'gaolao-courtyard' };
  const snapshot = { sessionId: 'room', viewId: 'view', projection: p };
  const context = objectArtContext(snapshot);
  const letter = { entityRef: ref('l'), name: '信件', visualKey: 'folded-letter', location: { kind: 'ground', sceneId: 'gaolao-courtyard', position: { x: 10, y: 10 } }, resourceRevision: '1', transferable: true, publicBorrowable: false, fields: [] };
  const old = { ...context, contentVersion: 'gaolaozhuang-scene-v2', chapterVersion: 'gaolaozhuang-chapter-v2', reducerVersion: 'gaolao-world-v1' };
  assert.deepEqual(selectObjectArt(letter, context, 'map'), selectObjectArt(letter, old, 'map'));
  assert.ok(selectObjectArt(letter, context, 'map'));
  for (const sceneId of ['gaolao-courtyard', 'gaolao-village-road']) assert.equal(selectSceneLayerGroup({ ...context, sceneId }), selectSceneLayerGroup({ ...old, sceneId }));
  const door = { entityRef: ref('D'), name: '门', visualKey: 'timber-door', sceneId: 'gaolao-courtyard', position: { x: 1250, y: 425 }, resourceRevision: '3', availableOperations: [], fields: [{ key: 'open', label: '开放', value: false }] };
  assert.ok(selectSceneDoor(selectSceneLayerGroup(context), context, [door], undefined, true).frame);
  for (const wrong of [{ ...context, variantId: 'east-tools' }, { ...context, reducerVersion: 'gaolao-world-v1' }, { ...context, chapterVersion: 'gaolaozhuang-chapter-v2' }, { ...context, mapVersion: 'other' }, { ...context, contentVersion: 'gaolaozhuang-tools-east-scene-v3', variantId: 'east-tools' }, { ...context, contentVersion: 'gaolaozhuang-scene-v99' }]) {
    assert.equal(selectObjectArt(letter, wrong, 'map'), null); assert.equal(selectSceneLayerGroup(wrong), null);
  }
});

const flush = () => new Promise(resolve => setImmediate(resolve));
function clientHarness() {
  let handlers, serial = 0, view = 1;
  let current = { schemaVersion: 2, type: 'world.snapshot', sessionId: 'personal-room', viewId: 'personal-view-1', snapshotSeq: '10', projection: addReturns(projection()) };
  current.projection.self.canControl = false;
  const requests = [], replies = [];
  const receipt = request => ({ schemaVersion: 2, sessionId: request.sessionId, clientActionId: request.clientActionId, status: 'Accepted', code: 'OK', observedSeq: '10', actionEventRange: null, result: {} });
  const client = new SpatialSessionClient({ receipt: async () => null }, (_token, callbacks) => {
    handlers = callbacks;
    return { connected: true, close() {}, async request(event, raw) {
      requests.push({ event, raw });
      if (event === 'session.subscribe') return structuredClone(current);
      const request = JSON.parse(raw);
      if (event === 'sync.request') return { schemaVersion: 2, type: 'world.batch', sessionId: request.sessionId, viewId: request.viewId, fromExclusive: request.cursor, throughSeq: request.cursor, events: [] };
      if (event.startsWith('control.')) {
        current = structuredClone(current); current.viewId = 'personal-view-' + (++view); current.projection.self.controlEpoch = String(BigInt(current.projection.self.controlEpoch) + 1n); current.projection.self.canControl = true;
        if (view > 2) current = JSON.parse(JSON.stringify(current).replace(/"([A-Za-z])\1{39}"/g, (_match, letter) => '"N' + letter.repeat(39) + '"'));
        return { schemaVersion: 2, sessionId: request.sessionId, nonce: request.nonce, controlEpoch: current.projection.self.controlEpoch, observedSeq: current.snapshotSeq, snapshot: current };
      }
      return replies.length ? replies.shift()(request) : receipt(request);
    } };
  }, { heartbeatMs: 0, id: () => 'ui-action-' + (++serial) });
  return { client, requests, replies, receipt, connect() { client.open('personal-room', 'token'); handlers.connected(); }, batch(value) { handlers.batch(value); }, publish(p) {
    const batch = spatialBatch(current, String(BigInt(current.snapshotSeq) + 1n), p);
    current = { ...current, snapshotSeq: batch.throughSeq, projection: structuredClone(p) }; handlers.batch(batch);
  } };
}

test('实际SpatialSession保留新询问nonce、Unknown原文；旧Accepted及旧view不能回写逐物集合', async t => {
  const h = clientHarness(); t.after(() => h.client.close()); h.connect(); await flush(); await h.client.control('resume');
  let p = h.client.state.snapshot.projection;
  await h.client.send(actions.requestPersonalAppearance(p.entities[1], 'front-meeting', 'reusable', p, true));
  assert.deepEqual(h.client.state.snapshot.projection.chapter.personalRequests, [], '登记动作Receipt不伪造本人回应');
  const declined = structuredClone(h.client.state.snapshot.projection), previous = withRequest(declined);
  previous.consent.status = 'declined'; Object.assign(previous.request, { lifecycle: 'closed', executionState: 'none', reasonCode: 'owner_declined', permissionTerm: 'reusable' }); h.publish(declined);
  p = h.client.state.snapshot.projection;
  await h.client.send(actions.requestPersonalAppearance(p.entities[1], 'front-meeting', 'single_use', p, true));
  const proposed = h.requests.filter(request => request.event === 'player.action.request').map(request => JSON.parse(request.raw));
  assert.notEqual(proposed[0].clientActionId, proposed[1].clientActionId); assert.equal(proposed[0].action.parameters.permissionTerm, 'reusable'); assert.equal(proposed[1].action.parameters.permissionTerm, 'single_use');
  assert.equal(h.client.state.snapshot.projection.chapter.consents[0].status, 'declined', '新动作确认不能改旧本人决定');
  h.replies.push(async () => { throw new Error('确认丢失'); });
  await h.client.send(actions.privateReturnAction(p, ref('P'), 'owner', true));
  const original = h.requests.filter(request => request.event === 'player.action.request').at(-1).raw;
  const originalId = JSON.parse(original).clientActionId;
  assert.equal(h.client.state.actions.find(action => action.id === originalId).status, 'unknown');
  assert.equal(actions.privateReturnEntries(h.client.state.snapshot.projection).length, 2, 'Unknown不能乐观删除待还项');
  let finish; h.replies.push(request => new Promise(resolve => { finish = () => resolve(h.receipt(request)); }));
  const retry = h.client.retry(originalId);
  assert.equal(h.requests.filter(request => request.event === 'player.action.request').at(-1).raw, original);
  const replaced = structuredClone(p); replaced.chapter.consents = []; replaced.chapter.personalRequests = [];
  const next = withRequest(replaced, 'private_items'); next.consent.consentId = next.request.consentId = ref('N'); next.consent.requesterRef = ref('X'); h.publish(replaced);
  const firstReturned = structuredClone(replaced); firstReturned.items.shift(); firstReturned.chapter.privateReturns.shift(); h.publish(firstReturned);
  assert.deepEqual(h.client.state.snapshot.projection.chapter.personalRequests, replaced.chapter.personalRequests, '同slot/active下只有逐物事实变化');
  assert.equal(actions.privateReturnEntries(h.client.state.snapshot.projection).length, 1);
  const oldView = structuredClone(h.client.state.snapshot);
  await h.client.control('take');
  const beforeReceipt = structuredClone(h.client.state.snapshot);
  assert.notEqual(beforeReceipt.projection.chapter.privateReturns[0].itemRef, ref('l'), '换view使用新引用');
  assert.equal(actions.privateReturnEntries(beforeReceipt.projection).length, 1, '新view不依赖当前槽重建旧持物');
  finish(); await retry; await flush();
  assert.deepEqual(h.client.state.snapshot, beforeReceipt, '旧Accepted只收束原动作历史并sync');
  assert.equal(h.client.state.actions.find(action => action.id === originalId).status, 'accepted');
  h.batch(spatialBatch(oldView, '100'));
  assert.deepEqual(h.client.state.snapshot, beforeReceipt, '旧actor引用投影不能覆盖当前控制视图');
});

test('实际Vue组件呈现正常询问、分轴反馈和逐物归还控件；终态只读且不把空集合写成全部实收', async t => {
  const { createServer } = await import('vite'); const { createSSRApp, h } = await import('vue'); const { renderToString } = await import('@vue/server-renderer');
  const { fileURLToPath } = await import('node:url');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  t.after(() => server.close());
  const interaction = (await server.ssrLoadModule('/src/features/character/GaolaoInteractionPanel.vue')).default;
  const chapter = (await server.ssrLoadModule('/src/features/character/GaolaoChapterState.vue')).default;
  const inventory = (await server.ssrLoadModule('/src/features/inventory/SpatialInventoryPane.vue')).default;
  const render = (component, props) => renderToString(createSSRApp({ render: () => h(component, props) }));
  const p = addReturns(projection());
  const form = await render(interaction, { projection: p, selectedRef: ref('C'), personLabels: {}, canAct: true, viewKey: 'view-one' });
  for (const text of ['gaolao-appearance-term', 'gaolao-private-term', '重新询问私物清单', '提出借貌询问', '提出私物取送询问', '询问能否以后沿用', '尚未得到同意']) assert.ok(form.includes(text), text);
  assert.ok(form.includes('包裹') && form.includes('信件')); assert.ok(!form.includes('我同意这次安排'));
  const own = withRequest(p, 'private_items'); own.request.executionState = 'return_only'; own.request.reasonCode = 'binding_invalidated'; own.request.reason = '这次经手安排已中断，请重新确认。';
  const state = await render(chapter, { chapter: p.chapter, projection: p, self: p.self, people: p.entities, items: p.items, personLabels: {}, canAct: true });
  for (const text of ['本人已同意', '请求状态', '当前可用性', '只可处理原持物归还', '取消我的私物请求']) assert.ok(state.includes(text), text);
  assert.ok(!state.includes('本人已撤回'), '失效不是本人撤回');
  p.chapter.privateReturns[0].ownerRef = null;
  const snapshot = { sessionId: 'room', viewId: 'view', snapshotSeq: '10', projection: p };
  const props = { snapshot, inventory: p.items, people: p.entities, personLabels: {}, canAct: true, recipient: ref('C') };
  const held = await render(inventory, props);
  assert.match(held, /aria-label="将包裹交回本人"[^>]*disabled/); assert.match(held, /aria-label="将信件交回本人"(?![^>]*disabled)/);
  assert.ok(held.includes('将包裹放回原处') && held.includes('将信件放回原处')); assert.ok(!held.includes('放在脚边'));
  const far = structuredClone(p); far.entities[1].position = { x: 300, y: 100 };
  const renderInventory = value => render(inventory, { ...props, inventory: value.items, people: value.entities, snapshot: { ...snapshot, projection: value } });
  const farHeld = await renderInventory(far);
  assert.equal((farHeld.match(/aria-label="将[^\"]+"[^>]*disabled/g) || []).length, 4, '远距两入口仍显示，但没有可直接发送的按钮');
  assert.ok(farHeld.includes('用地图') && farHeld.includes('当前位置更新'), '明确显示正常行走与重新感知步骤');
  const near = structuredClone(far); near.self.position = { x: 1100, y: 330 }; near.entities[1].position = { x: 1120, y: 330 };
  const nearHeld = await renderInventory(near);
  assert.match(nearHeld, /aria-label="将包裹交回本人"[^>]*disabled/, 'ownerRef=null 不按同名者恢复交还');
  assert.match(nearHeld, /aria-label="将信件交回本人"(?![^>]*disabled)/);
  for (const item of ['包裹', '信件']) assert.match(nearHeld, new RegExp('aria-label="将' + item + '放回原处"(?![^>]*disabled)'), '实际走近后可放回登记原处');
  for (const unavailable of [
    { ...near, paused: true },
    { ...near, self: { ...near.self, position: null } },
    { ...near, self: { ...near.self, sceneId: 'gaolao-village-road' } },
  ]) assert.equal(((await renderInventory(unavailable)).match(/aria-label="将[^\"]+"[^>]*disabled/g) || []).length, 4, '暂停、未知位置和跨场景保留入口而不提交');
  const terminal = await render(inventory, { ...props, canAct: false, snapshot: { ...snapshot, projection: { ...p, phase: 'Finished' } } });
  assert.equal((terminal.match(/aria-label="将[^\"]+"[^>]*disabled/g) || []).length, 4);
  const none = await render(inventory, { ...props, inventory: [], snapshot: { ...snapshot, projection: { ...p, items: [], chapter: { ...p.chapter, privateReturns: [] } } } });
  assert.ok(none.includes('放回原处不等于本人实收')); assert.ok(!none.includes('全部归还'));
});
