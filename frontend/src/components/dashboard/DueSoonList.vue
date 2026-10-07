<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import StatusBadge from '@/components/task/StatusBadge.vue'
import type { Task } from '@/domain/task'
import { useTeamStore } from '@/stores/team'
import { formatDate } from '@/utils/dates'
import { tasksRouteWith } from '@/utils/query'

// FR-F-14 "due soon / unassigned" lists. The rows come from the two dedicated `list`
// calls the dashboard makes, kept in the view (not the task store) so they never fight
// with the task list's shared query (FE-07 §4.5).

const props = defineProps<{ dueSoon: Task[]; unassigned: Task[] }>()

const MAX_ROWS = 5

const team = useTeamStore()

function assigneeLabel(task: Task): string {
  if (task.assigneeId === null) return 'Unassigned'
  return team.byId.get(task.assigneeId)?.displayName ?? task.assigneeId
}

const sections = computed(() => [
  {
    key: 'due-soon',
    title: 'Due soon',
    rows: props.dueSoon.slice(0, MAX_ROWS),
    empty: 'Nothing due in the next 7 days.',
    viewAll: tasksRouteWith({ dueWithinDays: 7, sort: 'dueDate', descending: false }),
  },
  {
    key: 'unassigned',
    title: 'Unassigned, open',
    rows: props.unassigned.slice(0, MAX_ROWS),
    empty: 'Every open task has an assignee.',
    viewAll: tasksRouteWith({ unassigned: true }),
  },
])
</script>

<template>
  <div class="due-soon">
    <section
      v-for="section in sections"
      :key="section.key"
      class="due-panel"
      :data-list="section.key"
    >
      <header class="due-head">
        <h3 class="panel-title">{{ section.title }}</h3>
        <RouterLink class="view-all" :to="section.viewAll">View all →</RouterLink>
      </header>

      <p v-if="section.rows.length === 0" class="due-empty">{{ section.empty }}</p>
      <ul v-else class="due-rows">
        <li v-for="task in section.rows" :key="task.id" class="due-row">
          <RouterLink class="due-title" :to="`/tasks/${task.id}`">{{ task.title }}</RouterLink>
          <StatusBadge :status="task.status" />
          <span
            class="due-date"
            :class="{ 'is-overdue': task.isOverdue }"
            :title="task.isOverdue ? 'Overdue' : undefined"
          >
            {{ formatDate(task.dueDate) }}
          </span>
          <span class="due-assignee">{{ assigneeLabel(task) }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.due-soon {
  display: grid;
  gap: var(--space-3);
}

.due-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.due-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
}

.panel-title {
  margin: 0;
  font-size: 14px;
}

.view-all {
  font-size: 12px;
  color: var(--primary);
}

.due-empty {
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
}

.due-rows {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.due-row {
  display: grid;
  grid-template-columns: 1fr auto auto auto;
  align-items: center;
  gap: var(--space-2);
  font-size: 13px;
}

.due-title {
  overflow: hidden;
  color: inherit;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.due-date {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.due-date.is-overdue {
  color: var(--danger);
  font-weight: 600;
}

.due-assignee {
  color: var(--text-muted);
  white-space: nowrap;
}
</style>
