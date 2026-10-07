<script setup lang="ts">
import { computed } from 'vue'

import { isTaskPriority, PRIORITY_LABEL, type TaskPriority } from '@/domain/task'

const props = defineProps<{ priority: string }>()

const label = computed(() => PRIORITY_LABEL[props.priority as TaskPriority] ?? props.priority)

const className = computed(() =>
  isTaskPriority(props.priority) ? `priority-${props.priority.toLowerCase()}` : 'priority-unknown',
)
</script>

<template>
  <span class="priority-tag" :class="className">{{ label }}</span>
</template>

<style scoped>
.priority-tag {
  display: inline-flex;
  align-items: center;
  padding: 2px var(--space-2);
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
  white-space: nowrap;
  color: var(--text-muted);
  background: var(--surface-alt);
}
</style>
