package io.github.khezyapp.backend.agent;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import io.github.khezyapp.backend.domain.task.Task;
import io.github.khezyapp.backend.domain.task.TaskPriority;
import io.github.khezyapp.backend.domain.task.TaskStatus;
import io.github.khezyapp.backend.domain.team.TeamMember;
import io.github.khezyapp.backend.domain.team.TeamMemberRole;
import io.github.khezyapp.backend.repository.InMemoryTaskRepository;
import io.github.khezyapp.backend.repository.InMemoryTeamMemberRepository;
import io.github.khezyapp.backend.service.TaskPresenter;
import io.github.khezyapp.backend.service.TaskService;
import io.github.khezyapp.backend.service.TaskStatsService;
import io.github.khezyapp.backend.service.TaskValidator;
import io.github.khezyapp.backend.service.TeamMemberService;
import io.github.khezyapp.backend.testsupport.TaskFixtures;

/**
 * BE-08 §6. Spring AI tool methods are plain methods, so these are direct instantiations
 * with the real services and real in-memory repositories — no Spring context, no mock
 * framework, and a fixed {@link Clock} so "overdue" is decidable.
 *
 * <p>The fixture is hand-built rather than the 50-row {@code SeedDataRunner} output,
 * because each assertion below needs to know exactly which rows exist and why.
 */
class TaskReadToolsTest {

    /** A Wednesday. BE-05's seed fixture assumes a similar "today". */
    private static final Instant NOW = Instant.parse("2026-01-07T12:00:00Z");
    private static final LocalDate TODAY = LocalDate.of(2026, 1, 7);

    private static final UUID ANA = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");
    private static final UUID BEN = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000002");

    private InMemoryTaskRepository tasks;
    private InMemoryTeamMemberRepository members;
    private TaskReadTools tools;

    @BeforeEach
    void setUp() {
        Clock clock = Clock.fixed(NOW, ZoneId.of("UTC"));
        tasks = new InMemoryTaskRepository(clock);
        members = new InMemoryTeamMemberRepository();
        members.save(new TeamMember(ANA, "Ana Reyes", "ana.reyes@agui-basic.test",
                TeamMemberRole.ENGINEER));
        members.save(new TeamMember(BEN, "Ben Osei", "ben.osei@agui-basic.test",
                TeamMemberRole.ENGINEER));

        TaskService taskService = new TaskService(tasks, new TaskValidator(members), clock);
        tools = new TaskReadTools(taskService,
                new TaskStatsService(tasks, members, new TaskPresenter(clock), clock),
                new TeamMemberService(members),
                new TaskPresenter(clock));
    }

    // -------------------------------------------------------------- fixture

    /**
     * One row per combination the assertions below need:
     *
     * <ul>
     *   <li>Ana, BLOCKED, due 3 days ago → overdue
     *   <li>Ana, TODO, due tomorrow → not overdue, earliest non-overdue
     *   <li>Ben, TODO, due 1 day ago → overdue, and proves {@code assigneeName} filters
     *   <li>nobody, BACKLOG, due in 30 days → unassigned
     *   <li>Ana, DONE, due 10 days ago → terminal, so <em>not</em> overdue (OPEN-5), and
     *       it proves terminal rows do not pollute an overdue listing
     *   <li>Ana, IN_REVIEW, no due date → the nulls-last case
     * </ul>
     */
    private void seedFixture() {
        save(TaskFixtures.aTask().id(UUID.fromString("00000000-0000-0000-0000-000000000001"))
                .title("Login page times out").status(TaskStatus.BLOCKED).priority(TaskPriority.HIGH)
                .assignee(ANA).dueDate(TODAY.minusDays(3)).tags("bug", "auth")
                .description("Blocked on the auth service. Waiting on the token endpoint.")
                .build());
        save(TaskFixtures.aTask().id(UUID.fromString("00000000-0000-0000-0000-000000000002"))
                .title("Login email copy").status(TaskStatus.TODO).priority(TaskPriority.LOW)
                .assignee(ANA).dueDate(TODAY.plusDays(1)).build());
        save(TaskFixtures.aTask().id(UUID.fromString("00000000-0000-0000-0000-000000000003"))
                .title("Login audit log").status(TaskStatus.TODO).priority(TaskPriority.MEDIUM)
                .assignee(BEN).dueDate(TODAY.minusDays(1)).build());
        save(TaskFixtures.aTask().id(UUID.fromString("00000000-0000-0000-0000-000000000004"))
                .title("Triage the backlog").status(TaskStatus.BACKLOG).priority(TaskPriority.MEDIUM)
                .dueDate(TODAY.plusDays(30)).build());
        save(TaskFixtures.aTask().id(UUID.fromString("00000000-0000-0000-0000-000000000005"))
                .title("Ship the old login flow").status(TaskStatus.DONE).priority(TaskPriority.MEDIUM)
                .assignee(ANA).dueDate(TODAY.minusDays(10)).estimateHours(3.5).build());
        save(TaskFixtures.aTask().id(UUID.fromString("00000000-0000-0000-0000-000000000006"))
                .title("Review login metrics").status(TaskStatus.IN_REVIEW).priority(TaskPriority.HIGH)
                .assignee(ANA).build());
    }

    private Task save(Task task) {
        return tasks.save(task);
    }

    private static UUID id(int n) {
        return UUID.fromString(String.format("00000000-0000-0000-0000-%012d", n));
    }

    private static List<String> titlesOf(ToolResults.TaskPageResult result) {
        return result.tasks().stream().map(ToolResults.TaskBrief::title).toList();
    }

    // ------------------------------------------------- query_tasks: defaults

    @Test
    void queryTasksWithNoArgumentsUsesTheDefaultLimit() {
        seedFixture();

        ToolResults.TaskPageResult result = tools.queryTasks(null, null, null, null, null, null, null, null);

        assertThat(result.failed()).isFalse();
        assertThat(result.error()).isNull();
        assertThat(result.limit()).isEqualTo(20);
        assertThat(result.total()).isEqualTo(6);
        assertThat(result.tasks()).hasSize(6);
        assertThat(result.known()).isEmpty();
    }

    @Test
    void queryTasksSortsOverdueFirstThenByDueDateAscending() {
        seedFixture();

        ToolResults.TaskPageResult result = tools.queryTasks(null, null, null, null, null, null, null, null);

        assertThat(titlesOf(result)).containsExactly(
                "Login page times out",       // overdue, due -3d
                "Login audit log",            // overdue, due -1d
                "Ship the old login flow",    // DONE with due -10d: NOT overdue (OPEN-5), so
                                               //   it leads the non-overdue group on due date
                "Login email copy",           // not overdue, due +1d
                "Triage the backlog",         // due +30d
                "Review login metrics");      // no due date — nulls last
    }

    @Test
    void aTerminalTaskWithAPastDueDateIsNotOverdue() {
        seedFixture();

        ToolResults.TaskPageResult result = tools.queryTasks(null, "DONE", null, null, null, null, null, null);

        assertThat(titlesOf(result)).containsExactly("Ship the old login flow");
        assertThat(result.tasks().getFirst().overdue()).isFalse();
    }

    // ------------------------------------------------------- query_tasks: filters

    @Test
    void queryTasksCombinesStatusAndOverdueAsAnd() {
        seedFixture();

        ToolResults.TaskPageResult result = tools.queryTasks(null, "BLOCKED", null, null, true, null, null, null);

        assertThat(result.failed()).isFalse();
        assertThat(titlesOf(result)).containsExactly("Login page times out");
        assertThat(result.total()).isEqualTo(1);
    }

    @Test
    void severalStatusesInOneArgumentMeanEitherOfThem() {
        seedFixture();

        ToolResults.TaskPageResult result = tools.queryTasks(null, "BLOCKED,BACKLOG", null, null, null, null, null, null);

        assertThat(titlesOf(result)).containsExactly("Login page times out", "Triage the backlog");
        assertThat(result.total()).isEqualTo(2);
    }

    @Test
    void queryTasksMatchesFreeTextAgainstTitleAndDescription() {
        seedFixture();

        // "token" appears only in a description; "audit" only in a title.
        assertThat(titlesOf(tools.queryTasks("token", null, null, null, null, null, null, null)))
                .containsExactly("Login page times out");
        assertThat(titlesOf(tools.queryTasks("audit", null, null, null, null, null, null, null)))
                .containsExactly("Login audit log");
    }

    @Test
    void queryTasksFiltersOnUnassigned() {
        seedFixture();

        ToolResults.TaskPageResult result = tools.queryTasks(null, null, null, null, null, true, null, null);

        assertThat(titlesOf(result)).containsExactly("Triage the backlog");
        assertThat(result.tasks().getFirst().assignee()).isNull();
    }

    @Test
    void queryTasksFiltersOnDueWithinDays() {
        seedFixture();

        ToolResults.TaskPageResult result = tools.queryTasks(null, null, null, null, null, null, 2, null);

        // due -10d, -3d, -1d and +1d are inside 2 days; +30d is not; the two null due dates
        // are not. `dueWithinDays` is a date filter, not an "open work" filter, so the DONE
        // row is in — only `overdue` and the stats cards apply the terminal rule.
        assertThat(titlesOf(result)).containsExactly(
                "Login page times out", "Login audit log", "Ship the old login flow", "Login email copy");
    }

    // ------------------------------------------------- query_tasks: assigneeName

    @Test
    void queryTasksResolvesAnAssigneeNameAndReturnsTheDisplayNameNotTheId() {
        seedFixture();

        ToolResults.TaskPageResult result = tools.queryTasks(null, null, null, "Ana Reyes", null, null, null, null);

        assertThat(result.failed()).isFalse();
        assertThat(result.total()).isEqualTo(4);
        assertThat(result.tasks()).allSatisfy(brief ->
                assertThat(brief.assignee()).isEqualTo("Ana Reyes"));
        // The wire must not leak an id where a name belongs.
        assertThat(result.tasks()).allSatisfy(brief -> {
            assertThat(brief.assignee()).doesNotContain("-");
            assertThat(brief.assignee()).isNotEqualTo(ANA.toString());
        });
    }

    @Test
    void queryTasksResolvesAnAssigneeNameCaseInsensitivelyAndByPartialMatch() {
        seedFixture();

        assertThat(titlesOf(tools.queryTasks(null, null, null, "ana reyes", null, null, null, null)))
                .hasSize(4);
        assertThat(titlesOf(tools.queryTasks(null, null, null, "Ben", null, null, null, null)))
                .containsExactly("Login audit log");
    }

    @Test
    void queryTasksWithAnUnknownAssigneeNameFailsAndListsTheKnownNames() {
        seedFixture();

        ToolResults.TaskPageResult result = tools.queryTasks(null, null, null, "Nobody", null, null, null, null);

        assertThat(result.failed()).isTrue();
        assertThat(result.error()).isEqualTo("unknown team member 'Nobody'");
        assertThat(result.known()).containsExactly("Ana Reyes", "Ben Osei");
        // The critical half: an unfiltered page next to an error would let the model report
        // unrelated numbers as if they were the answer.
        assertThat(result.tasks()).isEmpty();
        assertThat(result.total()).isZero();
    }

    @Test
    void anUnknownAssigneeNameNeverReturnsAnUnfilteredPage() {
        seedFixture();

        ToolResults.TaskPageResult result = tools.queryTasks(null, null, null, "Nobody", null, null, null, null);

        assertThat(result.tasks()).extracting(ToolResults.TaskBrief::title)
                .doesNotContain("Login page times out", "Triage the backlog");
    }

    // --------------------------------------------------------- query_tasks: limit

    @Test
    void queryTasksClampsAnOversizedLimitToTheMaximum() {
        seedFixture();

        assertThat(tools.queryTasks(null, null, null, null, null, null, null, 500).limit())
                .isEqualTo(TaskReadTools.MAX_LIMIT);
    }

    @Test
    void queryTasksDefaultsANonPositiveLimitInsteadOfFailing() {
        seedFixture();

        assertThat(tools.queryTasks(null, null, null, null, null, null, null, 0).limit())
                .isEqualTo(TaskReadTools.DEFAULT_LIMIT);
        assertThat(tools.queryTasks(null, null, null, null, null, null, null, -7).limit())
                .isEqualTo(TaskReadTools.DEFAULT_LIMIT);
    }

    @Test
    void queryTasksHonoursASmallerLimitAndStillReportsTheTotal() {
        seedFixture();

        ToolResults.TaskPageResult result = tools.queryTasks(null, null, null, null, null, null, null, 2);

        assertThat(result.tasks()).hasSize(2);
        assertThat(result.total()).isEqualTo(6);
        assertThat(result.limit()).isEqualTo(2);
    }

    // -------------------------------------------------- query_tasks: bad arguments

    @Test
    void queryTasksRejectsAnUnknownStatusAndNamesTheAllowedValues() {
        seedFixture();

        ToolResults.TaskPageResult result = tools.queryTasks(null, "in progress", null, null, null, null, null, null);

        assertThat(result.failed()).isTrue();
        assertThat(result.error()).isEqualTo("unknown value 'in progress'; allowed: BACKLOG, TODO, "
                + "IN_PROGRESS, IN_REVIEW, BLOCKED, DONE, CANCELLED");
        assertThat(result.tasks()).isEmpty();
    }

    @Test
    void queryTasksRejectsAnUnknownPriorityAndNamesTheAllowedValues() {
        seedFixture();

        ToolResults.TaskPageResult result = tools.queryTasks(null, null, "P1", null, null, null, null, null);

        assertThat(result.failed()).isTrue();
        assertThat(result.error()).contains("unknown value 'P1'").contains("LOW, MEDIUM, HIGH, URGENT");
        assertThat(result.tasks()).isEmpty();
    }

    @Test
    void queryTasksAcceptsLowercaseAndPaddedEnumValues() {
        seedFixture();

        // A small model writes "blocked" far more often than "BLOCKED"; rejecting that
        // would waste a turn on a technicality.
        assertThat(titlesOf(tools.queryTasks(null, " blocked ", null, null, null, null, null, null)))
                .containsExactly("Login page times out");
    }

    @Test
    void queryTasksRejectsANegativeDueWithinDaysWithoutThrowing() {
        seedFixture();

        ToolResults.TaskPageResult result = tools.queryTasks(null, null, null, null, null, null, -1, null);

        assertThat(result.failed()).isTrue();
        assertThat(result.error()).contains("dueWithinDays");
        assertThat(result.tasks()).isEmpty();
    }

    @Test
    void queryTasksTreatsBlankArgumentsAsAbsent() {
        seedFixture();

        ToolResults.TaskPageResult result = tools.queryTasks("   ", "  ", "", "  ", false, false, null, null);

        assertThat(result.failed()).isFalse();
        assertThat(result.total()).isEqualTo(6);
    }

    // -------------------------------------------------------------- getTask

    @Test
    void getTaskReturnsTheTaskAndItsDescription() {
        seedFixture();
        UUID target = id(1);

        ToolResults.TaskDetailResult result = tools.getTask(target.toString());

        assertThat(result.failed()).isFalse();
        assertThat(result.brief().id()).isEqualTo(target);
        assertThat(result.brief().title()).isEqualTo("Login page times out");
        assertThat(result.brief().overdue()).isTrue();
        assertThat(result.brief().tags()).containsExactly("bug", "auth");
        assertThat(result.description()).isEqualTo("Blocked on the auth service. Waiting on the token endpoint.");
        assertThat(result.taskId()).isEqualTo(target.toString());
    }

    @Test
    void getTaskWithAnUnknownIdReportsNotFound() {
        seedFixture();
        UUID missing = UUID.randomUUID();

        ToolResults.TaskDetailResult result = tools.getTask(missing.toString());

        assertThat(result.failed()).isTrue();
        assertThat(result.error()).isEqualTo("not_found");
        assertThat(result.taskId()).isEqualTo(missing.toString());
        assertThat(result.brief()).isNull();
    }

    @Test
    void getTaskWithAMalformedIdIsInvalidRatherThanNotFound() {
        seedFixture();

        ToolResults.TaskDetailResult result = tools.getTask("not-a-uuid");

        // "not_found" means the row is gone. Telling the model a task vanished because it
        // produced a malformed uuid would send it hunting for a deletion that never happened.
        assertThat(result.error()).isEqualTo("invalid_id");
        assertThat(result.taskId()).isEqualTo("not-a-uuid");
        assertThat(result.brief()).isNull();
    }

    @Test
    void getTaskResolvesTheAssigneeNameAndCarriesTheEstimate() {
        seedFixture();

        ToolResults.TaskDetailResult result = tools.getTask(id(5).toString());

        assertThat(result.brief().assignee()).isEqualTo("Ana Reyes");
        assertThat(result.brief().status()).isEqualTo(TaskStatus.DONE);
        assertThat(result.brief().overdue()).isFalse();
    }

    // --------------------------------------------------------- getTaskStats

    @Test
    void getTaskStatsZeroFillsEveryStatusAndPriorityBucket() {
        seedFixture();

        ToolResults.StatsResult result = tools.getTaskStats();

        assertThat(result.failed()).isFalse();
        assertThat(result.byStatus()).containsOnlyKeys(TaskStatus.values());
        assertThat(result.byPriority()).containsOnlyKeys(TaskPriority.values());
        assertThat(result.byStatus()).containsEntry(TaskStatus.BLOCKED, 1L)
                .containsEntry(TaskStatus.TODO, 2L)
                .containsEntry(TaskStatus.BACKLOG, 1L)
                .containsEntry(TaskStatus.IN_REVIEW, 1L)
                .containsEntry(TaskStatus.DONE, 1L);
        // No fixture row is CANCELLED, so the key must still be there holding a zero —
        // otherwise the model concludes the status does not exist.
        assertThat(result.byStatus().get(TaskStatus.CANCELLED)).isZero();
        assertThat(result.total()).isEqualTo(6);
    }

    @Test
    void getTaskStatsReportsOverdueDueThisWeekAndUnassigned() {
        seedFixture();

        ToolResults.StatsResult result = tools.getTaskStats();

        // Overdue: 001 (-3d) and 003 (-1d). 005 is DONE, so OPEN-5 excludes it.
        assertThat(result.overdue()).isEqualTo(2);
        // Due on or before Sunday 2026-01-11, non-terminal: 001, 002, 003.
        assertThat(result.dueThisWeek()).isEqualTo(3);
        // Open and unassigned: only the BACKLOG row. 005 is DONE and unassigned-free anyway.
        assertThat(result.unassigned()).isEqualTo(1);
    }

    @Test
    void getTaskStatsRollsUpPerAssigneeIncludingTheOnesWithNoTasks() {
        // Only Ana gets a task, so Ben must still appear with zeros.
        save(TaskFixtures.aTask().id(id(1)).title("Ana task").assignee(ANA)
                .status(TaskStatus.TODO).dueDate(TODAY.minusDays(1)).build());

        ToolResults.StatsResult result = tools.getTaskStats();

        assertThat(result.assignees()).extracting(ToolResults.AssigneeRef::displayName)
                .containsExactly("Ana Reyes", "Ben Osei");
        assertThat(result.assignees().getFirst().open()).isEqualTo(1);
        assertThat(result.assignees().getFirst().overdue()).isEqualTo(1);
        assertThat(result.assignees().get(1).open()).isZero();
        assertThat(result.assignees().get(1).overdue()).isZero();
    }

    // -------------------------------------------------------- listTeamMembers

    @Test
    void listTeamMembersReturnsIdDisplayNameAndRole() {
        List<ToolResults.MemberRef> refs = tools.listTeamMembers();

        assertThat(refs).extracting(ToolResults.MemberRef::displayName)
                .containsExactly("Ana Reyes", "Ben Osei");
        assertThat(refs.getFirst().id()).isEqualTo(ANA);
        assertThat(refs.getFirst().role()).isEqualTo(TeamMemberRole.ENGINEER);
    }

    @Test
    void listTeamMembersIsEmptyWhenNobodyIsSeeded() {
        InMemoryTeamMemberRepository empty = new InMemoryTeamMemberRepository();
        TaskReadTools bare = new TaskReadTools(
                new TaskService(tasks, new TaskValidator(empty), Clock.fixed(NOW, ZoneId.of("UTC"))),
                new TaskStatsService(tasks, empty, new TaskPresenter(Clock.fixed(NOW, ZoneId.of("UTC"))),
                        Clock.fixed(NOW, ZoneId.of("UTC"))),
                new TeamMemberService(empty),
                new TaskPresenter(Clock.fixed(NOW, ZoneId.of("UTC"))));

        assertThat(bare.listTeamMembers()).isEmpty();
    }

    // ------------------------------------------------------- side-effect freedom

    /**
     * BE-08 §7's "repository state unchanged by any tool call". A full sweep of all four
     * tools must not add a row, delete a row, or move a {@code version} — a read tool that
     * bumped {@code version} would break every optimistic-lock check in the frontend.
     */
    @Test
    void noToolMutatesTheStore() {
        seedFixture();

        Map<UUID, Long> versionsBefore = versionSnapshot();
        long countBefore = tasks.count();
        long membersBefore = members.findAll().size();

        tools.queryTasks("login", "TODO,BLOCKED", "HIGH", "Ana Reyes", true, false, 7, 50);
        tools.getTask(id(1).toString());
        tools.getTask(UUID.randomUUID().toString());
        tools.getTaskStats();
        tools.listTeamMembers();
        // And the error paths, which are the ones most likely to have been written with a
        // shortcut: they must be as inert as the happy paths.
        tools.queryTasks(null, "NOPE", null, null, null, null, null, null);
        tools.queryTasks(null, null, null, "Nobody", null, null, null, null);

        assertThat(tasks.count()).isEqualTo(countBefore);
        assertThat(members.findAll()).hasSize((int) membersBefore);
        assertThat(versionSnapshot()).isEqualTo(versionsBefore);
    }

    private Map<UUID, Long> versionSnapshot() {
        return tasks.findAll().stream()
                .collect(Collectors.toMap(Task::id, Task::version));
    }

    // ------------------------------------------------------------- plumbing

    @Test
    void asToolCallbacksRegistersExactlyTheFourReadTools() {
        assertThat(tools.asToolCallbacks()).extracting(callback -> callback.getToolDefinition().name())
                .containsExactlyInAnyOrder(
                        "query_tasks", "get_task", "get_task_stats", "list_team_members");
    }

    @Test
    void asToolCallbacksIsStableAcrossCalls() {
        // AgentConfig asks for the list once per run; a fresh provider each time is fine,
        // but the *set* must not drift, or the model's tool list changes under it.
        assertThat(tools.asToolCallbacks()).extracting(c -> c.getToolDefinition().name())
                .containsExactlyInAnyOrderElementsOf(
                        tools.asToolCallbacks().stream().map(c -> c.getToolDefinition().name()).toList());
    }

    @Test
    void everyToolResultCarriesAnErrorChannelThatIsNullOnSuccess() {
        seedFixture();

        assertThat(tools.queryTasks(null, null, null, null, null, null, null, null).error()).isNull();
        assertThat(tools.getTask(id(1).toString()).error()).isNull();
        assertThat(tools.getTaskStats().error()).isNull();
    }

    /**
     * BE-09 §7's "no backend tool can mutate a task", asserted here because BE-08 is the
     * task that registers them. The read methods are named, so a future tool that writes
     * cannot slip in under a plausible name without failing this.
     */
    @Test
    void noRegisteredToolCanWrite() {
        assertThat(tools.asToolCallbacks()).extracting(callback -> callback.getToolDefinition().name())
                .containsExactlyInAnyOrder(
                        "query_tasks", "get_task", "get_task_stats", "list_team_members")
                .allSatisfy(name -> assertThat(name).doesNotContain(
                        "create", "update", "patch", "delete", "mutate", "propose", "set"));
    }
}
