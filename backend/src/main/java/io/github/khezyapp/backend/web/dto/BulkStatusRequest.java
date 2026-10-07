package io.github.khezyapp.backend.web.dto;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import io.github.khezyapp.backend.domain.task.TaskStatus;

/**
 * {@code POST /api/tasks/bulk-status} body (FR-B-07). All-or-nothing.
 *
 * <p>There is no {@code reopen} flag, although BE-04 §4.3 sketched one: a bulk reopen is
 * per-task intent, and a single global flag would drag every selected task to TODO. Use
 * {@code POST /api/tasks/{id}/status} with {@code reopen: true} for a cancelled task.
 *
 * @param ids              1–100 task ids
 * @param expectedVersions per-id optimistic-lock expectations; a missing entry means "no
 *                         expectation for this id", not "expect version 0"
 */
public record BulkStatusRequest(
        @NotEmpty(message = "must contain at least 1 id")
        @Size(max = 100, message = "must contain at most 100 ids")
        List<@NotNull(message = "must not be null") UUID> ids,

        @NotNull(message = "must not be null")
        TaskStatus status,

        Map<UUID, Long> expectedVersions) {

    public BulkStatusRequest {
        ids = ids == null ? null : List.copyOf(ids);
        expectedVersions = expectedVersions == null ? Map.of() : Map.copyOf(expectedVersions);
    }
}