<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import { PRIORITY_LABEL, TASK_PRIORITIES, type TaskPriority } from '@/domain/task'
import { tasksRouteWith } from '@/utils/query'

// The priority half of FR-F-14. Kept as its own component (rather than folded into
// `StatusDistribution`) so the two dimensions — and their deep links — are independent;
// note this choice in the handoff.

const props = defineProps<{ byPriority: Record<TaskPriority, number> }>()

const total = computed(() =>
  TASK_PRIORITIES.reduce((sum, priority) => sum + props.byPriority[priority], 0),
)

const rows = computed(() =>
  TASK_PRIORITIES.map((priority) => {
    const count = props.byPriority[priority]
    return {
      priority,
      label: PRIORITY_LABEL[priority],
      count,
      percent: total.value > 0 ? (count / total.value) * 100 : 0,
    }
  }),
)
</script>

<template>
  <section class="priority-breakdown">
    <h3 class="panel-title">Priority breakdown</h3>

    <ul class="priority-rows">
      <li v-for="row in rows" :key="row.priority">
        <RouterLink class="priority-row" :to="tasksRouteWith({ priorities: [row.priority] })">
          <span class="priority-label">{{ row.label }}</span>
          <span class="priority-track">
            <span
              class="priority-bar"
              :style="{ width: `${row.percent}%` }"
              :class="`priority-${row.priority.toLowerCase()}`"
            />
          </span>
          <span class="priority-count">{{ row.count }}</span>
        </RouterLink>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.priority-breakdown {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.panel-title {
  margin: 0;
  font-size: 14px;
}

.priority-rows {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.priority-row {
  display: grid;
  grid-template-columns: 64px 1fr 32px;
  align-items: center;
  gap: var(--space-2);
  padding: 2px var(--space-1);
  border-radius: var(--radius);
  color: inherit;
  font-size: 13px;
}

.priority-row:hover {
  text-decoration: none;
  background: var(--surface-alt);
}

.priority-track {
  height: 10px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--surface-alt);
}

.priority-bar {
  display: block;
  height: 100%;
}

.priority-count {
  color: var(--text-muted);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* Reuse the FE-01 priority swatch colours. */
.priority-low {
  background: var(--priority-low-fg);
}

.priority-medium {
  background: var(--priority-medium-fg);
}

.priority-high {
  background: var(--priority-high-fg);
}

.priority-urgent {
  background: var(--priority-urgent-fg);
}
</style>
