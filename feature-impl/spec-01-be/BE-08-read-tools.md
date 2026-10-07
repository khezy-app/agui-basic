# BE-08 — Backend read tools

| | |
|---|---|
| Status | Done |
| Spec | `feature-spec/01-task-mgnt-feature-spec.md` §6.3 |
| Satisfies | FR-AI-09, FR-AI-10, FR-AI-12 (name resolution half) |
| Depends on | BE-04, BE-07 |
| Blocks | BE-09, demo script |
| Parallel-safe | No (needs the `Agent` bean from BE-07) |

## 1. Objective

Four read-only, agent-executed tools with tight JSON Schemas and small, model-friendly
outputs. After this task the agent can answer real questions about the task data
(AC-2.3) without the frontend doing anything clever.

## 2. Context you need before starting

Read `00-index.md` (§2.2, C2, C3, C4), `HANDOFF.md`, and the BE-03/BE-04/BE-07 reports.

Mechanics you must rely on (from the `ag-ui-spring-ai` README):
- Backend tools are **Spring AI `ToolCallback`s** registered on the `ChatClient`
  (or passed via `SpringAiAgent.builder(…).tools(…)`). When the model calls one, the
  agent emits `TOOL_CALL_START` / `TOOL_CALL_ARGS` / `TOOL_CALL_END`, **executes it**,
  emits `TOOL_CALL_RESULT`, then re-prompts the model — looping until it stops calling
  tools.
- Tool results become their **own** `ToolMessage` with a fresh `messageId`, so the
  frontend can render a card from that message id (FR-AI-22).
- While the agent drives the loop it suppresses the `ChatClient`'s own automatic tool
  execution, so tools registered via `defaultTools` are still executed by the agent —
  either registration style is safe. Register them in **one** place (recommended:
  `TaskReadTools.asToolCallbacks()`, passed to the agent builder).
- A backend tool must be side-effect free and must not throw raw exceptions: a thrown
  exception becomes a `TOOL_CALL_RESULT` carrying `error`, which is exactly what
  FR-AI-18 / AC-2.5 want. Validate arguments yourself and return a structured error
  rather than a stack trace.

## 3. Scope

### 3.1 In scope

- [x] `agent/TaskReadTools.java` — four `@Tool` methods
- [x] Tool argument records (no Bean Validation — arguments are validated in the method body, see HANDOFF)
- [x] Wire into `AgentConfig` (replace the BE-07 stub — the call site needed no change)
- [x] Tests for each tool, plus a tool-schema test

### 3.2 Out of scope

- Any write tool (BE-09).
- Prompt changes (BE-07 owns the prompt; only add tool names if you rename something).
- Frontend rendering of the results (FE-13).

## 4. Design

### 4.1 Method signatures

Spring AI derives the JSON Schema from the method parameters and the types, so use
dedicated record arguments with `jakarta.validation` and `@ToolParam(description = …)`
where the property module is available (check the resolved Spring AI version for
`@ToolParam`; if unavailable, put the descriptions in the `@Tool(description = …)`
text). Keep descriptions **task-shaped**, because a 3 B model reads them literally.

```java
@Component
public class TaskReadTools {

    @Tool(description = "Search tasks. Returns a page of tasks. Use this whenever you "
                      + "need to know what tasks exist; never guess task ids. "
                      + "status values: BACKLOG, TODO, IN_PROGRESS, IN_REVIEW, BLOCKED, "
                      + "DONE, CANCELLED. priority values: LOW, MEDIUM, HIGH, URGENT. "
                      + "assigneeName matches a team member display name.")
    public TaskPageResult queryTasks(
        @ToolParam(description = "free text matched against title and description") String q,
        @ToolParam(description = "repeatable status filter") List<TaskStatus> status,
        @ToolParam(description = "repeatable priority filter") List<TaskPriority> priority,
        @ToolParam(description = "team member display name") String assigneeName,
        @ToolParam(description = "true for tasks past due and not finished") Boolean overdue,
        @ToolParam(description = "true for tasks with no assignee") Boolean unassigned,
        @ToolParam(description = "due within N days from today, inclusive") Integer dueWithinDays,
        @ToolParam(description = "max results, 1..100, default 20") Integer limit) { … }

    @Tool(description = "Fetch one task by id, including its overdue flag. "
                      + "Returns an error 'not_found' when the id does not exist.")
    public TaskDetailResult getTask(@ToolParam(description = "task id") UUID taskId) { … }

    @Tool(description = "Aggregate counts for the whole workspace: totals per status and "
                      + "priority, overdue, due this week, unassigned, per-assignee rollups. "
                      + "Use this for questions like 'how much work is in review?'.")
    public StatsResult getTaskStats() { … }

    @Tool(description = "List team members (id and display name). Call this before "
                      + "referring to a person by name so you use a real id.")
    public List<MemberRef> listTeamMembers() { … }
}
```

### 4.2 Result shapes (deliberately smaller than the REST shapes)

Model context is scarce, and the frontend re-renders from these anyway (FE-13), so:

```java
public record TaskBrief(
    UUID id, String title, TaskStatus status, TaskPriority priority,
    String assignee,          // display name, or null — resolved server-side
    LocalDate dueDate, boolean overdue, List<String> tags) {}

public record TaskPageResult(List<TaskBrief> tasks, long total, int limit) {}
public record TaskDetailResult(TaskBrief brief, String description, String description2…) {}
public record StatsResult(Map<TaskStatus,Long> byStatus, long overdue, long dueThisWeek,
                          long unassigned, List<AssigneeRef> assignees) {}
public record MemberRef(UUID id, String displayName, TeamMemberRole role) {}
public record AssigneeRef(String displayName, long open, long overdue) {}
```

- `TaskPageResult` intentionally omits `page`/`totalPages`: the agent never pages, it
  filters and re-queries. Include `total` so the model can say "12 of 37".
- **Resolve `assigneeName` → `assigneeId` inside `queryTasks`** via
  `TeamMemberService.findByName`. On no match return
  `TaskPageResult` with an `error` string field set (see §4.3) — never silently drop the
  filter and return everything, which would make the model report wrong numbers.
- `limit` defaults to 20, clamps to 100, and is passed into `TaskQuery.size`. Sort is
  fixed: overdue first, then `dueDate` ascending (nulls last), then `createdAt`
  descending. Do not expose `sort` to the model — it wastes tokens and confuses small
  models.

### 4.3 Error behaviour (FR-AI-09)

Tools never throw across the boundary. Two failure channels:

| Case | Result |
|---|---|
| Bad enum / unparseable argument | return `{"error": "unknown status 'X'; allowed: …"}` |
| `getTask` with unknown id | return `{"error": "not_found", "taskId": "…"}` |
| Unknown assignee name | return `{"error": "unknown team member 'X'", "known": [names…]}` |
| Unexpected exception | return `{"error": "internal error"}` and log at WARN with the throwable (**never** the model prompt — NFR-3) |

Implement this with a small `ToolResult` wrapper (`record ToolResult(Object data, String
error)`) or by returning `Map<String,Object>`; pick one, note it, and keep every tool's
JSON shape consistent so FE-13 can render an error card generically.

### 4.4 Side-effect freedom

`queryTasks`, `getTask`, `getTaskStats`, `listTeamMembers` must not mutate the store, must
not write to shared state, and must not emit their own events. If you need to record
tool usage for debugging, use a metric/log line, never state.

## 5. Implementation order

1. Argument + result records.
2. `TaskReadTools` methods, most-read first: `listTeamMembers`, `getTask`,
   `queryTasks`, `getTaskStats`.
3. Error wrapper + unknown-`assigneeName` handling.
4. Wire into `AgentConfig`; delete the BE-07 stub.
5. Tests.

Verify: `./gradlew test` green, then a manual run:

```sh
curl -N -X POST localhost:8080/agent -H 'content-type: application/json' \
  -d '{"threadId":"t1","runId":"r1","state":{"context":{"today":"2026-01-05"}},
       "messages":[{"id":"m1","role":"user","content":"what is overdue and blocked?"}]}'
```
Expect: `TOOL_CALL_START query_tasks` → `TOOL_CALL_RESULT` with 0–n briefs → text answer.

## 6. Tests

`TaskReadToolsTest` (Spring AI tool methods are plain methods — instantiate directly
with real services and a fixed `Clock`)
- `queryTasks` with no args → default limit 20, sorted overdue-first.
- `queryTasks` with `status=[BLOCKED]` + `overdue=true` → only matching tasks; the result
  reflects the AND/OR combination of `TaskQuery`.
- `queryTasks` with `assigneeName="Ana Reyes"` → resolved to her tasks; result rows carry
  her **display name** in `assignee`, not an id.
- `queryTasks` with `assigneeName="Nobody"` → `error` field set, `known` list present,
  and **zero** tasks returned (never an unfiltered page).
- `queryTasks` `limit=500` → clamped to 100; `limit=0`/negative → clamped to 1 or
  defaulted, no exception.
- `getTask` unknown id → `error = "not_found"`.
- `getTaskStats` returns all 7 status keys zero-filled.
- `listTeamMembers` returns the 6 seeded members with stable ids.
- No method mutates: capture repository `count()` and a task's `version` before/after a
  full sweep of all four tools.

`ToolSchemaTest`
- Each tool's generated JSON Schema has a non-empty description and lists only intended
  properties. Assert `queryTasks.status.description` mentions the allowed values (the
  small-model safety net).

## 7. Definition of done

- [x] All four tools visible in the model prompt with correct names.
- [x] No tool can throw a raw exception out of the method.
- [x] `queryTasks` result rows carry display names, not ids.
- [x] Repository state unchanged by any tool call (test).
- [x] `./gradlew test` green (420 tests); `HANDOFF.md` entry appended with the manual
      transcript and the exact result JSON shapes (FE-13 needs them verbatim).

Not done as sketched, deliberately: **every tool argument is a `String`** rather than
`List<TaskStatus>` / `UUID`, because Spring AI binds arguments before the method body runs and a
bad value would escape as a `ToolExecutionException` — the exact stack-trace channel §4.3
forbids. See **Decisions taken** in the HANDOFF entry.

## 8. Handoff report

**Files added / changed** …
**Decisions taken** (result shapes, sort, error wrapper) …
**Contract changes** (tool names/args — FE-11 renders args in the approval card) …
**Verification** `./gradlew test` → …; manual curl transcript …
**Known gaps** …
