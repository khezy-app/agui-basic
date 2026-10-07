# FE-06 — Task detail, create/edit form, AI draft rendering

| | |
|---|---|
| Status | Done — see HANDOFF.md |
| Spec | `feature-spec/01-task-mgnt-feature-spec.md` §4.3, §5.2 FR-S-03/FR-S-04, AC-2.1, AC-2.2 |
| Satisfies | FR-F-09, FR-F-10, FR-F-11, FR-F-12, FR-F-13 (not-found state) |
| Depends on | FE-03 (FE-04's `TaskStatusControl`, `ConfirmDialog` also needed) |
| Blocks | FE-11 (`prefill_task_form` handler targets this form), FE-12 |
| Parallel-safe | No |

## 1. Objective

The create/edit form and the detail view — including the requirement that the form can
be **filled by the AI without submitting**, marked dirty, and never overwritten once the
user starts typing. AC-2.1 and AC-2.2 land here.

## 2. Context you need before starting

Read FE-02 (`validateTask`, `normaliseForm`, the BE-03 null-semantics decision), FE-03
(`saveTask`, `changeStatus`, `deleteTask`, `formErrors`, `formState`, `activeTask`), and
FE-04 (`TaskStatusControl`, `ConfirmDialog`, `ErrorBlock`, `LoadingBlock`) reports.

How FE-10/FE-11 will reach this form (design the seam now, do not implement it):

| Consumer | Needs from this task |
|---|---|
| FE-10 (state sync) | an exported reactive draft holder + a change signal |
| FE-11 (`prefill_task_form`) | `applyAiDraft(task, { taskId, missing })` that patches the form and marks it AI-sourced |
| FE-12 | nothing beyond the store |

## 3. Scope

### 3.1 In scope

- [ ] `src/views/TaskDetailView.vue`
- [ ] `src/views/TaskFormView.vue`
- [ ] `src/components/task/TaskForm.vue`
- [ ] `src/composables/useTaskDraft.ts` — **the AI draft seam** (new pinned file; log the
      addition under **Contract changes**)
- [ ] Tests

### 3.2 Out of scope

- The AI Cowork panel (FE-13).
- The approval flow (FE-12).
- Any API change.

## 4. Design

### 4.1 `TaskForm.vue`

```ts
export type TaskFormValue = {
  title: string; description: string; status: TaskStatus; priority: TaskPriority
  assigneeId: string | null; reporterId: string | null; dueDate: string
  estimateHours: string; tags: string          // tags as a comma-separated string in the input
}
export type TaskFormProps = { mode: 'create' | 'edit'; initial?: Task; }
export type TaskFormEmits = { submit: [value: TaskCreateInput | TaskPatchInput]; cancel: [] }
```

One component serves both modes (FR-F-09). Fields:

| Field | Control | Notes |
|---|---|---|
| title | `<input>` | required, maxlength 160, autofocus on create |
| description | `<textarea rows=6>` | maxlength 4000, live counter |
| status | **not a field** — see §4.2 | FR-F-10 |
| priority | `<select>` (4) | default `MEDIUM` on create |
| assignee / reporter | `<select>` of team members + "Unassigned" | `useTeamStore.fetchMembers()` on mount |
| due date | `<input type="date">` | empty ⇄ `null` |
| estimateHours | `<input type="number" step="0.1" min="0" max="999">` | empty ⇄ `null`; string in the form, number in the payload |
| tags | `<input>` comma-separated + chips preview | normalised on submit (lower-case, de-dupe, ≤5) |

Layout: two-column grid on wide screens, single column below 900 px; labels above inputs;
errors below the control in red with `aria-describedby` wiring and `aria-invalid`.

- Submit button label: `Create task` / `Save changes`. Disabled when invalid **or**
  `formState === 'saving'`, with a spinner label (`Saving…`).
- Server field errors from `store.formErrors` render on the matching control (C1's
  `field` may be dotted, e.g. `tags[0]` — map the base name `tags` to the tag input and
  append the index to the message).
- On failure the form is **not** reset (FR-F-11).
- A `409 version-conflict` on save surfaces a banner with a **Reload latest** action that
  refetches the task, re-applies the user's edits into the fresh version's fields where
  they are still dirty, and updates `expectedVersion`.
- Unsaved-changes guard: `onBeforeRouteLeave` prompts via `useConfirm` when the form is
  dirty — including when the AI is about to navigate (OPEN-11).

### 4.2 Status editing (FR-F-10)

Status is **not** part of the general form. On create it appears as a single "Create as
{status}" select offering only `BACKLOG`, `TODO`, `IN_PROGRESS`, `BLOCKED`
(`DONE`/`IN_REVIEW`/`CANCELLED` require a lifecycle step; document this). On edit it is
absent entirely — the detail view and the list row own status changes through
`TaskStatusControl` → `POST /{id}/status`.

### 4.3 `useTaskDraft.ts` — the AI seam (FR-F-12, FR-S-03, FR-S-04)

```ts
export type AiDraft = {
  taskId: string | null
  fields: Partial<TaskFormValue>       // only the fields the agent supplied
  missing: string[]                     // fields it could not resolve
  appliedAt: number
}

export function useTaskDraft() {
  const draft = ref<AiDraft | null>(null)
  const dirtyFields = ref<Set<string>>(new Set())   // fields the USER changed after the draft

  function applyAiDraft(next: AiDraft) { … }        // merge fields, mark draft, never submit
  function noteUserEdit(field: string) { … }        // add to dirtyFields
  function isAiSupplied(field: string) { … }
  function clear() { … }
  return { draft, dirtyFields, applyAiDraft, noteUserEdit, isAiSupplied, clear }
}
```

Behaviour:

| Rule | Implementation |
|---|---|
| FR-S-03 — never submit | `applyAiDraft` only writes local form state. No store/API call exists in this composable |
| Visible provenance | Each AI-supplied field shows a small "AI" marker (a dotted underline + `title="Suggested by the assistant"`), and the form header shows "Prefilled by the assistant — review and save" |
| Missing fields | `missing` renders an amber callout listing them ("Assignee could not be resolved") (AC-2.2) |
| FR-S-04 — user edits win | `noteUserEdit(field)` marks the field dirty; a later `applyAiDraft` **must not** overwrite a dirty field (merge skips it and records it in `missing` as "kept your value") |
| Clear on save/cancel | The view calls `clear()` on successful save and on explicit cancel |
| Session only | Not persisted (OPEN-10) |

The composable is a module-level singleton (`useTaskDraft` returns the same refs), because
the draft must survive navigation between the panel and the form (OPEN-11).

`TaskForm.vue` consumes it: `onMounted` applies any existing draft into the form when the
route matches (`create` ⇔ `draft.taskId === null`, `edit/:id` ⇔ `draft.taskId === id`);
`watch` on `draft.fields` re-applies later updates in place without navigation (OPEN-11).

### 4.4 `TaskFormView.vue`

| Route | Behaviour |
|---|---|
| `/tasks/new` | `mode = 'create'`; `reporterId` defaults to the dev current user if one exists; on submit → `store.saveTask('create', …)` then navigate to `/tasks/{newId}` on success, stay on `/tasks/new` on failure |
| `/tasks/:id/edit` | loads via `store.fetchDetail(id)`; `LoadingBlock` while loading; `ErrorBlock` on 404 with a "Back to tasks" action; `mode = 'edit'` with `expectedVersion = task.version` |

Header shows a breadcrumb `Tasks / {title}`.

### 4.5 `TaskDetailView.vue`

Layout: title + status badge + priority; action row (**Edit**, **Change status** via
`TaskStatusControl`, **Delete**); description; a definition list of assignee, reporter,
due date (flagged when overdue), estimate, tags, created/updated with absolute timestamps
in `title`.

- 404 → `ErrorBlock` with a "not found" message and a link back (never a blank screen).
- Delete → `useConfirm()` naming the task → `store.deleteTask` → navigate to `/tasks`.
- Show a **version** hint? No — `version` is an implementation detail; keep it in the
  store only.

## 5. Implementation order

1. `useTaskDraft.ts` + tests (pure).
2. `TaskForm.vue` (fields, validation, errors) + tests.
3. `TaskFormView.vue` (both routes).
4. `TaskDetailView.vue`.
5. AI-draft integration into `TaskForm.vue` (provenance markers, dirty-field protection).
6. Unsaved-changes guard.
7. Tests.

## 6. Tests

`src/__tests__/useTaskDraft.spec.ts`
- `applyAiDraft` writes fields and does **not** call any store action (spy on the task
  store: zero calls — this is the FR-S-03 regression guard).
- a user edit of `title` followed by a new draft containing `title` keeps the user's value
  and adds `title` to `missing`.
- `isAiSupplied('title')` true after a draft, false after `clear()`.
- applying a draft for `taskId: 'a'` while the form is editing `'b'` is ignored.

`src/__tests__/TaskForm.spec.ts`
- renders every field; create mode defaults (`priority = MEDIUM`, empty dates).
- an empty title disables submit; typing 161 characters flags `maxlength`/validation.
- submit emits `normaliseForm`-shaped payload: tags lower-cased + de-duplicated,
  `''` → `null` for nullable fields, `estimateHours` as a number.
- server field errors from `store.formErrors` appear on the matching controls, including
  `tags[0]` → tag input.
- submit is disabled while `formState === 'saving'` and the form is not reset afterwards.
- an AI-drafted title renders the "AI" marker; editing it removes the marker for that
  field (user value wins).
- a `missing` list renders the amber callout with the field names.
- edit mode has **no** status field; create mode offers only the 4 creatable statuses.

`src/__tests__/TaskDetailView.spec.ts`
- renders all fields with a resolved assignee name.
- overdue due date is flagged.
- 404 → error block + back link.
- delete asks for confirmation, calls the store, and navigates to `/tasks`.
- changing status calls the store and the control reverts on failure.

`src/__tests__/TaskFormView.spec.ts`
- `/tasks/new` creates and navigates to the new task on success; stays put on failure.
- `/tasks/:id/edit` shows loading, then the form; 404 renders the not-found block.
- leaving a dirty form prompts (route-leave guard) and cancelling the prompt blocks
  navigation; approving discards changes.

## 7. Definition of done

- [ ] AC-2.1 demonstrable: a draft fills the form, marks it dirty, and **no** `POST`
      appears in the network log until the user presses Save.
- [ ] AC-2.2 demonstrable: unresolved fields are called out and later user edits survive
      subsequent drafts.
- [ ] No status input inside the general form (FR-F-10).
- [ ] lint / type-check / vitest pass; `HANDOFF.md` entry appended, including the
      `useTaskDraft` API FE-11 must call.

## 8. Handoff report

**Files added / changed** …
**Decisions taken** (creatable statuses, draft singleton, version-conflict recovery) …
**Contract changes** (new pinned file `src/composables/useTaskDraft.ts`; the draft shape
FE-11/FE-10 must produce) …
**Verification** lint / type-check / vitest → …
**Known gaps** …
