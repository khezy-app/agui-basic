<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, onBeforeRouteLeave, useRouter } from 'vue-router'

import type { TaskCreateInput, TaskPatchInput } from '@/api/tasks'
import ErrorBlock from '@/components/task/ErrorBlock.vue'
import LoadingBlock from '@/components/task/LoadingBlock.vue'
import TaskForm from '@/components/task/TaskForm.vue'
import { useConfirm } from '@/composables/confirm'
import { useTaskDraft } from '@/composables/useTaskDraft'
import type { TaskStatus } from '@/domain/task'
import type { TaskFormValue } from '@/domain/validation'
import { useTaskStore } from '@/stores/tasks'

// `/tasks/new` (no id) and `/tasks/:id/edit` (id) share this view.
const props = defineProps<{ id?: string }>()

const tasks = useTaskStore()
const router = useRouter()
const { confirm } = useConfirm()
const draft = useTaskDraft()

const formRef = ref<InstanceType<typeof TaskForm> | null>(null)
const mode = computed<'create' | 'edit'>(() => (props.id === undefined ? 'create' : 'edit'))
const initial = computed(() => tasks.activeTask ?? undefined)

const isLoading = computed(
  () => mode.value === 'edit' && tasks.detailState === 'loading' && tasks.activeTask === null,
)
const loadFailed = computed(() => mode.value === 'edit' && tasks.detailState === 'error')
const isReady = computed(
  () => mode.value === 'create' || (tasks.detailState === 'ready' && tasks.activeTask !== null),
)

// Set while this view navigates on purpose, so the unsaved-changes guard stays quiet.
let leavingAfterSave = false

onMounted(() => {
  tasks.setView('task-form')
  if (mode.value === 'edit' && props.id !== undefined && tasks.activeTask?.id !== props.id) {
    void tasks.fetchDetail(props.id)
  }
})

/**
 * The form emits the *normalised* payload (tags folded, `''` → `null`, estimate as a
 * number); `createTask`/`saveTask` take the raw `TaskFormValue`, so this maps it back
 * losslessly. Normalisation is idempotent, so the store re-running it is a no-op.
 */
function toFormValue(input: TaskCreateInput | TaskPatchInput, status: TaskStatus): TaskFormValue {
  return {
    title: input.title,
    description: input.description ?? '',
    status,
    priority: input.priority ?? 'MEDIUM',
    assigneeId: input.assigneeId,
    reporterId: input.reporterId,
    dueDate: input.dueDate ?? '',
    estimateHours: input.estimateHours === null ? '' : String(input.estimateHours),
    tags: input.tags,
  }
}

async function onSubmit(payload: TaskCreateInput | TaskPatchInput) {
  if (mode.value === 'create') {
    const status = (payload as TaskCreateInput).status ?? 'TODO'
    const created = await tasks.createTask(toFormValue(payload, status))
    if (created === null) return
    leavingAfterSave = true
    draft.clear()
    await router.push(`/tasks/${created.id}`)
    return
  }

  const id = props.id as string
  const status = initial.value?.status ?? 'TODO'
  const saved = await tasks.saveTask('patch', id, toFormValue(payload, status))
  if (!saved) return
  leavingAfterSave = true
  draft.clear()
  await router.push(`/tasks/${id}`)
}

function onCancel() {
  leavingAfterSave = true
  draft.clear()
  void router.push(mode.value === 'create' ? '/tasks' : `/tasks/${props.id}`)
}

function onRetryLoad() {
  if (props.id !== undefined) void tasks.fetchDetail(props.id)
}

// Unsaved-changes guard (OPEN-11): also covers an AI draft that navigates the user away.
onBeforeRouteLeave(async () => {
  if (leavingAfterSave) return true
  if (formRef.value?.isDirty !== true) return true
  return confirm({
    title: 'Discard unsaved changes?',
    body: 'Your changes to this task have not been saved.',
    confirmLabel: 'Discard',
    danger: true,
  })
})
</script>

<template>
  <section class="task-form-view">
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <RouterLink to="/tasks">Tasks</RouterLink>
      <span aria-hidden="true">/</span>
      <span>{{ mode === 'create' ? 'New task' : (initial?.title ?? 'Task') }}</span>
    </nav>

    <h2 class="view-title">{{ mode === 'create' ? 'New task' : 'Edit task' }}</h2>

    <LoadingBlock v-if="isLoading" />

    <div v-else-if="loadFailed" class="load-failure">
      <ErrorBlock :error="tasks.detailError" @retry="onRetryLoad" />
      <RouterLink class="back-link" to="/tasks">Back to tasks</RouterLink>
    </div>

    <TaskForm
      v-else-if="isReady"
      ref="formRef"
      :mode="mode"
      :initial="initial"
      @submit="onSubmit"
      @cancel="onCancel"
    />
  </section>
</template>

<style scoped>
.task-form-view {
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

.view-title {
  margin: 0;
}

.load-failure {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  align-items: flex-start;
}

.back-link {
  color: var(--primary);
}
</style>
