package io.github.khezyapp.backend.web.dto;

import java.util.List;

/** {@code POST /api/tasks/bulk-status} response: the count written and the new rows. */
public record BulkStatusResponse(int updated, List<TaskResponse> tasks) {

    public BulkStatusResponse {
        tasks = tasks == null ? List.of() : List.copyOf(tasks);
    }
}