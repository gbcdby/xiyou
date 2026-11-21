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
    const room = chapterMode.value === 'gaolao' ? await api.createSpatial(createNonce, import.meta.env.VITE_GAOLAO_CONTENT_VERSION || 'gaolaozhuang-scene-v3') : chapterMode.value === 'spatial' ? await api.createSpatial(createNonce, import.meta.env.VITE_SPATIAL_CONTENT_VERSION || 'spatial-graybox-v2') : await api.create(createNonce, contentVersion);
    busy.value = false; await join(room.sessionId, chapterMode.value === 'region' ? 'region-v1' : 'spatial-v2');
    if (!notice.value) createNonce = '';
  } catch (error) { notice.value = explain(error); }
  finally { busy.value = false; }
}
onMounted(refresh);
</script>

<template>
  <div class="lobby-page lobby-redesign page-shell">
    <div class="lr-opening">
      <section class="lr-scene" aria-labelledby="lobby-heading">
        <img class="lr-scene-art" src="/assets/gaolaozhuang/scenes/courtyard.png" alt="" fetchpriority="high" draggable="false" />
        <div class="lr-scene-copy">
          <p class="lr-eyebrow"><span class="lr-rule" />第一回 · 同行记</p>
          <h1 id="lobby-heading">高老庄<span class="lr-title-seal" aria-hidden="true">西行</span></h1>
          <p class="lr-scene-tagline">一程山水，一同求证。</p>
          <p class="lr-scene-story">先救出被困的人，再听清各自的意愿。<br />同行与分别，由实际行动留下结果。</p>
          <div class="lr-chapter-traits">
            <span><AppIcon name="group" :size="17" />2–5 位旅伴</span>
            <span><AppIcon name="book" :size="17" />协作查证</span>
          </div>
        </div>
        <div class="lr-scene-footer">
          <span class="lr-place-note"><AppIcon name="location" :size="15" />院落 · 庄外</span>
          <span>章节场景预览</span>
        </div>
      </section>

      <section class="lr-entry" aria-labelledby="entry-heading">
        <div class="lr-entry-masthead"><p class="lr-eyebrow">行前小笺</p><span class="lr-paper-seal" aria-hidden="true">行</span></div>
        <p v-if="authNotice" class="notice warning" role="status">{{ authNotice }}</p>
        <template v-if="!identity">
          <h2 id="entry-heading" class="lr-entry-title">留个名字，<br />就此同行。</h2>
          <p class="lr-entry-copy">用这个名字与伙伴相见。<br />登录后即可创建或加入房间。</p>
          <form class="lr-name-form" @submit.prevent="login">
            <label class="field-label" for="guest-name">你的称呼</label>
            <input id="guest-name" v-model="name" maxlength="24" autocomplete="nickname" placeholder="例如：青禾" required :disabled="busy" />
            <button class="primary-button wide-button lr-primary" :disabled="busy || !name.trim()">{{ busy ? '正在连接…' : '以此名同行' }}<AppIcon name="arrow" :size="18" /></button>
          </form>
          <p class="lr-entry-note"><AppIcon name="leaf" :size="15" />以一名相识，与众人同行。</p>
        </template>
        <template v-else>
          <h2 id="entry-heading" class="lr-entry-title lr-welcome">{{ identity.name }}，<br />准备好同行了吗？</h2>
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
        <p v-if="notice" class="notice warning" role="alert"><AppIcon name="warn" :size="18" />{{ notice }}</p>
        <p v-if="storageNotice" class="notice warning" role="status">{{ storageNotice }}</p>
      </section>
    </div>

    <section class="lr-rooms" aria-labelledby="rooms-heading">
      <div class="lr-rooms-heading">
        <div><div class="lr-rooms-title"><h2 id="rooms-heading">寻找同行者</h2><span v-if="serviceOnline && !loadingRooms" class="lr-room-count">{{ rooms.length }} 间房间</span></div><p>房间开始前可加入，人数齐备后由房主启程。</p></div>
        <button class="secondary-button lr-refresh" aria-label="刷新房间列表" :disabled="loadingRooms" @click="refresh"><AppIcon name="refresh" :size="16" :class="{ spinning: loadingRooms }" /><span>刷新房间</span></button>
      </div>
      <p v-if="serviceOnline && !loadingRooms && rooms.length && !identity" class="lr-login-hint"><AppIcon name="leaf" :size="15" />先在上方留下称呼，再加入旅伴的房间。</p>
      <div v-if="loadingRooms" class="lr-empty" role="status"><span class="lr-empty-icon"><AppIcon name="refresh" :size="29" class="spinning" /></span><div><h3>正在寻找房间</h3><p>等待服务返回当前房间列表。</p></div></div>
      <div v-else-if="!serviceOnline" class="lr-empty lr-offline">
        <span class="lr-empty-icon"><AppIcon name="link" :size="29" /></span>
        <div class="lr-empty-copy"><h3>暂未连上服务</h3><p>{{ roomNotice }}</p><small>连通后才会显示真实房间。</small></div>
        <button class="secondary-button" @click="refresh">重新连接<AppIcon name="refresh" :size="15" /></button>
      </div>
      <ul v-else-if="rooms.length" class="lr-room-list">
        <li v-for="room in rooms" :key="room.sessionId" class="lr-room-row">
          <img v-if="room.contentVersion?.startsWith('gaolaozhuang')" class="lr-room-art" src="/assets/gaolaozhuang/scenes/courtyard.png" alt="" loading="lazy" />
          <span v-else class="lr-room-art lr-room-symbol" aria-hidden="true"><AppIcon name="compass" :size="26" /></span>
          <div class="lr-room-identity"><h3>{{ room.name }}</h3><p>{{ room.protocolCapability === 'spatial-v2' ? '行走场景' : '山间通路' }}</p><code>{{ room.sessionId }}</code></div>
          <div class="lr-room-seats"><span class="lr-seat-marks" aria-hidden="true"><i v-for="seat in 5" :key="seat" :class="{ occupied: seat <= room.playerCount }" /></span><span><strong>{{ room.playerCount }}</strong><span class="lr-seat-total"> / 5</span> 位旅伴</span></div>
          <div class="lr-room-phase"><span class="lr-phase" :data-phase="room.phase"><i aria-hidden="true" />{{ phaseNames[room.phase] }}</span></div>
          <div class="lr-room-action"><button class="secondary-button" :disabled="!identity || busy || (room.phase === 'Lobby' && room.playerCount >= 5)" @click="join(room.sessionId)">{{ room.phase === 'Lobby' ? '加入' : '进入' }}<AppIcon name="arrow" :size="16" /></button><small v-if="room.phase === 'Lobby' && room.playerCount >= 5">已满员</small></div>
        </li>
      </ul>
      <div v-else class="lr-empty"><span class="lr-empty-icon"><AppIcon name="leaf" :size="29" /></span><div><h3>等一位发起同行的人</h3><p>当前还没有房间。可以先创建一局，<br />把房间号分享给伙伴。</p></div></div>
      <div class="lr-room-footnote"><AppIcon name="shield" :size="16" /><p>每位旅伴只看见自己有权知道的事。<span>听到的说法，需要行动与证据来核对。</span></p></div>
    </section>
  </div>
</template>

<style src="./lobby.css"></style>
