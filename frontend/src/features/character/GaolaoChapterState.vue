<script setup lang="ts">
import { computed } from 'vue';
import type { ActionV2, ChapterViewV2, ConsentViewV2, EntityViewV2, ItemViewV2, SelfViewV2 } from '../../../../game/spatial-types.ts';
import { consentResponse, consentWithdrawal, currentConsents, endingConfirmation } from '../../domain/gaolao-actions.ts';
import SpatialFieldList from '../../components/SpatialFieldList.vue';
import SpatialStatus from '../../components/SpatialStatus.vue';

const props = defineProps<{ chapter: ChapterViewV2; self: SelfViewV2; people: EntityViewV2[]; items: ItemViewV2[]; personLabels: Record<string, string>; canAct: boolean; canEnd?: boolean }>();
const emit = defineEmits<{ action: [action: ActionV2] }>();
const consents = computed(() => currentConsents(props.chapter));
type Tone = 'confirmed' | 'pending' | 'uncertain' | 'paused' | 'withdrawn' | 'neutral';
const duties = { A: '迎客联络', B: '内院照应', C: '木作帮手', D: '灶房帮手', E: '庄外引路' };
const purposes = { follow: '带路随行', appearance: '借用外貌', private_items: '整理私人物件', meeting: '约定会面', membership: '加入队伍' };
const consentLabels = { proposed: '等待本人回应', accepted: '本人已同意', declined: '本人已拒绝', deferred: '本人暂缓', withdrawn: '已撤回或被新安排替代' };
const followLabels = { proposed: '正在提议', accepted: '已接受安排，尚未启程', following: '正在随行', paused: '随行已暂停', arrived: '已到达，尚未确认安置', settled: '已确认安置', withdrawn: '许可已撤回', cancelled: '这次随行已取消' };
const decisionLabels = { undecided: '尚未作出决定', accepted: '本人已接受', declined: '本人已拒绝', deferred: '本人暂缓', withdrawn: '本人已撤回' };
const tone = (status: string): Tone => ['accepted', 'settled', 'confirmed'].includes(status) ? 'confirmed' : ['withdrawn', 'declined', 'cancelled', 'invalidated'].includes(status) ? 'withdrawn' : ['paused', 'deferred'].includes(status) ? 'paused' : status === 'undecided' ? 'uncertain' : 'pending';
function person(reference: string) { return reference === props.self.entityRef ? '你' : props.personLabels[reference] || props.people.find(person => person.entityRef === reference)?.name || '当前无可见称呼的人物'; }
function destination(reference: string) { return props.chapter.destinations.find(destination => destination.destinationId === reference)?.label || '本次约定地点'; }
function itemName(reference: string) { return props.items.find(item => item.entityRef === reference)?.name || '本次获准物件'; }
function send(action: ActionV2 | null) { if (action) emit('action', action); }
function respond(consent: ConsentViewV2, response: 'accept' | 'decline' | 'defer') { send(consentResponse(consent, props.self.entityRef, response, props.canAct)); }
</script>

<template>
  <div class="gaolao-chapter-state">
    <section><h3>本局分工与已知进展</h3><p v-if="chapter.responsibilities.length">你承担：{{ chapter.responsibilities.map(duty => duties[duty]).join('、') }}</p><SpatialFieldList :fields="chapter.progress" /></section>
    <section v-if="chapter.route !== undefined"><h3>已获知的会面安排</h3><p>{{ chapter.route === 'public' ? '公开说明' : chapter.route === 'disguise' ? '已获知借貌安排' : '尚未确定方式' }}</p></section>
    <section v-if="consents.length"><h3>本人的当前许可</h3><p v-if="chapter.consents.length > consents.length" class="spatial-panel-intro">这里只列每项用途的最新安排；已获准的旧记录仍保留在手记与终态回看中。</p><article v-for="consent in consents" :key="consent.consentId" class="gaolao-state-card"><h4>{{ person(consent.subjectRef) }} · {{ purposes[consent.purpose] }}</h4><SpatialStatus :label="consentLabels[consent.status]" :tone="tone(consent.status)" /><dl><dt>提出者</dt><dd>{{ person(consent.requesterRef) }}</dd><template v-if="consent.scope.destinationId"><dt>本次地点</dt><dd>{{ destination(consent.scope.destinationId) }}</dd></template><template v-if="consent.scope.leaderRef"><dt>本次带路人</dt><dd>{{ person(consent.scope.leaderRef) }}</dd></template><template v-if="consent.scope.itemRefs?.length"><dt>本次物件</dt><dd>{{ consent.scope.itemRefs.map(itemName).join('、') }}</dd></template></dl><div v-if="consent.subjectRef === self.entityRef" class="button-row"><template v-if="['proposed', 'deferred'].includes(consent.status)"><button class="primary-button" :disabled="!canAct" @click="respond(consent, 'accept')">我同意这次安排</button><button class="secondary-button" :disabled="!canAct" @click="respond(consent, 'decline')">我不同意</button><button class="text-button" :disabled="!canAct" @click="respond(consent, 'defer')">我想暂缓</button></template><button v-if="['proposed', 'accepted', 'deferred'].includes(consent.status)" class="text-button" :disabled="!canAct" @click="send(consentWithdrawal(consent, self.entityRef, canAct))">撤回我的许可</button></div></article></section>
    <section v-if="chapter.follows.length"><h3>带路与安置</h3><article v-for="follow in chapter.follows" :key="follow.followId" class="gaolao-state-card"><h4>{{ person(follow.subjectRef) }} · {{ destination(follow.destinationId) }}</h4><SpatialStatus :label="followLabels[follow.status]" :tone="tone(follow.status)" /><p>带路人：{{ person(follow.leaderRef) }}</p><p v-if="follow.reason">{{ follow.reason }}</p></article></section>
    <section v-if="chapter.decisions.length"><h3>人物自己的决定</h3><p class="spatial-panel-intro">材料和会面可以帮助了解情况，接受与否仍由本人决定。</p><article v-for="decision in chapter.decisions" :key="decision.decisionId" class="gaolao-state-card"><h4>{{ person(decision.subjectRef) }} · {{ decision.purpose === 'recruitment' ? '是否收徒' : '是否加入' }}</h4><SpatialStatus :label="decisionLabels[decision.status]" :tone="tone(decision.status)" /></article></section>
    <section v-if="chapter.publicItems.length"><h3>公用物的收尾</h3><ul class="gaolao-public-items"><li v-for="item in chapter.publicItems" :key="item.itemRef"><span>{{ item.name }}</span><SpatialStatus :label="item.returned ? '已实际归还' : item.borrowed ? '仍待归还' : '尚未借用'" :tone="item.returned ? 'confirmed' : item.borrowed ? 'pending' : 'neutral'" /></li></ul></section>
    <section v-if="chapter.endProposal"><h3>{{ chapter.endProposal.scope === 'recruitment' ? '结束本局招徒尝试' : '暂告一段' }}</h3><SpatialStatus :label="chapter.endProposal.status === 'invalidated' ? '同行人员变化，须重新提议' : chapter.endProposal.status === 'confirmed' ? '本轮确认已完成' : chapter.endProposal.confirmedCount + '/' + chapter.endProposal.requiredCount + ' 人已确认'" :tone="tone(chapter.endProposal.status)" /><p v-if="chapter.endProposal.scope === 'recruitment'">结束招徒尝试后，安置、归还与实际分别仍须完成。</p><p v-if="chapter.endProposal.ownConfirmed">你已明确确认这一轮。</p><button v-else-if="chapter.endProposal.status === 'pending'" class="secondary-button" :disabled="!(canEnd ?? canAct)" @click="send(endingConfirmation(chapter.endProposal, canEnd ?? canAct))">我确认本轮选择</button></section>
  </div>
</template>

<style scoped>
.gaolao-chapter-state section + section { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--spatial-line, #cbb993); }
.gaolao-chapter-state h3 { margin: 0 0 12px; font-size: 18px; }
.gaolao-state-card { margin: 14px 0; padding: 14px; background: #eee8d9; border-radius: 8px; }
.gaolao-state-card h4 { margin: 0 0 10px; font-size: 16px; }
.gaolao-state-card p, .gaolao-chapter-state p { line-height: 1.75; overflow-wrap: anywhere; }
.gaolao-state-card dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; font-size: 14px; line-height: 1.6; }
.gaolao-state-card dt { color: #74644f; }.gaolao-state-card dd { margin: 0; overflow-wrap: anywhere; }
.gaolao-public-items { list-style: none; padding: 0; }.gaolao-public-items li { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 12px 0; }
</style>
