package io.github.khezyapp.backend.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import io.github.khezyapp.backend.domain.AssigneeRollup;
import io.github.khezyapp.backend.domain.TaskStats;
import io.github.khezyapp.backend.domain.task.Task;
import io.github.khezyapp.backend.domain.task.TaskPriority;
import io.github.khezyapp.backend.domain.task.TaskStatus;
import io.github.khezyapp.backend.domain.team.TeamMember;
import io.github.khezyapp.backend.domain.team.TeamMemberRole;
import io.github.khezyapp.backend.repository.InMemoryTaskRepository;
import io.github.khezyapp.backend.repository.InMemoryTeamMemberRepository;
import io.github.khezyapp.backend.testsupport.TaskFixtures;

/**
 * BE-05 §4.1. The aggregation itself was written in BE-04 because {@code /stats} had to
 * become a real route; these tests are the ones BE-05's own plan called for.
 */
class TaskStatsServiceTest {

    /** A Wednesday, so the ISO week has room on both sides of "this week". */
    private static final Instant NOW = Instant.parse("2026-01-07T12:00:00Z");
    private static final LocalDate TODAY = LocalDate.of(2026, 1, 7);

    private static final UUID ADA = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");
    private static final UUID BEN = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000002");
    private static final UUID CHLOE = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000003");

    private InMemoryTaskRepository tasks;
    private InMemoryTeamMemberRepository members;
    private TaskStatsService service;

    @BeforeEach
    void setUp() {
        Clock clock = Clock.fixed(NOW, ZoneId.of("UTC"));
        tasks = new InMemoryTaskRepository(clock);
        members = new InMemoryTeamMemberRepository();
        members.save(new TeamMember(ADA, "Ada Lovelace", "ada@example.test", TeamMemberRole.ENGINEER));
        members.save(new TeamMember(BEN, "Ben Osei", "ben@agui-basic.test", TeamMemberRole.ENGINEER));
        members.save(new TeamMember(CHLOE, "Chloe Tan", "chloe@agui-basic.test", TeamMemberRole.DESIGNER));
        service = new TaskStatsService(tasks, members, new TaskPresenter(clock), clock);
    }

    private Task store(Task task) {
        return tasks.save(task);
    }

    private TaskFixtures aTask() {
        return TaskFixtures.aTask().createdAt(NOW.minusSeconds(3600));
    }

    @Test
    void anEmptyStoreStillReportsEveryBucket() {
        TaskStats stats = service.compute();

        assertThat(stats.total()).isZero();
        assertThat(stats.byStatus()).hasSize(7).containsEntry(TaskStatus.TODO, 0L);
        assertThat(stats.byPriority()).hasSize(4).containsEntry(TaskPriority.MEDIUM, 0L);
        assertThat(stats.overdueTotal()).isZero();
        assertThat(stats.dueThisWeek()).isZero();
        assertThat(stats.unassignedTotal()).isZero();
        assertThat(stats.createdLast7Days()).isZero();
    }

    @Test
    void anEmptyStoreStillListsEveryMember() {
        assertThat(service.compute().assignees()).hasSize(3);
    }

    @Test
    void totalCountsTheWholeStoreNotThePage() {
        store(aTask().title("a").build());
        store(aTask().title("b").build());
        store(aTask().title("c").build());

        assertThat(service.compute().total()).isEqualTo(3);
    }

    @Test
    void overdueExcludesTerminalRowsWithPastDueDates() {
        store(aTask().title("overdue open").status(TaskStatus.TODO).dueDate(TODAY.minusDays(1)).build());
        store(aTask().title("done last week").status(TaskStatus.DONE).dueDate(TODAY.minusDays(9)).build());
        store(aTask().title("cancelled last week").status(TaskStatus.CANCELLED)
                .dueDate(TODAY.minusDays(9)).build());

        assertThat(service.compute().overdueTotal()).isEqualTo(1);
    }

    @Test
    void aTaskDueTodayCountsAsOverdueLikeTheListFilterDoes() {
        store(aTask().title("due today").status(TaskStatus.TODO).dueDate(TODAY).build());

        assertThat(service.compute().overdueTotal()).isEqualTo(1);
    }

    @Test
    void dueThisWeekIsOverdueInclusiveAndStopsAtTheIsoWeekEnd() {
        LocalDate sunday = TODAY.with(java.time.temporal.WeekFields.ISO.dayOfWeek(), 7);
        store(aTask().title("long overdue").status(TaskStatus.TODO)
                .dueDate(TODAY.minusDays(40)).build());
        store(aTask().title("due on sunday").status(TaskStatus.TODO).dueDate(sunday).build());
        store(aTask().title("due next monday").status(TaskStatus.TODO)
                .dueDate(sunday.plusDays(1)).build());
        store(aTask().title("terminal").status(TaskStatus.DONE).dueDate(sunday).build());

        assertThat(service.compute().dueThisWeek()).isEqualTo(2);
    }

    @Test
    void unassignedTotalCountsOnlyOpenRows() {
        store(aTask().title("open unassigned").assignee(null).status(TaskStatus.TODO).build());
        store(aTask().title("cancelled unassigned").assignee(null).status(TaskStatus.CANCELLED).build());
        store(aTask().title("assigned").assignee(ADA).build());

        assertThat(service.compute().unassignedTotal()).isEqualTo(1);
    }

    @Test
    void assigneesIncludeMembersWithNoTasksAndAreSortedByDisplayName() {
        store(aTask().title("for ben").assignee(BEN).status(TaskStatus.TODO).build());
        store(aTask().title("for ben overdue").assignee(BEN).status(TaskStatus.TODO)
                .dueDate(TODAY.minusDays(3)).build());
        store(aTask().title("for ada terminal").assignee(ADA).status(TaskStatus.DONE).build());

        List<AssigneeRollup> rollups = service.compute().assignees();

        assertThat(rollups).hasSize(3);
        assertThat(rollups).extracting(AssigneeRollup::displayName)
                .containsExactly("Ada Lovelace", "Ben Osei", "Chloe Tan");
        assertThat(rollups.get(0).openCount()).isZero();
        assertThat(rollups.get(1).openCount()).isEqualTo(2);
        assertThat(rollups.get(1).overdueCount()).isEqualTo(1);
        assertThat(rollups.get(2).memberId()).isEqualTo(CHLOE);
    }

    @Test
    void anAssigneeRowIgnoresTheirTerminalTasks() {
        store(aTask().title("open").assignee(ADA).status(TaskStatus.TODO).build());
        store(aTask().title("done").assignee(ADA).status(TaskStatus.DONE).build());

        assertThat(service.compute().assignees().get(0).openCount()).isEqualTo(1);
    }

    @Test
    void createdLast7DaysIsInclusiveAtExactlySevenDays() {
        store(aTask().title("exactly seven days old").createdAt(NOW.minusSeconds(7 * 24 * 3600L)).build());
        store(aTask().title("a minute old").createdAt(NOW.minusSeconds(60)).build());
        store(aTask().title("one second too old").createdAt(NOW.minusSeconds(7 * 24 * 3600L + 1)).build());

        assertThat(service.compute().createdLast7Days()).isEqualTo(2);
    }

    @Test
    void byStatusAndByPriorityAreZeroFilledAndCounted() {
        store(aTask().title("a").status(TaskStatus.TODO).priority(TaskPriority.LOW).build());
        store(aTask().title("b").status(TaskStatus.TODO).priority(TaskPriority.URGENT).build());
        store(aTask().title("c").status(TaskStatus.BLOCKED).priority(TaskPriority.URGENT).build());

        TaskStats stats = service.compute();

        assertThat(stats.byStatus()).containsEntry(TaskStatus.TODO, 2L)
                .containsEntry(TaskStatus.BLOCKED, 1L)
                .containsEntry(TaskStatus.DONE, 0L);
        assertThat(stats.byPriority()).containsEntry(TaskPriority.LOW, 1L)
                .containsEntry(TaskPriority.URGENT, 2L)
                .containsEntry(TaskPriority.HIGH, 0L);
    }

    @Test
    void tagsAndEstimatesDoNotAffectTheAggregate() {
        store(aTask().title("estimated").tags("bug", "ui").estimateHours(13).build());

        TaskStats stats = service.compute();

        assertThat(stats.total()).isEqualTo(1);
        assertThat(stats.byStatus().get(TaskStatus.TODO)).isEqualTo(1);
        assertThat(tasks.findAll()).allSatisfy(task ->
                assertThat(task.estimateHours()).isEqualByComparingTo(new BigDecimal("13")));
    }

    @Test
    void anAssigneeWithAnUnknownMemberIdIsNotRolledUp() {
        store(aTask().title("ghost assignee").assignee(UUID.randomUUID()).build());

        TaskStats stats = service.compute();

        assertThat(stats.assignees()).allSatisfy(rollup -> assertThat(rollup.openCount()).isZero());
        assertThat(stats.total()).isEqualTo(1);
    }
}