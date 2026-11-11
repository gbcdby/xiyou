<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Action, AuthorizedProjection } from '../../domain/world.ts';
import AppIcon from '../../components/AppIcon.vue';
const props = defineProps<{ projection: AuthorizedProjection; disabled: boolean }>();
const emit = defineEmits<{ action: [action: Action] }>();
const selected = ref<string | null>(null);
const recipientIds = ref<string[]>([]);
const recipients = computed(() => props.projection.characters.filter(person => person.characterId !== props.projection.self.characterId && person.regionId === props.projection.self.regionId));
const categories = { Evidence: '证据记录', WorldFact: '实际观察', Claim: '听到的说法' };
const sourceNames = { initial_content: '已有记录', inspection: '现场检查', event: '亲历事件', speech: '他人陈述', evidence_share: '他人出示' };
function share() {
  if (!selected.value || !recipientIds.value.length) return;
  emit('action', { kind: 'share_evidence', evidenceId: selected.value, recipientIds: [...recipientIds.value] });
  selected.value = null;
}
</script>

<template>
  <section class="panel evidence-panel" aria-labelledby="evidence-heading">
    <div class="section-heading"><h2 id="evidence-heading"><AppIcon name="book" />我知道的事</h2><span class="count-badge">{{ projection.observations.length }}</span></div>
    <p class="section-intro">你的记录不会自动告诉所有人。展示时，请明确选择接收者。</p>
    <article v-for="observation in projection.observations" :key="observation.observationId" class="evidence-card" :class="observation.category">
      <div class="evidence-meta"><span class="kind-tag">{{ categories[observation.category] }}</span><span class="tiny muted">{{ sourceNames[observation.source.kind] }}</span></div>
      <p>{{ observation.statement }}</p>
      <button v-if="observation.shareable" class="text-button" :disabled="disabled || !recipients.length" @click="selected = observation.observationId; recipientIds = []"><AppIcon name="send" :size="15" />展示这份记录</button>
      <form v-if="selected === observation.observationId" class="inline-form" @submit.prevent="share"><fieldset><legend>同处的接收者</legend><label v-for="person in recipients" :key="person.characterId" class="check-label"><input v-model="recipientIds" type="checkbox" :value="person.characterId" />{{ person.name }}</label></fieldset><div class="button-row"><button class="primary-button" :disabled="disabled || !recipientIds.length">确认展示</button><button type="button" class="quiet-button" @click="selected = null">取消</button></div></form>
    </article>
    <p v-if="!projection.observations.length" class="empty-copy">还没有记录。查看身边的物件，或请伙伴展示他们的发现。</p>
  </section>
</template>
