package io.github.khezyapp.backend.testsupport;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import io.github.khezyapp.backend.domain.task.Task;
import io.github.khezyapp.backend.domain.task.TaskPriority;
import io.github.khezyapp.backend.domain.task.TaskStatus;

/**
 * Fluent task builder for tests. Only the fields a test cares about need setting; the rest
 * get neutral defaults that pass the domain's normalisation.
 */
public final class TaskFixtures {

    private UUID id = UUID.randomUUID();
    private String title = "A task";
    private String description = null;
    private TaskStatus status = TaskStatus.TODO;
    private TaskPriority priority = TaskPriority.MEDIUM;
    private UUID assigneeId = null;
    private UUID reporterId = null;
    private LocalDate dueDate = null;
    private BigDecimal estimateHours = null;
    private List<String> tags = List.of();
    private Instant createdAt = Instant.EPOCH;
    private Instant updatedAt = null;
    private long version = 0;

    private TaskFixtures() {
    }

    public static TaskFixtures aTask() {
        return new TaskFixtures();
    }

    public TaskFixtures id(UUID id) {
        this.id = id;
        return this;
    }

    public TaskFixtures title(String title) {
        this.title = title;
        return this;
    }

    public TaskFixtures description(String description) {
        this.description = description;
        return this;
    }

    public TaskFixtures status(TaskStatus status) {
        this.status = status;
        return this;
    }

    public TaskFixtures priority(TaskPriority priority) {
        this.priority = priority;
        return this;
    }

    public TaskFixtures assignee(UUID assigneeId) {
        this.assigneeId = assigneeId;
        return this;
    }

    public TaskFixtures reporter(UUID reporterId) {
        this.reporterId = reporterId;
        return this;
    }

    public TaskFixtures dueDate(LocalDate dueDate) {
        this.dueDate = dueDate;
        return this;
    }

    public TaskFixtures estimateHours(double hours) {
        this.estimateHours = BigDecimal.valueOf(hours);
        return this;
    }

    public TaskFixtures tags(String... tags) {
        this.tags = List.of(tags);
        return this;
    }

    public TaskFixtures createdAt(Instant createdAt) {
        this.createdAt = createdAt;
        return this;
    }

    public TaskFixtures updatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
        return this;
    }

    public TaskFixtures version(long version) {
        this.version = version;
        return this;
    }

    /** A task with the given id, so tests can assert on order without holding references. */
    public UUID idValue() {
        return id;
    }

    public Task build() {
        return new Task(id, title, description, status, priority, assigneeId, reporterId,
                dueDate, estimateHours, tags, createdAt, updatedAt, version);
    }
}