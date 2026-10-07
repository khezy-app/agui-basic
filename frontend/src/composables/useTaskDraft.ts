import { computed, ref } from 'vue'

import type { TaskFormValue } from '@/domain/validation'

/** A field key of the form; the draft's `fields`/`missing` entries use these names. */
export type DraftField = keyof TaskFormValue

/**
 * The prefill payload the AI layer (FE-11's `prefill_task_form`) hands to the form.
 * `fields` carries only what the agent supplied; `missing` names what it could not
 * resolve. Mirrors FE-06 §4.3 — the §5.1 shared-state `draft.task` is this object with
 * its `source`/`taskId` promoted by FE-10/FE-11, not a second shape.
 */
export type AiDraft = {
  taskId: string | null
  fields: Partial<TaskFormValue>
  missing: string[]
  appliedAt: number
}

/**
 * The AI draft seam (FR-F-12 / FR-S-03 / FR-S-04). Module-level singleton on purpose: the
 * draft must survive navigation between the Cowork panel and the form (OPEN-11).
 *
 * It holds **local** form state only — there is no store or API call anywhere in this
 * file, which is what makes FR-S-03 ("never triggers a create/update") structurally true
 * rather than merely intended.
 */
const draft = ref<AiDraft | null>(null)
const dirtyFields = ref<ReadonlySet<DraftField>>(new Set<DraftField>())
// The form currently mounted registers which task it edits (`null` = the create form).
// A draft addressed to any other target is ignored instead of hijacking the form.
const targetId = ref<string | null>(null)

/**
 * Merge a draft into local state and mark it AI-sourced.
 *
 * Skips any field the user has already edited (`noteUserEdit`) and records it in
 * `missing` as "kept your value", so a second draft can never clobber a manual edit
 * (FR-S-04).
 */
function applyAiDraft(next: AiDraft): void {
  if (next.taskId !== targetId.value) return

  const kept: string[] = []
  const fields: Partial<TaskFormValue> = { ...draft.value?.fields }

  for (const field of Object.keys(next.fields) as DraftField[]) {
    if (dirtyFields.value.has(field)) {
      kept.push(`${field} — kept your value`)
      continue
    }
    const value = next.fields[field]
    if (value === undefined) continue
    fields[field] = value as never
  }

  draft.value = {
    taskId: next.taskId,
    fields,
    missing: [...next.missing, ...kept],
    appliedAt: Date.now(),
  }
}

/** Mark a field as user-edited so a later draft leaves it alone. */
function noteUserEdit(field: DraftField): void {
  if (dirtyFields.value.has(field)) return
  dirtyFields.value = new Set(dirtyFields.value).add(field)
}

/** `true` when the field came from a draft and the user has not overridden it. */
function isAiSupplied(field: DraftField): boolean {
  return draft.value !== null && field in draft.value.fields && !dirtyFields.value.has(field)
}

/** Tells the composable which form is on screen, so a mismatched draft is ignored. */
function setTarget(taskId: string | null): void {
  targetId.value = taskId
}

/** Drop the draft and the user-edit marks (on successful save or explicit cancel). */
function clear(): void {
  draft.value = null
  dirtyFields.value = new Set<DraftField>()
}

const hasDraft = computed(() => draft.value !== null)

export function useTaskDraft() {
  return {
    draft,
    dirtyFields,
    hasDraft,
    applyAiDraft,
    noteUserEdit,
    isAiSupplied,
    setTarget,
    clear,
  }
}
