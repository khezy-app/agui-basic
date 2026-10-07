package io.github.khezyapp.backend.domain;

import java.time.Instant;
import java.util.Collections;
import java.util.EnumSet;
import java.util.Set;
import java.util.UUID;

import io.github.khezyapp.backend.domain.task.TaskPriority;
import io.github.khezyapp.backend.domain.task.TaskStatus;

/**
 * A fully normalised list query. Controllers parse and validate request parameters;
 * what reaches the repository is already a {@code TaskQuery}, so a persistence adapter
 * never has to guess at defaults (OPEN-3, FR-B-17).
 *
 * <p>Conventions: an empty collection, {@code null} or {@code false} means "no filter";
 * array filters combine as OR within themselves while separate filters combine as AND.
 *
 * <p>The compact constructor clamps {@code page} and {@code size} into legal bounds and
 * normalises {@code text} and {@code tag} to lower case, treating blank strings as "no
 * filter". Rejecting bad input with an HTTP status is BE-02's job.
 *
 * @param unassignedOnly wins over {@code assigneeId} when both are set
 * @param text           case-insensitive substring matched against title <em>or</em> description
 * @param createdTo      inclusive upper bound
 */
public record TaskQuery(
        Set<TaskStatus> statuses,
        Set<TaskPriority> priorities,
        UUID assigneeId,
        boolean unassignedOnly,
        String tag,
        String text,
        boolean overdueOnly,
        Integer dueWithinDays,
        Instant createdFrom,
        Instant createdTo,
        SortSpec sort,
        int page,
        int size) {

    public static final int DEFAULT_SIZE = 20;
    public static final int MAX_SIZE = 100;

    /** Direction wrapper: {@code CREATED_AT + false} is the documented default. */
    public record SortSpec(TaskSortField field, boolean descending) {

        public static SortSpec ascending(TaskSortField field) {
            return new SortSpec(field, false);
        }

        public static SortSpec descending(TaskSortField field) {
            return new SortSpec(field, true);
        }
    }

    public TaskQuery {
        statuses = immutableEnumSet(TaskStatus.class, statuses);
        priorities = immutableEnumSet(TaskPriority.class, priorities);
        tag = normalizeToken(tag);
        text = normalizeToken(text);
        page = Math.max(page, 0);
        size = Math.min(Math.max(size, 1), MAX_SIZE);
        sort = sort == null ? SortSpec.descending(TaskSortField.CREATED_AT) : sort;
    }

    /** The documented default: newest first, page 0, 20 per page, no filters. */
    public static TaskQuery defaultQuery() {
        return new TaskQuery(null, null, null, false, null, null, false, null, null, null,
                SortSpec.descending(TaskSortField.CREATED_AT), 0, DEFAULT_SIZE);
    }

    /** {@code true} when no filter at all is applied — paging and sorting only. */
    public boolean isEmpty() {
        return statuses.isEmpty()
                && priorities.isEmpty()
                && assigneeId == null
                && !unassignedOnly
                && tag == null
                && text == null
                && !overdueOnly
                && dueWithinDays == null
                && createdFrom == null
                && createdTo == null;
    }

    /** Starts a builder pre-populated with this query's filters; paging/sort are reset. */
    public Builder toBuilder() {
        return new Builder()
                .statuses(statuses)
                .priorities(priorities)
                .assigneeId(assigneeId)
                .unassignedOnly(unassignedOnly)
                .tag(tag)
                .text(text)
                .overdueOnly(overdueOnly)
                .dueWithinDays(dueWithinDays)
                .createdFrom(createdFrom)
                .createdTo(createdTo)
                .sort(sort);
    }

    private static <E extends Enum<E>> Set<E> immutableEnumSet(Class<E> type, Set<E> values) {
        if (values == null || values.isEmpty()) {
            return Set.of();
        }
        EnumSet<E> set = EnumSet.noneOf(type);
        set.addAll(values);
        return Collections.unmodifiableSet(set);
    }

    private static String normalizeToken(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim().toLowerCase();
        return trimmed.isEmpty() ? null : trimmed;
    }

    /** Fluent construction for the parse layer in BE-04 and tests. */
    public static final class Builder {

        private Set<TaskStatus> statuses;
        private Set<TaskPriority> priorities;
        private UUID assigneeId;
        private boolean unassignedOnly;
        private String tag;
        private String text;
        private boolean overdueOnly;
        private Integer dueWithinDays;
        private Instant createdFrom;
        private Instant createdTo;
        private SortSpec sort;
        private int page;
        private int size = DEFAULT_SIZE;

        public Builder statuses(Set<TaskStatus> statuses) {
            this.statuses = statuses;
            return this;
        }

        public Builder statuses(TaskStatus... statuses) {
            return statuses(Set.of(statuses));
        }

        public Builder priorities(Set<TaskPriority> priorities) {
            this.priorities = priorities;
            return this;
        }

        public Builder priorities(TaskPriority... priorities) {
            return priorities(Set.of(priorities));
        }

        public Builder assigneeId(UUID assigneeId) {
            this.assigneeId = assigneeId;
            return this;
        }

        public Builder unassignedOnly(boolean unassignedOnly) {
            this.unassignedOnly = unassignedOnly;
            return this;
        }

        public Builder tag(String tag) {
            this.tag = tag;
            return this;
        }

        public Builder text(String text) {
            this.text = text;
            return this;
        }

        public Builder overdueOnly(boolean overdueOnly) {
            this.overdueOnly = overdueOnly;
            return this;
        }

        public Builder dueWithinDays(Integer dueWithinDays) {
            this.dueWithinDays = dueWithinDays;
            return this;
        }

        public Builder createdFrom(Instant createdFrom) {
            this.createdFrom = createdFrom;
            return this;
        }

        public Builder createdTo(Instant createdTo) {
            this.createdTo = createdTo;
            return this;
        }

        public Builder sort(SortSpec sort) {
            this.sort = sort;
            return this;
        }

        public Builder page(int page) {
            this.page = page;
            return this;
        }

        public Builder size(int size) {
            this.size = size;
            return this;
        }

        public TaskQuery build() {
            return new TaskQuery(statuses, priorities, assigneeId, unassignedOnly, tag, text,
                    overdueOnly, dueWithinDays, createdFrom, createdTo, sort, page, size);
        }
    }
}