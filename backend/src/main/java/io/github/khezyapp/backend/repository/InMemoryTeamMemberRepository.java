package io.github.khezyapp.backend.repository;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Repository;

import io.github.khezyapp.backend.domain.team.TeamMember;

/**
 * In-memory {@link TeamMemberRepository}. The store starts empty; the seeder (BE-05)
 * populates it with fixed ids on first boot.
 */
@Repository
public class InMemoryTeamMemberRepository implements TeamMemberRepository {

    private static final Comparator<TeamMember> BY_DISPLAY_NAME = Comparator
            .comparing(TeamMember::displayName, String.CASE_INSENSITIVE_ORDER)
            .thenComparing(member -> member.id().toString());

    private final Map<UUID, TeamMember> store = new ConcurrentHashMap<>();

    /**
     * {@inheritDoc}
     *
     * <p>Ordering is case-insensitive on {@code displayName} with an id tiebreak, so a
     * lower-case name sorts as a human would expect and the order is total.
     */
    @Override
    public List<TeamMember> findAll() {
        return store.values().stream().sorted(BY_DISPLAY_NAME).toList();
    }

    @Override
    public Optional<TeamMember> findById(UUID id) {
        return Optional.ofNullable(store.get(id));
    }

    @Override
    public boolean existsById(UUID id) {
        return store.containsKey(id);
    }

    @Override
    public TeamMember save(TeamMember member) {
        store.put(member.id(), member);
        return member;
    }
}