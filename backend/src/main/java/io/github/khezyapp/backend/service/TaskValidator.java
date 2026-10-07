package io.github.khezyapp.backend.service;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.UUID;

import org.springframework.stereotype.Component;

import io.github.khezyapp.backend.domain.task.TaskPriority;
import io.github.khezyapp.backend.error.FieldError;
import io.github.khezyapp.backend.error.ValidationApiException;
import io.github.khezyapp.backend.repository.TeamMemberRepository;

/**
 * The one place the §2.1 field rules are enforced (FR-B-11, INV-5, FR-B-18).
 *
 * <p>All violations are collected into one {@link ValidationApiException} — never a
 * fail-on-first-error, because the form shows every bad field at once (AC-1.2).
 * Cross-field rules that need a whole task (INV-1, INV-2, INV-3) belong to
 * {@link TaskStatusMachine}, not here.
 */
@Component
public class TaskValidator {

    public static final int TITLE_MAX = 160;
    public static final int DESCRIPTION_MAX = 4000;
    public static final int TAGS_MAX = 5;
    public static final int TAG_MAX = 24;
    public static final int ESTIMATE_DECIMALS = 1;
    public static final BigDecimal ESTIMATE_MAX = new BigDecimal("999");

    private final TeamMemberRepository members;

    public TaskValidator(TeamMemberRepository members) {
        this.members = members;
    }

    public void validateNew(String title, String description, TaskPriority priority,
                            UUID assigneeId, UUID reporterId, LocalDate dueDate,
                            BigDecimal estimateHours, List<String> tags) {
        validate(title, description, priority, assigneeId, reporterId, dueDate, estimateHours, tags);
    }

    /** Same rules, applied to the merged result of a patch. */
    public void validatePatch(String title, String description, TaskPriority priority,
                              UUID assigneeId, UUID reporterId, LocalDate dueDate,
                              BigDecimal estimateHours, List<String> tags) {
        validate(title, description, priority, assigneeId, reporterId, dueDate, estimateHours, tags);
    }

    public void validate(String title, String description, TaskPriority priority,
                         UUID assigneeId, UUID reporterId, LocalDate dueDate,
                         BigDecimal estimateHours, List<String> tags) {
        List<FieldError> errors = new ArrayList<>();

        if (title == null || title.isBlank()) {
            errors.add(new FieldError("title", "must not be blank"));
        } else if (title.trim().length() > TITLE_MAX) {
            errors.add(new FieldError("title", "must be at most " + TITLE_MAX + " characters"));
        }

        if (description != null && description.length() > DESCRIPTION_MAX) {
            errors.add(new FieldError("description", "must be at most " + DESCRIPTION_MAX + " characters"));
        }

        if (estimateHours != null) {
            if (estimateHours.compareTo(BigDecimal.ZERO) < 0
                    || estimateHours.compareTo(ESTIMATE_MAX) > 0) {
                errors.add(new FieldError("estimateHours", "must be between 0 and " + ESTIMATE_MAX.toPlainString()));
            }
            if (stripTrailingZeros(estimateHours).scale() > ESTIMATE_DECIMALS) {
                errors.add(new FieldError("estimateHours",
                        "must have at most " + ESTIMATE_DECIMALS + " decimal place"));
            }
        }

        collectTagErrors(tags, errors);

        if (priority == null) {
            errors.add(new FieldError("priority", "must not be null"));
        }
        if (assigneeId != null && !members.existsById(assigneeId)) {
            errors.add(new FieldError("assigneeId", "unknown team member"));
        }
        if (reporterId != null && !members.existsById(reporterId)) {
            errors.add(new FieldError("reporterId", "unknown team member"));
        }

        if (!errors.isEmpty()) {
            throw new ValidationApiException(errors.size() + " fields are invalid", errors);
        }
    }

    /** Also public so the create path can enforce INV-3 on a task born {@code BLOCKED}. */
    public static void collectTagErrors(List<String> tags, List<FieldError> sink) {
        if (tags == null) {
            return;
        }
        if (tags.size() > TAGS_MAX) {
            sink.add(new FieldError("tags", "must contain at most " + TAGS_MAX + " entries"));
        }
        for (int i = 0; i < tags.size(); i++) {
            String tag = tags.get(i);
            if (tag == null || tag.isBlank() || tag.trim().length() > TAG_MAX) {
                sink.add(new FieldError("tags[" + i + "]", "must be 1–" + TAG_MAX + " characters"));
            }
        }
    }

    // ---------------------------------------------------------------- normalisation

    /**
     * Trimming and folding happen before validation so the length and blank checks see
     * the value that will actually be stored. Exposed as statics so every caller —
     * REST controller, service, future tool — normalises identically.
     */
    public static String normalizeTitle(String title) {
        return title == null ? null : title.trim();
    }

    /** {@code ""} and whitespace-only descriptions collapse to {@code null}. */
    public static String normalizeDescription(String description) {
        if (description == null) {
            return null;
        }
        String trimmed = description.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    /**
     * {@code null} becomes the empty list; entries are trimmed, lower-cased and
     * de-duplicated while preserving first-seen order. Same rule as
     * {@code Task}'s own constructor, applied here so validation sees the stored form.
     */
    public static List<String> normalizeTags(List<String> tags) {
        if (tags == null || tags.isEmpty()) {
            return List.of();
        }
        LinkedHashSet<String> normalized = new LinkedHashSet<>();
        for (String tag : tags) {
            if (tag == null) {
                continue;
            }
            String value = tag.trim().toLowerCase();
            if (!value.isEmpty()) {
                normalized.add(value);
            }
        }
        return List.copyOf(normalized);
    }

    /** FR-B-04: {@code status} is not a business field and has its own endpoint. */
    public static void rejectStatusChange() {
        throw new ValidationApiException("status cannot be changed via field update",
                List.of(new FieldError("status", "status cannot be changed via field update")));
    }

    /**
     * {@code 1.50} is one decimal place mathematically even though its scale is 2, so
     * trailing zeros are dropped before the scale check.
     */
    private static BigDecimal stripTrailingZeros(BigDecimal value) {
        BigDecimal stripped = value.stripTrailingZeros();
        return stripped.scale() < 0 ? stripped.setScale(0) : stripped;
    }
}