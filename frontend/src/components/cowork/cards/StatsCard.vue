<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import { STATUS_LABEL } from '@/domain/task'
import type { TaskStatus } from '@/domain/task'

import { parseStats } from '../resultShapes'

/** `get_task_stats` result: a compact numbers grid plus the dashboard link (FR-AI-22). */
const props = defineProps<{ content: unknown }>()

const stats = computed(() => parseStats(props.content))

const statuses = computed(() =>
  Object.entries(stats.value?.byStatus ?? {}).map(([status, count]) => ({
    status,
    label: STATUS_LABEL[status as TaskStatus] ?? status,
    count,
  })),
)
</script>

<template>
  <section v-if="stats" class="card" aria-label="Stats result">
    <header class="card-head">
      <strong>{{ stats.total }} tasks</strong>
      <RouterLink class="card-link" to="/">See dashboard</RouterLink>
    </header>
    <ul class="grid">
      <li v-for="entry in statuses" :key="entry.status" class="cell">
        <span class="count">{{ entry.count }}</span>
        <span class="label">{{ entry.label }}</span>
      </li>
      <li class="cell">
        <span class="count">{{ stats.overdue }}</span>
        <span class="label">Overdue</span>
      </li>
      <li class="cell">
        <span class="count">{{ stats.dueThisWeek }}</span>
        <span class="label">Due this week</span>
      </li>
      <li class="cell">
        <span class="count">{{ stats.unassigned }}</span>
        <span class="label">Unassigned</span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.card {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  padding: var(--space-2) var(--space-3);
}

.card-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}

.card-link {
  font-size: 12px;
}

.grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  gap: var(--space-2);
}

.cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.count {
  font-size: 18px;
  font-weight: 600;
}

.label {
  color: var(--text-muted);
  font-size: 11px;
}
</style>
