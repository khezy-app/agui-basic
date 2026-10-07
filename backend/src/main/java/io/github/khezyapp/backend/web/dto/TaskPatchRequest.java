package io.github.khezyapp.backend.web.dto;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Size;

import io.github.khezyapp.backend.domain.task.TaskPriority;
import io.github.khezyapp.backend.domain.task.TaskStatus;

/**
 * {@code PATCH /api/tasks/{id}} body — business fields only (FR-B-04).
 *
 * <p>{@code status} is declared <em>only</em> so it can be rejected by name with a
 * {@code 400} on field {@code status} (the wording FR-B-04 asks for). Had it been
 * omitted, strict Jackson would have answered 422 and the error would have landed on a
 * field the client never mentioned. Any non-null value is an error; the value is ignored.
 *
 * <p>OPEN-14: every field is nullable and {@code null} means <em>leave unchanged</em>.
 * Clearing works for {@code description} ({@code ""}) and {@code tags} ({@code []});
 * {@code assigneeId}, {@code reporterId}, {@code dueDate} and {@code estimateHours}
 * cannot be cleared through this endpoint.
 */
public record TaskPatchRequest(
        @Size(max = 160, message = "must be at most 160 characters")
        String title,

        @Size(max = 4000, message = "must be at most 4000 characters")
        String description,

        TaskPriority priority,

        UUID assigneeId,

        UUID reporterId,

        LocalDate dueDate,

        @DecimalMin(value = "0", message = "must be between 0 and 999")
        @DecimalMax(value = "999", message = "must be between 0 and 999")
        @Digits(integer = 3, fraction = 1, message = "must have at most 1 decimal place")
        BigDecimal estimateHours,

        @Size(max = 5, message = "must contain at most 5 entries")
        List<@Size(min = 1, max = 24, message = "must be 1–24 characters") String> tags,

        TaskStatus status) {

    public TaskPatchRequest {
        tags = tags == null ? null : List.copyOf(tags);
    }
}