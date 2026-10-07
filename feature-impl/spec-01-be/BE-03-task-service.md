# BE-03 — TaskService: the single write path

| | |
|---|---|
| Status | Done — see HANDOFF.md |
| Spec | `feature-spec/01-task-mgnt-feature-spec.md` §2.1, §2.3, §3.1 (write endpoints' semantics) |
| Satisfies | FR-B-03, FR-B-04, FR-B-05, FR-B-06, FR-B-07, FR-B-18, FR-B-19, FR-B-20, INV-1..5, NFR-2 |
| Depends on | BE-01, BE-02 |
| Blocks | BE-04, BE-08, BE-09 |
| Parallel-safe | No |

## 1. Objective

Every mutation of a task happens here — REST controllers and any future AI tool alike
(FR-B-18). This task defines all field validation, the canonical status-transition
table with INV-1/INV-2/INV-3, derived-flag computation, optimistic locking, idempotent
create, and all-or-nothing bulk status change. No HTTP types are involved; the service
speaks domain records.

## 2. Context you need before starting

Read, in order: `00-index.md` (names §2, contracts C1/C3/C4, OPEN-1/2/5), `HANDOFF.md`,
BE-01's report, BE-02's report, and the two BE task docs.

Available from BE-01: `Task`, `TaskStatus` (incl. `allowedTargets`, `isTerminal`,
`label`), `TaskPriority`, `TaskQuery`, `TaskRepository`, `InMemoryTaskRepository`
(insert → `version = 1`; update → `version + 1`, `updatedAt` from `Clock`).
Available from BE-02: `ValidationApiException`, `NotFoundApiException`,
`ConflictApiException` (+ `illegalTransition`, `versionConflict` factories),
`UnprocessableApiException`.

Decisions already made that you must not re-litigate:
- Validation lives in the service (BE-04 only mirrors it in Bean Validation annotations
  for documentation/early 400s).
- Errors are typed exceptions only.
- `Clock` is injected; never call `now()` statically.

## 3. Scope

### 3.1 In scope

- [ ] `service/TaskStatusMachine.java`
- [ ] `service/TaskService.java`
- [ ] `service/TaskValidator.java` (field rules, §4.2)
- [ ] `service/TeamMemberService.java` (existence check + name resolution)
- [ ] Unit tests for each

### 3.2 Out of scope

- HTTP: no controllers, no DTOs, no `@RequestParam` parsing (BE-04).
- Stats aggregation (BE-05, but `stats()` skeleton on `TaskService` may be left out
  entirely — BE-05 adds it).
- Seeding (BE-05).

## 4. Design

### 4.1 `TaskStatusMachine`

The single authority for legality (OPEN-1). Pure, static, no Spring.

```java
public final class TaskStatusMachine {
    public static final TaskStatus DEFAULT_STATUS = TaskStatus.TODO;
    public static final TaskPriority DEFAULT_PRIORITY = TaskPriority.MEDIUM;

    public static boolean isLegal(TaskStatus from, TaskStatus to, boolean reopen);
    public static Set<TaskStatus> allowedTargets(TaskStatus from, boolean reopen);
    public static void validate(Task task, TaskStatus target, boolean reopen); // throws ConflictApiException.illegalTransition
}
```

`validate` failure message must be actionable, because the UI shows it verbatim
(FR-F-08 / AC-1.3):

> `IN_REVIEW` → `BACKLOG` is not allowed. Allowed targets from `IN_REVIEW`: `IN_PROGRESS`, `DONE`, `TODO`, `CANCELLED`.

Rules, in evaluation order (the **first** failure wins, so messages are deterministic):

| # | Rule | Exception |
|---|---|---|
| 1 | `target == current` → no-op success (return task unchanged, still bump nothing) | — |
| 2 | `current == CANCELLED && !reopen` → `illegal-transition` ("must be reopened explicitly") | 409 |
| 3 | `reopen == true && target != TODO` → 400 `validation-failed` on field `reopen` | 400 |
| 4 | `!isLegal(current, target, reopen)` | 409 `illegal-transition` |
| 5 | `target == BLOCKED && (description == null \|\| blank)` → 400, field `description`, message "a blocked task must describe the blocker" | 400 |

`isLegal` delegates to `TaskStatus.allowedTargets(reopen)` from BE-01 — do not
re-declare the table.

### 4.2 `TaskValidator`

```java
@Component
public class TaskValidator {
    public void validateNew(String title, String description, TaskPriority priority,
                            UUID assigneeId, UUID reporterId, LocalDate dueDate,
                            BigDecimal estimateHours, List<String> tags);
    public void validatePatch(...);        // same checks on the merged result
    public static void collectTagErrors(List<String> tags, List<FieldError> sink);
}
```
Rules (collect **all** violations into a `List<FieldError>`, then throw one
`ValidationApiException` — never fail on the first field):

| Field | Rule | `field` path | message |
|---|---|---|---|
| title | not blank after trim | `title` | `must not be blank` |
| title | ≤ 160 chars | `title` | `must be at most 160 characters` |
| description | ≤ 4000 chars | `description` | `must be at most 4000 characters` |
| estimateHours | 0 ≤ v ≤ 999 | `estimateHours` | `must be between 0 and 999` |
| estimateHours | scale ≤ 1 | `estimateHours` | `must have at most 1 decimal place` |
| tags | ≤ 5 entries | `tags` | `must contain at most 5 entries` |
| tags[i] | 1..24 chars | `tags[i]` | `must be 1–24 characters` |
| assigneeId | must exist | `assigneeId` | `unknown team member` |
| reporterId | must exist | `reporterId` | `unknown team member` |
| status | never settable here | `status` | `status cannot be changed via field update` (400) |

Normalisation (do this **before** validating so checks are stable): trim strings,
lowercase tags, de-duplicate tags preserving first-seen order, `null` description →
`null`, `tags == null` → empty list.

### 4.3 `TaskService`

```java
@Service
public class TaskService {
    public TaskService(TaskRepository tasks, TeamMemberRepository members,
                       TaskValidator validator, Clock clock) { … }

    public Task create(CreateTaskCommand cmd);            // record, all nullable except title
    public Task patch(UUID id, PatchTaskCommand cmd, Long expectedVersion);
    public void delete(UUID id, boolean force);
    public Task changeStatus(UUID id, TaskStatus target, boolean reopen, Long expectedVersion);
    public BulkOutcome bulkChangeStatus(BulkStatusCommand cmd);   // all-or-nothing
    public Task require(UUID id);                          // throws NotFoundApiException
    public PageResponse<Task> findAll(TaskQuery query);     // thin delegate
    public Optional<Task> find(UUID id);
}
```

Command records (nested in `TaskService` or as separate `service/command/*.java` —
pick one and note it): `CreateTaskCommand(title, description, status, priority,
assigneeId, reporterId, dueDate, estimateHours, tags)`, `PatchTaskCommand(title,
description, priority, assigneeId, reporterId, dueDate, estimateHours, tags)` where
every field is nullable and **absent-vs-null is not distinguishable** — a null field
means "leave unchanged". This is a deliberate limitation: clearing a nullable field
to null uses the JSON `null` in `PATCH`, which maps to "clear"; a *missing* key and an
explicit `null` are indistinguishable in a Java record without `Optional`/`JsonNullable`.
**Decision required** → use `JsonNullable`-style wrapper only if BE-04 needs it;
otherwise document that `PATCH` treats null as "leave unchanged" and clearing a field
is done by sending an empty string / empty list / `null` for `description` only. Record
your choice in the handoff and mirror it into `00-index.md` §6 as a new OPEN entry.

Behaviour per method:

**`create`**
1. Normalise + validate (§4.2). Reject `id`, `version`, `createdAt`, `updatedAt`,
   `isOverdue`, `isUnassigned` appearing in the command object → `UnprocessableApiException`
   naming the field (FR-B-19). Because commands are typed, express this by a
   `create(CreateTaskCommand, Map<String,Object> rawExtras)` overload used only by the
   AI/tool path — or, if BE-04 owns that check, document that the check lives there.
2. Apply defaults: `status = TODO` unless supplied **and** legal from a virtual `null`
   state (any status is legal on create — including `BLOCKED`, which then requires a
   description via rule 5), `priority = MEDIUM`.
3. Idempotency (FR-B-20): if `title` (trimmed, case-insensitive) **and** status
   **and** assigneeId all match an existing task created within the last 5 seconds,
   return that task instead of creating a duplicate. Make the window configurable via
   a constructor-injected `Duration` defaulting to 5 s, driven by the injected `Clock`.
4. Build `Task` with `id = UUID.randomUUID()`, `version` from the repository, both
   timestamps from `Clock`.

**`patch`**
1. Load or 404. If `expectedVersion != null && expectedVersion != current` → 409
   `version-conflict`.
2. Reject `status` presence → 400 field `status` (FR-B-04).
3. Merge, normalise, validate the merged result, save. `updatedAt` and `version` come
   from the repository.

**`delete`**
1. Load or 404.
2. `force == false` and the task is referenced by nothing → still allowed: the backend
   never consults AI state (OPEN-4). `force` exists for API symmetry; document that.
3. `deleteById`; return void.

**`changeStatus`**
1. Load or 404; optimistic-lock check.
2. `TaskStatusMachine.validate(task, target, reopen)`.
3. Save.

**`bulkChangeStatus`** — all-or-nothing (AC-1.5):
1. Reject an empty `ids` list → 400 field `ids`.
2. Load all ids; any missing → 404 whose `detail` names the missing ids.
3. Optimistic-lock check per id when `expectedVersions` is supplied.
4. Validate every transition **before** writing anything; collect all failures and
   throw **one** `ConflictApiException` whose `detail` lists each offending
   `title (CURRENT → TARGET): reason` line and whose `errors` carry
   `field = ids[<index>]`.
5. Only then save all; return `BulkOutcome(int updated, List<Task> tasks)`.
6. Idempotent: ids already at `target` are skipped, not errors, and not double-bumped.

### 4.4 `TeamMemberService`

```java
@Service
public class TeamMemberService {
    public List<TeamMember> findAll();
    public TeamMember require(UUID id);                                  // 404
    public Optional<TeamMember> findByName(String name);                // case-insensitive exact, then displayName contains
    public Optional<TeamMember> findByEmail(String email);
}
```
Used by FE-facing `/api/team-members` (BE-04) and by the AI name→id resolution
(FR-AI-12).

## 5. Implementation order

1. `TeamMemberService`.
2. `TaskStatusMachine` + its test table.
3. `TaskValidator` + tests for each rule.
4. `TaskService.create` + `patch`.
5. `TaskService.changeStatus`.
6. `TaskService.bulkChangeStatus`.
7. `TaskService.delete`.
8. Full test pass.

Verify: `./gradlew test` green.

## 6. Tests

`TaskStatusMachineTest` — a `@ParameterizedTest` over every `(from, to)` pair
asserting legality matches the C4 table; plus rule 2, rule 3, rule 5 explicitly, and
the exact wording of the 409 `detail`.

`TaskValidatorTest` — one case per row of the §4.2 table; multi-error case asserting
two violations arrive in one exception and that field order is deterministic.

`TaskServiceTest` (with fixed `Clock` + in-memory repositories)
- create: defaults applied; `version = 1`; `createdAt == updatedAt`.
- create: idempotent repeat within 5 s returns the same id; outside the window creates a
  second task.
- create: rejects server-owned fields when passed as raw extras (FR-B-19).
- create with `status = BLOCKED` and no description → 400 on `description`.
- patch: null field leaves value unchanged; empty `tags` clears tags; `status` present
  → 400.
- patch: `expectedVersion` mismatch → 409 `version-conflict`; correct version succeeds.
- delete: absent id → 404.
- changeStatus: legal, illegal (409 with allowed-targets text), CANCELLED→TODO without
  `reopen` → 409, CANCELLED→TODO with `reopen` → 200 lands on TODO, `reopen` with a
  non-TODO target → 400, no-op same-status → unchanged version.
- bulk: all valid → all updated; one illegal → nothing changed and the message names
  the offending task (AC-1.5); missing id → 404; mixed already-at-target ids are
  skipped without bumping `version`.

## 7. Definition of done

- [ ] No static `now()` / `LocalDate.now()` anywhere in `service/`.
- [ ] `allowedTargets` in `TaskStatusMachine` is the only transition table in the code.
- [ ] Every §4.2 validation row has a test; multi-error collection works.
- [ ] Optimistic-lock conflicts are distinguishable by marker for the frontend.
- [ ] `./gradlew test` green; `HANDOFF.md` entry appended, including the null-vs-absent
      decision recorded as a new OPEN row in `00-index.md`.

## 8. Handoff report

**Files added / changed** …
**Decisions taken** (command records location, null-vs-absent semantics, idempotency window) …
**Contract changes** …
**Verification** `./gradlew test` → …
**Known gaps** …
