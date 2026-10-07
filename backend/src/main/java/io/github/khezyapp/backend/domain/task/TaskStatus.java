package io.github.khezyapp.backend.domain.task;

import java.util.Collections;
import java.util.EnumSet;
import java.util.Set;

/**
 * The single status vocabulary (spec §2.1). The enum name is the wire value and the
 * badge-label source; no second status vocabulary may exist anywhere in the system.
 *
 * <p>Transitions are constrained by FR-B-06 and validated by
 * {@code TaskStatusMachine} (BE-03). This type only <em>reports</em> the table — it never
 * throws.
 */
public enum TaskStatus {

    BACKLOG("Backlog"),
    TODO("To Do"),
    IN_PROGRESS("In Progress"),
    IN_REVIEW("In Review"),
    BLOCKED("Blocked"),
    DONE("Done"),
    CANCELLED("Cancelled");

    private final String label;

    TaskStatus(String label) {
        this.label = label;
    }

    /** Human-readable name for badges and dashboard cards, e.g. {@code "In Review"}. */
    public String label() {
        return label;
    }

    /** {@code true} for {@link #DONE} and {@link #CANCELLED}: no further work is expected. */
    public boolean isTerminal() {
        return this == DONE || this == CANCELLED;
    }

    /**
     * The statuses this one may legally move to.
     *
     * <p>Two invariants shape the table: {@code DONE} never reaches {@code BACKLOG}
     * directly (INV-1), and leaving {@code CANCELLED} requires {@code reopen=true} and
     * lands on {@code TODO} (INV-2).
     *
     * @param reopen the caller's explicit reopen intent; only meaningful for
     *               {@link #CANCELLED}
     * @return an immutable set, empty when no transition is legal without {@code reopen}
     */
    public Set<TaskStatus> allowedTargets(boolean reopen) {
        return switch (this) {
            case BACKLOG -> targets(TODO, CANCELLED);
            case TODO -> targets(BACKLOG, IN_PROGRESS, BLOCKED, CANCELLED);
            case IN_PROGRESS -> targets(TODO, IN_REVIEW, BLOCKED, CANCELLED);
            case IN_REVIEW -> targets(IN_PROGRESS, DONE, TODO, CANCELLED);
            case BLOCKED -> targets(IN_PROGRESS, TODO, CANCELLED);
            case DONE -> targets(IN_REVIEW, CANCELLED);
            case CANCELLED -> reopen ? targets(TODO) : targets();
        };
    }

    private static Set<TaskStatus> targets(TaskStatus... values) {
        if (values.length == 0) {
            return Set.of();
        }
        EnumSet<TaskStatus> set = EnumSet.noneOf(TaskStatus.class);
        Collections.addAll(set, values);
        return Collections.unmodifiableSet(set);
    }
}