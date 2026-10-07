# FE-03 — Task store

| | |
|---|---|
| Status | Done (2026-10-07) |
| Spec | `feature-spec/01-task-mgnt-feature-spec.md` §4.5 |
| Satisfies | FR-F-17 |
| Depends on | FE-02 |
| Blocks | FE-04, FE-05, FE-06, FE-07, and FE-10 (the AI layer reads this store) |
| Parallel-safe | No |

## 1. Objective

One Pinia store that owns the list query, filters, paging, selection, the loaded detail,
and the dashboard stats — the single source the UI **and** the AI layer read from
(FR-F-17). Every API error is caught here and surfaced through the `ui` store; no
component ever sees a rejected promise.

## 2. Context you need before starting

Read `00-index.md` §2.1, FE-01 and FE-02 reports, and `../spec-01-be/HANDOFF.md`.
Available: `taskApi`, `teamApi`, `ApiError`, `isApiError`, `toFieldErrors`,
`DEFAULT_TASK_QUERY`, `validateTask`, `normaliseForm`, `useUiStore`.

Key design constraint: **FE-10 will read this store to build the AG-UI state document**
(`context.filters`, `context.selectedIds`, `context.visibleTaskIds`, `context.taskId`).
Expose those as plain reactive state with predictable names — do not bury the filters
inside a private closure.

## 3. Scope

### 3.1 In scope

- [x] `src/stores/tasks.ts`
- [x] `src/stores/team.ts`
- [x] `src/__tests__/tasks-store.spec.ts`, `src/__tests__/team-store.spec.ts`

### 3.2 Out of scope

- URL synchronisation (FE-05 writes into `store.query`; FE-04/05 read from it).
- The draft field of the form — that belongs to FE-06's local form state and is pushed
  into the AI state document by FE-10, not stored here. Exception: expose
  `activeTaskId` (the detail currently open) because `context.taskId` needs it.
- Components.

## 4. Design

### 4.1 `useTaskStore`

```ts
export const useTaskStore = defineStore('tasks', () => {
  // list state
  const query = ref<TaskQuery>({ ...DEFAULT_TASK_QUERY })
  const tasks = ref<Task[]>([])
  const totalElements = ref(0)
  const totalPages = ref(0)
  const listState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const listError = ref<ApiError | null>(null)

  // selection (bulk actions)
  const selectedIds = ref<string[]>([])

  // detail
  const activeTaskId = ref<string | null>(null)
  const activeTask = ref<Task | null>(null)
  const detailState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const detailError = ref<ApiError | null>(null)

  // stats
  const stats = ref<TaskStats | null>(null)
  const statsState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const statsError = ref<ApiError | null>(null)

  // form
  const formState = ref<'idle' | 'saving' | 'error'>('idle')
  const formErrors = ref<Record<string, string>>({})
  let inFlightList: AbortController | null = null
  …
  return { …state, …actions }
})
```

Actions:

| Action | Behaviour |
|---|---|
| `fetchList()` | aborts any in-flight list request, creates a new `AbortController`, sets `loading`, calls `taskApi.list(query)`, writes `tasks/totalElements/totalPages`, sets `ready`. On abort → **no** state change and no toast. On `ApiError` → `error` + toast via `ui.pushToast` (FR-F-15) |
| `setQuery(patch: Partial<TaskQuery>)` | merges into `query`, clamps (`page` ≥ 0, `size` 1–100), resets `page` to 0 unless the patch explicitly sets `page`, then `fetchList()`. Clearing any filter resets `page` (AC-1.4) |
| `setFilter<K>(key: K, value: TaskQuery[K])` | convenience wrapper over `setQuery` used by FE-05's filter bar |
| `clearFilters()` | resets everything except `sort`/`size`, `page = 0`, `fetchList()` |
| `setSort(field: TaskSortField)` | same field → toggle `descending`; new field → `descending = field === 'createdAt' || field === 'updatedAt'`; `page = 0` |
| `setPage(page: number)` | clamps to `[0, max(totalPages - 1, 0)]`, `fetchList()` |
| `toggleSelection(id)` / `selectAll(ids)` / `clearSelection()` | keep `selectedIds` free of ids not in the current `tasks` page after a list fetch — after `fetchList`, drop selected ids not present in `tasks` **only if** the page changed (document this; bulk actions across pages are out of scope) |
| `fetchDetail(id)` | sets `activeTaskId`, `loading`, `taskApi.get(id)`; 404 → `detailError` + a "task not found" empty state (FE-06 renders it) |
| `clearDetail()` | resets detail refs |
| `fetchStats()` | `taskApi.stats()` |
| `saveTask(mode, id, input)` | validates with `validateTask`; on invalid → sets `formErrors`, `formState: 'error'`, **no** request, returns `false`. On valid → `formState: 'saving'`, `taskApi.create`/`patch` (with `expectedVersion` when editing), then `Promise.all([fetchList(), id ? fetchDetail(id) : Promise.resolve(), fetchStats()])`, `formState: 'idle'`, success toast, returns `true`. On `ApiError` → `formErrors = toFieldErrors(e)`, `formState: 'error'`, error toast, returns `false` |
| `changeStatus(id, status, reopen)` | calls `taskApi.changeStatus`; on success refetches list + detail + stats; on `illegal-transition` shows the backend `detail` verbatim in a toast (AC-1.3) and returns `false`; on `version-conflict` shows a toast with a **Retry after reload** affordance flag (`formErrors.version = e.detail`) |
| `bulkChangeStatus(ids, status, reopen)` | calls `taskApi.bulkStatus` with `expectedVersions` built from the currently loaded tasks; on `illegal-transition` the toast shows the full multi-line detail (AC-1.5) and **nothing is refetched**; on success clears the selection and refetches list + stats |
| `deleteTask(id, force)` | `taskApi.remove`; on success refetch list + stats + clear detail if it was open; on `blocked-delete` shows the detail + a "force" retry path |

Getters (Pinia `computed`): `isEmpty`, `isFiltered` (any filter active), `pageCount`,
`allOnPageSelected`, `selectedTasks` (the loaded subset of `selectedIds`),
`visibleTaskIds` (ids of the current page — FE-10 caps this).

Error policy (one place, so it is testable):
```ts
function report(e: unknown, fallbackTitle: string) {
  if (!isApiError(e)) { ui.pushToast({ kind: 'error', title: fallbackTitle,
    detail: e instanceof Error ? e.message : String(e) }); return }
  ui.pushToast({ kind: 'error', title: e.title || e.message, detail: e.detail })
}
```

### 4.2 `useTeamStore`

```ts
const members = ref<TeamMember[]>([])
const state = ref<'idle'|'loading'|'ready'|'error'>('idle')
const fetchMembers = async () => { … }         // dedupe: skip when already 'ready'
const byId = computed(() => new Map(members.value.map(m => [m.id, m])))
const byName = (name: string) => members.value.find(
  m => m.displayName.toLowerCase() === name.trim().toLowerCase())
```
`byName` mirrors the backend's exact-match-first resolution and is used by FE-06 (form
label) and FE-11 (`assigneeName` feedback). `fetchMembers()` must be idempotent — the
shell can call it on mount and FE-06 again on form open.

### 4.3 What FE-10 will consume (design for it now)

Expose, unchanged:

| Store member | Used by FE-10 as |
|---|---|
| `query` | `context.filters` (statuses, priorities, assigneeId, q, overdue) |
| `selectedIds` | `context.selectedIds` |
| `tasks.map(t => t.id)` | `context.visibleTaskIds` (capped at 200, most recent page) |
| `activeTaskId` | `context.taskId` |
| `view` (add a `view` ref, set by the router/shell) | `context.view` |

Add a `view` ref to the store — the router (FE-01/FE-04) sets it via
`tasks.setView('task-list')` in a route watcher, so FE-10 does not have to duplicate
route parsing. Default `'task-list'`.

## 5. Implementation order

1. `useTeamStore` + test (simplest, no dependencies).
2. `useTaskStore` state + getters, no actions.
3. `fetchList` + abort handling + `report` helper.
4. Query/sort/page/selection actions.
5. Detail actions.
6. Stats actions.
7. Form + status + bulk + delete actions.
8. `view` ref and setter.
9. Tests.

## 6. Tests

`src/__tests__/tasks-store.spec.ts` (mock `src/api/tasks`, use `createPinia()` +
`setActivePinia`, stub `ui.pushToast` by spying)

| Case | Expect |
|---|---|
| initial state | `listState: 'idle'`, `tasks: []`, `query` = `DEFAULT_TASK_QUERY` |
| `fetchList` success | `ready`, content/total copied, one toast-free path |
| `fetchList` while a request is in flight | previous request aborted (`AbortController.abort` called), only the last response wins |
| `fetchList` abort | state stays `loading`-free, **no** error toast |
| `fetchList` 500 | `listState: 'error'`, `listError.status === 500`, one error toast with `title` + `detail` |
| `setFilter({ status: … })` | `page` reset to 0 and `fetchList` re-called |
| `setQuery({ page: 2 })` | page honoured (not reset) |
| `clearFilters` | filters empty, `sort`/`size` preserved, `page === 0` (AC-1.4) |
| `setSort` same field twice | `descending` toggles |
| `setSort('title')` | `descending === false` |
| selection | `selectAll` then `fetchList` of a different page drops stale ids |
| `saveTask` invalid | no API call, `formErrors.title` set, returns `false` |
| `saveTask` valid create | `POST` called without `version`/`isOverdue`; list+stats refetched; returns `true` |
| `saveTask` edit | `PATCH` called **with** `expectedVersion` |
| `saveTask` server 400 | `formErrors` = `toFieldErrors(e)`, `formState: 'error'`, returns `false` |
| `changeStatus` illegal | toast contains the backend `detail`; no refetch; returns `false` |
| `changeStatus` version conflict | `formErrors.version` set, `retryable` surfaced |
| `bulkChangeStatus` with one illegal | `taskApi.bulkStatus` called once, no list refetch, toast contains the offending title (AC-1.5) |
| `bulkChangeStatus` success | selection cleared, list + stats refetched |
| `deleteTask` success | list + stats refetched, `activeTask` cleared when it was the deleted task |

`src/__tests__/team-store.spec.ts`
- `fetchMembers` twice → one network call; `byId`/`byName` resolve case-insensitively.

## 7. Definition of done

- [x] No component imports `taskApi` (grep) — they use stores only.
- [x] Every store action swallows rejections and reports through `ui`.
- [x] `query`, `selectedIds`, `tasks`, `activeTaskId`, `view` are exposed exactly as named
      in §4.3 (FE-10 depends on it).
- [x] lint / type-check / vitest pass; `HANDOFF.md` entry appended.

## 8. Handoff report

**Files added / changed** …
**Decisions taken** (abort strategy, selection pruning, error policy) …
**Verification** lint / type-check / vitest → …
**Known gaps** …
