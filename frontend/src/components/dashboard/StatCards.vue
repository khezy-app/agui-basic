<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, type RouteLocationRaw } from 'vue-router'

import type { TaskStats } from '@/domain/task'
import { tasksRouteWith } from '@/utils/query'

// FR-F-13: four cards, every number straight from `GET /api/tasks/stats` (whole-store,
// never recomputed from a page of tasks). Each card is a deep link into `/tasks`.

const props = defineProps<{ stats: TaskStats }>()

type StatCard = {
  key: string
  label: string
  value: number
  hint: string
  to: RouteLocationRaw
  danger?: boolean
  tooltip?: string
}

const cards = computed<StatCard[]>(() => [
  {
    key: 'open',
    label: 'Open tasks',
    value: props.stats.total - props.stats.byStatus.DONE - props.stats.byStatus.CANCELLED,
    hint: 'Not done or cancelled',
    to: tasksRouteWith({
      statuses: ['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED'],
    }),
  },
  {
    key: 'overdue',
    label: 'Overdue',
    value: props.stats.overdueTotal,
    hint: 'Past their due date',
    to: tasksRouteWith({ overdue: true }),
    danger: true,
  },
  {
    key: 'due-this-week',
    label: 'Due this week',
    value: props.stats.dueThisWeek,
    hint: 'Due within 7 days',
    to: tasksRouteWith({ dueWithinDays: 7 }),
    // OPEN-6: the backend `dueThisWeek` window is week-based and includes overdue items.
    tooltip: 'Includes items that are already overdue',
  },
  {
    key: 'unassigned',
    label: 'Unassigned',
    value: props.stats.unassignedTotal,
    hint: 'No assignee',
    to: tasksRouteWith({ unassigned: true }),
  },
])
</script>

<template>
  <div class="stat-cards">
    <RouterLink
      v-for="card in cards"
      :key="card.key"
      class="stat-card"
      :class="{ 'is-muted': card.value === 0, 'is-danger': card.danger && card.value > 0 }"
      :to="card.to"
      :title="card.tooltip"
      :data-card="card.key"
    >
      <span class="stat-label">{{ card.label }}</span>
      <span class="stat-value">{{ card.value }}</span>
      <span class="stat-hint">{{ card.hint }}</span>
    </RouterLink>
  </div>
</template>

<style scoped>
.stat-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--space-3);
}

.stat-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-left-width: 4px;
  border-radius: var(--radius);
  background: var(--surface);
  color: inherit;
}

.stat-card:hover {
  text-decoration: none;
  border-color: var(--primary);
}

.stat-label {
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 600;
}

.stat-value {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.1;
}

.stat-hint {
  color: var(--text-muted);
  font-size: 12px;
}

.stat-card.is-muted .stat-value {
  color: var(--text-muted);
}

.stat-card.is-danger {
  border-left-color: var(--danger);
}

.stat-card.is-danger .stat-value {
  color: var(--danger);
}
</style>
