# Verification checklist — spec-01 (frontend)

Run order: automated gate first (§0), then Groups A–F. Record every row as
`PASS` / `FAIL (why)` / `BLOCKED (why)` in `feature-impl/spec-01-fe/HANDOFF.md`.
No silent gaps: a FAIL must be fixed or waived with a reason.

Prerequisites:

```sh
# terminal 1 — backend (seeds data on first boot)
cd backend && ./gradlew bootRun          # http://localhost:8080

# terminal 2 — frontend
cd frontend && npm install && npm run dev # http://localhost:5173
```

Env: copy `frontend/.env.example` to `frontend/.env`. `VITE_AGUI_ENABLED=false`
runs the app as pure CRUD (Group A). AI rows also need Ollama running
(`localhost:11434`, model `gemma4:e4b`) and `VITE_AGUI_ENABLED=true`.

## 0. Automated gate

| # | Command | Expected |
|---|---|---|
| 0.1 | `npm run lint` | exit 0 |
| 0.2 | `npm run type-check` | exit 0 |
| 0.3 | `npx vitest run` | all files pass; record the total count |
| 0.4 | `npm run build` | exit 0 (type-check + vite build) |

## Group A — Phase 1 (AI flag off, `VITE_AGUI_ENABLED=false`)

| # | Criterion | How to force it | Observable |
|---|---|---|---|
| A1 | AC-1.1 | Seed present; open `/tasks`; exercise all ten filters, sort on four columns, page to the end | rows, counts, and sort glyphs change per control; last page reachable |
| A2 | AC-1.2 | Submit `TaskForm` with an empty title and 6 tags | inline field errors, no request (or 400 with the C1 envelope mapped onto fields) |
| A3 | AC-1.3 | Find an `IN_REVIEW` task, try `BACKLOG` from the row dropdown (option absent); `POST /{id}/status` with an illegal target → 409 | option missing; devtools shows 409 with `illegal-transition` detail |
| A4 | AC-1.4 | Apply filters, note the URL, press "Clear all" | URL becomes `/tasks?size=…` and page 0 |
| A5 | AC-1.5 | Select 3 tasks, choose a target illegal for one, submit | per-id rejection detail shown, succeeded ones applied |
| A6 | AC-1.6 | Reload with `VITE_AGUI_ENABLED=false`; walk every screen | no agent construction, no `/agent` calls, all CRUD works |
| A7 | FR-F-03 | Force each state: loading (Slow 3G throttle), empty (nonsense `q`), error (stop the backend, refresh) | one of skeleton / empty / `ErrorBlock`, never a blank view |
| A8 | NFR-9 | Inspect devtools → Network | `/api` and `/agent` requests are same-origin (`localhost:5173`); no CORS errors |

## Group B — Prefill (AC-2.1, AC-2.2, FR-S-04)

> Requires FE-13 (cowork panel UI). Rows stayed **BLOCKED** until it lands.

| # | Criterion | Prompt / action | Observable |
|---|---|---|---|
| B1 | AC-2.1 | `/tasks/new`, panel: `Create a high priority task called Fix login redirect due friday, tags bug and auth` | navigates to form, fields filled, "Prefilled by the assistant" banner, AI field markers, no `POST /api/tasks` in Network |
| B2 | — | Press Save | exactly one `POST /api/tasks`; marker gone |
| B3 | AC-2.2 | `Create a task called Fix flaky chart, assign it to Zeke` | assignee omitted, amber callout; re-run same draft after typing your own title → your value survives |
| B4 | FR-S-04 | Edit an AI field manually while a later draft arrives | your edit wins |

## Group C — Read tools (AC-2.3)

| # | Criterion | Prompt | Observable |
|---|---|---|---|
| C1 | AC-2.3 | `What's overdue and blocked?` | `query_tasks` call with args+result, `TaskListCard`, answer references returned tasks |
| C2 | FR-AI-09 | `How much work is in review?` | `get_task_stats` call + `StatsCard` |
| C3 | FR-AI-10 | — | no `/api/` path ever appears in an assistant message |

## Group D — Status change via client tool (AC-2.4, FR-AI-18/19)

| # | Criterion | Prompt | Observable |
|---|---|---|---|
| D1 | AC-2.4 | `Mark the three login tasks as in review` | `StatusChangeCard`, current → target per row, blocked with reasons, nothing changed |
| D2 | — | Approve | `POST /api/tasks/bulk-status` fired; card reports outcome; rows refetched |
| D3 | FR-AI-19 | Network tab | no backend write tool call; mutation came from the frontend |
| D4 | FR-AI-18 | Approve a change the backend rejects (`DONE` → `BACKLOG`) | card shows backend `detail` in red; model explains the failure |

## Group E — Approval / interrupts (AC-2.5, AC-2.8, FR-AI-11/14/17)

| # | Criterion | Prompt | Observable |
|---|---|---|---|
| E1 | FR-AI-11 | `Delete task <id> because it is a duplicate` | `propose_task_mutation` call + interrupt; no `DELETE` |
| E2 | AC-2.5 | Reject with a reason | no `DELETE`; resume run; model acknowledges |
| E3 | FR-AI-17 | Approve a create | `POST /api/tasks` after the click; result renders; list refetches |
| E4 | AC-2.8 | Start an approval, reload mid-approval | card restored with "restored" note; approving resumes on the same thread |
| E5 | FR-AI-14 | Ask for a bulk change of 5 tasks | exactly one proposal, one approval, one mutation |

## Group F — Robustness (AC-2.6…AC-2.10)

| # | Criterion | Action | Observable |
|---|---|---|---|
| F1 | AC-2.6 | `Set it to done` | `ask_user` card; no mutation |
| F2 | FR-AI-24 | Long prompt, Stop mid-stream | "Stopped" notice; next message starts a new run |
| F3 | FR-AI-25 | Press Enter twice quickly | second text queued; one request per run |
| F4 | AC-2.7 | Kill Ollama / dead `OPENAI_BASE_URL`; send a message | error card + banner; CRUD still works |
| F5 | AC-2.9 | Watch any run | streamed text, every tool call with args+result, terminal state |
| F6 | AC-2.10 | Inspect the request body the panel sends | `draft` present, `source: 'ai'`, `missing`; your edits appear in the next run's state |
| F7 | FR-S-02 | Corrupt one delta via an interceptor | UI stays consistent, resync hint appears |

## Scoring

Record, for every row: `PASS` / `FAIL (why)` / `BLOCKED (why)`. Attach the
outcomes table to the `HANDOFF.md` FE-14 entry.
