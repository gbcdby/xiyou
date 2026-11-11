<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api, authNotice, enterSession, identity, leaveSession, localNotice, sendAction, sessionClient, sessionState, storageNotice } from '../../state/app-store.ts';
import { demoSnapshot } from '../../domain/demo.ts';
import { controlNames, roleNames } from '../../domain/world.ts';
import AppIcon from '../../components/AppIcon.vue';
import TeamPanel from '../character/TeamPanel.vue';
import EvidencePanel from '../character/EvidencePanel.vue';
import WorldPanel from '../world/WorldPanel.vue';
import InventoryPanel from '../inventory/InventoryPanel.vue';
import DialoguePanel from '../dialogue/DialoguePanel.vue';
import ObjectivePanel from '../objective/ObjectivePanel.vue';
import RecapPanel from '../recap/RecapPanel.vue';
import PendingActions from './PendingActions.vue';
import { RecapClient } from '../../network/recap-client.ts';
import type { RecapState } from '../../network/recap-client.ts';

const props = withDefaults(defineProps<{ demo?: boolean }>(), { demo: false });
const route = useRoute();
const example = demoSnapshot();
const now = ref(Date.now()); const starting = ref(false); const startNotice = ref(''); const copied = ref(false);
let startNonce = '';
const clock = setInterval(() => { now.value = Date.now(); }, 1000);
const snapshot = computed(() => props.demo ? example : sessionState.value.snapshot);
const projection = computed(() => snapshot.value?.projection || null);
const sessionId = computed(() => props.demo ? '静态界面示例' : String(route.params.sessionId || ''));
const connected = computed(() => !props.demo && sessionState.value.connection === 'online');
const recapState = shallowRef<RecapState>({ entries: [], status: 'idle', message: '', nextBeforeSeq: null, complete: false });
const recapClient = new RecapClient(api, state => { recapState.value = state; });
const canAct = computed(() => connected.value && projection.value?.phase === 'Running' && projection.value.self.canControl && projection.value.self.mode === 'HumanControlled');
const people = computed(() => projection.value?.characters.filter(person => person.mode !== 'CoreNPCControlled') || []);
const timeLeft = computed(() => {
  if (props.demo) return '示例快照';
  const deadline = projection.value?.deadlineAt;
  if (!deadline || projection.value?.phase !== 'Running') return '';
  const seconds = Math.max(0, Math.ceil((Date.parse(deadline) - now.value) / 1000));
  return seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '等待结束确认';
});
const roleHelp: Record<string, string> = { A: '比较结构痕迹，核对已有记录。', B: '核查库存，协调物资与实际交付。', C: '核对安全条件，办理通行许可。', D: '辨认痕迹，找回并交接材料。', E: '核验登记来源，澄清记录与证词。' };
const connectionNames = { idle: '尚未连接', connecting: '正在连接房间', synchronizing: '正在同步授权视图', online: '已连接', offline: '连接已断开', forbidden: '当前无法访问此房间' };

watch([() => props.demo, () => route.params.sessionId, () => identity.value?.token], () => {
  leaveSession(); startNonce = ''; startNotice.value = '';
  if (!props.demo && route.name === 'session' && typeof route.params.sessionId === 'string' && identity.value) enterSession(route.params.sessionId);
}, { immediate: true });
watch([() => identity.value?.userId, () => identity.value?.token, () => snapshot.value?.sessionId, () => snapshot.value?.viewId, () => snapshot.value?.snapshotSeq, () => projection.value?.phase, connected], () => {
  const current = snapshot.value;
  const phase = current?.projection.phase;
  if (props.demo || !identity.value || !connected.value || !current || (phase !== 'Finished' && phase !== 'Aborted')) { void recapClient.open(null); return; }
  void recapClient.open({ sessionId: current.sessionId, actorId: current.projection.self.characterId, throughSeq: current.snapshotSeq, phase, viewId: current.viewId, identity: identity.value.userId + ':' + identity.value.token });
}, { immediate: true, flush: 'sync' });
onBeforeUnmount(() => { recapClient.close(); clearInterval(clock); leaveSession(); });
async function start() {
  if (starting.value || !connected.value) return;
  starting.value = true; startNotice.value = '';
  if (!startNonce) startNonce = crypto.randomUUID();
  try { await api.start(sessionId.value, startNonce); startNotice.value = '开局请求已返回，等待房间状态确认。'; await sessionClient.sync(); }
  catch (error) { startNotice.value = error instanceof Error ? error.message : '开局结果待确认，请重新查询房间。'; }
  finally { starting.value = false; }
}
async function copyRoom() {
  try { await navigator.clipboard.writeText(sessionId.value); copied.value = true; } catch { copied.value = false; }
}
</script>

<template>
  <div class="session-page page-shell">
    <div v-if="demo" class="demo-banner" role="note"><AppIcon name="eye" :size="18" /><span><strong>界面演示</strong> · 静态授权投影，无真实联机，操作不会提交。</span><RouterLink to="/">去房间大厅<AppIcon name="arrow" :size="15" /></RouterLink></div>
    <div class="session-heading"><div><RouterLink class="back-link" to="/">房间大厅<AppIcon name="arrow" :size="13" /></RouterLink><h1>{{ projection?.phase === 'Lobby' ? '相聚，等一场同行' : '山间通路' }}<span class="chapter-tag">第一关</span></h1><div class="session-subtitle"><span v-if="!demo">房间 <code>{{ sessionId }}</code></span><span v-else>信任与证据 · 同行视角</span><button v-if="!demo" class="text-button" @click="copyRoom">{{ copied ? '已复制房间号' : '复制房间号' }}</button></div></div><div v-if="timeLeft" class="session-time"><AppIcon name="clock" :size="18" /><div><span>{{ demo ? '阅览模式' : '本局剩余' }}</span><strong>{{ timeLeft }}</strong></div></div></div>
    <template v-if="projection">
      <div v-if="!demo && (sessionState.message || localNotice || storageNotice)" class="notice warning" role="status"><AppIcon name="warn" :size="18" /><span>{{ localNotice || storageNotice || sessionState.message }}</span></div>
      <div v-if="!demo && projection.phase === 'Running' && !projection.self.canControl" class="control-banner"><AppIcon name="shield" /><div><strong>当前为只读视角</strong><p>{{ controlNames[projection.self.mode] }}。恢复本人控制后，可继续提交动作。</p></div><div class="button-row"><button class="primary-button" :disabled="!connected || sessionState.controlBusy" @click="sessionClient.control('resume')">恢复本人控制</button><button class="text-button" :disabled="!connected || sessionState.controlBusy" @click="sessionClient.control('take')">明确接管此角色</button></div></div>
      <section v-if="projection.phase === 'Lobby'" class="panel waiting-room"><span class="eyebrow">待启程</span><h2>{{ people.length }} 位旅伴已相聚</h2><p>2–5 人即可开始，人数决定开局的职责组合。<br />集齐后由房主开始，启程后保持本局身份。</p><div class="waiting-seats"><div v-for="index in 5" :key="index" class="waiting-seat" :class="{ occupied: people[index - 1] }"><span>{{ people[index - 1]?.name.slice(0, 1) || '＋' }}</span><strong>{{ people[index - 1]?.name || '待同行' }}</strong></div></div><button class="primary-button" :disabled="!connected || starting || people.length < 2 || people.length > 5" @click="start">{{ starting ? '正在请求开始…' : '开始同行（房主）' }}<AppIcon name="arrow" :size="17" /></button><p v-if="startNotice" class="small" role="status">{{ startNotice }}</p><p v-if="people.length < 2" class="tiny muted">再邀请至少一位伙伴。</p></section>
      <template v-else>
        <RecapPanel :projection="projection" :recap="demo ? undefined : recapState" @more="recapClient.loadMore()" />
        <PendingActions v-if="!demo" :actions="sessionState.actions" :disabled="!connected" @retry="id => sessionClient.retry(id)" @query="id => sessionClient.query(id)" />
        <div class="game-layout">
          <aside class="left-column"><section class="identity-card" aria-labelledby="self-heading"><span class="eyebrow">此刻，你是</span><div class="self-title"><span class="self-avatar">{{ projection.self.name.slice(0, 1) }}</span><div><h2 id="self-heading">{{ projection.self.name }}</h2><p>{{ projection.self.roles.map(role => roleNames[role] || role).join(' · ') }}</p></div></div><ul class="role-help"><li v-for="role in projection.self.roles" :key="role">{{ roleHelp[role] || '依照当前已获授权的职责参与同行。' }}</li></ul><div class="control-status"><AppIcon name="shield" :size="15" />{{ demo ? '演示视角 · 操作停用' : projection.self.canControl ? '由你控制' : controlNames[projection.self.mode] }}</div></section><ObjectivePanel :projection="projection" /><TeamPanel :projection="projection" /></aside>
          <div class="center-column"><WorldPanel :projection="projection" :disabled="!canAct" @action="sendAction" /><DialoguePanel :projection="projection" :disabled="!canAct" @action="sendAction" /></div>
          <aside class="right-column"><InventoryPanel :projection="projection" :disabled="!canAct" @action="sendAction" /><EvidencePanel :projection="projection" :disabled="!canAct" @action="sendAction" /><div class="quiet-note"><AppIcon name="leaf" :size="19" /><p>所见是此刻的世界，<br />所闻仍是他人的说法。</p></div></aside>
        </div>
      </template>
    </template>
    <section v-else class="panel session-empty" aria-live="polite"><span class="empty-icon"><AppIcon name="link" :size="30" /></span><h2>{{ !identity ? (authNotice ? '登录已失效，请重新进入大厅' : '先留下称呼，再与伙伴相见') : connectionNames[sessionState.connection] }}</h2><p>{{ !identity ? (authNotice || '返回房间大厅登录，然后用房间号加入。') : sessionState.message || '当前没有已确认的授权视图；连接后会显示你可以知道的内容。' }}</p><RouterLink v-if="!identity" to="/" class="primary-button">{{ authNotice ? '返回大厅重新登录' : '返回大厅' }}</RouterLink><button v-else class="secondary-button" @click="sessionClient.reconnect()">重新连接<AppIcon name="refresh" :size="16" /></button></section>
  </div>
</template>
