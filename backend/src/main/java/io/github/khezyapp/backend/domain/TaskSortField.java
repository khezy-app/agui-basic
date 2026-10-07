package io.github.khezyapp.backend.domain;

/** The sortable columns of the task list (FR-B-01). */
public enum TaskSortField {

    CREATED_AT("createdAt"),
    UPDATED_AT("updatedAt"),
    DUE_DATE("dueDate"),
    TITLE("title"),
    PRIORITY("priority"),
    STATUS("status");

    private final String wireName;

    TaskSortField(String wireName) {
        this.wireName = wireName;
    }

    /** The value clients send in the {@code sort} query parameter. */
    public String wireName() {
        return wireName;
    }
}