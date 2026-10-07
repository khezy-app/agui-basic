# FE-07 — Dashboard page

| | |
|---|---|
| Status | Done (2026-10-08) |
| Spec | `feature-spec/01-task-mgnt-feature-spec.md` §4.4 |
| Satisfies | FR-F-13, FR-F-14, part of FR-F-03 |
| Depends on | FE-03, FE-05 (`tasksRouteWith` deep links) |
| Blocks | demo |
| Parallel-safe | Yes — after FE-05 |

## 1. Objective

The `/` landing screen: four stat cards, a status-distribution visual, a priority
breakdown, and due-soon/unassigned lists that deep-link into the filtered task list.
Every number comes from `GET /api/tasks/stats` (whole-store, not the current page).

## 2. Context you need before starting

Read FE-02 (`TaskStats`), FE-03 (`stats`, `fetchStats`, `statsState`, `statsError`),
FE-05 (`tasksRouteWith`) and FE-04 (`LoadingBlock`, `ErrorBlock`, `EmptyState`,
`StatusBadge`) reports.

## 3. Scope

### 3.1 In scope

- [ ] `src/views/DashboardView.vue`
- [ ] `src/components/dashboard/StatCards.vue`, `StatusDistribution.vue`,
      `DueSoonList.vue`
- [ ] Optionally `src/components/dashboard/PriorityBreakdown.vue` (fold into
      `StatusDistribution.vue` if you prefer fewer files — note the choice)
- [ ] Tests

### 3.2 Out of scope

- Charts libraries (OPEN-7 — none installed, none allowed). Use CSS bars.
- Date-range pickers, comparisons over time (no backend support).
- Any new endpoint.

## 4. Design

### 4.1 `DashboardView.vue`

```
<h1>Dashboard</h1>  [Refresh]
<LoadingBlock v-if="statsState === 'loading' && !stats" />
<ErrorBlock   v-else-if="statsState === 'error'" :error="statsError" @retry="fetchStats" />
<template     v-else-if="stats">
  <StatCards :stats="stats" />
  <div class="grid">
    <StatusDistribution :by-status="stats.byStatus" :total="stats.total" />
    <PriorityBreakdown :by-priority="stats.byPriority" />
    <DueSoonList :stats="stats" :tasks="…" />
  </div>
</template>
```

- `onMounted` → `tasks.setView('dashboard')`, `team.fetchMembers()`, and
  `stats.fetchStats()` when `statsState === 'idle'`.
- **Refresh button** refetches stats and the current task page; useful during the demo
  after an AI mutation.
- Do not auto-poll. Document that decision (no stale-state surprises, simpler tests).

### 4.2 `StatCards.vue` (FR-F-13)

Four cards, each an `<RouterLink>` deep-linking into `/tasks` with the matching filter:

| Card | Value | Link target |
|---|---|---|
| Open tasks | `total - byStatus.DONE - byStatus.CANCELLED` | `{ statuses: [BACKLOG, TODO, IN_PROGRESS, IN_REVIEW, BLOCKED] }` |
| Overdue | `overdueTotal` | `{ overdue: true }` |
| Due this week | `dueThisWeek` | `{ dueWithinDays: 7 }` (note: backend `dueThisWeek` is week-based and overdue-inclusive per OPEN-6 — add a `title` tooltip saying the card includes overdue items) |
| Unassigned | `unassignedTotal` | `{ unassigned: true }` |

Each card shows label, big number, a one-line hint, and turns red when the value is > 0
for Overdue. Zero values render muted, not hidden (a stable layout matters for the demo).

### 4.3 `StatusDistribution.vue`

A horizontal stacked bar plus a legend list — CSS only.

```ts
props: { byStatus: Record<TaskStatus, number>; total: number }
```
- Segments in workflow order (`BACKLOG → TODO → IN_PROGRESS → IN_REVIEW → DONE`) with
  `BLOCKED` and `CANCELLED` after, each using the `--status-*` colour from FE-01's
  tokens.
- Widths are percentages of `total`; a zero total renders an empty track with
  "No tasks yet".
- The legend rows are **links** to `/tasks?status=<X>` and show `label`, count and
  percentage; hovering a segment highlights its legend row and vice versa.
- Accessibility: the bar is `role="img"` with an `aria-label` summarising all counts, and
  the legend carries the same information as text.

### 4.4 `PriorityBreakdown.vue`

Four rows (LOW → URGENT) with a proportional bar, count and a link to
`/tasks?priority=<X>`. Optional per §3.1; if omitted, this content moves into
`StatusDistribution.vue` as a second section.

### 4.5 `DueSoonList.vue` (FR-F-14)

Two short lists, each capped at 5 rows with a "View all →" link:

| List | Source | Link |
|---|---|---|
| Due soon | `dueWithinDays: 7` fetch (`size: 5`, `sort: dueDate` asc) | `{ dueWithinDays: 7, sort: 'dueDate', descending: false }` |
| Unassigned, open | `unassigned: true` fetch (`size: 5`, `sort: createdAt` desc) | `{ unassigned: true }` |

Each row: title link → `/tasks/{id}`, status badge, due date (overdue flagged),
assignee (or "Unassigned"). Handle the "no rows" case with a one-line muted message, not
an empty panel.

Implementation note: these two lists are **separate `taskApi.list` calls**, not part of
`stats`. Keep them in the dashboard view (a local `ref`), not in the task store's shared
list state, so they never fight with the task list's query.

## 5. Implementation order

1. `StatCards.vue` + test.
2. `StatusDistribution.vue` (+ `PriorityBreakdown.vue`) + test.
3. `DueSoonList.vue` + test.
4. `DashboardView.vue` with the three states + test.
5. Verify the deep links land on a correctly filtered `/tasks` (manual).

## 6. Tests

`src/__tests__/StatCards.spec.ts`
- computes `open` as `total - DONE - CANCELLED`.
- each card's `RouterLink` `to` contains the expected query params (assert the resolved
  route object, not the rendered href).
- zero values render (not hidden); overdue > 0 gets the danger class.

`src/__tests__/StatusDistribution.spec.ts`
- segment widths sum to 100 % within rounding tolerance; zero total renders the empty
  message.
- all 7 statuses appear in the legend with counts, in workflow order.
- clicking a legend row navigates to `/tasks?status=X`.

`src/__tests__/DueSoonList.spec.ts`
- renders at most 5 rows plus a "View all" link; empty state message when none.
- an overdue due date is flagged.

`src/__tests__/DashboardView.spec.ts`
- loading → `LoadingBlock`; error → `ErrorBlock` + retry refetches; ready → all three
  sections.
- mounts with `setView('dashboard')` and fetches members + stats once.
- two extra `list` calls are made for the two short lists with the documented queries.

## 7. Definition of done

- [ ] Every number on the dashboard traces to `/api/tasks/stats` or a documented list
      call; no client-side recomputation of whole-store totals from a page of tasks.
- [ ] All dashboard cards and legend rows deep-link into a correctly filtered task list
      (manual check, recorded in the handoff).
- [ ] No chart library added; `package.json` dependencies unchanged.
- [ ] lint / type-check / vitest pass; `HANDOFF.md` entry appended.

## 8. Handoff report

**Files added / changed** …
**Decisions taken** (cards vs chart split, no polling, tooltip wording) …
**Verification** lint / type-check / vitest → …; manual deep-link check …
**Known gaps** …
