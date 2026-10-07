<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'

import { useConfirm } from '@/composables/confirm'
import type { Task, TaskSortField } from '@/domain/task'
import { useTaskStore } from '@/stores/tasks'
import { useTeamStore } from '@/stores/team'
import { formatDate, formatRelativeTime, isOverdueDisplay } from '@/utils/dates'

import PriorityTag from './PriorityTag.vue'
import StatusBadge from './StatusBadge.vue'
import TaskStatusControl from './TaskStatusControl.vue'

const tasks = useTaskStore()
const team = useTeamStore()
const router = useRouter()
const { confirm } = useConfirm()

const openMenuId = ref<string | null>(null)
const busyIds = ref<string[]>([])

const someSelected = computed(() => tasks.selectedIds.length > 0 && !tasks.allOnPageSelected)

function onToggleAll(event: Event) {
  if ((event.target as HTMLInputElement).checked) {
    tasks.selectAll(tasks.tasks.map((task) => task.id))
  } else {
    tasks.clearSelection()
  }
}

function toggleRow(id: string) {
  tasks.toggleSelection(id)
}

function isSelected(id: string): boolean {
  return tasks.selectedIds.includes(id)
}

function onBusy(id: string, value: boolean) {
  busyIds.value = value
    ? [...new Set([...busyIds.value, id])]
    : busyIds.value.filter((entry) => entry !== id)
}

function onSort(field: TaskSortField) {
  void tasks.setSort(field)
}

// Sort state is derived from the store, never local (FR-F-04).
function ariaSort(field: TaskSortField): 'ascending' | 'descending' | 'none' {
  if (tasks.query.sort !== field) return 'none'
  return tasks.query.descending ? 'descending' : 'ascending'
}

function indicator(field: TaskSortField): string {
  if (tasks.query.sort !== field) return '↕'
  return tasks.query.descending ? '▼' : '▲'
}

function assigneeName(task: Task): string {
  if (!task.assigneeId) return 'Unassigned'
  return team.byId.get(task.assigneeId)?.displayName ?? 'Unassigned'
}

function visibleTags(task: Task): string[] {
  return task.tags.slice(0, 3)
}

function extraTagCount(task: Task): number {
  return Math.max(task.tags.length - 3, 0)
}

function onRowClick(task: Task, event: MouseEvent) {
  const target = event.target as HTMLElement | null
  // Row click is a mouse convenience; interactive cells must keep their own behaviour.
  if (target?.closest('a, button, input, select, label')) return
  void router.push(`/tasks/${task.id}`)
}

function toggleMenu(id: string) {
  openMenuId.value = openMenuId.value === id ? null : id
}

function onDocumentClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest('.row-actions')) return
  openMenuId.value = null
}

async function onDelete(task: Task) {
  openMenuId.value = null
  const confirmed = await confirm({
    title: 'Delete task',
    body: `Delete “${task.title}”? This cannot be undone.`,
    confirmLabel: 'Delete',
    danger: true,
  })
  if (!confirmed) return
  await tasks.deleteTask(task.id)
}

onMounted(() => document.addEventListener('click', onDocumentClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick))
</script>

<template>
  <table class="task-table">
    <thead>
      <tr>
        <th class="col-select" scope="col">
          <input
            type="checkbox"
            aria-label="Select all tasks on this page"
            :checked="tasks.allOnPageSelected"
            :indeterminate="someSelected"
            @change="onToggleAll"
          />
        </th>

        <th class="col-title" scope="col" :aria-sort="ariaSort('title')">
          <button type="button" class="sort-button" @click="onSort('title')">
            Title <span class="sort-indicator" aria-hidden="true">{{ indicator('title') }}</span>
          </button>
        </th>

        <th class="col-status" scope="col" :aria-sort="ariaSort('status')">
          <button type="button" class="sort-button" @click="onSort('status')">
            Status <span class="sort-indicator" aria-hidden="true">{{ indicator('status') }}</span>
          </button>
        </th>

        <th class="col-priority" scope="col" :aria-sort="ariaSort('priority')">
          <button type="button" class="sort-button" @click="onSort('priority')">
            Priority
            <span class="sort-indicator" aria-hidden="true">{{ indicator('priority') }}</span>
          </button>
        </th>

        <th class="col-assignee" scope="col">Assignee</th>

        <th class="col-due" scope="col" :aria-sort="ariaSort('dueDate')">
          <button type="button" class="sort-button" @click="onSort('dueDate')">
            Due <span class="sort-indicator" aria-hidden="true">{{ indicator('dueDate') }}</span>
          </button>
        </th>

        <th class="col-updated" scope="col" :aria-sort="ariaSort('updatedAt')">
          <button type="button" class="sort-button" @click="onSort('updatedAt')">
            Updated
            <span class="sort-indicator" aria-hidden="true">{{ indicator('updatedAt') }}</span>
          </button>
        </th>

        <th class="col-actions" scope="col">Actions</th>
      </tr>
    </thead>

    <tbody>
      <tr
        v-for="task in tasks.tasks"
        :key="task.id"
        class="task-row"
        :aria-busy="busyIds.includes(task.id)"
        @click="onRowClick(task, $event)"
      >
        <td class="col-select">
          <input
            type="checkbox"
            :aria-label="`Select ${task.title}`"
            :checked="isSelected(task.id)"
            @click.stop
            @change="toggleRow(task.id)"
          />
        </td>

        <td class="col-title">
          <RouterLink class="task-link" :to="`/tasks/${task.id}`">{{ task.title }}</RouterLink>
          <div v-if="task.tags.length > 0" class="task-tags">
            <span v-for="tag in visibleTags(task)" :key="tag" class="tag-chip">{{ tag }}</span>
            <span v-if="extraTagCount(task) > 0" class="tag-chip tag-more">
              +{{ extraTagCount(task) }}
            </span>
          </div>
        </td>

        <td><StatusBadge :status="task.status" /></td>
        <td><PriorityTag :priority="task.priority" /></td>

        <td class="col-assignee" :class="{ 'assignee-empty': assigneeName(task) === 'Unassigned' }">
          {{ assigneeName(task) }}
        </td>

        <td
          class="col-due"
          :class="{ 'due-overdue': isOverdueDisplay(task) }"
          :title="isOverdueDisplay(task) ? 'Overdue' : undefined"
        >
          {{ formatDate(task.dueDate) }}
        </td>

        <td class="col-updated" :title="task.updatedAt">
          {{ formatRelativeTime(task.updatedAt) }}
        </td>

        <td class="col-actions">
          <div class="row-actions">
            <button
              type="button"
              class="row-actions-toggle"
              :aria-label="`Actions for ${task.title}`"
              :aria-expanded="openMenuId === task.id"
              @click.stop="toggleMenu(task.id)"
            >
              ⋯
            </button>

            <div v-if="openMenuId === task.id" class="row-menu" @click.stop>
              <TaskStatusControl :task="task" @busy="(value: boolean) => onBusy(task.id, value)" />
              <RouterLink class="row-menu-item" :to="`/tasks/${task.id}/edit`">Edit</RouterLink>
              <button type="button" class="row-menu-item danger" @click="onDelete(task)">
                Delete
              </button>
            </div>
          </div>
        </td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.task-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.task-table th,
.task-table td {
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}

.task-table thead th {
  background: var(--surface-alt);
  font-size: 13px;
  color: var(--text-muted);
}

.task-row:hover {
  background: var(--surface-alt);
  cursor: pointer;
}

.task-row:last-child td {
  border-bottom: 0;
}

.col-select {
  width: 36px;
}

.col-title {
  min-width: 220px;
  max-width: 420px;
}

.col-actions {
  width: 80px;
}

.sort-button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  color: inherit;
  cursor: pointer;
}

.sort-indicator {
  font-size: 10px;
  color: var(--text-muted);
}

.task-link {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-weight: 500;
}

.task-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin-top: var(--space-1);
}

.tag-chip {
  padding: 0 var(--space-1);
  border-radius: 4px;
  background: var(--surface-alt);
  color: var(--text-muted);
  font-size: 11px;
}

.assignee-empty {
  color: var(--text-muted);
  font-style: italic;
}

.due-overdue {
  color: var(--danger);
  font-weight: 600;
}

.row-actions {
  position: relative;
}

.row-actions-toggle {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  cursor: pointer;
}

.row-menu {
  position: absolute;
  right: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 160px;
  padding: var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: 0 8px 24px rgb(15 23 42 / 12%);
  cursor: default;
}

.row-menu-item {
  padding: var(--space-1) var(--space-2);
  border: 0;
  border-radius: 4px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.row-menu-item:hover {
  background: var(--surface-alt);
  text-decoration: none;
}

.row-menu-item.danger {
  color: var(--danger);
}
</style>
