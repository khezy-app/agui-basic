# BE-04 — REST controllers, query parsing and the list envelope

| | |
|---|---|
| Status | Done — see HANDOFF.md |
| Spec | `feature-spec/01-task-mgnt-feature-spec.md` §3.1, §3.6 |
| Satisfies | FR-B-01, FR-B-02, FR-B-09, FR-B-21, FR-B-19 (wire level) |
| Depends on | BE-03 |
| Blocks | BE-05, BE-08, and the entire frontend API client |
| Parallel-safe | No |

## 1. Objective

The complete, frozen HTTP surface for Phase 1: every endpoint in `00-index.md` §2.2,
query-parameter parsing for all `FR-B-01` filters, the `PageResponse` envelope, and the
`TaskResponse` shape with derived flags. After this task the frontend can be built
against a real API and AC-1.1/1.2/1.3/1.4/1.5 are provable with `curl`.

## 2. Context you need before starting

Read `00-index.md` (§2.2 endpoint table, C1, C2, C3, C4), `HANDOFF.md`, and the BE-01,
BE-02, BE-03 reports. In particular you need BE-03's decision about
null-vs-absent semantics in `PatchTaskCommand` — the request DTO must express the same
semantics or the frontend will mis-clear fields.

## 3. Scope

### 3.1 In scope

- [ ] `web/dto/TaskResponse.java`, `TaskCreateRequest.java`, `TaskPatchRequest.java`,
      `StatusChangeRequest.java`, `BulkStatusRequest.java`, `BulkStatusResponse.java`,
      `TeamMemberResponse.java`
- [ ] `service/TaskPresenter.java`
- [ ] `web/TaskController.java`, `web/TeamMemberController.java`
- [ ] `web/TaskQueryFactory.java` (query-param → `TaskQuery`)
- [ ] Controller slice tests

### 3.2 Out of scope

- `/stats` handler body (BE-05) — but **declare the route** so the URL is reserved and
  `GET /api/tasks/stats` cannot fall into `{id}`; throw `UnprocessableApiException`
  with a TODO-free message? No — BE-05 may run later, so map the route and return
  `501 not-implemented` is unacceptable. Instead: implement `stats` by delegating to a
  `TaskStatsService` that BE-05 fills in — create the interface here with a
  `TaskRepository.findAll()`-based default and note it in the handoff.
  Simpler and honest: **BE-05 owns the route**; in this task declare
  `@GetMapping("/stats")` and implement it as `taskService.stats()` where you add a
  minimal `stats()` to `TaskService` that aggregates correctly for the basic counters.
  BE-05 then refines. Record which you chose.
- CORS (BE-06).
- Anything AI-related.

## 4. Design

### 4.1 `TaskPresenter`

```java
@Component
public class TaskPresenter {
    public TaskPresenter(Clock clock) {}
    public TaskResponse toResponse(Task task);          // + isOverdue / isUnassigned
    public TaskResponse toResponse(Task task, Map<UUID,TeamMember> members);  // names resolved
}
```
- `isOverdue` = `dueDate != null && dueDate.isBefore(LocalDate.now(clock))` and status
  not terminal. Note: strictly `isBefore` today (spec: "earlier than today"), whereas
  the `overdue` *filter* uses `<= today` (OPEN-5). Keep both and comment why they
  differ — or align them to `<=` and update OPEN-5 in `00-index.md`. Pick one, record
  it. **Recommendation:** align both to `<= today` (a task due today is not overdue in
  human terms, so `<` for the flag and `<=` for the filter is actually *correct* —
  keep as spec'd and note it in Javadoc).
- `isUnassigned` = `assigneeId == null`.
- Never let a client set either flag: they are not present in any request DTO, and
  strict Jackson (BE-02) rejects them with 422 (FR-B-19).

### 4.2 `TaskResponse` (wire shape — must equal C3 exactly)

```java
public record TaskResponse(
    UUID id, String title, String description,
    TaskStatus status, TaskPriority priority,
    UUID assigneeId, UUID reporterId,
    LocalDate dueDate, BigDecimal estimateHours, List<String> tags,
    Instant createdAt, Instant updatedAt, long version,
    boolean isOverdue, boolean isUnassigned) {}
```

### 4.3 Request DTOs

| DTO | Fields | Validation annotations | Notes |
|---|---|---|---|
| `TaskCreateRequest` | `title, description, status, priority, assigneeId, reporterId, dueDate, estimateHours, tags` | `@NotBlank @Size(max=160)` title, `@Size(max=4000)` description, `@Size(max=5)` tags | These annotations give the 400 before the service runs; the service re-validates. Do **not** put `@NotNull` on status/priority — they have defaults |
| `TaskPatchRequest` | same minus `status` | same as create but all optional | Sending `status` here → 422 from strict Jackson (FR-B-04 wording is "rejects"; a 422 is acceptable — document it). If BE-03 decided "null means unchanged", add a Javadoc line stating that `description: null` clears the description only if BE-03 supports it |
| `StatusChangeRequest` | `TaskStatus status, boolean reopen, Long expectedVersion` | `@NotNull status` | |
| `BulkStatusRequest` | `List<UUID> ids, TaskStatus status, boolean reopen, Map<UUID,Long> expectedVersions` | `@NotEmpty @Size(max=100) ids`, `@NotNull status` | `reopen` included because the frontend bulk card may reopen cancelled tasks (INV-2) |
| `BulkStatusResponse` | `int updated, List<TaskResponse> tasks` | | |
| `TeamMemberResponse` | `UUID id, String displayName, String email, TeamMemberRole role` | | |

### 4.4 `TaskQueryFactory`

```java
@Component
public class TaskQueryFactory {
    public TaskQuery from(List<TaskStatus> status, List<TaskPriority> priority,
                          UUID assigneeId, Boolean unassigned, String tag, String q,
                          Boolean overdue, Integer dueWithinDays,
                          LocalDate createdFrom, LocalDate createdTo,
                          String sort, Integer page, Integer size);
}
```

Parsing rules:

| Param | Rule | Bad input |
|---|---|---|
| `status`, `priority` | repeatable; blank entries dropped; unknown value | 422 `unprocessable` naming the bad value |
| `unassigned`, `overdue` | `true`/`false` only; `true` is the only truthy form | 422 |
| `q` | trimmed, blank → no filter | — |
| `tag` | trimmed + lowercased | — |
| `dueWithinDays` | ≥ 0 | 400 field `dueWithinDays` |
| `createdFrom`, `createdTo` | `yyyy-MM-dd`; `createdFrom` → start of day, `createdTo` → **end** of day (inclusive) | 422 |
| `sort` | `field` or `-field`; unknown field | 422 naming allowed fields |
| `page` | ≥ 0 | 400 |
| `size` | 1..100, default 20 | 400 |

`createdFrom`/`createdTo` arrive as `LocalDate` via `@DateTimeFormat(iso = ISO.DATE)`;
the factory converts to `Instant` using the `Clock`'s zone.

### 4.5 `TaskController`

```java
@RestController
@RequestMapping("/api/tasks")
public class TaskController {

    @GetMapping                       PageResponse<TaskResponse> list(…all filters…)
    @GetMapping("/stats")             TaskStats stats()            // literal, declared first
    @PostMapping                      ResponseEntity<TaskResponse> create(@Valid @RequestBody TaskCreateRequest)
    @PostMapping("/bulk-status")      BulkStatusResponse bulk(@Valid @RequestBody BulkStatusRequest)
    @GetMapping("/{id}")              TaskResponse get(@PathVariable UUID id)
    @PatchMapping("/{id}")            TaskResponse patch(@PathVariable UUID id,
                                            @RequestParam(required=false) Long expectedVersion,
                                            @Valid @RequestBody TaskPatchRequest)
    @DeleteMapping("/{id}")           ResponseEntity<Void> delete(@PathVariable UUID id,
                                            @RequestParam(defaultValue = "false") boolean force)
    @PostMapping("/{id}/status")      TaskResponse status(@PathVariable UUID id,
                                            @Valid @RequestBody StatusChangeRequest)
}
```

- `create` returns **201** with `Location: /api/tasks/{id}`.
- `delete` returns **204** with an empty body.
- `POST /status` with an **identical** current status is a 200 no-op (BE-03 semantics),
  not a 400.
- `UUID` path variables that are not UUIDs produce a 400 (`MethodArgumentTypeMismatch`
  → BE-02 maps 422; decide and document — **recommend 400** for a malformed path id
  because it is a client typo, and add a `@ExceptionHandler` in `TaskController` for
  `MethodArgumentTypeMismatchException` overriding the global 422).
- Add `Cache-Control: no-store` on `/api/tasks/stats`? Not needed. Skip.

`TeamMemberController`: `GET /api/team-members` → `List<TeamMemberResponse>` sorted by
`displayName`, `200`.

## 5. Implementation order

1. DTO records + annotations.
2. `TaskPresenter` (+ `isOverdue` decision).
3. `TaskQueryFactory` + tests.
4. `TaskController` list + get.
5. `TaskController` create + patch + delete + status + bulk.
6. `TeamMemberController`.
7. `stats` route (minimal or full — see §3.2).
8. Slice tests.

Verify: `./gradlew test` green, then manual `curl` smoke (§7).

## 6. Tests

`TaskQueryFactoryTest` (unit)
- defaults; unknown enum value → 422; `sort=-dueDate` → `DUE_DATE` descending; blank `q`
  dropped; `size=101` → 400; `createdTo` expands to end of day.

`TaskControllerTest` (`@WebMvcTest(TaskController.class)` with a mocked `TaskService` +
real `ApiExceptionHandler`)
- `GET /api/tasks?status=TODO&status=BLOCKED&size=5&sort=-dueDate` → 200, service
  received a `TaskQuery` with 2 statuses, size 5, DUE_DATE desc.
- `GET /api/tasks/{id}` unknown → 404 body equals the C1 envelope.
- `POST /api/tasks` valid → 201 + `Location`.
- `POST /api/tasks` with `"id"` in the body → 422 (FR-B-19).
- `PATCH` with `"status"` in the body → 422 (FR-B-04).
- `DELETE` → 204 with empty body.
- `POST /status` illegal → 409 with `type` ending `illegal-transition` and the allowed
  targets in `detail` (AC-1.3).
- `POST /bulk-status` one illegal target → 409, nothing written (assert via mock
  verification), `errors[0].field == "ids[1]"` (AC-1.5).
- `GET /api/tasks/stats` → 200 JSON with all four headline counters (never routed into
  `{id}`).

## 7. Definition of done

- [ ] `./gradlew test` green.
- [ ] `curl` smoke passes (record the commands and outputs in the handoff):
  - `curl -s 'localhost:8080/api/tasks?size=2&sort=-createdAt' | jq '.totalElements,.page,.size'`
  - `curl -si -X POST localhost:8080/api/tasks -d '{"title":"","priority":"NOPE"}' -H 'content-type: application/json'`
  - `curl -s localhost:8080/api/team-members | jq 'length'`
- [ ] Response shapes byte-match C2 and C3.
- [ ] `HANDOFF.md` entry appended, stating the malformed-UUID status choice and the
      `stats` scope choice.

## 8. Handoff report

**Files added / changed** …
**Decisions taken** …
**Contract changes** (any wire deviation → also edit `00-index.md` §2.2/C1–C3) …
**Verification** `./gradlew test` → …; curl outputs …
**Known gaps** …
