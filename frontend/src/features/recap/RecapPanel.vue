<script setup lang="ts">
import type { AuthorizedProjection, RecapEntry, RecapReference } from '../../domain/world.ts';
import { authorizedName, fieldType, fieldValue } from '../../domain/world.ts';
import type { RecapState } from '../../network/recap-client.ts';
import AppIcon from '../../components/AppIcon.vue';
defineProps<{ projection: AuthorizedProjection; recap?: RecapState }>();
const emit = defineEmits<{ more: [] }>();
const categories = { Observation: '观察／收到证据', Claim: '陈述', WorldFact: '已发生的行动' };
const kinds: Record<RecapEntry['kind'], string> = { observed: '取得观察', received_evidence: '收到证据', heard_claim: '听到／获知陈述', received_claim: '收到分享的陈述', said: '说过', moved: '移动', took: '拿取', transferred: '交付', used: '使用物品', updated: '状态改变', finished: '本局结束', aborted: '本局终止' };
const referenceNames: Record<RecapReference['kind'], string> = { observation: '观察记录', claim: '陈述记录', character: '角色', item: '物品', target: '对象', region: '区域', source: '相关引用' };
function actorLabel(entry: RecapEntry): string { return entry.kind === 'said' ? '发言者' : ['heard_claim', 'received_claim', 'received_evidence'].includes(entry.kind) ? '接收者' : entry.kind === 'observed' ? '观察者' : '执行角色'; }
</script>

<template>
  <section v-if="projection.ending" class="panel recap-panel" aria-labelledby="recap-heading">
    <span class="eyebrow"><AppIcon name="book" :size="16" />本局回顾</span>
    <h2 id="recap-heading">{{ projection.ending.title }}</h2>
    <p>{{ projection.ending.summary }}</p>
    <dl class="fact-grid"><div v-for="field in projection.ending.facts" :key="field.key"><dt>{{ field.label }}</dt><dd>{{ fieldValue(field.value) }}</dd></div></dl>
    <div v-if="projection.ending.unresolved.length" class="unresolved"><h3>仍未厘清</h3><ul><li v-for="item in projection.ending.unresolved" :key="item">{{ item }}</li></ul></div>
    <p class="muted small">本局已结束。以上回顾只展示你有权查看的已确认结果。</p>
    <section v-if="recap" class="authorized-recap" aria-labelledby="process-heading">
      <h3 id="process-heading">你有权查看的过程</h3>
      <p class="small muted">由近及远排列。说过、听到或收到的陈述，与实际发生的行动分别标明；相关引用不会展开未获授权的内容。</p>
      <ol class="recap-events">
        <li v-for="entry in recap.entries" :key="entry.entryId" class="recap-entry" :data-recap-id="entry.entryId" :data-kind="entry.kind" :data-category="entry.category">
          <div class="evidence-meta"><span class="kind-tag" :class="entry.category">{{ categories[entry.category] }}</span><strong>{{ kinds[entry.kind] }}</strong><span class="tiny muted">序号 {{ entry.eventSeq }}</span></div>
          <p v-if="entry.actorId" class="tiny muted">{{ actorLabel(entry) }}：{{ authorizedName(projection, entry.actorId) }}</p>
          <p class="recap-text">{{ entry.text }}</p>
          <dl v-if="entry.fields.length" class="fact-grid"><div v-for="field in entry.fields" :key="field.key"><dt>{{ field.label }}</dt><dd>{{ fieldValue(field.value) }} <span class="value-type">{{ fieldType(field.value) }}</span></dd></div></dl>
          <ul v-if="entry.references.length" class="recap-references tiny"><li v-for="reference in entry.references" :key="reference.kind + ':' + reference.id">{{ referenceNames[reference.kind] }}：<span>{{ ['character', 'item', 'target', 'region'].includes(reference.kind) ? authorizedName(projection, reference.id) : reference.id }}</span></li></ul>
        </li>
      </ol>
      <p v-if="recap.status === 'loading'" class="small" role="status">正在读取过程…</p>
      <p v-if="recap.message" class="notice warning" role="status">{{ recap.message }}</p>
      <p v-if="recap.complete" class="small muted">{{ recap.entries.length ? '已读完你有权查看的过程。' : '当前没有可显示的授权过程记录。' }}</p>
      <button v-if="recap.status === 'error' || (recap.status === 'ready' && recap.nextBeforeSeq)" class="secondary-button" @click="emit('more')">{{ recap.status === 'error' ? '重试读取过程' : '加载更早的过程' }}</button>
    </section>
  </section>
</template>
