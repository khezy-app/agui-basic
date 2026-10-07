# BE-01 — Domain model, enums and repository boundary

| | |
|---|---|
| Status | Done (2026-10-07) |
| Spec | `feature-spec/01-task-mgnt-feature-spec.md` §2, §3.4 |
| Satisfies | INV-5, FR-B-09 (data), FR-B-16, FR-B-17 |
| Depends on | — |
| Blocks | BE-02, BE-03 |
| Parallel-safe | No (root of the chain) |

## 1. Objective

A complete, framework-light domain layer: `Task`, `TaskStatus`, `TaskPriority`,
`TeamMember`, `TeamMemberRole`, `TaskQuery`, `TaskStats`, plus repository **ports** and
in-memory adapters. After this task the codebase can store and query tasks but exposes
nothing over HTTP and performs no validation.

## 2. Context you need before starting

- Repo facts: `backend/build.gradle` already has `spring-boot-starter-webmvc`, Lombok
  (optional), JUnit 5. Java 21. Package root `io.github.khezyapp.backend`.
- Only `BackendApplication.java` exists today. You are creating the first real package.
- Read `00-index.md` §2 for the pinned names — do not invent alternatives.
- `Clock` must be injectable from day one; every date computation in later tasks
  depends on it.

## 3. Scope

### 3.1 In scope

- [x] `common/PageResponse.java`
- [x] `common/ClockConfig.java` (single `Clock.systemUTC()` bean; tests override)
- [x] `domain/task/TaskStatus.java`, `TaskPriority.java`, `Task.java`
- [x] `domain/team/TeamMemberRole.java`, `TeamMember.java`
- [x] `domain/TaskQuery.java`, `TaskStats.java` (+ `TaskSortField`, `AssigneeRollup`)
- [x] `repository/TaskRepository.java`, `TeamMemberRepository.java` (ports)
- [x] `repository/InMemoryTaskRepository.java`, `InMemoryTeamMemberRepository.java`
- [x] Unit tests for every type above

### 3.2 Out of scope

- Status transition rules beyond `allowedTargets` returning the raw allowed set —
  `TaskStatusMachine` and INV-1/INV-2 live in **BE-03**. BE-01 may hard-code the
  `allowedTargets` table, but must not throw.
- Any validation, any exception types, any REST layer, any seeding.
- Any persistence library or JPA entity. Do not add a dependency.

## 4. Design

### 4.1 `Task` (record)

```java
public record Task(
    UUID id,
    String title,
    String description,
    TaskStatus status,
    TaskPriority priority,
    UUID assigneeId,
    UUID reporterId,
    LocalDate dueDate,
    BigDecimal estimateHours,
    List<String> tags,
    Instant createdAt,
    Instant updatedAt,
    long version) {}
```

- `tags` is defensively copied (`List.copyOf`) in a compact constructor and stored
  lower-cased and de-duplicated in insertion order — but **length/format validation is
  BE-03**, not here.
- No setters, no builders. Use `with…` copy helpers (`withStatus`, `withFields`) in
  BE-03, defined where they are needed.
- Do **not** add `isOverdue`/`isUnassigned` here: they are derived in `TaskPresenter`
  (BE-04) so the stored type stays clean.

### 4.2 Enums

```java
public enum TaskStatus {
    BACKLOG, TODO, IN_PROGRESS, IN_REVIEW, BLOCKED, DONE, CANCELLED;

    public String label();                                  // "In Review", "Backlog", …
    public boolean isTerminal();                            // DONE, CANCELLED
    public Set<TaskStatus> allowedTargets(boolean reopen); // OPEN-1 table, no exceptions thrown
}
```

`allowedTargets(reopen)` returns, for each status:

| status | allowed targets |
|---|---|
| `BACKLOG` | `TODO`, `CANCELLED` |
| `TODO` | `BACKLOG`, `IN_PROGRESS`, `BLOCKED`, `CANCELLED` |
| `IN_PROGRESS` | `TODO`, `IN_REVIEW`, `BLOCKED`, `CANCELLED` |
| `IN_REVIEW` | `IN_PROGRESS`, `DONE`, `TODO`, `CANCELLED` |
| `BLOCKED` | `TODO`, `IN_PROGRESS`, `CANCELLED` |
| `DONE` | `IN_REVIEW`, `CANCELLED` (never `BACKLOG` — INV-1) |
| `CANCELLED` | `reopen ? {TODO} : {}` (INV-2) |

```java
public enum TaskPriority {
    LOW, MEDIUM, HIGH, URGENT;
    public int rank();   // LOW=0 … URGENT=3
    public String label();
}
```
Sorting by `priority` means sorting by `rank()`. Wire values are the enum names.

### 4.3 `TaskQuery` (record, already normalised)

| Field | Type | Notes |
|---|---|---|
| `statuses` | `Set<TaskStatus>` | empty = no filter |
| `priorities` | `Set<TaskPriority>` | empty = no filter |
| `assigneeId` | `UUID` | null = no filter |
| `unassignedOnly` | `boolean` | wins over `assigneeId` |
| `tag` | `String` | single tag, exact match after lower-casing |
| `text` | `String` | case-insensitive substring of title **or** description; blank = no filter |
| `overdueOnly` | `boolean` | OPEN-5 semantics: `dueDate <= today` and status not terminal |
| `dueWithinDays` | `Integer` | null = no filter |
| `createdFrom`, `createdTo` | `Instant` | null = open-ended; `createdTo` inclusive |
| `sort` | `SortSpec` | nested record `{ TaskSortField field, boolean descending }` |
| `page`, `size` | `int` | `page` 0-based, `size` 1..100, default 20 |

`TaskSortField` enum: `CREATED_AT, UPDATED_AT, DUE_DATE, TITLE, PRIORITY, STATUS`
(maps to `createdAt, updatedAt, dueDate, title, priority, status`).
Null-`dueDate` sorts **last** in both directions (never first — it breaks pagination).

`TaskQuery` also exposes `boolean isEmpty()` (no filter at all) so the repository can
short-circuit, and `TaskQuery defaultQuery()`.

### 4.4 `TaskStats` (record)

```java
public record TaskStats(
    long total,
    Map<TaskStatus, Long> byStatus,       // all 7 keys always present, 0 if none
    Map<TaskPriority, Long> byPriority,   // all 4 keys always present
    List<AssigneeRollup> assignees,       // sorted by displayName (see TeamMemberService, BE-04)
    long overdueTotal,
    long dueThisWeek,                     // OPEN-6
    long unassignedTotal,
    long createdLast7Days) {}

public record AssigneeRollup(UUID memberId, String displayName,
                             long openCount, long overdueCount) {}
```
`openCount` = status not terminal. `assignees` includes members with zero tasks, so
the dashboard can show an "unassigned work" affordance per member.

### 4.5 Repository ports

```java
public interface TaskRepository {
    Task save(Task task);                                   // insert if id not present
    Optional<Task> findById(UUID id);
    List<Task> findAllById(Collection<UUID> ids);          // order NOT guaranteed
    boolean deleteById(UUID id);                            // false when absent
    PageResponse<Task> findAll(TaskQuery query);            // filtering happens HERE (FR-B-17)
    List<Task> findAll();                                  // only for stats aggregation
    long count();
}
```

`TeamMemberRepository`:

```java
public interface TeamMemberRepository {
    List<TeamMember> findAll();                 // sorted by displayName
    Optional<TeamMember> findById(UUID id);
    boolean existsById(UUID id);
}
```

### 4.6 `InMemoryTaskRepository`

- Backed by `ConcurrentHashMap<UUID, Task>`; **copy on write** (`put` of the record, not
  of a mutable object) so readers never observe a half-updated task.
- `save` with an existing id increments `version` and stamps `updatedAt` from the
  injected `Clock`. Insert stamps `version = 1`. This is the optimistic-locking
  primitive BE-03 relies on — document it in Javadoc.
- `findAll(TaskQuery)` applies every predicate, then the sort with a
  null-safe comparator, then `skip(page*size).limit(size)`, and computes
  `totalElements` from the filtered size. Implement it as a private
  `Stream<Task> matching(TaskQuery)` reused by both `findAll` and `findAll`.
- `stats()` is **not** on the port: aggregation lives in `TaskService` (BE-05) over
  `findAll()`. Keep the port minimal.

## 5. Implementation order

1. `PageResponse` + `ClockConfig`.
2. Enums with `label`, `isTerminal`, `rank`, `allowedTargets`.
3. `Task`, `TeamMember`, `TeamMemberRole` records.
4. `TaskQuery` + `TaskSortField` + `TaskStats` + `AssigneeRollup`.
5. Port interfaces.
6. In-memory adapters.
7. Tests.

Verify: `./gradlew test` green.

## 6. Tests

`TaskStatusTest`
- `allowedTargets` matches the §4.2 table for all 7 statuses, both `reopen` values.
- `DONE.allowedTargets(false)` does not contain `BACKLOG`.
- `CANCELLED.allowedTargets(false)` is empty; `(true)` is exactly `{TODO}`.

`TaskQueryTest`
- default query: empty filters, `size = 20`, `sort = CREATED_AT desc`.
- blank/whitespace `text` is normalised to "no filter".

`InMemoryTaskRepositoryTest`
- `save` insert assigns `version = 1`; second save increments to 2 and advances
  `updatedAt` (fixed `Clock` for determinism).
- `findAll` paging: 25 tasks, `size = 10` → pages of 10/10/5, `totalElements = 25`,
  `totalPages = 3`.
- `findAll` combined filters are AND; array filters are OR within themselves.
- `text` matches title or description, case-insensitively.
- `overdueOnly` excludes `DONE`/`CANCELLED` and uses `dueDate <= today` (OPEN-5).
- sort by `priority` uses rank; sort by `dueDate` puts nulls last in both directions.
- `findAllById` returns only existing ids.

`TeamMemberRepositoryTest` — `findAll` sorted by `displayName`, case-insensitive.

## 7. Definition of done

- [x] `./gradlew test` passes with the new tests, existing test still green (76 tests, 0 failed).
- [x] No new dependency added to `build.gradle`.
- [x] `allowedTargets` table matches `00-index.md` C4 character for character
      (`TaskStatusTest.printTableForTheFrontendMirror` prints C4 verbatim and asserts it).
- [x] `HANDOFF.md` entry appended.

### Deviations from this doc

- **`TeamMemberRepository.save` was added.** §4.5 lists only `findAll`/`findById`/`existsById`,
  but BE-05's `SeedDataRunner` calls `members::save`, and the seed store starts empty. It is
  the port's only mutator, so no write surface can leak by accident. BE-05 should use it and
  not add its own.
- **`InMemoryTaskRepository.save` honours a caller-supplied `createdAt`/`updatedAt` on insert.**
  The doc says "insert stamps `version = 1`" without saying whose timestamps win. BE-05 must
  backdate fixture data across 45 days, so a caller-supplied timestamp is kept on insert and
  the clock only fills the null. Overwrites always restamp `updatedAt` from the clock.
- **`TaskQuery` has a `Builder` and clamps `page`/`size`** instead of throwing. Validation with
  an HTTP status is BE-02's job; a data record that throws surprises the adapter.
- **Extra types beyond §3.1:** `domain/TaskSortField.java` (the `SortSpec` element type §4.3
  names but the file list omits) and `domain/AssigneeRollup.java` (named in §4.4 but the file
  list omits it). Both are pinned in `00-index.md` §2.1.
- `InMemoryTaskRepository.isOverdue(Task, LocalDate)` is public static so BE-04's presenter and
  BE-05's stats share one definition of overdue instead of re-deriving it.

### Test support

`backend/src/test/java/io/github/khezyapp/backend/testsupport/` — `MutableClock` (a `Clock` that
can be advanced, needed to prove `updatedAt` moves) and `TaskFixtures` (fluent `Task` builder).
Plain JUnit + AssertJ; no mocking framework is used anywhere in the suite.

## 8. Handoff report (fill this in when done, then mirror it into `HANDOFF.md`)

**Files added** …
**Decisions taken** …
**Verification** `./gradlew test` → …
**Known gaps** …
