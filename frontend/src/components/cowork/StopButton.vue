<script setup lang="ts">
defineEmits<{ stop: [] }>()
</script>

<template>
  <button type="button" class="stop" @click="$emit('stop')">Stop</button>
</template>

<style scoped>
.stop {
  border: 1px solid var(--danger);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--danger);
  padding: var(--space-1) var(--space-3);
  cursor: pointer;
  font: inherit;
}
</style>
