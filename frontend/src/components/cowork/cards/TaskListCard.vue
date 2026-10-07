<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import StatusBadge from '@/components/task/StatusBadge.vue'
import { formatDate } from '@/utils/dates'

import { parseTaskList, taskListQueryFromArgs } from '../resultShapes'

/** `query_tasks` result: a page of tasks, rendered as a card next to the tool call (FR-AI-22). */
const props = defineProps<{ content: unknown; args?: unknown }>()

const result = computed(() => parseTaskList(props.content))
const tasks = computed(() => result.value?.tasks ?? [])
const total = computed(() => result.value?.total ?? tasks.value.length)
const listLink = computed(() => ({ name: 'tasks', query: taskListQueryFromArgs(props.args) }))
</script>

<template>
  <section class="card" aria-label="Task list result">
    <header class="card-head">
      <strong>{{ tasks.length }} of {{ total }}</strong>
      <RouterLink class="card-link" :to="listLink">Open in task list</RouterLink>
    </header>
    <ul v-if="tasks.length > 0" class="rows">
      <li v-for="task in tasks" :key="task.id" class="row">
        <RouterLink class="title" :to="`/tasks/${task.id}`">{{ task.title }}</RouterLink>
        <StatusBadge :status="task.status" />
        <span class="due" :class="{ overdue: task.overdue }">
          {{ task.overdue ? 'overdue · ' : '' }}{{ formatDate(task.dueDate) }}
        </span>
        <span class="assignee">{{ task.assignee ?? 'Unassigned' }}</span>
        <span v-if="task.tags.length > 0" class="tags">{{ task.tags.join(', ') }}</span>
      </li>
    </ul>
    <p v-else class="empty">No tasks matched.</p>
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

.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  font-size: 13px;
}

.title {
  font-weight: 500;
  flex: 1 1 100%;
}

.due,
.assignee,
.tags {
  color: var(--text-muted);
  font-size: 12px;
}

.due.overdue {
  color: var(--danger);
  font-weight: 600;
}

.empty {
  color: var(--text-muted);
  font-size: 13px;
  margin: 0;
}
</style>
