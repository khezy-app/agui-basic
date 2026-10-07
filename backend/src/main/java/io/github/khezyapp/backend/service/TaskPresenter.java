package io.github.khezyapp.backend.service;

import java.time.Clock;
import java.time.LocalDate;

import org.springframework.stereotype.Component;

import io.github.khezyapp.backend.domain.task.Task;
import io.github.khezyapp.backend.repository.InMemoryTaskRepository;
import io.github.khezyapp.backend.web.dto.TaskResponse;

/**
 * {@code Task} + derived flags → the frozen C3 wire shape.
 *
 * <p>Derived flags are computed here, never stored and never accepted from a client
 * (INV-5, FR-B-19).
 */
@Component
public class TaskPresenter {

    private final Clock clock;

    public TaskPresenter(Clock clock) {
        this.clock = clock;
    }

    public TaskResponse toResponse(Task task) {
        return new TaskResponse(
                task.id(),
                task.title(),
                task.description(),
                task.status(),
                task.priority(),
                task.assigneeId(),
                task.reporterId(),
                task.dueDate(),
                task.estimateHours(),
                task.tags(),
                task.createdAt(),
                task.updatedAt(),
                task.version(),
                isOverdue(task),
                task.assigneeId() == null);
    }

    /**
     * Reuses {@link InMemoryTaskRepository#isOverdue} — the single definition BE-01
     * established — so the badge, the {@code overdue=true} list filter and the dashboard
     * card can never disagree.
     *
     * <p>Note the deliberate difference from the bare wording in spec §2.1 ("due date
     * earlier than today"): the shared rule is {@code dueDate <= today} (OPEN-5), so a
     * task due <em>today</em> counts as overdue. One rule, three consumers.
     */
    public boolean isOverdue(Task task) {
        return InMemoryTaskRepository.isOverdue(task, today());
    }

    public LocalDate today() {
        return LocalDate.now(clock);
    }
}