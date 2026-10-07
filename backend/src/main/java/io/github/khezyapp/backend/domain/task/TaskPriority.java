package io.github.khezyapp.backend.domain.task;

/**
 * Priority vocabulary (spec §2.1). Declaration order is the severity order, so
 * {@link #ordinal()} would sort correctly — but {@link #rank()} is the pinned accessor
 * and sorting must use it rather than the ordinal (FR-B-01).
 */
public enum TaskPriority {

    LOW("Low"),
    MEDIUM("Medium"),
    HIGH("High"),
    URGENT("Urgent");

    private final String label;

    TaskPriority(String label) {
        this.label = label;
    }

    public String label() {
        return label;
    }

    /** Sort weight, ascending: {@code LOW = 0} … {@code URGENT = 3}. */
    public int rank() {
        return ordinal();
    }
}