<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import PriorityTag from '@/components/task/PriorityTag.vue'
import StatusBadge from '@/components/task/StatusBadge.vue'
import { formatDate } from '@/utils/dates'

import { parseTaskSummary } from '../resultShapes'

/** `get_task` result: one task's headline facts plus its description (FR-AI-22). */
const props = defineProps<{ content: unknown }>()

const result = computed(() => parseTaskSummary(props.content))
const brief = computed(() => result.value?.brief ?? null)
const description = computed(() => result.value?.description ?? '')
</script>

<template>
  <section v-if="brief" class="card" aria-label="Task summary result">
    <header class="card-head">
      <strong>{{ brief.title }}</strong>
      <div class="badges">
        <StatusBadge :status="brief.status" />
        <PriorityTag :priority="brief.priority" />
      </div>
    </header>
    <dl class="facts">
      <dt>Assignee</dt>
      <dd>{{ brief.assignee ?? 'Unassigned' }}</dd>
      <dt>Due</dt>
      <dd :class="{ overdue: brief.overdue }">
        {{ brief.overdue ? 'overdue · ' : '' }}{{ formatDate(brief.dueDate) }}
      </dd>
      <dt>Tags</dt>
      <dd>{{ brief.tags.length > 0 ? brief.tags.join(', ') : '—' }}</dd>
    </dl>
    <details v-if="description !== ''" class="description">
      <summary>Description</summary>
      <p>{{ description }}</p>
    </details>
    <RouterLink class="card-link" :to="`/tasks/${brief.id}`">Open task</RouterLink>
  </section>
</template>

<style scoped>
.card {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  padding: var(--space-2) var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-2);
}

.badges {
  display: flex;
  gap: var(--space-1);
}

.facts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px var(--space-2);
  margin: 0;
  font-size: 13px;
}

.facts dt {
  color: var(--text-muted);
}

.facts dd {
  margin: 0;
}

.facts dd.overdue {
  color: var(--danger);
  font-weight: 600;
}

.description summary {
  cursor: pointer;
  font-size: 13px;
  color: var(--text-muted);
}

.description p {
  font-size: 13px;
  white-space: pre-wrap;
}

.card-link {
  font-size: 12px;
  align-self: flex-start;
}
</style>
