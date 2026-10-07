<script setup lang="ts">
import { computed, ref } from 'vue'

import { allowedTargets } from '@/domain/statusFlow'
import { STATUS_LABEL, type Task, type TaskStatus } from '@/domain/task'
import { useTaskStore } from '@/stores/tasks'

// Shared by the row quick action (FE-04) and the detail/edit views (FE-06).
const props = withDefaults(defineProps<{ task: Task; disabled?: boolean }>(), { disabled: false })

const emit = defineEmits<{ busy: [value: boolean] }>()

const tasks = useTaskStore()
const pending = ref(false)

/** Legal next statuses (C4 mirror); empty only for `CANCELLED` (reopen instead). */
const targets = computed(() => allowedTargets(props.task.status))
const isReopen = computed(() => targets.value.length === 0)
const isDisabled = computed(() => props.disabled || pending.value)

async function apply(status: TaskStatus, reopen: boolean, select?: HTMLSelectElement) {
  pending.value = true
  emit('busy', true)

  const ok = await tasks.changeStatus(props.task.id, status, reopen)

  pending.value = false
  emit('busy', false)

  // OPEN-9: no optimistic update, so a rejected change must snap the control back to the
  // authoritative status (the store has already toasted the backend's `detail`, AC-1.3).
  if (!ok && select) select.value = props.task.status
}

function onPick(event: Event) {
  const select = event.target as HTMLSelectElement
  const next = select.value as TaskStatus
  if (next === props.task.status) return
  void apply(next, false, select)
}

function onReopen() {
  void apply('TODO', true)
}
</script>

<template>
  <button
    v-if="isReopen"
    type="button"
    class="status-reopen"
    :disabled="isDisabled"
    :aria-busy="pending"
    @click="onReopen"
  >
    Reopen as To-do
  </button>

  <select
    v-else
    class="status-control"
    :value="task.status"
    :disabled="isDisabled"
    :aria-busy="pending"
    :aria-label="`Change status of ${task.title}`"
    @change="onPick"
  >
    <option v-if="!targets.includes(task.status)" :value="task.status" disabled>
      {{ STATUS_LABEL[task.status] }} (current)
    </option>
    <option v-for="status in targets" :key="status" :value="status">
      {{ STATUS_LABEL[status] }}
    </option>
  </select>
</template>

<style scoped>
.status-control,
.status-reopen {
  max-width: 160px;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  cursor: pointer;
}

.status-control:disabled,
.status-reopen:disabled {
  cursor: progress;
  opacity: 0.6;
}

.status-reopen {
  border-color: var(--primary);
  color: var(--primary);
  font-weight: 600;
  white-space: nowrap;
}
</style>
