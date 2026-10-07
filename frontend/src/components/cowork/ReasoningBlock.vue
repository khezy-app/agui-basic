<script setup lang="ts">
/**
 * The model's scratchpad (FR-AI-26): collapsed by default, visually distinct from the
 * answer, and never mistaken for it.
 */
defineProps<{ reasoning: string }>()
</script>

<template>
  <details class="reasoning">
    <summary>Thought process</summary>
    <pre class="text">{{ reasoning }}</pre>
  </details>
</template>

<style scoped>
.reasoning {
  margin-bottom: var(--space-1);
}

.reasoning summary {
  cursor: pointer;
  color: var(--text-muted);
  font-size: 12px;
  font-style: italic;
}

.text {
  margin: var(--space-1) 0 0;
  padding: var(--space-2);
  background: var(--surface-alt);
  border-radius: var(--radius);
  color: var(--text-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  font-style: italic;
  white-space: pre-wrap;
}
</style>
