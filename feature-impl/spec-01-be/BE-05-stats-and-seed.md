# BE-05 — Dashboard stats and seed data

| | |
|---|---|
| Status | Done — see HANDOFF.md |
| Spec | `feature-spec/01-task-mgnt-feature-spec.md` §3.3, FR-B-08 |
| Satisfies | FR-B-08, FR-B-15 |
| Depends on | BE-04 |
| Blocks | demo / frontend dashboard page |
| Parallel-safe | Yes — after BE-04 the stats half is independent of the seed half; split internally if two agents are free |

## 1. Objective

Two small, high-leverage pieces: (a) `GET /api/tasks/stats` computing every dashboard
number over the **whole** store (not the current page), and (b) an idempotent seeder
that makes every filter and every card demonstrable on first boot. After this task the
app is demoable end to end without the frontend.

## 2. Context you need before starting

Read `00-index.md` (§2.2 routes, OPEN-5, OPEN-6), `HANDOFF.md`, and the BE-01/BE-03/BE-04
reports. You need: `TaskQuery`, `TaskStats`, `AssigneeRollup`, `TaskRepository.findAll()`,
`TaskStatus.isTerminal()`, `TeamMemberRepository`, `Clock`, and whatever BE-04 decided
about the `stats` route (it may already exist as a minimal implementation).

## 3. Scope

### 3.1 In scope

- [ ] `service/TaskStatsService.java`
- [ ] `bootstrap/SeedDataRunner.java` (+ a `bootstrap/SeedDataProperties.java` if you
      want the counts configurable via `application.yaml`)
- [ ] Tests for aggregation (unit) and seeding (integration-ish, isolated repos)

### 3.2 Out of scope

- New endpoints. `/api/tasks/stats` already exists as a route.
- Profile-specific fake data, fixtures for tests beyond this task's own.
- Any change to the task schema.

## 4. Design

### 4.1 `TaskStatsService`

```java
@Service
public class TaskStatsService {
    public TaskStatsService(TaskRepository tasks, TeamMemberRepository members, Clock clock) {}
    public TaskStats compute();
}
```

Single pass over `tasks.findAll()`, one pass over `members.findAll()`.

| Field | Definition |
|---|---|
| `total` | size of the store |
| `byStatus` | count per status; **all 7 keys present**, zero-filled |
| `byPriority` | count per priority; all 4 keys present |
| `assignees` | one `AssigneeRollup` per team member, **including members with 0 tasks**, ordered by `displayName` (case-insensitive) |
| `AssigneeRollup.openCount` | their tasks with non-terminal status |
| `AssigneeRollup.overdueCount` | their tasks where `isOverdue` (same rule as `TaskPresenter` — reuse it, do not re-derive) |
| `overdueTotal` | tasks where `isOverdue` |
| `dueThisWeek` | `dueDate != null && !dueDate.isAfter(endOfCurrentWeek) && status not terminal` (OPEN-6: overdue-inclusive) |
| `unassignedTotal` | tasks with `assigneeId == null` and non-terminal status |
| `createdLast7Days` | `createdAt >= now.minus(7 days)` |

`endOfCurrentWeek` = Sunday of the current week, computed from `LocalDate.now(clock)`
using `WeekFields.ISO`. Document that in Javadoc. Never call `LocalDate.now()` directly.

Un-assigned tasks are also surfaced as a synthetic rollup row? **No** — `unassignedTotal`
covers it, and adding a fake member would confuse the frontend's assignee filter.

### 4.2 Seed data

`SeedDataRunner implements ApplicationRunner`:

```java
@Component
@Order(0)
public class SeedDataRunner implements ApplicationRunner {
    private final TaskRepository tasks;
    private final TeamMemberRepository members;
    private final Clock clock;
    private final SeedDataProperties props;   // members=6, tasks=50

    @Override public void run(ApplicationArguments args) {
        if (tasks.count() > 0) return;                 // FR-B-15 idempotency
        List<TeamMember> ms = seedMembers();
        ms.forEach(members::save);
        tasks.saveAll(seedTasks(ms));
    }
}
```

**Team members** — fixed UUIDs (literal constants in the class or in
`SeedDataProperties`, not random) so a restarted dev server keeps the same URLs:

| displayName | role |
|---|---|
| Ana Reyes | ENGINEER |
| Ben Osei | ENGINEER |
| Chloe Tan | DESIGNER |
| Dmitri Volkov | ENGINEER |
| Elena Rossi | PRODUCT_OWNER |
| Farah Nasser | QA |

**Tasks** — 40–60, generated deterministically from a `Random` seeded with a fixed long
so every developer and every CI run gets the same fixture set. Requirements:

| # | Requirement | Why |
|---|---|---|
| 1 | At least 5 tasks in each of the 7 statuses | status filter + distribution chart |
| 2 | At least 6 in each of the 4 priorities | priority filter |
| 3 | ≥ 10 overdue tasks, spread over ≥ 3 statuses including 1 `BLOCKED` | overdue filter + card |
| 4 | ≥ 8 tasks due within the next 7 days | due-soon card, `dueWithinDays` |
| 5 | ≥ 8 unassigned tasks, at least 3 non-terminal | unassigned filter + card |
| 6 | ≥ 12 tasks tagged `bug`, ≥ 8 tagged `auth`, ≥ 5 tagged `ui`, plus scattered extra tags | tag filter |
| 7 | Titles drawn from a fixed list of realistic engineering titles; ≥ 4 titles contain the word `login` | the AG-UI demo script says "mark the three login tasks in review" — **the data must support it** |
| 8 | Every `BLOCKED` task has a non-empty description mentioning the blocker | INV-3 consistency |
| 9 | `createdAt` spread over the last 45 days, `updatedAt` ≥ `createdAt` | `createdFrom/To` filter |
| 10 | `estimateHours` on ~60 % of tasks, values in {0.5, 1, 2, 3, 5, 8, 13} | filter/format display |
| 11 | At least 3 `CANCELLED` tasks and at least 2 `DONE` tasks with `dueDate` in the past (must **not** be counted overdue) | terminal-status rules |

Implementation approach: build a fixed list of 20 curated titles, then generate the
remaining tasks by cycling statuses/priorities/offsets deterministically and finally
**assert** requirements 1–11 in a static self-check that throws if the generated set
violates one (fail fast at boot; a broken demo fixture must never boot silently). Keep
that check in a test instead if you prefer — but at minimum write a test.

Config in `application.yaml`:

```yaml
app:
  seed:
    enabled: true
    members: 6
    tasks: 50
```
`enabled: false` (or an empty store that already has data) skips seeding.

## 5. Implementation order

1. `TaskStatsService` + `compute()`; wire into the existing `/stats` route.
2. `SeedDataProperties`.
3. `SeedDataRunner` — members first, then tasks.
4. The §4.2 requirement self-check as a test.
5. Integration test that boots the app, hits `/api/tasks/stats`, and asserts every
   counter is non-zero.

Verify: `./gradlew test` green, then `./gradlew bootRun` and `curl` `/api/tasks/stats`.

## 6. Tests

`TaskStatsServiceTest` (fixed `Clock`, hand-built repo contents)
- zero-filled `byStatus`/`byPriority` keys when the store is empty.
- `overdueTotal` excludes `DONE`/`CANCELLED` with past due dates.
- `dueThisWeek` is overdue-inclusive and respects the ISO week end.
- `unassignedTotal` counts only non-terminal unassigned tasks.
- `assignees` includes a member with zero tasks, sorted by displayName.
- `createdLast7Days` boundary is inclusive at exactly 7 days.

`SeedDataRunnerTest`
- running twice seeds once (`count()` stable across two invocations).
- a pre-populated store is left untouched (no new tasks, no new members).
- the generated set satisfies every §4.2 requirement row (≥ counts, `login` titles exist,
  blocked tasks have descriptions, cancelled/done past-due tasks exist).

`TaskStatsEndpointTest` (`@SpringBootTest` + `MockMvc` or a real HTTP call)
- `GET /api/tasks/stats` returns `total >= 40` with the seeded profile.

## 7. Definition of done

- [ ] `./gradlew bootRun` seeds on an empty store and skips on a non-empty one.
- [ ] `./gradlew test` green, including the seed requirements test.
- [ ] Every §4.2 requirement row is asserted somewhere.
- [ ] `HANDOFF.md` entry appended (note the fixed team-member UUIDs and the generated
      task list location so the demo script can reference them).

## 8. Handoff report

**Files added / changed** …
**Decisions taken** (seed count, ISO week end, deterministic RNG) …
**Verification** `./gradlew test` → …; `curl /api/tasks/stats` output …
**Known gaps** …
