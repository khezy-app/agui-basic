package io.github.khezyapp.backend.web.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import io.github.khezyapp.backend.domain.task.TaskPriority;
import io.github.khezyapp.backend.domain.task.TaskStatus;

/**
 * The frozen C3 wire shape of a task. Component order is the wire order and the type is
 * frozen by {@code 00-index.md} §3 C3 — do not add, remove or reorder fields here.
 *
 * <p>{@code isOverdue} and {@code isUnassigned} are always present and never
 * client-settable: no request DTO carries them and strict Jackson rejects a body that
 * does (FR-B-19).
 *
 * <p>There are deliberately no assignee/reporter <em>names</em> here. The frontend
 * resolves them from {@code GET /api/team-members}, so C3 stays one flat record.
 */
public record TaskResponse(
        UUID id,
        String title,
        String description,
        TaskStatus status,
        TaskPriority priority,
        UUID assigneeId,
        UUID reporterId,
        LocalDate dueDate,
        BigDecimal estimateHours,
        List<String> tags,
        Instant createdAt,
        Instant updatedAt,
        long version,
        boolean isOverdue,
        boolean isUnassigned) {

    public TaskResponse {
        tags = tags == null ? List.of() : List.copyOf(tags);
    }
}