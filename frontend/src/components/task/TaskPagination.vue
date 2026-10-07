<script setup lang="ts">
import { computed } from 'vue'

import { useTaskStore } from '@/stores/tasks'

const tasks = useTaskStore()

const SIZE_OPTIONS = [10, 20, 50, 100] as const

const currentPage = computed(() => tasks.query.page + 1)
const pageTotal = computed(() => Math.max(tasks.pageCount, 1))
const canGoPrev = computed(() => tasks.query.page > 0)
const canGoNext = computed(() => tasks.query.page < tasks.pageCount - 1)

function onSizeChange(event: Event) {
  tasks.setQuery({ size: Number((event.target as HTMLSelectElement).value) })
}

function goPrev() {
  void tasks.setPage(tasks.query.page - 1)
}

function goNext() {
  void tasks.setPage(tasks.query.page + 1)
}
</script>

<template>
  <div class="pagination">
    <span class="pagination-count">{{ tasks.totalElements }} task(s)</span>

    <label class="pagination-size">
      Rows per page
      <select :value="tasks.query.size" @change="onSizeChange">
        <option v-for="size in SIZE_OPTIONS" :key="size" :value="size">{{ size }}</option>
      </select>
    </label>

    <div class="pagination-pages">
      <button type="button" :disabled="!canGoPrev" @click="goPrev">Prev</button>
      <span class="pagination-label">Page {{ currentPage }} of {{ pageTotal }}</span>
      <button type="button" :disabled="!canGoNext" @click="goNext">Next</button>
    </div>
  </div>
</template>

<style scoped>
.pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) 0;
}

.pagination-count {
  color: var(--text-muted);
}

.pagination-size {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  margin-left: auto;
}

.pagination-pages {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.pagination-pages button {
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  cursor: pointer;
}

.pagination-pages button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
</style>
