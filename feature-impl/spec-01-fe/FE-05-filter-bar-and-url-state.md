# FE-05 — Filter bar and URL query state

| | |
|---|---|
| Status | Done (2026-10-08) |
| Spec | `feature-spec/01-task-mgnt-feature-spec.md` §4.2 |
| Satisfies | FR-F-05, and the top-bar search of FR-F-01 (OPEN-12) |
| Depends on | FE-04 |
| Blocks | FE-07 (deep links), FE-10 (`context.filters`) |
| Parallel-safe | Yes — after FE-04 |

## 1. Objective

Every `FR-B-01` filter exposed as a control, with the **URL query string as the source of
truth** so a filtered view is linkable, survives reload, and is what the deep links from
the dashboard use. Plus the top-bar global search box.

## 2. Context you need before starting

Read FE-01 (shell/`TopBar.vue`), FE-02 (`TaskQuery`, `toQueryParams`),
FE-03 (`setFilter`, `setQuery`, `clearFilters`, `setSort`, `query`) and FE-04
(`TaskListView` with its `TaskFilters` stub) reports.

## 3. Scope

### 3.1 In scope

- [ ] `src/components/task/TaskFilters.vue` (replaces the stub)
- [ ] `src/utils/query.ts` — `parseTaskQuery(route.query)` and `taskQueryToRouteQuery(q)`
- [ ] Wiring: `TaskListView` ↔ route query, and `TopBar.vue` search (OPEN-12)
- [ ] Tests

### 3.2 Out of scope

- Changing the store's action semantics (FE-03 owns them).
- The dashboard's deep links (FE-07 will only *produce* URLs using this mapping).

## 4. Design

### 4.1 URL ⇄ query mapping (`src/utils/query.ts`)

| URL param | `TaskQuery` field | Encoding / decoding |
|---|---|---|
| `status` | `statuses` | repeated keys: `?status=TODO&status=BLOCKED`. Decode: split on `,` too (`?status=TODO,BLOCKED`) for hand-written URLs; drop unknown values; de-duplicate |
| `priority` | `priorities` | same as `status` |
| `assignee` | `assigneeId` | the member **id** (UUID). Also accept `assigneeName` and resolve through `useTeamStore` once members load — document this as a convenience for deep links |
| `unassigned` | `unassigned` | `true` present, absent otherwise |
| `tag` | `tag` | single value, lower-cased |
| `q` | `q` | free text |
| `overdue` | `overdue` | `true` present |
| `due` | `dueWithinDays` | integer days |
| `from` | `createdFrom` | `yyyy-MM-dd` |
| `to` | `createdTo` | `yyyy-MM-dd` |
| `sort` | `sort` + `descending` | `sort=-dueDate` (leading `-` = descending) |
| `page` | `page` | integer ≥ 0, default 0 |
| `size` | `size` | one of 10/20/50/100, default 20 |

```ts
export function parseTaskQuery(query: LocationQuery): Partial<TaskQuery>
export function taskQueryToRouteQuery(q: TaskQuery): Record<string, string>
```
Both must be total functions: any malformed value falls back to the default and is
**dropped** rather than throwing (a hand-edited URL must never white-screen).
`taskQueryToRouteQuery` omits defaults so `/tasks` stays clean — the dashboard's
deep links therefore produce short URLs.

### 4.2 Wiring pattern (critical to get right)

The URL is the source of truth; the store is a cache of it.

```
route.query  ──parse──▶  Partial<TaskQuery>  ──merge──▶  store.query  ──▶  store.fetchList()
     ▲                                                                     │
     └──────────────── taskQueryToRouteQuery(store.query) ◀────────────────┘
```

Implementation in `TaskListView.vue`:

```ts
// URL → store (on mount, on route.query change, and on back/forward navigation)
watch(() => route.query, (q) => {
  const parsed = parseTaskQuery(q)
  if (deepEqual(parsed, pickQueryFields(store.query))) return   // avoid a fetch loop
  store.setQuery(parsed)
}, { immediate: true })

// store → URL (only when the store query actually differs from the URL)
watch(() => store.query, (q) => {
  const next = taskQueryToRouteQuery(q)
  if (deepEqual(next, route.query)) return
  router.replace({ query: next })     // replace, not push: filters are not history entries
}, { deep: true })
```

Rules that prevent infinite loops (state them in Javadoc — this is the classic bug here):
1. Compare **normalised** objects on both sides, never raw strings.
2. Use `router.replace` for filter/sort/page changes so Back leaves the list rather than
   walking 40 filter states. Reserve `router.push` for row navigation.
3. Debounce only the free-text `q` input (250 ms); other filters apply immediately.
4. `setQuery` from the URL must not push a second history entry (it does not, being
   `replace`).

`src/utils/query.ts` also exports `deepEqual(a, b)` for these comparisons (arrays
compared order-insensitively for `status`/`priority`).

### 4.3 `TaskFilters.vue`

Layout (a wrapping toolbar, collapsible under a "Filters" toggle on narrow screens):

| Control | Type | Notes |
|---|---|---|
| Status | multi-select checkboxes (7) with labels | reflects `statuses`; empty = all |
| Priority | multi-select checkboxes (4) | |
| Assignee | single `<select>`: All / each member / **Unassigned** | "Unassigned" sets `unassigned: true` and clears `assigneeId`; choosing a member clears `unassigned` |
| Tags | `<select>` of the tags present in the loaded page? No — use a free-text input with a datalist of tags seen so far, kept in a local `ref` seeded from the current page | a real tag facet endpoint does not exist (no spec ID); document this limitation |
| Due | `<select>`: Any / Overdue / Due today / Due in 7 days / Due in 30 days | maps to `overdue` / `dueWithinDays` |
| Created between | two `<input type="date">` | `from` / `to`; invalid range (from > to) disables Apply and shows a hint |
| Clear all | button | disabled when `!store.isFiltered` |

Plus **active filter chips** above the table (spec FR-F-05): each chip shows
`label: value` with an `×` that removes just that filter; a "Clear all" chip at the end.
Chips are rendered from `taskQueryToRouteQuery`-like metadata, so they stay consistent
with the URL.

Every control writes through `store.setFilter(...)` (never mutating `store.query`
directly) so the store→URL watcher fires exactly once.

### 4.4 Top-bar search (OPEN-12)

`TopBar.vue` already has a search input (disabled in FE-01). Enable it:

- On submit (Enter or the search button) → `router.push({ name: 'tasks', query: { ...(q ? { q } : {}) } })`.
  Preserve existing filters when already on `/tasks` (spread `route.query` and override
  `q`); start fresh from other routes.
- Clear (×) removes `q` from the query and re-navigates.
- `aria-label="Search tasks"`, debounce-free on submit (predictable).
- It is the *same* mechanism as the `q` filter — there is no second search path.

### 4.5 Dashboard deep-link contract (for FE-07)

Export a helper so FE-07 does not hand-build query objects:

```ts
export function tasksRouteWith(partial: Partial<TaskQuery>, route = useRoute()) {
  return { name: 'tasks' as const, query: { ...route.query, ...taskQueryToRouteQuery({ ...DEFAULT_TASK_QUERY, ...partial }) } }
}
```
Caveat to document: because the mapping omits defaults, spreading `route.query` then
overriding with defaults **clears** filters absent from `partial`. That is the intended
behaviour for a dashboard deep link ("show me overdue", not "overdue ∩ whatever I had").

## 5. Implementation order

1. `src/utils/query.ts` + tests (pure, fastest feedback).
2. `TaskFilters.vue` (controls write via `setFilter`).
3. Active filter chips (same file).
4. URL ⇄ store wiring in `TaskListView.vue`.
5. Top-bar search.
6. `tasksRouteWith` helper.
7. Tests.

## 6. Tests

`src/__tests__/query.spec.ts`
- `parseTaskQuery` handles repeated keys, comma-separated values, unknown values (dropped),
  `-` sort prefix, invalid `page`/`size`/`due` (fallback), `unassigned`/`overdue` flags.
- round-trip: `taskQueryToRouteQuery(parseTaskQuery(url))` is stable for a table of URLs
  and every URL it produces re-parses to the same `TaskQuery`.
- defaults are omitted from the produced query (assert `{}` for a default query).

`src/__tests__/TaskFilters.spec.ts`
- toggling a status checkbox calls `setFilter({ statuses: [...] })` with the full new
  array; unchecking the last one yields `[]`.
- choosing "Unassigned" sets `unassigned: true` and `assigneeId: null`.
- choosing a member clears `unassigned`.
- "Clear all" calls `clearFilters` and is disabled when nothing is filtered.
- an inverted date range blocks apply with a hint.
- chips: one chip per active filter, `×` removes exactly that filter, "Clear all" present
  when ≥ 2 filters are active.

`src/__tests__/url-state.spec.ts` (mount `TaskListView` with a real router + store, mock `taskApi.list`)
- initial navigation to `/tasks?status=TODO&sort=-dueDate&page=2` results in a list call
  with exactly that `TaskQuery`.
- changing a filter updates the URL with `replace` and does **not** grow
  `router.options.history` length.
- a store-driven change (e.g. `setSort`) updates the URL once — assert exactly one
  `list` call per user action (loop guard).
- `router.back()` after a filter change restores the previous filter set and refetches.
- a hand-typed garbage query (`?page=abc&status=NOPE`) renders the unfiltered list, not an
  error.

`src/__tests__/TopBar.spec.ts`
- submitting from `/dashboard` navigates to `/tasks?q=…` with no other params.
- submitting on `/tasks` preserves existing filters and overrides `q`.
- clearing removes only `q`.

## 7. Definition of done

- [ ] Every `FR-B-01` filter has a control; every active filter has a removable chip.
- [ ] Reload, deep link, and Back/forward all reproduce the same list.
- [ ] No infinite fetch loop: one `list` call per user action (asserted in tests).
- [ ] lint / type-check / vitest pass; `HANDOFF.md` entry appended (FE-07 and FE-10 read it).

## 8. Handoff report

**Files added / changed** …
**Decisions taken** (URL param names, replace-vs-push, tag facet limitation) …
**Verification** lint / type-check / vitest → …
**Known gaps** …
