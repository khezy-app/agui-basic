# Backend handoff log — spec-01

Running log for `spec-01-be`. Every completed task appends one entry here using the
template in `00-index.md` §4. An agent starting any task MUST read this file first —
it is the fastest way to learn what actually exists in the codebase, what was decided
and what is broken.

Entry order should match `00-index.md` §1. If you fix something owned by an earlier
task, say so explicitly under **Files changed** and note it in the later task's entry.

---

## Template

```markdown
## <TASK-ID> — <title> — <done | partial | blocked> — <YYYY-MM-DD>

**Files added**
- `path` — one line what it is

**Files changed**
- `path` — what changed

**Decisions taken**
- Judgement calls a later reader could otherwise get wrong.

**Contract changes**
- Anything affecting C1–C6 or §2.2. State loudly; update `00-index.md` too.

**Verification performed**
- `./gradlew test` → pass/fail + test count
- other checks (curl, script)

**Known gaps / follow-ups**
- …
```

---

## Entries

<!-- Append new entries below this line, newest at the bottom. -->

## BE-06 — CORS/proxy strategy + app configuration — done — 2026-10-07

**Files added**
- `backend/src/main/java/io/github/khezyapp/backend/config/CorsConfig.java` — `@Configuration`
  exposing a `WebMvcConfigurer` bean with two CORS mappings; origins from
  `app.cors.allowed-origins`, no credentials.
- `backend/src/test/java/io/github/khezyapp/backend/config/CorsConfigTest.java` — 6 tests
  (preflight allow/deny, origin-less request unaffected, `/agent` mapping assertions).

**Files changed**
- `backend/src/main/resources/application.yaml` — added `server.port: 8080`,
  `app.cors.allowed-origins`, `app.seed.enabled`, `app.ai.enabled`, `logging.level`
  (backend package DEBUG; `org.springframework.ai` and `com.agui` at INFO per NFR-3), and
  `spring.mvc.async.request-timeout: 300000` so long SSE agent runs are not cut off.

**Decisions taken**
- Strategy = **Vite dev proxy (primary) + explicit backend CORS (fallback)**. Rationale:
  the proxy keeps SSE/cookies simple because the browser only ever talks to one origin,
  while the CORS mapping means `curl`, a browser console, or a static HTML page can hit
  the API without any frontend work — so FE does not block on FE-08.
- No `allowCredentials(true)` anywhere. The app has no auth/cookies (spec non-goal), and
  credentials + wildcard origin is invalid anyway.
- Used `WebMvcConfigurer`, **not** a `CorsFilter`. The MVC stack serves `/agent` through
  `SseEmitter`, so `addCorsMappings` is sufficient.
- Config values are env-overridable (`APP_CORS_ALLOWED_ORIGINS`, `APP_SEED_ENABLED`,
  `APP_AI_ENABLED`) with localhost defaults; the OpenAI key remains
  `${OPENAI_API_KEY:openai-key}` — no secret in the file (NFR-8).
- Test uses `@AutoConfigureMockMvc` from `org.springframework.boot.webmvc.test.autoconfigure`
  — **Boot 4 moved it out of `org.springframework.boot.test.autoconfigure.web.servlet`**,
  which no longer exists. A later task writing MockMvc tests will hit this too.
- `/agent` CORS is asserted against the registry (via a `CorsRegistry` subclass, since
  `getCorsConfigurations()` is protected) rather than a live preflight, because BE-07 has
  not added the `Agent` bean yet.

**Contract changes**
- None. `/api/**` and `POST /agent` paths are unchanged; this task only adds config.
- New properties that later tasks read: `app.cors.allowed-origins`, `app.seed.enabled`
  (BE-05), `app.ai.enabled` (BE-07 — register the `Agent` bean under
  `@ConditionalOnProperty(name = "app.ai.enabled", havingValue = "true", matchIfMissing = true)`).

**Verification performed**
- `./gradlew test` → pass, 7 tests (6 new + `contextLoads`), no failures.
- `./gradlew bootRun` → `Tomcat started on port 8080`.
- `curl -i -X OPTIONS localhost:8080/api/tasks -H 'Origin: http://localhost:5173' -H
  'Access-Control-Request-Method: GET'` → `200` with
  `Access-Control-Allow-Origin: http://localhost:5173`,
  `Access-Control-Allow-Methods: GET,POST,PATCH,DELETE,OPTIONS`, `Max-Age: 3600`.
- Same request with `Origin: https://evil.example` → `403`, no allow-origin header.
- `curl -i -X OPTIONS localhost:8080/agent -H 'Origin: http://localhost:5173' -H
  'Access-Control-Request-Method: POST'` → `200`,
  `Access-Control-Allow-Methods: POST,OPTIONS`, `Access-Control-Expose-Headers: Content-Type`.
- CLI `GET /api/tasks` → `404` with **no** CORS headers. Expected: BE-04 has not created
  the controller yet, and origin-less requests are untouched by CORS either way.

**Known gaps / follow-ups**
- BE-04 should re-run `GET /api/tasks` from the CLI to confirm the non-CORS path once the
  controller exists.
- BE-07 should add a live `/agent` preflight/POST check now that the `Agent` bean exists;
  the registry-level assertions here are the BE-06 stand-in.
- Nothing is configured for production. A real deployment needs: exact origins (no
  `localhost`) via `APP_CORS_ALLOWED_ORIGINS`, TLS termination, and a reviewed
  `request-timeout` — and, if the frontend is served from a different origin in prod,
  either the same proxy approach or a real origin list.

**Handoff to FE-08 (verbatim, quotable)**
- Proxy exactly these two paths from `http://localhost:5173` to `http://localhost:8080`:
  - `/api`  → covers `/api/tasks`, `/api/tasks/**`, `/api/team-members`, `/api/tasks/stats`
  - `/agent` → the AG-UI SSE endpoint, `POST` only
- The backend also allows the dev origin directly via CORS, so a no-proxy fetch works too.
  Use the proxy as the default anyway: it keeps the browser on one origin and avoids the
  SSE-over-CORS edge cases.
- SSE caveats if you do call `/agent` cross-origin directly: the response is
  `text/event-stream`; only `Content-Type` is exposed via
  `Access-Control-Expose-Headers`. Do not add `credentials: 'include'` — the backend sends
  no CORS credentials and the server has `allowCredentials` disabled.
- Do not proxy `/agent` with a buffering/ws-only Vite setting; SSE needs streaming
  (`changeOrigin` alone is fine, avoid any compression/buffering middleware).
- Backend reads config from env: `APP_CORS_ALLOWED_ORIGINS`, `APP_SEED_ENABLED`,
  `APP_AI_ENABLED`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_API_KEY`. Defaults are the
  documented localhost/Ollama values.

## BE-01 — Domain model, enums and repository boundary — done — 2026-10-07

**Files added** — main
- `common/PageResponse.java` — the §3.6 envelope; `PageResponse.of(...)` derives `totalPages`
  (0 elements → 0 pages, not 1).
- `common/ClockConfig.java` — the single `Clock.systemUTC()` bean everything injects.
- `domain/task/TaskStatus.java` — 7 values, `label()`, `isTerminal()`, `allowedTargets(reopen)`.
- `domain/task/TaskPriority.java` — 4 values, `label()`, `rank()` (LOW=0 … URGENT=3).
- `domain/task/Task.java` — the 13-field record; normalises `tags` only.
- `domain/team/TeamMemberRole.java`, `domain/team/TeamMember.java` — seeded reference data.
- `domain/TaskSortField.java` — 6 sortable columns, each with its `wireName()`
  (`createdAt`, `updatedAt`, `dueDate`, `title`, `priority`, `status`).
- `domain/TaskQuery.java` — the normalised query + nested `SortSpec` + a `Builder`.
- `domain/AssigneeRollup.java`, `domain/TaskStats.java` — the FR-B-08 aggregate.
- `repository/TaskRepository.java`, `repository/TeamMemberRepository.java` — the ports.
- `repository/InMemoryTaskRepository.java`, `repository/InMemoryTeamMemberRepository.java` —
  the `@Repository` adapters.

**Files added** — test
- `testsupport/MutableClock.java`, `testsupport/TaskFixtures.java` — no mocking framework.
- `TaskStatusTest`, `TaskPriorityTest`, `TaskTest`, `TaskQueryTest`, `TaskStatsTest`,
  `PageResponseTest`, `InMemoryTaskRepositoryTest`, `InMemoryTeamMemberRepositoryTest`.

**Files changed** — none. `build.gradle` is untouched (no new dependency).

**Decisions taken**
- **`TeamMemberRepository.save` added** beyond the BE-01 §4.5 listing. The store starts empty
  and BE-05's `SeedDataRunner` calls `members::save`; without it the seed data has no way in.
  It is the port's *only* mutator, so no CRUD surface appears by accident. **BE-05: use this
  `save`, do not add another.**
- **`save` honours caller-supplied `createdAt`/`updatedAt` on insert.** BE-05 must spread
  `createdAt` over 45 days, so a caller-supplied timestamp wins on insert and the clock only
  fills a null. Overwrites always restamp `updatedAt` from the clock and keep `createdAt`
  from the stored row.
- **`version` is bumped by the repository, not the service.** `save` on an existing id sets
  `version = existing + 1` unconditionally. BE-03 compares the caller's expected version
  against the row it read, then calls `save` — the bump is the locking primitive. It must
  compare *before* saving, since `save` gives no way to refuse a stale write.
- **`TaskQuery` clamps rather than throws.** `page < 0 → 0`, `size` into `[1, 100]`. Turning
  bad input into an HTTP status is BE-02's job; a record that throws surprises the adapter.
- **Nulls sort last in *both* directions.** First-null-in-a-descending-sort pages every
  due-date-less task into every page. `findAll()` (unpaged) uses the same comparator as the
  default query, so "everything" and "the unfiltered first page" agree.
- **One definition of overdue:** `InMemoryTaskRepository.isOverdue(Task, LocalDate)` is public
  static. **BE-04's `TaskPresenter` and BE-05's `TaskStatsService` should call it** rather
  than re-deriving (OPEN-5: `dueDate <= today` *and* non-terminal).
- `TaskQuery.text`/`tag` are lower-cased and trimmed in the compact constructor, blank → null.
  The adapter therefore compares against a lower-cased needle only; it does not re-case.
- `TaskStats`'s compact constructor guarantees all 7 `byStatus` and all 4 `byPriority` keys
  exist and zero-fill, so the dashboard never guards against a missing bucket.

**Contract changes** — none. All names and signatures match `00-index.md` §2.1 except the
`TeamMemberRepository.save` addition above (an addition to the port, not a rename).

**Verification performed**
- `./gradlew clean test` → **BUILD SUCCESSFUL, 76 tests, 0 failed** (BE-06's 6 + 1
  `contextLoads` carried over from 7, plus 69 new).
- `./gradlew bootRun` → `Started BackendApplication`, both repository beans wire against the
  `Clock` bean with no ambiguity.
- `./gradlew test --info` prints the C4 table **verbatim** from
  `TaskStatusTest.printTableForTheFrontendMirror`, which also asserts every row against
  `allowedTargets(false)`.

**Known gaps / follow-ups**
- No REST layer exists yet, so nothing is reachable over HTTP — expected, this is BE-04.
- No seed data. `InMemoryTeamMemberRepository` starts empty and
  `InMemoryTeamMemberRepositoryTest` asserts that, so **`GET /api/team-members` will return
  `[]` until BE-05 seeds.**
- Nothing here validates field rules (lengths, email shape, estimate decimals). BE-03 owns it;
  `Task` deliberately does not throw.
- The in-memory adapter filters in memory. That satisfies FR-B-17 for this adapter (it *is*
  the store) per OPEN-3; a JDBC adapter must push the same predicates down.
- `TaskFixtures.createdAt(null)` is the way to let the clock stamp in a test; the default is
  `Instant.EPOCH`, which makes ordering assertions deterministic.

## BE-02 — Error envelope and validation infrastructure — done — 2026-10-07

**Files added** — main
- `error/FieldError.java` — `record FieldError(String field, String message)`.
- `error/ApiErrorResponse.java` — the C1 envelope, components in frozen order
  (`type, title, status, detail, instance, errors`); `PROBLEM_BASE =
  "https://agui-basic.local/problems/"`; the compact constructor null-guards and copies
  `errors`, so it is never null and never mutable.
- `error/ApiException.java` — abstract base carrying `marker, status, title, detail, errors`;
  the message is `detail`.
- `error/ValidationApiException.java` (400 `validation-failed`),
  `error/NotFoundApiException.java` (404 `not-found`),
  `error/ConflictApiException.java` (409, caller-supplied marker + static factories
  `illegalTransition`, `versionConflict(UUID, long, long)`, `blockedDelete`),
  `error/UnprocessableApiException.java` (422 `unprocessable`).
- `error/ApiExceptionHandler.java` — the single `@RestControllerAdvice`; see the mapping table below.
- `config/StrictJsonConfig.java` — `JsonMapperBuilderCustomizer` bean enabling
  `DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES` (FR-B-19).

**Files added** — test
- `test/error/ApiExceptionHandlerTest.java` — 15 tests, plain unit test, advice instantiated
  directly with `MockHttpServletRequest`; no Spring context.
- `test/error/StrictJsonTest.java` — `@WebMvcTest` slice with a throwaway
  `ProbeController` + `ProbeRequest(String name, int size)`; unknown property → 422 envelope.

**Files changed**
- `build.gradle` — added `implementation 'org.springframework.boot:spring-boot-starter-validation'`.
  **It was NOT on the classpath** (verified via `dependencies --configuration compileClasspath`:
  no `hibernate-validator`, no `jakarta.validation`). The BE-02 doc suggested it might come free
  with the web starter; in Boot 4.1.1 it does not.

**Decisions taken**
- **Jackson 3, not Jackson 2.** Boot 4.1.1 resolves `tools.jackson.core:jackson-{core,databind}:3.1.5`
  and `spring-boot-starter-jackson:4.1.1`; the `com.fasterxml.jackson.*` 2.21.5 jars on the tree are
  transitive leftovers (AG-UI / Spring AI / victools). So the strict-config hook is
  `org.springframework.boot.jackson.autoconfigure.JsonMapperBuilderCustomizer` with
  `tools.jackson.databind.DeserializationFeature` — there is no `Jackson2ObjectMapperBuilderCustomizer`
  in Boot 4. Test code must import `tools.jackson.databind.ObjectMapper`.
- The customizer is a plain bean with **no `@Order`**, so it runs after Boot's
  `StandardJsonMapperBuilderCustomizer` (`Ordered.getOrder() == 0`) and its `enable(...)` wins.
  Verified by the passing `StrictJsonTest`.
- **`@RestControllerAdvice` is deliberately unscoped.** BE-02 §4.3 suggested `@RestController` or
  base-package scoping; with `basePackages = "io.github.khezyapp.backend"` Spring still routes
  framework-level failures (e.g. `NoResourceFoundException` from the static-resource handler) to the
  default Boot error body — which leaked a full stack trace in a `trace` field on a live
  `PUT /api/tasks`. Unscoped + an explicit `NoResourceFoundException` handler closes that hole.
  Consequence: the envelope also applies to non-application handlers (404 on `/`, static resources).
  That is the intended "every error leaving the API is C1" reading.
- Added `NoResourceFoundException` → `404 not-found`, `detail = "no endpoint at <uri>"`. Not in the
  §4.3 table, but without it the 500-path guarantee had a hole. The table's other eight rows are
  implemented exactly as specified.
- `MissingServletRequestParameterException` maps to **400 `validation-failed`** (not 422) so a
  missing `expectedVersion` and an invalid one look the same to the frontend; the doc did not pin the
  marker for this row.
- Bean Validation field errors are **sorted by field name** (both `MethodArgumentNotValidException`
  and `HandlerMethodValidationException`), so the envelope is deterministic.
  `HandlerMethodValidationException` uses the *method parameter name* as `field`, with
  `name[i]` when there is a container index. Service-thrown `ValidationApiException` keeps the
  order the service supplied — sorting is only applied to framework-produced errors.
- `ValidationApiException`'s auto-generated `detail` is `"N fields are invalid"` (singular when N=1).
  Services should pass their own `detail` when they have something more specific to say.
- `blockedDelete` factory added next to the two the doc named, because OPEN-4 makes
  `?force=true` / blocked delete a real 409 case and BE-03 will need it.
- `MethodArgumentTypeMismatchException` detail is `"parameter 'X' is not a valid value"`.
- The 500 path logs the throwable (with its message and stack) at ERROR — never the request body.

**Contract changes**
- **C1 confirmed as implemented, no field added, renamed or reordered.** `type` is
  `https://agui-basic.local/problems/<marker>`; markers now emitted by this task:
  `validation-failed`, `not-found`, `unprocessable`, `method-not-allowed`, `internal-error`,
  plus `version-conflict` / `illegal-transition` / `blocked-delete` from the conflict factories.
- `00-index.md` §2.1 is unchanged and already correct except for the two additions this task made to
  the pinned `error` package: `UnprocessableApiException`'s extra `List<FieldError>` constructor and
  `ConflictApiException.blockedDelete`. Both are additions, not renames, so no index edit was needed.
- **For BE-03/BE-04:** throw `ApiException` subclasses from `TaskService`; never build a body.
  Use `InMemoryTaskRepository.isOverdue(...)` as BE-01 instructed. `expectedVersion` mismatches →
  `ConflictApiException.versionConflict(id, expected, actual)` so FR-F-11 can branch on the marker.

**Verification performed**
- `./gradlew clean test` → **BUILD SUCCESSFUL, 91 tests, 0 failures** (BE-01/BE-06's 76 carried
  over, 15 new).
- `./gradlew bootRun` + live curl:
  - `PUT /api/tasks` → `404` `{"type":"…/not-found","title":"Not found","status":404,
    "detail":"no endpoint at /api/tasks","instance":"/api/tasks","errors":[]}` — **no stack trace**,
    whereas before this change the same request returned Boot's default body with a `trace` field.
  - `GET /nope` and `GET /` → same envelope shape, `instance` echoing the path.
- `StrictJsonTest.unknownFieldIsRejectedAsUnprocessable` covers the FR-B-19 path end-to-end
  (422, `type` ends `/unprocessable`, `detail` does not mention the offending field name).

**Known gaps / follow-ups**
- **No controller exists yet (BE-04), so the validation paths are only proven by the slice test and
  the unit test.** Nothing in the live app currently produces a 400 or 422. BE-04 should re-run the
  unknown-field curl once `POST /api/tasks` exists.
- `ConstraintViolationException` (from `@Validated` on a class + method-level constraint) is **not**
  handled explicitly; Spring 6.1+ routes those through `HandlerMethodValidationException`, which is
  handled. If BE-04 sees a live `ConstraintViolationException` reaching the 500 path, add a row.
- `MissingRequestHeaderException` and `NoHandlerFoundException` (with `throw-exception-if-no-handler-found`
  off, which is the default) also fall through to the generic handler / `NoResourceFoundException`
  respectively. Revisit if BE-04 adds header-validated endpoints.
- Bean Validation is on the classpath now but **no annotated request record exists yet** — the
  annotations are BE-04's job, the field rules BE-03's.
- `task` name collision in tests: `org.springframework.validation.FieldError` shadows this task's
  `error.FieldError`, so the Spring one is written fully qualified in `ApiExceptionHandlerTest`.
  A later task adding tests that mix both should do the same.

## BE-03 — TaskService: the single write path — done — 2026-10-07

**Files added** — main
- `service/TaskStatusMachine.java` — the one transition authority (INV-1/2/3, FR-B-06,
  OPEN-1). Pure static; delegates the table to `TaskStatus.allowedTargets(reopen)`.
- `service/TaskValidator.java` — the §2.1 field rules (FR-B-11, INV-5) plus the
  normalisation statics (`normalizeTitle/Description/Tags`).
- `service/TaskService.java` — `create`, `patch`, `delete`, `changeStatus`,
  `bulkChangeStatus`, `require`, `find`, `findAll`, `count`, and the nested
  `BulkOutcome(int updated, List<Task> tasks)` record.
- `service/TeamMemberService.java` — `findAll`, `require`, `findByName`, `findByEmail`.
- `service/command/CreateTaskCommand.java`, `service/command/PatchTaskCommand.java`,
  `service/command/BulkStatusCommand.java` — command records in their own package
  (BE-03 §4.3 offered nested vs `service/command/*`; **chose `service/command/`**).

**Files added** — test
- `service/TaskStatusMachineTest` — full 7×7 legality matrix × both `reopen` values,
  C4 rows, rules 1–5 individually, and the exact 409 wording.
- `service/TaskValidatorTest` — one case per §4.2 row, multi-error collection with a
  fixed order, normalisation, `status` rejection.
- `service/TaskServiceTest` — 44 tests over create/idempotency/patch/version/delete/
  changeStatus/bulk, all with a fixed `MutableClock`.
- `service/TeamMemberServiceTest` — 10 tests including exact-before-substring resolution.

**Files changed**
- `00-index.md` — added the `service.command` records + `TaskValidator` /
  `TeamMemberService` / `BulkOutcome` rows to §2.1 (additions, no renames), and added
  **OPEN-14** for the `PATCH` null-vs-absent decision (mandated by BE-03 §7).

**Decisions taken**
- **`TaskService` does not take a `TeamMemberRepository`** even though BE-03 §4.3's sketch
  shows one. Member existence is `TaskValidator`'s only use for it, so injecting it into the
  service would have been an unused field. **BE-04/BE-08: the constructor is
  `TaskService(TaskRepository, TaskValidator, Clock, Duration)`;** use the 3-arg one in tests.
- **Idempotency window is a constructor `@Value("${app.create-idempotency-window:5s}") Duration`.**
  Configurable in `application.yaml`/env as `APP_CREATE_IDEMPOTENCY_WINDOW`. `Duration.ZERO`
  disables FR-B-20 entirely.
- **Idempotency scans `tasks.findAll()`** (whole store, in memory) and filters on
  `createdAt >= now - window`. O(n) per create, acceptable at demo scale; a JDBC adapter would
  push this into a `SELECT … WHERE title = ? AND created_at >= ?` query.
- **A patch that changes nothing is not written** — no `version` bump, no `updatedAt` touch.
  Otherwise an idempotent retry from the UI would look like a concurrent edit.
- **`estimateHours` range is `[0, 999]` inclusive and literal**: `999.9` is **rejected**.
  `stripTrailingZeros()` is applied before the scale check, so `1.50` passes (one decimal
  place mathematically) while `1.234` fails.
- **Bulk has no `reopen` flag.** Reopening is per-task intent, so it belongs on the
  single-status endpoint; a `CANCELLED` id in a bulk call therefore fails with
  `illegal-transition`. Bulk's conflict marker is `illegal-transition` (not a new marker),
  so the frontend's existing branch on that marker keeps working.
- **`BulkStatusCommand.expectedVersions` is `Map<UUID, Long>`.** `00-index.md` §2.1 names the
  wire field `expectedVersions (Map<UUID,Integer>)`; `Task.version` is a `long`, so BE-04 should
  bind JSON integers into `Long` rather than widen `Task`.
- **Rule 1 (target == current) short-circuits before every other rule**, including the
  CANCELLED-needs-reopen rule, so re-submitting `CANCELLED → CANCELLED` is a 200 no-op rather
  than a 409. That follows BE-03 §4.3's evaluation order literally.
- **Allowed targets in the 409 message are listed in `TaskStatus` declaration order**, giving
  ``IN_REVIEW → BACKLOG is not allowed. Allowed targets from IN_REVIEW: TODO, IN_PROGRESS,
  DONE, CANCELLED.`` BE-03 §4.3's illustrative example listed them ``IN_PROGRESS, DONE, TODO,
  CANCELLED``; declaration order is deterministic and derives from the single table, so it won.
  The frontend renders this string verbatim (FR-F-08) — no frontend parsing of order.
- **Server-owned-field rejection (FR-B-19) is split**: `id`/`version`/`createdAt`/`updatedAt`/
  `isOverdue`/`isUnassigned` → **422 `unprocessable`** naming the field; `status` on a patch →
  **400 `validation-failed`** on field `status` (FR-B-04 wins for that one field). Both are
  driven by a `Map<String,Object> rawExtras` overload of `create`/`patch`; the typed overloads
  pass `Map.of()`. **BE-04: pass the request body's field names in, or rely on BE-02's strict
  Jackson for the REST path and use the raw overload for the AI/tool path (BE-08/BE-09).**

**Contract changes**
- **C1 unchanged.** New markers reachable through the service: `illegal-transition`,
  `version-conflict`, `blocked-delete` (all from BE-02's `ConflictApiException` factories).
  Bulk failures carry `errors[].field = ids[<index>]`.
- **§2.2 note:** `DELETE ?force=true` is accepted and **changes nothing** — OPEN-4 already
  decided the backend never consults AI state. No `blocked-delete` 409 is emitted from the
  backend; `ConflictApiException.blockedDelete` exists for BE-09's approval flow.
- **§6 gained OPEN-14** (`PATCH` cannot clear `assigneeId`/`reporterId`/`dueDate`/
  `estimateHours`). This is the one place where the implementation is narrower than spec
  FR-B-04. **FE must not ship an "unassign" affordance on `PATCH` until this is resolved.**

**Verification performed**
- `./gradlew clean test` → **BUILD SUCCESSFUL, 250 tests, 0 failures** (91 carried over,
  159 new: 74 machine + 32 validator + 44 service + 10 team member — the machine count is
  inflated by the 49-pair matrix × 2 `reopen` values).
- `./gradlew bootRun` → `Started BackendApplication`; `TaskService` wires with the
  `@Value`-injected `Duration` and `TaskValidator` resolves its `TeamMemberRepository`.
- `grep -rn "now()\|LocalDate.now\|Instant.now" service/` → no hits (BE-03 §7 DoD).
- Rule-ordering proof: `rule1NoOpWinsEvenForACancelledTaskThatWouldOtherwiseNeedReopen`.

**Known gaps / follow-ups**
- **No HTTP surface yet** (BE-04). Nothing above is reachable over HTTP, and the C1 markers are
  only proven by unit tests.
- **`TaskPresenter` and the derived flags (`isOverdue`/`isUnassigned`) are BE-04's.** BE-03's
  objective mentions derived-flag computation, but the presenter takes a `TaskResponse` DTO that
  does not exist yet. Use `InMemoryTaskRepository.isOverdue(task, today)` when it is written.
- **`stats()` is absent** (BE-05), as BE-03 §3.2 allows.
- **Idempotency is `create`-only** (FR-B-20 says "where practical"). `patch`/`changeStatus` are
  naturally idempotent; bulk skips ids already at the target.
- **No concurrency test.** The in-memory store is a `ConcurrentHashMap` of immutable records,
  but `require`-then-`save` is not atomic; two simultaneous writers can both pass the
  `expectedVersion` check. A real store needs `UPDATE … WHERE version = ?`. Demo-only.
- **`TaskService.create` does not check `dueDate` against today** — spec §2.1 says "no
  restriction relative to today", so past due dates are legal on purpose.

## BE-04 — REST controllers, query parsing and the list envelope — done — 2026-10-07

**Files added** — main
- `web/dto/TaskResponse.java` — C3, field-for-field and in order.
- `web/dto/TaskCreateRequest.java`, `TaskPatchRequest.java`, `StatusChangeRequest.java`,
  `BulkStatusRequest.java`, `BulkStatusResponse.java`, `TeamMemberResponse.java`.
- `web/TaskQueryFactory.java` — every `FR-B-01` parameter → a normalised `TaskQuery`.
- `web/TaskController.java` — all eight `/api/tasks` routes.
- `web/TeamMemberController.java` — `GET /api/team-members`.
- `service/TaskPresenter.java` — `Task` → `TaskResponse` with the two derived flags.
- `service/TaskStatsService.java` — **see the scope note below.**

**Files added** — test
- `web/TaskQueryFactoryTest.java` — 22 tests (defaults, every parse rule, every rejection).
- `web/TaskControllerTest.java` — 34 tests through the **real** service and real
  in-memory repositories, not a mock: "one illegal bulk target writes nothing" is only
  provable with a store to inspect.

**Files changed**
- `service/TaskService.java` — added `delete(UUID id, Long expectedVersion, boolean force)`
  (the old 2-arg form delegates with `null`). §2.2 carries `expectedVersion` as a query
  parameter on `DELETE`, so the check has to happen before the row disappears.
- `config/CorsConfigTest.java` — **BE-06's stub controller removed.** It mapped
  `GET /api/tasks`, which now collides with the real `TaskController`
  (`Ambiguous mapping`). Its three MockMvc assertions now exercise the production route,
  which resolves BE-06's own follow-up "re-run `GET /api/tasks` once the controller exists".
- `error/StrictJsonTest.java` — pinned `@WebMvcTest(controllers = ProbeController.class)`;
  an unscoped slice started scanning the real controllers and failed on missing beans.
- `00-index.md` — §2.1 gained `TaskStatsService` and `TaskQueryFactory` rows; §2.2 gained
  three "must not drift" notes (the `status` component on `TaskPatchRequest`, the malformed-id
  400, and bulk having no `reopen`).

**Decisions taken**
- **`service/TaskStatsService` was implemented here, not deferred to BE-05.** BE-04 §3.2
  offered both options. `/api/tasks/stats` had to become a literal route regardless, and the
  only honest way to reserve it was to actually implement it — a stub returning zeroes would
  render a silently empty dashboard with no error. The aggregation follows BE-05 §4.1 exactly
  (whole store, all 7 status / 4 priority buckets zero-filled, one rollup per member
  **including members with no tasks**, OPEN-6 overdue-inclusive `dueThisWeek`, ISO week ending
  Sunday). **BE-05 should review it against its §4.1 table and add its own unit tests rather
  than rewrite it; its remaining scope is the seeder.**
- **`TaskResponse` has no assignee/reporter names.** BE-04 §4.1 sketched a
  `toResponse(task, members)` overload, but C3 is frozen and has no name fields — the
  frontend resolves names from `GET /api/team-members`. No overload was added.
- **`isOverdue` uses `<= today`, not `< today`.** `TaskPresenter` delegates to
  `InMemoryTaskRepository.isOverdue` (BE-01's single definition, OPEN-5), so the badge, the
  `overdue=true` filter and the dashboard card cannot drift. Spec §2.1's bare wording says
  "earlier than today"; BE-04 §4.1 recommended aligning and updating OPEN-5, which is what
  this does.
- **`TaskPatchRequest` carries a `status` component.** BE-04 §4.3 allowed a 422 from strict
  Jackson; declaring the field instead lets the controller answer
  **`400` on field `status`** — the wording FR-B-04 and BE-03 actually ask for. Any non-null
  value is an error and the value is ignored.
- **A malformed path id is `400`, not `422`.** A controller-local
  `@ExceptionHandler(MethodArgumentTypeMismatchException)` in `TaskController` overrides the
  advice for that controller. Consequence to be aware of: query-parameter type mismatches in
  `TaskController` also become 400 (`?page=abc`, `?assigneeId=nope`). Statuses and dates bind
  as `String` instead, so `?status=NOPE` and `?createdFrom=yesterday` stay 422 with the bad
  value named, as BE-04 §4.4 requires. This is the one place where a Spring exception maps to
  two statuses depending on which handler sees it.
- **`unassigned`, `overdue`, `createdFrom`, `createdTo` bind as `String`**, not
  `Boolean`/`@DateTimeFormat LocalDate`, so `TaskQueryFactory` can answer 422 naming the
  offending text rather than letting Spring produce a generic mismatch error. `page`,
  `size`, `dueWithinDays` and `assigneeId` still bind natively (their documented status is
  400 / type-mismatch).
- **Bean Validation messages are spelled identically to `TaskValidator`'s**, so a field
  rejected by an annotation and a field rejected in the service produce the same
  `errors[].message`. Annotations are a fast path, not a second rule set (FR-B-18).
- `BulkStatusRequest` has **no `reopen`** even though BE-04 §4.3 sketched one: a bulk reopen
  is per-task intent and a single flag would drag every selection to TODO.
- `expectedVersions` binds as `Map<UUID, Long>`; `00-index.md` §2.1 says
  `Map<UUID,Integer>` — `Long` accepts any JSON integer and matches `Task.version`.
- The list handler maps `PageResponse<Task>` → `PageResponse<TaskResponse>` field by field,
  so C2 stays `content, page, size, totalElements, totalPages`.

**Contract changes**
- **C2 and C3 byte-match.** Verified live — `jq 'keys_unsorted'` on a task returns the 15 C3
  fields in order, `isOverdue`/`isUnassigned` always present.
- **Three new wire facts, all recorded in `00-index.md` §2.2:** `status` in a patch body is
  400-on-field-`status`; a malformed UUID path segment is 400; bulk takes no `reopen`.
- `POST /api/tasks` answers **201** with `Location: /api/tasks/{id}`; `DELETE` answers **204**
  with an empty body.
- Error markers reachable over HTTP: `validation-failed`, `not-found`, `unprocessable`,
  `method-not-allowed`, `internal-error`, plus `illegal-transition`, `version-conflict` from
  the service.

**Verification performed**
- `./gradlew clean test` → **BUILD SUCCESSFUL, 307 tests, 0 failures** (250 carried over,
  57 new).
- `./gradlew bootRun` + live `curl`, all recorded in this session:
  - `curl -s 'localhost:8080/api/tasks?size=2&sort=-createdAt' | jq '{totalElements,page,size,totalPages}'`
    → `{"totalElements":2,"page":0,"size":2,"totalPages":1}`
  - `curl -si -X POST localhost:8080/api/tasks -d '{"title":"","priority":"NOPE"}' -H 'content-type: application/json'`
    → `HTTP/1.1 422` `{"type":"…/unprocessable","detail":"malformed or unknown field in request body"}`
    (the unparseable enum is caught by Jackson before Bean Validation sees the blank title)
  - `curl -s localhost:8080/api/tasks -d '{"title":"","tags":["a","b","c","d","e","f"]}'`
    → `400` with `errors` for `tags` ("must contain at most 5 entries") **and** `title`
    ("must not be blank") in one response
  - `curl -s localhost:8080/api/team-members | jq 'length'` → `0` (expected: BE-05 has not
    seeded yet — BE-01 flagged this exact state)
  - filters: `?priority=HIGH&tag=smoke&q=smoke` → 1, `?overdue=true` → 1,
    `?unassigned=true` → 2, `?sort=nope` → 422 naming the allowed wire fields,
    `?size=101` → 400 on `size`, `?createdFrom=yesterday` → 422
  - `GET /api/tasks/stats` → all four headline counters plus zero-filled buckets, never
    routed into `{id}`; `PUT /api/tasks/stats` → 405 `method-not-allowed`
  - `GET /api/tasks/not-a-uuid` → `400` with `instance: "/api/tasks/not-a-uuid"`
  - status changes: legal → 200 `version: 2`; `CANCELLED → TODO` without reopen → 409;
    with `reopen: true` → 200 landing on `TODO`; `reopen: true` with a non-TODO target → 400
    on `reopen`; bulk with one illegal target → 409 naming the task and
    `errors[0].field = "ids[0]"`

**Known gaps / follow-ups**
- **Nothing is seeded.** `/api/team-members` is `[]` and the list is empty on a fresh boot
  until BE-05 runs. The `assignees` rollup in `/stats` is correspondingly empty.
- **OPEN-14 still stands**: `PATCH` cannot clear `assigneeId`, `reporterId`, `dueDate` or
  `estimateHours`. **FE must not ship an "unassign" affordance** — a real gap, tracked in
  `00-index.md` §6.
- **`createdFrom`/`createdTo` are inclusive-day bounds in the clock's zone.** The clock is
  `systemUTC`, so a client in another zone can be off by a day at the edges. Fine for the
  demo, worth revisiting if BE-08's tools expose the same filters.
- **The list's default ordering is untested** — the controller slice runs on a frozen clock so
  every row shares `createdAt` and the id tiebreak decides. Ordering itself is covered by
  `listSortsAndPages` and by BE-01's repository tests.
- **No concurrency protection.** `require`-then-`save` is not atomic; two simultaneous
  writers can both pass the `expectedVersion` check (carried over from BE-03).
- **No OpenAPI / API-docs dependency** was added; the frozen contract lives in
  `00-index.md` §2.2 and C1–C3.

## BE-05 — Dashboard stats and seed data — done — 2026-10-07

**Files added** — main
- `bootstrap/SeedDataProperties.java` — `app.seed.{enabled,members,tasks}`; `members`/`tasks`
  fall back to 6/50 when unset, so a bare `app.seed.enabled: true` still works.
- `bootstrap/SeedDataRunner.java` — `@Component @Order(0) ApplicationRunner`. FR-B-15.
  `seed()` is public so tests drive it directly; `run()` is the Spring hook.

**Files added** — test
- `bootstrap/SeedDataRunnerTest.java` — 17 tests: one per §4.2 requirement row, plus
  idempotency, "pre-populated store untouched", `enabled: false`, and determinism.
- `service/TaskStatsServiceTest.java` — 13 tests for the aggregation (§4.1).
- `bootstrap/TaskStatsEndpointTest.java` — `@SpringBootTest` + MockMvc against the real
  seeded profile; asserts every headline counter is non-zero and that `?q=login` finds rows.

**Files changed**
- `service/TaskStatsService.java` — one real bug: `createdLast7Days` used
  `today.minusDays(7).atStartOfDay(...)`, a 7-to-8-day window. Now the rolling
  `clock.instant().minus(7 days)` §4.1 specifies. Everything else was already correct and
  is now covered by `TaskStatsServiceTest`.
- `src/main/resources/application.yaml` — added `app.seed.members` and `app.seed.tasks`
  (`APP_SEED_MEMBERS`, `APP_SEED_TASKS`), both env-overridable.

**Decisions taken**
- **`TaskStatsService` was already implemented in BE-04** (see that entry) because
  `/api/tasks/stats` had to become a real route. This task reviewed it against §4.1,
  found the one bug above, and added the 13 unit tests BE-05's plan asked for.
- **The fixture never uses `Random`.** BE-05 §4.2 suggested a seeded `Random`; a pure
  function of the task count and the clock is strictly better here — `theFixtureIsDeterministic`
  asserts two independent runs produce byte-identical `Task` lists, which a seeded RNG could
  only do by accident.
- **Due dates are allocated by walking the open rows and handing out quotas, not by a
  modular rule on the index.** The first implementation used `index % 4` and produced
  **9** overdue tasks instead of the required 10, because the stride collided with the
  `DONE`/`CANCELLED` statuses. `dueDatesFor(...)` walks the non-terminal rows instead:
  every 2nd open row is overdue, every 4th (odd) row is due within 7 days, the rest either
  get a far-future date or none. Terminal rows always get a past date, so DONE/CANCELLED
  never read as overdue. This holds for any configured task count.
- **`verify(...)` runs at boot and in tests.** BE-05 said "self-check that throws, or at
  minimum a test"; this does both — `SeedDataRunner.seed()` calls the same static
  `verify` the test calls, so a broken fixture fails the app at startup rather than shipping
  an undemonstrable filter. It names the first violated requirement.
- **Member ids are `UUID.nameUUIDFromBytes("agui-basic/member/" + displayName)`, task ids
  `"agui-basic/task/" + index`.** Deterministic, stable across restarts, and self-documenting
  — no hardcoded literals to keep in sync. **These ids are part of the demo contract; do not
  change the prefix strings.**
- `SeedDataProperties.MEMBERS`/`TASKS` are **not enforced as lower bounds.** Setting
  `app.seed.tasks: 20` boots and then fails inside `verify` with "the fixture needs at least
  40 tasks" — a loud, named failure rather than a silent partial fixture.

**Demo contract (referenced by the AG-UI script)**
- 6 members, in this `displayName` order: Ana Reyes (ENGINEER), Ben Osei (ENGINEER),
  Chloe Tan (DESIGNER), Dmitri Volkov (ENGINEER), Elena Rossi (PRODUCT_OWNER),
  Farah Nasser (QA). Emails are `first.last@agui-basic.test`.
- 50 tasks. Titles cycle through 20 curated strings in `SeedDataRunner.TITLES`; the first
  four all mention **login**, so "mark the three login tasks in review" is satisfiable.
- Tags: `bug` on 13, `auth` on 10, `ui` on 7, plus one of
  `api, frontend, backend, docs, perf, infra` scattered across rows.

**Contract changes**
- **None to C1–C6 or §2.2.** `GET /api/tasks/stats` and the rest of the surface are as
  BE-04 froze it. `00-index.md` §2.1 gained the `bootstrap` rows.
- **One asymmetry FE should know about:** `?unassigned=true` on the list returns **10**
  (every unassigned row, terminal included), while `stats.unassignedTotal` is **7**
  (open rows only). Both are correct for what they mean — the filter is a list filter, the
  card is an "open work" card — but a user comparing the number in the filter chip with the
  number on the card will see different digits. **FE: label the card as open work, or the
  discrepancy will read as a bug.**

**Verification performed**
- `./gradlew clean test` → **BUILD SUCCESSFUL, 342 tests, 0 failures** (307 carried over,
  35 new).
- `./gradlew bootRun` on an empty store + live `curl`:
  - `/api/tasks/stats` → `total: 50`, `byStatus` `{BACKLOG: 8, TODO: 7, IN_PROGRESS: 7,
    IN_REVIEW: 7, BLOCKED: 7, DONE: 7, CANCELLED: 7}`, `byPriority`
    `{LOW: 14, MEDIUM: 12, HIGH: 12, URGENT: 12}`, `overdueTotal: 18`,
    `dueThisWeek: 23`, `unassignedTotal: 7`, `createdLast7Days: 7`, 6 assignee rollups.
  - `/api/team-members` → 6, first row `Ana Reyes`.
  - every filter returns rows: `status=BLOCKED` 7, `priority=URGENT` 12, `overdue=true` 18,
    `unassigned=true` 10, `tag=bug` 13, `q=login` 12, `dueWithinDays=7` 41.
- Idempotency and "pre-populated store untouched" are covered by unit tests rather than a
  manual restart — the store is in-memory, so a restart is always a fresh store and could
  not demonstrate it.

**Known gaps / follow-ups**
- **`?force=true` and `409 blocked-delete` remain unreachable** (OPEN-4). Nothing in the
  backend emits `blocked-delete`; the factory exists for BE-09's approval flow.
- **OPEN-14 still stands** — `PATCH` cannot clear `assigneeId`, `reporterId`, `dueDate` or
  `estimateHours`. **FE must not ship an "unassign" affordance.** The seed data contains
  unassigned rows, so a user will hit this as soon as they try to edit one.
- **The fixture is visibly patterned.** Assignee assignment (`i % 6`) and the overdue stride
  are both index-derived, so several members end up with `overdueCount == openCount`. It is
  functionally correct and every §4.2 requirement holds, but it reads as synthetic on
  inspection. Decoupling the assignee from the row index would fix it if the demo needs to
  survive a close look.
- **`app.seed.tasks` below 40 fails the boot** rather than clamping. Clamping would be
  friendlier; the loud failure was chosen so nobody quietly ships a thin fixture.
- **Nothing resets the store.** With an in-memory adapter a restart re-seeds from scratch,
  so edits made in the UI disappear on reload. A "reset demo data" endpoint would be a
  useful addition for whoever demos this; out of scope here.

## BE-07 — The `Agent` bean, ChatClient and shared-state wiring — done — 2026-10-08

**Files added** — main
- `agent/AgentPrompts.java` — `SYSTEM_PROMPT` (one constant, ~430 words) plus the C4
  transition table, the two vocabularies, the tool-name lists and `STATE_PROMPT`
  (the `statePrompt` function: state-ownership rule + the state JSON).
- `agent/AgentConfig.java` — `@Configuration` under
  `@ConditionalOnProperty("app.ai.enabled", havingValue="true", matchIfMissing=true)`;
  the `chatClient` bean (`builder.clone().defaultSystem(SYSTEM_PROMPT)`) and the `agent`
  bean. `static buildAgent(ChatClient, List<ToolCallback>, List<Tool>)` is the
  Spring-free assembly seam the tests use.
- `agent/SuccessOutcomeAgent.java` — see **Contract changes**. Wraps the SDK agent and
  substitutes `SuccessOutcome` for a `RUN_FINISHED` that carries no outcome.
- `agent/TaskReadTools.java`, `agent/TaskMutationApprovalTools.java` — **stubs**.
  `asToolCallbacks()` / `declarations()` both return `List.of()`. BE-08 and BE-09 replace
  the bodies; they must not rename the methods or drop `@Component`.

**Files added** — test
- `testsupport/StubChatModel.java` — a `ChatModel` that answers a fixed string and records
  the last `Prompt`, so prompt wiring is assertable without a model (NFR-10).
- `agent/AgentConfigTest.java` — 9 tests over the real `SpringAiAgent`: event sequence,
  initial `STATE_SNAPSHOT` echo, ids, `MESSAGES_SNAPSHOT` before `RUN_FINISHED`, no
  snapshot without state, both prompts reaching the model, outcome null-vs-`success`.
- `agent/AgentPromptsTest.java` — 9 tests pinning the prompt contract (C4 verbatim, the
  vocabularies, both tool names, the never-submit rule, `context.today`, the state
  ownership rule, no HTTP vocabulary, word budget).
- `agent/AgentDisabledTest.java` — `@SpringBootTest(properties="app.ai.enabled=false")`:
  no `Agent`/`ChatClient` bean, `/api/tasks` and `/api/team-members` still 200,
  `POST /agent` 404.
- `agent/AgentWiringTest.java` — the default profile has exactly one `Agent` bean (named
  `agent`) and one `ChatClient` bean (named `chatClient`).

**Files changed**
- `BackendApplication.java` — **the class was renamed to `clearBackendApplication` by
  something outside this task** (an IDE-side edit) and the build broke; renamed back.
  Flagging it because the file is not otherwise part of BE-07. If a later task sees the
  same file with a lower-cased class name, it is not a BE-07 regression.
- `00-index.md` — nothing. No contract name or signature changed.

**Decisions taken**
- **`agent.ai.enabled` gates the whole `AgentConfig`**, so with `false` there is no
  `Agent` bean *and* no `chatClient` bean. The AG-UI auto-configuration is
  `@ConditionalOnBean(Agent.class)` → `@ConditionalOnBean(AgentRegistry.class)`, so with
  the agent gone the `AgUiController` is never registered at all.
- **`SuccessOutcomeAgent` was not in the plan and is the one substantive addition.** The
  SDK leaves `RunFinishedEvent.outcome` null on a normal finish, so the wire emitted
  `{"type":"RUN_FINISHED","threadId":"t1","runId":"r1"}` with no `outcome` field. The
  DoD and FE-13 both assume the field is there, so the registered bean is a two-line
  decorator that fills in `{"type":"success"}`. `RUN_ERROR` is untouched.
- **`emitMessagesSnapshot(true)` kept on.** It is one extra event per run carrying the
  durable conversation; FE may ignore it. Pinned by a test so the choice is visible.
- **`statePrompt` is customised** (`AgentPrompts.STATE_PROMPT`) even though BE-07 §4.1
  said the SDK default would do. The default says only "call `update_state` with the
  complete new state" and does not state the ownership rule; FR-S-01 needs the model told
  that `context`/`draft` are read-only, and the state JSON is still rendered. If a future
  model ignores the ownership rule, this is the knob — deleting `.statePrompt(...)`
  restores the SDK default.
- **Prompt length is enforced by a test** (`< 600` words). The demo runs a 4 B model;
  a silently doubled prompt would degrade it without failing anything else.
- **`ChatClient` is cloned from the auto-configured `Builder`**, not built with
  `ChatClient.create`, so Boot's advisors survive.
- **No `ChatMemory` advisor** (FR-AI-04): history arrives in `RunAgentInput.messages`.
- **The agent is a `SpringAiAgent`, not the `*-boot-starter`.** The starter is not on the
  classpath and must not be added; it would contribute a second `Agent` bean and
  `AgentRegistry.single()` would stop resolving.
- **Test seam uses a `CountDownLatch`.** The SDK publisher is backed by a Reactor `Flux`,
  so events can arrive off-thread; without the latch the assertions saw only the two
  synchronous events and passed vacuously. Worth remembering for BE-08/BE-09 tool tests.

**Contract changes**
- **`RUN_FINISHED.outcome.type` is now always present**, `success` or `interrupt`.
  Before this task a successful run omitted the field entirely. FE-13 can rely on it.
- **The exact event sequence for a plain text run** (verified live, see below):
  `RUN_STARTED` → `STATE_SNAPSHOT` (only when the request carries `state`) →
  `TEXT_MESSAGE_START` → `TEXT_MESSAGE_CONTENT`* → `TEXT_MESSAGE_END` →
  `MESSAGES_SNAPSHOT` → `RUN_FINISHED`. The `MESSAGES_SNAPSHOT` sits between the last
  message event and `RUN_FINISHED`, so a client that closes the transcript on
  `TEXT_MESSAGE_END` will drop it — FE must consume the stream to `RUN_FINISHED`.
- **`app.ai.enabled=false` failure surface: `404` with the C1 `not-found` envelope**,
  `detail: "no endpoint at /agent"`. There is no AG-UI-specific 404 here: the controller
  is not registered, so this is the same handler as any unknown path. FE-13 renders this
  as the "AI is switched off" card, and must **not** try to detect it from the body —
  it is indistinguishable from a typo'd path.

**Verification performed**
- `./gradlew test` → **BUILD SUCCESSFUL, 365 tests, 0 failures** (342 carried over,
  23 new: 9 config + 9 prompt + 3 disabled + 2 wiring).
- `./gradlew bootRun` on port 8080 with Ollama `gemma4:e4b`, live:
  - `curl -sN -X POST localhost:8080/agent -H 'content-type: application/json' -d '{"threadId":"t1","runId":"r2","state":{"context":{"today":"2026-01-05"}},"messages":[{"id":"m1","role":"user","content":"say hi in three words"}]}'`
    → `RUN_STARTED` → `STATE_SNAPSHOT {"context":{"today":"2026-01-05"}}` →
    `TEXT_MESSAGE_START/CONTENT×4/END` → `MESSAGES_SNAPSHOT` (user m1 + assistant
    "Hello there, friend!") → `RUN_FINISHED {"outcome":{"type":"success"}}`.
  - The first attempt at this curl returned `RUN_ERROR
    com.openai.errors.OpenAIIoException: Request failed` (okhttp "Socket closed" while
    reading response headers) while Ollama answered the identical request directly.
    Reproduced once, then never again — an Ollama/okhttp cold-start hiccup, not a wiring
    bug. If it recurs in the demo, retry the run.
- `APP_AI_ENABLED=false SERVER_PORT=8081 ./gradlew bootRun` → `GET /api/tasks` 200,
  `GET /api/team-members` 200, `POST /agent` → **404** C1 `not-found`
  (`"detail":"no endpoint at /agent"`).

**Known gaps / follow-ups**
- **No tools exist yet.** `TaskReadTools`/`TaskMutationApprovalTools` are empty stubs, so
  the agent cannot read data and cannot propose a mutation. BE-08/BE-09 fill them in;
  both keep the existing bean methods.
- **The prompt is untested against a real model.** It has never been shown to obey
  FR-AI-13/28/29/30/31; only its content is asserted. The demo script is the first real
  check, and the state-ownership rule is the rule most likely to need the `statePrompt`
  knob.
- **`update_state` was never exercised end-to-end.** `STATE_DELTA` mode is configured but
  unproven: no run so far has had the model call `update_state`. BE-10 should send a run
  whose state the model changes and confirm a `STATE_DELTA` frame arrives.
- **Interrupt paths are unproven** — no interrupt tool is declared, so the
  `outcome.type == "interrupt"` branch of the protocol has not been observed on the wire.
  BE-09 owns that verification.
- **Ollama's first request after a cold start can fail** with `OpenAIIoException`; see
  above. `spring.mvc.async.request-timeout: 300000` (BE-06) covers slow streams, but a
  `RUN_ERROR` frame ends the run regardless.

## BE-08 — Backend read tools — done — 2026-10-08

**Files added**
- `agent/ToolResults.java` — the six result records (`TaskBrief`, `TaskPageResult`,
  `TaskDetailResult`, `StatsResult`, `MemberRef`, `AssigneeRef`). Nested in one holder class
  because they exist only as this task's wire shapes.
- `test/agent/TaskReadToolsTest.java` — 34 tests over the real services with a fixed clock.
- `test/agent/ToolSchemaTest.java` — 21 tests pinning the generated JSON Schema and the exact
  result JSON.

**Files changed**
- `agent/TaskReadTools.java` — the BE-07 stub is gone; four `@Tool` methods now sit behind the
  same `asToolCallbacks()` bean method, so `AgentConfig` needed **no** change.
- `agent/TaskReadTools` constructor is `(TaskService, TaskStatsService, TeamMemberService,
  TaskPresenter)` — **no `Clock`**, see below.

**Decisions taken**
- **Every tool argument is a `String`, not `List<TaskStatus>` / `UUID` as §4.1 sketched.** This
  is the one substantive deviation and it was deliberate. Spring AI's `MethodToolCallback` binds
  arguments *before* the method body runs (`buildTypedArgument` → `ToolExecutionException`), so a
  bad enum or a malformed uuid would escape as a Jackson message — precisely the stack-trace
  channel §4.3 forbids, and one the model cannot act on. Taking raw text moves the failure inside
  the method, where it becomes `{"error":"unknown value 'in progress'; allowed: BACKLOG, TODO, …"}`.
  Cost: `status`/`priority` are **comma-separated strings**, not JSON arrays. That is arguably
  *better* for a 3–4 B model, and both schemas now say "separated by commas" so a model that
  guesses an array fails loudly rather than silently. `get_task` takes `taskId` as a string for
  the same reason.
- **Enum parsing is total and case-insensitive.** `in progress` → error naming the legal set;
  ` blocked ` → `BLOCKED`. A small model writes lowercase constantly, and rejecting that would
  burn a turn on a technicality.
- **`get_task` distinguishes `not_found` from `invalid_id`.** A malformed uuid is *not*
  reported as `not_found`: that word means "the row is gone", and telling the model a task
  vanished because it produced a malformed uuid would send it hunting for a deletion that never
  happened. `not_found` is reserved for "well-formed id, no such row".
- **Error channel = a nullable `error` field on each result record**, annotated
  `@JsonInclude(NON_NULL)` so it is *absent* on success rather than `"error": null`. `known`
  carries `@JsonInclude(NON_EMPTY)` and appears only on the unknown-assignee error. FE-13 keys
  the error card off the presence of `error`.
- **A failed `query_tasks` always returns zero tasks**, never an unfiltered page. Covered twice
  in the tests because it is the single most damaging failure mode: an unfiltered page beside an
  error lets the model report unrelated numbers as if they were the answer.
- **`limit` is clamped, not validated**: `null`/`<1` → 20, `>100` → 100, no error. Clamping a page
  size is not a model mistake worth a turn.
- **No `Clock` in `TaskReadTools`.** `TaskPresenter` already owns the injected clock and is the
  single definition of "overdue" (OPEN-5); a second clock field would only be a way for the tool
  and the REST badge to disagree. The fixed clock in tests arrives through the presenter.
- **Sort is a two-step compromise.** `TaskQuery` sorts one column, and the required order is
  "overdue first, then dueDate asc, nulls last". So the repository is asked for **dueDate
  ascending** — which pulls the most-overdue rows into the page — and the full three-key order is
  then applied to that page. Sorting is not exposed to the model, as §4.2 asked.
- **`list_team_members` returns a bare `List<MemberRef>`**, so on an unexpected failure it logs
  at WARN and answers `[]` rather than inventing a second envelope. An empty list reads to a
  model as "nobody"; a thrown exception would fail the whole tool loop.
- **Unexpected exceptions become `{"error":"internal error"}` with the throwable logged at WARN**,
  never the model prompt (NFR-3). Three separate `try` blocks rather than one wrapper, because
  each method returns a different record type.
- **`assigneeName` resolution returns `error` + `known`, never a dropped filter** (§4.2). Verified
  live: the model received the error and immediately retried with `"Ana Reyes"` from `known`.
- **Registration stayed in one place.** `asToolCallbacks()` returns `List.of(provider callbacks)`
  — a one-element list holding a four-element array — because that is the shape `AgentConfig`
  already expected, and because it keeps BE-09 free to register its interrupt tools separately.
  Nothing is registered on the `ChatClient`, so no tool is advertised twice.

**Contract changes**
- **The four backend tool names are now `query_tasks`, `get_task`, `get_task_stats`,
  `list_team_members`** (snake_case, set explicitly in `@Tool(name = …)` so they cannot drift
  from method names). These match `AgentPrompts.READ_TOOL_NAMES`, which BE-07 already published —
  a test asserts the two agree. C1–C6 and §2.2 are untouched; the agent prompt needed no edit.
- **FE-11 renders tool args verbatim; these are the exact argument names and types:**

  | tool | arguments |
  |---|---|
  | `query_tasks` | `q` (string), `status` (string, comma-separated), `priority` (string, comma-separated), `assigneeName` (string), `overdue` (boolean), `unassigned` (boolean), `dueWithinDays` (integer), `limit` (integer). **All optional** — `required: []` |
  | `get_task` | `taskId` (string). **Required** |
  | `get_task_stats` | none |
  | `list_team_members` | none |

- **Every tool's schema carries `additionalProperties: false`**, so a model that invents a `sort`
  or `page` argument gets the call rejected by the provider rather than silently ignored.

**Exact result JSON shapes (FE-13 needs these verbatim)**

`query_tasks` — success (note: **no `error` key**, and **no `known` key**):
```json
{"tasks":[{"id":"…uuid…","title":"Handle timezone drift in due-date filters",
           "status":"BLOCKED","priority":"MEDIUM","assignee":"Ana Reyes",
           "dueDate":"2026-09-22","overdue":true,"tags":["api"]}],
 "total":4,"limit":20}
```
`query_tasks` — unknown assignee (**empty `tasks`, `limit: 0`, `total: 0`**):
```json
{"tasks":[],"total":0,"limit":0,
 "error":"unknown team member 'Zoe Nobody'",
 "known":["Ana Reyes","Ben Osei","Chloe Tan","Dmitri Volkov","Elena Rossi","Farah Nasser"]}
```
`query_tasks` — bad enum: `{"tasks":[],"total":0,"limit":0,"error":"unknown value 'in progress'; allowed: BACKLOG, TODO, IN_PROGRESS, IN_REVIEW, BLOCKED, DONE, CANCELLED"}`

`get_task` — success (a nested `brief` object, **not** a flattened task):
```json
{"brief":{"id":"…uuid…","title":"Document the bulk status endpoint","status":"BACKLOG",
          "priority":"LOW","assignee":"Ben Osei","dueDate":"2026-11-25",
          "overdue":false,"tags":["perf"]},
 "description":"Context and acceptance notes for iteration 1.",
 "taskId":"…uuid…"}
```
`get_task` — unknown id: `{"taskId":"…uuid…","error":"not_found"}`; malformed id:
`{"taskId":"not-a-uuid","error":"invalid_id"}`

`get_task_stats` (all 7 status and 4 priority keys always present, zero-filled):
```json
{"total":50,
 "byStatus":{"BACKLOG":8,"TODO":7,"IN_PROGRESS":7,"IN_REVIEW":7,"BLOCKED":7,"DONE":7,"CANCELLED":7},
 "byPriority":{"LOW":14,"MEDIUM":12,"HIGH":12,"URGENT":12},
 "overdue":18,"dueThisWeek":23,"unassigned":7,
 "assignees":[{"displayName":"Ana Reyes","open":4,"overdue":4},
              {"displayName":"Ben Osei","open":6,"overdue":0}]}
```
`list_team_members` — a **bare array**, no envelope:
```json
[{"id":"…uuid…","displayName":"Ana Reyes","role":"ENGINEER"}]
```

**Handoff to FE-13**
- A tool result arrives as its own `TOOL_CALL_RESULT` with its own `messageId` (BE-07 already
  confirmed this). Render one card per `messageId`; branch on whether `content` parses to an
  object with an `error` key (error card) or a bare array (`list_team_members`) or an object
  without `error` (success card).
- `error` values the UI may see verbatim: `"unknown team member '<x>'"`, `"unknown value '<x>';
  allowed: …"`, `"not_found"`, `"invalid_id"`, `"internal error"`, `"dueWithinDays must be 0 or
  more…"`, `"q is too long…"`. Only `not_found` and `invalid_id` are machine-ish; the rest are
  sentences meant to be read by a human watching the transcript.
- `known` is the recovery affordance: show it as "did you mean" chips.
- `dueDate` is `yyyy-MM-dd` or **absent** (the key is omitted when the task has no due date).
  `overdue` is always present. `assignee` is a **display name**, never an id — FE does not need to
  resolve it.
- `stats.unassigned` counts **open** unassigned tasks (7 on the seed), while the
  `unassigned=true` list filter returns every unassigned row including terminal ones (10).
  BE-05 flagged this asymmetry; BE-08 carries it unchanged. Label the card "open work".

**Verification performed**
- `./gradlew clean test` → **BUILD SUCCESSFUL, 420 tests, 0 failures** (365 carried over from
  BE-07, 55 new: 34 tool behaviour + 21 schema/wire).
- Side-effect freedom is a test, not a claim: `noToolMutatesTheStore` snapshots
  `tasks.count()`, the member count and **every task's `version`**, sweeps all four tools *plus*
  the two error paths, and asserts all three snapshots are unchanged. `noRegisteredToolCanWrite`
  additionally pins the registered names, which is BE-09 §7's DoD item.
- Manual, live, against `gemma4:e4b` on Ollama, `./gradlew bootRun` + the §5 curl. Four runs:
  1. `"what is overdue and blocked?"` — **no tool call at all.** The 4 B model answered from
     memory with a definition of "overdue". The tools were advertised correctly; the model chose
     not to use them. This is a model-capability finding, not a wiring bug — see **Known gaps**.
  2. `"Which tasks are blocked and overdue? Call query_tasks with status BLOCKED and overdue
     true; do not answer from memory."` → the full loop:
     `RUN_STARTED` → `STATE_SNAPSHOT` → `TOOL_CALL_START query_tasks` → `TOOL_CALL_ARGS
     {"overdue":true,"status":"BLOCKED"}` → `TOOL_CALL_END` → `TOOL_CALL_RESULT` (4 briefs, names
     not ids, no `error` key) → `TEXT_MESSAGE_*` → `MESSAGES_SNAPSHOT` → `RUN_FINISHED
     {"outcome":{"type":"success"}}`. The answer listed all four with correct assignees.
  3. The error path + recovery: `assigneeName:"Zoe Nobody"` → `{"tasks":[],"total":0,"limit":0,
     "error":"unknown team member 'Zoe Nobody'","known":[…all six…]}`, then the model called
     `get_task_stats` (correct 50/8/7/…/18/23/7 with all six rollups), then retried
     `query_tasks` with `"Ana Reyes"` and got her one backlog task. **Self-correction from the
     error channel works end to end.**
  4. `get_task` by uuid → the nested `brief` + `description` shape above. A run with **no**
     `state` produced no `STATE_SNAPSHOT`, confirming BE-07's finding.

**Known gaps / follow-ups**
- **The 3–4 B model does not reliably call tools on its own.** Run 1 answered "what is overdue and
  blocked?" from memory without touching `query_tasks`, and the same prompt with an explicit
  "call query_tasks" clause worked immediately. So the tool plumbing is proven, but AC-2.3 ("the
  agent answers real questions about the task data without the frontend doing anything clever")
  depends on the demo script either phrasing requests imperatively or on a model that calls tools
  unprompted. **BE-10 / the demo script should plan for this**: if the model is not calling tools,
  strengthen `SYSTEM_PROMPT` (a rule like "always call a tool before answering any question about
  tasks") rather than debugging the backend. Changing the prompt is BE-07's file.
- **The tool result JSON is produced by Spring AI's own mapper, not the application's.** It
  happens to match the `tools.jackson` 3.x on the classpath, and `@JsonInclude(NON_NULL)` is
  honoured — but that is Spring AI's `JsonHelper`, not Boot's `JsonMapperBuilderCustomizer`
  (BE-02's strict config). If the helper's mapper ever changes, the `error`-key omission is the
  first thing that would break. `ToolSchemaTest` pins it at the JSON level, so it would fail
  loudly rather than quietly.
- **`assigneeName` is resolved by `TeamMemberService.findByName`, which falls back to a substring
  match.** `findByName("Ben")` returns Ben Osei. That is deliberate (exact before substring, per
  BE-03) but it means a typo like `"Ann"` could resolve to a real member rather than erroring.
  A model that guesses a name will usually get *a* member rather than the error path.
- **The `limit` page is a repository page, so `total` can exceed the rows returned.** A model
  asked about 37 tasks with `limit: 20` sees 20 and knows 20 of 37. That is the intended
  behaviour, but a small model may answer "you have 20 overdue tasks". If the demo needs whole
  numbers for a bucket, point it at `get_task_stats` — the prompt already says so.
- **No tool returns anything for `list_team_members` beyond id/name/role** — no email, no task
  counts. `get_task_stats`' rollup carries the counts instead, so FE-13 should not try to merge
  them client-side.
- **`dueWithinDays` is a date filter, not an "open work" filter**: it includes `DONE`/`CANCELLED`
  rows whose due date has passed. Only `overdue` and the stats cards apply the terminal rule
  (OPEN-5). Pinned by `queryTasksFiltersOnDueWithinDays`.
- **BE-09 remains unstarted.** `TaskMutationApprovalTools.declarations()` is still the empty stub,
  so the agent can read but cannot propose anything.

## BE-09 — Approval-gated mutations (interrupt tool) and the resume contract — done — 2026-10-08

**Files added**
- `agent/TaskMutationApprovalTools.java` (was the BE-07 stub) — the one tool the agent may
  propose through: `propose_task_mutation` with the four documented intents in its
  description. Owns its own Javadoc explaining the emitted interrupt shape.
- `agent/ResumePayloadValidator.java` — pure validation of the four documented resume
  payloads (approve/success, approve/failure, reject); mirrors what FE-12's TypeScript
  mirror must implement.
- `testsupport/JdkFlowSupport.java` — moved out of `AgentConfigTest` so the interrupt tests
  reuse it (BE-07's private nested class is gone from `AgentConfigTest.java`).
- `testsupport/ToolCallChatModel.java` — a `ChatModel` that answers with an assistant tool
  call instead of text, so the run loop is drivable without a model (NFR-10).
- `test/agent/TaskMutationApprovalToolsTest.java` (7), `test/agent/AgentInterruptWiringTest.java`
  (2 — wiring + interrupt shape + resume folding), `test/agent/ResumeContractTest.java`
  (6 — all payload cases, including "missing `approved` is detectable").

**Files changed**
- `agent/AgentPrompts.java` — the §4.4/§4.5 rules added to `SYSTEM_PROMPT`: at most one
  mutation per request, bulk = a single proposal with all ids, result honesty, rejected
  without re-proposing, dismissed with an acknowledgement, `not_found` is final and must
  be re-resolved with `query_tasks` before another proposal.
- `test/agent/AgentPromptsTest.java` — two new guards pinning the approval contract phrases
  and the "never claim a change happened" honesty.
- `00-index.md` **C6 updated** — the frozen contract now matches the wire (see below).

**Decisions taken**
- **C6 predates the SDK, and the SDK wins.** The table I wrote ahead of implementation said
  `reason: "tool_call"`, `message: <the summary>`, metadata `{tool, args, summary, origin}`
  and a resume-payload `responseSchema`. The shipped `SpringAiAgent` (verified in
  `ag-ui/sdks/community/java/spring/spring-ai/spring-ai/src/main/java/com/agui/community/spring/ai/SpringAiAgent.java`,
  `toInterrupt()`) hardcodes: `reason: "input_required"` for backend interrupt tools,
  `message: "propose_task_mutation"` (the tool name), metadata `{toolName, arguments}` with
  `arguments` a JSON **string**, `responseSchema` = the tool's *input parameter* schema, and
  `expiresAt: null`. There is no builder hook to change any of those. Per BE-09 §4.3 I did
  **not** work around the SDK: the declaration stands, and C6 was rewritten to the shipped
  shape. The human-readable summary the approval card shows is therefore the `summary`
  argument inside `metadata.arguments`, **parsed as JSON** — not the interrupt's `message`.
- **The resume-payload schema the model sees (`responseSchema`) describes the tool's
  arguments, not the resume payload.** That means the agent gets no schema-level guarantee
  that `approved` is present; that validation rules were pushed to
  `ResumePayloadValidator` (and pinned, and mirrored for the FE). AG-UI's `Resume` record
  itself requires only `interruptId` and `status`, so nothing below the wire enforces the
  payload either — it is a promise between the user, FE-12 and the model.
- **The "only mutation path" assertion from BE-09 §7 is done in `TaskReadToolsTest`**
  (`noRegisteredToolCanWrite`): the registered backend callbacks are exactly the four read
  names and none of those names imply a write. The permission lives in code, not just in
  the prompt.
- **Bulk is a single proposal, enforced by prose, not by the tool schema.** `update_task_status`
  accepts `taskIds` — an open list — so the "one proposal with all ids, never a chain"
  rule is stated in the tool description and the system prompt, and pinned by tests. An
  enforced-oneOf variant was rejected because small models mishandle oneOf.
- **The model's self-report grammar after a resume is the prompt's, not the SDK's.** The
  folded-back `ToolResponseMessage` would be JSON (`{"approved":true,...}`); the model
  needs the instruction to report exactly what that says, so it is spelled out in
  `SYSTEM_PROMPT`. No attempt was made to post-process the resume into prose.

**Contract changes**
- **C6 updated** in `00-index.md` to the shipped shape: `reason: "input_required"`;
  `message: "propose_task_mutation"`; metadata `{toolName, arguments}`; `responseSchema` =
  the tool's input-parameter schema; `expiresAt` never set. **FE-12 finds the card's summary,
  tool and args inside `metadata.arguments` (JSON string), not in `message`.** If the AG-UI
  SDK later exposes a metadata hook, this table returns to the richer C6 we first drafted.
- **No wire change to the read tools** (BE-08's shapes are as shipped).
- **`00-index.md` §2.2 is untouched.**

**Verification performed**
- `./gradlew clean test` → **BUILD SUCCESSFUL, 437 tests, 0 failures** (420 carried over
  from BE-08, 17 new: 7 declaration + 2 wiring + 6 resume + 2 prompt).
- Live two-run curl against `gemma4:e4b` (`./gradlew bootRun`):
  - Run 1 ("Please mark task `f6a5ef1d-…` as DONE. Propose the change.") →
    `RUN_STARTED` → `STATE_SNAPSHOT` → `TOOL_CALL_START propose_task_mutation` →
    `TOOL_CALL_ARGS {"args":{"status":"DONE","taskId":"f6a5ef1d-…"},"reason":"User requested
    marking the task as done.","summary":"Mark task f6a5ef1d-… as DONE","tool":"update_task_status"}`
    → `TOOL_CALL_END` → `MESSAGES_SNAPSHOT` → `RUN_FINISHED { "type": "interrupt",
    "interrupts":[{ "id":"call_mskevcal", "reason":"input_required",
    "message":"propose_task_mutation", "toolCallId":"call_mskevcal",
    "responseSchema": <the tool's input schema>,
    "metadata":{"toolName":"propose_task_mutation","arguments":"<json string>"} }] }`.
    Exactly one interrupt. No text message was produced, which is the interrupt behaviour
    you want — the run pauses rather than continuing into a self-justification.
  - Run 2 (same `threadId: walkthrough…` `t100`, with `resume:[{interruptId:
    "call_mskevcal", status:"resolved", payload:{approved:true, result:{…TaskResponse…}}}]`)
    → one text message: *"The task "Document the bulk status endpoint" has been successfully
    marked as DONE."*, then `RUN_FINISHED { "type": "success" }`. The model reported the
    resumed result verbatim and did not re-call the mutation.
  - **And the task is still `IN_REVIEW`** when I `GET` it directly — the backend performed
    no write. That is the whole point of OPEN-2, and it now holds against the live server,
    not just in a unit test.

**Handoff to FE-12**
- Interrupt arrives inside `RUN_FINISHED { type:"interrupt", interrupts: [ … ] }`. One
  interrupt per pending client tool call; here one, for `propose_task_mutation`.
- Card rendering: take the title from the tool name (`propose_task_mutation`), the summary
  from `JSON.parse(interrupt.metadata.arguments).summary`, the mutation + args from the same
  JSON's `tool` / `args`. Do not look for `message` to carry the summary — it does not.
- `responseSchema` describes the **tool's arguments**, so do not use it to validate the
  resume payload. Validate with the C6/BE-09 rules (approved required, result XOR error,
  reason on reject).
- Resume: `POST /agent` again with the **same `threadId`**, the full message history
  (including the assistant message with the `propose_task_mutation` tool call), and
  `resume: [{ interruptId: <interrupt.id> (= the toolCallId), status: "resolved" |
  "cancelled", payload: { approved: true, result: <TaskResponse from REST verbatim> } |
  { approved: true, error: "<REST error text>" } | { approved: false, reason: "…" } }]`.
  A single resume array must cover **every** open interrupt; a run on a thread with
  unresolved interrupts but no resume is the normal case (it is how the interrupt is first
  raised), but on the next turn the resume must be there. Dismiss = `status: "cancelled"`
  with no payload.
- The frontend, and only the frontend, performs the mutation via the existing REST
  endpoints; the backend has no write path and no way to accidentally execute one.

**Known gaps / follow-ups**
- **`Interrupt.message` is the tool name, not a user-facing line.** If the approval card
  shows a title, prefer the parsed `summary`. This is the SDK's current fixed shape, not a
  bug I can fix without forking the SDK — if the AG-UI maintainers restore
  per-tool `message`/`metadata` hooks, BE-09's original richer C6 becomes achievable
  without FE changes beyond reading `metadata` again.
- **`responseSchema` on the interrupt describes the *tool call*, not the resume payload.**
  There is no schema-enforced `approved` anywhere; the discipline lives in
  `ResumePayloadValidator` + the FE mirror. If "the FE submitted a non-conforming payload"
  becomes a support issue, that is where to add a hard validation call in an agent-side
  hook once the SDK offers one.
- **The model can propose once and then “think out loud” rather than stop.** Run 1 had no
  text content after the tool call, but that is a 4 B-model property — treat the interrupt
  outcome as the contract, not the surrounding text.
- **Prompt-budget kept but thinning.** `SYSTEM_PROMPT` is still under 600 words (pinned by
  test), but it now carries the §4.4/§4.5 paragraph; a future task adding a fourth topic
  to the prompt should re-audit which sentence to cut.
- **Spec §6.5 wording vs BE-09 doc.** Spec says the backend executes server-side; BE-09
  overrides this via OPEN-2 and C6. C6 and the HANDOFF are now the authoritative reading.

## BE-10 — Backend verification, documentation and coverage check — done — 2026-10-08

**Files added**
- `backend/README.md` — run/seed/env-var/endpoint table, CORS/proxy strategy, seeded
  fixture summary, AI switch, verify-script usage, and the no-write-by-model invariant.
- `backend/scripts/verify-01.sh` — self-contained verification gate. Owns its server
  (boots `./gradlew bootRun`, tears down on `trap`) unless one is already listening, in
  which case it uses it and marks 24 SKIPPED. `--no-model` skips 17-22; without the flag
  those run only when `OPENAI_BASE_URL` answers and print `SKIPPED` otherwise.

**Files changed**
- `feature-impl/spec-01-be/BE-10-verification.md` — status table set to Done (this entry).
- **No source files were touched.** Every change was to the script wiring or helper text.

**Out-of-scope fixes made (every one)**
- None to production code.
- Two script-only corrections caught during the audit: assertion 19 previously risked
  the model answering from memory (prompt now explicitly names `query_tasks` and
  "list each task"), and assertion 21's jq checks read the shipped `metadata.arguments`
  shape (`toolName`+`arguments`), correcting the doc's stale `metadata.tool` reading.

**Coverage audit (evidence follows `00-index.md` §7; IDs without a backend half are
waived with the reason shown)**

| Spec ID | Status | Evidence |
|---|---|---|
| INV-1 | implemented | `TaskStatusTest`, verify script line 10a (DONE→BACKLOG 409) |
| INV-2 | implemented | `TaskStatusMachineTest`, script 11/11a/11b (reopen=true) |
| INV-3 | implemented | `TaskValidatorTest`, `TaskStatusMachineTest`, script 12 (400 on description) |
| INV-4 | implemented | BE-09 prompt rules + `ResumeContractTest`, BE-08 `get_task` `invalid_id` path |
| INV-5 | implemented | `TaskServiceTest`, `TaskValidatorTest`; script 6 (server-owned id 422) |
| FR-B-01 | implemented | `TaskQueryFactoryTest`, `TaskControllerTest`; script 2/3 |
| FR-B-02 | implemented | `TaskControllerTest` list path; script 1 |
| FR-B-03 | implemented | script 7 (201 + version 1); `TaskServiceTest` |
| FR-B-04 | implemented | script 8 (version 2, updatedAt moves); `TaskServiceTest` |
| FR-B-05 | implemented | script 16 (204, then 404); `TaskServiceTest` |
| FR-B-06 | implemented | script 10/11; `TaskServiceTest` |
| FR-B-07 | implemented | script 13/14 (409 illegal, then 200, none→all updated); `TaskServiceTest` |
| FR-B-08 | implemented | script 4; `TaskStatsServiceTest` |
| FR-B-09 | implemented | script 15 (6 members, sorted); `InMemoryTeamMemberRepositoryTest` |
| FR-B-10 | implemented | `CorsConfigTest`; BE-06 strategy + README table; script 23a probe via curl |
| FR-B-11 | implemented | `TaskValidatorTest` row list; script 12, 5 |
| FR-B-12 | implemented | `ApiExceptionHandlerTest`; BE-02 error envelope everywhere in script |
| FR-B-13 | implemented | `ApiExceptionHandlerTest` marker list; script 9/10b/6a assertions on `.type` |
| FR-B-14 | implemented | script 9 (version-conflict 409); `TaskServiceTest` |
| FR-B-15 | implemented | `SeedDataRunnerTest`, script 24 (restart ⇒ total 50, member id stable) |
| FR-B-16 | implemented | `InMemoryTaskRepositoryTest` copy-of-port row |
| FR-B-17 | implemented | `TaskQueryTest`; repository enforces via `TaskQuery` (OPEN-3) |
| FR-B-18 | implemented | single write path — `TaskService` is the only writer (see BE-03); no write tool wired |
| FR-B-19 | implemented | script 6; `StrictJsonTest`, BE-03 `SERVER_OWNED_FIELDS` test |
| FR-B-20 | implemented | `TaskServiceTest` idempotency window; 5s window pinned |
| FR-B-21 | implemented | script 1 (C2 envelope keys + counts); `PageResponseTest` |
| FR-AI-01 | implemented | script 17 (SSE, RUN_STARTED..RUN_FINISHED success); `AgentConfigTest` |
| FR-AI-02 | implemented | `AgentWiringTest` (one Agent + one ChatClient); BE-07 decisions |
| FR-AI-04 | implemented | no server-side chat memory by decision; BE-07 chatClient bean has no memory advisor |
| FR-AI-09 | implemented | `TaskReadToolsTest` side-effect-freedom sweep + `ToolSchemaTest`; script 19a/19b |
| FR-AI-10 | implemented | `AgentPromptsTest` (no `/api` URLs); `TaskReadTools` description text avoids endpoints |
| FR-AI-11 | implemented | `AgentInterruptWiringTest` (interrupt outcome, one pause, never-executed); script 21a/21b |
| FR-AI-12 | implemented | `TeamMemberServiceTest` exact-before-substring; `TaskReadToolsTest` missing-name error path; script probe (BE-08 §4.3) |
| FR-AI-13 | implemented | `AgentPromptsTest` (prefill preferred); script 20a (prefill_task_form called); AC-2.1 round-trip |
| FR-AI-14 | implemented | `AgentPromptsTest` one-proposal rule; prompt "never a chain"; C6 mirror; BE-09 decisions |
| FR-AI-15 | implemented | interrupt has `expiresAt: null` (`AgentInterruptWiringTest`); BE-09 |
| FR-AI-16 | implemented | `ResumeContractTest` cancelled/reject shapes; script 22 (no re-proposal, text acknowledgement) |
| FR-AI-17 | implemented | backend half: resume payload carries REST-verbatim result (`ResumeContractTest`); FE-12 required for UX half |
| FR-AI-18 | implemented | error-carrying resume shape documented in C6 + probe (BE-08 §4.3 unknown-assignee result JSON); `ResumeContractTest` |
| FR-AI-28 | implemented | `AgentPromptsTest` (vocabulary verbatim) |
| FR-AI-29 | implemented | `AgentPromptsTest` (ask_user rule in prompt); BE-07 decisions |
| FR-AI-30 | implemented | `AgentPromptsTest` (`context.today` reference); script 18 snapshots the supplied state |
| FR-AI-31 | implemented | `AgentPromptsTest` (explain-before-tool + honest reporting) |
| FR-S-01 | partially | backend half implemented (`AgentConfigTest` STATE_SNAPSHOT + state prompt + `AssistantMessage` minimisation of history); frontend half is FE-side |
| NFR-1 | implemented | at seed scale `/api/tasks` is a ConcurrentHashMap scan, `< 300 ms` locally — smoke-measured in script runs (no dedicated load test; see Known gaps) |
| NFR-2 | implemented | expectedVersion on every write endpoint + FR-B-20 create idempotency; script 9/10a |
| NFR-3 | implemented benchmark-wise | no `OPENAI_API_KEY` in logs; `application.yaml` default is a dummy; README warns; grep audit of `scripts/` and logs shows none |
| NFR-4 | implemented | script 23/23a; `AgentDisabledTest` |
| NFR-5 | implemented | `./gradlew test` green (437); verify script is green end-to-end |
| NFR-8 | implemented | `application.yaml` placeholders only; README documents the env-var table |
| NFR-9 | implemented | BE-06 CORS config + README table |
| NFR-10 | implemented | whole demo runs on `localhost:11434` (Ollama); script runs `--no-model` without any model |
| AC-1.1 | implemented | script 1/2/3 |
| AC-1.2 | implemented | script 5 |
| AC-1.3 | implemented | script 10/10a/10c |
| AC-1.4 | waived → FE | `?status=` clearing is a UI behaviour; the backend's clear-filters path is the unfiltered default query covered by `TaskQueryTest` |
| AC-1.5 | implemented | script 13 |
| AC-1.6 | waived → FE | AI panel is a frontend container; behind the flag the API identity is `AgentDisabledTest` + script 23 |
| AC-2.1 | partially | backend half is script 20 (prefill called, no write); form lives FE-side |
| AC-2.2 | waived → FE | form reopening/dirty rendering is FE; the backend never touches `draft` |
| AC-2.3 | partially | script 19 + BE-08 shapes; the rendered "task list card" is FE-13 |
| AC-2.4 | partially | script 21 + C6 guarantee the approval card inputs; the card itself is FE-12 |
| AC-2.5 | partially | script 22 + `ResumeContractTest`; no write occurs (backend holds no write tool) — verified by the backend's unchanged store (Verified in BE-09 via IN_REVIEW probe: resume on an interrupt **never** executes the write) |
| AC-2.6 | partially | prompt rule + `AgentPromptsTest`; the actual clarification card is FE-13's question card |
| AC-2.7 | waived → FE | the error card + banner are FE-13; backend run error is asserted via RUN_ERROR propagation (verified in `AgentConfigTest`/model probe) — UI half is FE |
| AC-2.8 | waived → FE | state-doc persistence is FE (OPEN-4: backend is stateless between runs) |
| AC-2.9 | partially | script 17/20 show the streamed event types + the envelope the FE renders from |
| AC-2.10 | partially | `STATE_DELTA` mode is wired (`AgentConfigTest` asserts emission for state changes when present; a live delta-to-UI proof is FE / BE-10 Known gap below) |
| FR-AI-03/05/06/07/08/19/20/21/22/23/24/25/26/27 and FR-S-02/03/04/05/06, NFR-6/NFR-7, AC-1.*, AC-2.2/2.7/2.8 | waived | these are frontend responsibilities (`frontend/` FE-* tasks); the backend supports them only through C1/C2/C3/C6 freezes — see `00-index.md` for the frozen shapes the frontend codes against |

**Waivers summary**
- AC-1.4 — clearing filters is a composition of the default query; covered already by `TaskQueryTest`.
- AC-1.6, AC-2.2, AC-2.7, AC-2.8 — frontend rendering concerns; backend's AI-off and stateless contract is independently pinned (script 23, `AgentDisabledTest`, BE-07).
- FR-AI-03..08, 19..27, FR-S-02..06, NFR-6..7, the "UI" ACs — owned by the FE task list; nothing on the BE side blocks them beyond the two wire fixes (C6 corrected to the shipped shape; tool names/args frozen in BE-08).

**Verification performed**
- `./gradlew test` → **BUILD SUCCESSFUL, 437 tests, 0 failures**.
- `bash scripts/verify-01.sh --no-model` (server NOT owned) → 61 passed / 7 skipped. (SKIPPED: 24, 17-22.)
- `bash scripts/verify-01.sh` (script-owned server, Ollama live) → **81 passed, 0 skipped, 0 failed**, including:
  - assertion 24 with the script-owned restart: seeded `total` remained 50 and the deterministic member id `17972521-…` still resolved after reboot;
  - assertion 23: AI off → `/api/tasks` answers 200, `/agent` answers the C1 `not-found` with 404;
  - assertion 19: the run calls `query_tasks` (`TOOL_CALL_START` with that name present) with a `TOOL_CALL_RESULT`;
  - assertion 21: `RUN_FINISHED` carries `outcome.type == "interrupt"`, one interrupt whose `metadata.arguments` names one of the four mutations;
  - assertion 22: rejection resume → the model acknowledged with text and made **no**
    `propose_task_mutation` call again.

**Known gaps**
- **NFR-1 is not enforced by a load test** — the 300 ms claim is at low concurrency on the in-memory adapter, and the script asserts correctness, not latency. Add a JMH or `wrk` gate if that matters.
- **`STATE_DELTA` (`FR-S-01`) is wired but has never been observed live** — a model run that actually changes `assistant.*` in shared state over the `gemma4:e4b` socket has not been observed. It is config-verified (`AgentConfigTest`) only.
- **Assertion 19/20/21 prompt-shaping contract is phrased for `gemma4:e4b`.** Swap the model and the directive phrasing may need a quote change; the prompts are deliberately explicit.
- **The demo store is not resettable** without a restart; the script owns its server so a restart was acceptable, but a "reset demo seed" endpoint would be a cheap add-on.
- No lint/spotless task exists in the Gradle build; the "no comments / Javadoc" convention in §5 is enforced by eye.

---

## Defect found by FE-14 session 2 — `MESSAGES_SNAPSHOT` tool calls omit `type` — 2026-10-08

Reported from the FE side (see `../spec-01-fe/HANDOFF.md`, FE-14 addendum). A live
run against `bootRun` + Ollama `gemma4:e4b` showed that `AgentConfig.buildAgent`'s
`.emitMessagesSnapshot(true)` emits an assistant tool call **without**
`"type":"function"`:

```json
{"role":"assistant","content":"","toolCalls":[
  {"id":"call_m0i3k5e8","function":{"name":"query_tasks","arguments":"…"}}]}
```

`@ag-ui/client` validates each event against `@ag-ui/core`; `ToolCallSchema.type`
is `z.literal("function")` (`schemas.js:401`), so the client throws a `ZodError`
and **aborts the run before `RUN_FINISHED`** — every tool-using run ends in the
panel's `Error` phase with no terminal state. Captured by replaying a run with
`curl` against `POST /agent`.

Cause: `com.agui.community.core.message.ToolCall` is a record `(id, function)`
with a derived `type()` accessor, and
`ag-ui-spring-server-core:4.1.0`'s `MessageMixin` registers no `ToolCall` mix-in,
so Jackson serialises only the record components.

Suggested fix (library): annotate `ToolCall.type()` with
`@JsonProperty("type")` in `sdks/community/java/ag-ui/core`, rebuild `java-core`
and the `spring` modules from the local clone, republish, restart. Stopgap:
`.emitMessagesSnapshot(false)`.

Secondary (BE-08 robustness): the model sent an array for a `String` tool param
(`q`) and the tool result carried the raw Jackson deserialisation message instead
of a structured error; normalise it per BE-08 §4.2.

### Resolution (FE-14 session 3, 2026-10-08)

The `MESSAGES_SNAPSHOT` defect above was closed with the **stopgap**: `AgentConfig`
now sets `.emitMessagesSnapshot(false)` and `AgentConfigTest.aMessagesSnapshotIsNotEmitted`
pins it. Verified live against `bootRun` + OpenCode `deepseek-v4.1-flash`: no
`MESSAGES_SNAPSHOT` is emitted and the client no longer Zod-errors.

Re-enable once the library serialises `type` on tool calls (patch
`sdks/community/java/ag-ui/core` `ToolCall` with `@JsonProperty("type")` /
add a `ToolCall` mix-in in `spring-server-core`), then drop the FE's `type`-less
handling assumption — the FE reducer already reads `toolCalls[].function` only.

Two further integration issues were fixed on the **frontend** side (not backend):
client-tool calls pause as interrupts and are now dispatched + answered via
`resume` (the backend's "pending interrupt(s) not addressed by resume" guard
proved the contract). No backend change was needed for those.

The BE-08 secondary finding (raw Jackson message for an array-vs-String tool
argument) remains open and is unaffected.
