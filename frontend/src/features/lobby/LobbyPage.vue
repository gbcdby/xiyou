<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { RoomSummary } from '../../domain/world.ts';
import { api, authNotice, identity, signIn, storageNotice } from '../../state/app-store.ts';
import AppIcon from '../../components/AppIcon.vue';

const router = useRouter();
const name = ref(''); const roomId = ref('');
const busy = ref(false); const loadingRooms = ref(false); const rooms = ref<RoomSummary[]>([]);
const notice = ref(''); const roomNotice = ref(''); const serviceOnline = ref(false);
let createNonce = ''; let joinNonce = ''; let joinFor = '';
const contentVersion = import.meta.env.VITE_CONTENT_VERSION || 'trust-repair-fixture-v1';
const chapterMode = ref('gaolao');
const phaseNames = { Lobby: '等待同行', Running: '行程中', Finished: '已结束', Aborted: '已中止' };
const explain = (error: unknown) => error instanceof Error ? error.message : '请求未完成，请稍后再试。';
const compact = ref(false);
const activeTask = ref<'start' | 'rooms'>('start');
const startTab = ref<HTMLButtonElement>(); const roomsTab = ref<HTMLButtonElement>();
const roomWindow = ref<HTMLElement>(); const rowMeasure = ref<HTMLElement>();
const page = ref(1); const pageSize = ref(2);
const pageCount = computed(() => Math.max(1, Math.ceil(rooms.value.length / pageSize.value)));
const visibleRooms = computed(() => rooms.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value));
const feedback = computed(() => [
  { key: 'auth', label: '登录提示', message: authNotice.value, role: 'status' },
  { key: 'request', label: '请求未完成', message: notice.value, role: 'alert' },
  { key: 'storage', label: '保存提示', message: storageNotice.value, role: 'status' },
].filter(item => item.message));
const detailDialog = ref<HTMLDialogElement>();
const detail = ref<{ title: string; fields: { label: string; value: string }[] }>();
let layoutObserver: ResizeObserver | undefined;
let compactQuery: MediaQueryList | undefined;

function measureRooms() {
  if (!roomWindow.value || !rowMeasure.value || !roomWindow.value.clientHeight) return;
  const rowHeight = rowMeasure.value.getBoundingClientRect().height;
  if (!rowHeight) return;
  const capacity = Math.max(1, Math.floor(roomWindow.value.getBoundingClientRect().height / rowHeight));
  if (capacity === pageSize.value) return;
  const firstRoom = (page.value - 1) * pageSize.value;
  const requestedRoom = rooms.value.findIndex(room => room.sessionId === joinFor);
  // 失败提示改变容量时，保留刚操作的房间，便于用同一标识重试。
  const anchor = requestedRoom >= firstRoom && requestedRoom < firstRoom + pageSize.value ? requestedRoom : firstRoom;
  pageSize.value = capacity;
  page.value = Math.min(pageCount.value, Math.floor(anchor / capacity) + 1);
}
function syncCompact() {
  compact.value = compactQuery?.matches ?? false;
  void nextTick(measureRooms);
}
function selectTask(task: 'start' | 'rooms', focus = false) {
  activeTask.value = task;
  void nextTick(() => { measureRooms(); if (focus) (task === 'start' ? startTab : roomsTab).value?.focus(); });
}
function tabKey(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  selectTask(event.key === 'Home' ? 'start' : event.key === 'End' ? 'rooms' : activeTask.value === 'start' ? 'rooms' : 'start', true);
}
async function showDetails(title: string, fields: { label: string; value: string }[]) {
  detail.value = { title, fields };
  await nextTick();
  detailDialog.value?.showModal();
}
function showRoom(room: RoomSummary) {
  void showDetails('房间详情', [
    { label: '房间名称', value: room.name }, { label: '房间号', value: room.sessionId },
    { label: '行程', value: room.protocolCapability === 'spatial-v2' ? '行走场景' : '山间通路' },
    { label: '同行状态', value: `${phaseNames[room.phase]} · ${room.playerCount} / 5 位旅伴` },
  ]);
}
async function showStart() {
  selectTask('start');
  await nextTick();
  document.getElementById('guest-name')?.focus();
}
watch(pageCount, count => { page.value = Math.min(page.value, count); });
watch(identity, current => { if (!current) selectTask('start'); });

async function refresh() {
  if (loadingRooms.value) return;
  loadingRooms.value = true; roomNotice.value = '';
  try { rooms.value = await api.rooms(); serviceOnline.value = true; }
  catch (error) { serviceOnline.value = false; roomNotice.value = explain(error); rooms.value = []; }
  finally { loadingRooms.value = false; }
}
async function login() {
  if (busy.value || !name.value.trim()) return;
  busy.value = true; notice.value = '';
  try { await signIn(name.value); await refresh(); }
  catch (error) { notice.value = explain(error); }
  finally { busy.value = false; }
}
async function join(sessionId: string, knownCapability?: 'region-v1' | 'spatial-v2') {
  if (!identity.value || busy.value || !sessionId.trim()) return;
  busy.value = true; notice.value = '';
  const id = sessionId.trim();
  if (joinFor !== id) { joinFor = id; joinNonce = crypto.randomUUID(); }
  try { const knownRoom = rooms.value.find(room => room.sessionId === id); const member = knownCapability === 'region-v1' || (knownRoom && !knownRoom.protocolCapability) ? { ...await api.join(id, joinNonce), protocolCapability: 'region-v1' } : await api.joinCompatible(id, joinNonce); joinNonce = ''; joinFor = ''; await router.push({ name: member.protocolCapability === 'spatial-v2' ? 'spatial-session' : 'session', params: { sessionId: member.sessionId } }); }
  catch (error) { notice.value = explain(error); }
  finally { busy.value = false; }
}
async function create() {
  if (!identity.value || busy.value) return;
  busy.value = true; notice.value = '';
  if (!createNonce) createNonce = crypto.randomUUID();
  try {
    const room = chapterMode.value === 'gaolao' ? await api.createSpatial(createNonce, import.meta.env.VITE_GAOLAO_CONTENT_VERSION || 'gaolaozhuang-scene-v3') : chapterMode.value === 'spatial' ? await api.createSpatial(createNonce, import.meta.env.VITE_SPATIAL_CONTENT_VERSION || 'spatial-graybox-v2') : await api.create(createNonce, contentVersion);
    busy.value = false; await join(room.sessionId, chapterMode.value === 'region' ? 'region-v1' : 'spatial-v2');
    if (!notice.value) createNonce = '';
  } catch (error) { notice.value = explain(error); }
  finally { busy.value = false; }
}
onMounted(() => {
  compactQuery = window.matchMedia('(max-width: 900px)');
  compactQuery.addEventListener('change', syncCompact);
  syncCompact();
  layoutObserver = new ResizeObserver(measureRooms);
  if (roomWindow.value) layoutObserver.observe(roomWindow.value);
  if (rowMeasure.value) layoutObserver.observe(rowMeasure.value);
  void refresh();
});
onBeforeUnmount(() => { layoutObserver?.disconnect(); compactQuery?.removeEventListener('change', syncCompact); });
</script>

<template>
  <div class="lobby-page lobby-redesign page-shell">
      <section class="lr-scene" aria-labelledby="lobby-heading">
        <img class="lr-scene-art" src="/assets/gaolaozhuang/scenes/courtyard.png" alt="" fetchpriority="high" draggable="false" />
        <div class="lr-scene-copy">
          <p class="lr-eyebrow"><span class="lr-rule" />第一回 · 同行记</p>
          <h1 id="lobby-heading">高老庄<span class="lr-title-seal" aria-hidden="true">西行</span></h1>
          <p class="lr-scene-story">先救出被困的人，再听清各自的意愿。</p>
          <div class="lr-chapter-traits">
            <span><AppIcon name="group" :size="17" />2–5 位旅伴</span>
            <span><AppIcon name="book" :size="17" />协作查证</span>
          </div>
        </div>
        <div class="lr-scene-footer">
          <span>章节场景预览</span>
          <button type="button" class="lr-text-button" @click="showDetails('高老庄 · 同行记', [{ label: '章节介绍', value: '先救出被困的人，再听清各自的意愿。同行与分别，由实际行动留下结果。' }, { label: '同行方式', value: '2–5 位旅伴分担救援、查证与联络。人物的许可和去留须由本人确认。' }, { label: '同行约定', value: '每位旅伴只看见自己有权知道的事。听到的说法，需要行动与证据来核对。' }])">章节介绍<AppIcon name="book" :size="15" /></button>
        </div>
      </section>

      <div v-if="compact" class="lr-task-tabs" role="tablist" aria-label="大厅任务" @keydown="tabKey">
        <button id="lobby-tab-start" ref="startTab" type="button" role="tab" aria-controls="lobby-start" :aria-selected="activeTask === 'start'" :tabindex="activeTask === 'start' ? 0 : -1" @click="selectTask('start')">开始同行</button>
        <button id="lobby-tab-rooms" ref="roomsTab" type="button" role="tab" aria-controls="lobby-rooms" :aria-selected="activeTask === 'rooms'" :tabindex="activeTask === 'rooms' ? 0 : -1" @click="selectTask('rooms')">寻找房间<span v-if="serviceOnline">{{ rooms.length }}</span></button>
      </div>

      <section id="lobby-start" v-show="!compact || activeTask === 'start'" class="lr-entry" :role="compact ? 'tabpanel' : undefined" :aria-labelledby="compact ? 'lobby-tab-start' : 'entry-heading'">
        <div class="lr-entry-masthead"><p class="lr-eyebrow">行前小笺</p><span class="lr-paper-seal" aria-hidden="true">行</span></div>
        <template v-if="!identity">
          <h2 id="entry-heading" class="lr-entry-title">留个名字，就此同行。</h2>
          <p class="lr-entry-copy">登录后即可创建或加入房间。</p>
          <form class="lr-name-form" @submit.prevent="login">
            <label class="field-label" for="guest-name">你的称呼</label>
            <input id="guest-name" v-model="name" maxlength="24" autocomplete="nickname" placeholder="例如：青禾" required :disabled="busy" />
            <button class="primary-button wide-button lr-primary" :disabled="busy || !name.trim()">{{ busy ? '正在连接…' : '以此名同行' }}<AppIcon name="arrow" :size="18" /></button>
          </form>
          <p class="lr-entry-note"><AppIcon name="leaf" :size="15" />以一名相识，与众人同行。</p>
        </template>
        <template v-else>
          <h2 id="entry-heading" class="lr-entry-title lr-welcome">准备好同行了吗？</h2>
          <button type="button" class="lr-identity lr-text-button" @click="showDetails('同行身份', [{ label: '你的称呼', value: identity.name }])"><AppIcon name="leaf" :size="15" /><span>{{ identity.name }}</span><small>已登录</small></button>
          <div class="lr-chapter-choice">
            <label class="field-label" for="chapter-mode">选择行程</label>
            <select id="chapter-mode" v-model="chapterMode" :disabled="busy" @change="createNonce = ''" class="chapter-select">
              <option value="gaolao">高老庄 · 同行记</option>
              <option value="spatial">行走练习 · 灰盒</option>
              <option value="region">山间通路 · 旧版玩法</option>
            </select>
            <p class="lr-mode-note" v-if="chapterMode === 'gaolao'">2–5 人分担救援、查证与联络。人物的许可和去留须由本人确认。</p>
            <p class="lr-mode-note" v-else-if="chapterMode === 'spatial'">练习行走、交接和合作，不含完整故事。</p>
          </div>
          <button class="primary-button wide-button lr-primary" :disabled="busy" @click="create"><AppIcon name="group" :size="18" />{{ busy ? '请求处理中…' : '创建同行房间' }}</button>
          <div class="lr-form-divider"><span>已有房间号</span></div>
          <form class="join-form lr-join-form" @submit.prevent="join(roomId)">
            <label class="field-label" for="room-id">房间号</label>
            <div class="lr-input-row"><input id="room-id" v-model="roomId" maxlength="128" placeholder="输入伙伴发来的房间号" :disabled="busy" required /><button class="secondary-button" :disabled="busy || !roomId.trim()">加入</button></div>
          </form>
        </template>
        <div v-if="feedback.length" class="lr-feedback">
          <div v-for="item in feedback" :key="item.key" class="notice warning" :role="item.role"><AppIcon name="warn" :size="16" /><span>{{ item.message }}</span><button type="button" class="lr-text-button" :aria-label="`查看${item.label}详情`" @click="showDetails(item.label, [{ label: item.label, value: item.message }])">详情</button></div>
        </div>
      </section>

    <section id="lobby-rooms" v-show="!compact || activeTask === 'rooms'" class="lr-rooms" :role="compact ? 'tabpanel' : undefined" :aria-labelledby="compact ? 'lobby-tab-rooms' : 'rooms-heading'">
      <div class="lr-rooms-heading">
        <div><div class="lr-rooms-title"><h2 id="rooms-heading">寻找同行者</h2><span v-if="serviceOnline && !loadingRooms" class="lr-room-count">{{ rooms.length }} 间</span></div><p>与旅伴相见，由房主启程。</p></div>
        <button type="button" class="secondary-button lr-refresh" aria-label="刷新房间列表" :disabled="loadingRooms" @click="refresh"><AppIcon name="refresh" :size="16" :class="{ spinning: loadingRooms }" /><span>刷新</span></button>
      </div>
      <p v-if="serviceOnline && !loadingRooms && rooms.length && !identity" class="lr-login-hint"><button type="button" class="lr-text-button" @click="showStart">先留下称呼<AppIcon name="arrow" :size="15" /></button><span>再加入旅伴的房间。</span></p>
      <div v-if="compact && feedback.length" class="lr-feedback">
        <div v-for="item in feedback" :key="item.key" class="notice warning" :role="item.role"><AppIcon name="warn" :size="16" /><span>{{ item.message }}</span><button type="button" class="lr-text-button" :aria-label="`查看${item.label}详情`" @click="showDetails(item.label, [{ label: item.label, value: item.message }])">详情</button></div>
      </div>
      <div ref="roomWindow" class="lr-room-window">
      <span ref="rowMeasure" class="lr-row-measure" aria-hidden="true" />
      <div v-if="loadingRooms" class="lr-empty" role="status"><span class="lr-empty-icon"><AppIcon name="refresh" :size="29" class="spinning" /></span><div><h3>正在寻找房间</h3><p>等待服务返回当前房间列表。</p></div></div>
      <div v-else-if="!serviceOnline" class="lr-empty lr-offline">
        <span class="lr-empty-icon"><AppIcon name="link" :size="29" /></span>
        <div class="lr-empty-copy"><h3>暂未连上服务</h3><p>连通后才会显示真实房间。</p><button v-if="roomNotice" type="button" class="lr-text-button" @click="showDetails('连接提示', [{ label: '连接未完成', value: roomNotice }])">查看连接详情</button></div>
        <button type="button" class="secondary-button" @click="refresh">重新连接<AppIcon name="refresh" :size="15" /></button>
      </div>
      <ul v-else-if="rooms.length" class="lr-room-list">
        <li v-for="room in visibleRooms" :key="room.sessionId" class="lr-room-row" :data-room-id="room.sessionId">
          <img v-if="room.contentVersion?.startsWith('gaolaozhuang')" class="lr-room-art" src="/assets/gaolaozhuang/scenes/courtyard.png" alt="" loading="lazy" />
          <span v-else class="lr-room-art lr-room-symbol" aria-hidden="true"><AppIcon name="compass" :size="26" /></span>
          <div class="lr-room-identity"><h3><button type="button" class="lr-room-open" :aria-label="`查看房间详情：${room.name}`" @click="showRoom(room)"><span>{{ room.name }}</span><small><span class="lr-mobile-count">{{ room.playerCount }}/5 位</span><code>{{ room.sessionId }}</code><span>详情</span></small></button></h3></div>
          <div class="lr-room-seats"><span class="lr-seat-marks" aria-hidden="true"><i v-for="seat in 5" :key="seat" :class="{ occupied: seat <= room.playerCount }" /></span><span><strong>{{ room.playerCount }}</strong><span class="lr-seat-total"> / 5</span> 位旅伴</span></div>
          <div class="lr-room-phase"><span class="lr-phase" :data-phase="room.phase"><i aria-hidden="true" />{{ room.phase === 'Lobby' && room.playerCount >= 5 ? '已满员' : phaseNames[room.phase] }}</span></div>
          <div class="lr-room-action"><button type="button" class="secondary-button" :disabled="!identity || busy || (room.phase === 'Lobby' && room.playerCount >= 5)" @click="join(room.sessionId)">{{ room.phase === 'Lobby' ? '加入' : '进入' }}<AppIcon name="arrow" :size="16" /></button></div>
        </li>
      </ul>
      <div v-else class="lr-empty"><span class="lr-empty-icon"><AppIcon name="leaf" :size="29" /></span><div><h3>等一位发起同行的人</h3><p>当前还没有房间。可以先创建一局，<br />把房间号分享给伙伴。</p></div></div>
      </div>
      <nav v-if="serviceOnline && rooms.length" class="lr-pagination" aria-label="房间分页">
        <button type="button" class="secondary-button" aria-label="上一页房间" :disabled="loadingRooms || page === 1" @click="page -= 1">上一页</button>
        <span role="status" aria-live="polite">第 {{ page }} / {{ pageCount }} 页<span class="lr-page-total"> · 共 {{ rooms.length }} 间</span></span>
        <button type="button" class="secondary-button" aria-label="下一页房间" :disabled="loadingRooms || page === pageCount" @click="page += 1">下一页</button>
      </nav>
      <div class="lr-room-footnote"><AppIcon name="shield" :size="15" /><p>所闻需要求证，所见各有边界。</p></div>
    </section>
    <dialog ref="detailDialog" class="lr-detail-dialog" aria-labelledby="lobby-detail-heading">
      <div class="lr-detail-heading"><h2 id="lobby-detail-heading">{{ detail?.title }}</h2><button type="button" class="secondary-button" autofocus @click="detailDialog?.close()">关闭</button></div>
      <dl><template v-for="field in detail?.fields" :key="field.label"><dt>{{ field.label }}</dt><dd>{{ field.value }}</dd></template></dl>
    </dialog>
  </div>
</template>

<style src="./lobby.css"></style>
