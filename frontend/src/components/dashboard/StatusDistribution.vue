<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'

import { STATUS_LABEL, type TaskStatus } from '@/domain/task'
import { tasksRouteWith } from '@/utils/query'

// FR-F-14 status-distribution visual: a CSS stacked bar + a legend, no chart library
// (OPEN-7). Every number comes from the stats payload.

const props = defineProps<{ byStatus: Record<TaskStatus, number>; total: number }>()

/** Workflow order, with the two terminal-ish statuses last. */
const WORKFLOW_ORDER: TaskStatus[] = [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
  'BLOCKED',
  'CANCELLED',
]

const hovered = ref<TaskStatus | null>(null)

type Segment = { status: TaskStatus; label: string; count: number; percent: number }

const segments = computed<Segment[]>(() =>
  WORKFLOW_ORDER.map((status) => {
    const count = props.byStatus[status]
    return {
      status,
      label: STATUS_LABEL[status],
      count,
      percent: props.total > 0 ? (count / props.total) * 100 : 0,
    }
  }),
)

const ariaLabel = computed(() => {
  if (props.total === 0) return 'Status distribution: no tasks'
  const parts = segments.value.map((segment) => `${segment.label} ${segment.count}`)
  return `Status distribution: ${parts.join(', ')}`
})

/** Segment colours reuse the FE-01 `--status-*-fg` tokens. */
function colour(status: TaskStatus): string {
  return `var(--status-${status.toLowerCase().replace(/_/g, '-')}-fg)`
}
</script>

<template>
  <section class="distribution">
    <h3 class="panel-title">Status distribution</h3>

    <template v-if="total === 0">
      <div class="dist-bar" role="img" aria-label="Status distribution: no tasks">
        <span class="dist-track" />
      </div>
      <p class="dist-empty">No tasks yet</p>
    </template>

    <template v-else>
      <div class="dist-bar" role="img" :aria-label="ariaLabel">
        <span
          v-for="segment in segments"
          :key="segment.status"
          class="dist-segment"
          :class="{ 'is-active': hovered === segment.status }"
          :style="{ width: `${segment.percent}%`, background: colour(segment.status) }"
          :data-status="segment.status"
          @mouseenter="hovered = segment.status"
          @mouseleave="hovered = null"
        />
      </div>

      <ul class="dist-legend">
        <li v-for="segment in segments" :key="segment.status">
          <RouterLink
            class="legend-row"
            :class="{ 'is-active': hovered === segment.status }"
            :to="tasksRouteWith({ statuses: [segment.status] })"
            :data-status="segment.status"
            @mouseenter="hovered = segment.status"
            @mouseleave="hovered = null"
          >
            <span
              class="legend-swatch"
              :style="{ background: colour(segment.status) }"
              aria-hidden="true"
            />
            <span class="legend-label">{{ segment.label }}</span>
            <span class="legend-count">{{ segment.count }}</span>
            <span class="legend-percent">{{ Math.round(segment.percent) }}%</span>
          </RouterLink>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.distribution {
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

.dist-bar {
  display: flex;
  width: 100%;
  height: 14px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--surface-alt);
}

.dist-track {
  flex: 1;
}

.dist-segment {
  height: 100%;
  transition: filter 0.15s ease;
}

.dist-segment.is-active {
  filter: brightness(1.25);
}

.dist-empty {
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
}

.dist-legend {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.legend-row {
  display: grid;
  grid-template-columns: 12px 1fr auto auto;
  align-items: center;
  gap: var(--space-2);
  padding: 2px var(--space-1);
  border-radius: var(--radius);
  color: inherit;
  font-size: 13px;
}

.legend-row:hover,
.legend-row.is-active {
  background: var(--surface-alt);
  text-decoration: none;
}

.legend-swatch {
  width: 12px;
  height: 12px;
  border-radius: 3px;
}

.legend-count,
.legend-percent {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
</style>
