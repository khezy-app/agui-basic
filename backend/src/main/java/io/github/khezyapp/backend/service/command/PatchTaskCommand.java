package io.github.khezyapp.backend.service.command;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import io.github.khezyapp.backend.domain.task.TaskPriority;

/**
 * {@code PATCH /api/tasks/{id}} intent — business fields only (FR-B-04). {@code status}
 * is deliberately absent: it has its own endpoint, and a patch that carries one is
 * rejected by field name rather than silently ignored.
 *
 * <p>Every field is nullable and {@code null} means <em>leave unchanged</em>. This is
 * OPEN-14: a Java record cannot distinguish an absent key from an explicit {@code null},
 * so clearing {@code assigneeId}/{@code reporterId}/{@code dueDate}/{@code estimateHours}
 * is not expressible through this record. {@code description} clears with {@code ""} and
 * {@code tags} clears with {@code []}.
 */
public record PatchTaskCommand(
        String title,
        String description,
        TaskPriority priority,
        UUID assigneeId,
        UUID reporterId,
        LocalDate dueDate,
        BigDecimal estimateHours,
        List<String> tags) {

    /** An empty patch: nothing to change. */
    public static PatchTaskCommand empty() {
        return new PatchTaskCommand(null, null, null, null, null, null, null, null);
    }
}