# Backend implementation plan — spec-01 (Task Management)

Derived from `../../feature-spec/01-task-mgnt-feature-spec.md`.

| | |
|---|---|
| Backend root | `backend/` |
| Spec | `feature-spec/01-task-mgnt-feature-spec.md` |
| Stack | Spring Boot 4.1.1, Java 21, servlet (`spring-boot-starter-webmvc`), Gradle wrapper |
| AI layer | `ag-ui-spring-webmvc-server:4.1.0` + `ag-ui-spring-ai:2.0.0`, **no starters** |

Read this file first. It pins the canonical names, the cross-side wire contracts and
the order of work. **Do not rename anything listed here** — later task docs and the
frontend task docs reference these exact names.

---

## 1. Task index

| Task | Title | Satisfies spec IDs | Depends on | Blocks | Parallel-safe |
|---|---|---|---|---|---|
| [BE-01](BE-01-domain-and-repository.md) | Domain model, enums, repository boundary | §2, INV-5, FR-B-16, FR-B-17 | — | BE-02, BE-03 | — |
| [BE-02](BE-02-error-and-validation.md) | Error envelope + validation infrastructure | FR-B-11, FR-B-12, FR-B-13, FR-B-14 | BE-01 | BE-03, BE-04 | after BE-01, alongside BE-03 prep |
| [BE-03](BE-03-task-service.md) | TaskService: write path, transitions, derived flags | FR-B-03..07, INV-1..3, FR-B-18..20 | BE-01, BE-02 | BE-04, BE-08, BE-09 | no |
| [BE-04](BE-04-rest-api.md) | REST controllers, query parsing, list envelope | FR-B-01, FR-B-02, FR-B-09, FR-B-21 | BE-03 | BE-05, FE side (contract freeze) | no |
| [BE-05](BE-05-stats-and-seed.md) | Dashboard stats + seed data | FR-B-08, FR-B-15 | BE-04 | demo | after BE-04 |
| [BE-06](BE-06-cors-and-config.md) | CORS/proxy strategy + app configuration | FR-B-10, NFR-8, NFR-9 | — | FE dev server | yes — do early, in parallel with BE-01 |
| [BE-07](BE-07-agent-wiring.md) | `Agent` bean, ChatClient, system prompt, shared state | FR-AI-01, FR-AI-02, FR-AI-28, FR-AI-30, FR-AI-31 | BE-03 | BE-08, BE-09 | no |
| [BE-08](BE-08-read-tools.md) | Backend read tools (`query_tasks`, `get_task`, …) | FR-AI-09, FR-AI-10, §6.3 | BE-04, BE-07 | BE-09 | no |
| [BE-09](BE-09-approval-interrupt-tools.md) | Approval-gated mutation proposal (interrupt tool) | FR-AI-11..14, FR-AI-15..18, §6.4, §6.5 | BE-07 | FE-12 | no |
| [BE-10](BE-10-verification.md) | Backend verification, docs, spec coverage check | NFR-5, §7 phase gate | all | — | no |

### Suggested execution order

```
BE-06 ─┐
       ├─> BE-01 ─> BE-02 ─> BE-03 ─> BE-04 ─> BE-05 ─┐
       │                          │                   │
       └──────────────────────────┴─> BE-07 ─> BE-08 ─┴─> BE-09 ─> BE-10
```

BE-06 is independent of the domain work — start it first if two agents are free.

---

## 2. Canonical names (pinned — do not rename)

Base package `io.github.khezyapp.backend`. Java 21, records for immutable data,
Lombok available but **not required**; prefer records/plain classes.

### 2.1 Packages and types

| Package | Type | Kind | Notes |
|---|---|---|---|
| `common` | `PageResponse<T>` | record | `content, page, size, totalElements, totalPages` — the §3.6 envelope |
| `common` | `Clock` bean | — | inject `java.time.Clock` everywhere instead of `Instant.now()`; needed for deterministic overdue/seed tests |
| `domain.task` | `Task` | record | server-owned fields per spec §2.1 |
| `domain.task` | `TaskStatus` | enum | 7 values; `label()`, `isTerminal()`, `allowedTargets(boolean reopen)` |
| `domain.task` | `TaskPriority` | enum | 4 values; `rank()` for sorting (LOW=0 … URGENT=3) |
| `domain.team` | `TeamMember` | record | `id, displayName, email, role` |
| `domain.team` | `TeamMemberRole` | enum | `ENGINEER, DESIGNER, PRODUCT_OWNER, QA` |
| `domain` | `TaskQuery` | record | normalised list query (filters + sort + page/size) |
| `domain` | `TaskSortField` | enum | `CREATED_AT, UPDATED_AT, DUE_DATE, TITLE, PRIORITY, STATUS`, each with its `wireName()` |
| `domain` | `TaskStats` | record | the `FR-B-08` aggregate |
| `domain` | `AssigneeRollup` | record | `memberId, displayName, openCount, overdueCount` |
| `repository` | `TaskRepository` | interface (port) | `save, findById, delete, findAll(TaskQuery), findAllById, count, stats()` |
| `repository` | `TeamMemberRepository` | interface (port) | `findAll(), findById(), existsById(), save(member)` — `save` is the seeder's only way in (added by BE-01, see its HANDOFF entry) |
| `repository` | `InMemoryTaskRepository` | class | `@Repository`, seed-scale only |
| `repository` | `InMemoryTeamMemberRepository` | class | `@Repository`, seed-scale only |
| `service` | `TaskStatusMachine` | final class | **the one canonical transition table** (INV-1, INV-2) |
| `service` | `TaskService` | `@Service` | single write path (FR-B-18) |
| `service` | `TaskValidator` | `@Component` | the §2.1 field rules; also holds the trim/lower-case/dedupe normalisers |
| `service` | `TeamMemberService` | `@Service` | listing + name/email resolution (FR-AI-12) |
| `service` | `TaskService.BulkOutcome` | record | `updated, tasks` — the `FR-B-07` response body |
| `service.command` | `CreateTaskCommand` | record | `title, description, status, priority, assigneeId, reporterId, dueDate, estimateHours, tags` |
| `service.command` | `PatchTaskCommand` | record | same minus `status`; every field nullable, `null` = leave unchanged (OPEN-14) |
| `service.command` | `BulkStatusCommand` | record | `ids, status, expectedVersions` (a `Map<UUID, Long>`) |
| `service` | `TaskPresenter` | `@Component` | `Task` + derived flags → `TaskResponse` |
| `service` | `TeamMemberService` | `@Service` | name→member resolution (used by FE-12 and by tools) |
| `service` | `TaskStatsService` | `@Service` | `FR-B-08` whole-store aggregate (`compute()`) |
| `web` | `TaskController` | `@RestController` | `/api/tasks` |
| `web` | `TeamMemberController` | `@RestController` | `/api/team-members` |
| `web` | `TaskQueryFactory` | `@Component` | query params → `TaskQuery` (OPEN-3) |
| `web.dto` | `TaskResponse` | record | wire shape of a task incl. derived flags |
| `web.dto` | `TaskCreateRequest` | record | `POST /api/tasks` body |
| `web.dto` | `TaskPatchRequest` | record | `PATCH /api/tasks/{id}` body (all nullable = partial) |
| `web.dto` | `StatusChangeRequest` | record | `status, reopen, expectedVersion` |
| `web.dto` | `BulkStatusRequest` | record | `ids, status, expectedVersions (Map<UUID,Integer>)` |
| `web.dto` | `BulkStatusResponse` | record | `updated, tasks` |
| `error` | `FieldError` | record | `field, message` |
| `error` | `ApiErrorResponse` | record | `type, title, status, detail, instance, errors` (FR-B-12) |
| `error` | `ApiException` | abstract class | carries `status, title, detail, errors, marker` |
| `error` | `ValidationApiException`, `NotFoundApiException`, `ConflictApiException`, `UnprocessableApiException` | classes | FR-B-13 status codes |
| `error` | `ApiExceptionHandler` | `@RestControllerAdvice` | maps `ApiException`, Jackson errors, and unhandled throwables |
| `config` | `CorsConfig` | `@Configuration` | BE-06 |
| `config` | `ClockConfig` | `@Configuration` | provides the `Clock` bean |
| `bootstrap` | `SeedDataRunner` | `@Component implements ApplicationRunner` | FR-B-15; deterministic fixture + its own self-check |
| `bootstrap` | `SeedDataProperties` | record | `app.seed.{enabled,members,tasks}`; members/tasks fall back to 6/50 |
| `agent` | `AgentConfig` | `@Configuration` | the `Agent` bean (BE-07) |
| `agent` | `SuccessOutcomeAgent` | `Agent` decorator | the registered bean; fills a missing `RUN_FINISHED.outcome` with `success` (BE-07) |
| `agent` | `AgentPrompts` | final class | `SYSTEM_PROMPT` constant (BE-07) |
| `agent` | `TaskReadTools` | class with `@Tool` methods | BE-08 |
| `agent` | `TaskMutationApprovalTools` | class producing AG-UI `Tool` definitions | BE-09 |

### 2.2 Endpoint surface (frozen after BE-04)

| Method | Path | Request | Response | Statuses |
|---|---|---|---|---|
| GET | `/api/tasks` | query params per FR-B-01 | `PageResponse<TaskResponse>` | 200 |
| GET | `/api/tasks/stats` | — | `TaskStats` | 200 |
| POST | `/api/tasks` | `TaskCreateRequest` | `TaskResponse` | 201, 400 |
| GET | `/api/tasks/{id}` | — | `TaskResponse` | 200, 404 |
| PATCH | `/api/tasks/{id}` | `TaskPatchRequest` + `?expectedVersion=` | `TaskResponse` | 200, 400, 404, 409 |
| DELETE | `/api/tasks/{id}` | `?force=true` optional | — | 204, 404, 409 |
| POST | `/api/tasks/{id}/status` | `StatusChangeRequest` | `TaskResponse` | 200, 400, 404, 409 |
| POST | `/api/tasks/bulk-status` | `BulkStatusRequest` | `BulkStatusResponse` | 200, 400, 404, 409 |
| GET | `/api/team-members` | — | `List<TeamMemberResponse>` | 200 |
| POST | `/agent` | `RunAgentInput` (SSE) | AG-UI event stream | supplied by AG-UI |

Notes that must not drift:
- `expectedVersion` travels as a **query parameter** on `PATCH`/`DELETE` and in the
  **body** for `POST /status` and `POST /bulk-status` (bulk as a map).
- `/api/tasks/stats` is declared **before** `/api/tasks/{id}` in the controller and the
  path is a literal, so Spring never routes `stats` into `{id}`.
- Unknown request fields are rejected with `422` (FR-B-19), not ignored.
- `TaskPatchRequest` **does** carry a `status` component, used only so a status-carrying
  patch is rejected as `400` on field `status` (FR-B-04) instead of a generic 422.
- A **non-UUID path variable** answers `400` (`validation-failed`, field `id`), overriding
  the advice's 422 for that one case — a bad URL is a typo, not an unparseable value.
- `BulkStatusRequest` has **no `reopen`**: bulk reopen is per-task intent, so it goes
  through `POST /api/tasks/{id}/status`.

---

## 3. Cross-side wire contracts (frozen — frontend task docs quote these)

### C1 — Error envelope (FR-B-12)

```json
{
  "type": "https://agui-basic.local/problems/validation-failed",
  "title": "Validation failed",
  "status": 400,
  "detail": "2 fields are invalid",
  "instance": "/api/tasks",
  "errors": [{ "field": "title", "message": "must not be blank" }]
}
```
- `marker` (see BE-02) is surfaced as `type`'s last segment: `version-conflict`,
  `illegal-transition`, `blocked-delete`, `not-found`, `validation-failed`,
  `unprocessable`.
- `errors` is always present; `[]` when the error is not field-related.
- `field` uses JSON-pointer-free dotted path (`tags[0]`) so the frontend can map a
  field error straight onto a form control.

### C2 — List envelope (FR-B-21)

```json
{ "content": [], "page": 0, "size": 20, "totalElements": 0, "totalPages": 0 }
```

### C3 — Task wire shape

```json
{
  "id": "uuid", "title": "…", "description": null,
  "status": "TODO", "priority": "MEDIUM",
  "assigneeId": null, "reporterId": null,
  "dueDate": "2026-01-31", "estimateHours": null, "tags": [],
  "createdAt": "2026-01-05T10:15:30Z", "updatedAt": "2026-01-05T10:15:30Z",
  "version": 1, "isOverdue": false, "isUnassigned": true
}
```
- `dueDate` is `yyyy-MM-dd`; instants are ISO-8601 UTC with `Z`.
- `isOverdue` / `isUnassigned` are always present, never client-settable.
- Enum values are the uppercase wire names from spec §2.1 — no renaming anywhere.

### C4 — Status flow (mirrored, see OPEN-1)

Canonical source: `TaskStatusMachine`. The frontend mirrors it in
`src/domain/statusFlow.ts`. The two must stay identical; the mirror is asserted by a
backend test that prints the table and a frontend unit test that pins the same table.

```
BACKLOG     → TODO, CANCELLED
TODO        → IN_PROGRESS, BLOCKED, CANCELLED, BACKLOG
IN_PROGRESS → IN_REVIEW, BLOCKED, TODO, CANCELLED
IN_REVIEW   → DONE, IN_PROGRESS, CANCELLED, TODO
BLOCKED     → IN_PROGRESS, TODO, CANCELLED
DONE        → IN_REVIEW, CANCELLED          (DONE → BACKLOG forbidden, INV-1)
CANCELLED   → (only via reopen=true → TODO, INV-2)
```

### C5 — Shared state document

Exactly spec §5.1. The backend never invents keys. It reads `context.*` and
`draft.*` as read-only context and may write `assistant.*` only (FR-S-01).

### C6 — Mutation approval (interrupt) contract

The agent never mutates data. It proposes; the human decides; the frontend performs
the mutation through the normal REST endpoints. See OPEN-2.

| Field | Value |
|---|---|
| Backend tool name | `propose_task_mutation` |
| Tool args | `{ "tool": "create_task"\|"update_task_status"\|"update_task_fields"\|"delete_task", "args": { … }, "summary": "human readable", "reason": "why" }` |
| Interrupt `reason` | `input_required` — the shipped `SpringAiAgent` sets this for interrupt
tools and there is no supported way to change it; older drafts of this table said
`tool_call` (that value is what <em>client-side</em> tools produce) |
| Interrupt `message` | `"propose_task_mutation"` — the SDK uses the tool name, not the
`summary` argument. The human-readable line the approval card shows is the
`summary` argument inside `metadata.arguments`, parsed as JSON |
| Interrupt `metadata` | `{ "toolName": "propose_task_mutation", "arguments": "<the tool arguments as a JSON string>" }` — SDK-fixed set; the approval card must parse `arguments` to get `tool`/`args`/`summary`/`reason` |
| Interrupt `responseSchema` | The tool's **input parameter** schema
(`{ "type":"object", "properties": { "tool",…, "args",…, "summary",…, "reason",… }, "required": ["tool","args","summary","reason"] }`). It is **not** the resume-payload schema — the SDK derives it from `ToolParameters` and offers no override. FE-12 must validate the resume payload itself (see the `ResumePayloadValidator` rules below) |
| Resume `status` | `resolved` (with payload) or `cancelled` (user dismissed) |

| Resume payload (approve) | `{ "approved": true, "result": { …ToolResultFromRest… } }` |
| Resume payload (reject) | `{ "approved": false, "reason": "user's words" }` |

`ToolResultFromRest` is the REST response verbatim (`TaskResponse`,
`BulkStatusResponse`, or `{ "deleted": "<id>" }`).

The resume payload the validator requires: `approved` (**required**, boolean); on
`approved: true` exactly one of `result` (object, the REST response verbatim) or `error`
(string, one human sentence, the REST error wording); on `approved: false` a `reason`
string. Anything missing `approved`, or carrying both `result` and `error`, is not a
documented payload. `ResumePayloadValidator` in the backend mirrors these rules for
the tests; FE-12 codes its TypeScript mirror against the same sentences.

---

## 4. Handoff protocol (mandatory)

Every task in this folder ends with a **Handoff report** section. Before starting a
task, an agent MUST read, in this order:

1. `00-index.md` (this file)
2. `HANDOFF.md` — running log of every completed task in this folder
3. Its own task doc
4. The task docs it `Depends on`

After finishing, the agent MUST append an entry to `HANDOFF.md` using exactly this
template, so the next agent inherits the real state of the codebase:

```markdown
## <TASK-ID> — <title> — <status: done | partial | blocked> — <YYYY-MM-DD>

**Files added**
- `path` — one line what it is

**Files changed**
- `path` — what changed

**Decisions taken** (deviations or judgement calls a reader could get wrong)
- …

**Contract changes** (anything that changes C1–C6 or §2.2 — state it loudly)
- …

**Verification performed**
- `./gradlew test` → pass/fail + count
- anything else (curl commands, manual checks)

**Known gaps / follow-ups**
- …
```

Rules:
- Never leave a task with failing `./gradlew test` unless the entry says `partial` or
  `blocked` and explains why.
- If you must change a pinned name or contract, update this index file in the same
  change and note it under **Contract changes**.
- Do not start the next task in the same agent turn. One task per turn.

---

## 5. Global conventions

| Concern | Convention |
|---|---|
| Style | 4-space indent, no wildcard imports, one public class per file, `package` matching directory |
| Comments | No inline explanatory comments in code. Javadoc only on non-obvious public API |
| Time | Never `Instant.now()` / `LocalDate.now()` in code — inject `Clock` |
| Validation | Bean Validation (`jakarta.validation`) on request records + explicit checks in `TaskService` for cross-field rules (INV-1..3) |
| Transactions | Not required for the in-memory adapter; do not add `@Transactional` yet |
| Errors | Services throw `ApiException` subclasses only. Controllers never build error bodies |
| Tests | JUnit 5, one test class per production class, `@SpringBootTest` only where wiring is the thing under test. Existing `BackendApplicationTests` must stay green |
| Build | `./gradlew test` from `backend/`. There is no lint/format task — do not invent one |
| Secrets | Never log or echo `OPENAI_API_KEY` (NFR-3) |

---

## 6. Open decisions and spec deviations

These are deliberate, documented interpretations. A reviewer may overrule them; if so,
update this table and the affected task doc.

| ID | Topic | Decision taken here | Why |
|---|---|---|---|
| OPEN-1 | Legal-next-status knowledge | Mirror the transition table in the frontend (`src/domain/statusFlow.ts`) rather than adding a REST endpoint | Spec §3.1 fixes the endpoint list; adding `GET /api/tasks/status-flow` would contradict it. Cost: one mirrored table, asserted by a test on each side |
| OPEN-2 | Where an approved mutation executes | The **frontend** performs the approved mutation through the existing REST endpoints and returns the result in the resume payload; the backend exposes **no** write tools | `SpringAiAgent` executes backend tools inside its own loop and offers no reliable per-run context, so "this tool only runs if approved" cannot be enforced server-side. Enforcing approval in the protocol (mandatory `propose_task_mutation` interrupt) is the enforceable form of FR-AI-11. Spec §6.5 "executes server-side" is satisfied in substance: the mutation runs through the same server-side service + validation as the UI (FR-B-18), never in the model loop. If the reviewer wants strict in-loop execution, that requires a hand-written `Agent` and is out of demo scope |
| OPEN-3 | FR-B-17 with an in-memory store | `TaskRepository.findAll(TaskQuery)` receives a fully normalised `TaskQuery`; controllers never filter. The in-memory adapter may filter in memory (it *is* the store); a JDBC adapter must push predicates down | Otherwise the spec's persistence-layer requirement is unsatisfiable without picking a real database in a demo |
| OPEN-4 | FR-B-05 `409` on delete "if an AI pending action holds a stale reference" | The backend does **not** consult AI state on delete. The frontend suppresses a delete it knows is pending, and `?force=true` exists for the explicit case | The backend is stateless w.r.t. the AI (FR-AI-04), so this check cannot live there without a stateful side-channel |
| OPEN-5 | `dueWithinDays` semantics | Inclusive of today; `dueDate != null && dueDate <= today + n` | Spec does not define the boundary; picking one keeps UI and tool consistent |
| OPEN-6 | `dueThisWeek` in stats | Overdue-inclusive: `dueDate <= endOfCurrentWeek && status not terminal` | Matches the dashboard card label "due this week" and avoids a stats card that is empty in most demo weeks |
| OPEN-13 | Spec defect (cross-side) | Spec §4.3 `FR-F-12` references a non-existent `FR-F-30`; interpreted as `FR-S-03` | Logged on the frontend side (`../spec-01-fe/00-index.md` OPEN-13); the spec should be amended to fix the cross-reference |
| OPEN-14 | `PATCH` cannot tell an absent field from an explicit `null` | `PatchTaskCommand` is a plain record: **`null` means "leave unchanged"**. Clearing `description` = `""`, clearing `tags` = `[]`. `assigneeId`, `reporterId`, `dueDate` and `estimateHours` therefore **cannot be cleared** through `PATCH /api/tasks/{id}`; the unassign action needs a different route (e.g. a dedicated "clear" flag or a `JsonNullable`-typed field) before FE can offer it | A Java record has no absent-vs-null distinction, and spec FR-B-04 asks for "explicit `null` clears". Rather than leak a Jackson type (`JsonNullable`) into the service layer, BE-03 made the limitation explicit. **BE-04 must not invent a silent meaning for `null`; if FE needs to unassign, escalate and pick one mechanism for both sides** |

---

## 7. Requirement coverage map

| Spec ID | Task |
|---|---|
| INV-1, INV-2 | BE-01 (`TaskStatus.allowedTargets`), BE-03 (`TaskStatusMachine`) |
| INV-3 | BE-03 |
| INV-4 | BE-03 (delete), BE-09 (agent must re-resolve by id) |
| INV-5 | BE-02, BE-03 |
| FR-B-01, FR-B-02 | BE-04 |
| FR-B-03, FR-B-04, FR-B-05, FR-B-06, FR-B-07 | BE-03, BE-04 |
| FR-B-08 | BE-05 |
| FR-B-09 | BE-01, BE-04 |
| FR-B-10 | BE-06 |
| FR-B-11, FR-B-12, FR-B-13, FR-B-14 | BE-02 |
| FR-B-15 | BE-05 |
| FR-B-16, FR-B-17 | BE-01 |
| FR-B-18, FR-B-19, FR-B-20 | BE-03 (single write path), BE-04 (unknown-field rejection) |
| FR-B-21 | BE-04 |
| FR-AI-01, FR-AI-02 | BE-07 |
| FR-AI-09, FR-AI-10 | BE-08 |
| FR-AI-11, FR-AI-12, FR-AI-13, FR-AI-14 | BE-09 (+ BE-07 prompt) |
| FR-AI-15, FR-AI-16, FR-AI-17, FR-AI-18 | BE-09 (backend half) + FE-12 (UI half) |
| FR-S-01 | BE-07 |
| FR-AI-28, FR-AI-30, FR-AI-31 | BE-07 |
| NFR-1, NFR-2, NFR-3, NFR-8 | BE-03, BE-06, BE-10 |
| NFR-5 | BE-10 |
