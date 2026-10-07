# FE-14 — Frontend verification, coverage audit and demo support

| | |
|---|---|
| Status | Done — gate green; residual live rows recorded as BLOCKED/waived in `HANDOFF.md` |
| Spec | `feature-spec/01-task-mngt-feature-spec.md` §7 (phase gate), §8, §9 |
| Satisfies | NFR-5, NFR-6, NFR-7, and the demonstrability of AC-1.1…AC-1.6 / AC-2.1…AC-2.10 |
| Depends on | all FE tasks |
| Blocks | the demo script |

## 1. Objective

Prove every acceptance criterion end to end against a running backend, close the
coverage map, and leave a written walkthrough the demo can be run from without an agent
in the loop.

## 2. Context you need before starting

Read `00-index.md` (§5 open decisions, §6 coverage map), the whole `HANDOFF.md`, the
backend's `HANDOFF.md` (especially BE-10's verify script output), and spec §9.

## 3. Scope

### 3.1 In scope

- [ ] `frontend/scripts/verify-01.md` — a numbered manual checklist with expected results,
      mapped to requirement IDs (human-run; some criteria need eyes, not a script)
- [ ] `frontend/README.md` — prerequisites, scripts, env vars, proxy, the AI feature flag
- [ ] Coverage audit table in `HANDOFF.md`
- [ ] Small fixes required to make the checklist pass
- [ ] Test-suite hygiene pass

### 3.2 Out of scope

- E2E test framework (Playwright/Cypress). **Not** added: the spec asks for Vitest under
  `src/**/__tests__/` (NFR-6) and the demo is manual. Record this decision.
- New features, visual redesign, performance work.

## 4. Design

### 4.1 Automated gate (must be green before the manual pass)

```sh
npm run lint && npm run type-check && npx vitest run
```
Plus a sanity assertion that `npm run build` succeeds (`npm run build` = type-check +
vite build).

### 4.2 `scripts/verify-01.md` structure

For each criterion: **Given / When / Then steps**, the exact prompt text to type, and the
observable outcome (a visible element or a network entry in devtools). Group it:

**Group A — Phase 1 (AI flag off)**

| # | Criterion | How to force it |
|---|---|---|
| A1 | AC-1.1 | Seed present; open `/tasks`; exercise all ten filters, sort on four columns, page to the end |
| A2 | AC-1.2 | Submit `TaskForm` with an empty title and 6 tags |
| A3 | AC-1.3 | Find an `IN_REVIEW` task, try `BACKLOG` from the row dropdown (option absent) and via `POST /{id}/status` in devtools/curl → 409 |
| A4 | AC-1.4 | Apply filters, note the URL, press "Clear all", assert `/tasks?size=…` and page 0 |
| A5 | AC-1.5 | Select 3 tasks, choose a target that is illegal for one, submit |
| A6 | AC-1.6 | Reload with `VITE_AGUI_ENABLED=false`; walk every screen |
| A7 | FR-F-03 | Force each state: loading (throttle network to Slow 3G), empty (filter to a nonsense `q`), error (stop the backend, hit refresh) |
| A8 | NFR-9 | Confirm requests to `/api` and `/agent` are same-origin (proxied) and no CORS error appears |

**Group B — Phase 2 prefill (AC-2.1, AC-2.2)**

| # | Criterion | Prompt / action | Observable |
|---|---|---|---|
| B1 | AC-2.1 | Open `/tasks/new`, in the panel send: `Create a high priority task called Fix login redirect due friday, tags bug and auth` | navigates to the form, fields filled, "Prefilled by the assistant" banner, AI field markers, **Network tab shows no `POST /api/tasks`** |
| B2 | — | Press Save; verify one task created and the marker is gone | Network tab shows exactly one POST |
| B3 | AC-2.2 | Send `Create a task called Fix flaky chart, assign it to Zeke` | assignee omitted, amber callout names it; then type a title yourself and send the same draft again → your value survives |
| B4 | FR-S-04 | Edit an AI field manually while a later draft arrives | your edit wins |

**Group C — Read tools (AC-2.3)**

| # | Criterion | Prompt | Observable |
|---|---|---|---|
| C1 | AC-2.3 | `What's overdue and blocked?` | `query_tasks` tool call visible with args and result; a `TaskListCard`; the answer text references the returned tasks |
| C2 | FR-AI-09 | `How much work is in review?` | `get_task_stats` call + `StatsCard` |
| C3 | FR-AI-10 | — | Grep the transcript: no `/api/` path ever appears in an assistant message |

**Group D — Status change via client tool (AC-2.4, FR-AI-19)**

| # | Criterion | Prompt | Observable |
|---|---|---|---|
| D1 | AC-2.4 | `Mark the three login tasks as in review` | `StatusChangeCard` listing current → target per task, blocked ones with reasons; nothing changed |
| D2 | — | Approve | Network shows `POST /api/tasks/bulk-status`; the card reports the outcome; the list rows show the new status after the refetch |
| D3 | FR-AI-19 | Inspect the Network tab | no backend write tool call; the mutation came from the frontend |
| D4 | FR-AI-18 | Approve a change the backend rejects (e.g. `DONE` → `BACKLOG`) | card shows the backend `detail` in red, `error` travels to the model, the model explains |

**Group E — Approval / interrupts (AC-2.5, AC-2.8, FR-AI-11)**

| # | Criterion | Prompt | Observable |
|---|---|---|---|
| E1 | FR-AI-11 | `Delete task <id> because it is a duplicate` | the transcript shows a `propose_task_mutation` call and an interrupt; **no** `DELETE` request |
| E2 | AC-2.5 | Click Reject with a reason | no `DELETE`; a resume run starts; the model acknowledges and offers an alternative |
| E3 | FR-AI-17 | Approve a create | `POST /api/tasks` appears **after** the click; the result renders; the list refetches |
| E4 | AC-2.8 | Start an approval, reload the page mid-approval | the card is restored with the "restored" note; approving resumes on the same thread |
| E5 | FR-AI-14 | Ask for a bulk change of 5 tasks | exactly **one** proposal, one approval, one mutation |

**Group F — Robustness (AC-2.6, AC-2.7, AC-2.9, AC-2.10)**

| # | Criterion | Action | Observable |
|---|---|---|---|
| F1 | AC-2.6 | `Set it to done` (no referent) | `ask_user` card; no mutation |
| F2 | FR-AI-24 | Send a long prompt, press Stop mid-stream | "Stopped" notice; the next message starts a new run |
| F3 | FR-AI-25 | Press Enter twice quickly | second text is queued, one request per run |
| F4 | AC-2.7 | Stop Ollama (or point `OPENAI_BASE_URL` at a dead port) and send a message | error card in the transcript + a banner; the CRUD app still works |
| F5 | AC-2.9 | Watch any run | streamed text, every tool call with args and result, terminal state visible |
| F6 | AC-2.10 | After a prefill, inspect the state document the panel sent (devtools → request body) | `draft` present with `source: 'ai'` and `missing`; your later edit appears in the next run's state |
| F7 | FR-S-02 | Hard to force — document how (e.g. an interceptor that corrupts one delta) and assert the UI stays consistent with a resync hint |

Record, for every row, `PASS` / `FAIL (why)` / `BLOCKED (why)` in `HANDOFF.md`. A `FAIL`
must be fixed or waived with a reason — no silent gaps.

### 4.3 Test-suite hygiene (NFR-6, NFR-7)

- Every test lives under `src/**/__tests__/` (the ESLint vitest rules are scoped there —
  a test elsewhere will fail lint or be ignored).
- Minimum mandated coverage, all present and passing: form validation, filter→request
  mapping, the AG-UI event reducer, state-delta application. Verify each has a named
  suite (FE-02, FE-05, FE-09, FE-10 respectively).
- No test depends on network or a model. No `test.only`/`.skip` left behind. No snapshot
  files that were regenerated blindly (review them).
- `npx vitest run` reports the total count; record it in `HANDOFF.md`.
- Delete the scaffold `App.spec.ts` assertion if FE-01 missed it (it must be gone).

### 4.4 Coverage audit

Produce the same style of table as BE-10 for `00-index.md` §6:

| Spec ID | Status | Evidence (test name / checklist row) |
|---|---|---|

## 5. Implementation order

1. Automated gate; fix what fails.
2. `frontend/README.md`.
3. `scripts/verify-01.md` written **as you execute it**, group by group, backend running.
4. Coverage audit.
5. Final gate re-run + `npm run build`.

## 6. Definition of done

- [ ] `npm run lint`, `npm run type-check`, `npx vitest run`, `npm run build` all green.
- [ ] `scripts/verify-01.md` executed end to end against a running backend; every row has
      a recorded result.
- [ ] Every ID in `00-index.md` §6 has a status and evidence.
- [ ] `frontend/README.md` documents run, env vars, proxy, flag, tests.
- [ ] `HANDOFF.md` entry appended with the totals, results table and every out-of-scope
      fix you made.

## 7. Handoff report

**Files added / changed** …
**Automated gate** (lint / type-check / vitest count / build) …
**Manual results** (A1…F7 summary; link the full table) …
**Coverage audit** …
**Waivers** …
**Known gaps** …
