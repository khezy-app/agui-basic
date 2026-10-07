<script setup lang="ts">
defineProps<{
  title: string
  description: string
  actionLabel?: string
}>()

defineEmits<{ action: [] }>()
</script>

<template>
  <div class="empty-state">
    <span class="empty-icon" aria-hidden="true">◎</span>
    <h3 class="empty-title">{{ title }}</h3>
    <p class="empty-description">{{ description }}</p>
    <button v-if="actionLabel" type="button" class="empty-action" @click="$emit('action')">
      {{ actionLabel }}
    </button>
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-4);
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  text-align: center;
}

.empty-icon {
  font-size: 28px;
  color: var(--text-muted);
}

.empty-title {
  margin: 0;
}

.empty-description {
  margin: 0;
  max-width: 42ch;
  color: var(--text-muted);
}

.empty-action {
  margin-top: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: var(--primary);
  color: #ffffff;
  font-weight: 600;
  cursor: pointer;
}

.empty-action:hover {
  filter: brightness(1.05);
}
</style>
