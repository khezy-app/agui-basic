<script setup lang="ts">
import { computed } from 'vue'

import { isTaskStatus, STATUS_LABEL, type TaskStatus } from '@/domain/task'

// `string` (not `TaskStatus`) so an unexpected wire value degrades gracefully instead of
// crashing the whole table — the same defensive stance the API client takes.
const props = defineProps<{ status: string }>()

const label = computed(() => STATUS_LABEL[props.status as TaskStatus] ?? props.status)

const className = computed(() => {
  if (!isTaskStatus(props.status)) return 'status-unknown'
  return `status-${props.status.toLowerCase().replace(/_/g, '-')}`
})
</script>

<template>
  <span class="status-badge" :class="className">{{ label }}</span>
</template>

<style scoped>
.status-badge {
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
