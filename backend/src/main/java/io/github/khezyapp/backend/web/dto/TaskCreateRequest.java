package io.github.khezyapp.backend.web.dto;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import io.github.khezyapp.backend.domain.task.TaskPriority;
import io.github.khezyapp.backend.domain.task.TaskStatus;

/**
 * {@code POST /api/tasks} body.
 *
 * <p>The Bean Validation messages are spelled identically to {@code TaskValidator}'s, so
 * a field rejected here and a field rejected in the service produce the same
 * {@code errors[].message}. The service remains authoritative — these annotations only
 * make the common cases fail before it runs.
 *
 * <p>No {@code id}, {@code version}, timestamps or derived flags: strict Jackson rejects
 * them with 422 (FR-B-19).
 */
public record TaskCreateRequest(
        @NotBlank(message = "must not be blank")
        @Size(max = 160, message = "must be at most 160 characters")
        String title,

        @Size(max = 4000, message = "must be at most 4000 characters")
        String description,

        TaskStatus status,

        TaskPriority priority,

        UUID assigneeId,

        UUID reporterId,

        LocalDate dueDate,

        @DecimalMin(value = "0", message = "must be between 0 and 999")
        @DecimalMax(value = "999", message = "must be between 0 and 999")
        @Digits(integer = 3, fraction = 1, message = "must have at most 1 decimal place")
        BigDecimal estimateHours,

        @Size(max = 5, message = "must contain at most 5 entries")
        List<@Size(min = 1, max = 24, message = "must be 1–24 characters") String> tags) {

    public TaskCreateRequest {
        tags = tags == null ? null : List.copyOf(tags);
    }
}