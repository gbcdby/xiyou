<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { ActionV2, ItemViewV2, Position } from '../../../../game/spatial-types.ts';
import { api, authNotice, identity } from '../../state/app-store.ts';
import { enterSpatialSession, leaveSpatialSession, performSpatial, spatialClient, spatialNotice, spatialState, spatialSnapshots, spatialStorageNotice } from '../../state/spatial-store.ts';
import AppIcon from '../../components/AppIcon.vue';
import SpatialFieldList from '../../components/SpatialFieldList.vue';
import SpatialStatus from '../../components/SpatialStatus.vue';
import SpatialMap from '../world/SpatialMap.vue';
import GaolaoMapNavigator from '../world/GaolaoMapNavigator.vue';
import GaolaoToolDock from './GaolaoToolDock.vue';
import SpatialReadingPane from './SpatialReadingPane.vue';
import SpatialReceipts from './SpatialReceipts.vue';
import SpatialInventoryPane from '../inventory/SpatialInventoryPane.vue';
import { objectDisplayFields } from '../../domain/gaolao-object-art.ts';
import SpatialNotebookPane from '../character/SpatialNotebookPane.vue';
import SpatialDialoguePane from '../dialogue/SpatialDialoguePane.vue';
import { SpatialPersonLabels } from '../../domain/spatial-person-labels.ts';
import { spatialSummary } from '../../domain/spatial-summary.ts';
import { sceneDisplayProjection } from '../../domain/spatial-display.ts';
import { gaolaoGuidance } from '../../domain/gaolao-guidance.ts';
import type { GuidanceAction } from '../../domain/gaolao-guidance.ts';
import { navigationScene } from '../../domain/gaolao-map-overview.ts';
import { isGaolaoProjection, proposeEnding } from '../../domain/gaolao-actions.ts';
import { SpatialRecapClient } from '../../network/spatial-recap-client.ts';
import { DIRECTION_MOVEMENT_PENDING_MESSAGE } from '../../network/spatial-session.ts';
import GaolaoChapterState from '../character/GaolaoChapterState.vue';
import GaolaoInteractionPanel from '../character/GaolaoInteractionPanel.vue';
import GaolaoRecapPanel from '../recap/GaolaoRecapPanel.vue';
import { useGaolaoHud } from './use-gaolao-hud.ts';
import '../../styles-spatial.css';
import '../../styles-art.css';

const route = useRoute();
const sessionId = computed(() => String(route.params.sessionId || ''));
const projection = computed(() => spatialState.value.snapshot?.projection || null);
// 全场物理展示与原感知详情分开：人物/地物可选取，剧情与操作仍读原投影。
const displayProjection = computed(() => projection.value ? sceneDisplayProjection(projection.value) : null);
const navigationAnchors = computed(() => navigationScene(projection.value?.scene || null, projection.value?.mapCatalog)?.anchors || []);
const isGaolao = computed(() => isGaolaoProjection(projection.value));
const hud = computed(() => isGaolao.value && projection.value?.phase !== 'Lobby');
const online = computed(() => spatialState.value.connection === 'online');
const canAct = computed(() => online.value && spatialState.value.inputReady && projection.value?.phase === 'Running' && !projection.value.paused);
const canStop = computed(() => online.value && spatialState.value.inputReady && projection.value?.phase === 'Running');
const selectedRef = ref(''); const recipient = ref(''); const message = ref(''); const channel = ref<'public' | 'team' | 'directed'>('public');
const copied = ref(false); const starting = ref(false); const startNotice = ref(''); const roomCount = ref<number | null>(null); let startNonce = '';
type ReadingPanel = 'identity' | 'inventory' | 'notebook' | 'dialogue' | 'chapter' | 'recap';
const reading = ref<ReadingPanel | null>(null);
const objectsOpen = ref(false); const receiptsOpen = ref(false);
const guidanceToggle = ref<HTMLButtonElement | null>(null);
const toolDock = ref<InstanceType<typeof GaolaoToolDock> | null>(null);
const cameraState = ref<{ mode: 'follow' | 'free'; canReturn: boolean }>({ mode: 'follow', canReturn: false });
let readingTrigger: HTMLElement | null = null;
let objectsTrigger: HTMLElement | null = null;
let receiptsTrigger: HTMLElement | null = null;
const readingNames = { identity: '角色信息', inventory: '行囊', notebook: '手记', dialogue: '交谈', chapter: '进展', recap: '回看' };
const readingTitles = { identity: '此刻的身份与职责', inventory: '行囊与交接', notebook: '已获知的记录', dialogue: '与身边人交谈', chapter: '本局进展与安排', recap: '这一程的结果' };
const recapClient = new SpatialRecapClient(api, state => { recapState.value = state; });
const recapState = shallowRef(recapClient.state);
const selected = computed(() => displayProjection.value ? [...displayProjection.value.targets, ...displayProjection.value.items, displayProjection.value.self, ...displayProjection.value.entities].find(value => value.entityRef === selectedRef.value) : null);
const target = computed(() => projection.value?.targets.find(value => value.entityRef === selectedRef.value));
const item = computed(() => projection.value?.items.find(value => value.entityRef === selectedRef.value));
const inventory = computed(() => projection.value?.items.filter(i => i.location.kind === 'held' && i.location.ownerRef === projection.value?.self.entityRef) || []);
const others = computed(() => projection.value?.entities.filter(e => e.entityRef !== projection.value?.self.entityRef && e.sceneId === projection.value?.self.sceneId) || []);
const displayedPeople = computed(() => displayProjection.value?.entities.filter(e => e.entityRef !== projection.value?.self.entityRef && e.sceneId === projection.value?.self.sceneId) || []);
const displayedObjects = computed(() => displayProjection.value ? [...displayProjection.value.targets, ...displayProjection.value.items, ...displayedPeople.value] : []);
const personLabeler = new SpatialPersonLabels();
const personLabels = ref<Record<string, string>>({});
const hasPersonMarkers = computed(() => projection.value ? [projection.value.self, ...displayedPeople.value].some(person => personLabels.value[person.entityRef] && personLabels.value[person.entityRef] !== person.name) : false);
const currentSummary = computed(() => spatialSummary(projection.value));
const recentPreparations = computed(() => isGaolao.value
  ? projection.value?.chapter?.progress.filter(field => field.value === true && field.label !== projection.value?.chapter?.progress.at(-1)?.label).slice(-2).map((field, index) => ({ objectiveId: String(index), label: field.label })) || []
  : projection.value?.objectives.filter(o => o.status === 'completed').slice(-2) || []);
const duties = { A: '迎客联络', B: '内院照应', C: '木作帮手', D: '灶房帮手', E: '庄外引路' };
const ownDuties = computed(() => projection.value?.chapter?.responsibilities.map(duty => duties[duty]).join('、') || '同行旅伴');
const unknownCount = computed(() => spatialState.value.actions.filter(action => action.status === 'unknown').length);
const guidance = computed(() => gaolaoGuidance(projection.value, { online: online.value, inputReady: spatialState.value.inputReady, unknownCount: unknownCount.value }));
const directionNotice = computed(() => canAct.value && spatialState.value.directionInput.blocker === 'movement'
  ? '上次移动或停步还待确认，请查询原动作；确认后重新按方向键。' : '');
const visibleNetworkMessage = computed(() => {
  const message = spatialState.value.message;
  // 本次成功和方向自身说明不能盖住当前恢复条件；真正的其他错误仍优先。
  if (message === '已恢复本人控制。' && spatialState.value.inputReady && (hud.value || directionNotice.value)) return '';
  if (message === DIRECTION_MOVEMENT_PENDING_MESSAGE && directionNotice.value) return '';
  return message;
});
const currentNotice = computed(() => spatialNotice.value || spatialStorageNotice.value || visibleNetworkMessage.value || directionNotice.value);
const currentStatus = computed(() => {
  const notice = currentNotice.value;
  if (notice) return { text: notice, tone: 'uncertain' as const };
  const status = guidance.value?.status;
  const navigation = spatialState.value.navigation;
  if (navigation && status?.tone !== 'uncertain' && status?.tone !== 'paused') {
    const place = projection.value?.mapCatalog?.find(scene => scene.sceneId === navigation.destinationSceneId)?.name || '所选地点';
    const step = { 'approaching-exit': '正走向出口', crossing: '正在通过出口', 'approaching-destination': '正走向目的地' }[navigation.phase];
    return { text: `前往${place} · ${step}`, tone: 'pending' as const };
  }
  return status;
});
const movementLabels = { accepted: '路线已受理', moving: '正在行走', arrived: '已到达', blocked: '路线受阻', cancelled: '已停步' };
const connectionNames = { idle: '尚未连接', connecting: '连接房间中', synchronizing: '同步授权场景中', online: '已连接', offline: '正在重连', forbidden: '当前无法访问房间' };
const hudRoot = ref<HTMLElement | null>(null);
const sceneMap = ref<InstanceType<typeof SpatialMap> | null>(null);
const hudPanelKind = computed(() => receiptsOpen.value ? 'receipts' : reading.value || (objectsOpen.value ? 'objects' : selected.value ? 'action' : null));
const { narrow, guidanceExpanded, mapExpanded, dockExpanded } = useGaolaoHud(hudRoot);

function clearAuthorizedInput() {
  selectedRef.value = ''; recipient.value = ''; message.value = ''; channel.value = 'public'; reading.value = null; readingTrigger = null;
  objectsTrigger = null; receiptsTrigger = null;
  objectsOpen.value = false; receiptsOpen.value = false;
  toolDock.value?.closeMore(false);
  cameraState.value = { mode: 'follow', canReturn: false };
  personLabeler.clear(); personLabels.value = {};
  recapClient.close();
}
watch([sessionId, () => identity.value?.token], () => {
  leaveSpatialSession(); clearAuthorizedInput(); startNonce = ''; roomCount.value = null;
  if (identity.value) enterSpatialSession(sessionId.value);
}, { immediate: true });
watch(() => spatialState.value.snapshot?.viewId, clearAuthorizedInput);
watch(() => projection.value?.phase, () => { if (projection.value) void refreshPeople(); });
watch(projection, value => { if (!value) clearAuthorizedInput(); });
watch([() => spatialState.value.snapshot?.viewId, displayProjection], ([view, value]) => {
  personLabels.value = personLabeler.update(view || null, value ? [value.self, ...displayedPeople.value].filter(person => person.position !== null) : []);
}, { immediate: true });
watch(selected, value => { if (!value) selectedRef.value = ''; });
watch(others, people => { if (recipient.value && !people.some(p => p.entityRef === recipient.value)) recipient.value = ''; });
watch([reading, () => identity.value?.token, sessionId, () => spatialState.value.snapshot, online], () => {
  const snapshot = spatialState.value.snapshot; const p = snapshot?.projection;
  const terminal = p?.phase === 'Finished' || p?.phase === 'Aborted';
  void recapClient.open(reading.value === 'recap' && isGaolao.value && online.value && snapshot && p && terminal && identity.value
    ? { sessionId: snapshot.sessionId, actorRef: p.self.entityRef, throughSeq: snapshot.snapshotSeq, phase: p.phase as 'Finished' | 'Aborted', viewId: snapshot.viewId, identity: identity.value.token }
    : null);
}, { immediate: true });
const lobbyPoll = setInterval(() => { if (projection.value?.phase === 'Lobby' || (hud.value && online.value)) void refreshPeople(); }, 2000);
onMounted(() => window.addEventListener('keydown', escape, true));
onBeforeUnmount(() => { clearInterval(lobbyPoll); window.removeEventListener('keydown', escape, true); recapClient.close(); leaveSpatialSession(); });

async function openReading(panel: ReadingPanel, event?: MouseEvent) {
  toolDock.value?.closeMore(false);
  if (reading.value === panel) { closeReading(); return; }
  objectsOpen.value = false; receiptsOpen.value = false;
  readingTrigger = event?.currentTarget instanceof HTMLElement ? event.currentTarget : document.activeElement instanceof HTMLElement ? document.activeElement : null; reading.value = panel;
  await nextTick(); document.getElementById('spatial-reading-title')?.focus({ preventScroll: true });
}
function closeReading() {
  reading.value = null;
  const trigger = readingTrigger; readingTrigger = null;
  restorePanelFocus(trigger);
}
function escape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.isComposing || event.repeat) return;
  if (event.target instanceof HTMLElement && event.target.closest('.gaolao-map-navigator')) return;
  if (toolDock.value?.closeMore()) { event.preventDefault(); event.stopPropagation(); }
  else if (reading.value) { event.preventDefault(); event.stopPropagation(); closeReading(); }
  else if (receiptsOpen.value) { event.preventDefault(); event.stopPropagation(); closeReceipts(); }
  else if (objectsOpen.value || selectedRef.value) { event.preventDefault(); event.stopPropagation(); closeObjects(); }
  else if (hud.value && dockExpanded.value && event.target instanceof HTMLElement && event.target.closest('.gaolao-dock-anchor')) { event.preventDefault(); event.stopPropagation(); dockExpanded.value = false; void nextTick(() => toolDock.value?.focusFallback()); }
  else if (hud.value && guidanceExpanded.value) { event.preventDefault(); event.stopPropagation(); guidanceExpanded.value = false; void nextTick(() => guidanceToggle.value?.focus({ preventScroll: true })); }
  else if (canStop.value) { event.preventDefault(); event.stopPropagation(); stop(); }
}
function stop() { void performSpatial(() => spatialClient.stop()); }
function restorePanelFocus(trigger: HTMLElement | null) {
  void nextTick(() => {
    if (trigger?.isConnected && trigger.getClientRects().length) trigger.focus({ preventScroll: true });
    else if (hud.value && toolDock.value) toolDock.value.focusFallback();
    else sceneMap.value?.focusScene();
  });
}
async function showReceipts() {
  receiptsTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  toolDock.value?.closeMore(false);
  closeReading(); objectsOpen.value = false; receiptsOpen.value = true; await nextTick();
  if (!hud.value) document.getElementById('spatial-receipts')?.scrollIntoView({ block: 'start' });
  document.getElementById('spatial-receipts-heading')?.focus({ preventScroll: true });
}
function closeReceipts() { receiptsOpen.value = false; const trigger = receiptsTrigger; receiptsTrigger = null; restorePanelFocus(trigger); }
async function showObjects() { objectsTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null; closeReading(); receiptsOpen.value = false; objectsOpen.value = true; await nextTick(); document.getElementById('spatial-selection-heading')?.focus({ preventScroll: true }); }
function closeObjects(restoreFocus = true) { objectsOpen.value = false; selectedRef.value = ''; recipient.value = ''; const trigger = objectsTrigger; objectsTrigger = null; if (restoreFocus) restorePanelFocus(trigger); }
function openMap() { toolDock.value?.closeMore(false); reading.value = null; readingTrigger = null; receiptsOpen.value = false; receiptsTrigger = null; closeObjects(false); }
function traverseExit(exitId: string) {
  // 只在明确出口操作时回到行走视图；原请求不留到后续布局或回执续体重发。
  openMap();
  void performSpatial(() => spatialClient.traverseExit(exitId));
  sceneMap.value?.revealScene();
}
async function refreshPeople() {
  const room = sessionId.value; const account = identity.value?.token;
  try { const rooms = await api.rooms(); if (room === sessionId.value && account === identity.value?.token) roomCount.value = rooms.find(value => value.sessionId === room)?.playerCount ?? null; }
  catch { if (room === sessionId.value && account === identity.value?.token) roomCount.value = null; }
}
async function start() {
  if (!online.value || starting.value) return;
  starting.value = true; startNotice.value = ''; if (!startNonce) startNonce = crypto.randomUUID();
  try { await api.start(sessionId.value, startNonce); await spatialClient.sync(); startNotice.value = '开局请求已返回，等待服务器状态。'; }
  catch (error) { startNotice.value = error instanceof Error ? error.message : '开局尚未确认。'; } finally { starting.value = false; }
}
async function copy() { try { await navigator.clipboard.writeText(sessionId.value); copied.value = true; } catch { copied.value = false; } }
function move(position: Position) { selectedRef.value = ''; recipient.value = ''; void performSpatial(() => spatialClient.move(position)); }
function direction(vector: Position | null) { if (vector) { selectedRef.value = ''; recipient.value = ''; } spatialClient.setDirection(vector); }
function navigate(sceneId: string, position: Position) { selectedRef.value = ''; recipient.value = ''; void performSpatial(() => spatialClient.navigateTo(sceneId, position)); }
function actOnGuidance(action: GuidanceAction) {
  if (action.kind === 'navigate') { navigate(action.sceneId, action.position); return; }
  if (action.kind === 'select') { select(action.reference); return; }
  if (action.kind === 'objects') { void showObjects(); return; }
  if (action.kind === 'receipts') { void showReceipts(); return; }
  void openReading(action.kind);
}
function select(reference: string) {
  const trigger = document.activeElement;
  if (trigger instanceof HTMLElement && !trigger.closest('.spatial-sidebar, .spatial-receipts')) objectsTrigger = trigger;
  if (selectedRef.value !== reference) { recipient.value = ''; spatialClient.cancelQueued(); }
  selectedRef.value = reference; objectsOpen.value = false; receiptsOpen.value = false; if (reading.value) closeReading();
}
function displayName(object: { entityRef: string; name: string }) { return personLabels.value[object.entityRef] || object.name; }
function send(action: ActionV2) { void performSpatial(() => spatialClient.send(action)); }
function requestEnding(scope: 'chapter' | 'recruitment') {
  const p = projection.value; if (!p?.chapter || !p.self.capabilities.includes('request_end')) return;
  const action = proposeEnding(p.chapter, scope, crypto.randomUUID(), canStop.value); if (action) send(action);
}
function approach(reference: string, action?: ActionV2) {
  const p = displayProjection.value; if (!p) return;
  const t = p.targets.find(t => t.entityRef === reference); const i = p.items.find(i => i.entityRef === reference); const e = p.entities.find(e => e.entityRef === reference);
  const location = i?.location;
  const position = t?.position || (location?.kind === 'ground' ? location.position : location?.kind === 'held' ? p.entities.find(e => e.entityRef === location.ownerRef)?.position : null) || e?.position;
  if (!position) { spatialNotice.value = '当前没有这个对象可用的接近位置。'; return; }
  void performSpatial(() => spatialClient.move(position, { targetRef: reference }, action));
}
function put(i: ItemViewV2) { const p = projection.value; if (p?.self.position && p.self.sceneId) send({ kind: 'put_item', itemRef: i.entityRef, expectedItemRevision: i.resourceRevision, sceneId: p.self.sceneId, position: p.self.position }); }
function transfer(i: ItemViewV2) { if (recipient.value) send({ kind: 'transfer_item', itemRef: i.entityRef, expectedItemRevision: i.resourceRevision, recipientRef: recipient.value }); }
function reclaim(i: ItemViewV2) { if (i.location.kind === 'held' && i.reclaimHolderEpoch) send({ kind: 'reclaim_public_item', itemRef: i.entityRef, holderRef: i.location.ownerRef, expectedItemRevision: i.resourceRevision, expectedHolderEpoch: i.reclaimHolderEpoch }); }
function targetOperation(operationId: string) {
  const object = target.value; if (!object) return;
  if (operationId.startsWith('gz-')) return;
  const cooperation = projection.value?.cooperations.find(value => value.operationId === operationId);
  if (cooperation) { approach(object.entityRef, { kind: 'cooperate', operationId, operationVersion: cooperation.operationVersion, phase: 'prepare' }); return; }
  // 灰盒已声明此操作为合作；缺公开准备数据时不能猜造其版本或当作单人操作。
  if (operationId === 'lock-support') { spatialNotice.value = '协作准备信息尚未同步，请稍后查看。'; return; }
  approach(object.entityRef, { kind: 'interact', targetRef: object.entityRef, operationId, expectedTargetRevision: object.resourceRevision });
}
function speak() {
  if (!message.value.trim() || (channel.value === 'directed' && !recipient.value)) return;
  send({ kind: 'speak', text: message.value.trim(), channel: channel.value, recipientRefs: channel.value === 'directed' ? [recipient.value] : [] }); message.value = '';
}
function ownerName(reference: string) { const p = projection.value; return p?.self.entityRef === reference ? '你' : personLabels.value[reference] || p?.entities.find(e => e.entityRef === reference)?.name || '当前视野外的持有人'; }
</script>

<template>
  <div ref="hudRoot" class="spatial-page page-shell" :class="{ 'gaolao-scene-page': hud, 'hud-panel-open': hud && narrow && Boolean(hudPanelKind), 'hud-dock-collapsed': hud && !dockExpanded }">
    <header v-if="hud" class="gaolao-heading">
      <div class="gaolao-task-card"><div class="gaolao-chapter-name"><span class="gaolao-chapter-seal" aria-hidden="true">一</span><h1>高老庄</h1><span>{{ projection?.scene?.name || '同行记' }}</span></div>
      <section v-if="guidance" class="gaolao-guidance" :class="{ 'is-expanded': guidanceExpanded }" aria-label="目标与下一步" data-keyboard-scope="panel">
        <button ref="guidanceToggle" class="text-button gaolao-guidance-toggle" :aria-label="guidanceExpanded ? '收起详情' : '任务详情'" :aria-expanded="guidanceExpanded" aria-controls="gaolao-guidance-details" @click="guidanceExpanded = !guidanceExpanded"><span class="gaolao-task-marker" aria-hidden="true">◆</span><span class="gaolao-next-step" data-testid="gaolao-next-step">{{ guidance.next.title }}</span><AppIcon :name="guidanceExpanded ? 'chevron-up' : 'chevron-down'" :size="18" /></button>
        <div v-if="guidanceExpanded" id="gaolao-guidance-details" class="gaolao-guidance-details">
          <div class="gaolao-shared-goal"><p class="eyebrow">共同目标</p><h2 data-testid="gaolao-goal">{{ guidance.goal }}</h2></div>
          <p>{{ guidance.next.description }}</p><p v-if="guidance.knownProgress" class="gaolao-known-progress">{{ guidance.knownProgress }}</p>
          <button v-if="guidance.next.action" class="text-button gaolao-guide-action" :disabled="guidance.next.action.kind === 'navigate' && !canAct" @click="actOnGuidance(guidance.next.action)">{{ guidance.next.action.label }}<AppIcon name="arrow" :size="15" /></button>
        </div>
      </section>
      </div>
      <p v-if="currentStatus" class="gaolao-current-status" :data-tone="currentStatus.tone" data-testid="movement-status" role="status" tabindex="0" data-keyboard-scope="panel">{{ currentStatus.text }}</p>
    </header>
    <header v-else class="spatial-heading">
      <div><RouterLink to="/" class="back-link">返回房间大厅</RouterLink><h1>{{ isGaolao ? '高老庄 · 同行记' : '高老庄 · 行走灰盒' }}</h1><p>房间 <code>{{ sessionId }}</code><button class="text-button" @click="copy">{{ copied ? '已复制' : '复制房间号' }}</button></p></div>
      <div class="spatial-connection" role="status">{{ connectionNames[spatialState.connection] }}<small v-if="projection">{{ projection.paused ? 'Ⅱ 等待同伴，场景已暂停' : projection.phase === 'Running' ? '场景运行中' : projection.phase === 'Lobby' ? '等待启程' : '这一程已结束' }}</small></div>
    </header>
    <p v-if="!hud && currentNotice" class="notice warning" role="status">{{ currentNotice }}</p>
    <section v-if="!projection" class="panel session-empty"><h2>{{ !identity ? '先登录再进入房间' : connectionNames[spatialState.connection] }}</h2><p>{{ !identity ? authNotice || '返回大厅留下称呼，再加入伙伴的房间。' : '连接后会显示你所在的场景。' }}</p><RouterLink v-if="!identity" to="/" class="primary-button">返回大厅</RouterLink><button v-else class="secondary-button" @click="spatialClient.reconnect()">重新连接</button></section>
    <template v-else>
      <section v-if="projection.phase === 'Lobby'" class="panel waiting-room"><p class="eyebrow">等待同行</p><h2>{{ roomCount === null ? '等待人数同步' : roomCount + ' 位旅伴已相聚' }}</h2><p>2–5 位真人可以开始。启程后，各自在自己的浏览器中控制角色。</p><button class="primary-button" :disabled="!online || starting || (roomCount !== null && roomCount < 2)" @click="start">{{ starting ? '正在开始…' : '开始同行（房主）' }}</button><p v-if="startNotice" role="status">{{ startNotice }}</p></section>
      <template v-else>
        <section v-if="projection.ending && !hud" class="panel spatial-ending"><h2>{{ projection.ending.title }}</h2><p>{{ projection.ending.summary }}</p></section>
        <div class="spatial-layout" :class="{ 'reading-open': Boolean(reading) && (!hud || narrow) }">
          <div class="spatial-main">
            <section v-if="!hud && (currentSummary || recentPreparations.length)" class="spatial-current-objective" :aria-label="currentSummary?.caption || '眼下事项'"><div><p class="eyebrow">{{ currentSummary?.caption || '眼下事项' }}</p><h2>{{ currentSummary?.title || '已知准备已留下' }}</h2></div><div class="spatial-known-preparations"><SpatialStatus v-for="objective in recentPreparations" :key="objective.objectiveId" :label="objective.label" tone="confirmed" /></div></section>
            <SpatialMap ref="sceneMap" :snapshot="spatialState.snapshot!" :snapshot-source="spatialState.timedTrail ? spatialSnapshots : undefined" :disabled="!canAct" :selected="selectedRef" :person-labels="personLabels" :label-mode="hud && !objectsOpen ? 'contextual' : 'all'" :immersive="hud" @camera-change="cameraState = $event" @move="move" @direction="direction" @select="select" @stop="stop" @objects="showObjects" @settled="spatialClient.confirmDisplayedArrival($event)" />
            <div class="spatial-hud-controls">
            <GaolaoToolDock v-if="hud" ref="toolDock" v-model:expanded="dockExpanded" :self="projection.self" :reading="reading" :can-stop="canStop" :can-recap="Boolean(projection.ending)" :can-read-receipts="Boolean(spatialState.actions.length)" :objects-open="objectsOpen" :receipts-open="receiptsOpen" :unknown-count="unknownCount" :context-key="sessionId + ':' + spatialState.snapshot!.viewId" @reading="openReading" @stop="stop" @objects="showObjects" @receipts="showReceipts" />
            <p v-if="!hud" class="spatial-input-hint">点地行走 · 场景内方向键移动 · Esc 关闭详情 / 停步</p>
            <div v-if="!hud" class="spatial-hud-footer">
              <div class="spatial-action-bar"><div><strong>{{ projection.self.name }}</strong><span v-if="hud" class="gaolao-own-duties">{{ ownDuties }}</span><span v-if="!hud" data-testid="movement-status">{{ projection.movement ? movementLabels[projection.movement.status] : '点地选择路线' }}</span><span v-if="!hud && spatialState.queuedAction">{{ spatialState.queuedAction }}</span></div><button class="secondary-button" aria-label="停步 / 取消后续操作" :disabled="!canStop" @click="stop"><AppIcon name="x" :size="16" />停步</button></div>
              <nav class="spatial-tool-dock" aria-label="随身功能">
                <button aria-controls="spatial-reading-pane" :aria-expanded="reading === 'inventory'" @click="openReading('inventory', $event)"><AppIcon name="bag" :size="22" /><span>行囊</span></button>
                <button aria-controls="spatial-reading-pane" :aria-expanded="reading === 'notebook'" @click="openReading('notebook', $event)"><AppIcon name="book" :size="22" /><span>手记</span></button>
                <button aria-controls="spatial-reading-pane" :aria-expanded="reading === 'dialogue'" @click="openReading('dialogue', $event)"><AppIcon name="chat" :size="22" /><span>交谈</span></button>
                <button v-if="isGaolao" aria-controls="spatial-reading-pane" :aria-expanded="reading === 'chapter'" @click="openReading('chapter', $event)"><AppIcon name="group" :size="22" /><span>{{ hud ? '队伍' : '进展' }}</span></button>
                <button v-if="isGaolao || projection.ending" aria-controls="spatial-reading-pane" :aria-expanded="reading === 'recap'" :disabled="!projection.ending" :title="projection.ending ? '查看这一程的过程与结果' : '这一程结束后可回看'" @click="openReading('recap', $event)"><AppIcon name="clock" :size="22" /><span>回看</span></button>
              </nav>
            </div>
            </div>
            <button v-if="!hud && unknownCount" class="spatial-pending-link" @click="showReceipts"><SpatialStatus :label="'待确认动作 ' + unknownCount + ' 条'" tone="uncertain" /><span>查询 / 原样重试</span><AppIcon name="arrow" :size="18" /></button>
          </div>
          <div class="spatial-rail">
            <section v-if="projection.phase === 'Running' && !spatialState.inputReady" class="control-banner" data-keyboard-scope="panel"><div><strong>当前为只读视角</strong><p>恢复本人控制后继续行走；另一处连接正在控制时，可选择接管。</p></div><div class="button-row"><button class="primary-button" :disabled="!online || spatialState.controlBusy" @click="performSpatial(() => spatialClient.control('resume'))">恢复本人控制</button><button class="secondary-button" :disabled="!online || spatialState.controlBusy" @click="performSpatial(() => spatialClient.control('take'))">明确接管此角色</button></div></section>
            <div v-if="hud && displayProjection" class="gaolao-map-tools">
              <GaolaoMapNavigator :key="sessionId + ':' + spatialState.snapshot!.viewId" v-model:expanded="mapExpanded" :scene="projection.scene" :catalog="projection.mapCatalog || []" :self="displayProjection.self" :people="displayedPeople" :disabled="!canAct" compact :panel-open="Boolean(hudPanelKind)" @move="move" @navigate="navigate" @open="openMap" />
              <button v-if="cameraState.canReturn" class="gaolao-return-to-self" @click="sceneMap?.returnToSelf()"><AppIcon name="location" :size="18" />回到角色</button>
            </div>
            <aside v-if="!receiptsOpen && (!hud || reading || selected || objectsOpen)" class="spatial-sidebar" :data-reading-kind="reading || (objectsOpen ? 'objects' : 'action')" data-keyboard-scope="panel">
            <SpatialReadingPane v-if="reading" :title="readingTitles[reading]" :close-label="'关闭' + readingNames[reading]" @close="closeReading">
              <p v-if="hasPersonMarkers" class="spatial-panel-intro">人物编号用于区分同名对象，可在场景对象中查看。</p><p v-if="selected && personLabels[selected.entityRef]" class="spatial-panel-intro">地图选中：<strong>{{ displayName(selected) }}</strong></p>
              <section v-if="reading === 'identity'" class="gaolao-identity-details"><p class="eyebrow">此刻，你是</p><h3>{{ projection.self.name }}</h3><p>{{ ownDuties }}</p><p>{{ projection.self.canControl && spatialState.inputReady ? '由你控制' : '当前为只读视角' }}</p><p v-if="currentStatus" role="status">{{ currentStatus.text }}</p></section>
              <SpatialInventoryPane :snapshot="spatialState.snapshot!" v-else-if="reading === 'inventory'" :inventory="inventory" :people="others" :person-labels="personLabels" :can-act="canAct" :recipient="recipient" @recipient="recipient = $event" @put="put" @transfer="transfer" @action="send" />
              <SpatialNotebookPane v-else-if="reading === 'notebook'" :observations="projection.observations" :people="others" :person-labels="personLabels" :can-act="canAct" :recipient="recipient" @recipient="recipient = $event" @share="send({ kind: 'share_evidence', evidenceRef: $event.observationRef, recipientRefs: [recipient] })" />
              <SpatialDialoguePane v-else-if="reading === 'dialogue'" :claims="projection.claims" :people="others" :person-labels="personLabels" :can-act="canAct" :recipient="recipient" :message="message" :channel="channel" @recipient="recipient = $event" @message="message = $event" @channel="channel = $event" @speak="speak" />
              <template v-else-if="reading === 'chapter' && projection.chapter"><section v-if="hud" class="gaolao-room-details"><h3>本局旅伴</h3><p>{{ roomCount === null ? '成员人数尚未同步。' : '本局有 ' + roomCount + ' 位成员。' }}人数不代表此刻在线状况。</p><p>房间 <code>{{ sessionId }}</code></p><button class="text-button" @click="copy">{{ copied ? '已复制' : '复制房间号' }}</button><RouterLink to="/" class="text-button">返回房间大厅</RouterLink></section><GaolaoChapterState :projection="projection" :chapter="projection.chapter" :self="projection.self" :people="projection.entities" :items="projection.items" :person-labels="personLabels" :can-act="canAct" :can-end="canStop" @action="send" /><section v-if="projection.phase === 'Running' && projection.self.capabilities.includes('request_end')" class="gaolao-ending-choices"><h3>共同决定这一程</h3><p>每位当前在线旅伴都须明确确认。结束招徒尝试仍保留安置、归还与实际分别的工作；暂告一段会按已有事实结束本局。</p><p v-if="projection.chapter.endProposal?.status === 'pending'">已有一轮确认正在进行；更换提议会重新征求大家确认。</p><div class="button-row"><button class="secondary-button" :disabled="!canStop || (projection.chapter.endProposal?.scope === 'recruitment' && projection.chapter.endProposal.status !== 'invalidated')" @click="requestEnding('recruitment')">提议结束招徒</button><button class="secondary-button" :disabled="!canStop || (projection.chapter.endProposal?.scope === 'chapter' && projection.chapter.endProposal.status === 'pending')" @click="requestEnding('chapter')">提议暂告一段</button></div></section></template>
              <GaolaoRecapPanel v-else-if="reading === 'recap' && isGaolao" :state="recapState" :ending="projection.ending" @load="recapClient.loadMore()" />
              <template v-else-if="reading === 'recap' && projection.ending"><h3>{{ projection.ending.title }}</h3><p class="spatial-record-statement">{{ projection.ending.summary }}</p><SpatialFieldList :fields="projection.ending.facts || []" /></template>
            </SpatialReadingPane>
            <template v-else>
              <section class="panel spatial-selection"><button v-if="hud" class="icon-button gaolao-close-actions" aria-label="关闭对象区" @click="closeObjects()"><AppIcon name="x" /></button><p class="eyebrow">本场景对象</p><h2 id="spatial-selection-heading" tabindex="-1">{{ objectsOpen && hud ? '场景中的人与物' : selected ? (selected.entityRef === projection.self.entityRef ? '你的位置' : displayName(selected)) : '选择人物或物件' }}</h2><p v-if="!selected" class="muted">在场景中点选，或从下方找到本场景的人与物。</p><div v-if="selected && selected.entityRef !== projection.self.entityRef" class="button-row"><button class="secondary-button" :disabled="!canAct" @click="approach(selected.entityRef, { kind: 'inspect', targetRef: selected.entityRef })">走近并查看</button><button class="text-button" :disabled="!canAct" @click="send({ kind: 'inspect', targetRef: selected.entityRef })">在当前位置查看</button></div><p v-if="selected && !target && !item && !others.some(person => person.entityRef === selectedRef) && selected.entityRef !== projection.self.entityRef" class="muted">可先走近。到达后再查看详情和可用操作。</p><template v-if="target"><SpatialFieldList :fields="objectDisplayFields(target)" /><button v-for="operation in isGaolao ? [] : target.availableOperations" :key="operation" class="secondary-button" :disabled="!canAct" @click="targetOperation(operation)">{{ operation === 'lock-support' ? '走近合作固定支架' : '走近后执行操作' }}</button></template><template v-if="item"><p class="spatial-item-location">{{ item.location.kind === 'ground' ? '放在地面' : '由' + ownerName(item.location.ownerRef) + '持有' }}</p><SpatialFieldList :fields="item.fields" /><button v-if="item.location.kind === 'ground'" class="primary-button" :disabled="!canAct" @click="approach(item.entityRef, { kind: 'take_item', itemRef: item.entityRef, expectedItemRevision: item.resourceRevision })">走近并拿取</button><button v-if="item.publicBorrowable && item.reclaimHolderEpoch" class="secondary-button" :disabled="!canAct" @click="reclaim(item)">领回公用物</button></template><GaolaoInteractionPanel v-if="isGaolao && projection.chapter" :projection="projection" :selected-ref="selectedRef" :person-labels="personLabels" :can-act="canAct" :view-key="spatialState.snapshot!.viewId" @action="send" /><ul v-if="!hud || objectsOpen" class="spatial-object-list"><li v-for="object in displayedObjects" :key="object.entityRef"><button class="text-button" :aria-pressed="selectedRef === object.entityRef" @click="select(object.entityRef)">{{ displayName(object) }}</button></li><li v-for="anchor in navigationAnchors" :key="'anchor:' + anchor.anchorId"><button class="text-button" :disabled="!canAct" @click="performSpatial(() => spatialClient.move(anchor.position, { anchorId: anchor.anchorId }))">前往{{ anchor.label }}</button></li></ul></section>
              <section v-if="projection.cooperations.length && (!hud || objectsOpen)" class="panel"><h2>协作准备</h2><article v-for="operation in projection.cooperations" :key="operation.operationId" class="spatial-cooperation"><SpatialStatus :label="operation.phase === 'locked' ? '协作已提交' : operation.readyCount + '/' + operation.requiredCount + ' 人就位'" :tone="operation.phase === 'locked' ? 'confirmed' : 'pending'" /><div class="button-row"><button v-for="(anchor, index) in operation.anchors" :key="index" class="text-button" :disabled="!canAct || operation.phase === 'locked'" @click="performSpatial(() => spatialClient.move(anchor))">前往位置{{ index + 1 }}</button></div><div class="button-row"><button class="secondary-button" :disabled="!canAct || operation.phase === 'locked'" @click="send({ kind: 'cooperate', operationId: operation.operationId, operationVersion: operation.operationVersion, phase: 'prepare' })">参与准备</button><button class="primary-button" :disabled="!canAct || operation.phase === 'locked'" @click="send({ kind: 'cooperate', operationId: operation.operationId, operationVersion: operation.operationVersion, phase: 'ready' })">我已就位</button><button class="text-button" :disabled="!canStop || operation.phase === 'locked'" @click="send({ kind: 'cooperate', operationId: operation.operationId, operationVersion: operation.operationVersion, phase: 'cancel' })">取消准备</button></div></article></section>
              <section v-if="projection.scene?.exits.length && (!hud || objectsOpen)" class="panel"><h2>场景出口</h2><button v-for="(exit, exitIndex) in projection.scene.exits" :key="exit.exitId" class="secondary-button" :disabled="!canAct || !exit.open" @click="traverseExit(exit.exitId)">{{ exit.open ? '走向出口' : '出口暂未开放' }} · {{ navigationAnchors.find(anchor => anchor.anchorId === exit.anchorId)?.label || '出口 ' + (exitIndex + 1) }}</button></section>
            </template>
            </aside>
            <SpatialReceipts v-if="!hud || receiptsOpen" :closable="hud" @close="closeReceipts" :actions="spatialState.actions" :online="online" data-keyboard-scope="panel" @query="spatialClient.query($event)" @retry="spatialClient.retry($event)" />
          </div>
        </div>
      </template>
    </template>
  </div>
</template>
