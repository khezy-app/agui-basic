<script setup lang="ts">
import { onErrorCaptured, ref, watch } from 'vue'

/**
 * A card that throws during render must not blank the panel (FE-13 §4.6): the failure is
 * contained here and replaced with a small fallback, and everything around it keeps
 * rendering.
 */
const props = defineProps<{ resetKey?: unknown }>()

const failed = ref(false)

onErrorCaptured((error) => {
  console.error('cowork card failed to render', error)
  failed.value = true
  // Stop propagation: this is a contained rendering failure, not a panel-wide error.
  return false
})

watch(
  () => props.resetKey,
  () => {
    failed.value = false
  },
)
</script>

<template>
  <div v-if="failed" class="card-fallback" role="alert">This result could not be displayed</div>
  <slot v-else />
</template>

<style scoped>
.card-fallback {
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  padding: var(--space-2) var(--space-3);
  color: var(--text-muted);
  font-size: 13px;
}
</style>
