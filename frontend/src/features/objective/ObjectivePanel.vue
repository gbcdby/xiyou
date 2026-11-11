<script setup lang="ts">
import type { AuthorizedProjection } from '../../domain/world.ts';
import AppIcon from '../../components/AppIcon.vue';
defineProps<{ projection: AuthorizedProjection }>();
</script>

<template>
  <section class="panel objective-panel" aria-labelledby="objective-heading">
    <div class="section-heading"><h2 id="objective-heading"><AppIcon name="compass" />此行目标</h2></div>
    <ol class="objectives">
      <li v-for="(objective, index) in projection.objectives" :key="objective.objectiveId" :class="objective.status">
        <span class="step-number"><AppIcon v-if="objective.status === 'completed'" name="check" :size="14" /><template v-else>{{ index + 1 }}</template></span>
        <div><strong>{{ objective.label }}</strong><p v-if="objective.detail">{{ objective.detail }}</p><span class="tiny muted">{{ { active: '可以推进', blocked: '待前置条件满足', completed: '已由世界状态确认' }[objective.status] }}</span></div>
      </li>
    </ol>
  </section>
</template>
