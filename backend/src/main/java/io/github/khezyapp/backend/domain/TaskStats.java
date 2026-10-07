package io.github.khezyapp.backend.domain;

import java.util.Collections;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

import io.github.khezyapp.backend.domain.task.TaskPriority;
import io.github.khezyapp.backend.domain.task.TaskStatus;

/**
 * The whole-store dashboard aggregate (FR-B-08). Computed over every task, never over
 * the current page, so the numbers agree with what the list reports when unfiltered.
 *
 * <p>The compact constructor guarantees the two invariants the frontend relies on:
 * {@code byStatus} always has all 7 keys and {@code byPriority} all 4, zero-filled, so
 * the UI never has to guard against a missing bucket. Keys iterate in declaration order.
 *
 * @param assignees one row per team member <em>including members with no tasks</em>
 */
public record TaskStats(
        long total,
        Map<TaskStatus, Long> byStatus,
        Map<TaskPriority, Long> byPriority,
        List<AssigneeRollup> assignees,
        long overdueTotal,
        long dueThisWeek,
        long unassignedTotal,
        long createdLast7Days) {

    public TaskStats {
        byStatus = zeroFilled(byStatus, TaskStatus.class);
        byPriority = zeroFilled(byPriority, TaskPriority.class);
        assignees = List.copyOf(assignees);
    }

    private static <E extends Enum<E>> Map<E, Long> zeroFilled(Map<E, Long> source, Class<E> type) {
        Map<E, Long> filled = new EnumMap<>(type);
        for (E key : type.getEnumConstants()) {
            filled.put(key, 0L);
        }
        if (source != null) {
            source.forEach((key, value) -> {
                if (key != null && value != null) {
                    filled.put(key, value);
                }
            });
        }
        return Collections.unmodifiableMap(filled);
    }
}