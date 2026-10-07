# FE-13 — AI Cowork panel, transcript UI and tool-result cards

| | |
|---|---|
| Status | Done |
| Spec | `feature-spec/01-task-mngt-feature-spec.md` §6.7, §6.8 |
| Satisfies | FR-AI-21, FR-AI-22, FR-AI-23, FR-AI-26, plus the visible half of FR-AI-08, FR-AI-24, FR-AI-25 |
| Depends on | FE-12 |
| Blocks | FE-14 |
| Parallel-safe | No |

## 1. Objective

The user-facing AI Cowork: a docked panel with a transcript that streams text and
reasoning, shows every tool call with arguments and result, hosts the fixed card set
(task list, task summary, stats, approval, question, status change, error), and a composer
with stop/queue behaviour. This is the demo's face.

## 2. Context you need before starting

Read spec §6.7/§6.8, and the FE-08…FE-12 reports — especially FE-09's transcript types and
selectors, FE-11's handler content-string contracts, and FE-12's card-facing store API.

## 3. Scope

### 3.1 In scope

- [x] `src/components/cowork/CoworkPanel.vue`, `CoworkComposer.vue` (spec: `Composer.vue`,
      renamed for `vue/multi-word-component-names`), `TranscriptView.vue`,
      `MessageItem.vue`, `ToolCallItem.vue`, `ReasoningBlock.vue`, `StopButton.vue`
- [x] `src/components/cowork/cards/*.vue` — `TaskListCard`, `TaskSummaryCard`,
      `StatsCard`, `ApprovalCard`, `QuestionCard`, `StatusChangeCard`, `ErrorCard`
- [x] `src/components/cowork/cardRegistry.ts` — the fixed card registry (FR-AI-21)
- [x] `SideNav` enablement of the AI entry; the panel's docked/expanded behaviour
- [x] Tests

### 3.2 Out of scope

- Any new agent capability (all tools exist).
- Sending the state document (FE-10).
- Mobile-first redesign (the panel collapses; that is all).

## 4. Design

### 4.1 Panel placement

- The AI Cowork nav item becomes enabled; clicking it **docks a right-hand panel**
  (`width: 420px`, full height, `position: sticky`) next to the main content on screens
  ≥ 1200 px; below that it becomes a full-screen overlay with a close button.
- Docked state persists in `localStorage['agui.panelOpen']` (this is UI chrome, not shared
  state, so it may use localStorage — note the distinction from OPEN-10).
- When closed, nothing about the CRUD app changes (FR-AI-08/AC-1.6: the AI is additive).
- With `config.aguiEnabled === false`, the nav item is hidden entirely.

### 4.2 `CoworkPanel.vue`

```
┌─ AI Cowork ──────────────── [minimise] [close] ┐
│ status strip: phase dot · model hint · needsResync │
│ TranscriptView (scrolls, autoscroll unless the user scrolled up) │
│ pending cards (ApprovalCard / QuestionCard / StatusChangeCard) inline │
│ Composer: textarea + send/stop + queue hint      │
└──────────────────────────────────────────────────┘
```

Status strip shows `phase` as a coloured dot with a text label (`idle`, `thinking…`,
`waiting for your approval`, `stopped`, `error`) — never colour alone. When
`needsResync` is set, show a subtle "resyncing state…" hint (FR-S-02).

### 4.3 `TranscriptView.vue` + items

- Render `transcript.items` in order; group each run into a turn separated by a subtle
  divider showing the run id/time.
- Autoscroll to the bottom **only** when the user is already at the bottom; otherwise show
  a "Jump to latest" button. (Standard chat UX; keep it simple.)
- `MessageItem.vue`:
  - user → right-aligned bubble;
  - assistant → left-aligned, `whitespace-pre-wrap`, with a typing caret while
    `streaming`, and the `ReasoningBlock` above the text;
  - `error` → `ErrorCard` styling (red left border, message + optional retry hint);
  - `notice` → a centred muted line ("Stopped", "Queued: …").
- `ReasoningBlock.vue` (FR-AI-26): `<details>` collapsed by default, summary "Thought
  process", monospace-ish small text, visually distinct (grey, italic) from the answer.
  Remembering the user's expand/collapse choice per session is a nice touch — optional.
- `ToolCallItem.vue` (FR-AI-08): always visible, never hidden behind a hover:

```
▸ query_tasks  { "q": "overdue" }        [running…]
▾ update_task_status  { "taskIds": [...], "status": "IN_REVIEW" }
    result: 2 updated, 1 blocked          [done]
```

  - a chevron toggles the raw-args detail; args render from `args` when parsed, else the
    raw `argsText` in a `<pre>` (FR-AI-27 — partial JSON must not crash or look like an
    error; label it "receiving arguments…").
  - state badge: `running…` / `done` / `failed` (red) / `awaiting approval` (amber).
  - for a client tool that opened a card (`prefill_task_form`, `ask_user`,
    `update_task_status`), the item links to the card below ("view confirmation").
  - `resultError` renders in red with the model's next message right after it (the model
    explains the failure — FR-AI-18).

### 4.4 Card registry (FR-AI-21 — fixed set, chosen in code)

```ts
// src/components/cowork/cardRegistry.ts
export type CardKind = 'task-list' | 'task-summary' | 'stats' | 'approval'
                     | 'question' | 'status-change' | 'error'
export const cardFor = (kind: CardKind) => …            // static map, no dynamic lookup
export const classify = (toolName: string, content: unknown): CardKind | null
```
The model never chooses a component: `classify` maps a **tool name** (decided by our own
declarations) plus the content shape onto a card. Unknown content falls back to the plain
result text — never a crash, never a blank area.

| Card | Rendered from | Content |
|---|---|---|
| `TaskListCard` | `query_tasks` result | rows: title (link to `/tasks/{id}`), status badge, due date (overdue flagged), assignee, tags; header "N of M"; each row clickable; "Open in task list" link carrying the same filters |
| `TaskSummaryCard` | `get_task` result | title, status/priority, description excerpt (collapsible), assignee, due date, tags, "Open task" button |
| `StatsCard` | `get_task_stats` result | compact numbers grid + "See dashboard" link |
| `ApprovalCard` | FE-12 `pendingApproval` | summary line, argument list (`describeMutation`), Approve / Reject / Dismiss; disabled while a resume is in flight; shows the result or the error after settling |
| `QuestionCard` | FE-11 `ask_user` | question, optional option buttons, a text input when `allowFreeText`, "Ask something else" fallback |
| `StatusChangeCard` | FE-11 status plan | per-task current → target, blocked rows with reasons, Approve all / Cancel (FR-AI-19) |
| `ErrorCard` | `error` transcript items + tool `error` results | message + optional code + a Retry affordance when the store says the run is retryable |

Each card is rendered **inside the transcript**, next to the tool call that produced it,
keyed by the tool message id (FR-AI-22) — so it coexists with the assistant's follow-up
text instead of replacing it.

### 4.5 `Composer.vue`

- `<textarea rows=2>` with `Enter` to send and `Shift+Enter` for a newline; a send button
  (disabled when empty).
- While `isRunning`: show `StopButton` instead of send; a second Enter **queues** the text
  and the strip shows "Queued: …" (FR-AI-25). Never send a second request.
- While an approval/question card is open: composer disabled with the hint "Answer the
  question above to continue" (`canSend === false`).
- Suggestions: on an empty transcript, three one-tap starters that make the demo reliable:
  - "What's overdue and blocked?"
  - "Create a high priority task called Fix login redirect due friday, tags bug and auth"
  - "Show me the tasks in review"
  Keep them as plain buttons that fill the textarea (do **not** auto-send).
- Stop → `stop()`; the reducer appends a "Stopped" notice (FR-AI-24).

### 4.6 Accessibility and resilience

- The panel is a labelled `<aside>`; the transcript is `role="log" aria-live="polite"`
  (cards that contain buttons use `aria-live="polite"` too — never `assertive` for
  streaming text).
- Every interactive element is keyboard reachable; focus is visible; the composer keeps
  focus after send.
- If a card throws during render, a Vue error boundary component shows a small fallback
  ("This result could not be displayed") instead of blanking the panel.

## 5. Implementation order

1. `cardRegistry.ts` + `classify` tests.
2. `TranscriptView.vue` + `MessageItem.vue` + `ReasoningBlock.vue` (streaming text first).
3. `ToolCallItem.vue`.
4. `ErrorCard.vue`, `NoticeItem` inline.
5. `ApprovalCard.vue` + `QuestionCard.vue` + `StatusChangeCard.vue` (bound to FE-11/FE-12).
6. `TaskListCard.vue`, `TaskSummaryCard.vue`, `StatsCard.vue`.
7. `Composer.vue` + `StopButton.vue` + queue hint.
8. `CoworkPanel.vue` + docking + `SideNav` enablement.
9. Error boundary + a11y pass.
10. Tests.

## 6. Tests

`src/__tests__/cowork-panel.spec.ts`
- hidden entirely when `config.aguiEnabled === false`; nav item hidden too.
- opening docks the panel; the persisted preference is honoured on remount.
- autoscroll is suppressed when scrolled up; "Jump to latest" appears.

`src/__tests__/transcript-view.spec.ts`
- user/assistant/error/notice items render with the expected roles.
- streaming content appends as it arrives (no full remount — assert the same DOM node
  identity by a stable `data-item-id`).
- reasoning block is collapsed by default and distinct from the answer text (FR-AI-26).

`src/__tests__/tool-call-item.spec.ts`
- shows the tool name always (FR-AI-08).
- parsed args render as JSON; unparsed args render the raw text with the
  "receiving arguments…" label and no crash (FR-AI-27).
- state badges map to running/done/failed/awaiting-approval.
- `resultError` renders red and a link to the card is present for card-producing tools.

`src/__tests__/cards.spec.ts` (one suite per card)
- `TaskListCard` renders rows with links, flags overdue, shows "N of M".
- `StatsCard` renders the documented numbers and links to `/`.
- `ApprovalCard` renders the summary + argument lines (never raw JSON), disables buttons
  while approving, and emits `approve` / `reject` / `dismiss`.
- `QuestionCard` renders options, emits the chosen answer, and supports free text.
- `StatusChangeCard` lists per-task legality with reasons and emits approve/cancel.
- `classify` maps each backend/client tool name to the right card and returns `null` for
  unknown tools (then plain text renders).
- a card that throws renders the fallback, not a blank panel.

`src/__tests__/composer.spec.ts`
- Enter sends; Shift+Enter inserts a newline; send is disabled when empty.
- while running, Enter queues and no second `runAgent` call is made (FR-AI-25); the queue
  hint shows the queued text.
- Stop calls `store.stop()` and the phase label updates (FR-AI-24).
- with a pending approval, the composer is disabled with the hint.

## 7. Definition of done

- [x] Every AG-UI event family is visible in the panel in some form (text, reasoning, tool
      calls, results, state hint, run outcome, errors).
- [x] The card set is fixed in `cardRegistry.ts`; no model-chosen components.
- [x] With the panel closed and the flag off, the app is byte-for-byte the Phase 1
      product (AC-1.6).
- [x] lint / type-check / vitest pass; `HANDOFF.md` entry appended (FE-14 runs the demo).

## 8. Handoff report

**Files added / changed** …
**Decisions taken** (docking breakpoints, card placement, suggestion prompts) …
**Verification** lint / type-check / vitest → …; manual walkthrough …
**Known gaps** …
