package io.github.khezyapp.backend.web;

import java.net.URI;
import java.util.List;
import java.util.UUID;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import io.github.khezyapp.backend.common.PageResponse;
import io.github.khezyapp.backend.domain.TaskQuery;
import io.github.khezyapp.backend.domain.TaskStats;
import io.github.khezyapp.backend.domain.task.Task;
import io.github.khezyapp.backend.error.ApiErrorResponse;
import io.github.khezyapp.backend.error.FieldError;
import io.github.khezyapp.backend.service.TaskPresenter;
import io.github.khezyapp.backend.service.TaskService;
import io.github.khezyapp.backend.service.TaskStatsService;
import io.github.khezyapp.backend.service.TaskValidator;
import io.github.khezyapp.backend.service.command.BulkStatusCommand;
import io.github.khezyapp.backend.service.command.CreateTaskCommand;
import io.github.khezyapp.backend.service.command.PatchTaskCommand;
import io.github.khezyapp.backend.web.dto.BulkStatusRequest;
import io.github.khezyapp.backend.web.dto.BulkStatusResponse;
import io.github.khezyapp.backend.web.dto.StatusChangeRequest;
import io.github.khezyapp.backend.web.dto.TaskCreateRequest;
import io.github.khezyapp.backend.web.dto.TaskPatchRequest;
import io.github.khezyapp.backend.web.dto.TaskResponse;

/**
 * The frozen Phase 1 task surface ({@code 00-index.md} §2.2).
 *
 * <p>Every handler is a thin translation between HTTP and {@link TaskService}: parse,
 * delegate, present. No rule lives here (FR-B-18) and no error body is built here —
 * {@link ApiExceptionHandler} owns the C1 envelope.
 */
@RestController
@RequestMapping("/api/tasks")
public class TaskController {

    private final TaskService service;
    private final TaskPresenter presenter;
    private final TaskQueryFactory queries;
    private final TaskStatsService stats;

    public TaskController(TaskService service, TaskPresenter presenter,
                          TaskQueryFactory queries, TaskStatsService stats) {
        this.service = service;
        this.presenter = presenter;
        this.queries = queries;
        this.stats = stats;
    }

    /**
     * {@code GET /api/tasks} — the C2 list envelope.
     *
     * <p>Enum-valued filters bind as {@code String} so {@code TaskQueryFactory} can name
     * the offending value; see that class for why.
     */
    @GetMapping
    public PageResponse<TaskResponse> list(
            @RequestParam(name = "status", required = false) List<String> status,
            @RequestParam(name = "priority", required = false) List<String> priority,
            @RequestParam(name = "assigneeId", required = false) UUID assigneeId,
            @RequestParam(name = "unassigned", required = false) String unassigned,
            @RequestParam(name = "tag", required = false) String tag,
            @RequestParam(name = "q", required = false) String q,
            @RequestParam(name = "overdue", required = false) String overdue,
            @RequestParam(name = "dueWithinDays", required = false) Integer dueWithinDays,
            @RequestParam(name = "createdFrom", required = false) String createdFrom,
            @RequestParam(name = "createdTo", required = false) String createdTo,
            @RequestParam(name = "sort", required = false) String sort,
            @RequestParam(name = "page", required = false) Integer page,
            @RequestParam(name = "size", required = false) Integer size) {
        TaskQuery query = queries.from(status, priority, assigneeId, unassigned, tag, q,
                overdue, dueWithinDays, createdFrom, createdTo, sort, page, size);
        PageResponse<Task> pageResponse = service.findAll(query);
        return new PageResponse<>(pageResponse.content().stream().map(presenter::toResponse).toList(),
                pageResponse.page(), pageResponse.size(), pageResponse.totalElements(),
                pageResponse.totalPages());
    }

    /**
     * Declared <em>before</em> {@code /{id}} and as a literal, so {@code stats} can never
     * be routed into the id path variable.
     */
    @GetMapping("/stats")
    public TaskStats stats() {
        return stats.compute();
    }

    @GetMapping("/{id}")
    public TaskResponse get(@PathVariable UUID id) {
        return presenter.toResponse(service.require(id));
    }

    @PostMapping
    public ResponseEntity<TaskResponse> create(@Valid @RequestBody TaskCreateRequest request) {
        CreateTaskCommand command = new CreateTaskCommand(
                request.title(), request.description(), request.status(), request.priority(),
                request.assigneeId(), request.reporterId(), request.dueDate(),
                request.estimateHours(), request.tags());
        Task created = service.create(command);
        return ResponseEntity.created(URI.create("/api/tasks/" + created.id()))
                .body(presenter.toResponse(created));
    }

    @PatchMapping("/{id}")
    public TaskResponse patch(@PathVariable UUID id,
                              @RequestParam(name = "expectedVersion", required = false) Long expectedVersion,
                              @Valid @RequestBody TaskPatchRequest request) {
        if (request.status() != null) {
            TaskValidator.rejectStatusChange();
        }
        PatchTaskCommand command = new PatchTaskCommand(
                request.title(), request.description(), request.priority(), request.assigneeId(),
                request.reporterId(), request.dueDate(), request.estimateHours(), request.tags());
        return presenter.toResponse(service.patch(id, command, expectedVersion));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id,
                                       @RequestParam(name = "expectedVersion", required = false) Long expectedVersion,
                                       @RequestParam(name = "force", defaultValue = "false") boolean force) {
        service.delete(id, expectedVersion, force);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/status")
    public TaskResponse status(@PathVariable UUID id,
                               @Valid @RequestBody StatusChangeRequest request) {
        return presenter.toResponse(service.changeStatus(
                id, request.status(), request.reopen(), request.expectedVersion()));
    }

    @PostMapping("/bulk-status")
    public BulkStatusResponse bulk(@Valid @RequestBody BulkStatusRequest request) {
        TaskService.BulkOutcome outcome = service.bulkChangeStatus(new BulkStatusCommand(
                request.ids(), request.status(), request.expectedVersions()));
        return new BulkStatusResponse(outcome.updated(),
                outcome.tasks().stream().map(presenter::toResponse).toList());
    }

    /**
     * A non-UUID path variable is a typo in the URL, so it answers 400 rather than the
     * 422 the global advice uses for unparseable <em>values</em> (FR-B-13: malformed is a
     * 400). A controller-local handler outranks the advice.
     */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    ResponseEntity<ApiErrorResponse> handlePathVariableMismatch(MethodArgumentTypeMismatchException ex,
                                                                 HttpServletRequest request) {
        return ResponseEntity.badRequest().body(ApiErrorResponse.of(
                "validation-failed", 400, "Validation failed",
                "path segment '" + ex.getName() + "' is not a valid "
                        + ex.getRequiredType().getSimpleName(),
                request.getRequestURI(),
                List.of(new FieldError(ex.getName(), "is not a valid value"))));
    }
}