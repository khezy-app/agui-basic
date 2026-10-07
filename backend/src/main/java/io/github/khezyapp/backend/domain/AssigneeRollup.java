package io.github.khezyapp.backend.domain;

import java.util.UUID;

/**
 * One dashboard row per team member (FR-B-08).
 *
 * @param memberId     null for the synthetic "unassigned" rollup the frontend may add
 * @param openCount    the member's tasks whose status is not terminal
 * @param overdueCount the subset of {@code openCount} that is overdue
 */
public record AssigneeRollup(
        UUID memberId,
        String displayName,
        long openCount,
        long overdueCount) {
}