<script setup lang="ts">
withDefaults(defineProps<{ rows?: number; label?: string }>(), {
  rows: 4,
  label: 'Loading tasks',
})
</script>

<template>
  <div class="loading-block" role="status" aria-busy="true">
    <span class="visually-hidden">{{ label }}</span>
    <div v-for="row in rows" :key="row" class="skeleton-line" />
  </div>
</template>

<style scoped>
.loading-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.skeleton-line {
  height: 18px;
  border-radius: 4px;
  background: linear-gradient(90deg, #eef2f7 25%, #e2e8f0 37%, #eef2f7 63%);
  background-size: 400% 100%;
  animation: skeleton 1.4s ease infinite;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

@keyframes skeleton {
  0% {
    background-position: 100% 50%;
  }
  100% {
    background-position: 0 50%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton-line {
    animation: none;
  }
}
</style>
