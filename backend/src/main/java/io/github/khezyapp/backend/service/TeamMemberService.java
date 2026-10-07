package io.github.khezyapp.backend.service;

import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Service;

import io.github.khezyapp.backend.domain.team.TeamMember;
import io.github.khezyapp.backend.error.NotFoundApiException;
import io.github.khezyapp.backend.repository.TeamMemberRepository;

/**
 * Read access to the seeded team members plus the name/email resolution the AI needs
 * (FR-AI-12). Seeded reference data has no create/update path; only the seeder writes.
 */
@Service
public class TeamMemberService {

    private final TeamMemberRepository members;

    public TeamMemberService(TeamMemberRepository members) {
        this.members = members;
    }

    /** Ordered by {@code displayName}, case-insensitively (FR-B-09). */
    public List<TeamMember> findAll() {
        return members.findAll();
    }

    public TeamMember require(UUID id) {
        return members.findById(id)
                .orElseThrow(() -> new NotFoundApiException("no team member with id " + id));
    }

    /**
     * Resolution order: case-insensitive exact match on {@code displayName} or
     * {@code email}, then a case-insensitive {@code displayName} substring match. Exact
     * first so "ann" never steals "Anna Kowalska" when an "Ann Byers" exists.
     */
    public Optional<TeamMember> findByName(String name) {
        if (name == null || name.isBlank()) {
            return Optional.empty();
        }
        String needle = name.trim();
        List<TeamMember> all = members.findAll();
        return all.stream()
                .filter(member -> equalsIgnoreCase(member.displayName(), needle)
                        || equalsIgnoreCase(member.email(), needle))
                .findFirst()
                .or(() -> all.stream()
                        .filter(member -> containsIgnoreCase(member.displayName(), needle))
                        .findFirst());
    }

    public Optional<TeamMember> findByEmail(String email) {
        if (email == null || email.isBlank()) {
            return Optional.empty();
        }
        String needle = email.trim();
        return members.findAll().stream()
                .filter(member -> equalsIgnoreCase(member.email(), needle))
                .findFirst();
    }

    private static boolean equalsIgnoreCase(String value, String needle) {
        return value != null && value.toLowerCase(Locale.ROOT).equals(needle.toLowerCase(Locale.ROOT));
    }

    private static boolean containsIgnoreCase(String value, String needle) {
        return value != null && value.toLowerCase(Locale.ROOT).contains(needle.toLowerCase(Locale.ROOT));
    }
}