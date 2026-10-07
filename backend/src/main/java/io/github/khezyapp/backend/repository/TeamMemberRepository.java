package io.github.khezyapp.backend.repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import io.github.khezyapp.backend.domain.team.TeamMember;

/**
 * Read-mostly port for the seeded team members (spec §2.2).
 *
 * <p>{@link #save} exists even though the resource has no write endpoints: the seeder
 * needs it to populate the store, and keeping the port free of any other mutator stops a
 * CRUD surface from appearing later by accident.
 */
public interface TeamMemberRepository {

    /** @return every member, ordered by {@code displayName}, case-insensitively */
    List<TeamMember> findAll();

    Optional<TeamMember> findById(UUID id);

    boolean existsById(UUID id);

    TeamMember save(TeamMember member);
}