<script setup lang="ts">
/** An `error` transcript item or a failed tool result: message, optional code, retry. */
defineProps<{
  message: string
  code?: string | null
  /** Offered only when the store says the failed run can be retried (FE-09). */
  retryable?: boolean
}>()

const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <section class="card error" role="alert">
    <p class="message">{{ message }}</p>
    <p v-if="code" class="code">code: {{ code }}</p>
    <button v-if="retryable" type="button" class="btn" @click="emit('retry')">Retry</button>
  </section>
</template>

<style scoped>
.card {
  border: 1px solid var(--border);
  border-left: 4px solid var(--danger);
  border-radius: var(--radius);
  background: var(--surface);
  padding: var(--space-2) var(--space-3);
}

.message {
  margin: 0;
  color: var(--danger);
}

.code {
  margin: var(--space-1) 0 0;
  color: var(--text-muted);
  font-size: 12px;
}

.btn {
  margin-top: var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  padding: var(--space-1) var(--space-3);
  cursor: pointer;
  font: inherit;
}
</style>
