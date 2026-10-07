package io.github.khezyapp.backend.domain.team;

/** Role of a team member (spec §2.2). Reference data only — no lifecycle beyond the seed. */
public enum TeamMemberRole {

    ENGINEER("Engineer"),
    DESIGNER("Designer"),
    PRODUCT_OWNER("Product Owner"),
    QA("QA");

    private final String label;

    TeamMemberRole(String label) {
        this.label = label;
    }

    public String label() {
        return label;
    }
}