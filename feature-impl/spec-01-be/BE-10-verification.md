# BE-10 — Backend verification, documentation and coverage check

| | |
|---|---|
| Status | Done |
| Spec | `feature-spec/01-task-mgnt-feature-spec.md` §7 (phase gate), §8 |
| Satisfies | NFR-5, NFR-1, NFR-2, NFR-3, NFR-10 |
| Depends on | BE-01 … BE-09 |
| Blocks | frontend integration (nothing may be called done until this passes) |

## 1. Objective

Prove the backend contract end to end without a browser, close every spec-ID gap, and
leave a written record (script + transcripts) the demo script can reuse.

## 2. Context you need before starting

Read `00-index.md` (especially §7 coverage map and §6 open decisions), the **whole**
`HANDOFF.md`, and every task doc's handoff report. You are auditing, not building —
small fixes in other tasks' files are allowed and expected; report every one.

## 3. Scope

### 3.1 In scope

- [x] `backend/README.md` — how to run,
      what is seeded, what the AI layer needs, the CORS/proxy strategy
- [x] `backend/scripts/verify-01.sh` (executable, runnable end-to-end)
      list of curl commands) that proves each acceptance criterion server-side
- [x] Coverage audit against `00-index.md` §7 — every ID stated or waived
      waived in `HANDOFF.md`
- [x] Small fixes made — all in the script (see HANDOFF entry); no production code touched

### 3.2 Out of scope

- New features, refactors for elegance, performance work beyond NFR-1.
- Frontend verification (FE-14).

## 4. Design

### 4.1 Verification script

`bash scripts/verify-01.sh` must:

1. Start nothing itself; assume `./gradlew bootRun` is already up (document that), or
   start it in the background and tear it down (preferred for CI use — use a trap).
2. Run an assertion helper:

```bash
assert_status() {  # method path expected_status [body]
  local actual
  actual=$(curl -s -o /tmp/body.json -w '%{http_code}' -X "$1" "localhost:8080$2" "${@:3}")
  [[ "$actual" == "$3" ]] || { echo "FAIL $1 $2 -> $actual (want $3)"; cat /tmp/body.json; exit 1; }
}
assert_json()    { # jq expression expected   over /tmp/body.json
  local actual; actual=$(jq -r "$1" /tmp/body.json)
  [[ "$actual" == "$2" ]] || { echo "FAIL jq $1 -> $actual (want $2)"; exit 1; }
}
```

3. Assert, in order, with printed PASS/FAIL per line:

| # | Assertion | Criterion |
|---|---|---|
| 1 | `GET /api/tasks?size=2&sort=-createdAt` → 200, `totalElements >= 40`, `size == 2`, `content|length == 2` | AC-1.1 |
| 2 | each of `status`, `priority`, `assigneeId`, `unassigned`, `tag`, `q`, `overdue`, `dueWithinDays`, `createdFrom`, `createdTo` → 200 and narrows `totalElements` vs unfiltered | AC-1.1 |
| 3 | combined filters → `totalElements` ≤ each individual filter's result | FR-B-01 AND/OR rule |
| 4 | `GET /api/tasks/stats` → 200 with all four headline counters `> 0` | FR-B-08 |
| 5 | `POST /api/tasks` `{"title":""}` → 400 with `errors[0].field == "title"` | AC-1.2 |
| 6 | `POST /api/tasks` `{"title":"ok","id":"…"}` → 422 `unprocessable` | FR-B-19 |
| 7 | `POST /api/tasks` valid → 201, capture `id` + `version == 1` | FR-B-03 |
| 8 | `PATCH` that task with `{"priority":"HIGH"}` → 200, `version == 2`, `updatedAt > createdAt` | FR-B-04 |
| 9 | `PATCH` with `expectedVersion=1` → 409 `version-conflict` | FR-B-14 |
| 10 | `POST /{id}/status` `IN_REVIEW` → `DONE` (legal) → 200; then `DONE → BACKLOG` → 409 `illegal-transition` with allowed targets in `detail` | AC-1.3, INV-1 |
| 11 | move to `CANCELLED`, then `CANCELLED → TODO` without `reopen` → 409; with `reopen:true` → 200 `TODO` | INV-2 |
| 12 | enter `BLOCKED` with no description → 400 on `description` | INV-3 |
| 13 | `POST /bulk-status` with 3 ids where one transition is illegal → 409, `errors[*].field` starts with `ids[`, and a re-GET of all 3 shows **none** changed | AC-1.5 |
| 14 | `POST /bulk-status` all legal → 200, `updated == 3` | FR-B-07 |
| 15 | `GET /api/team-members` → 200, `length == 6`, sorted by `displayName` | FR-B-09 |
| 16 | `DELETE` created task → 204, then GET → 404 | FR-B-05 |
| 17 | `POST /agent` with a trivial user message → streams `RUN_STARTED`, `TEXT_MESSAGE_*`, `RUN_FINISHED` with `outcome.type == "success"` | FR-AI-01 |
| 18 | `POST /agent` with a `state` payload → first event stream contains `STATE_SNAPSHOT` echoing it | FR-S-01 |
| 19 | ask "what is overdue and blocked?" → stream contains `TOOL_CALL_START` with `query_tasks` and a `TOOL_CALL_RESULT` | FR-AI-09, AC-2.3 |
| 20 | ask "create a task titled Verify Script titled X" → stream contains a **client** tool call `prefill_task_form` (or at least no backend write) and `GET /api/tasks?q=…` count is unchanged | AC-2.1, FR-AI-13 |
| 21 | ask "mark <id> as done" → `RUN_FINISHED` `outcome.type == "interrupt"` with one interrupt whose `metadata.tool` is one of the four mutations | FR-AI-11, C6 |
| 22 | resume with `{"approved": false, "reason": "no"}` → the model acknowledges and does not re-propose | FR-AI-16 |
| 23 | `-Dapp.ai.enabled=false` boot → `/api/tasks` still 200 and `/agent` no longer serves an agent | NFR-4 |
| 24 | Repeat 1–16 after a restart: seeded ids unchanged, no duplicate seed rows | FR-B-15 |

Assertions 17–22 need a live model. Make the script take a flag:
`--with-model` (default on when `OPENAI_BASE_URL` is reachable) and `--no-model`
(skips 17–22 with a clear SKIPPED line) so the script is usable without Ollama
(NFR-10).

### 4.2 Documentation

`backend/README.md` must state: prerequisites (Java 21, Ollama + a pulled model),
`./gradlew bootRun`, env vars (`OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_API_KEY`),
the seeded fixture summary, the endpoint table (copy from `00-index.md` §2.2 — do not
let it drift), the CORS/proxy strategy table from BE-06, the AI layer switch, and the
verify script usage.

### 4.3 Coverage audit

Produce a table in `HANDOFF.md`:

| Spec ID | Status | Evidence |
|---|---|---|
| … | implemented / waived / partial | test name, script line, or curl |

No ID may be silently missing. A waiver needs a one-line reason.

## 5. Implementation order

1. Write `scripts/verify-01.sh` incrementally, running each assertion as you add it.
2. Fix whatever fails — in the owning task's files.
3. Write `backend/README.md`.
4. Produce the coverage audit.
5. Final `./gradlew test`.

## 6. Definition of done

- [x] `./gradlew test` green (437).
- [x] `bash scripts/verify-01.sh --no-model` passes (61 passed / 7 skipped) and prints the summary line.
- [x] With a reachable model, assertions 17–22 pass (81 passed / 0 skipped / 0 failed full run).
- [x] Every ID in `00-index.md` §7 has a status and evidence (HANDOFF table).
- [x] No secrets in `README.md`, scripts or logs (dummy `openai-key` default only).
- [x] `HANDOFF.md` entry appended, listing the out-of-scope fixes (none to production code).

## 7. Handoff report

**Files added / changed** …
**Coverage audit** (paste the table) …
**Waivers** (each with a reason) …
**Verification** `./gradlew test` → …; `verify-01.sh` → …
**Known gaps** …
