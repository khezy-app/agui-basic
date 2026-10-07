<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { isApiError } from '@/api/errors'
import { taskApi } from '@/api/tasks'
import DueSoonList from '@/components/dashboard/DueSoonList.vue'
import PriorityBreakdown from '@/components/dashboard/PriorityBreakdown.vue'
import StatCards from '@/components/dashboard/StatCards.vue'
import StatusDistribution from '@/components/dashboard/StatusDistribution.vue'
import ErrorBlock from '@/components/task/ErrorBlock.vue'
import LoadingBlock from '@/components/task/LoadingBlock.vue'
import { DEFAULT_TASK_QUERY, type Task } from '@/domain/task'
import { useTaskStore } from '@/stores/tasks'
import { useTeamStore } from '@/stores/team'
import { useUiStore } from '@/stores/ui'

// The `/` landing screen (FR-F-13, FR-F-14). Every whole-store number comes from
// `GET /api/tasks/stats`; the two short lists are their own `list` calls kept in local
// refs so they never fight with the task list's shared query (FE-07 §4.5).

const tasks = useTaskStore()
const team = useTeamStore()
const ui = useUiStore()

const dueSoon = ref<Task[]>([])
const unassigned = ref<Task[]>([])

// `idle` counts as loading too, so the first paint (before `onMounted`) shows the
// skeleton instead of a blank view.
const showSkeleton = computed(() => tasks.stats === null && tasks.statsState !== 'error')
const showError = computed(() => tasks.statsState === 'error')

async function loadLists(): Promise<void> {
  try {
    const [due, open] = await Promise.all([
      taskApi.list({
        ...DEFAULT_TASK_QUERY,
        dueWithinDays: 7,
        sort: 'dueDate',
        descending: false,
        size: 5,
      }),
      taskApi.list({
        ...DEFAULT_TASK_QUERY,
        unassigned: true,
        sort: 'createdAt',
        descending: true,
        size: 5,
      }),
    ])
    dueSoon.value = due.content
    unassigned.value = open.content
  } catch (caught) {
    dueSoon.value = []
    unassigned.value = []
    ui.pushToast({
      kind: 'error',
      title: 'Could not load the dashboard lists',
      detail: isApiError(caught) ? caught.detail || caught.message : String(caught),
    })
  }
}

function refreshStats() {
  void tasks.fetchStats()
}

onMounted(() => {
  tasks.setView('dashboard')
  void team.fetchMembers()
  if (tasks.statsState === 'idle') void tasks.fetchStats()
  void loadLists()
})

// No auto-poll — the demo may mutate tasks through the AI, so refreshing is explicit.
async function refresh(): Promise<void> {
  await Promise.all([tasks.fetchStats(), tasks.fetchList(), loadLists()])
}
</script>

<template>
  <section class="dashboard-view">
    <header class="view-header">
      <h2 class="view-title">Dashboard</h2>
      <button
        class="refresh-button"
        type="button"
        :disabled="tasks.statsState === 'loading'"
        @click="refresh"
      >
        Refresh
      </button>
    </header>

    <LoadingBlock v-if="showSkeleton" />
    <ErrorBlock v-else-if="showError" :error="tasks.statsError" @retry="refreshStats" />
    <template v-else-if="tasks.stats">
      <StatCards :stats="tasks.stats" />
      <div class="dashboard-grid">
        <StatusDistribution :by-status="tasks.stats.byStatus" :total="tasks.stats.total" />
        <PriorityBreakdown :by-priority="tasks.stats.byPriority" />
        <DueSoonList :due-soon="dueSoon" :unassigned="unassigned" />
      </div>
    </template>
  </section>
</template>

<style scoped>
.dashboard-view {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.view-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.view-title {
  margin: 0;
}

.refresh-button {
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-alt);
  cursor: pointer;
}

.refresh-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--space-3);
  align-items: start;
}
</style>
