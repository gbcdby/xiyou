<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { ActionV2, ProjectionV2 } from '../../../../game/spatial-types.ts';
import { currentConsent, humanGaolaoOperations, proposeFollow, requestMeetingOrAppearance, requestPrivateItems, returnPublicItem, simpleGaolaoAction } from '../../domain/gaolao-actions.ts';
import GaolaoSourceComparison from './GaolaoSourceComparison.vue';
const props = defineProps<{ projection: ProjectionV2; selectedRef: string; personLabels: Record<string, string>; canAct: boolean; viewKey: string }>();
const emit = defineEmits<{ action: [action: ActionV2] }>();
const target = computed(() => [...props.projection.targets, props.projection.self, ...props.projection.entities].find(object => object.entityRef === props.selectedRef) || null);
const person = computed(() => props.projection.entities.find(person => person.entityRef === props.selectedRef && person.position && person.sceneId === props.projection.self.sceneId));
const chapter = computed(() => props.projection.chapter!);
const simple = computed(() => humanGaolaoOperations.filter(operation => target.value?.availableOperations?.includes(operation.operationId)));
const followDestinations = computed(() => chapter.value.destinations.filter(destination => destination.purpose === 'follow'));
const meetingDestinations = computed(() => chapter.value.destinations.filter(destination => destination.purpose === 'meeting'));
const leaders = computed(() => props.projection.entities.filter(person => person.sceneId === props.projection.self.sceneId && person.position));
const destination = ref(''); const leader = ref(''); const meeting = ref(''); const returnItem = ref(''); const privateItems = ref<string[]>([]);
const returned = computed(() => props.projection.items.filter(item => item.publicBorrowable && item.location.kind === 'held' && item.location.ownerRef === props.projection.self.entityRef));
const privateCandidates = computed(() => props.projection.items.filter(item => !item.publicBorrowable));
const comparisonTarget = computed(() => props.projection.targets.find(target => target.entityRef === props.selectedRef && target.availableOperations.includes('gz-compare-sources')) || null);
const followAction = computed(() => proposeFollow(props.projection, props.selectedRef, leader.value, destination.value, props.canAct));
const returnAction = computed(() => returnPublicItem(target.value, returnItem.value, props.projection, props.canAct));
const privateAction = computed(() => requestPrivateItems(target.value, privateItems.value, props.projection, props.canAct));
function reset() { destination.value = ''; leader.value = props.projection.self.entityRef; meeting.value = ''; returnItem.value = ''; privateItems.value = []; }
watch([() => props.viewKey, () => props.selectedRef], reset, { immediate: true });
watch(leaders, people => { if (!people.some(person => person.entityRef === leader.value)) leader.value = ''; });
watch(followDestinations, destinations => { if (!destinations.some(d => d.destinationId === destination.value)) destination.value = ''; });
watch(meetingDestinations, destinations => { if (!destinations.some(d => d.destinationId === meeting.value)) meeting.value = ''; });
watch(returned, items => { if (!items.some(item => item.entityRef === returnItem.value)) returnItem.value = ''; });
watch(privateCandidates, items => { privateItems.value = privateItems.value.filter(reference => items.some(item => item.entityRef === reference)); });
function send(action: ActionV2 | null) { if (action) emit('action', action); }
</script>

<template>
  <div v-if="target" class="gaolao-interaction">
    <div v-if="simple.length" class="button-row"><button v-for="operation in simple" :key="operation.operationId" class="secondary-button" :disabled="!canAct" @click="send(simpleGaolaoAction(target, operation.operationId, canAct))">{{ operation.label }}</button></div>
    <p v-if="target.availableOperations?.includes('gz-break-seal')" class="spatial-panel-intro">确认门内安全、固定支撑后，把已查明的情况传达给能处理铜封的人；由其本人行动。</p>
    <section v-if="person && person.entityRef !== projection.self.entityRef && projection.self.capabilities.includes('propose_follow') && followDestinations.length"><h3>提出带路安排</h3><p class="spatial-panel-intro">请本人确认目的地与带路者。改约会替换原许可，须重新得到本人回应。</p><label class="field-label" for="gaolao-follow-destination">随行目的地</label><select id="gaolao-follow-destination" v-model="destination" :disabled="!canAct"><option value="">选择安置地点</option><option v-for="place in followDestinations" :key="place.destinationId" :value="place.destinationId">{{ place.label }}</option></select><label class="field-label" for="gaolao-follow-leader">本次带路者</label><select id="gaolao-follow-leader" v-model="leader" :disabled="!canAct"><option value="">选择当前在线旅伴</option><option v-for="person in leaders" :key="person.entityRef" :value="person.entityRef">{{ personLabels[person.entityRef] || person.name }}{{ person.entityRef === projection.self.entityRef ? '（你）' : '' }}</option></select><p class="muted">带路者须是当前在线旅伴；是否接受由本人决定。</p><button class="primary-button" :disabled="!followAction" @click="send(followAction)">{{ currentConsent(chapter, selectedRef, 'follow') ? '重新提议随行安排' : '提出随行安排' }}</button></section>
    <section v-if="target.availableOperations?.some(operation => ['gz-request-appearance', 'gz-invite-meeting'].includes(operation))"><h3>本次会面安排</h3><label class="field-label" for="gaolao-meeting-destination">会面地点</label><select id="gaolao-meeting-destination" v-model="meeting" :disabled="!canAct"><option value="">选择会面地点</option><option v-for="place in meetingDestinations" :key="place.destinationId" :value="place.destinationId">{{ place.label }}</option></select><div class="button-row"><button v-if="target.availableOperations?.includes('gz-request-appearance')" class="secondary-button" :disabled="!requestMeetingOrAppearance(target, 'gz-request-appearance', meeting, chapter, canAct)" @click="send(requestMeetingOrAppearance(target, 'gz-request-appearance', meeting, chapter, canAct))">请求本次借貌</button><button v-if="target.availableOperations?.includes('gz-invite-meeting')" class="secondary-button" :disabled="!requestMeetingOrAppearance(target, 'gz-invite-meeting', meeting, chapter, canAct)" @click="send(requestMeetingOrAppearance(target, 'gz-invite-meeting', meeting, chapter, canAct))">邀请本人会面</button></div><p class="spatial-panel-intro">请求只说明这次地点与用途，不代替本人同意或实际到场。</p></section>
    <section v-if="target.availableOperations?.includes('gz-request-private-items')"><h3>请求私物处理许可</h3><p class="muted">选择你想请对方许可处理的可见物件；本次请求仍须核对物主与用途，并得到本人回应。许可不会改变物主。</p><p v-if="!privateCandidates.length" class="muted">当前没有可选择的私人物件。</p><label v-for="item in privateCandidates" :key="item.entityRef" class="gaolao-item-choice"><input v-model="privateItems" type="checkbox" :value="item.entityRef" :disabled="!canAct">{{ item.name }}</label><button class="secondary-button" :disabled="!privateAction" @click="send(privateAction)">请求整理选定私物</button></section>
    <section v-if="target.availableOperations?.includes('gz-return-public')"><h3>实际归还公用物</h3><label class="field-label" for="gaolao-return-item">本次归还物件</label><select id="gaolao-return-item" v-model="returnItem" :disabled="!canAct"><option value="">选择你携带的公用物</option><option v-for="item in returned" :key="item.entityRef" :value="item.entityRef">{{ item.name }}</option></select><button class="primary-button" :disabled="!returnAction" @click="send(returnAction)">归还选定公用物</button></section>
    <GaolaoSourceComparison v-if="comparisonTarget" :target="comparisonTarget" :observations="projection.observations" :can-act="canAct" :view-key="viewKey" @action="send" />
  </div>
</template>

<style scoped>
.gaolao-interaction section, .gaolao-interaction :deep(.gaolao-comparison) { margin-top: 20px; padding-top: 16px; border-top: 1px solid #cbb993; }.gaolao-interaction h3 { font-size: 18px; margin: 0 0 12px; }.gaolao-interaction select { margin-bottom: 12px; }.gaolao-interaction p { line-height: 1.75; overflow-wrap: anywhere; }.gaolao-item-choice { display: flex; align-items: center; min-height: 44px; gap: 10px; }.gaolao-item-choice input { width: 20px; height: 20px; }
</style>
