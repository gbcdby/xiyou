<script setup lang="ts">
import type { FactField } from '../../../game/spatial-types.ts';
defineProps<{ fields: FactField[] }>();
</script>

<template>
  <dl v-if="fields.length" class="spatial-fields"><template v-for="field in fields" :key="field.key"><dt>{{ field.label }}</dt><dd>{{ field.value === true ? '已满足' : field.value === false ? '未满足' : field.value ?? '尚无' }}</dd></template></dl>
</template>
