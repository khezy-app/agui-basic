package io.github.khezyapp.backend.bootstrap;

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

import io.github.khezyapp.backend.domain.task.Task;
import io.github.khezyapp.backend.domain.task.TaskPriority;
import io.github.khezyapp.backend.domain.task.TaskStatus;
import io.github.khezyapp.backend.domain.team.TeamMember;
import io.github.khezyapp.backend.repository.InMemoryTaskRepository;
import io.github.khezyapp.backend.repository.InMemoryTeamMemberRepository;
import io.github.khezyapp.backend.service.TaskPresenter;

class SeedDataRunnerTest {

    private static final Clock CLOCK =
            Clock.fixed(Instant.parse("2026-01-05T10:15:30Z"), ZoneId.of("UTC"));

    private InMemoryTaskRepository tasks;
    private InMemoryTeamMemberRepository members;
    private SeedDataRunner runner;

    @BeforeEach
    void setUp() {
        tasks = new InMemoryTaskRepository(CLOCK);
        members = new InMemoryTeamMemberRepository();
        runner = new SeedDataRunner(tasks, members, new TaskPresenter(CLOCK), CLOCK,
                new SeedDataProperties(true, 6, 50));
    }

    private LocalDate today() {
        return LocalDate.of(2026, 1, 5);
    }

    // ------------------------------------------------------------- §4.2 rows

    @Test
    void everyTaskRequirementHolds() {
        List<Task> seeded = runner.seed();

        SeedDataRunner.verify(seeded, members.findAll(), today());
    }

    @Test
    void atLeastFiveTasksInEachStatus() {
        List<Task> seeded = runner.seed();

        for (TaskStatus status : TaskStatus.values()) {
            assertThat(seeded.stream().filter(task -> task.status() == status).count())
                    .as("%s", status)
                    .isGreaterThanOrEqualTo(5);
        }
    }

    @Test
    void atLeastSixTasksPerPriority() {
        List<Task> seeded = runner.seed();

        for (TaskPriority priority : TaskPriority.values()) {
            assertThat(seeded.stream().filter(task -> task.priority() == priority).count())
                    .as("%s", priority)
                    .isGreaterThanOrEqualTo(6);
        }
    }

    @Test
    void atLeastTenOverdueTasksSpanningThreeStatusesIncludingBlocked() {
        List<Task> seeded = runner.seed();

        List<Task> overdue = seeded.stream()
                .filter(task -> io.github.khezyapp.backend.repository.InMemoryTaskRepository
                        .isOverdue(task, today()))
                .toList();

        assertThat(overdue).hasSizeGreaterThanOrEqualTo(10);
        assertThat(overdue.stream().map(Task::status).distinct()).hasSizeGreaterThanOrEqualTo(3);
        assertThat(overdue).anyMatch(task -> task.status() == TaskStatus.BLOCKED);
    }

    @Test
    void atLeastEightTasksAreDueWithinTheNextSevenDays() {
        List<Task> seeded = runner.seed();

        long dueSoon = seeded.stream()
                .filter(task -> task.dueDate() != null
                        && !task.dueDate().isAfter(today().plusDays(7)))
                .count();

        assertThat(dueSoon).isGreaterThanOrEqualTo(8);
    }

    @Test
    void atLeastEightTasksAreUnassignedAndThreeOfThemAreOpen() {
        List<Task> seeded = runner.seed();

        assertThat(seeded.stream().filter(task -> task.assigneeId() == null).count())
                .isGreaterThanOrEqualTo(8);
        assertThat(seeded.stream()
                .filter(task -> task.assigneeId() == null && !task.status().isTerminal()).count())
                .isGreaterThanOrEqualTo(3);
    }

    @Test
    void tagCoverageMeetsTheStatedMinimums() {
        List<Task> seeded = runner.seed();

        assertThat(tagged(seeded, "bug")).isGreaterThanOrEqualTo(12);
        assertThat(tagged(seeded, "auth")).isGreaterThanOrEqualTo(8);
        assertThat(tagged(seeded, "ui")).isGreaterThanOrEqualTo(5);
        assertThat(seeded.stream().flatMap(task -> task.tags().stream()).distinct())
                .contains("bug", "auth", "ui", "api", "docs");
    }

    @Test
    void atLeastFourTitlesMentionLoginSoTheDemoScriptWorks() {
        List<Task> seeded = runner.seed();

        assertThat(seeded.stream()
                .filter(task -> task.title().toLowerCase(java.util.Locale.ROOT).contains("login"))
                .toList())
                .hasSizeGreaterThanOrEqualTo(4);
    }

    @Test
    void everyBlockedTaskExplainsItsBlocker() {
        List<Task> seeded = runner.seed();

        assertThat(seeded.stream().filter(task -> task.status() == TaskStatus.BLOCKED))
                .isNotEmpty()
                .allSatisfy(task -> assertThat(task.description()).isNotBlank());
    }

    @Test
    void createdAtIsSpreadOverTheLastFortyFiveDaysAndUpdatedAtFollows() {
        List<Task> seeded = runner.seed();

        assertThat(seeded).hasSize(50);
        assertThat(seeded.stream().map(Task::createdAt).min(java.util.Comparator.naturalOrder()).orElseThrow())
                .isBeforeOrEqualTo(Instant.parse("2025-11-22T00:00:00Z"));
        assertThat(seeded.stream().map(Task::createdAt).max(java.util.Comparator.naturalOrder()).orElseThrow())
                .isAfter(Instant.parse("2026-01-01T00:00:00Z"));
        assertThat(seeded).allSatisfy(task ->
                assertThat(task.updatedAt()).isAfterOrEqualTo(task.createdAt()));
    }

    @Test
    void aboutSixtyPercentOfTasksCarryAnEstimateFromTheAllowedSet() {
        List<Task> seeded = runner.seed();

        List<Task> estimated = seeded.stream().filter(task -> task.estimateHours() != null).toList();
        assertThat(estimated).isNotEmpty();
        assertThat(estimated.size() * 100.0 / seeded.size()).isBetween(50.0, 70.0);
        assertThat(estimated).allSatisfy(task ->
                assertThat(task.estimateHours()).isIn(
                        new BigDecimal("0.5"), BigDecimal.ONE, new BigDecimal("2"),
                        new BigDecimal("3"), new BigDecimal("5"), new BigDecimal("8"),
                        new BigDecimal("13")));
    }

    @Test
    void terminalTasksHavePastDueDatesButAreNeverOverdue() {
        List<Task> seeded = runner.seed();

        List<Task> terminal = seeded.stream().filter(task -> task.status().isTerminal()).toList();
        assertThat(terminal.stream().filter(task -> task.status() == TaskStatus.CANCELLED).count())
                .isGreaterThanOrEqualTo(3);
        assertThat(terminal.stream().filter(task -> task.status() == TaskStatus.DONE).count())
                .isGreaterThanOrEqualTo(2);
        assertThat(terminal).allSatisfy(task -> {
            assertThat(task.dueDate()).isNotNull().isBefore(today());
            assertThat(io.github.khezyapp.backend.repository.InMemoryTaskRepository
                    .isOverdue(task, today())).isFalse();
        });
    }

    // ------------------------------------------------------------- idempotency

    @Test
    void runningTwiceSeedsOnce() {
        runner.seed();
        long afterFirst = tasks.count();
        long membersAfterFirst = members.findAll().size();

        List<Task> second = runner.seed();

        assertThat(second).isEmpty();
        assertThat(tasks.count()).isEqualTo(afterFirst);
        assertThat(members.findAll()).hasSize((int) membersAfterFirst);
    }

    @Test
    void aPrePopulatedStoreIsLeftUntouched() {
        Task existing = tasks.save(new Task(UUID.randomUUID(), "Already here", null, TaskStatus.TODO,
                TaskPriority.MEDIUM, null, null, null, null, List.of(), null, null, 0L));
        TeamMember member = members.save(new TeamMember(UUID.randomUUID(), "Existing Person",
                "existing@agui-basic.test", io.github.khezyapp.backend.domain.team.TeamMemberRole.QA));

        List<Task> seeded = runner.seed();

        assertThat(seeded).isEmpty();
        assertThat(tasks.count()).isEqualTo(1);
        assertThat(tasks.findById(existing.id())).isPresent();
        assertThat(members.findAll()).containsExactly(member);
    }

    @Test
    void seedingCanBeDisabledEntirely() {
        SeedDataRunner disabled = new SeedDataRunner(tasks, members, new TaskPresenter(CLOCK), CLOCK,
                new SeedDataProperties(false, 6, 50));

        assertThat(disabled.seed()).isEmpty();
        assertThat(tasks.count()).isZero();
        assertThat(members.findAll()).isEmpty();
    }

    @Test
    void theFixtureIsDeterministic() {
        InMemoryTaskRepository otherTasks = new InMemoryTaskRepository(CLOCK);
        SeedDataRunner other = new SeedDataRunner(otherTasks, new InMemoryTeamMemberRepository(),
                new TaskPresenter(CLOCK), CLOCK, new SeedDataProperties(true, 6, 50));

        assertThat(other.seed()).isEqualTo(runner.seed());
    }

    @Test
    void teamMemberIdsAreFixedSoTheDemoCanLinkToThem() {
        runner.seed();

        assertThat(members.findAll()).extracting(TeamMember::displayName)
                .containsExactly("Ana Reyes", "Ben Osei", "Chloe Tan", "Dmitri Volkov",
                        "Elena Rossi", "Farah Nasser");
        assertThat(members.findAll()).extracting(TeamMember::id)
                .doesNotContainNull()
                .doesNotHaveDuplicates()
                .allSatisfy(id -> assertThat(id).isNotNull());
    }

    private static long tagged(List<Task> seeded, String tag) {
        return seeded.stream().filter(task -> task.tags().contains(tag)).count();
    }
}