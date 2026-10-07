package io.github.khezyapp.backend.web;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

import org.springframework.stereotype.Component;

import io.github.khezyapp.backend.domain.TaskQuery;
import io.github.khezyapp.backend.domain.TaskSortField;
import io.github.khezyapp.backend.domain.task.TaskPriority;
import io.github.khezyapp.backend.domain.task.TaskStatus;
import io.github.khezyapp.backend.error.FieldError;
import io.github.khezyapp.backend.error.UnprocessableApiException;
import io.github.khezyapp.backend.error.ValidationApiException;

/**
 * {@code FR-B-01} query parameters → a fully normalised {@link TaskQuery} (OPEN-3).
 *
 * <p>Everything a filter can get wrong is settled here so the controller is a one-liner
 * and the repository never has to guess (FR-B-17). Enum-ish parameters arrive as
 * {@code String} rather than {@code TaskStatus}/{@code TaskPriority} on purpose: binding
 * them as enums would turn a bad value into Spring's generic type-mismatch error, and
 * the client deserves to be told <em>which</em> value was wrong.
 */
@Component
public class TaskQueryFactory {

    private final Clock clock;

    public TaskQueryFactory(Clock clock) {
        this.clock = clock;
    }

    /**
     * Boolean and date parameters arrive as {@code String} so a bad value produces a 422
     * naming the offending text. Spring's own type binding would turn {@code unassigned=yes}
     * or {@code createdFrom=yesterday} into a generic type-mismatch error instead.
     */
    public TaskQuery from(List<String> status, List<String> priority,
                          java.util.UUID assigneeId, String unassigned, String tag, String q,
                          String overdue, Integer dueWithinDays,
                          String createdFrom, String createdTo,
                          String sort, Integer page, Integer size) {
        Set<TaskStatus> statuses = parseEnumValues(status, TaskStatus.class, "status");
        Set<TaskPriority> priorities = parseEnumValues(priority, TaskPriority.class, "priority");
        TaskQuery.SortSpec sortSpec = parseSort(sort);
        int parsedPage = parsePage(page);
        int parsedSize = parseSize(size);
        boolean unassignedOnly = parseBoolean(unassigned, "unassigned");
        boolean overdueOnly = parseBoolean(overdue, "overdue");
        java.time.LocalDate from = parseDate(createdFrom, "createdFrom");
        java.time.LocalDate to = parseDate(createdTo, "createdTo");

        if (dueWithinDays != null && dueWithinDays < 0) {
            throw new ValidationApiException("dueWithinDays must not be negative",
                    List.of(new FieldError("dueWithinDays", "must be greater than or equal to 0")));
        }

        return new TaskQuery(
                statuses,
                priorities,
                assigneeId,
                unassignedOnly,
                tag,
                q,
                overdueOnly,
                dueWithinDays,
                startOfDay(from),
                endOfDay(to),
                sortSpec,
                parsedPage,
                parsedSize);
    }

    private <E extends Enum<E>> Set<E> parseEnumValues(List<String> values, Class<E> type, String param) {
        if (values == null || values.isEmpty()) {
            return Set.of();
        }
        Set<E> parsed = new LinkedHashSet<>();
        for (String value : values) {
            if (value == null || value.isBlank()) {
                continue;
            }
            String candidate = value.trim().toUpperCase(Locale.ROOT);
            try {
                parsed.add(Enum.valueOf(type, candidate));
            } catch (IllegalArgumentException ex) {
                throw new UnprocessableApiException("unknown " + param + " value '" + value.trim()
                        + "'; allowed values are " + allowed(type));
            }
        }
        return parsed;
    }

    private static boolean parseBoolean(String value, String param) {
        if (value == null || value.isBlank()) {
            return false;
        }
        String candidate = value.trim();
        if ("true".equalsIgnoreCase(candidate)) {
            return true;
        }
        if ("false".equalsIgnoreCase(candidate)) {
            return false;
        }
        throw new UnprocessableApiException(param + " must be 'true' or 'false', got '" + candidate + "'");
    }

    private static java.time.LocalDate parseDate(String value, String param) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return java.time.LocalDate.parse(value.trim());
        } catch (java.time.format.DateTimeParseException ex) {
            throw new UnprocessableApiException(param + " must be a yyyy-MM-dd date, got '" + value.trim() + "'");
        }
    }

    private TaskQuery.SortSpec parseSort(String sort) {
        if (sort == null || sort.isBlank()) {
            return TaskQuery.SortSpec.descending(TaskSortField.CREATED_AT);
        }
        boolean descending = sort.startsWith("-");
        String field = (descending ? sort.substring(1) : sort).trim();
        TaskSortField resolved = null;
        for (TaskSortField candidate : TaskSortField.values()) {
            if (candidate.wireName().equals(field)) {
                resolved = candidate;
                break;
            }
        }
        if (resolved == null) {
            throw new UnprocessableApiException("unknown sort field '" + field
                    + "'; allowed fields are " + allowedSortFields());
        }
        return descending ? TaskQuery.SortSpec.descending(resolved) : TaskQuery.SortSpec.ascending(resolved);
    }

    private static int parsePage(Integer page) {
        if (page == null) {
            return 0;
        }
        if (page < 0) {
            throw new ValidationApiException("page must not be negative",
                    List.of(new FieldError("page", "must be greater than or equal to 0")));
        }
        return page;
    }

    private static int parseSize(Integer size) {
        if (size == null) {
            return TaskQuery.DEFAULT_SIZE;
        }
        if (size < 1 || size > TaskQuery.MAX_SIZE) {
            throw new ValidationApiException("size must be between 1 and " + TaskQuery.MAX_SIZE,
                    List.of(new FieldError("size", "must be between 1 and " + TaskQuery.MAX_SIZE)));
        }
        return size;
    }

    private Instant startOfDay(java.time.LocalDate date) {
        return date == null ? null : date.atStartOfDay(zone()).toInstant();
    }

    /** Inclusive upper bound: a {@code createdTo} date includes everything up to 23:59:59.999999999. */
    private Instant endOfDay(java.time.LocalDate date) {
        return date == null ? null : date.atTime(LocalTime.MAX).atZone(zone()).toInstant();
    }

    private ZoneId zone() {
        return clock.getZone();
    }

    /** Wire names, not enum constants — these are what the client actually sends. */
    private static String allowedSortFields() {
        List<String> names = new ArrayList<>();
        for (TaskSortField field : TaskSortField.values()) {
            names.add(field.wireName());
        }
        return String.join(", ", names);
    }

    private static String allowed(Class<? extends Enum<?>> type) {
        List<String> names = new ArrayList<>();
        for (Enum<?> constant : type.getEnumConstants()) {
            names.add(constant.name());
        }
        return String.join(", ", names);
    }
}