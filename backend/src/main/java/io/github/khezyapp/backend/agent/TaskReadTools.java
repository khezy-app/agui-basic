package io.github.khezyapp.backend.agent;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.ai.tool.method.MethodToolCallbackProvider;
import org.springframework.stereotype.Component;

import io.github.khezyapp.backend.common.PageResponse;
import io.github.khezyapp.backend.domain.TaskQuery;
import io.github.khezyapp.backend.domain.TaskSortField;
import io.github.khezyapp.backend.domain.TaskStats;
import io.github.khezyapp.backend.domain.task.Task;
import io.github.khezyapp.backend.domain.task.TaskPriority;
import io.github.khezyapp.backend.domain.task.TaskStatus;
import io.github.khezyapp.backend.domain.team.TeamMember;
import io.github.khezyapp.backend.service.TaskPresenter;
import io.github.khezyapp.backend.service.TaskService;
import io.github.khezyapp.backend.service.TaskStatsService;
import io.github.khezyapp.backend.service.TeamMemberService;

/**
 * The four read-only tools the agent executes itself (BE-08).
 *
 * <p>This bean is the <strong>only</strong> place backend tools are registered, and
 * {@link AgentConfig} hands {@link #asToolCallbacks()} to
 * {@code SpringAiAgent.builder(...).tools(...)}. The {@code ChatClient} deliberately
 * registers nothing itself: the agent drives the tool loop, emits the {@code TOOL_CALL_*}
 * events and executes the callbacks, so a second registration would advertise every tool to
 * the model twice.
 *
 * <h2>Why every argument is a {@code String}</h2>
 *
 * <p>BE-08 §4.1 sketched {@code List<TaskStatus> status} and {@code UUID taskId}. Both were
 * rejected. Spring AI's {@code MethodToolCallback} binds arguments <em>before</em> the method
 * body runs, so a bad enum or a malformed UUID throws a {@code ToolExecutionException}
 * carrying a Jackson message — exactly the stack-trace channel §4.3 forbids, and one the
 * model cannot recover from. Taking the raw text instead puts the failure inside the method,
 * where it becomes {@code {"error": "unknown value 'in progress'; allowed: BACKLOG, …"}}.
 * The cost is comma-separated strings instead of JSON arrays, which small models handle
 * <em>better</em> anyway, so the trade is close to free. Every conversion below is total: it
 * yields either a filter or an error string, never an exception.
 *
 * <h2>Side-effect freedom (BE-08 §4.4)</h2>
 *
 * <p>None of the four methods writes. They reach {@link TaskService} and
 * {@link TeamMemberService} through their read paths only, so a tool call cannot move a
 * task's {@code version}, add a row, or emit an event of its own.
 * {@code TaskReadToolsTest} proves it by sweeping all four tools and comparing
 * {@code count()} and every {@code version} before and after.
 *
 * <h2>Errors never cross the boundary</h2>
 *
 * <p>Each body is wrapped so that <em>any</em> unexpected throwable becomes
 * {@code {"error": "internal error"}} while the throwable goes to the server log at WARN.
 * The model never sees a stack trace (FR-AI-09) and internal detail never reaches the log
 * line the prompt produced (NFR-3).
 */
@Component
public class TaskReadTools {

    private static final Logger log = LoggerFactory.getLogger(TaskReadTools.class);

    /** No filter unless the model says otherwise; never a page big enough to flood it. */
    static final int DEFAULT_LIMIT = 20;
    static final int MAX_LIMIT = 100;

    /** Long enough for any title, short enough that a runaway model cannot blow up the store. */
    private static final int MAX_QUERY_LENGTH = 500;

    private final TaskService taskService;
    private final TaskStatsService statsService;
    private final TeamMemberService memberService;
    private final TaskPresenter presenter;

    /**
     * No {@link Clock} here: "today" is the presenter's single source (it owns the same
     * injected clock), so a tool cannot disagree with the REST badge about what is overdue.
     */
    public TaskReadTools(TaskService taskService, TaskStatsService statsService,
                         TeamMemberService memberService, TaskPresenter presenter) {
        this.taskService = taskService;
        this.statsService = statsService;
        this.memberService = memberService;
        this.presenter = presenter;
    }

    // ------------------------------------------------------------------ tools

    /**
     * The single registration point. {@link MethodToolCallbackProvider} discovers every
     * {@code @Tool} method on this bean and derives each JSON Schema from the parameter
     * names and types, including the {@code @ToolParam} descriptions — which are, for a
     * 3–4 B model, the only part of the contract it actually reads.
     */
    public List<ToolCallback> asToolCallbacks() {
        return List.of(MethodToolCallbackProvider.builder().toolObjects(this).build().getToolCallbacks());
    }

    @Tool(name = "query_tasks",
            description = "Search tasks and get back a short list of them. Call this whenever you "
                    + "need to know what tasks exist, and never guess a task id. Combine filters to "
                    + "narrow the search; two statuses mean either of them. The result comes back "
                    + "overdue tasks first, then the nearest due date. Filter values: status is "
                    + "BACKLOG, TODO, IN_PROGRESS, IN_REVIEW, BLOCKED, DONE or CANCELLED; priority "
                    + "is LOW, MEDIUM, HIGH or URGENT.")
    public ToolResults.TaskPageResult queryTasks(
            @ToolParam(required = false,
                    description = "free text matched anywhere in the title or the description, "
                            + "for example \"login\"") String q,
            @ToolParam(required = false,
                    description = "status filter, one or more of BACKLOG, TODO, IN_PROGRESS, "
                            + "IN_REVIEW, BLOCKED, DONE, CANCELLED, separated by commas") String status,
            @ToolParam(required = false,
                    description = "priority filter, one or more of LOW, MEDIUM, HIGH, URGENT, "
                            + "separated by commas") String priority,
            @ToolParam(required = false,
                    description = "filter by the display name of one team member, for example "
                            + "\"Ana Reyes\"; call list_team_members to see the real names") String assigneeName,
            @ToolParam(required = false,
                    description = "true for only tasks that are past their due date and not finished") Boolean overdue,
            @ToolParam(required = false,
                    description = "true for only tasks that nobody is assigned to") Boolean unassigned,
            @ToolParam(required = false,
                    description = "keep only tasks due within this many days from today, for example 7 "
                            + "for the coming week") Integer dueWithinDays,
            @ToolParam(required = false,
                    description = "return at most this many tasks, 1 to 100, default 20") Integer limit) {

        try {
            Parsed<TaskStatus> statuses = parseEnum(status, TaskStatus.values(), TaskStatus::valueOf);
            if (statuses.error() != null) {
                return ToolResults.TaskPageResult.failed(statuses.error(), List.of());
            }
            Parsed<TaskPriority> priorities = parseEnum(priority, TaskPriority.values(), TaskPriority::valueOf);
            if (priorities.error() != null) {
                return ToolResults.TaskPageResult.failed(priorities.error(), List.of());
            }

            if (isPresent(q) && q.length() > MAX_QUERY_LENGTH) {
                return ToolResults.TaskPageResult.failed(
                        "q is too long; search for at most " + MAX_QUERY_LENGTH + " characters", List.of());
            }
            if (dueWithinDays != null && dueWithinDays < 0) {
                return ToolResults.TaskPageResult.failed(
                        "dueWithinDays must be 0 or more, meaning days from today", List.of());
            }

            // assigneeName → assigneeId happens here, not in the query layer (FR-AI-12).
            // An unknown name is a mistake the model can fix if we name it and list the
            // real names; dropping the filter instead would return an unfiltered page that
            // it would then happily report as "your tasks".
            UUID assigneeId = null;
            if (isPresent(assigneeName)) {
                Optional<TeamMember> member = memberService.findByName(assigneeName);
                if (member.isEmpty()) {
                    return ToolResults.TaskPageResult.failed(
                            "unknown team member '" + assigneeName.trim() + "'", knownMemberNames());
                }
                assigneeId = member.get().id();
            }

            int effectiveLimit = clampLimit(limit);
            TaskQuery query = new TaskQuery.Builder()
                    .statuses(statuses.values())
                    .priorities(priorities.values())
                    .text(trimToNull(q))
                    .assigneeId(assigneeId)
                    .unassignedOnly(Boolean.TRUE.equals(unassigned))
                    .overdueOnly(Boolean.TRUE.equals(overdue))
                    .dueWithinDays(dueWithinDays)
                    // Ascending due date, nulls last. The most-overdue rows are the earliest,
                    // so asking the repository for due-date-ascending puts them inside the
                    // page. The overdue-first ordering the spec asks for is then applied to
                    // that page below, because the repository sorts by one column at a time.
                    .sort(TaskQuery.SortSpec.ascending(TaskSortField.DUE_DATE))
                    .page(0)
                    .size(effectiveLimit)
                    .build();

            PageResponse<Task> page = taskService.findAll(query);
            Map<UUID, String> names = memberNames();

            List<ToolResults.TaskBrief> briefs = page.content().stream()
                    .map(task -> brief(task, names))
                    .sorted(briefOrder())
                    .toList();

            return ToolResults.TaskPageResult.ok(briefs, page.totalElements(), effectiveLimit);
        } catch (RuntimeException ex) {
            log.warn("tool query_tasks failed with an unexpected error", ex);
            return ToolResults.TaskPageResult.failed("internal error", List.of());
        }
    }

    @Tool(name = "get_task",
            description = "Get one task in full by its id, including its description and whether it "
                    + "is overdue. Take the id from query_tasks; never invent one. If the error "
                    + "says not_found the task is gone: tell the user which id you looked for and "
                    + "do not guess another one.")
    public ToolResults.TaskDetailResult getTask(
            @ToolParam(description = "the id of the task, a uuid such as "
                    + "\"7c1f0b8e-0f3a-4a1e-9c2b-3d4e5f6a7b8c\"") String taskId) {

        try {
            String asked = trimToNull(taskId);
            if (asked == null) {
                return ToolResults.TaskDetailResult.notFound("");
            }
            UUID id;
            try {
                id = UUID.fromString(asked);
            } catch (IllegalArgumentException ex) {
                return ToolResults.TaskDetailResult.malformedId(asked);
            }

            // find(), not require(): an unknown id is an expected outcome of a model
            // producing one, not a 404.
            Optional<Task> found = taskService.find(id);
            if (found.isEmpty()) {
                return ToolResults.TaskDetailResult.notFound(id.toString());
            }
            Task task = found.get();
            return ToolResults.TaskDetailResult.ok(brief(task, memberNames()), task.description());
        } catch (RuntimeException ex) {
            log.warn("tool get_task failed with an unexpected error", ex);
            return ToolResults.TaskDetailResult.internalError(trimToNull(taskId));
        }
    }

    @Tool(name = "get_task_stats",
            description = "Counts for every task in the workspace at once: totals per status and "
                    + "per priority, plus how many are overdue, due this week and unassigned, and a "
                    + "per-person open/overdue rollup. Use this for questions about how much work "
                    + "exists, such as \"how much is in review?\" or \"who is behind?\". Use "
                    + "query_tasks when you need the tasks themselves.")
    public ToolResults.StatsResult getTaskStats() {
        try {
            TaskStats stats = statsService.compute();
            return ToolResults.StatsResult.of(
                    stats.total(),
                    stats.byStatus(),
                    stats.byPriority(),
                    stats.overdueTotal(),
                    stats.dueThisWeek(),
                    stats.unassignedTotal(),
                    stats.assignees().stream()
                            .map(rollup -> new ToolResults.AssigneeRef(
                                    rollup.displayName(), rollup.openCount(), rollup.overdueCount()))
                            .toList());
        } catch (RuntimeException ex) {
            log.warn("tool get_task_stats failed with an unexpected error", ex);
            return ToolResults.StatsResult.failed("internal error");
        }
    }

    @Tool(name = "list_team_members",
            description = "List the team members with their id and display name. Call this before "
                    + "you refer to a person by name, so you use a name that exists, and before you "
                    + "filter tasks by assignee.")
    public List<ToolResults.MemberRef> listTeamMembers() {
        try {
            return memberService.findAll().stream()
                    .map(member -> new ToolResults.MemberRef(
                            member.id(), member.displayName(), member.role()))
                    .toList();
        } catch (RuntimeException ex) {
            // The declared return type is a bare list, so there is nowhere to put an
            // `error` field. One unresolvable member list must not fail the run: log it
            // and answer empty, which the model reads as "nobody" rather than as a crash.
            log.warn("tool list_team_members failed with an unexpected error", ex);
            return List.of();
        }
    }

    // --------------------------------------------------------------- helpers

    /**
     * {@code Task} → the model's view of a task. {@code assignee} is the member's display
     * name resolved here; an id is useless to a model, a name is the thing the user said.
     * {@code overdue} delegates to BE-01's shared rule so the tool, the REST badge and the
     * {@code overdue=true} filter cannot disagree (OPEN-5).
     */
    private ToolResults.TaskBrief brief(Task task, Map<UUID, String> names) {
        return new ToolResults.TaskBrief(
                task.id(),
                task.title(),
                task.status(),
                task.priority(),
                task.assigneeId() == null ? null : names.get(task.assigneeId()),
                task.dueDate(),
                presenter.isOverdue(task),
                task.tags());
    }

    /**
     * BE-08 §4.2's fixed order: overdue first, then {@code dueDate} ascending with nulls
     * last, then id as a deterministic tiebreak.
     */
    private static Comparator<ToolResults.TaskBrief> briefOrder() {
        Comparator<LocalDate> dueDate = Comparator.nullsLast(Comparator.naturalOrder());
        return Comparator.comparing(ToolResults.TaskBrief::overdue).reversed()
                .thenComparing(ToolResults.TaskBrief::dueDate, dueDate)
                .thenComparing(ToolResults.TaskBrief::id);
    }

    /** id → display name, rebuilt per call. Six members; a cache would only add a stale path. */
    private Map<UUID, String> memberNames() {
        Map<UUID, String> names = new LinkedHashMap<>();
        for (TeamMember member : memberService.findAll()) {
            names.put(member.id(), member.displayName());
        }
        return names;
    }

    private List<String> knownMemberNames() {
        return memberService.findAll().stream().map(TeamMember::displayName).toList();
    }

    /** Default 20, clamp into {@code [1, 100]}. Zero, negatives and {@code null} default. */
    private static int clampLimit(Integer limit) {
        if (limit == null || limit < 1) {
            return DEFAULT_LIMIT;
        }
        return Math.min(limit, MAX_LIMIT);
    }

    private static boolean isPresent(String value) {
        return value != null && !value.isBlank();
    }

    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    /**
     * Comma-separated enum parsing that never throws. The error names the offending token
     * <em>and</em> the allowed set, because a model that wrote {@code "in progress"} instead
     * of {@code "IN_PROGRESS"} can only fix itself if it is told the options.
     */
    private static <E extends Enum<E>> Parsed<E> parseEnum(String raw, E[] allowed,
                                                          Function<String, E> parser) {
        if (!isPresent(raw)) {
            return new Parsed<>(Set.of(), null);
        }
        Set<E> parsed = new LinkedHashSet<>();
        for (String token : raw.split(",")) {
            String value = token.trim();
            if (value.isEmpty()) {
                continue;
            }
            try {
                parsed.add(parser.apply(value.toUpperCase(Locale.ROOT)));
            } catch (IllegalArgumentException ex) {
                return new Parsed<>(Set.of(),
                        "unknown value '" + value + "'; allowed: " + allowedValues(allowed));
            }
        }
        return new Parsed<>(parsed, null);
    }

    private static <E extends Enum<E>> String allowedValues(E[] allowed) {
        return Arrays.stream(allowed).map(Enum::name).collect(Collectors.joining(", "));
    }

    /** Either a parsed value set or an error string — never both, never neither. */
    private record Parsed<E>(Set<E> values, String error) {
    }
}
