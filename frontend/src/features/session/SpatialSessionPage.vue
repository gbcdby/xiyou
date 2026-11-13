<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { ActionV2, ItemViewV2, Position } from '../../../../game/spatial-types.ts';
import { api, authNotice, identity } from '../../state/app-store.ts';
import { enterSpatialSession, leaveSpatialSession, performSpatial, spatialClient, spatialNotice, spatialState, spatialStorageNotice } from '../../state/spatial-store.ts';
import AppIcon from '../../components/AppIcon.vue';
import SpatialFieldList from '../../components/SpatialFieldList.vue';
import SpatialStatus from '../../components/SpatialStatus.vue';
import SpatialMap from '../world/SpatialMap.vue';
import SpatialReadingPane from './SpatialReadingPane.vue';
import SpatialReceipts from './SpatialReceipts.vue';
import SpatialInventoryPane from '../inventory/SpatialInventoryPane.vue';
import SpatialNotebookPane from '../character/SpatialNotebookPane.vue';
import SpatialDialoguePane from '../dialogue/SpatialDialoguePane.vue';
import { SpatialPersonLabels } from '../../domain/spatial-person-labels.ts';
import { spatialSummary } from '../../domain/spatial-summary.ts';
import { proposeEnding } from '../../domain/gaolao-actions.ts';
import { SpatialRecapClient } from '../../network/spatial-recap-client.ts';
import GaolaoChapterState from '../character/GaolaoChapterState.vue';
import GaolaoInteractionPanel from '../character/GaolaoInteractionPanel.vue';
import GaolaoRecapPanel from '../recap/GaolaoRecapPanel.vue';
import { useGaolaoHud } from './use-gaolao-hud.ts';
import '../../styles-spatial.css';
import '../../styles-art.css';

const route = useRoute();
const sessionId = computed(() => String(route.params.sessionId || ''));
const projection = computed(() => spatialState.value.snapshot?.projection || null);
const isGaolao = computed(() => projection.value?.reducerVersion === 'gaolao-world-v1' && Boolean(projection.value.chapter));
const hud = computed(() => isGaolao.value && projection.value?.phase !== 'Lobby');
const online = computed(() => spatialState.value.connection === 'online');
const canAct = computed(() => online.value && spatialState.value.inputReady && projection.value?.phase === 'Running' && !projection.value.paused);
const canStop = computed(() => online.value && spatialState.value.inputReady && projection.value?.phase === 'Running');
const selectedRef = ref(''); const recipient = ref(''); const message = ref(''); const channel = ref<'public' | 'team' | 'directed'>('public');
const copied = ref(false); const starting = ref(false); const startNotice = ref(''); const roomCount = ref<number | null>(null); let startNonce = '';
type ReadingPanel = 'inventory' | 'notebook' | 'dialogue' | 'chapter' | 'recap';
const reading = ref<ReadingPanel | null>(null);
const objectsOpen = ref(false); const receiptsOpen = ref(false);
let readingTrigger: HTMLElement | null = null;
const readingNames = { inventory: '行囊', notebook: '手记', dialogue: '交谈', chapter: '进展', recap: '回看' };
const readingTitles = { inventory: '行囊与交接', notebook: '已获知的记录', dialogue: '与身边人交谈', chapter: '本局进展与安排', recap: '这一程的结果' };
const recapClient = new SpatialRecapClient(api, state => { recapState.value = state; });
const recapState = shallowRef(recapClient.state);
const selected = computed(() => projection.value ? [...projection.value.targets, ...projection.value.items, projection.value.self, ...projection.value.entities].find(value => value.entityRef === selectedRef.value) : null);
const target = computed(() => projection.value?.targets.find(value => value.entityRef === selectedRef.value));
const item = computed(() => projection.value?.items.find(value => value.entityRef === selectedRef.value));
const inventory = computed(() => projection.value?.items.filter(i => i.location.kind === 'held' && i.location.ownerRef === projection.value?.self.entityRef) || []);
const others = computed(() => projection.value?.entities.filter(e => e.entityRef !== projection.value?.self.entityRef && e.sceneId === projection.value?.self.sceneId) || []);
const personLabeler = new SpatialPersonLabels();
const personLabels = ref<Record<string, string>>({});
const hasPersonMarkers = computed(() => projection.value ? [projection.value.self, ...others.value].some(person => personLabels.value[person.entityRef] && personLabels.value[person.entityRef] !== person.name) : false);
const currentSummary = computed(() => spatialSummary(projection.value));
const recentPreparations = computed(() => isGaolao.value
  ? projection.value?.chapter?.progress.filter(field => field.value === true && field.label !== projection.value?.chapter?.progress.at(-1)?.label).slice(-2).map((field, index) => ({ objectiveId: String(index), label: field.label })) || []
  : projection.value?.objectives.filter(o => o.status === 'completed').slice(-2) || []);
const duties = { A: '迎客联络', B: '内院照应', C: '木作帮手', D: '灶房帮手', E: '庄外引路' };
const ownDuties = computed(() => projection.value?.chapter?.responsibilities.map(duty => duties[duty]).join('、') || '同行旅伴');
const unknownCount = computed(() => spatialState.value.actions.filter(action => action.status === 'waiting' || action.status === 'unknown').length);
const movementLabels = { accepted: '路线已受理', moving: '正在行走', arrived: '已到达', blocked: '路线受阻', cancelled: '已停步' };
const connectionNames = { idle: '尚未连接', connecting: '连接房间中', synchronizing: '同步授权场景中', online: '已连接', offline: '正在重连', forbidden: '当前无法访问房间' };
const followLabels = { proposed: '等待本人回应', accepted: '本人已接受安排，尚未启程', following: '正在随行', paused: '随行暂停，须重新确认安排', arrived: '已到达，等本人确认安置', settled: '本人已确认安置', withdrawn: '本次许可已撤回', cancelled: '这次随行已取消' };
const currentFollow = computed(() => projection.value?.chapter?.follows.find(follow => ['proposed', 'accepted', 'following', 'paused', 'arrived'].includes(follow.status)) || null);
const hudRoot = ref<HTMLElement | null>(null);
const mapView = ref<InstanceType<typeof SpatialMap> | null>(null);
const hudPanelKind = computed(() => receiptsOpen.value ? 'receipts' : reading.value || (objectsOpen.value ? 'objects' : selected.value ? 'action' : null));
const { mapGeometry, panelPlacement, followPlacement, panelStyle, followStyle, cameraArea } = useGaolaoHud(hudRoot, hud, hudPanelKind, computed(() => Boolean(currentFollow.value)), computed(() => projection.value?.self.sceneId === 'gaolao-village-road'));

const condensedTitle = computed(() => reading.value ? readingNames[reading.value] : receiptsOpen.value ? '动作确认' : '对象操作');
const spaceNotice = computed(() => hud.value && ((hudPanelKind.value && !panelPlacement.value.rect) || (currentFollow.value && !followPlacement.value.rect)) ? '浮卡已为人物暂收，可回到角色后继续。' : '');
function restoreHudFocus() { mapView.value?.returnToSelf(); }
function closeHudPanel() { if (reading.value) closeReading(); else if (receiptsOpen.value) receiptsOpen.value = false; else closeObjects(); }

function clearAuthorizedInput() {
  selectedRef.value = ''; recipient.value = ''; message.value = ''; channel.value = 'public'; reading.value = null; readingTrigger = null;
  objectsOpen.value = false; receiptsOpen.value = false;
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
watch([() => spatialState.value.snapshot?.viewId, projection], ([view, value]) => {
  personLabels.value = personLabeler.update(view || null, value ? [value.self, ...others.value].filter(person => person.position !== null) : []);
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

async function openReading(panel: ReadingPanel, event: MouseEvent) {
  if (reading.value === panel) { closeReading(); return; }
  objectsOpen.value = false; receiptsOpen.value = false;
  readingTrigger = event.currentTarget as HTMLElement; reading.value = panel;
  await nextTick(); document.getElementById('spatial-reading-title')?.focus({ preventScroll: true });
}
function closeReading() {
  reading.value = null;
  const trigger = readingTrigger; readingTrigger = null;
  void nextTick(() => { if (trigger?.isConnected) trigger.focus({ preventScroll: true }); });
}
function escape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.isComposing || event.repeat) return;
  if (reading.value) { event.preventDefault(); event.stopPropagation(); closeReading(); }
  else if (receiptsOpen.value || objectsOpen.value) { event.preventDefault(); event.stopPropagation(); receiptsOpen.value = false; objectsOpen.value = false; }
  else if (canStop.value) { event.preventDefault(); event.stopPropagation(); stop(); }
}
function stop() { void performSpatial(() => spatialClient.stop()); }
async function showReceipts() {
  closeReading(); objectsOpen.value = false; receiptsOpen.value = true; await nextTick();
  document.getElementById('spatial-receipts')?.scrollIntoView({ block: 'start' });
  document.getElementById('spatial-receipts-heading')?.focus({ preventScroll: true });
}
async function showObjects() { closeReading(); receiptsOpen.value = false; objectsOpen.value = true; await nextTick(); document.getElementById('spatial-selection-heading')?.focus({ preventScroll: true }); }
function closeObjects() { objectsOpen.value = false; selectedRef.value = ''; recipient.value = ''; }
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
function select(reference: string) { if (selectedRef.value !== reference) { recipient.value = ''; spatialClient.cancelQueued(); } selectedRef.value = reference; objectsOpen.value = false; receiptsOpen.value = false; if (reading.value) closeReading(); }
function displayName(object: { entityRef: string; name: string }) { return personLabels.value[object.entityRef] || object.name; }
function send(action: ActionV2) { void performSpatial(() => spatialClient.send(action)); }
function requestEnding(scope: 'chapter' | 'recruitment') {
  const p = projection.value; if (!p?.chapter || !p.self.capabilities.includes('request_end')) return;
  const action = proposeEnding(p.chapter, scope, crypto.randomUUID(), canStop.value); if (action) send(action);
}
function approach(reference: string, action?: ActionV2) {
  const p = projection.value; if (!p) return;
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
  <div ref="hudRoot" class="spatial-page page-shell" :class="{ 'gaolao-scene-page': hud, 'hud-panel-open': hud && Boolean(hudPanelKind || currentFollow) }">
    <header v-if="hud" class="gaolao-heading">
      <div class="gaolao-chapter-name"><span class="gaolao-chapter-seal" aria-hidden="true">一</span><div><h1>高老庄</h1><p>{{ projection?.scene?.name || '同行记' }}</p></div></div>
      <button class="gaolao-party-strip" aria-label="查看本局队伍" @click="openReading('chapter', $event)"><span class="gaolao-party-icon" aria-hidden="true"><AppIcon name="group" :size="25" /></span><span>本局旅伴<strong>{{ roomCount === null ? '人数待同步' : roomCount + ' / 5 位成员' }}</strong></span><span class="gaolao-own-connection">{{ online ? '你的连接正常' : connectionNames[spatialState.connection] }}<small v-if="projection?.paused">Ⅱ 等待同伴</small></span></button>
    </header>
    <header v-else class="spatial-heading">
      <div><RouterLink to="/" class="back-link">返回房间大厅</RouterLink><h1>{{ isGaolao ? '高老庄 · 同行记' : '高老庄 · 行走灰盒' }}</h1><p>房间 <code>{{ sessionId }}</code><button class="text-button" @click="copy">{{ copied ? '已复制' : '复制房间号' }}</button></p></div>
      <div class="spatial-connection" role="status">{{ connectionNames[spatialState.connection] }}<small v-if="projection">{{ projection.paused ? 'Ⅱ 等待同伴，场景已暂停' : projection.phase === 'Running' ? '场景运行中' : projection.phase === 'Lobby' ? '等待启程' : '这一程已结束' }}</small></div>
    </header>
    <p v-if="spatialNotice || spatialStorageNotice || spatialState.message" class="notice warning" role="status">{{ spatialNotice || spatialStorageNotice || spatialState.message }}</p>
    <section v-if="!projection" class="panel session-empty"><h2>{{ !identity ? '先登录再进入房间' : connectionNames[spatialState.connection] }}</h2><p>{{ !identity ? authNotice || '返回大厅留下称呼，再加入伙伴的房间。' : '连接后会显示你当前能看见的场景。' }}</p><RouterLink v-if="!identity" to="/" class="primary-button">返回大厅</RouterLink><button v-else class="secondary-button" @click="spatialClient.reconnect()">重新连接</button></section>
    <template v-else>
      <section v-if="projection.phase === 'Lobby'" class="panel waiting-room"><p class="eyebrow">等待同行</p><h2>{{ roomCount === null ? '等待人数同步' : roomCount + ' 位旅伴已相聚' }}</h2><p>2–5 位真人可以开始。启程后，各自在自己的浏览器中控制角色。</p><button class="primary-button" :disabled="!online || starting || (roomCount !== null && roomCount < 2)" @click="start">{{ starting ? '正在开始…' : '开始同行（房主）' }}</button><p v-if="startNotice" role="status">{{ startNotice }}</p></section>
      <template v-else>
        <section v-if="projection.phase === 'Running' && !spatialState.inputReady" class="control-banner"><div><strong>当前为只读视角</strong><p>恢复本人控制后继续行走。另一处连接正在控制时，可明确选择接管。</p></div><div class="button-row"><button class="primary-button" :disabled="!online || spatialState.controlBusy" @click="performSpatial(() => spatialClient.control('resume'))">恢复本人控制</button><button class="secondary-button" :disabled="!online || spatialState.controlBusy" @click="performSpatial(() => spatialClient.control('take'))">明确接管此角色</button></div></section>
        <section v-if="projection.ending && !hud" class="panel spatial-ending"><h2>{{ projection.ending.title }}</h2><p>{{ projection.ending.summary }}</p></section>
        <div class="spatial-layout" :class="{ 'reading-open': reading }">
          <div class="spatial-main">
            <section v-if="currentSummary || recentPreparations.length" class="spatial-current-objective" :aria-label="currentSummary?.caption || '眼下事项'"><div><p class="eyebrow">{{ currentSummary?.caption || '眼下事项' }}</p><h2>{{ currentSummary?.title || '已知准备已留下' }}</h2></div><div class="spatial-known-preparations"><SpatialStatus v-for="objective in recentPreparations" :key="objective.objectiveId" :label="objective.label" tone="confirmed" /></div><button v-if="hud" class="text-button gaolao-progress-link" @click="openReading('chapter', $event)">进展 <AppIcon name="arrow" :size="15" /></button></section>
            <SpatialMap ref="mapView" :hud-notice="spaceNotice" :snapshot="spatialState.snapshot!" :disabled="!canAct" :selected="selectedRef" :person-labels="personLabels" :immersive="hud" :camera-area="cameraArea" @geometry="mapGeometry = $event" @move="move" @select="select" @stop="stop" @objects="showObjects" @settled="spatialClient.confirmDisplayedArrival($event)" />
            <div class="spatial-action-bar"><div><strong>{{ projection.self.name }}</strong><span v-if="hud" class="gaolao-own-duties">{{ ownDuties }}</span><span data-testid="movement-status">{{ projection.movement ? movementLabels[projection.movement.status] : '点地选择路线' }}</span><span v-if="spatialState.queuedAction">{{ spatialState.queuedAction }}</span></div><button class="secondary-button" aria-label="停步 / 取消后续操作" :disabled="!canStop" @click="stop"><span v-if="hud" aria-hidden="true">□</span>{{ hud ? '停步' : '停步 / 取消后续操作' }}</button><button v-if="hud" class="text-button gaolao-talk-button" @click="openReading('dialogue', $event)"><AppIcon name="chat" :size="19" />交谈</button></div>
            <div v-if="currentFollow" class="spatial-follow-strip" :class="{ 'hud-card-collapsed': hud && followPlacement.collapsed }" :style="followStyle" aria-label="当前随行安排"><div v-if="hud && followPlacement.collapsed" class="gaolao-condensed"><span>随行安排暂收</span><button class="text-button" @click="restoreHudFocus">回到角色</button><button class="text-button" @click="openReading('chapter', $event)">查看安排</button></div><div><p class="eyebrow">{{ personLabels[currentFollow.subjectRef] || '本次随行者' }} · 本次安排</p><h2>{{ followLabels[currentFollow.status] }}</h2><p>约定地点：{{ projection.chapter?.destinations.find(destination => destination.destinationId === currentFollow?.destinationId)?.label || '本次约定地点' }}</p><p v-if="currentFollow.reason" class="muted">{{ currentFollow.reason }}</p></div><div class="gaolao-follow-actions"><button v-if="currentFollow.leaderRef === projection.self.entityRef" class="secondary-button" :disabled="!canStop" @click="stop">停下我的脚步</button><button class="text-button" :disabled="!canAct || !others.some(person => person.entityRef === currentFollow!.subjectRef)" @click="select(currentFollow.subjectRef)">重新约定</button><button class="text-button" @click="openReading('chapter', $event)">查看随行安排</button></div></div>
            <div class="spatial-hud-footer">
              <p class="spatial-input-hint">点地行走 · 靠近后交互<span class="gaolao-hint-separator"> · </span><br>Esc 关闭阅读区 / 停步</p>
              <nav v-if="hud" class="spatial-tool-dock" aria-label="随身功能">
                <button aria-controls="spatial-reading-pane" :aria-expanded="reading === 'inventory'" @click="openReading('inventory', $event)"><AppIcon name="bag" :size="26" /><span>行囊</span></button>
                <button aria-controls="spatial-reading-pane" :aria-expanded="reading === 'notebook'" @click="openReading('notebook', $event)"><AppIcon name="book" :size="26" /><span>手记</span></button>
                <button aria-controls="spatial-reading-pane" :aria-expanded="reading === 'chapter'" @click="openReading('chapter', $event)"><AppIcon name="group" :size="26" /><span>队伍</span></button>
                <button aria-controls="spatial-reading-pane" :aria-expanded="reading === 'recap'" :disabled="!projection.ending" :title="projection.ending ? '查看本局授权过程' : '这一程结束后可回看'" @click="openReading('recap', $event)"><AppIcon name="clock" :size="26" /><span>回看</span></button>
              </nav>
              <nav v-else class="spatial-tool-dock" aria-label="随身功能">
                <button aria-controls="spatial-reading-pane" :aria-expanded="reading === 'inventory'" @click="openReading('inventory', $event)"><AppIcon name="bag" :size="26" /><span>行囊</span></button>
                <button aria-controls="spatial-reading-pane" :aria-expanded="reading === 'notebook'" @click="openReading('notebook', $event)"><AppIcon name="book" :size="26" /><span>手记</span></button>
                <button aria-controls="spatial-reading-pane" :aria-expanded="reading === 'dialogue'" @click="openReading('dialogue', $event)"><AppIcon name="chat" :size="26" /><span>交谈</span></button>
                <button v-if="isGaolao" aria-controls="spatial-reading-pane" :aria-expanded="reading === 'chapter'" @click="openReading('chapter', $event)"><AppIcon name="group" :size="26" /><span>进展</span></button>
                <button v-if="projection.ending" aria-controls="spatial-reading-pane" :aria-expanded="reading === 'recap'" @click="openReading('recap', $event)"><AppIcon name="clock" :size="26" /><span>回看</span></button>
              </nav>
            </div>
            <button v-if="unknownCount || (hud && spatialState.actions.length)" class="spatial-pending-link" @click="showReceipts"><SpatialStatus :label="unknownCount ? '待确认动作 ' + unknownCount + ' 条' : '动作确认'" :tone="unknownCount ? 'uncertain' : 'neutral'" /><span v-if="unknownCount">查询 / 原样重试</span><AppIcon name="arrow" :size="18" /></button>
          </div>
          <aside v-if="!hud || (!receiptsOpen && (reading || selected || objectsOpen))" class="spatial-sidebar" :class="{ 'hud-card-collapsed': hud && panelPlacement.collapsed }" :style="panelStyle" :data-reading-kind="reading || (objectsOpen ? 'objects' : 'action')">
            <div v-if="hud && panelPlacement.collapsed" class="gaolao-condensed" role="status"><span>{{ condensedTitle }}暂收</span><button class="text-button" @click="restoreHudFocus">回到角色</button><button class="icon-button" aria-label="关闭暂收浮卡" @click="closeHudPanel"><AppIcon name="x" /></button></div>
            <SpatialReadingPane v-if="reading" :title="readingTitles[reading]" :close-label="'关闭' + readingNames[reading]" @close="closeReading">
              <p v-if="hasPersonMarkers" class="spatial-panel-intro">人物编号与地图一致，仅用于本次视图定位。地图换选对象后，请重新选择收件人。</p><p v-if="selected && personLabels[selected.entityRef]" class="spatial-panel-intro">地图选中：<strong>{{ displayName(selected) }}</strong></p>
              <SpatialInventoryPane v-if="reading === 'inventory'" :inventory="inventory" :people="others" :person-labels="personLabels" :can-act="canAct" :recipient="recipient" @recipient="recipient = $event" @put="put" @transfer="transfer" />
              <SpatialNotebookPane v-else-if="reading === 'notebook'" :observations="projection.observations" :people="others" :person-labels="personLabels" :can-act="canAct" :recipient="recipient" @recipient="recipient = $event" @share="send({ kind: 'share_evidence', evidenceRef: $event.observationRef, recipientRefs: [recipient] })" />
              <SpatialDialoguePane v-else-if="reading === 'dialogue'" :claims="projection.claims" :people="others" :person-labels="personLabels" :can-act="canAct" :recipient="recipient" :message="message" :channel="channel" @recipient="recipient = $event" @message="message = $event" @channel="channel = $event" @speak="speak" />
              <template v-else-if="reading === 'chapter' && projection.chapter"><section v-if="hud" class="gaolao-room-details"><h3>本局旅伴</h3><p>{{ roomCount === null ? '成员人数尚未同步。' : '本局有 ' + roomCount + ' 位成员。' }}人数不代表此刻在线状况。</p><p>你：{{ projection.self.name }} · {{ ownDuties }}</p><p>房间 <code>{{ sessionId }}</code></p><button class="text-button" @click="copy">{{ copied ? '已复制' : '复制房间号' }}</button><RouterLink to="/" class="text-button">返回房间大厅</RouterLink></section><GaolaoChapterState :chapter="projection.chapter" :self="projection.self" :people="projection.entities" :items="projection.items" :person-labels="personLabels" :can-act="canAct" :can-end="canStop" @action="send" /><section v-if="projection.phase === 'Running' && projection.self.capabilities.includes('request_end')" class="gaolao-ending-choices"><h3>共同决定这一程</h3><p>每位当前在线旅伴都须明确确认。结束招徒尝试仍保留安置、归还与实际分别的工作；暂告一段会按已有事实结束本局。</p><p v-if="projection.chapter.endProposal?.status === 'pending'">已有一轮确认正在进行；更换提议会重新征求大家确认。</p><div class="button-row"><button class="secondary-button" :disabled="!canStop || (projection.chapter.endProposal?.scope === 'recruitment' && projection.chapter.endProposal.status !== 'invalidated')" @click="requestEnding('recruitment')">提议结束招徒</button><button class="secondary-button" :disabled="!canStop || (projection.chapter.endProposal?.scope === 'chapter' && projection.chapter.endProposal.status === 'pending')" @click="requestEnding('chapter')">提议暂告一段</button></div></section></template>
              <GaolaoRecapPanel v-else-if="reading === 'recap' && isGaolao" :state="recapState" :ending="projection.ending" @load="recapClient.loadMore()" />
              <template v-else-if="reading === 'recap' && projection.ending"><h3>{{ projection.ending.title }}</h3><p class="spatial-record-statement">{{ projection.ending.summary }}</p><SpatialFieldList :fields="projection.ending.facts || []" /></template>
            </SpatialReadingPane>
            <template v-else>
              <section class="panel spatial-selection"><button v-if="hud" class="icon-button gaolao-close-actions" aria-label="关闭对象区" @click="closeObjects"><AppIcon name="x" /></button><p class="eyebrow">眼前对象</p><h2 id="spatial-selection-heading" tabindex="-1">{{ objectsOpen && hud ? '附近的人与物' : selected ? displayName(selected) : '选择人物或物件' }}</h2><p v-if="!selected" class="muted">在地图上选择，或从下方找到当前可见对象。</p><div v-if="selected && selected.entityRef !== projection.self.entityRef" class="button-row"><button class="secondary-button" :disabled="!canAct" @click="approach(selected.entityRef, { kind: 'inspect', targetRef: selected.entityRef })">走近并查看</button><button class="text-button" :disabled="!canAct" @click="send({ kind: 'inspect', targetRef: selected.entityRef })">在当前位置查看</button></div><template v-if="target"><SpatialFieldList :fields="target.fields" /><button v-for="operation in isGaolao ? [] : target.availableOperations" :key="operation" class="secondary-button" :disabled="!canAct" @click="targetOperation(operation)">{{ operation === 'lock-support' ? '走近合作固定支架' : '走近后执行操作' }}</button></template><template v-if="item"><p class="spatial-item-location">{{ item.location.kind === 'ground' ? '放在地面' : '由' + ownerName(item.location.ownerRef) + '持有' }}</p><SpatialFieldList :fields="item.fields" /><button v-if="item.location.kind === 'ground'" class="primary-button" :disabled="!canAct" @click="approach(item.entityRef, { kind: 'take_item', itemRef: item.entityRef, expectedItemRevision: item.resourceRevision })">走近并拿取</button><button v-if="item.publicBorrowable && item.reclaimHolderEpoch" class="secondary-button" :disabled="!canAct" @click="reclaim(item)">领回公用物</button></template><GaolaoInteractionPanel v-if="isGaolao && projection.chapter" :projection="projection" :selected-ref="selectedRef" :person-labels="personLabels" :can-act="canAct" :view-key="spatialState.snapshot!.viewId" @action="send" /><ul v-if="!hud || objectsOpen" class="spatial-object-list"><li v-for="object in [...projection.targets, ...projection.items, ...others]" :key="object.entityRef"><button class="text-button" :aria-pressed="selectedRef === object.entityRef" @click="select(object.entityRef)">{{ displayName(object) }}</button></li><li v-for="anchor in projection.scene?.anchors || []" :key="'anchor:' + anchor.anchorId"><button class="text-button" :disabled="!canAct" @click="performSpatial(() => spatialClient.move(anchor.position, { anchorId: anchor.anchorId }))">前往{{ anchor.label }}</button></li></ul></section>
              <section v-if="projection.cooperations.length && (!hud || objectsOpen)" class="panel"><h2>协作准备</h2><article v-for="operation in projection.cooperations" :key="operation.operationId" class="spatial-cooperation"><SpatialStatus :label="operation.phase === 'locked' ? '准备已锁定' : operation.readyCount + '/' + operation.requiredCount + ' 人就位'" :tone="operation.phase === 'locked' ? 'confirmed' : 'pending'" /><div class="button-row"><button v-for="(anchor, index) in operation.anchors" :key="index" class="text-button" :disabled="!canAct || operation.phase === 'locked'" @click="performSpatial(() => spatialClient.move(anchor))">前往位置{{ index + 1 }}</button></div><div class="button-row"><button class="secondary-button" :disabled="!canAct || operation.phase === 'locked'" @click="send({ kind: 'cooperate', operationId: operation.operationId, operationVersion: operation.operationVersion, phase: 'prepare' })">参与准备</button><button class="primary-button" :disabled="!canAct || operation.phase === 'locked'" @click="send({ kind: 'cooperate', operationId: operation.operationId, operationVersion: operation.operationVersion, phase: 'ready' })">我已就位</button><button class="text-button" :disabled="!canStop || operation.phase === 'locked'" @click="send({ kind: 'cooperate', operationId: operation.operationId, operationVersion: operation.operationVersion, phase: 'cancel' })">取消准备</button></div></article></section>
              <section v-if="projection.scene?.exits.length && (!hud || objectsOpen)" class="panel"><h2>场景出口</h2><button v-for="(exit, exitIndex) in projection.scene.exits" :key="exit.exitId" class="secondary-button" :disabled="!canAct || !exit.open" @click="performSpatial(() => spatialClient.traverseExit(exit.exitId))">{{ exit.open ? '走向出口' : '出口暂未开放' }} · {{ projection.scene.anchors.find(anchor => anchor.anchorId === exit.anchorId)?.label || '出口 ' + (exitIndex + 1) }}</button></section>
            </template>
          </aside>
        </div>
        <SpatialReceipts v-if="!hud || receiptsOpen" :style="panelStyle" :class="{ 'hud-card-collapsed': hud && panelPlacement.collapsed }" :closable="hud" :condensed="hud && panelPlacement.collapsed" @restore="restoreHudFocus" @close="receiptsOpen = false" :actions="spatialState.actions" :online="online" @query="spatialClient.query($event)" @retry="spatialClient.retry($event)" />
      </template>
    </template>
  </div>
</template>
