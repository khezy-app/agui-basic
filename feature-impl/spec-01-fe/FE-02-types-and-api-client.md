# FE-02 — Domain types, typed API client and error handling

| | |
|---|---|
| Status | Done (2026-10-07) |
| Spec | `feature-spec/01-task-mgnt-feature-spec.md` §2, §4.5 |
| Satisfies | FR-F-15, FR-F-16, NFR-8 |
| Depends on | FE-01 |
| Blocks | FE-03…FE-07, FE-08 |
| Parallel-safe | Yes — after FE-01 |

## 1. Objective

The single network boundary of the app: wire types mirroring C3, a typed `fetch` wrapper
that turns the C1 envelope into a typed `ApiError`, and the task/team API modules. After
this task every other task consumes typed results and never touches `fetch`.

## 2. Context you need before starting

Read `00-index.md` §2.1, §3 (C1–C3), and `../spec-01-be/00-index.md` §3 (C1, C2, C3) plus
`../spec-01-be/HANDOFF.md` — if the backend reports a wire change, that entry wins over
anything written here. Also read FE-01's report (`config.ts`, `ui` store).

Spec source of truth for the domain: §2.1 (field table) and §2.3 (invariants).

## 3. Scope

### 3.1 In scope

- [x] `src/domain/task.ts`
- [x] `src/domain/statusFlow.ts`
- [x] `src/domain/validation.ts`
- [x] `src/api/errors.ts`
- [x] `src/api/client.ts`
- [x] `src/api/tasks.ts`, `src/api/team.ts`
- [x] Tests for all of the above

### 3.2 Out of scope

- Stores (FE-03).
- Components.
- The AG-UI transport (FE-08) — `client.ts` must **not** know about `/agent`.
- Real network calls in tests: stub `globalThis.fetch`.

## 4. Design

### 4.1 `src/domain/task.ts`

```ts
export const TASK_STATUSES = ['BACKLOG','TODO','IN_PROGRESS','IN_REVIEW','BLOCKED','DONE','CANCELLED'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TASK_PRIORITIES = ['LOW','MEDIUM','HIGH','URGENT'] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

export type TeamMemberRole = 'ENGINEER' | 'DESIGNER' | 'PRODUCT_OWNER' | 'QA'

export type Task = {
  id: string
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  assigneeId: string | null
  reporterId: string | null
  dueDate: string | null          // yyyy-MM-dd
  estimateHours: number | null
  tags: string[]
  createdAt: string               // ISO instant
  updatedAt: string
  version: number
  isOverdue: boolean
  isUnassigned: boolean
}

export type PageResponse<T> = { content: T[]; page: number; size: number;
                               totalElements: number; totalPages: number }

export type TaskQuery = {
  statuses: TaskStatus[]
  priorities: TaskPriority[]
  assigneeId: string | null
  unassigned: boolean
  tag: string | null
  q: string | null
  overdue: boolean
  dueWithinDays: number | null
  createdFrom: string | null      // yyyy-MM-dd
  createdTo: string | null
  sort: TaskSortField
  descending: boolean
  page: number
  size: number
}
export type TaskSortField = 'createdAt' | 'updatedAt' | 'dueDate' | 'title' | 'priority' | 'status'

export type AssigneeRollup = { memberId: string; displayName: string
                               openCount: number; overdueCount: number }
export type TaskStats = { total: number
  byStatus: Record<TaskStatus, number>
  byPriority: Record<TaskPriority, number>
  assignees: AssigneeRollup[]
  overdueTotal: number; dueThisWeek: number
  unassignedTotal: number; createdLast7Days: number }

export type TeamMember = { id: string; displayName: string; email: string; role: TeamMemberRole }

export const STATUS_LABEL: Record<TaskStatus, string> = { … 'IN_REVIEW': 'In Review', … }
export const PRIORITY_LABEL: Record<TaskPriority, string> = { … }
export const DEFAULT_TASK_QUERY: TaskQuery = { … page: 0, size: 20,
  sort: 'createdAt', descending: true, all filters empty/false }
```

- `Record<TaskStatus, number>` (not `Partial`) forces the UI to handle all keys and
  makes a backend shape change a **compile** error — deliberate.
- Add `isTaskStatus(v: unknown): v is TaskStatus` guards for anything coming off the
  wire or the URL.
- `STATUS_LABEL` must cover all 7 values; a unit test asserts it.

### 4.2 `src/domain/statusFlow.ts` (OPEN-1)

```ts
export const STATUS_FLOW: Record<TaskStatus, readonly TaskStatus[]> = {
  BACKLOG:     ['TODO', 'CANCELLED'],
  TODO:        ['BACKLOG', 'IN_PROGRESS', 'BLOCKED', 'CANCELLED'],
  IN_PROGRESS: ['TODO', 'IN_REVIEW', 'BLOCKED', 'CANCELLED'],
  IN_REVIEW:   ['IN_PROGRESS', 'DONE', 'TODO', 'CANCELLED'],
  BLOCKED:     ['TODO', 'IN_PROGRESS', 'CANCELLED'],
  DONE:        ['IN_REVIEW', 'CANCELLED'],
  CANCELLED:   [],
}
export const allowedTargets = (from: TaskStatus, reopen = false): TaskStatus[] =>
  from === 'CANCELLED' ? (reopen ? ['TODO'] : []) : [...STATUS_FLOW[from]]
export const isTransitionAllowed = (from: TaskStatus, to: TaskStatus, reopen = false) =>
  to === from || allowedTargets(from, reopen).includes(to)
export const labelFor = (s: TaskStatus) => STATUS_LABEL[s]
```
Javadoc-style comment: "Mirror of the backend `TaskStatusMachine` / C4. Any change here
must be made there too." Tests assert the exact table and that it covers all 7 keys.
A "reopen" affordance for `CANCELLED` lives in FE-06's status control.

### 4.3 `src/api/errors.ts`

```ts
export type FieldError = { field: string; message: string }
export type ApiErrorBody = { type: string; title: string; status: number
                             detail: string; instance?: string; errors?: FieldError[] }

export class ApiError extends Error {
  readonly status: number
  readonly kind: ApiErrorKind          // discriminated union of the C1 `type` suffixes
  readonly detail: string
  readonly fieldErrors: FieldError[]
  readonly retryable: boolean
}
export type ApiErrorKind =
  | 'validation-failed' | 'not-found' | 'illegal-transition'
  | 'version-conflict' | 'blocked-delete' | 'unprocessable'
  | 'method-not-allowed' | 'internal-error' | 'network' | 'malformed-response'

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError
export const toFieldErrors = (e: ApiError): Record<string, string> =>
  Object.fromEntries(e.fieldErrors.map(f => [f.field, f.message]))
```
- `kind` is parsed from the last `/` segment of `type`, with a fallback that maps HTTP
  status → kind when the body is not a C1 envelope (e.g. a proxy 502 HTML page).
- `retryable` = `status >= 500 || kind === 'network' || kind === 'version-conflict'`.
- `fieldErrors` defaults to `[]`, never `undefined`.
- `ApiError.message` = `title`, so a bare `throw` in a component still reads well.

### 4.4 `src/api/client.ts`

```ts
type RequestOptions = { method?: 'GET'|'POST'|'PATCH'|'DELETE'
                        query?: Record<string, string | number | boolean | string[] | null | undefined>
                        body?: unknown
                        signal?: AbortSignal }

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T>
```

Behaviour:

| Case | Result |
|---|---|
| `res.ok` + JSON body | parsed `T` |
| `res.ok` + `204` | `undefined as T` |
| `res.ok` + unparseable body | throw `ApiError('malformed-response')` |
| `!res.ok` | parse C1 body → `ApiError`; if the body is not JSON, synthesise one from `res.status` |
| network failure / abort | `ApiError('network')`; an `AbortError` re-throws as `ApiError('network')` with `message: 'Request cancelled'` and `retryable: false` |

Implementation notes:
- Build the URL from `config.apiBaseUrl` + `path` + `query`; **omit** `null`/`undefined`
  params, join array params as repeated keys (`?status=TODO&status=BLOCKED`), and
  serialise booleans as `true`/`false` (never omitted — `unassigned=false` and absent
  mean the same to the backend but explicit is easier to debug).
- Always send `Accept: application/json`; `Content-Type: application/json` only when a
  body is present.
- **Do not** send `version`, `isOverdue`, `isUnassigned`, `createdAt`, `updatedAt` in
  bodies — provide explicit request-type helpers in `tasks.ts` that pick fields, so the
  server-owned fields cannot leak (FR-B-19 / INV-5). Encode that rule as an explicit
  `Pick`/`Omit` type so `tsc` rejects a mistake.
- Add `credentials: 'omit'` explicitly (no auth per non-goals; keeps BE-06's
  no-credentials CORS valid).

### 4.5 `src/api/tasks.ts`

```ts
export const taskApi = {
  list: (q: TaskQuery, signal?: AbortSignal) =>
    apiFetch<PageResponse<Task>>('/tasks', { query: toQueryParams(q), signal }),
  stats: (signal?: AbortSignal) => apiFetch<TaskStats>('/tasks/stats', { signal }),
  get: (id: string, signal?: AbortSignal) => apiFetch<Task>(`/tasks/${id}`, { signal }),
  create: (input: TaskCreateInput) => apiFetch<Task>('/tasks', { method: 'POST', body: input }),
  patch: (id: string, input: TaskPatchInput, expectedVersion?: number) =>
    apiFetch<Task>(`/tasks/${id}`, { method: 'PATCH', body: input,
                                     query: expectedVersion === undefined ? {} : { expectedVersion } }),
  remove: (id: string, force = false) =>
    apiFetch<void>(`/tasks/${id}`, { method: 'DELETE', query: { force } }),
  changeStatus: (id: string, input: StatusChangeInput) =>
    apiFetch<Task>(`/tasks/${id}/status`, { method: 'POST', body: input }),
  bulkStatus: (input: BulkStatusInput) =>
    apiFetch<BulkStatusResult>('/tasks/bulk-status', { method: 'POST', body: input }),
}
```

`toQueryParams(q: TaskQuery)` is the single mapper (FE-05 will reuse it for the URL
round-trip tests):

```ts
{ status: q.statuses, priority: q.priorities, assigneeId: q.assigneeId,
  unassigned: q.unassigned || null, tag: q.tag, q: q.q, overdue: q.overdue || null,
  dueWithinDays: q.dueWithinDays, createdFrom: q.createdFrom, createdTo: q.createdTo,
  sort: `${q.descending ? '-' : ''}${q.sort}`, page: q.page, size: q.size }
```
Empty arrays and `false` booleans must be omitted — a `status=` empty string would make
the backend 422.

Request input types:

```ts
export type TaskCreateInput = { title: string; description: string | null
  status?: TaskStatus; priority?: TaskPriority; assigneeId: string | null
  reporterId: string | null; dueDate: string | null; estimateHours: number | null; tags: string[] }
export type TaskPatchInput = Omit<TaskCreateInput, 'status'>   // status is not patchable (FR-B-04)
export type StatusChangeInput = { status: TaskStatus; reopen: boolean; expectedVersion?: number }
export type BulkStatusInput = { ids: string[]; status: TaskStatus; reopen: boolean
                                expectedVersions?: Record<string, number> }
export type BulkStatusResult = { updated: number; tasks: Task[] }
```

`src/api/team.ts`: `teamApi.list(signal?) → TeamMember[]`.

## 5. Implementation order

1. `src/domain/task.ts`.
2. `src/domain/statusFlow.ts`.
3. `src/api/errors.ts`.
4. `src/api/client.ts` + `toQueryParams`.
5. `src/api/tasks.ts`, `src/api/team.ts`.
6. `src/domain/validation.ts` (see §4.6).
7. Tests.

### 4.6 `src/domain/validation.ts`

Client-side mirror of spec §2.1, returning the same shape as `toFieldErrors`:

```ts
export type ValidationResult = { valid: boolean; errors: Record<string, string> }
export function validateTask(input: TaskFormValue, mode: 'create' | 'patch'): ValidationResult
```
Rules must match `00-index` (BE) §4.2 one-for-one: title non-blank ≤160, description
≤4000, estimate 0–999 with ≤1 decimal, ≤5 tags of 1–24 chars, due date `yyyy-MM-dd`.
Also export `normaliseForm(input)` (trim strings, lowercase + de-dupe tags, `''`→`null`
for nullable text) so FE-06 submits exactly what BE-03 validates.

Note the `PATCH` null semantics chosen by BE-03 (see its handoff entry) and mirror it:
if the backend treats an explicit `null` as "leave unchanged", the form must send `''`
(empty string) to clear `description`, not `null`. Read BE-03's decision and encode it in
one place with a comment.

## 6. Tests

`src/__tests__/domain-task.spec.ts`
- `STATUS_LABEL` and `PRIORITY_LABEL` cover every enum value (guards against a new status).
- `isTaskStatus` accepts each wire value, rejects `'in_review'`, `'DONE '`, `null`, `7`.

`src/__tests__/status-flow.spec.ts`
- the table equals C4 exactly (paste the expected object literal in the test — this is the
  sync guard with the backend).
- `allowedTargets('DONE')` excludes `BACKLOG`.
- `allowedTargets('CANCELLED', false)` is empty; `(…, true)` is `['TODO']`.
- `isTransitionAllowed(x, x)` is true (no-op).

`src/__tests__/api-client.spec.ts` (stub `globalThis.fetch`)
- builds the expected URL: repeated array keys, omitted empty arrays, omitted `false`
  booleans, `sort=-dueDate`.
- 204 → resolves `undefined`.
- 400 + C1 body → `ApiError` with `kind: 'validation-failed'`, `fieldErrors` mapped, and
  `message === title`.
- 409 + `…/version-conflict` → `kind: 'version-conflict'`, `retryable: true`.
- 500 with an HTML body → synthesised `ApiError('internal-error')`, no raw HTML in the
  message.
- `fetch` rejecting → `ApiError('network')`.
- abort → `ApiError('network')` with `retryable: false`.
- a create body containing `version` is impossible to construct (compile-time; assert the
  `Omit` type via a `satisfies` check in the test file).

`src/__tests__/api-tasks.spec.ts`
- each method hits the documented method + path + query/body shape (assert on the mocked
  fetch call arguments).

`src/__tests__/validation.spec.ts`
- one case per rule in §4.6, plus a multi-error case and `normaliseForm` behaviour
  (dedupe, lowercase, `''`→`null`).

## 7. Definition of done

- [x] `fetch` appears in exactly one file (`src/api/client.ts`) — grep to prove it.
- [x] No component or store imports anything from `src/domain` for wire shapes except
      through the API modules' exported types.
- [x] `npm run lint` → `npm run type-check` → `npx vitest run` all pass.
- [x] `HANDOFF.md` entry appended, including BE-03's null-semantics decision you mirrored.

## 8. Handoff report

**Files added / changed** …
**Decisions taken** (type strictness, query param omission, abort mapping) …
**Verification** lint / type-check / vitest → …
**Known gaps** …
