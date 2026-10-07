<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import type { TaskCreateInput, TaskPatchInput } from '@/api/tasks'
import { useTaskDraft, type DraftField } from '@/composables/useTaskDraft'
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  TASK_PRIORITIES,
  type Task,
  type TaskStatus,
} from '@/domain/task'
import { toCreateInput, toPatchInput, validateTask, type TaskFormValue } from '@/domain/validation'
import { useTaskStore } from '@/stores/tasks'
import { useTeamStore } from '@/stores/team'

// One component serves create and edit (FR-F-09).
const props = defineProps<{ mode: 'create' | 'edit'; initial?: Task }>()
const emit = defineEmits<{ submit: [value: TaskCreateInput | TaskPatchInput]; cancel: [] }>()

/**
 * FR-F-10: `DONE`/`IN_REVIEW`/`CANCELLED` require a lifecycle step, so only these four are
 * offerable when creating. On edit the field is absent entirely — status moves through
 * `TaskStatusControl` → `POST /{id}/status`.
 */
const CREATABLE_STATUSES: TaskStatus[] = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED']

const tasks = useTaskStore()
const team = useTeamStore()
const draft = useTaskDraft()

function emptyForm(): TaskFormValue {
  return {
    title: '',
    description: '',
    status: 'TODO',
    priority: 'MEDIUM',
    assigneeId: null,
    reporterId: null,
    dueDate: '',
    estimateHours: '',
    tags: [],
  }
}

function fromTask(task: Task): TaskFormValue {
  return {
    title: task.title,
    description: task.description ?? '',
    status: task.status,
    priority: task.priority,
    assigneeId: task.assigneeId,
    reporterId: task.reporterId,
    dueDate: task.dueDate ?? '',
    estimateHours: task.estimateHours === null ? '' : String(task.estimateHours),
    tags: [...task.tags],
  }
}

const form = ref<TaskFormValue>(props.initial ? fromTask(props.initial) : emptyForm())
// The value the form was last seeded with, so `isDirty` compares against a real baseline.
const baseline = ref<TaskFormValue>(props.initial ? fromTask(props.initial) : emptyForm())
const touched = ref<ReadonlySet<DraftField>>(new Set<DraftField>())
const submitted = ref(false)

/** Edited as one comma-separated string, stored as a list so `normaliseForm` can do its job. */
const tagsText = computed({
  get: () => form.value.tags.join(', '),
  set: (raw: string) => {
    form.value = { ...form.value, tags: raw.split(',') }
  },
})

const tagChips = computed(() => {
  const seen = new Set<string>()
  const chips: string[] = []
  for (const tag of form.value.tags) {
    const value = tag.trim().toLowerCase()
    if (value === '' || seen.has(value)) continue
    seen.add(value)
    chips.push(value)
  }
  return chips
})

const validation = computed(() =>
  validateTask(form.value, props.mode === 'create' ? 'create' : 'patch'),
)
const isSaving = computed(() => tasks.formState === 'saving')
const canSubmit = computed(() => validation.value.valid && !isSaving.value)

/** Local errors surface once a field was touched or a submit was attempted; server errors always do. */
const visibleErrors = computed<Record<string, string>>(() => {
  const result: Record<string, string> = {}
  for (const [field, message] of Object.entries(validation.value.errors)) {
    if (submitted.value || touched.value.has(field as DraftField)) result[field] = message
  }
  for (const [field, message] of Object.entries(tasks.formErrors)) result[field] = message
  return result
})

/** C1 may send a dotted `tags[0]`; the tag input owns the base name and shows the index. */
const tagError = computed(() => {
  const direct = visibleErrors.value.tags
  if (direct !== undefined) return direct
  const indexed = Object.entries(visibleErrors.value).find(([field]) => field.startsWith('tags['))
  if (indexed === undefined) return undefined
  return `${indexed[1]} (entry ${indexed[0].slice('tags['.length, -1)})`
})

function fieldError(field: DraftField): string | undefined {
  return field === 'tags' ? tagError.value : visibleErrors.value[field]
}

function hasError(field: DraftField): boolean {
  return fieldError(field) !== undefined
}

function errorId(field: DraftField): string | undefined {
  return hasError(field) ? `task-form-${field}-error` : undefined
}

// ----------------------------------------------------------------- AI draft

const aiFields = computed<DraftField[]>(() => {
  const applied = draft.draft.value
  if (applied === null) return []
  return (Object.keys(applied.fields) as DraftField[]).filter((field) => draft.isAiSupplied(field))
})
const isPrefilled = computed(() => aiFields.value.length > 0)
const missingFields = computed(() => draft.draft.value?.missing ?? [])

function markEdited(field: DraftField) {
  touched.value = new Set(touched.value).add(field)
  draft.noteUserEdit(field)
}

/**
 * §5.1's shared-state `draft.task` is the *wire* shape: `dueDate`/`description` are `null`
 * when absent and `estimateHours` is a number. `TaskFormValue` keeps raw strings and a tag
 * list, so normalise here rather than letting a `null.length` reach the template.
 */
function coerceDraftValue(field: DraftField, value: unknown): unknown {
  if (value === null) {
    if (field === 'tags') return []
    if (field === 'assigneeId' || field === 'reporterId') return null
    return ''
  }
  if (field === 'estimateHours' && typeof value === 'number') return String(value)
  return value
}

function applyDraftFields() {
  const applied = draft.draft.value
  if (applied === null) return
  const next = { ...form.value }
  for (const field of Object.keys(applied.fields) as DraftField[]) {
    if (draft.dirtyFields.value.has(field)) continue
    const value = applied.fields[field]
    if (value === undefined) continue
    ;(next as Record<string, unknown>)[field] = coerceDraftValue(field, value)
  }
  form.value = next
}

function currentTarget(): string | null {
  return props.mode === 'edit' && props.initial ? props.initial.id : null
}

onMounted(() => {
  draft.setTarget(currentTarget())
  void team.fetchMembers()
  // A draft delivered before this form mounted is applied now rather than lost (OPEN-11).
  if (draft.draft.value?.taskId === currentTarget()) applyDraftFields()
})

watch(
  () => draft.draft.value,
  (next) => {
    if (next !== null && next.taskId === currentTarget()) applyDraftFields()
  },
)

// -------------------------------------------------------------------- save

function onSelectNullable(field: 'assigneeId' | 'reporterId', event: Event) {
  const raw = (event.target as HTMLSelectElement).value
  form.value = { ...form.value, [field]: raw === '' ? null : raw }
  markEdited(field)
}

/**
 * `v-model` on `<input type="number">` coerces to a JS `number`, but `TaskFormValue` keeps
 * `estimateHours` as the raw string so `normaliseForm`/`validateTask` (FE-02) can own the
 * parsing. Read the DOM value directly instead.
 */
function onEstimateInput(event: Event) {
  const raw = (event.target as HTMLInputElement).value
  form.value = { ...form.value, estimateHours: raw }
  markEdited('estimateHours')
}

function onSubmit() {
  submitted.value = true
  if (!validation.value.valid) return
  emit('submit', props.mode === 'create' ? toCreateInput(form.value) : toPatchInput(form.value))
}

function onCancel() {
  if (draft.draft.value !== null) draft.clear()
  emit('cancel')
}

// --------------------------------------------------------- version conflict

const conflictAcknowledged = ref(false)
watch(
  () => tasks.formErrors,
  () => {
    conflictAcknowledged.value = false
  },
)
const showVersionConflict = computed(
  () => tasks.formErrors.version !== undefined && !conflictAcknowledged.value,
)

async function reloadLatest() {
  const task = props.initial
  if (props.mode !== 'edit' || task === undefined) return
  await tasks.fetchDetail(task.id)
  if (tasks.activeTask !== null) applyTask(tasks.activeTask, true)
  conflictAcknowledged.value = true
}

/** Re-seed the form from a task; `preserveTouched` keeps the user's in-progress edits. */
function applyTask(task: Task, preserveTouched = false) {
  const previous = form.value
  const next = fromTask(task)
  if (preserveTouched) {
    for (const field of touched.value) {
      ;(next as Record<string, unknown>)[field] = (previous as Record<string, unknown>)[field]
    }
  }
  form.value = next
  baseline.value = fromTask(task)
}

function sameForm(a: TaskFormValue, b: TaskFormValue): boolean {
  return (
    a.title === b.title &&
    a.description === b.description &&
    a.status === b.status &&
    a.priority === b.priority &&
    a.assigneeId === b.assigneeId &&
    a.reporterId === b.reporterId &&
    a.dueDate === b.dueDate &&
    a.estimateHours === b.estimateHours &&
    a.tags.length === b.tags.length &&
    a.tags.every((tag, index) => tag === b.tags[index])
  )
}

const isDirty = computed(() => draft.draft.value !== null || !sameForm(form.value, baseline.value))

const submitLabel = computed(() => (props.mode === 'create' ? 'Create task' : 'Save changes'))

defineExpose({ applyTask, isDirty, reloadLatest })
</script>

<template>
  <form class="task-form" novalidate @submit.prevent="onSubmit">
    <p v-if="isPrefilled" class="ai-banner" role="status">
      Prefilled by the assistant — review and save
    </p>

    <div v-if="showVersionConflict" class="conflict-banner" role="alert">
      <span>This task changed since you loaded it.</span>
      <button type="button" class="conflict-reload" @click="reloadLatest">Reload latest</button>
    </div>

    <div v-if="missingFields.length > 0" class="missing-callout" role="status">
      <p class="missing-title">The assistant could not resolve:</p>
      <ul class="missing-list">
        <li v-for="field in missingFields" :key="field">{{ field }}</li>
      </ul>
    </div>

    <div class="form-grid">
      <div class="field field-wide">
        <label for="title">
          Title
          <span
            v-if="draft.isAiSupplied('title')"
            class="ai-marker"
            title="Suggested by the assistant"
            >AI</span
          >
        </label>
        <input
          id="title"
          v-model="form.title"
          type="text"
          maxlength="160"
          :autofocus="mode === 'create'"
          :aria-invalid="hasError('title')"
          :aria-describedby="errorId('title')"
          @input="markEdited('title')"
        />
        <p v-if="hasError('title')" :id="errorId('title')" class="field-error">
          {{ fieldError('title') }}
        </p>
      </div>

      <div v-if="mode === 'create'" class="field">
        <label for="status">Create as</label>
        <select
          id="status"
          v-model="form.status"
          :aria-invalid="hasError('status')"
          @change="markEdited('status')"
        >
          <option
            v-for="status in CREATABLE_STATUSES.includes(form.status)
              ? CREATABLE_STATUSES
              : [...CREATABLE_STATUSES, form.status]"
            :key="status"
            :value="status"
          >
            {{ STATUS_LABEL[status] }}
          </option>
        </select>
        <p v-if="hasError('status')" class="field-error">{{ fieldError('status') }}</p>
      </div>

      <div class="field">
        <label for="priority">
          Priority
          <span
            v-if="draft.isAiSupplied('priority')"
            class="ai-marker"
            title="Suggested by the assistant"
            >AI</span
          >
        </label>
        <select
          id="priority"
          v-model="form.priority"
          :aria-invalid="hasError('priority')"
          @change="markEdited('priority')"
        >
          <option v-for="priority in TASK_PRIORITIES" :key="priority" :value="priority">
            {{ PRIORITY_LABEL[priority] }}
          </option>
        </select>
        <p v-if="hasError('priority')" class="field-error">{{ fieldError('priority') }}</p>
      </div>

      <div class="field">
        <label for="assigneeId">
          Assignee
          <span
            v-if="draft.isAiSupplied('assigneeId')"
            class="ai-marker"
            title="Suggested by the assistant"
            >AI</span
          >
        </label>
        <select
          id="assigneeId"
          :value="form.assigneeId ?? ''"
          :aria-invalid="hasError('assigneeId')"
          @change="onSelectNullable('assigneeId', $event)"
        >
          <option value="">Unassigned</option>
          <option v-for="member in team.members" :key="member.id" :value="member.id">
            {{ member.displayName }}
          </option>
        </select>
        <p v-if="hasError('assigneeId')" class="field-error">{{ fieldError('assigneeId') }}</p>
      </div>

      <div class="field">
        <label for="reporterId">
          Reporter
          <span
            v-if="draft.isAiSupplied('reporterId')"
            class="ai-marker"
            title="Suggested by the assistant"
            >AI</span
          >
        </label>
        <select
          id="reporterId"
          :value="form.reporterId ?? ''"
          :aria-invalid="hasError('reporterId')"
          @change="onSelectNullable('reporterId', $event)"
        >
          <option value="">Unassigned</option>
          <option v-for="member in team.members" :key="member.id" :value="member.id">
            {{ member.displayName }}
          </option>
        </select>
        <p v-if="hasError('reporterId')" class="field-error">{{ fieldError('reporterId') }}</p>
      </div>

      <div class="field">
        <label for="dueDate">
          Due date
          <span
            v-if="draft.isAiSupplied('dueDate')"
            class="ai-marker"
            title="Suggested by the assistant"
            >AI</span
          >
        </label>
        <input
          id="dueDate"
          v-model="form.dueDate"
          type="date"
          :aria-invalid="hasError('dueDate')"
          :aria-describedby="errorId('dueDate')"
          @input="markEdited('dueDate')"
        />
        <p v-if="hasError('dueDate')" :id="errorId('dueDate')" class="field-error">
          {{ fieldError('dueDate') }}
        </p>
      </div>

      <div class="field">
        <label for="estimateHours">
          Estimate (hours)
          <span
            v-if="draft.isAiSupplied('estimateHours')"
            class="ai-marker"
            title="Suggested by the assistant"
            >AI</span
          >
        </label>
        <input
          id="estimateHours"
          :value="form.estimateHours"
          type="number"
          step="0.1"
          min="0"
          max="999"
          :aria-invalid="hasError('estimateHours')"
          :aria-describedby="errorId('estimateHours')"
          @input="onEstimateInput"
        />
        <p v-if="hasError('estimateHours')" :id="errorId('estimateHours')" class="field-error">
          {{ fieldError('estimateHours') }}
        </p>
      </div>

      <div class="field">
        <label for="tags">
          Tags
          <span
            v-if="draft.isAiSupplied('tags')"
            class="ai-marker"
            title="Suggested by the assistant"
            >AI</span
          >
        </label>
        <input
          id="tags"
          v-model="tagsText"
          type="text"
          placeholder="bug, auth"
          :aria-invalid="hasError('tags')"
          :aria-describedby="errorId('tags')"
          @input="markEdited('tags')"
        />
        <p v-if="tagChips.length > 0" class="tag-chips">
          <span v-for="tag in tagChips" :key="tag" class="tag-chip">{{ tag }}</span>
        </p>
        <p v-if="hasError('tags')" :id="errorId('tags')" class="field-error">
          {{ fieldError('tags') }}
        </p>
      </div>

      <div class="field field-wide">
        <label for="description">
          Description
          <span
            v-if="draft.isAiSupplied('description')"
            class="ai-marker"
            title="Suggested by the assistant"
            >AI</span
          >
        </label>
        <textarea
          id="description"
          v-model="form.description"
          rows="6"
          maxlength="4000"
          :aria-invalid="hasError('description')"
          :aria-describedby="errorId('description')"
          @input="markEdited('description')"
        />
        <p class="field-hint">{{ form.description.length }} / 4000</p>
        <p v-if="hasError('description')" :id="errorId('description')" class="field-error">
          {{ fieldError('description') }}
        </p>
      </div>
    </div>

    <div class="form-actions">
      <button type="button" class="form-cancel" @click="onCancel">Cancel</button>
      <button type="submit" class="form-submit" :disabled="!canSubmit">
        {{ isSaving ? 'Saving…' : submitLabel }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.task-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.field-wide {
  grid-column: 1 / -1;
}

.field label {
  font-weight: 600;
  font-size: 13px;
}

.field input,
.field select,
.field textarea {
  padding: var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  font: inherit;
}

.field input[aria-invalid='true'],
.field select[aria-invalid='true'],
.field textarea[aria-invalid='true'] {
  border-color: var(--danger);
}

.field-error {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}

.field-hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
}

.ai-marker {
  display: inline-block;
  margin-left: var(--space-1);
  padding: 0 4px;
  border-bottom: 1px dotted var(--primary);
  color: var(--primary);
  font-size: 10px;
  font-weight: 700;
  vertical-align: middle;
}

.ai-banner {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-left: 4px solid var(--primary);
  border-radius: var(--radius);
  background: #eff6ff;
  color: var(--primary);
}

.conflict-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--warning);
  border-left-width: 4px;
  border-radius: var(--radius);
  background: #fffbeb;
}

.conflict-reload {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  cursor: pointer;
}

.missing-callout {
  padding: var(--space-2) var(--space-3);
  border-left: 4px solid var(--warning);
  border-radius: var(--radius);
  background: #fffbeb;
}

.missing-title {
  margin: 0;
  font-weight: 600;
}

.missing-list {
  margin: var(--space-1) 0 0;
  padding-left: var(--space-3);
  color: var(--text-muted);
}

.tag-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin: 0;
}

.tag-chip {
  padding: 2px var(--space-2);
  border-radius: 999px;
  background: var(--surface-alt);
  font-size: 12px;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

.form-cancel,
.form-submit {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  cursor: pointer;
}

.form-submit {
  border-color: transparent;
  background: var(--primary);
  color: #ffffff;
  font-weight: 600;
}

.form-submit:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

@media (max-width: 900px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
