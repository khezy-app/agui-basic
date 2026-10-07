package io.github.khezyapp.backend.web.dto;

import jakarta.validation.constraints.NotNull;

import io.github.khezyapp.backend.domain.task.TaskStatus;

/**
 * {@code POST /api/tasks/{id}/status} body (FR-B-06).
 *
 * @param reopen          explicit reopen intent; only meaningful for a CANCELLED task
 *                        landing on TODO (INV-2)
 * @param expectedVersion optimistic-lock expectation, in the body for this endpoint
 *                        (unlike PATCH and DELETE, which carry it as a query parameter)
 */
public record StatusChangeRequest(
        @NotNull(message = "must not be null")
        TaskStatus status,

        Boolean reopen,

        Long expectedVersion) {

    public StatusChangeRequest {
        /**
         * Jackson 3 enables {@code FAIL_ON_NULL_FOR_PRIMITIVES}, so an <em>omitted</em>
         * {@code reopen} would fail the whole body with a 422. The compact constructor
         * accepts {@code null} and folds it to {@code false}, which is the documented
         * default, instead of loosening the global JSON configuration.
         */
        reopen = Boolean.TRUE.equals(reopen);
    }
}