package io.github.khezyapp.backend.service.command;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import io.github.khezyapp.backend.domain.task.TaskStatus;

/**
 * {@code POST /api/tasks/bulk-status} intent (FR-B-07).
 *
 * <p>{@code expectedVersions} is a per-id map, matching the body shape the spec pins:
 * one stale task fails the whole call. A missing entry means "no expectation for that id"
 * rather than "expect version 0".
 *
 * <p>There is no {@code reopen} flag: a bulk reopen would need per-id intent, so
 * reopening a cancelled task is done through the single-status endpoint.
 */
public record BulkStatusCommand(
        List<UUID> ids,
        TaskStatus status,
        Map<UUID, Long> expectedVersions) {

    public BulkStatusCommand {
        ids = ids == null ? List.of() : List.copyOf(ids);
        expectedVersions = expectedVersions == null ? Map.of() : Map.copyOf(expectedVersions);
    }
}