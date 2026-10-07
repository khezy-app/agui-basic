package io.github.khezyapp.backend.service;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import io.github.khezyapp.backend.common.PageResponse;
import io.github.khezyapp.backend.domain.TaskQuery;
import io.github.khezyapp.backend.domain.task.Task;
import io.github.khezyapp.backend.domain.task.TaskPriority;
import io.github.khezyapp.backend.domain.task.TaskStatus;
import io.github.khezyapp.backend.error.ConflictApiException;
import io.github.khezyapp.backend.error.FieldError;
import io.github.khezyapp.backend.error.NotFoundApiException;
import io.github.khezyapp.backend.error.UnprocessableApiException;
import io.github.khezyapp.backend.error.ValidationApiException;
import io.github.khezyapp.backend.repository.TaskRepository;
import io.github.khezyapp.backend.service.command.BulkStatusCommand;
import io.github.khezyapp.backend.service.command.CreateTaskCommand;
import io.github.khezyapp.backend.service.command.PatchTaskCommand;

/**
 * The single write path (FR-B-18): REST controllers and any future AI tool call these
 * methods and nothing else, so there is exactly one set of rules and one place where a
 * {@code version} is compared.
 *
 * <p>The service speaks domain records — no HTTP types, no Jackson. Errors are typed
 * {@code ApiException}s that {@code ApiExceptionHandler} renders.
 */
@Service
public class TaskService {

    /** FR-B-19: fields a client may never set on a write, whatever the entry point. */
    static final Set<String> SERVER_OWNED_FIELDS = Set.of(
            "id", "version", "createdAt", "updatedAt", "isOverdue", "isUnassigned");

    private final TaskRepository tasks;
    private final TaskValidator validator;
    private final Clock clock;
    private final Duration createIdempotencyWindow;

    @Autowired
    public TaskService(TaskRepository tasks, TaskValidator validator, Clock clock,
                       @Value("${app.create-idempotency-window:5s}") Duration createIdempotencyWindow) {
        this.tasks = tasks;
        this.validator = validator;
        this.clock = clock;
        this.createIdempotencyWindow = createIdempotencyWindow;
    }

    /** Test-facing constructor with the documented 5-second idempotency window. */
    public TaskService(TaskRepository tasks, TaskValidator validator, Clock clock) {
        this(tasks, validator, clock, Duration.ofSeconds(5));
    }

    // ------------------------------------------------------------------ create

    /** {@code POST /api/tasks}. */
    public Task create(CreateTaskCommand command) {
        return create(command, Map.of());
    }

    /**
     * Create with the client's raw field names available, so the AI/tool path can reject
     * server-owned fields by name with a 422 (FR-B-19) instead of relying on the JSON
     * layer to have done it.
     *
     * @param rawExtras field name → value as the client sent it; {@code null} when absent
     */
    public Task create(CreateTaskCommand command, Map<String, Object> rawExtras) {
        rejectServerOwnedFields(rawExtras);

        String title = TaskValidator.normalizeTitle(command.title());
        String description = TaskValidator.normalizeDescription(command.description());
        TaskStatus status = command.status() == null
                ? TaskStatusMachine.DEFAULT_STATUS
                : command.status();
        TaskPriority priority = command.priority() == null
                ? TaskStatusMachine.DEFAULT_PRIORITY
                : command.priority();
        List<String> tags = TaskValidator.normalizeTags(command.tags());

        validator.validateNew(title, description, priority, command.assigneeId(), command.reporterId(),
                command.dueDate(), command.estimateHours(), tags);

        requireDescriptionForBlocked(status, description);

        Optional<Task> duplicate = findRecentDuplicate(title, status, command.assigneeId());
        if (duplicate.isPresent()) {
            return duplicate.get();
        }

        Task candidate = new Task(UUID.randomUUID(), title, description, status, priority,
                command.assigneeId(), command.reporterId(), command.dueDate(),
                command.estimateHours(), tags, null, null, 0L);
        return tasks.save(candidate);
    }

    /**
     * FR-B-20: applying the same create twice inside the window returns the first task
     * instead of a duplicate. Matched on trimmed case-insensitive title plus status and
     * assignee, and bounded by {@code createdAt} relative to the injected {@link Clock}.
     */
    private Optional<Task> findRecentDuplicate(String title, TaskStatus status, UUID assigneeId) {
        if (createIdempotencyWindow.isZero() || createIdempotencyWindow.isNegative()) {
            return Optional.empty();
        }
        Instant oldest = clock.instant().minus(createIdempotencyWindow);
        String needle = title == null ? null : title.toLowerCase(Locale.ROOT);
        return tasks.findAll().stream()
                .filter(task -> !task.createdAt().isBefore(oldest))
                .filter(task -> task.status() == status)
                .filter(task -> task.assigneeId() == null ? assigneeId == null
                        : task.assigneeId().equals(assigneeId))
                .filter(task -> needle != null && task.title() != null
                        && task.title().toLowerCase(Locale.ROOT).equals(needle))
                .findFirst();
    }

    // ------------------------------------------------------------------- patch

    /** {@code PATCH /api/tasks/{id}}. */
    public Task patch(UUID id, PatchTaskCommand command, Long expectedVersion) {
        return patch(id, command, expectedVersion, Map.of());
    }

    /**
     * @param rawExtras client field names, so {@code status} can be rejected as a 400 on
     *                  that exact field (FR-B-04) rather than as a generic 422
     */
    public Task patch(UUID id, PatchTaskCommand command, Long expectedVersion,
                      Map<String, Object> rawExtras) {
        Task current = require(id);
        requireVersion(current, expectedVersion);
        rejectServerOwnedFields(rawExtras);
        if (rawExtras != null && rawExtras.containsKey("status")) {
            TaskValidator.rejectStatusChange();
        }

        String title = command.title() == null
                ? current.title()
                : TaskValidator.normalizeTitle(command.title());
        String description = command.description() == null
                ? current.description()
                : TaskValidator.normalizeDescription(command.description());
        TaskPriority priority = command.priority() == null ? current.priority() : command.priority();
        UUID assigneeId = command.assigneeId() == null ? current.assigneeId() : command.assigneeId();
        UUID reporterId = command.reporterId() == null ? current.reporterId() : command.reporterId();
        LocalDate dueDate = command.dueDate() == null ? current.dueDate() : command.dueDate();
        BigDecimal estimateHours = command.estimateHours() == null
                ? current.estimateHours()
                : command.estimateHours();
        List<String> tags = command.tags() == null ? current.tags() : TaskValidator.normalizeTags(command.tags());

        validator.validatePatch(title, description, priority, assigneeId, reporterId, dueDate,
                estimateHours, tags);

        Task merged = new Task(current.id(), title, description, current.status(), priority,
                assigneeId, reporterId, dueDate, estimateHours, tags, current.createdAt(), null,
                current.version());
        if (sameBusinessFields(current, merged)) {
            return current;
        }
        return tasks.save(merged);
    }

    // ------------------------------------------------------------------ delete

    /**
     * {@code DELETE /api/tasks/{id}} — hard delete.
     *
     * <p>{@code force} exists for API symmetry with FR-B-05 but changes nothing: the
     * backend never consults AI state (OPEN-4), so there is no reference to override.
     */
    public void delete(UUID id, boolean force) {
        delete(id, null, force);
    }

    /**
     * {@code 00-index.md} §2.2 carries {@code expectedVersion} as a query parameter on
     * {@code DELETE} as well as {@code PATCH}, so the optimistic-lock check has to happen
     * before the row disappears.
     */
    public void delete(UUID id, Long expectedVersion, boolean force) {
        Task current = require(id);
        requireVersion(current, expectedVersion);
        tasks.deleteById(id);
    }

    // ----------------------------------------------------------- change status

    /** {@code POST /api/tasks/{id}/status}. */
    public Task changeStatus(UUID id, TaskStatus target, boolean reopen, Long expectedVersion) {
        Task current = require(id);
        requireVersion(current, expectedVersion);
        if (TaskStatusMachine.validate(current, target, reopen)) {
            return current;
        }
        return tasks.save(withStatus(current, target));
    }

    // -------------------------------------------------------------- bulk status

    /** {@code POST /api/tasks/bulk-status} — all-or-nothing (FR-B-07, AC-1.5). */
    public BulkOutcome bulkChangeStatus(BulkStatusCommand command) {
        if (command.ids().isEmpty()) {
            throw new ValidationApiException("no tasks selected",
                    List.of(new FieldError("ids", "must contain at least 1 id")));
        }
        if (command.status() == null) {
            throw new ValidationApiException("target status is required",
                    List.of(new FieldError("status", "must not be null")));
        }

        List<Task> found = tasks.findAllById(command.ids());
        Map<UUID, Task> byId = new LinkedHashMap<>(found.stream()
                .collect(Collectors.toMap(Task::id, task -> task)));
        List<UUID> missing = new ArrayList<>(new LinkedHashSet<>(command.ids()));
        missing.removeAll(byId.keySet());
        if (!missing.isEmpty()) {
            throw new NotFoundApiException("no task with id " + missing.stream()
                    .map(UUID::toString).toList());
        }

        Map<UUID, Long> expected = command.expectedVersions();
        for (UUID id : command.ids()) {
            Long expectation = expected.get(id);
            requireVersion(byId.get(id), expectation);
        }

        List<Task> candidates = new ArrayList<>();
        List<String> reasons = new ArrayList<>();
        List<FieldError> errors = new ArrayList<>();
        for (int i = 0; i < command.ids().size(); i++) {
            UUID id = command.ids().get(i);
            Task task = byId.get(id);
            if (task.status() == command.status()) {
                continue;
            }
            try {
                TaskStatusMachine.validate(task, command.status(), false);
                candidates.add(task);
            } catch (ConflictApiException | ValidationApiException ex) {
                reasons.add(task.title() + " (" + task.status() + " → " + command.status() + "): "
                        + ex.getMessage());
                errors.add(new FieldError("ids[" + i + "]", ex.getMessage()));
            }
        }

        if (!reasons.isEmpty()) {
            throw new ConflictApiException("illegal-transition", "Illegal status transition",
                    String.join("; ", reasons), errors);
        }

        List<Task> updated = new ArrayList<>(candidates.size());
        for (Task task : candidates) {
            updated.add(tasks.save(withStatus(task, command.status())));
        }
        return new BulkOutcome(updated.size(), List.copyOf(updated));
    }

    // -------------------------------------------------------------------- read

    /** 404 with the envelope when the id is unknown. */
    public Task require(UUID id) {
        return tasks.findById(id)
                .orElseThrow(() -> new NotFoundApiException("no task with id " + id));
    }

    public Optional<Task> find(UUID id) {
        return tasks.findById(id);
    }

    public PageResponse<Task> findAll(TaskQuery query) {
        return tasks.findAll(query == null ? TaskQuery.defaultQuery() : query);
    }

    public long count() {
        return tasks.count();
    }

    // ----------------------------------------------------------------- helpers

    /**
     * FR-B-19 for every entry point: a client may not supply a server-owned field, no
     * matter which transport delivered it.
     */
    private static void rejectServerOwnedFields(Map<String, Object> rawExtras) {
        if (rawExtras == null || rawExtras.isEmpty()) {
            return;
        }
        for (String field : SERVER_OWNED_FIELDS) {
            if (rawExtras.containsKey(field)) {
                throw new UnprocessableApiException("field '" + field
                        + "' is server-owned and must not be set by a client");
            }
        }
    }

    /** INV-3 also applies to a task created directly in {@code BLOCKED}. */
    private static void requireDescriptionForBlocked(TaskStatus status, String description) {
        if (status == TaskStatus.BLOCKED && (description == null || description.isBlank())) {
            throw new ValidationApiException("a blocked task must describe the blocker",
                    List.of(new FieldError("description", "a blocked task must describe the blocker")));
        }
    }

    /** FR-B-14: a mismatch is a 409 the frontend can recognise by marker. */
    private static void requireVersion(Task current, Long expectedVersion) {
        if (expectedVersion != null && expectedVersion != current.version()) {
            throw ConflictApiException.versionConflict(current.id(), expectedVersion, current.version());
        }
    }

    private static Task withStatus(Task task, TaskStatus status) {
        return new Task(task.id(), task.title(), task.description(), status, task.priority(),
                task.assigneeId(), task.reporterId(), task.dueDate(), task.estimateHours(),
                task.tags(), task.createdAt(), null, task.version());
    }

    /** A patch that changes nothing is not written, so {@code version} does not move. */
    private static boolean sameBusinessFields(Task a, Task b) {
        return Objects.equals(a.title(), b.title())
                && Objects.equals(a.description(), b.description())
                && a.priority() == b.priority()
                && Objects.equals(a.assigneeId(), b.assigneeId())
                && Objects.equals(a.reporterId(), b.reporterId())
                && Objects.equals(a.dueDate(), b.dueDate())
                && Objects.equals(a.estimateHours(), b.estimateHours())
                && a.tags().equals(b.tags());
    }

    /** {@code POST /api/tasks/bulk-status} response body: {@code { updated, tasks }}. */
    public record BulkOutcome(int updated, List<Task> tasks) {
    }
}