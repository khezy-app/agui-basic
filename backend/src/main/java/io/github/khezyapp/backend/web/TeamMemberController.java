package io.github.khezyapp.backend.web;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import io.github.khezyapp.backend.domain.team.TeamMember;
import io.github.khezyapp.backend.service.TeamMemberService;
import io.github.khezyapp.backend.web.dto.TeamMemberResponse;

/**
 * {@code GET /api/team-members} (FR-B-09). Seeded reference data with no write surface,
 * so this controller has exactly one handler.
 */
@RestController
@RequestMapping("/api/team-members")
public class TeamMemberController {

    private final TeamMemberService members;

    public TeamMemberController(TeamMemberService members) {
        this.members = members;
    }

    @GetMapping
    public List<TeamMemberResponse> list() {
        return members.findAll().stream()
                .map(TeamMemberController::toResponse)
                .toList();
    }

    private static TeamMemberResponse toResponse(TeamMember member) {
        return new TeamMemberResponse(member.id(), member.displayName(), member.email(), member.role());
    }
}