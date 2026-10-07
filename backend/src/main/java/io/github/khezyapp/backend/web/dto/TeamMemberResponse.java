package io.github.khezyapp.backend.web.dto;

import java.util.UUID;

import io.github.khezyapp.backend.domain.team.TeamMemberRole;

/** {@code GET /api/team-members} element — seeded reference data, read-only (FR-B-09). */
public record TeamMemberResponse(
        UUID id,
        String displayName,
        String email,
        TeamMemberRole role) {
}