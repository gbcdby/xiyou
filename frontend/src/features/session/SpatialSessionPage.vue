<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { ActionV2, ItemViewV2, Position } from '../../../../game/spatial-types.ts';
import { api, authNotice, identity } from '../../state/app-store.ts';
import { enterSpatialSession, leaveSpatialSession, performSpatial, spatialClient, spatialNotice, spatialState, spatialStorageNotice } from '../../state/spatial-store.ts';
import SpatialMap from '../world/SpatialMap.vue';
import '../../styles-spatial.css';

const route = useRoute(); const sessionId = computed(() => String(route.params.sessionId || ''));
const projection = computed(() => spatialState.value.snapshot?.projection || null);
const online = computed(() => spatialState.value.connection === 'online');
const canAct = computed(() => online.value && spatialState.value.inputReady && projection.value?.phase === 'Running' && !projection.value.paused);
const selectedRef = ref(''); const recipient = ref(''); const message = ref(''); const channel = ref<'public' | 'team' | 'directed'>('public');
const copied = ref(false); const starting = ref(false); const startNotice = ref(''); const roomCount = ref<number | null>(null); let startNonce = '';
const selected = computed(() => projection.value ? [...projection.value.targets, ...projection.value.items, projection.value.self, ...projection.value.entities].find(value => value.entityRef === selectedRef.value) : null);
const target = computed(() => projection.value?.targets.find(value => value.entityRef === selectedRef.value));
const item = computed(() => projection.value?.items.find(value => value.entityRef === selectedRef.value));
const inventory = computed(() => projection.value?.items.filter(i => i.location.kind === 'held' && i.location.ownerRef === projection.value?.self.entityRef) || []);
const others = computed(() => projection.value?.entities.filter(e => e.entityRef !== projection.value?.self.entityRef && e.sceneId === projection.value?.self.sceneId) || []);
const visibleActions = computed(() => {
  const pending = spatialState.value.actions.filter(action => action.status === 'waiting' || action.status === 'unknown');
  const confirmed = spatialState.value.actions.filter(action => action.status === 'accepted' || action.status === 'rejected').slice(-8);
  return [...pending.reverse(), ...confirmed.reverse()];
});
const movementLabels = { accepted: '路线已受理', moving: '正在行走', arrived: '已到达', blocked: '路线受阻', cancelled: '已停步' };
const connectionNames = { idle: '尚未连接', connecting: '连接房间中', synchronizing: '同步授权场景中', online: '已连接', offline: '正在重连', forbidden: '当前无法访问房间' };
watch([sessionId, () => identity.value?.token], () => { leaveSpatialSession(); selectedRef.value = ''; recipient.value = ''; startNonce = ''; if (identity.value) enterSpatialSession(sessionId.value); }, { immediate: true });
watch(() => spatialState.value.snapshot?.viewId, () => { selectedRef.value = ''; recipient.value = ''; });
watch(() => projection.value?.phase, () => { if (projection.value?.phase === 'Lobby') void refreshPeople(); });
watch(others, people => { if (recipient.value && !people.some(p => p.entityRef === recipient.value)) recipient.value = ''; });
const lobbyPoll = setInterval(() => { if (projection.value?.phase === 'Lobby') void refreshPeople(); }, 2000);
onBeforeUnmount(() => { clearInterval(lobbyPoll); leaveSpatialSession(); });
async function refreshPeople() { try { roomCount.value = (await api.rooms()).find(room => room.sessionId === sessionId.value)?.playerCount ?? null; } catch { roomCount.value = null; } }
async function start() {
  if (!online.value || starting.value) return; starting.value = true; startNotice.value = ''; if (!startNonce) startNonce = crypto.randomUUID();
  try { await api.start(sessionId.value, startNonce); await spatialClient.sync(); startNotice.value = '开局请求已返回，等待服务器状态。'; }
  catch (error) { startNotice.value = error instanceof Error ? error.message : '开局尚未确认。'; } finally { starting.value = false; }
}
async function copy() { try { await navigator.clipboard.writeText(sessionId.value); copied.value = true; } catch { copied.value = false; } }
function move(position: Position) { selectedRef.value = ''; void performSpatial(() => spatialClient.move(position)); }
function send(action: ActionV2) { void performSpatial(() => spatialClient.send(action)); }
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
  const cooperation = projection.value?.cooperations.find(value => value.operationId === operationId);
  if (cooperation) { approach(object.entityRef, { kind: 'cooperate', operationId, operationVersion: cooperation.operationVersion, phase: 'prepare' }); return; }
  // 灰盒已声明此操作为合作；缺公开准备数据时不能猜造其版本或当作单人操作。
  if (operationId === 'lock-support') { spatialNotice.value = '协作准备信息尚未同步，请稍后查看。'; return; }
  approach(object.entityRef, { kind: 'interact', targetRef: object.entityRef, operationId, expectedTargetRevision: object.resourceRevision });
}
function speak() { if (!message.value.trim() || (channel.value === 'directed' && !recipient.value)) return; send({ kind: 'speak', text: message.value.trim(), channel: channel.value, recipientRefs: channel.value === 'directed' ? [recipient.value] : [] }); message.value = ''; }
function ownerName(reference: string) { const p = projection.value; return p?.self.entityRef === reference ? '你' : p?.entities.find(e => e.entityRef === reference)?.name || '当前视野外的持有人'; }
</script>

<template>
  <div class="spatial-page page-shell">
    <header class="spatial-heading"><div><RouterLink to="/" class="back-link">返回房间大厅</RouterLink><h1>高老庄 · 行走灰盒</h1><p>房间 <code>{{ sessionId }}</code><button class="text-button" @click="copy">{{ copied ? '已复制' : '复制房间号' }}</button></p></div><div class="spatial-connection" role="status">{{ connectionNames[spatialState.connection] }}<small v-if="projection">{{ projection.paused ? '场景已暂停' : '场景运行中' }}</small></div></header>
    <p v-if="spatialNotice || spatialStorageNotice || spatialState.message" class="notice warning" role="status">{{ spatialNotice || spatialStorageNotice || spatialState.message }}</p>
    <section v-if="!projection" class="panel session-empty"><h2>{{ !identity ? '先登录再进入房间' : connectionNames[spatialState.connection] }}</h2><p>{{ !identity ? authNotice || '返回大厅留下称呼，再加入伙伴的房间。' : '连接后会显示你当前能看见的场景。' }}</p><RouterLink v-if="!identity" to="/" class="primary-button">返回大厅</RouterLink><button v-else class="secondary-button" @click="spatialClient.reconnect()">重新连接</button></section>
    <template v-else>
      <section v-if="projection.phase === 'Lobby'" class="panel waiting-room"><p class="eyebrow">等待同行</p><h2>{{ roomCount === null ? '等待人数同步' : `${roomCount} 位旅伴已相聚` }}</h2><p>2–5 位真人可以开始。启程后，各自在自己的浏览器中控制角色。</p><button class="primary-button" :disabled="!online || starting || (roomCount !== null && roomCount < 2)" @click="start">{{ starting ? '正在开始…' : '开始同行（房主）' }}</button><p v-if="startNotice" role="status">{{ startNotice }}</p></section>
      <template v-else>
        <section v-if="projection.phase === 'Running' && !spatialState.inputReady" class="control-banner"><div><strong>当前为只读视角</strong><p>恢复本人控制后继续行走。另一处连接正在控制时，可明确选择接管。</p></div><div class="button-row"><button class="primary-button" :disabled="!online || spatialState.controlBusy" @click="performSpatial(() => spatialClient.control('resume'))">恢复本人控制</button><button class="secondary-button" :disabled="!online || spatialState.controlBusy" @click="performSpatial(() => spatialClient.control('take'))">明确接管此角色</button></div></section>
        <section v-if="projection.ending" class="panel"><h2>{{ projection.ending.title }}</h2><p>{{ projection.ending.summary }}</p></section>
        <div class="spatial-layout">
          <div class="spatial-main">
            <SpatialMap :snapshot="spatialState.snapshot!" :disabled="!canAct" :selected="selectedRef" @move="move" @select="selectedRef = $event" @stop="performSpatial(() => spatialClient.stop())" @settled="spatialClient.confirmDisplayedArrival($event)" />
            <div class="spatial-action-bar"><div><strong>{{ projection.self.name }}</strong><span data-testid="movement-status">{{ projection.movement ? movementLabels[projection.movement.status] : '尚未提交路线' }}</span><span v-if="spatialState.queuedAction">{{ spatialState.queuedAction }}</span></div><button class="secondary-button" :disabled="!online || !spatialState.inputReady" @click="performSpatial(() => spatialClient.stop())">停步 / 取消后续操作</button></div>
            <section class="panel spatial-dialogue"><h2>与身边人交谈</h2><div class="spatial-claims" aria-live="polite"><p v-if="!projection.claims.length" class="muted">当前还没有你获准听到的交谈。</p><p v-for="claim in projection.claims.slice(-20)" :key="claim.claimRef"><strong>{{ claim.speakerName }}</strong><small>{{ claim.channel === 'team' ? '队聊' : claim.channel === 'directed' ? '定向' : '当面' }} · 陈述</small><span>{{ claim.text }}</span></p></div><form class="spatial-speech" @submit.prevent="speak"><select v-model="channel" aria-label="交谈范围" :disabled="!canAct"><option value="public">当面说</option><option value="team">真人队聊</option><option value="directed">对选定对象说</option></select><select v-if="channel === 'directed'" v-model="recipient" aria-label="交谈对象" :disabled="!canAct"><option value="">选择对象</option><option v-for="person in others" :key="person.entityRef" :value="person.entityRef">{{ person.name }}</option></select><input v-model="message" aria-label="交谈内容" maxlength="2000" :disabled="!canAct" placeholder="说出你想让对方听到的话" /><button class="primary-button" :disabled="!canAct || !message.trim() || (channel === 'directed' && !recipient)">说话</button></form><p class="tiny muted">当面交谈由发生时距离与遮挡决定受众；真人队聊不会进入 NPC 知识。</p></section>
          </div>
          <aside class="spatial-sidebar">
            <section class="panel spatial-selection"><h2>{{ selected?.name || '当前可见对象' }}</h2><p v-if="!selected" class="muted">选择地图上的物件或人物，查看可用操作。</p><div v-if="selected && selected.entityRef !== projection.self.entityRef" class="button-row"><button class="secondary-button" :disabled="!canAct" @click="approach(selected.entityRef, { kind: 'inspect', targetRef: selected.entityRef })">走近并查看</button><button class="text-button" :disabled="!canAct" @click="send({ kind: 'inspect', targetRef: selected.entityRef })">在当前位置查看</button></div><template v-if="target"><dl class="spatial-fields"><template v-for="field in target.fields" :key="field.key"><dt>{{ field.label }}</dt><dd>{{ field.value === true ? '已满足' : field.value === false ? '未满足' : field.value ?? '尚无' }}</dd></template></dl><button v-for="operation in target.availableOperations" :key="operation" class="secondary-button" :disabled="!canAct" @click="targetOperation(operation)">{{ operation === 'lock-support' ? '走近合作固定支架' : '走近后执行操作' }}</button></template><template v-if="item"><p>{{ item.location.kind === 'ground' ? '放在地面' : `由${ownerName(item.location.ownerRef)}持有` }}</p><button v-if="item.location.kind === 'ground'" class="primary-button" :disabled="!canAct" @click="approach(item.entityRef, { kind: 'take_item', itemRef: item.entityRef, expectedItemRevision: item.resourceRevision })">走近并拿取</button><button v-if="item.publicBorrowable && item.reclaimHolderEpoch" class="secondary-button" :disabled="!canAct" @click="reclaim(item)">领回公用物</button></template><ul class="spatial-object-list"><li v-for="object in [...projection.targets, ...projection.items, ...others]" :key="object.entityRef"><button class="text-button" @click="selectedRef = object.entityRef">{{ object.name }}</button></li></ul></section>
            <section class="panel"><h2>行囊与交接</h2><p v-if="!inventory.length" class="muted">暂未携带可见物件。</p><label v-if="inventory.length" class="field-label" for="transfer-recipient">交接给</label><select v-if="inventory.length" id="transfer-recipient" v-model="recipient"><option value="">选择当前可见对象</option><option v-for="person in others" :key="person.entityRef" :value="person.entityRef">{{ person.name }}</option></select><ul class="spatial-inventory"><li v-for="held in inventory" :key="held.entityRef"><strong>{{ held.name }}</strong><div class="button-row"><button class="text-button" :disabled="!canAct" @click="put(held)">放在脚边</button><button class="text-button" :disabled="!canAct || !recipient || !held.transferable" @click="transfer(held)">交给对方</button></div></li></ul></section>
            <section v-if="projection.cooperations.length" class="panel"><h2>协作准备</h2><article v-for="operation in projection.cooperations" :key="operation.operationId" class="spatial-cooperation"><strong>{{ operation.phase === 'locked' ? '准备已锁定' : `${operation.readyCount}/${operation.requiredCount} 人就位` }}</strong><div class="button-row"><button v-for="(anchor, index) in operation.anchors" :key="index" class="text-button" :disabled="!canAct || operation.phase === 'locked'" @click="performSpatial(() => spatialClient.move(anchor))">前往位置{{ index + 1 }}</button></div><div class="button-row"><button class="secondary-button" :disabled="!canAct || operation.phase === 'locked'" @click="send({ kind: 'cooperate', operationId: operation.operationId, operationVersion: operation.operationVersion, phase: 'prepare' })">参与准备</button><button class="primary-button" :disabled="!canAct || operation.phase === 'locked'" @click="send({ kind: 'cooperate', operationId: operation.operationId, operationVersion: operation.operationVersion, phase: 'ready' })">我已就位</button><button class="text-button" :disabled="!online || !spatialState.inputReady || operation.phase === 'locked'" @click="send({ kind: 'cooperate', operationId: operation.operationId, operationVersion: operation.operationVersion, phase: 'cancel' })">取消准备</button></div></article></section>
            <section v-if="projection.scene?.exits.length" class="panel"><h2>场景出口</h2><button v-for="exit in projection.scene.exits" :key="exit.exitId" class="secondary-button" :disabled="!canAct || !exit.open" @click="performSpatial(() => spatialClient.traverseExit(exit.exitId))">{{ exit.open ? '走向出口' : '出口暂未开放' }}</button></section>
            <section v-if="projection.objectives.length" class="panel"><h2>当前事项</h2><ul class="spatial-objectives"><li v-for="objective in projection.objectives" :key="objective.objectiveId">{{ objective.status === 'completed' ? '✓' : objective.status === 'blocked' ? '待条件' : '待完成' }} · {{ objective.label }}</li></ul></section>
          </aside>
        </div>
        <section v-if="projection.observations.length" class="panel spatial-notebook"><h2>已获知的记录</h2><article v-for="observation in projection.observations" :key="observation.observationRef"><span class="eyebrow">{{ observation.category === 'WorldFact' ? '世界事实' : observation.category === 'Evidence' ? '证据' : '他人陈述' }}</span><p>{{ observation.statement }}</p><button v-if="observation.shareable" class="text-button" :disabled="!canAct || !recipient" @click="send({ kind: 'share_evidence', evidenceRef: observation.observationRef, recipientRefs: [recipient] })">分享给选定对象</button></article></section>
        <section v-if="spatialState.actions.length" class="panel spatial-receipts"><h2>动作确认</h2><ol><li v-for="action in visibleActions" :key="action.id" :data-action-id="action.id"><span :class="`receipt-${action.status}`">{{ action.status === 'accepted' ? '已确认' : action.status === 'rejected' ? '未执行' : action.status === 'unknown' ? '结果未知' : '等待确认' }}</span><p>{{ action.detail }}</p><div v-if="action.status === 'unknown'" class="button-row"><button class="text-button" :disabled="!online" @click="spatialClient.query(action.id)">查询结果</button><button class="text-button" :disabled="!online" @click="spatialClient.retry(action.id)">原样重试</button></div></li></ol></section>
      </template>
    </template>
  </div>
</template>
