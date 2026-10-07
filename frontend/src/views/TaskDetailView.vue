<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'

import ErrorBlock from '@/components/task/ErrorBlock.vue'
import LoadingBlock from '@/components/task/LoadingBlock.vue'
import PriorityTag from '@/components/task/PriorityTag.vue'
import StatusBadge from '@/components/task/StatusBadge.vue'
import TaskStatusControl from '@/components/task/TaskStatusControl.vue'
import { useConfirm } from '@/composables/confirm'
import { useTaskStore } from '@/stores/tasks'
import { useTeamStore } from '@/stores/team'
import { formatDate, isOverdueDisplay } from '@/utils/dates'

const props = defineProps<{ id?: string }>()

const tasks = useTaskStore()
const team = useTeamStore()
const router = useRouter()
const { confirm } = useConfirm()

const task = computed(() => tasks.activeTask)
const isLoading = computed(() => tasks.detailState === 'loading' && task.value === null)
const loadFailed = computed(() => tasks.detailState === 'error' && task.value === null)
const isMissing = computed(() => tasks.detailError?.kind === 'not-found')
const overdue = computed(() => (task.value === null ? false : isOverdueDisplay(task.value)))
const deleting = ref(false)

function memberName(id: string | null): string {
  if (id === null) return 'Unassigned'
  return team.byId.get(id)?.displayName ?? 'Unknown member'
}

const assigneeName = computed(() => memberName(task.value?.assigneeId ?? null))
const reporterName = computed(() => memberName(task.value?.reporterId ?? null))
const estimate = computed(() => {
  const hours = task.value?.estimateHours
  return hours === null || hours === undefined ? '—' : `${hours} h`
})

onMounted(() => {
  tasks.setView('task-detail')
  void team.fetchMembers()
  if (props.id !== undefined) void tasks.fetchDetail(props.id)
})

function onRetry() {
  if (props.id !== undefined) void tasks.fetchDetail(props.id)
}

async function onDelete() {
  const current = task.value
  if (current === null || deleting.value) return

  const confirmed = await confirm({
    title: 'Delete task',
    body: `Delete “${current.title}”? This cannot be undone.`,
    confirmLabel: 'Delete',
    danger: true,
  })
  if (!confirmed) return

  deleting.value = true
  const removed = await tasks.deleteTask(current.id)
  deleting.value = false
  if (removed) await router.push('/tasks')
}
</script>

<template>
  <section class="task-detail-view">
    <LoadingBlock v-if="isLoading" />

    <div v-else-if="loadFailed" class="load-failure">
      <ErrorBlock :error="tasks.detailError" @retry="onRetry" />
      <p v-if="isMissing" class="not-found-note">This task could not be found.</p>
      <RouterLink class="back-link" to="/tasks">Back to tasks</RouterLink>
    </div>

    <article v-else-if="task" class="task-detail">
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <RouterLink to="/tasks">Tasks</RouterLink>
        <span aria-hidden="true">/</span>
        <span>{{ task.title }}</span>
      </nav>

      <header class="detail-header">
        <h2 class="detail-title">{{ task.title }}</h2>
        <div class="detail-meta">
          <StatusBadge :status="task.status" />
          <PriorityTag :priority="task.priority" />
        </div>
      </header>

      <div class="detail-actions">
        <RouterLink class="edit-link" :to="`/tasks/${task.id}/edit`">Edit</RouterLink>
        <TaskStatusControl :task="task" />
        <button type="button" class="delete-button" :disabled="deleting" @click="onDelete">
          Delete
        </button>
      </div>

      <p v-if="task.description" class="detail-description">{{ task.description }}</p>
      <p v-else class="detail-description muted">No description.</p>

      <dl class="detail-fields">
        <dt>Assignee</dt>
        <dd>{{ assigneeName }}</dd>

        <dt>Reporter</dt>
        <dd>{{ reporterName }}</dd>

        <dt>Due date</dt>
        <dd>
          <span :title="task.dueDate ?? undefined">{{ formatDate(task.dueDate) }}</span>
          <span v-if="overdue" class="overdue-flag" title="Overdue">Overdue</span>
        </dd>

        <dt>Estimate</dt>
        <dd>{{ estimate }}</dd>

        <dt>Tags</dt>
        <dd>
          <span v-if="task.tags.length > 0" class="tag-chips">
            <span v-for="tag in task.tags" :key="tag" class="tag-chip">{{ tag }}</span>
          </span>
          <span v-else>—</span>
        </dd>

        <dt>Created</dt>
        <dd :title="task.createdAt">{{ formatDate(task.createdAt) }}</dd>

        <dt>Updated</dt>
        <dd :title="task.updatedAt">{{ formatDate(task.updatedAt) }}</dd>
      </dl>
    </article>
  </section>
</template>

<style scoped>
.task-detail-view {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.task-detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.breadcrumb {
  display: flex;
  gap: var(--space-1);
  color: var(--text-muted);
  font-size: 13px;
}

.detail-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.detail-title {
  margin: 0;
}

.detail-meta {
  display: flex;
  gap: var(--space-1);
}

.detail-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.edit-link {
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.delete-button {
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--danger);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--danger);
  cursor: pointer;
}

.delete-button:disabled {
  cursor: progress;
  opacity: 0.6;
}

.detail-description {
  margin: 0;
  white-space: pre-wrap;
}

.detail-description.muted {
  color: var(--text-muted);
}

.detail-fields {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: var(--space-2) var(--space-3);
  margin: 0;
}

.detail-fields dt {
  color: var(--text-muted);
  font-weight: 600;
}

.detail-fields dd {
  margin: 0;
}

.overdue-flag {
  margin-left: var(--space-2);
  padding: 0 var(--space-1);
  border-radius: 4px;
  background: #fee2e2;
  color: var(--danger);
  font-size: 12px;
  font-weight: 600;
}

.tag-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.tag-chip {
  padding: 2px var(--space-2);
  border-radius: 999px;
  background: var(--surface-alt);
  font-size: 12px;
}

.load-failure {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  align-items: flex-start;
}

.not-found-note {
  margin: 0;
  color: var(--text-muted);
}

.back-link {
  color: var(--primary);
}
</style>
