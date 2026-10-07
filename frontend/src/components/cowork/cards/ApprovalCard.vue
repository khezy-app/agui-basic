<script setup lang="ts">
import { computed } from 'vue'

import { RESTORED_NOTICE } from '@/agui/resume'
import type { MutationDescription, PendingApproval } from '@/agui/resume'

/**
 * The mutation waiting for the user's decision (FE-12 `pendingApproval`).
 *
 * It renders `describeMutation`'s label/value lines, never the raw arguments: the whole
 * point of the card is that a human can read what is about to change (FR-AI-14).
 */
const props = defineProps<{
  approval: PendingApproval
  description: MutationDescription | null
  /** True while the resume is in flight, which also disables the buttons. */
  inFlight?: boolean
}>()

const emit = defineEmits<{
  approve: [id: string]
  reject: [id: string]
  dismiss: [id: string]
}>()

const pending = computed(() => props.approval.status === 'pending')
const busy = computed(() => props.inFlight === true || !pending.value)
</script>

<template>
  <section class="card approval" aria-label="Approval needed">
    <header class="card-head">
      <strong>Approval needed</strong>
      <span v-if="approval.restored" class="restored">{{ RESTORED_NOTICE }}</span>
    </header>
    <p class="title">{{ description?.title ?? approval.summary }}</p>
    <dl v-if="description && description.lines.length > 0" class="lines">
      <template v-for="line in description.lines" :key="line.label">
        <dt>{{ line.label }}</dt>
        <dd>{{ line.value }}</dd>
      </template>
    </dl>
    <p v-if="approval.reason !== ''" class="reason">{{ approval.reason }}</p>
    <p v-if="approval.error !== null" class="error" role="alert">{{ approval.error }}</p>
    <div class="actions">
      <button
        type="button"
        class="btn primary"
        :disabled="busy"
        @click="emit('approve', approval.interruptId)"
      >
        Approve
      </button>
      <button
        type="button"
        class="btn"
        :disabled="busy"
        @click="emit('reject', approval.interruptId)"
      >
        Reject
      </button>
      <button
        type="button"
        class="btn ghost"
        :disabled="busy"
        @click="emit('dismiss', approval.interruptId)"
      >
        Dismiss
      </button>
    </div>
  </section>
</template>

<style scoped>
.card {
  border: 1px solid var(--border);
  border-left: 4px solid var(--warning);
  border-radius: var(--radius);
  background: var(--surface);
  padding: var(--space-2) var(--space-3);
}

.card-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
}

.restored {
  font-size: 11px;
  color: var(--text-muted);
}

.title {
  font-weight: 500;
  margin: var(--space-1) 0;
}

.lines {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px var(--space-2);
  margin: 0 0 var(--space-2);
  font-size: 13px;
}

.lines dt {
  color: var(--text-muted);
}

.lines dd {
  margin: 0;
  word-break: break-word;
}

.reason {
  color: var(--text-muted);
  font-size: 12px;
  font-style: italic;
}

.error {
  color: var(--danger);
  font-size: 13px;
}

.actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-2);
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
