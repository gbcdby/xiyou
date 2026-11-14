<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { gaolaoPersonalProfile } from '../../../../protocol/spatial.mjs';
import type { ActionV2, PersonalPermissionTermV1, ProjectionV2 } from '../../../../game/spatial-types.ts';
import { currentConsent, currentPersonalRequest, describePersonalItems, humanGaolaoOperations, proposeFollow, requestMeetingOrAppearance, requestPersonalAppearance, requestPersonalItems, requestPrivateItems, returnPublicItem, simpleGaolaoAction } from '../../domain/gaolao-actions.ts';
import GaolaoSourceComparison from './GaolaoSourceComparison.vue';
const props = defineProps<{ projection: ProjectionV2; selectedRef: string; personLabels: Record<string, string>; canAct: boolean; viewKey: string }>();
const emit = defineEmits<{ action: [action: ActionV2] }>();
const target = computed(() => [...props.projection.targets, props.projection.self, ...props.projection.entities].find(object => object.entityRef === props.selectedRef) || null);
const person = computed(() => props.projection.entities.find(person => person.entityRef === props.selectedRef && person.position && person.sceneId === props.projection.self.sceneId));
const chapter = computed(() => props.projection.chapter!);
const personal = computed(() => Boolean(gaolaoPersonalProfile(props.projection)));
const personalItems = computed(() => personal.value && Boolean(target.value?.availableOperations?.includes('gz-describe-private-items')));
const simple = computed(() => humanGaolaoOperations.filter(operation => target.value?.availableOperations?.includes(operation.operationId)));
const followDestinations = computed(() => chapter.value.destinations.filter(destination => destination.purpose === 'follow'));
const meetingDestinations = computed(() => chapter.value.destinations.filter(destination => destination.purpose === 'meeting'));
const leaders = computed(() => props.projection.entities.filter(person => person.sceneId === props.projection.self.sceneId && person.position));
const destination = ref(''); const leader = ref(''); const meeting = ref(''); const returnItem = ref(''); const privateItems = ref<string[]>([]);
const appearanceTerm = ref<PersonalPermissionTermV1>('single_use'), privateTerm = ref<PersonalPermissionTermV1>('single_use');
const privateOptions = ref<string[]>([]), replaceAppearance = ref(false), replacePrivate = ref(false);
const privateOffer = computed(() => personalItems.value ? chapter.value.privateItemOffers?.find(offer => offer.subjectRef === props.selectedRef) ?? null : null);
const appearanceRequest = computed(() => currentPersonalRequest(props.projection, props.selectedRef, 'appearance'));
const privateRequest = computed(() => currentPersonalRequest(props.projection, props.selectedRef, 'private_items'));
const ownAppearance = computed(() => appearanceRequest.value?.request.lifecycle === 'open' && appearanceRequest.value.consent.requesterRef === props.projection.self.entityRef ? appearanceRequest.value : null);
const ownPrivate = computed(() => privateRequest.value?.request.lifecycle === 'open' && privateRequest.value.consent.requesterRef === props.projection.self.entityRef ? privateRequest.value : null);
const returned = computed(() => props.projection.items.filter(item => item.publicBorrowable && item.location.kind === 'held' && item.location.ownerRef === props.projection.self.entityRef));
const privateCandidates = computed(() => props.projection.items.filter(item => !item.publicBorrowable));
const comparisonTarget = computed(() => props.projection.targets.find(target => target.entityRef === props.selectedRef && target.availableOperations.includes('gz-compare-sources')) || null);
const followAction = computed(() => proposeFollow(props.projection, props.selectedRef, leader.value, destination.value, props.canAct));
const returnAction = computed(() => returnPublicItem(target.value, returnItem.value, props.projection, props.canAct));
const appearanceAction = computed(() => personal.value
  ? requestPersonalAppearance(target.value, meeting.value, appearanceTerm.value, props.projection, props.canAct, replaceAppearance.value ? ownAppearance.value?.request.consentId : undefined)
  : requestMeetingOrAppearance(target.value, 'gz-request-appearance', meeting.value, chapter.value, props.canAct));
const describeAction = computed(() => describePersonalItems(target.value, props.projection, props.canAct));
const privateAction = computed(() => personalItems.value
  ? requestPersonalItems(target.value, privateOffer.value?.offerRef ?? '', privateOptions.value, privateTerm.value, props.projection, props.canAct, replacePrivate.value ? ownPrivate.value?.request.consentId : undefined)
  : requestPrivateItems(target.value, privateItems.value, props.projection, props.canAct));
function reset() { destination.value = ''; leader.value = props.projection.self.entityRef; meeting.value = ''; returnItem.value = ''; privateItems.value = []; privateOptions.value = []; appearanceTerm.value = 'single_use'; privateTerm.value = 'single_use'; replaceAppearance.value = false; replacePrivate.value = false; }
watch([() => props.viewKey, () => props.selectedRef], reset, { immediate: true });
watch(leaders, people => { if (!people.some(person => person.entityRef === leader.value)) leader.value = ''; });
watch(followDestinations, destinations => { if (!destinations.some(d => d.destinationId === destination.value)) destination.value = ''; });
watch(meetingDestinations, destinations => { if (!destinations.some(d => d.destinationId === meeting.value)) meeting.value = ''; });
watch(returned, items => { if (!items.some(item => item.entityRef === returnItem.value)) returnItem.value = ''; });
watch(privateCandidates, items => { privateItems.value = privateItems.value.filter(reference => items.some(item => item.entityRef === reference)); });
watch(() => privateOffer.value?.offerRef, () => { privateOptions.value = []; });
watch(() => JSON.stringify(ownAppearance.value && [ownAppearance.value.request.consentId, ownAppearance.value.request.lifecycleVersion, ownAppearance.value.consent.version]), () => { replaceAppearance.value = false; });
watch(() => JSON.stringify(ownPrivate.value && [ownPrivate.value.request.consentId, ownPrivate.value.request.lifecycleVersion, ownPrivate.value.consent.version]), () => { replacePrivate.value = false; });
function send(action: ActionV2 | null) { if (action) emit('action', action); }
</script>

<template>
  <div v-if="target" class="gaolao-interaction">
    <div v-if="simple.length" class="button-row"><button v-for="operation in simple" :key="operation.operationId" class="secondary-button" :disabled="!canAct" @click="send(simpleGaolaoAction(target, operation.operationId, canAct))">{{ operation.label }}</button></div>
    <p v-if="target.availableOperations?.includes('gz-break-seal')" class="spatial-panel-intro">确认门内安全、固定支撑后，把已查明的情况传达给能处理铜封的人；由其本人行动。</p>
    <section v-if="person && person.entityRef !== projection.self.entityRef && projection.self.capabilities.includes('propose_follow') && followDestinations.length"><h3>提出带路安排</h3><p class="spatial-panel-intro">请本人确认目的地与带路者。改约会替换原许可，须重新得到本人回应。</p><label class="field-label" for="gaolao-follow-destination">随行目的地</label><select id="gaolao-follow-destination" v-model="destination" :disabled="!canAct"><option value="">选择安置地点</option><option v-for="place in followDestinations" :key="place.destinationId" :value="place.destinationId">{{ place.label }}</option></select><label class="field-label" for="gaolao-follow-leader">本次带路者</label><select id="gaolao-follow-leader" v-model="leader" :disabled="!canAct"><option value="">选择当前在线旅伴</option><option v-for="person in leaders" :key="person.entityRef" :value="person.entityRef">{{ personLabels[person.entityRef] || person.name }}{{ person.entityRef === projection.self.entityRef ? '（你）' : '' }}</option></select><p class="muted">带路者须是当前在线旅伴；是否接受由本人决定。</p><button class="primary-button" :disabled="!followAction" @click="send(followAction)">{{ currentConsent(chapter, selectedRef, 'follow') ? '重新提议随行安排' : '提出随行安排' }}</button></section>
    <section v-if="target.availableOperations?.some(operation => ['gz-request-appearance', 'gz-invite-meeting'].includes(operation))">
      <h3>本次会面安排</h3>
      <label class="field-label" for="gaolao-meeting-destination">会面地点</label>
      <select id="gaolao-meeting-destination" v-model="meeting" :disabled="!canAct"><option value="">选择会面地点</option><option v-for="place in meetingDestinations" :key="place.destinationId" :value="place.destinationId">{{ place.label }}</option></select>
      <template v-if="personal && target.availableOperations?.includes('gz-request-appearance')">
        <p class="spatial-panel-intro">请本人考虑由悟空在所选地点借貌查问、会面；本人仍留在自己的安置点。这不是代本人表达婚事、物权或承诺，接受后也须悟空自行行动。</p>
        <label class="field-label" for="gaolao-appearance-term">借貌期限意向</label>
        <select id="gaolao-appearance-term" v-model="appearanceTerm" :disabled="!canAct"><option value="single_use">仅这次安排</option><option value="reusable">询问能否以后沿用</option></select>
        <label v-if="ownAppearance" class="gaolao-item-choice"><input v-model="replaceAppearance" type="checkbox" :disabled="!canAct">明确替换我仍开放的借貌请求</label>
        <p v-if="ownAppearance" class="muted">改约会结束旧安排的可用权限，并以新请求重新询问本人。也可在“进展”中取消。</p>
      </template>
      <div class="button-row"><button v-if="target.availableOperations?.includes('gz-request-appearance')" class="secondary-button" :disabled="!appearanceAction" @click="send(appearanceAction)">{{ personal ? (replaceAppearance ? '替换并提出借貌询问' : '提出借貌询问') : '请求本次借貌' }}</button><button v-if="target.availableOperations?.includes('gz-invite-meeting')" class="secondary-button" :disabled="!requestMeetingOrAppearance(target, 'gz-invite-meeting', meeting, chapter, canAct)" @click="send(requestMeetingOrAppearance(target, 'gz-invite-meeting', meeting, chapter, canAct))">邀请本人会面</button></div>
      <p class="spatial-panel-intro">这是向本人提出的询问，尚未得到同意。收到动作确认后，请在“进展”查看本人实际回应；如需改问，请明确提出新请求。</p>
    </section>
    <section v-if="personalItems">
      <h3>询问本次私物取送</h3>
      <p class="spatial-panel-intro">先走近本人询问愿意说明的物件。清单只说明名目，不代表已经同意，也不说明物件现在在哪里。</p>
      <button class="secondary-button" :disabled="!describeAction" @click="send(describeAction)">{{ privateOffer ? '重新询问私物清单' : '请本人说明私物清单' }}</button>
      <template v-if="privateOffer">
        <p class="muted">选择这次要原样取送给本人的物件。可选一件或两件，每件各处理一次；不得拆阅或转交他人。</p>
        <label v-for="option in privateOffer.options" :key="option.optionRef" class="gaolao-item-choice"><input v-model="privateOptions" type="checkbox" :value="option.optionRef" :disabled="!canAct">{{ option.label }}</label>
        <label class="field-label" for="gaolao-private-term">私物期限意向</label>
        <select id="gaolao-private-term" v-model="privateTerm" :disabled="!canAct"><option value="single_use">仅这次安排</option><option value="reusable">询问能否以后沿用</option></select>
        <label v-if="ownPrivate" class="gaolao-item-choice"><input v-model="replacePrivate" type="checkbox" :disabled="!canAct">明确替换我仍开放的私物请求</label>
        <p v-if="ownPrivate" class="muted">改约须重新得到本人回应；已拿物件仍按原取得安排逐件归还，不随改约消失。</p>
        <button class="secondary-button" :disabled="!privateAction" @click="send(privateAction)">{{ replacePrivate ? '替换并提出私物取送询问' : '提出私物取送询问' }}</button>
        <p class="spatial-panel-intro">这是询问，尚未得到同意。请在“进展”查看本人回应；接受后仍须走到物件旁实际拿取。</p>
      </template>
    </section>
    <section v-else-if="target.availableOperations?.includes('gz-request-private-items')"><h3>请求私物处理许可</h3><p class="muted">选择你想请对方许可处理的可见物件；本次请求仍须核对物主与用途，并得到本人回应。许可不会改变物主。</p><p v-if="!privateCandidates.length" class="muted">当前没有可选择的私人物件。</p><label v-for="item in privateCandidates" :key="item.entityRef" class="gaolao-item-choice"><input v-model="privateItems" type="checkbox" :value="item.entityRef" :disabled="!canAct">{{ item.name }}</label><button class="secondary-button" :disabled="!privateAction" @click="send(privateAction)">请求整理选定私物</button></section>
    <section v-if="target.availableOperations?.includes('gz-return-public')"><h3>实际归还公用物</h3><label class="field-label" for="gaolao-return-item">本次归还物件</label><select id="gaolao-return-item" v-model="returnItem" :disabled="!canAct"><option value="">选择你携带的公用物</option><option v-for="item in returned" :key="item.entityRef" :value="item.entityRef">{{ item.name }}</option></select><button class="primary-button" :disabled="!returnAction" @click="send(returnAction)">归还选定公用物</button></section>
    <GaolaoSourceComparison v-if="comparisonTarget" :target="comparisonTarget" :observations="projection.observations" :can-act="canAct" :view-key="viewKey" @action="send" />
  </div>
</template>

<style scoped>
.gaolao-interaction section, .gaolao-interaction :deep(.gaolao-comparison) { margin-top: 20px; padding-top: 16px; border-top: 1px solid #cbb993; }.gaolao-interaction h3 { font-size: 18px; margin: 0 0 12px; }.gaolao-interaction select { margin-bottom: 12px; }.gaolao-interaction p { line-height: 1.75; overflow-wrap: anywhere; }.gaolao-item-choice { display: flex; align-items: center; min-height: 44px; gap: 10px; }.gaolao-item-choice input { width: 20px; height: 20px; }
</style>
