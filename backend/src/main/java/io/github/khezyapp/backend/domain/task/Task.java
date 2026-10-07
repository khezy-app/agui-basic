package io.github.khezyapp.backend.domain.task;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.UUID;

/**
 * A task as the server stores it (spec §2.1).
 *
 * <p>Immutable: no setters, no builders. Field-level rules (length, format, cross-field)
 * are <em>not</em> enforced here — validation is the service layer's job (BE-03), so that
 * one rule set serves both REST and AI tools (FR-B-18).
 *
 * <p>The derived flags {@code isOverdue} and {@code isUnassigned} are deliberately absent:
 * they are computed in {@code TaskPresenter} (BE-04) so the stored type carries no
 * redundant state.
 *
 * @param version optimistic-lock counter, bumped by the repository on every update
 */
public record Task(
        UUID id,
        String title,
        String description,
        TaskStatus status,
        TaskPriority priority,
        UUID assigneeId,
        UUID reporterId,
        LocalDate dueDate,
        BigDecimal estimateHours,
        List<String> tags,
        Instant createdAt,
        Instant updatedAt,
        long version) {

    public Task {
        tags = normalizeTags(tags);
    }

    /**
     * Lower-cases, trims and de-duplicates tags while preserving the order they were
     * supplied in. {@code null} is treated as "no tags".
     */
    private static List<String> normalizeTags(List<String> tags) {
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
        return List.copyOf(new ArrayList<>(normalized));
    }
}