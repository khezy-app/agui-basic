package io.github.khezyapp.backend.domain.team;

import java.util.UUID;

/**
 * A seeded, read-only reference record (spec §2.2). There are no CRUD endpoints beyond
 * listing; ids are fixed seed values so a restarted server keeps the same URLs.
 */
public record TeamMember(
        UUID id,
        String displayName,
        String email,
        TeamMemberRole role) {
}