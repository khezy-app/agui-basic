<script setup lang="ts">
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
</script>

<template>
  <div class="toast-region" aria-live="polite" aria-atomic="false">
    <TransitionGroup name="toast">
      <div
        v-for="toast in ui.toasts"
        :key="toast.id"
        class="toast"
        :class="`toast-${toast.kind}`"
        role="status"
      >
        <div class="toast-body">
          <p class="toast-title">{{ toast.title }}</p>
          <p v-if="toast.detail" class="toast-detail">{{ toast.detail }}</p>
        </div>
        <button
          type="button"
          class="toast-close"
          aria-label="Dismiss notification"
          @click="ui.dismissToast(toast.id)"
        >
          ×
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-region {
  position: fixed;
  right: var(--space-4);
  bottom: var(--space-4);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: min(360px, calc(100vw - 2 * var(--space-4)));
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-left: 4px solid var(--text-muted);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: 0 8px 24px rgb(15 23 42 / 12%);
  pointer-events: auto;
}

.toast-success {
  border-left-color: var(--success);
}

.toast-error {
  border-left-color: var(--danger);
}

.toast-info {
  border-left-color: var(--primary);
}

.toast-body {
  flex: 1;
  min-width: 0;
}

.toast-title {
  margin: 0;
  font-weight: 600;
}

.toast-detail {
  margin: var(--space-1) 0 0;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.toast-close {
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.toast-close:hover {
  color: var(--text);
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 150ms ease,
    transform 150ms ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
