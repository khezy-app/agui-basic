package io.github.khezyapp.backend.service;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import io.github.khezyapp.backend.domain.task.Task;
import io.github.khezyapp.backend.domain.task.TaskPriority;
import io.github.khezyapp.backend.domain.task.TaskStatus;
import io.github.khezyapp.backend.error.ConflictApiException;
import io.github.khezyapp.backend.error.FieldError;
import io.github.khezyapp.backend.error.ValidationApiException;

/**
 * The one canonical status-transition authority (OPEN-1, INV-1, INV-2, INV-3, FR-B-06).
 *
 * <p>Pure and static: no Spring, no clock, no repository. The table itself lives on
 * {@link TaskStatus#allowedTargets(boolean)} (BE-01) — this type only applies the
 * cross-field rules around it and turns a refusal into a message the UI can show verbatim
 * (FR-F-08 / AC-1.3).
 */
public final class TaskStatusMachine {

    public static final TaskStatus DEFAULT_STATUS = TaskStatus.TODO;
    public static final TaskPriority DEFAULT_PRIORITY = TaskPriority.MEDIUM;

    private TaskStatusMachine() {
    }

    /** Delegates to {@link TaskStatus#allowedTargets(boolean)}; no second table exists. */
    public static Set<TaskStatus> allowedTargets(TaskStatus from, boolean reopen) {
        return from.allowedTargets(reopen);
    }

    public static boolean isLegal(TaskStatus from, TaskStatus to, boolean reopen) {
        return allowedTargets(from, reopen).contains(to);
    }

    /** True when the target equals the current status, i.e. the change is a no-op. */
    public static boolean isNoOp(Task task, TaskStatus target) {
        return task.status() == target;
    }

    /**
     * Rules are evaluated in a fixed order and the <em>first</em> failure wins, so the same
     * illegal request always produces the same message.
     *
     * <ol>
     *   <li>target == current → legal no-op, nothing to check</li>
     *   <li>{@code CANCELLED} without {@code reopen} → 409 {@code illegal-transition}</li>
     *   <li>{@code reopen} with a non-{@code TODO} target → 400 on field {@code reopen}</li>
     *   <li>not in the transition table → 409 {@code illegal-transition} with allowed targets</li>
     *   <li>entering {@code BLOCKED} without a description → 400 on field {@code description}
     *       (INV-3)</li>
     * </ol>
     *
     * @return {@code true} when the transition is a no-op and nothing should be written
     * @throws ConflictApiException  409 for an illegal transition or a missing reopen intent
     * @throws ValidationApiException 400 for a malformed request or a blocked task with no description
     */
    public static boolean validate(Task task, TaskStatus target, boolean reopen) {
        TaskStatus current = task.status();

        if (isNoOp(task, target)) {
            return true;
        }
        if (current == TaskStatus.CANCELLED && !reopen) {
            throw ConflictApiException.illegalTransition(
                    "`" + current + "` is terminal: a cancelled task must be reopened explicitly "
                            + "(reopen=true with target `TODO`). Allowed targets from `" + current
                            + "` without reopen: none.");
        }
        if (reopen && target != TaskStatus.TODO) {
            throw new ValidationApiException("reopen is only meaningful when reopening a cancelled task",
                    List.of(new FieldError("reopen",
                            "reopen=true is only allowed together with target TODO")));
        }
        if (!isLegal(current, target, reopen)) {
            throw ConflictApiException.illegalTransition(illegalMessage(current, target, reopen));
        }
        if (target == TaskStatus.BLOCKED && isBlank(task.description())) {
            throw new ValidationApiException("a blocked task must describe the blocker",
                    List.of(new FieldError("description", "a blocked task must describe the blocker")));
        }
        return false;
    }

    /**
     * The exact wording the UI renders (AC-1.3):
     * {@code IN_REVIEW → BACKLOG is not allowed. Allowed targets from IN_REVIEW: …}.
     * Targets are listed in {@link TaskStatus} declaration order.
     */
    public static String illegalMessage(TaskStatus from, TaskStatus to, boolean reopen) {
        return "`" + from + "` → `" + to + "` is not allowed. Allowed targets from `" + from + "`: "
                + allowedTargets(from, reopen).stream()
                        .map(status -> "`" + status + "`")
                        .collect(Collectors.joining(", ")) + ".";
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}