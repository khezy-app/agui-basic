<script setup lang="ts">
import { computed, ref } from 'vue'

import { useConfirm } from '@/composables/confirm'
import { commonTargets } from '@/domain/statusFlow'
import { STATUS_LABEL, type TaskStatus } from '@/domain/task'
import { useTaskStore } from '@/stores/tasks'
import { useUiStore } from '@/stores/ui'

const tasks = useTaskStore()
const ui = useUiStore()
const { confirm } = useConfirm()

/** Backend bulk-status limit; beyond it the bulk actions are disabled with a hint. */
const MAX_SELECTION = 100

const panelOpen = ref(false)
const target = ref<TaskStatus | ''>('')
const panelError = ref<string | null>(null)
const busy = ref(false)

const count = computed(() => tasks.selectedIds.length)
const selected = computed(() => tasks.selectedTasks)
const overLimit = computed(() => count.value > MAX_SELECTION)

/** Intersection of every selected task's legal targets — an empty set means "no common move". */
const common = computed<TaskStatus[]>(() =>
  commonTargets(selected.value.map((task) => task.status)),
)

const hasNoCommon = computed(() => count.value > 0 && common.value.length === 0)

function togglePanel() {
  panelOpen.value = !panelOpen.value
  panelError.value = null
  target.value = ''
}

async function onConfirm() {
  if (target.value === '' || count.value === 0) return

  busy.value = true
  panelError.value = null

  const ids = [...tasks.selectedIds]
  const ok = await tasks.bulkChangeStatus(ids, target.value, false)

  busy.value = false
  if (ok) {
    panelOpen.value = false
    target.value = ''
    return
  }

  // The store already toasted the backend response; mirror its `detail` here so the panel
  // — which stays open so the user can pick another target — shows the multi-line reason
  // (AC-1.5).
  const latestError = [...ui.toasts].reverse().find((toast) => toast.kind === 'error')
  panelError.value = latestError?.detail || latestError?.title || 'The change was rejected.'
}

async function onDeleteSelected() {
  const ids = [...tasks.selectedIds]
  if (ids.length === 0) return

  const titles = selected.value.map((task) => task.title)
  const confirmed = await confirm({
    title: 'Delete selected tasks',
    body: `Delete ${ids.length} task(s)?\n\n${titles.join('\n')}`,
    confirmLabel: 'Delete',
    danger: true,
  })
  if (!confirmed) return

  // `deleteTask` resolves to a boolean (the store swallows the rejection), so the outcomes
  // — not `Promise.allSettled` — decide what stays selected. Each failure is already
  // reported individually by the store's error policy.
  const outcomes = await Promise.all(
    ids.map(async (id) => ({ id, ok: await tasks.deleteTask(id) })),
  )
  const failedIds = outcomes.filter((outcome) => !outcome.ok).map((outcome) => outcome.id)
  tasks.selectAll(failedIds)
  if (failedIds.length === 0) panelOpen.value = false
}
</script>

<template>
  <div v-if="count > 0" class="bulk-bar" role="region" aria-label="Bulk actions">
    <div class="bulk-header">
      <span class="bulk-count">{{ count }} selected</span>
      <span v-if="overLimit" class="bulk-limit">
        Select at most {{ MAX_SELECTION }} tasks for bulk actions.
      </span>
      <button type="button" class="bulk-clear" @click="tasks.clearSelection()">Clear</button>
    </div>

    <div class="bulk-actions">
      <button type="button" :disabled="overLimit" @click="togglePanel">Change status…</button>
      <button type="button" :disabled="overLimit" @click="onDeleteSelected">Delete selected</button>
    </div>

    <div v-if="panelOpen" class="bulk-panel">
      <ul class="bulk-statuses">
        <li v-for="task in selected" :key="task.id">
          {{ task.title }} — {{ STATUS_LABEL[task.status] }}
        </li>
      </ul>

      <template>
        <label class="bulk-target">
          Target status
          <select v-model="target" :disabled="busy || hasNoCommon">
            <option value="" disabled>Choose…</option>
            <option v-for="status in common" :key="status" :value="status">
              {{ STATUS_LABEL[status] }}
            </option>
          </select>
        </label>
        <button
          type="button"
          class="bulk-confirm"
          :disabled="target === '' || busy || hasNoCommon"
          @click="onConfirm"
        >
          Confirm
        </button>
      </template>

      <p v-if="hasNoCommon" class="bulk-empty-hint">
        These tasks have no common legal status, so they cannot all be changed together.
      </p>

      <p v-if="panelError" class="bulk-error">{{ panelError }}</p>
    </div>
  </div>
</template>

<style scoped>
.bulk-bar {
  position: sticky;
  bottom: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--primary);
  border-radius: var(--radius);
  background: #eff6ff;
}

.bulk-header,
.bulk-actions {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.bulk-count {
  font-weight: 600;
}

.bulk-limit {
  color: var(--warning);
}

.bulk-actions button,
.bulk-confirm {
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  cursor: pointer;
}

.bulk-actions button:disabled,
.bulk-confirm:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.bulk-confirm {
  border-color: transparent;
  background: var(--primary);
  color: #ffffff;
  font-weight: 600;
}

.bulk-panel {
  flex-basis: 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  padding-top: var(--space-2);
  border-top: 1px solid var(--border);
}

.bulk-statuses {
  flex-basis: 100%;
  margin: 0;
  padding-left: var(--space-3);
  color: var(--text-muted);
  max-height: 120px;
  overflow: auto;
}

.bulk-target {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

.bulk-empty-hint {
  margin: 0;
  color: var(--warning);
}

.bulk-error {
  flex-basis: 100%;
  margin: 0;
  padding: var(--space-2);
  border-left: 3px solid var(--danger);
  background: #fef2f2;
  color: var(--danger);
  white-space: pre-line;
}
</style>
