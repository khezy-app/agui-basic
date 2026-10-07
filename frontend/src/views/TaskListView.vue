<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import BulkActionBar from '@/components/task/BulkActionBar.vue'
import EmptyState from '@/components/task/EmptyState.vue'
import ErrorBlock from '@/components/task/ErrorBlock.vue'
import LoadingBlock from '@/components/task/LoadingBlock.vue'
import Pagination from '@/components/task/TaskPagination.vue'
import TaskFilters from '@/components/task/TaskFilters.vue'
import TaskTable from '@/components/task/TaskTable.vue'
import { useTaskStore } from '@/stores/tasks'
import { deepEqual, parseTaskQuery, taskQueryToRouteQuery } from '@/utils/query'

const tasks = useTaskStore()
const router = useRouter()
const route = useRoute()

// URL ⇄ store sync (FE-05 §4.2). The URL query string is the source of truth for the
// filters; the store is a cache of it. Both watchers compare **normalised** values and
// bail early, which is what breaks the classic replace-loop between them.
watch(
  () => route.query,
  (current) => {
    const parsed = parseTaskQuery(current)
    if (deepEqual(parsed, tasks.query)) return
    void tasks.setQuery(parsed)
  },
  { immediate: true },
)

watch(
  () => tasks.query,
  (current) => {
    const next = taskQueryToRouteQuery(current)
    // Compare against the URL normalised the same way, so a hand-written URL (repeated
    // keys, extra params) never triggers a redundant navigation.
    if (deepEqual(next, taskQueryToRouteQuery(parseTaskQuery(route.query)))) return
    void router.replace({ name: 'tasks', query: next })
  },
  { deep: true },
)

const showSkeleton = computed(() => tasks.listState === 'loading' && tasks.tasks.length === 0)
const showError = computed(() => tasks.listState === 'error')
const showTable = computed(() => !showSkeleton.value && !showError.value && tasks.tasks.length > 0)
const showEmpty = computed(
  () => !showSkeleton.value && !showError.value && tasks.tasks.length === 0,
)
// Keep the previous page visible while refetching; only a cold load shows the skeleton.
const isRefetching = computed(() => tasks.listState === 'loading' && tasks.tasks.length > 0)

const emptyCopy = computed(() =>
  tasks.isFiltered
    ? {
        title: 'No tasks match these filters',
        description: 'Clear or loosen the active filters to see more results.',
      }
    : {
        title: 'No tasks yet',
        description: 'Create the first task to start tracking work.',
      },
)

onMounted(() => {
  tasks.setView('task-list')
  if (tasks.listState === 'idle') void tasks.fetchList()
})

function onRetry() {
  void tasks.fetchList()
}

function onCreate() {
  void router.push('/tasks/new')
}
</script>

<template>
  <section class="task-list-view">
    <header class="view-header">
      <div class="view-heading">
        <h2 class="view-title">Tasks</h2>
        <p class="view-summary">
          {{ tasks.totalElements }} task(s)
          <span v-if="tasks.isFiltered" class="view-filtered">· filtered</span>
        </p>
      </div>

      <div class="view-tools">
        <RouterLink class="new-task-link" to="/tasks/new">+ New task</RouterLink>
      </div>
    </header>

    <TaskFilters />

    <LoadingBlock v-if="showSkeleton" />
    <ErrorBlock v-else-if="showError" :error="tasks.listError" @retry="onRetry" />
    <EmptyState
      v-else-if="showEmpty"
      :title="emptyCopy.title"
      :description="emptyCopy.description"
      action-label="Create task"
      @action="onCreate"
    />
    <div v-else class="table-wrap" :aria-busy="isRefetching">
      <TaskTable />
    </div>

    <Pagination v-if="showTable" />
    <BulkActionBar />
  </section>
</template>

<style scoped>
.task-list-view {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.view-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-3);
}

.view-title {
  margin: 0;
}

.view-summary {
  margin: var(--space-1) 0 0;
  color: var(--text-muted);
}

.view-filtered {
  color: var(--primary);
}

.view-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.new-task-link {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius);
  background: var(--primary);
  color: #ffffff;
  font-weight: 600;
}

.new-task-link:hover {
  text-decoration: none;
  filter: brightness(1.05);
}

.table-wrap[aria-busy='true'] {
  opacity: 0.6;
}
</style>
