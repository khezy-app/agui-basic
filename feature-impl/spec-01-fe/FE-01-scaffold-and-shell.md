# FE-01 — App shell, routing and base styles

| | |
|---|---|
| Status | Done (2026-10-07) |
| Spec | `feature-spec/01-task-mgnt-feature-spec.md` §4.1 |
| Satisfies | FR-F-01, FR-F-02, part of FR-F-03 |
| Depends on | — |
| Blocks | every other FE task |
| Parallel-safe | No (root of the chain) |

## 1. Objective

Replace the create-vue scaffold with the application shell: layout frame, sidebar
navigation, top bar, route table, 404 view, global toast region, and the design tokens
(status badge colours, spacing, typography) every later task will use.

## 2. Context you need before starting

Current state:

```
frontend/src/App.vue          scaffold (Hello World + "You did it!" markup)
frontend/src/main.ts          createApp(App).use(router).mount('#app')
frontend/src/router/index.ts  scaffold routes
frontend/src/stores/counter.ts
frontend/src/__tests__/App.spec.ts   asserts the scaffold text
```

Facts:
- Vue 3.5 + Vite 8 + TS, `vue-router` 5, `pinia` 4 are installed. No UI library
  (OPEN-7) and none may be added.
- `npm run lint` **mutates files**; run it early so you are not surprised.
- `frontend/src/__tests__/App.spec.ts` asserts `You did it!` — it will break the moment
  you rewrite `App.vue`. **Delete it in this task** and replace it with a shell test
  (spec §10 note 3).
- Prettier: no semicolons, single quotes, width 100.

## 3. Scope

### 3.1 In scope

- [x] `src/assets/main.css` — reset, tokens, status/priority colour classes
- [x] `src/config.ts`
- [x] `src/App.vue` — `<RouterView>` inside `AppShell` + toast region
- [x] `src/components/layout/AppShell.vue`, `SideNav.vue`, `TopBar.vue` (+ `ToastRegion.vue`)
- [x] `src/stores/ui.ts` (toast store)
- [x] `src/router/index.ts` — full route table with lazy imports
- [x] `src/views/NotFoundView.vue` + placeholder views for the four real routes so the
      shell renders something meaningful
- [x] Tests: `src/__tests__/App.spec.ts` (rewritten), `src/__tests__/router.spec.ts`
      (+ `ui-store.spec.ts`)

### 3.2 Out of scope

- Any API call (FE-02+).
- Real view content (FE-04…FE-07) — placeholders only, clearly marked.
- The AI Cowork panel entry point in the sidebar: render the nav item, disabled with a
  "coming in Phase 2" tooltip until FE-13 (avoid a dead link).

## 4. Design

### 4.1 `src/config.ts`

```ts
export const config = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '/api',
  aguiUrl: import.meta.env.VITE_AGUI_URL ?? '/agent',
  aguiEnabled: import.meta.env.VITE_AGUI_ENABLED !== 'false',
} as const
```
Proxied paths by default so dev works with the BE-06 Vite proxy (FE-08 configures the
proxy; this task only defaults to it). Add `src/vite-env.d.ts` augmentation for the three
`VITE_*` variables.

### 4.2 Routes

```ts
const routes = [
  { path: '/', name: 'dashboard', component: () => import('@/views/DashboardView.vue') },
  { path: '/tasks', name: 'tasks', component: () => import('@/views/TaskListView.vue') },
  { path: '/tasks/new', name: 'task-new', component: () => import('@/views/TaskFormView.vue') },
  { path: '/tasks/:id', name: 'task-detail', component: () => import('@/views/TaskDetailView.vue'),
    props: true },
  { path: '/tasks/:id/edit', name: 'task-edit', component: () => import('@/views/TaskFormView.vue'),
    props: true },
  { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('@/views/NotFoundView.vue') },
]
```
- `/tasks/new` **before** `/tasks/:id` so `new` is not parsed as an id.
- Views receive route params via `props: true` (typed with `defineProps<{ id?: string }>()`).
- Add `router.afterEach` scroll-to-top and a document title per route
  (`meta.title`), e.g. `Tasks · Task Manager`.
- Use the `@` alias → configure `vite.config.ts` `resolve.alias` **only if** it is not
  already there (check first; if you add it, also add it to `tsconfig*.json` paths and
  `vitest.config.ts`). Keep it consistent everywhere.

### 4.3 `AppShell.vue` layout

```
┌────────────┬──────────────────────────────────────────┐
│ SideNav    │ TopBar (title · search · current user)   │
│  Dashboard ├──────────────────────────────────────────┤
│  Tasks     │                                          │
│  AI Cowork │  <RouterView />                          │
│  (disabled)│                                          │
│            │                                          │
├────────────┴──────────────────────────────────────────┤
│ ToastRegion (fixed, bottom-right)                     │
└───────────────────────────────────────────────────────┘
```

- `SideNav`: vertical, uses `RouterLink` with an `active` class from
  `useRoute().path`; each item declares `title`, `to`, `icon` (inline SVG or a unicode
  glyph — no icon dependency), and `disabled`.
- `TopBar`: page title from `route.meta.title`; a search `<input>` that emits
  `search` (OPEN-12: it navigates to `/tasks?q=…`, implemented in FE-05; until then it
  is disabled with a hint); a "current user" chip — a fixed dev identity
  (`Dev User`, no auth per spec non-goals) that later tasks may use as `reporterId`.
- `AppShell` renders `SideNav`, `TopBar`, the `RouterView` slot, and `ToastRegion`. It
  must render the shell even on the 404 route.
- Mobile: below 900 px the sidebar collapses to a top row of links. Not a drawer —
  keep it simple.

### 4.4 Design tokens (`src/assets/main.css`)

```css
:root {
  --bg: #0f172a; --surface: #ffffff; --surface-alt: #f8fafc;
  --border: #e2e8f0; --text: #0f172a; --text-muted: #64748b;
  --primary: #2563eb; --danger: #dc2626; --warning: #d97706; --success: #16a34a;
  --radius: 8px; --space-1: 4px; --space-2: 8px; --space-3: 16px; --space-4: 24px;
}
```

Status colours as classes consumed by `StatusBadge.vue` in FE-04:

| status | class | colour intent |
|---|---|---|
| `BACKLOG` | `status-backlog` | neutral grey |
| `TODO` | `status-todo` | slate |
| `IN_PROGRESS` | `status-in-progress` | blue |
| `IN_REVIEW` | `status-in-review` | amber |
| `BLOCKED` | `status-blocked` | red |
| `DONE` | `status-done` | green |
| `CANCELLED` | `status-cancelled` | muted, struck-through label |

Priority: `LOW/MEDIUM/HIGH/URGENT` → grey / slate / amber / red.

Light theme only (dark mode is a spec non-goal). Do not add a theme switch.

### 4.5 `useUiStore`

```ts
export type Toast = { id: string; kind: 'info' | 'success' | 'error'; title: string; detail?: string }
export const useUiStore = defineStore('ui', () => {
  const toasts = ref<Toast[]>([])
  const pushToast = (t: Omit<Toast, 'id'>) => { … keep ≤ 3, errors persist … }
  const dismissToast = (id: string) => { … }
  return { toasts, pushToast, dismissToast }
})
```
OPEN-8: max 3 visible, auto-dismiss after 6 s for `info`/`success`, `error` stays until
dismissed. The store owns the timers so tests can use fake timers.

## 5. Implementation order

1. Delete `src/stores/counter.ts`, rewrite `src/assets/main.css`, `src/config.ts`.
2. `useUiStore` + `ToastRegion.vue` (inside `src/components/layout/`).
3. `SideNav.vue`, `TopBar.vue`, `AppShell.vue`, rewrite `App.vue`.
4. Router table + `NotFoundView.vue` + four placeholder views.
5. Rewrite `App.spec.ts`, add `router.spec.ts`.
6. `npm run lint` → `npm run type-check` → `npx vitest run`.

## 6. Tests

`src/__tests__/App.spec.ts` (rewritten, mount with a real router + `createTestingPinia`-free real Pinia)
- renders the sidebar with 3 nav items; the AI item is disabled.
- navigating to `/tasks` renders the tasks route's placeholder heading.
- navigating to `/nope` renders the not-found view, and the shell is still present.
- `pushToast` renders a toast with title + detail; `dismissToast` removes it.

`src/__tests__/router.spec.ts`
- `router.resolve('/tasks/new').name === 'task-new'` (route order guard).
- every declared route has a `meta.title`.
- `/tasks/abc` resolves to `task-detail` with `props.id === 'abc'`.

`src/__tests__/ui-store.spec.ts`
- max 3 toasts; error toasts are not auto-dismissed (fake timers); success toasts are.

## 7. Definition of done

- [x] `npm run dev` shows the shell with working navigation on all six routes.
- [x] `npm run lint`, `npm run type-check`, `npx vitest run` all pass.
- [x] No `You did it!` string remains anywhere; the scaffold counter store is gone.
- [x] Design tokens cover all 7 statuses and 4 priorities.
- [x] `HANDOFF.md` entry appended.

## 8. Handoff report

**Files added / changed** …
**Decisions taken** (alias, icon approach, breakpoint) …
**Verification** lint / type-check / vitest → …
**Known gaps** …
