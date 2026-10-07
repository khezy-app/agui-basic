package io.github.khezyapp.backend.bootstrap;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import io.github.khezyapp.backend.domain.task.Task;
import io.github.khezyapp.backend.domain.task.TaskPriority;
import io.github.khezyapp.backend.domain.task.TaskStatus;
import io.github.khezyapp.backend.domain.team.TeamMember;
import io.github.khezyapp.backend.domain.team.TeamMemberRole;
import io.github.khezyapp.backend.repository.InMemoryTaskRepository;
import io.github.khezyapp.backend.repository.TaskRepository;
import io.github.khezyapp.backend.repository.TeamMemberRepository;
import io.github.khezyapp.backend.service.TaskPresenter;

/**
 * FR-B-15 — seeds the demo fixture profile on an empty store so every filter and every
 * dashboard card is demonstrable without the frontend.
 *
 * <p><strong>Fully deterministic.</strong> Nothing here calls {@code Random}: the fixture
 * is a pure function of the task count and the injected {@link Clock}, so two developers
 * and two CI runs get byte-identical rows. That matters here because the demo script
 * references specific tasks by title ("the three login tasks").
 *
 * <p><strong>Idempotent</strong> (FR-B-15): a store that already has tasks is left alone.
 *
 * <p><strong>Self-checked</strong>: {@link #verify} asserts every §4.2 requirement and runs
 * both here at boot and in the unit test, so a broken fixture fails loudly instead of
 * quietly making a filter undemonstrable.
 */
@Component
@Order(0)
@EnableConfigurationProperties(SeedDataProperties.class)
public class SeedDataRunner implements ApplicationRunner {

    /**
     * Fixed member ids derived from the display name, so a restarted dev server keeps the
     * same URLs. These UUIDs are part of the demo contract — do not regenerate.
     */
    private static final List<Member> MEMBERS = List.of(
            new Member("Ana Reyes", "ana.reyes@agui-basic.test", TeamMemberRole.ENGINEER),
            new Member("Ben Osei", "ben.osei@agui-basic.test", TeamMemberRole.ENGINEER),
            new Member("Chloe Tan", "chloe.tan@agui-basic.test", TeamMemberRole.DESIGNER),
            new Member("Dmitri Volkov", "dmitri.volkov@agui-basic.test", TeamMemberRole.ENGINEER),
            new Member("Elena Rossi", "elena.rossi@agui-basic.test", TeamMemberRole.PRODUCT_OWNER),
            new Member("Farah Nasser", "farah.nasser@agui-basic.test", TeamMemberRole.QA));

    /**
     * Twenty curated titles. At least four mention {@code login} on purpose: the AG-UI
     * demo script says "mark the three login tasks in review", so the data has to support
     * it (BE-05 §4.2 requirement 7).
     */
    static final List<String> TITLES = List.of(
            "Fix flaky login redirect after SSO logout",
            "Add password reset flow to the login page",
            "Rate-limit the login endpoint",
            "Show last login timestamp in the profile card",
            "Migrate session cookies to SameSite=Lax",
            "Add pagination to the audit log screen",
            "Speed up task list filtering",
            "Contrast pass on the dashboard cards",
            "Backfill createdAt on imported tasks",
            "Document the bulk status endpoint",
            "Fix NPE when a task has no tags",
            "Add CSV export for the task table",
            "Cache the dashboard stats endpoint",
            "Replace the deprecated date picker",
            "Retry failed webhook deliveries",
            "Add a composite index on tasks(status, dueDate)",
            "Accessibility: focus trap in the task modal",
            "Drop lodash and shrink the bundle",
            "Handle timezone drift in due-date filters",
            "Write the onboarding guide for new engineers");

    static final List<String> EXTRA_TAGS =
            List.of("api", "frontend", "backend", "docs", "perf", "infra");

    static final BigDecimal[] ESTIMATES = {
            new BigDecimal("0.5"), BigDecimal.ONE, new BigDecimal("2"), new BigDecimal("3"),
            new BigDecimal("5"), new BigDecimal("8"), new BigDecimal("13")};

    private static final int CREATED_SPREAD_DAYS = 45;
    private static final int MIN_PER_STATUS = 5;
    private static final int MIN_PER_PRIORITY = 6;
    private static final int MIN_OVERDUE = 10;
    private static final int MIN_DUE_SOON = 8;
    private static final int MIN_UNASSIGNED = 8;
    private static final int MIN_BUG_TAGS = 12;
    private static final int MIN_AUTH_TAGS = 8;
    private static final int MIN_UI_TAGS = 5;
    private static final int MIN_LOGIN_TITLES = 4;
    private static final int MIN_TERMINAL_PAST_DUE = 5;
    private static final int DUE_SOON_WINDOW_DAYS = 7;

    private static final String BLOCKER_NOTE =
            "Blocked: waiting on the vendor to ship the schema change before we can continue.";

    private final TaskRepository tasks;
    private final TeamMemberRepository members;
    private final TaskPresenter presenter;
    private final Clock clock;
    private final SeedDataProperties properties;

    public SeedDataRunner(TaskRepository tasks, TeamMemberRepository members, TaskPresenter presenter,
                          Clock clock, SeedDataProperties properties) {
        this.tasks = tasks;
        this.members = members;
        this.presenter = presenter;
        this.clock = clock;
        this.properties = properties;
    }

    @Override
    public void run(ApplicationArguments args) {
        seed();
    }

    /** Visible for tests; {@link #run} is the Spring entry point. */
    public List<Task> seed() {
        if (!properties.enabled() || tasks.count() > 0) {
            return List.of();
        }
        List<TeamMember> seededMembers = seedMembers();
        List<Task> stored = new ArrayList<>();
        for (Task task : seedTasks(seededMembers, properties.tasks())) {
            stored.add(tasks.save(task));
        }
        verify(stored, seededMembers, presenter.today());
        return List.copyOf(stored);
    }

    private List<TeamMember> seedMembers() {
        List<TeamMember> seeded = new ArrayList<>(MEMBERS.size());
        for (Member member : MEMBERS) {
            TeamMember saved = members.save(new TeamMember(member.id(), member.displayName(),
                    member.email(), member.role()));
            seeded.add(saved);
        }
        return seeded;
    }

    private List<Task> seedTasks(List<TeamMember> team, int count) {
        LocalDate today = presenter.today();
        TaskStatus[] statuses = TaskStatus.values();
        LocalDate[] dueDates = dueDatesFor(statuses, count, today);

        List<Task> seeded = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            TaskStatus status = statuses[i % statuses.length];
            TaskPriority priority = TaskPriority.values()[(i / 2) % TaskPriority.values().length];

            seeded.add(new Task(
                    UUID.nameUUIDFromBytes(("agui-basic/task/" + i).getBytes(java.nio.charset.StandardCharsets.UTF_8)),
                    TITLES.get(i % TITLES.size()),
                    descriptionFor(status, i),
                    status,
                    priority,
                    assigneeFor(team, i),
                    reporterFor(team, i),
                    dueDates[i],
                    estimateFor(i),
                    tagsFor(i),
                    createdAtFor(i, count),
                    null,
                    0L));
        }
        return seeded;
    }

    private static String descriptionFor(TaskStatus status, int index) {
        if (status == TaskStatus.BLOCKED) {
            return BLOCKER_NOTE + " (ref " + index + ")";
        }
        return index % 3 == 0 ? "Raised during the sprint review on iteration " + (index % 8) + "."
                : "Context and acceptance notes for iteration " + (index % 8) + ".";
    }

    /** Every fifth task is unassigned, which leaves plenty non-terminal ones. */
    private static UUID assigneeFor(List<TeamMember> team, int index) {
        return index % 5 == 0 ? null : team.get(index % team.size()).id();
    }

    private static UUID reporterFor(List<TeamMember> team, int index) {
        return team.get((index + 2) % team.size()).id();
    }

    /**
     * Due dates are allocated by walking the <em>non-terminal</em> rows and handing out
     * quotas, rather than by a modular rule on the index. Modulo arithmetic on the index
     * silently loses rows to whichever statuses happen to land on the stride — the first
     * version produced 9 overdue tasks instead of the required 10 — whereas walking the
     * list makes the counts hold for any configured task count.
     *
     * <ul>
     *   <li>terminal rows → a past due date, so DONE/CANCELLED never read as overdue</li>
     *   <li>every 2nd open row → overdue (past)</li>
     *   <li>every 4th open row (odd ones) → due within {@value #DUE_SOON_WINDOW_DAYS} days</li>
     *   <li>every 4th open row at index 3 → due well into the future</li>
     *   <li>everything else → no due date</li>
     * </ul>
     */
    private static LocalDate[] dueDatesFor(TaskStatus[] statuses, int count, LocalDate today) {
        LocalDate[] dueDates = new LocalDate[count];
        int open = 0;
        for (int i = 0; i < count; i++) {
            if (statuses[i % statuses.length].isTerminal()) {
                dueDates[i] = today.minusDays(3 + i % 10);
                continue;
            }
            int position = open++;
            if (position % 2 == 0) {
                dueDates[i] = today.minusDays(1 + position % 21);
            } else if (position % 4 == 1) {
                dueDates[i] = today.plusDays(1 + position % DUE_SOON_WINDOW_DAYS);
            } else {
                dueDates[i] = today.plusDays(14 + position);
            }
        }
        return dueDates;
    }

    private static BigDecimal estimateFor(int index) {
        return index % 5 < 3 ? ESTIMATES[(index / 5) % ESTIMATES.length] : null;
    }

    private static List<String> tagsFor(int index) {
        List<String> tags = new ArrayList<>(3);
        if (index % 4 == 0) {
            tags.add("bug");
        }
        if (index % 5 == 0) {
            tags.add("auth");
        }
        if (index % 7 == 3) {
            tags.add("ui");
        }
        tags.add(EXTRA_TAGS.get((index / 3) % EXTRA_TAGS.size()));
        return tags;
    }

    private Instant createdAtFor(int index, int count) {
        long daysAgo = (long) (CREATED_SPREAD_DAYS * (count - index) / count);
        Instant created = clock.instant().minus(Duration.ofDays(daysAgo))
                .minus(Duration.ofHours(index % 12));
        return created;
    }

    // ------------------------------------------------------------- self-check

    /**
     * BE-05 §4.2 requirements 1–11, asserted rather than hoped for. Runs at boot so a
     * broken fixture fails the build rather than shipping an undemonstrable filter.
     *
     * @throws IllegalStateException naming the first violated requirement
     */
    static void verify(List<Task> seeded, List<TeamMember> team, LocalDate today) {

        for (TaskStatus status : TaskStatus.values()) {
            long count = seeded.stream().filter(task -> task.status() == status).count();
            require(count >= MIN_PER_STATUS, "at least " + MIN_PER_STATUS + " tasks in " + status
                    + ", found " + count);
        }
        for (TaskPriority priority : TaskPriority.values()) {
            long count = seeded.stream().filter(task -> task.priority() == priority).count();
            require(count >= MIN_PER_PRIORITY, "at least " + MIN_PER_PRIORITY + " tasks at "
                    + priority + ", found " + count);
        }

        List<Task> overdue = seeded.stream()
                .filter(task -> InMemoryTaskRepository.isOverdue(task, today))
                .toList();
        require(overdue.size() >= MIN_OVERDUE, "at least " + MIN_OVERDUE
                + " overdue tasks, found " + overdue.size());
        require(overdue.stream().map(Task::status).distinct().count() >= 3,
                "overdue tasks must span at least 3 statuses");
        require(overdue.stream().anyMatch(task -> task.status() == TaskStatus.BLOCKED),
                "at least one BLOCKED task must be overdue");

        long dueSoon = seeded.stream()
                .filter(task -> task.dueDate() != null && !task.dueDate().isAfter(today.plusDays(DUE_SOON_WINDOW_DAYS)))
                .count();
        require(dueSoon >= MIN_DUE_SOON, "at least " + MIN_DUE_SOON
                + " tasks due within " + DUE_SOON_WINDOW_DAYS + " days, found " + dueSoon);

        long unassigned = seeded.stream().filter(task -> task.assigneeId() == null).count();
        long unassignedOpen = seeded.stream()
                .filter(task -> task.assigneeId() == null && !task.status().isTerminal()).count();
        require(unassigned >= MIN_UNASSIGNED, "at least " + MIN_UNASSIGNED
                + " unassigned tasks, found " + unassigned);
        require(unassignedOpen >= 3, "at least 3 non-terminal unassigned tasks, found " + unassignedOpen);

        require(countTag(seeded, "bug") >= MIN_BUG_TAGS, "at least " + MIN_BUG_TAGS + " bug tags");
        require(countTag(seeded, "auth") >= MIN_AUTH_TAGS, "at least " + MIN_AUTH_TAGS + " auth tags");
        require(countTag(seeded, "ui") >= MIN_UI_TAGS, "at least " + MIN_UI_TAGS + " ui tags");

        long login = seeded.stream()
                .filter(task -> task.title().toLowerCase(java.util.Locale.ROOT).contains("login"))
                .count();
        require(login >= MIN_LOGIN_TITLES, "at least " + MIN_LOGIN_TITLES
                + " titles mentioning login, found " + login);

        for (Task task : seeded) {
            if (task.status() == TaskStatus.BLOCKED) {
                require(task.description() != null && !task.description().isBlank(),
                        "blocked task '" + task.title() + "' has no description (INV-3)");
            }
        }

        long terminalPastDue = seeded.stream()
                .filter(task -> task.status().isTerminal() && task.dueDate() != null
                        && task.dueDate().isBefore(today))
                .count();
        require(terminalPastDue >= MIN_TERMINAL_PAST_DUE, "at least " + MIN_TERMINAL_PAST_DUE
                + " terminal tasks with a past due date, found " + terminalPastDue);

        require(seeded.size() >= SeedDataProperties.MINIMUM_TASKS,
                "the fixture needs at least " + SeedDataProperties.MINIMUM_TASKS + " tasks");
        require(team.size() >= SeedDataProperties.MINIMUM_MEMBERS,
                "the fixture needs at least " + SeedDataProperties.MINIMUM_MEMBERS + " team members");
    }

    private static long countTag(List<Task> seeded, String tag) {
        return seeded.stream().filter(task -> task.tags().contains(tag)).count();
    }

    private static void require(boolean condition, String message) {
        if (!condition) {
            throw new IllegalStateException("seed fixture violates its own requirements: " + message);
        }
    }

    private record Member(String displayName, String email, TeamMemberRole role) {

        UUID id() {
            return UUID.nameUUIDFromBytes(
                    ("agui-basic/member/" + displayName).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        }
    }
}