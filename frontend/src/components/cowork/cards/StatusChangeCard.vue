<script setup lang="ts">
import { computed } from 'vue'

import { STATUS_LABEL } from '@/domain/task'
import type { TaskStatus } from '@/domain/task'
import type { PendingStatusChange } from '@/stores/cowork'

/** The status plan `update_task_status` proposed: per-task legality, then one decision. */
const props = defineProps<{ change: PendingStatusChange }>()

const emit = defineEmits<{
  approve: []
  cancel: []
}>()

const label = (status: string) => STATUS_LABEL[status as TaskStatus] ?? status

const hasAllowed = computed(() => props.change.plan.some((entry) => entry.allowed))
</script>

<template>
  <section class="card status-change" aria-label="Confirm status change">
    <header class="card-head">
      <strong>Confirm status change → {{ label(change.status) }}</strong>
      <span v-if="change.reopen" class="reopen">reopen</span>
    </header>
    <ul class="plan">
      <li
        v-for="entry in change.plan"
        :key="entry.taskId"
        class="row"
        :class="{ blocked: !entry.allowed }"
      >
        <span class="title">{{ entry.title }}</span>
        <span class="move">
          {{ label(entry.from) }} → {{ label(entry.to) }}
          <template v-if="entry.unchanged"> (unchanged)</template>
        </span>
        <span v-if="!entry.allowed" class="reason">{{ entry.reason ?? 'not allowed' }}</span>
      </li>
    </ul>
    <div class="actions">
      <button
        type="button"
        class="btn primary"
        :disabled="change.busy || !hasAllowed"
        @click="emit('approve')"
      >
        Approve all
      </button>
      <button type="button" class="btn ghost" :disabled="change.busy" @click="emit('cancel')">
        Cancel
      </button>
    </div>
  </section>
</template>

<style scoped>
.card {
  border: 1px solid var(--border);
  border-left: 4px solid var(--primary);
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

.reopen {
  font-size: 11px;
  color: var(--warning);
}

.plan {
  list-style: none;
  margin: 0 0 var(--space-2);
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: 13px;
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: baseline;
}

.row.blocked .move {
  color: var(--text-muted);
  text-decoration: line-through;
}

.reason {
  color: var(--danger);
  font-size: 12px;
}

.actions {
  display: flex;
  gap: var(--space-2);
}

.btn {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  padding: var(--space-1) var(--space-3);
  cursor: pointer;
  font: inherit;
}

.btn.primary {
  background: var(--primary);
  border-color: var(--primary);
  color: #ffffff;
}

.btn.ghost {
  border-color: transparent;
  color: var(--text-muted);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
