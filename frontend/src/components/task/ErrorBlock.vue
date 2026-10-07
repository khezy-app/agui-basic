<script setup lang="ts">
import type { ApiError } from '@/api/errors'

// `error.message` is the C1 `title` (ApiError sets it in its constructor), so this shows
// exactly `title` + `detail` and never a stack trace or raw JSON (FR-F-03).
defineProps<{ error: ApiError | null }>()

defineEmits<{ retry: [] }>()
</script>

<template>
  <div class="error-block" role="alert">
    <div class="error-body">
      <p class="error-title">{{ error?.message ?? 'Something went wrong' }}</p>
      <p v-if="error?.detail" class="error-detail">{{ error.detail }}</p>
    </div>
    <button type="button" class="error-retry" @click="$emit('retry')">Retry</button>
  </div>
</template>

<style scoped>
.error-block {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--danger);
  border-left-width: 4px;
  border-radius: var(--radius);
  background: #fef2f2;
}

.error-title {
  margin: 0;
  font-weight: 600;
  color: var(--danger);
}

.error-detail {
  margin: var(--space-1) 0 0;
  color: var(--text-muted);
}

.error-retry {
  flex-shrink: 0;
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  cursor: pointer;
}
</style>
