<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { useConfirm } from '@/composables/confirm'

const { state, settleConfirm } = useConfirm()
const confirmButton = ref<HTMLButtonElement | null>(null)

// Focus the confirm action on open (FR-F-08: delete requires confirmation).
watch(state, async (open) => {
  if (open) {
    await nextTick()
    confirmButton.value?.focus()
  }
})

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && state.value) {
    event.preventDefault()
    settleConfirm(false)
  }
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div v-if="state" class="confirm-backdrop">
    <div class="confirm-dialog" role="dialog" aria-modal="true" :aria-label="state.title">
      <h2 class="confirm-title">{{ state.title }}</h2>
      <p class="confirm-body">{{ state.body }}</p>
      <div class="confirm-actions">
        <button type="button" class="confirm-cancel" @click="settleConfirm(false)">Cancel</button>
        <button
          ref="confirmButton"
          type="button"
          class="confirm-accept"
          :class="{ danger: state.danger }"
          @click="settleConfirm(true)"
        >
          {{ state.confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.confirm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
  background: rgb(15 23 42 / 45%);
}

.confirm-dialog {
  width: min(420px, 100%);
  padding: var(--space-4);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: 0 20px 50px rgb(15 23 42 / 25%);
}

.confirm-title {
  margin: 0 0 var(--space-2);
  font-size: 16px;
}

.confirm-body {
  margin: 0 0 var(--space-4);
  color: var(--text-muted);
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

.confirm-cancel,
.confirm-accept {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  cursor: pointer;
}

.confirm-accept {
  border-color: transparent;
  background: var(--primary);
  color: #ffffff;
  font-weight: 600;
}

.confirm-accept.danger {
  background: var(--danger);
}
</style>
