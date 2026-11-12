<script setup lang="ts">
import { ref } from 'vue';
import { validateSpatial } from '../../protocol/spatial.mjs';
import type { ActionV2, EndingViewV2, ProjectionV2 } from '../../game/spatial-types.ts';
import type { SpatialRecapState } from '../src/network/spatial-recap-client.ts';
import GaolaoChapterState from '../src/features/character/GaolaoChapterState.vue';
import GaolaoSourceComparison from '../src/features/character/GaolaoSourceComparison.vue';
import GaolaoRecapPanel from '../src/features/recap/GaolaoRecapPanel.vue';

// 此入口只挂载组件与受控 DTO，不提供高老庄规则、传输成功或完整剧情。
const r = (letter: string) => 'R' + letter.repeat(32);
const ending: EndingViewV2 = { title: '各走各路', summary: '救援与安置已确认，本局未达成同行。', endingCode: 'GZ-E02', facts: [{ key: 'safe', label: '翠兰已确认安置', value: true }, { key: 'join', label: '已入队', value: false }] };
const initial = validateSpatial('ProjectionV2', {
  protocolCapability: 'spatial-v2', chapterVersion: 'gaolao-test', mapVersion: 'map-test', variantId: 'test', contentVersion: 'gaolao-test', reducerVersion: 'gaolao-world-v1', phase: 'Running', sceneTimeMs: 100, paused: false,
  self: { entityRef: r('s'), name: '高才', appearanceEpoch: '0', sceneId: 'yard', position: { x: 100, y: 100 }, facing: 'S', controlEpoch: '2', canControl: true, capabilities: [], movementCommandHighWater: '0' },
  entities: [{ entityRef: r('a'), name: '翠兰', appearanceEpoch: '0', sceneId: 'yard', position: { x: 200, y: 100 }, facing: 'S' }, { entityRef: r('b'), name: '翠兰', appearanceEpoch: '1', sceneId: 'yard', position: { x: 300, y: 100 }, facing: 'S' }, { entityRef: r('t'), name: '唐僧', appearanceEpoch: '0', sceneId: 'yard', position: { x: 400, y: 100 }, facing: 'S' }, { entityRef: r('z'), name: '八戒', appearanceEpoch: '0', sceneId: 'yard', position: { x: 500, y: 100 }, facing: 'S' }, { entityRef: r('s'), name: '高才', appearanceEpoch: '0', sceneId: 'yard', position: { x: 100, y: 100 }, facing: 'S' }],
  items: [{ entityRef: r('i'), name: '公用门撑', location: { kind: 'held', ownerRef: r('s') }, resourceRevision: '3', transferable: true, publicBorrowable: true, fields: [] }],
  targets: [{ entityRef: r('m'), name: '前院会面点', sceneId: 'yard', position: { x: 100, y: 150 }, resourceRevision: '12', availableOperations: ['gz-compare-sources'], fields: [] }],
  scene: null, movement: null,
  observations: [{ observationRef: r('d'), category: 'Evidence', statement: '旧饭账记有来客到访前的留饭安排。', sourceSeq: '8', fields: [], shareable: true, source: { sourceRef: r('l'), kind: 'archive', label: '灶房旧饭账', beforeArrivalDays: 3, receivedSeq: '8' } }, { observationRef: r('e'), category: 'Claim', statement: '我见他几日前就来打听西行僧人。', sourceSeq: '9', fields: [], shareable: true, source: { sourceRef: r('w'), kind: 'testimony', label: '茶棚见证人的陈述', beforeArrivalDays: 2, receivedSeq: '9' } }],
  claims: [], cooperations: [], objectives: [], ending: null,
  chapter: { chapterId: 'gaolaozhuang', responsibilities: ['A', 'B', 'D'], progress: [{ key: 'safe', label: '翠兰已确认安置', value: false }],
    consents: [{ consentId: r('c'), subjectRef: r('a'), requesterRef: r('s'), purpose: 'follow', scope: { destinationId: 'safe-court', leaderRef: r('s') }, version: '3', status: 'accepted', sourceSeq: '6' }, { consentId: r('o'), subjectRef: r('s'), requesterRef: r('t'), purpose: 'meeting', scope: { destinationId: 'meeting' }, version: '4', status: 'proposed', sourceSeq: '8' }],
    follows: [{ followId: r('f'), subjectRef: r('a'), leaderRef: r('s'), destinationId: 'safe-court', planVersion: '2', consentId: r('c'), consentVersion: '3', status: 'arrived', reason: '已到约定地点，等本人确认安置。' }],
    decisions: [{ decisionId: r('j'), subjectRef: r('t'), purpose: 'recruitment', version: '0', status: 'undecided', sourceSeq: '0' }, { decisionId: r('k'), subjectRef: r('z'), purpose: 'membership', version: '1', status: 'deferred', sourceSeq: '9' }],
    destinations: [{ destinationId: 'safe-court', label: '前院安置处', sceneId: 'yard', position: { x: 200, y: 200 }, purpose: 'follow' }, { destinationId: 'meeting', label: '前院会面点', sceneId: 'yard', position: { x: 100, y: 150 }, purpose: 'meeting' }],
    endProposal: { proposalId: 'round-1', proposalVersion: '3', scope: 'recruitment', onlineMembershipVersion: '2', requiredCount: 2, confirmedCount: 1, ownConfirmed: false, status: 'pending' },
    publicItems: [{ itemRef: r('i'), name: '公用门撑', borrowed: true, returned: false }],
  },
});
const projection = ref<ProjectionV2 | null>(structuredClone(initial));
const viewKey = ref('view-one'); const canAct = ref(true);
const personLabels = ref({ [r('a')]: '翠兰 · 1号', [r('b')]: '翠兰 · 2号' });
const actions: ActionV2[] = []; let loads = 0;
const recap = ref<SpatialRecapState>({ entries: [{ entryRef: r('q'), eventSeq: '9', category: 'Claim', text: '我想先看看安排。', fields: [], speakerRef: r('b'), speakerName: '翠兰' }, { entryRef: r('v'), eventSeq: '8', category: 'Evidence', text: '已收到获准展示的材料。', fields: [] }], ending: structuredClone(ending), status: 'ready', message: '', nextBeforeSeq: '8', complete: false });
function record(action: ActionV2) { actions.push(structuredClone(action)); }
Object.assign(window, { gaolaoFixture: {
  actions: () => structuredClone(actions), loads: () => loads,
  settle() { const p = projection.value!; p.chapter!.follows[0]!.status = 'settled'; p.chapter!.follows[0]!.reason = '本人已确认安置。'; p.chapter!.progress[0]!.value = true; },
  withdraw() { const p = projection.value!; p.chapter!.consents[0]!.status = 'withdrawn'; p.chapter!.follows[0]!.status = 'withdrawn'; p.chapter!.follows[0]!.reason = '本次随行许可已撤回，已确认安置仍保留。'; },
  invalidateEnd() { projection.value!.chapter!.endProposal!.status = 'invalidated'; },
  decide(status: 'undecided' | 'declined' | 'deferred') { projection.value!.chapter!.decisions[1]!.status = status; },
  reveal() { projection.value!.entities[1]!.name = '孙悟空（借貌）'; projection.value!.chapter!.route = 'disguise'; personLabels.value[r('b')] = '孙悟空（借貌） · 2号'; },
  removeSource() { projection.value!.observations = projection.value!.observations.slice(0, 1); },
  sourceDuplicate() { projection.value!.observations[1]!.source!.sourceRef = projection.value!.observations[0]!.source!.sourceRef; },
  resetSources() { projection.value!.observations = structuredClone(initial.observations); },
  newView() { viewKey.value = 'view-two'; },
  recapError() { recap.value = { ...recap.value, status: 'error', message: '过程未能完整读取，可以重试。', complete: false }; },
  recapComplete() { recap.value = { ...recap.value, status: 'ready', message: '', nextBeforeSeq: null, complete: true }; },
  ending(code: 'GZ-E01' | 'GZ-E02' | 'GZ-E03') { const titles = { 'GZ-E01': '自愿同行', 'GZ-E02': '各走各路', 'GZ-E03': '暂告一段' }; recap.value.ending = { title: titles[code], summary: '这里只显示该次授权 DTO 给出的结果。', endingCode: code, facts: [{ key: 'safe', label: '翠兰已确认安置', value: true }, { key: 'join', label: '已入队', value: code === 'GZ-E01' }] }; },
  forbid() { projection.value = null; canAct.value = false; viewKey.value = ''; recap.value = { entries: [], ending: null, status: 'forbidden', message: '当前已不能读取本局过程，请重新核对访问资格。', nextBeforeSeq: null, complete: false }; },
} });
</script>

<template>
  <main class="spatial-page gaolao-fixture"><header><h1>高老庄组件隔离检查</h1><p>本页使用受控授权 DTO，只检查组件；没有连接完整章节规则。</p></header><div class="gaolao-fixture-grid"><section v-if="projection?.chapter" class="panel" aria-label="授权章节状态"><GaolaoChapterState :chapter="projection.chapter" :self="projection.self" :people="projection.entities" :items="projection.items" :person-labels="personLabels" :can-act="canAct" @action="record" /></section><section v-if="projection" class="panel" aria-label="授权来源比较"><GaolaoSourceComparison :target="projection.targets[0] || null" :observations="projection.observations" :can-act="canAct" :view-key="viewKey" @action="record" /></section><section class="panel" aria-label="授权历史复盘"><GaolaoRecapPanel :state="recap" :ending="ending" @load="loads++" /></section></div></main>
</template>

<style scoped>
.gaolao-fixture { padding: 24px; }.gaolao-fixture > header { margin-bottom: 24px; }.gaolao-fixture-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; align-items: start; }.gaolao-fixture .panel { min-width: 0; }@media (max-width: 900px) { .gaolao-fixture { padding: 16px; }.gaolao-fixture-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
