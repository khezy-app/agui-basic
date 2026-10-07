package io.github.khezyapp.backend.repository;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Collection;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.stream.Stream;

import org.springframework.stereotype.Repository;

import io.github.khezyapp.backend.common.PageResponse;
import io.github.khezyapp.backend.domain.TaskQuery;
import io.github.khezyapp.backend.domain.TaskSortField;
import io.github.khezyapp.backend.domain.task.Task;

/**
 * In-memory {@link TaskRepository} for the demo scale of FR-B-15. Swapping in a JDBC
 * adapter must not change anything above this boundary.
 *
 * <p>Storage is a {@link ConcurrentHashMap} of immutable records, so a reader always sees
 * either the old task or the new one, never a half-updated one. Timestamps come from the
 * injected {@link Clock}; nothing here calls {@code Instant.now()}.
 */
@Repository
public class InMemoryTaskRepository implements TaskRepository {

    private final Map<UUID, Task> store = new ConcurrentHashMap<>();
    private final Clock clock;

    public InMemoryTaskRepository(Clock clock) {
        this.clock = clock;
    }

    /**
     * {@inheritDoc}
     *
     * <p>An insert stamps {@code version = 1}. An overwrite takes the existing task's
     * {@code version + 1} and {@code updatedAt = now} — the optimistic-locking primitive
     * the service layer compares against before calling.
     *
     * <p>{@code createdAt}/{@code updatedAt} supplied by the caller are honoured on insert
     * only, which is what lets the seeder backdate its fixture data; the write path leaves
     * them null and lets the clock stamp them (INV-5).
     */
    @Override
    public Task save(Task task) {
        Task existing = store.get(task.id());
        Instant now = clock.instant();

        Task stored = existing == null
                ? copyOf(task, task.createdAt() != null ? task.createdAt() : now,
                        task.updatedAt() != null ? task.updatedAt() : now, 1)
                : copyOf(task, existing.createdAt(), now, existing.version() + 1);

        store.put(stored.id(), stored);
        return stored;
    }

    @Override
    public Optional<Task> findById(UUID id) {
        return Optional.ofNullable(store.get(id));
    }

    @Override
    public List<Task> findAllById(Collection<UUID> ids) {
        if (ids == null || ids.isEmpty()) {
            return List.of();
        }
        return ids.stream().map(store::get).filter(Objects::nonNull).toList();
    }

    @Override
    public boolean deleteById(UUID id) {
        return store.remove(id) != null;
    }

    @Override
    public PageResponse<Task> findAll(TaskQuery query) {
        List<Task> matching = matching(query).toList();
        int from = Math.min(query.page() * query.size(), matching.size());
        int to = Math.min(from + query.size(), matching.size());
        return PageResponse.of(matching.subList(from, to), query.page(), query.size(), matching.size());
    }

    /**
     * {@inheritDoc}
     *
     * <p>Ordered by {@code createdAt} descending then id, matching the default list sort,
     * so "everything" and "the unfiltered first page" agree.
     */
    @Override
    public List<Task> findAll() {
        return store.values().stream().sorted(comparator(TaskQuery.SortSpec.descending(TaskSortField.CREATED_AT))).toList();
    }

    @Override
    public long count() {
        return store.size();
    }

    private Stream<Task> matching(TaskQuery query) {
        LocalDate today = LocalDate.now(clock);
        return store.values().stream().filter(matching(query, today)).sorted(comparator(query.sort()));
    }

    private static Predicate<Task> matching(TaskQuery query, LocalDate today) {
        String text = query.text();
        String tag = query.tag();
        Integer dueWithinDays = query.dueWithinDays();

        return task -> {
            if (!query.statuses().isEmpty() && !query.statuses().contains(task.status())) {
                return false;
            }
            if (!query.priorities().isEmpty() && !query.priorities().contains(task.priority())) {
                return false;
            }
            if (query.unassignedOnly()) {
                if (task.assigneeId() != null) {
                    return false;
                }
            } else if (query.assigneeId() != null && !query.assigneeId().equals(task.assigneeId())) {
                return false;
            }
            if (tag != null && !task.tags().contains(tag)) {
                return false;
            }
            if (text != null && !matchesText(task, text)) {
                return false;
            }
            if (query.overdueOnly() && !isOverdue(task, today)) {
                return false;
            }
            if (dueWithinDays != null
                    && (task.dueDate() == null || task.dueDate().isAfter(today.plusDays(dueWithinDays)))) {
                return false;
            }
            if (query.createdFrom() != null && task.createdAt().isBefore(query.createdFrom())) {
                return false;
            }
            return query.createdTo() == null || !task.createdAt().isAfter(query.createdTo());
        };
    }

    private static boolean matchesText(Task task, String lowerCaseText) {
        return containsIgnoreCase(task.title(), lowerCaseText)
                || containsIgnoreCase(task.description(), lowerCaseText);
    }

    private static boolean containsIgnoreCase(String value, String lowerCaseNeedle) {
        return value != null && value.toLowerCase().contains(lowerCaseNeedle);
    }

    /**
     * OPEN-5: overdue means {@code dueDate <= today} <em>and</em> a non-terminal status.
     * One definition, so the list filter, the dashboard and {@code TaskPresenter} cannot
     * drift apart.
     */
    public static boolean isOverdue(Task task, LocalDate today) {
        return task.dueDate() != null && !task.dueDate().isAfter(today) && !task.status().isTerminal();
    }

    private static Comparator<Task> comparator(TaskQuery.SortSpec sort) {
        return directed(sort).thenComparing(Task::id);
    }

    private static Comparator<Task> directed(TaskQuery.SortSpec sort) {
        boolean descending = sort.descending();
        return switch (sort.field()) {
            case CREATED_AT -> by(Task::createdAt, descending);
            case UPDATED_AT -> by(Task::updatedAt, descending);
            case DUE_DATE -> by(Task::dueDate, descending);
            case TITLE -> by(Task::title, descending);
            case PRIORITY -> by(task -> task.priority().rank(), descending);
            case STATUS -> by(task -> task.status().name(), descending);
        };
    }

    /**
     * Nulls always sort last, in both directions. Letting them sort first in a descending
     * sort would page the tasks without due dates in and out of every page.
     */
    private static <U extends Comparable<? super U>> Comparator<Task> by(Function<Task, U> keyExtractor,
            boolean descending) {
        Comparator<U> keys = descending ? Comparator.reverseOrder() : Comparator.naturalOrder();
        return Comparator.comparing(keyExtractor, Comparator.nullsLast(keys));
    }

    private static Task copyOf(Task task, Instant createdAt, Instant updatedAt, long version) {
        return new Task(task.id(), task.title(), task.description(), task.status(), task.priority(),
                task.assigneeId(), task.reporterId(), task.dueDate(), task.estimateHours(),
                task.tags(), createdAt, updatedAt, version);
    }
}