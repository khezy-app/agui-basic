package io.github.khezyapp.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import io.github.khezyapp.backend.domain.team.TeamMember;
import io.github.khezyapp.backend.domain.team.TeamMemberRole;
import io.github.khezyapp.backend.error.NotFoundApiException;
import io.github.khezyapp.backend.repository.InMemoryTeamMemberRepository;

class TeamMemberServiceTest {

    private static final UUID ADA = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");
    private static final UUID ANN = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000002");
    private static final UUID ANNA = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000003");

    private TeamMemberService service;

    @BeforeEach
    void setUp() {
        InMemoryTeamMemberRepository members = new InMemoryTeamMemberRepository();
        members.save(new TeamMember(ADA, "Ada Lovelace", "ada@example.test", TeamMemberRole.ENGINEER));
        members.save(new TeamMember(ANN, "Ann Byers", "ann@example.test", TeamMemberRole.QA));
        members.save(new TeamMember(ANNA, "Anna Kowalska", "anna.k@example.test",
                TeamMemberRole.DESIGNER));
        service = new TeamMemberService(members);
    }

    @Test
    void findAllIsOrderedByDisplayName() {
        assertThat(service.findAll()).extracting(TeamMember::displayName)
                .containsExactly("Ada Lovelace", "Ann Byers", "Anna Kowalska");
    }

    @Test
    void requireReturnsTheMember() {
        assertThat(service.require(ADA).displayName()).isEqualTo("Ada Lovelace");
    }

    @Test
    void requireThrows404ForAnUnknownId() {
        UUID missing = UUID.randomUUID();

        assertThatThrownBy(() -> service.require(missing))
                .isInstanceOf(NotFoundApiException.class)
                .hasMessage("no team member with id " + missing);
    }

    @Test
    void findByNameMatchesDisplayNameCaseInsensitively() {
        assertThat(service.findByName("ada lovelace")).map(TeamMember::id).contains(ADA);
        assertThat(service.findByName("  ADA  ")).map(TeamMember::id).contains(ADA);
    }

    @Test
    void findByNameMatchesTheEmailToo() {
        assertThat(service.findByName("ada@example.test")).map(TeamMember::id).contains(ADA);
    }

    @Test
    void findByNamePrefersAnExactMatchOverASubstring() {
        assertThat(service.findByName("ann")).map(TeamMember::id).contains(ANN);
    }

    @Test
    void findByNameFallsBackToASubstringMatch() {
        assertThat(service.findByName("kowalska")).map(TeamMember::id).contains(ANNA);
    }

    @Test
    void findByNameReturnsEmptyForBlankOrUnknownInput() {
        assertThat(service.findByName(null)).isEmpty();
        assertThat(service.findByName("   ")).isEmpty();
        assertThat(service.findByName("nobody here")).isEmpty();
    }

    @Test
    void findByEmailIsCaseInsensitiveAndExact() {
        assertThat(service.findByEmail("ANN@EXAMPLE.TEST")).map(TeamMember::id).contains(ANN);
        assertThat(service.findByEmail("example.test")).isEmpty();
        assertThat(service.findByEmail(null)).isEmpty();
    }
}