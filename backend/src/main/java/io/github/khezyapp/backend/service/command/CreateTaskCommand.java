package io.github.khezyapp.backend.service.command;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import io.github.khezyapp.backend.domain.task.TaskPriority;
import io.github.khezyapp.backend.domain.task.TaskStatus;

/**
 * {@code POST /api/tasks} intent. Every field except {@code title} is optional; the
 * server owns {@code id}, {@code version}, both timestamps and the derived flags.
 *
 * <p>Field rules live in {@code TaskValidator}; this record carries no rules.
 *
 * @param status defaults to {@code TaskStatusMachine.DEFAULT_STATUS} when null
 */
public record CreateTaskCommand(
        String title,
        String description,
        TaskStatus status,
        TaskPriority priority,
        UUID assigneeId,
        UUID reporterId,
        LocalDate dueDate,
        BigDecimal estimateHours,
        List<String> tags) {
}