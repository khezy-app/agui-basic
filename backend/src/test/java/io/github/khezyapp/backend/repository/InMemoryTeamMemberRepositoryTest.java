package io.github.khezyapp.backend.repository;

import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import io.github.khezyapp.backend.domain.team.TeamMember;
import io.github.khezyapp.backend.domain.team.TeamMemberRole;

import static org.assertj.core.api.Assertions.assertThat;

class InMemoryTeamMemberRepositoryTest {

    private InMemoryTeamMemberRepository repository;

    @BeforeEach
    void setUp() {
        repository = new InMemoryTeamMemberRepository();
    }

    private TeamMember member(String displayName, TeamMemberRole role) {
        return new TeamMember(UUID.randomUUID(), displayName, displayName.toLowerCase().replace(' ', '.') + "@example.com",
                role);
    }

    @Test
    void findAllIsSortedByDisplayNameCaseInsensitively() {
        repository.save(member("chloe tan", TeamMemberRole.DESIGNER));
        repository.save(member("Ana Reyes", TeamMemberRole.ENGINEER));
        repository.save(member("ben osei", TeamMemberRole.ENGINEER));
        repository.save(member("Zoe Quinn", TeamMemberRole.QA));

        assertThat(repository.findAll()).extracting(TeamMember::displayName)
                .containsExactly("Ana Reyes", "ben osei", "chloe tan", "Zoe Quinn");
    }

    @Test
    void findAllIsEmptyBeforeSeeding() {
        assertThat(repository.findAll()).isEmpty();
    }

    @Test
    void findByIdAndExistsByIdAgreeWithTheStore() {
        TeamMember ana = repository.save(member("Ana Reyes", TeamMemberRole.ENGINEER));
        UUID unknown = UUID.randomUUID();

        assertThat(repository.findById(ana.id())).contains(ana);
        assertThat(repository.existsById(ana.id())).isTrue();
        assertThat(repository.findById(unknown)).isEmpty();
        assertThat(repository.existsById(unknown)).isFalse();
    }

    @Test
    void savingTheSameIdTwiceOverwrites() {
        TeamMember ana = repository.save(member("Ana Reyes", TeamMemberRole.ENGINEER));
        repository.save(new TeamMember(ana.id(), "Ana R.", "ana@example.com", TeamMemberRole.QA));

        assertThat(repository.findAll()).hasSize(1).singleElement()
                .satisfies(found -> {
                    assertThat(found.displayName()).isEqualTo("Ana R.");
                    assertThat(found.role()).isEqualTo(TeamMemberRole.QA);
                });
    }

    @Test
    void orderingIsTotalEvenForNamesThatDifferOnlyByCase() {
        TeamMember upper = repository.save(new TeamMember(UUID.randomUUID(), "Ana", "a@example.com",
                TeamMemberRole.ENGINEER));
        TeamMember lower = repository.save(new TeamMember(UUID.randomUUID(), "ana", "b@example.com",
                TeamMemberRole.ENGINEER));

        assertThat(repository.findAll()).containsExactlyInAnyOrder(upper, lower);
        assertThat(repository.findAll()).isEqualTo(repository.findAll());
    }
}