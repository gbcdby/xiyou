<script setup lang="ts">
import { onMounted, ref } from 'vue';
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
    const room = chapterMode.value === 'gaolao' ? await api.createSpatial(createNonce, import.meta.env.VITE_GAOLAO_CONTENT_VERSION || 'gaolaozhuang-scene-v2') : chapterMode.value === 'spatial' ? await api.createSpatial(createNonce, import.meta.env.VITE_SPATIAL_CONTENT_VERSION || 'spatial-graybox-v2') : await api.create(createNonce, contentVersion);
    busy.value = false; await join(room.sessionId, chapterMode.value === 'region' ? 'region-v1' : 'spatial-v2');
    if (!notice.value) createNonce = '';
  } catch (error) { notice.value = explain(error); }
  finally { busy.value = false; }
}
onMounted(refresh);
</script>

<template>
  <div class="lobby-page page-shell">
    <section class="lobby-hero" aria-labelledby="lobby-heading">
      <div><p class="eyebrow"><span class="short-rule" />西游 · 多人同行</p><h1 id="lobby-heading">同走一程山水，<br /><em>各寻一份真相。</em></h1><p class="hero-copy">与 2–5 位旅伴结伴而行。交换线索、交接物资，<br class="desktop-break" />一同查明来由，让受阻的通路重新开放。</p><div class="hero-details"><span><AppIcon name="group" :size="17" />2–5 位真人</span><span><AppIcon name="book" :size="17" />各自的线索与职责</span><span><AppIcon name="compass" :size="17" />共同的行程</span></div></div>
      <aside class="journey-note" aria-label="首关简介"><span class="note-index">01 / 同行记</span><div class="journey-art" aria-hidden="true"><i /><i /><i /><span>山</span></div><h2>高老庄 · 同行记</h2><p>先救出被困的人，再听清各自的意愿。<br />同行与分别，由实际行动留下结果。</p><div class="note-places"><span>院落</span><span>短路</span><span>2–5人</span></div></aside>
    </section>
    <div class="lobby-grid">
      <section class="panel entry-panel" aria-labelledby="entry-heading">
        <div class="section-heading"><h2 id="entry-heading"><AppIcon name="leaf" />{{ identity ? '准备好同行了吗' : '先留下你的称呼' }}</h2></div>
        <p v-if="authNotice" class="notice warning" role="status">{{ authNotice }}</p>
        <template v-if="!identity"><p class="section-intro">用这个名字与伙伴相见。登录后即可创建或加入房间。</p><form class="entry-form" @submit.prevent="login"><label class="field-label" for="guest-name">你的称呼</label><input id="guest-name" v-model="name" maxlength="24" autocomplete="nickname" placeholder="例如：青禾" required :disabled="busy" /><button class="primary-button wide-button" :disabled="busy || !name.trim()">{{ busy ? '正在连接…' : '以此名同行' }}<AppIcon name="arrow" :size="17" /></button></form></template>
        <template v-else><p class="welcome-name">{{ identity.name }}，你好。</p><p class="section-intro">新开一局，或用伙伴给你的房间号相聚。</p><label class="field-label" for="chapter-mode">选择行程</label><select id="chapter-mode" v-model="chapterMode" :disabled="busy" @change="createNonce = ''" class="chapter-select"><option value="gaolao">高老庄 · 同行记</option><option value="spatial">行走练习 · 灰盒</option><option value="region">山间通路 · 旧版玩法</option></select><p class="tiny muted" v-if="chapterMode === 'gaolao'">2–5 人分担救援、查证与联络。人物的许可和去留须由本人确认。</p><p class="tiny muted" v-else-if="chapterMode === 'spatial'">练习行走、交接和合作，不含完整故事。</p><button class="primary-button wide-button" :disabled="busy" @click="create"><AppIcon name="group" :size="18" />{{ busy ? '请求处理中…' : '创建同行房间' }}</button><div class="form-divider"><span>已有房间号</span></div><form class="join-form" @submit.prevent="join(roomId)"><label class="field-label" for="room-id">房间号</label><div class="input-button-row"><input id="room-id" v-model="roomId" maxlength="128" placeholder="输入伙伴发来的房间号" :disabled="busy" required /><button class="secondary-button" :disabled="busy || !roomId.trim()">加入</button></div></form></template>
        <p v-if="notice" class="notice warning" role="alert"><AppIcon name="warn" :size="18" />{{ notice }}</p>
        <p v-if="storageNotice" class="notice warning" role="status">{{ storageNotice }}</p>
        <RouterLink to="/demo" class="demo-link">先看看同行界面<AppIcon name="arrow" :size="16" /><small>静态示例 · 无真实联机</small></RouterLink>
      </section>
      <section class="panel rooms-panel" aria-labelledby="rooms-heading">
        <div class="section-heading"><div><h2 id="rooms-heading"><AppIcon name="group" />寻找同行者</h2><p class="section-intro">房间开始前可加入，人数齐备后由房主启程。</p></div><button class="icon-button" aria-label="刷新房间列表" :disabled="loadingRooms" @click="refresh"><AppIcon name="refresh" :class="{ spinning: loadingRooms }" /></button></div>
        <div v-if="loadingRooms" class="room-empty" role="status"><AppIcon name="refresh" :size="30" class="spinning" /><h3>正在寻找房间</h3><p>等待服务返回当前房间列表。</p></div>
        <div v-else-if="!serviceOnline" class="room-empty offline-empty"><span class="empty-icon"><AppIcon name="link" :size="28" /></span><h3>暂未连上服务</h3><p>{{ roomNotice }}</p><button class="secondary-button" @click="refresh">重新连接<AppIcon name="refresh" :size="15" /></button><span class="tiny muted">连通后才会显示真实房间。</span></div>
        <ul v-else-if="rooms.length" class="room-list"><li v-for="room in rooms" :key="room.sessionId"><span class="room-mark"><AppIcon name="compass" :size="23" /></span><div><h3>{{ room.name }}</h3><p>{{ room.protocolCapability === 'spatial-v2' ? '行走场景 · ' : '' }}{{ phaseNames[room.phase] }}<span>·</span>{{ room.playerCount }}/5 位旅伴</p><code>{{ room.sessionId }}</code></div><button class="secondary-button" :disabled="!identity || busy || (room.phase === 'Lobby' && room.playerCount >= 5)" @click="join(room.sessionId)">{{ room.phase === 'Lobby' ? '加入' : '进入' }}<AppIcon name="arrow" :size="15" /></button></li></ul>
        <div v-else class="room-empty"><span class="empty-icon"><AppIcon name="leaf" :size="29" /></span><h3>等一位发起同行的人</h3><p>当前还没有房间。可以先创建一局，<br />把房间号分享给伙伴。</p></div>
        <div class="room-footnote"><AppIcon name="shield" :size="17" /><p>每位旅伴只看见自己有权知道的事。<br />听到的说法，需要行动与证据来核对。</p></div>
      </section>
    </div>
  </div>
</template>
