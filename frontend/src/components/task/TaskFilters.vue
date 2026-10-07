<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
} from '@/domain/task'
import { useTaskStore } from '@/stores/tasks'
import { useTeamStore } from '@/stores/team'

// Every control writes through `setFilter`/`setQuery` — never by mutating `store.query` —
// so the store→URL watcher in `TaskListView` fires exactly once (FE-05 §4.2).

const tasks = useTaskStore()
const team = useTeamStore()

const expanded = ref(true)

function toggleStatus(status: TaskStatus, event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  const next = checked
    ? [...tasks.query.statuses, status]
    : tasks.query.statuses.filter((entry) => entry !== status)
  void tasks.setFilter('statuses', next)
}

function togglePriority(priority: TaskPriority, event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  const next = checked
    ? [...tasks.query.priorities, priority]
    : tasks.query.priorities.filter((entry) => entry !== priority)
  void tasks.setFilter('priorities', next)
}

const assigneeValue = computed(() => {
  if (tasks.query.unassigned) return 'unassigned'
  return tasks.query.assigneeId ?? ''
})

function onAssigneeChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (value === 'unassigned') void tasks.setQuery({ assigneeId: null, unassigned: true })
  else if (value === '') void tasks.setQuery({ assigneeId: null, unassigned: false })
  else void tasks.setQuery({ assigneeId: value, unassigned: false })
}

// A real tag facet endpoint does not exist (no spec ID), so the datalist is seeded from
// the tags seen on the currently loaded page — a local convenience, not a data source.
const tagInput = ref(tasks.query.tag ?? '')
watch(
  () => tasks.query.tag,
  (value) => {
    tagInput.value = value ?? ''
  },
)

const knownTags = computed(() => {
  const seen = new Set<string>()
  for (const task of tasks.tasks) for (const tag of task.tags) seen.add(tag)
  return [...seen].sort()
})

function applyTag() {
  const value = tagInput.value.trim().toLowerCase()
  void tasks.setFilter('tag', value === '' ? null : value)
}

type DueOption = 'any' | 'overdue' | 'today' | 'week' | 'month'

const DUE_OPTIONS: { value: DueOption; label: string }[] = [
  { value: 'any', label: 'Any due date' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today' },
  { value: 'week', label: 'Due in 7 days' },
  { value: 'month', label: 'Due in 30 days' },
]

const dueValue = computed<DueOption>(() => {
  if (tasks.query.overdue) return 'overdue'
  switch (tasks.query.dueWithinDays) {
    case 0:
      return 'today'
    case 7:
      return 'week'
    case 30:
      return 'month'
    default:
      return 'any'
  }
})

function onDueChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value as DueOption
  switch (value) {
    case 'overdue':
      void tasks.setQuery({ overdue: true, dueWithinDays: null })
      break
    case 'today':
      void tasks.setQuery({ overdue: false, dueWithinDays: 0 })
      break
    case 'week':
      void tasks.setQuery({ overdue: false, dueWithinDays: 7 })
      break
    case 'month':
      void tasks.setQuery({ overdue: false, dueWithinDays: 30 })
      break
    default:
      void tasks.setQuery({ overdue: false, dueWithinDays: null })
  }
}

const fromInput = ref(tasks.query.createdFrom ?? '')
const toInput = ref(tasks.query.createdTo ?? '')
watch(
  () => tasks.query.createdFrom,
  (value) => {
    fromInput.value = value ?? ''
  },
)
watch(
  () => tasks.query.createdTo,
  (value) => {
    toInput.value = value ?? ''
  },
)

const invalidRange = computed(
  () => fromInput.value !== '' && toInput.value !== '' && fromInput.value > toInput.value,
)

function applyCreatedRange() {
  if (invalidRange.value) return
  void tasks.setQuery({ createdFrom: fromInput.value || null, createdTo: toInput.value || null })
}

type Chip = { key: string; label: string; value: string; remove: () => void }

function memberName(id: string): string {
  return team.byId.get(id)?.displayName ?? id
}

const chips = computed<Chip[]>(() => {
  const result: Chip[] = []

  for (const status of tasks.query.statuses) {
    result.push({
      key: `status:${status}`,
      label: 'Status',
      value: STATUS_LABEL[status],
      remove: () =>
        void tasks.setFilter(
          'statuses',
          tasks.query.statuses.filter((entry) => entry !== status),
        ),
    })
  }

  for (const priority of tasks.query.priorities) {
    result.push({
      key: `priority:${priority}`,
      label: 'Priority',
      value: PRIORITY_LABEL[priority],
      remove: () =>
        void tasks.setFilter(
          'priorities',
          tasks.query.priorities.filter((entry) => entry !== priority),
        ),
    })
  }

  if (tasks.query.unassigned) {
    result.push({
      key: 'unassigned',
      label: 'Assignee',
      value: 'Unassigned',
      remove: () => void tasks.setQuery({ unassigned: false }),
    })
  } else if (tasks.query.assigneeId !== null) {
    result.push({
      key: 'assignee',
      label: 'Assignee',
      value: memberName(tasks.query.assigneeId),
      remove: () => void tasks.setQuery({ assigneeId: null }),
    })
  }

  if (tasks.query.tag !== null) {
    result.push({
      key: 'tag',
      label: 'Tag',
      value: tasks.query.tag,
      remove: () => void tasks.setFilter('tag', null),
    })
  }

  if (tasks.query.q !== null) {
    result.push({
      key: 'q',
      label: 'Search',
      value: tasks.query.q,
      remove: () => void tasks.setFilter('q', null),
    })
  }

  if (tasks.query.overdue) {
    result.push({
      key: 'overdue',
      label: 'Due',
      value: 'Overdue',
      remove: () => void tasks.setFilter('overdue', false),
    })
  } else if (tasks.query.dueWithinDays !== null) {
    result.push({
      key: 'due',
      label: 'Due',
      value: `within ${tasks.query.dueWithinDays} day(s)`,
      remove: () => void tasks.setFilter('dueWithinDays', null),
    })
  }

  if (tasks.query.createdFrom !== null || tasks.query.createdTo !== null) {
    result.push({
      key: 'created',
      label: 'Created',
      value: `${tasks.query.createdFrom ?? '…'} → ${tasks.query.createdTo ?? '…'}`,
      remove: () => void tasks.setQuery({ createdFrom: null, createdTo: null }),
    })
  }

  return result
})

function clearAll() {
  void tasks.clearFilters()
}
</script>

<template>
  <section class="task-filters" aria-label="Task filters">
    <div class="filters-head">
      <h3 class="filters-title">Filters</h3>
      <button
        class="filters-toggle"
        type="button"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        {{ expanded ? 'Hide filters' : 'Show filters' }}
      </button>
    </div>

    <div class="filters-panel" :class="{ 'is-collapsed': !expanded }">
      <fieldset class="filter-group">
        <legend>Status</legend>
        <div class="option-grid">
          <label v-for="status in TASK_STATUSES" :key="status" class="filter-option">
            <input
              type="checkbox"
              :checked="tasks.query.statuses.includes(status)"
              @change="toggleStatus(status, $event)"
            />
            {{ STATUS_LABEL[status] }}
          </label>
        </div>
      </fieldset>

      <fieldset class="filter-group">
        <legend>Priority</legend>
        <div class="option-grid">
          <label v-for="priority in TASK_PRIORITIES" :key="priority" class="filter-option">
            <input
              type="checkbox"
              :checked="tasks.query.priorities.includes(priority)"
              @change="togglePriority(priority, $event)"
            />
            {{ PRIORITY_LABEL[priority] }}
          </label>
        </div>
      </fieldset>

      <div class="filter-group filter-group--fields">
        <label class="filter-field">
          <span class="filter-label">Assignee</span>
          <select aria-label="Assignee" :value="assigneeValue" @change="onAssigneeChange">
            <option value="">All</option>
            <option value="unassigned">Unassigned</option>
            <option v-for="member in team.members" :key="member.id" :value="member.id">
              {{ member.displayName }}
            </option>
          </select>
        </label>

        <label class="filter-field">
          <span class="filter-label">Tag</span>
          <span class="inline-input">
            <input
              v-model="tagInput"
              list="task-tag-options"
              type="text"
              placeholder="any tag"
              @keyup.enter="applyTag"
            />
            <button type="button" @click="applyTag">Apply</button>
          </span>
          <datalist id="task-tag-options">
            <option v-for="tag in knownTags" :key="tag" :value="tag" />
          </datalist>
        </label>

        <label class="filter-field">
          <span class="filter-label">Due</span>
          <select aria-label="Due" :value="dueValue" @change="onDueChange">
            <option v-for="option in DUE_OPTIONS" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>

        <div class="filter-field">
          <span class="filter-label">Created between</span>
          <span class="inline-input">
            <input v-model="fromInput" type="date" aria-label="Created from" />
            <span aria-hidden="true">–</span>
            <input v-model="toInput" type="date" aria-label="Created to" />
            <button type="button" :disabled="invalidRange" @click="applyCreatedRange">Apply</button>
          </span>
          <span v-if="invalidRange" class="range-hint">From must be on or before To.</span>
        </div>

        <button class="clear-all" type="button" :disabled="!tasks.isFiltered" @click="clearAll">
          Clear all
        </button>
      </div>
    </div>

    <div v-if="chips.length > 0" class="filter-chips" aria-label="Active filters">
      <span v-for="chip in chips" :key="chip.key" class="filter-chip">
        <span class="chip-text">{{ chip.label }}: {{ chip.value }}</span>
        <button
          type="button"
          class="chip-remove"
          :aria-label="`Remove ${chip.label} filter`"
          @click="chip.remove"
        >
          ×
        </button>
      </span>
      <button type="button" class="chip-clear" @click="clearAll">Clear all</button>
    </div>
  </section>
</template>

<style scoped>
.task-filters {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.filters-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.filters-title {
  margin: 0;
  font-size: 14px;
}

.filters-toggle {
  display: none;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-alt);
  cursor: pointer;
}

.filters-panel {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--space-3);
}

.filter-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.filter-group legend {
  padding: 0 var(--space-1);
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
}

.filter-group--fields {
  gap: var(--space-2);
}

.option-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: var(--space-1) var(--space-3);
}

.filter-option {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  white-space: nowrap;
}

.filter-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.filter-label {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
}

.filter-field select,
.filter-field input {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.inline-input {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

.inline-input button,
.clear-all {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-alt);
  cursor: pointer;
}

.inline-input button:disabled,
.clear-all:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.range-hint {
  color: var(--danger);
  font-size: 12px;
}

.clear-all {
  align-self: flex-end;
}

.filter-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 2px var(--space-2);
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-alt);
  font-size: 12px;
}

.chip-remove {
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  line-height: 1;
}

.chip-remove:hover {
  color: var(--danger);
}

.chip-clear {
  border: 0;
  background: transparent;
  color: var(--primary);
  cursor: pointer;
  font-size: 12px;
  text-decoration: underline;
}

@media (max-width: 720px) {
  .filters-toggle {
    display: inline-flex;
  }

  .filters-panel.is-collapsed {
    display: none;
  }
}
</style>
