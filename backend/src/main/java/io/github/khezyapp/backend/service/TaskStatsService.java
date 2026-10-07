package io.github.khezyapp.backend.service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.WeekFields;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Service;

import io.github.khezyapp.backend.domain.AssigneeRollup;
import io.github.khezyapp.backend.domain.TaskStats;
import io.github.khezyapp.backend.domain.task.Task;
import io.github.khezyapp.backend.domain.task.TaskPriority;
import io.github.khezyapp.backend.domain.task.TaskStatus;
import io.github.khezyapp.backend.domain.team.TeamMember;
import io.github.khezyapp.backend.repository.TaskRepository;
import io.github.khezyapp.backend.repository.TeamMemberRepository;

/**
 * {@code GET /api/tasks/stats} — the whole-store dashboard aggregate (FR-B-08).
 *
 * <p>Owned by BE-05, which BE-04 had to create because {@code /api/tasks/stats} must be a
 * literal route declared before {@code /{id}} or Spring routes the word {@code stats}
 * into the id path variable. BE-05 should review this against its §4.1 table and add its
 * own tests rather than rewrite it.
 */
@Service
public class TaskStatsService {

    private static final int RECENT_DAYS = 7;

    private final TaskRepository tasks;
    private final TeamMemberRepository members;
    private final TaskPresenter presenter;
    private final Clock clock;

    public TaskStatsService(TaskRepository tasks, TeamMemberRepository members,
                            TaskPresenter presenter, Clock clock) {
        this.tasks = tasks;
        this.members = members;
        this.presenter = presenter;
        this.clock = clock;
    }

    public TaskStats compute() {
        List<Task> all = tasks.findAll();
        LocalDate today = presenter.today();
        LocalDate endOfCurrentWeek = today.with(WeekFields.ISO.dayOfWeek(), 7);
        Instant weekStart = clock.instant().minus(Duration.ofDays(RECENT_DAYS));

        Map<TaskStatus, Long> byStatus = new EnumMap<>(TaskStatus.class);
        Map<TaskPriority, Long> byPriority = new EnumMap<>(TaskPriority.class);
        Map<UUID, long[]> perAssignee = new HashMap<>();
        for (Task task : all) {
            byStatus.merge(task.status(), 1L, Long::sum);
            byPriority.merge(task.priority(), 1L, Long::sum);
        }

        long overdueTotal = 0;
        long dueThisWeek = 0;
        long unassignedTotal = 0;
        long createdLast7Days = 0;

        for (Task task : all) {
            boolean terminal = task.status().isTerminal();
            boolean overdue = presenter.isOverdue(task);

            if (overdue) {
                overdueTotal++;
            }
            if (!terminal && task.dueDate() != null && !task.dueDate().isAfter(endOfCurrentWeek)) {
                dueThisWeek++;
            }
            if (!terminal && task.assigneeId() == null) {
                unassignedTotal++;
            }
            if (!task.createdAt().isBefore(weekStart)) {
                createdLast7Days++;
            }
            if (task.assigneeId() != null && !terminal) {
                long[] counts = perAssignee.computeIfAbsent(task.assigneeId(), key -> new long[2]);
                counts[0]++;
                if (overdue) {
                    counts[1]++;
                }
            }
        }

        List<AssigneeRollup> rollups = new ArrayList<>(members.findAll().size());
        for (TeamMember member : members.findAll()) {
            long[] counts = perAssignee.getOrDefault(member.id(), new long[2]);
            rollups.add(new AssigneeRollup(member.id(), member.displayName(), counts[0], counts[1]));
        }

        return new TaskStats(all.size(), byStatus, byPriority, rollups,
                overdueTotal, dueThisWeek, unassignedTotal, createdLast7Days);
    }
}