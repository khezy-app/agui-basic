package io.github.khezyapp.backend.agent;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The system prompt is a contract (FR-AI-10/13/28/29/30/31, FR-S-01, FR-S-03), so these
 * assertions pin the parts that must not drift. They are cheap and they fail loudly when
 * a "small cleanup" to the prompt would break the demo.
 *
 * <p>Note these check the prompt's <em>content</em>, not that a model obeys it — that is
 * verified manually (NFR-10: no model in CI).
 */
class AgentPromptsTest {

    /** The C4 table exactly as it appears in {@code 00-index.md} §C4 and the frontend mirror. */
    private static final String C4_TABLE = """
            BACKLOG     → TODO, CANCELLED
            TODO        → IN_PROGRESS, BLOCKED, CANCELLED, BACKLOG
            IN_PROGRESS → IN_REVIEW, BLOCKED, TODO, CANCELLED
            IN_REVIEW   → DONE, IN_PROGRESS, CANCELLED, TODO
            BLOCKED     → IN_PROGRESS, TODO, CANCELLED
            DONE        → IN_REVIEW, CANCELLED          (DONE → BACKLOG forbidden, INV-1)
            CANCELLED   → (only via reopen=true → TODO, INV-2)""";

    @Test
    void theTransitionTableIsTheC4TableVerbatim() {
        assertThat(AgentPrompts.STATUS_TRANSITIONS).isEqualTo(C4_TABLE);
        assertThat(AgentPrompts.SYSTEM_PROMPT).contains(C4_TABLE);
    }

    @Test
    void everyStatusAndPriorityIsNamed() {
        assertThat(AgentPrompts.SYSTEM_PROMPT)
                .contains("BACKLOG, TODO, IN_PROGRESS, IN_REVIEW, BLOCKED, DONE, CANCELLED")
                .contains("LOW, MEDIUM, HIGH, URGENT");
    }

    @Test
    void thePreferPrefillInstructionIsPresent() {
        assertThat(AgentPrompts.SYSTEM_PROMPT)
                .contains("prefill_task_form")
                .as("FR-AI-13: a described task becomes a filled form, not a created task")
                .contains("the human presses save")
                .as("FR-S-03: the agent never submits")
                .contains("Never submit anything yourself");
    }

    @Test
    void theApprovalInstructionIsPresent() {
        assertThat(AgentPrompts.SYSTEM_PROMPT)
                .contains("propose_task_mutation")
                .as("FR-AI-11/12: the only mutation path is a proposal")
                .contains("the human approves first")
                .as("FR-AI-14/15: never claim a change happened")
                .contains("Never claim a change happened");
    }

    @Test
    void theDateAndNameResolutionRulesArePresent() {
        assertThat(AgentPrompts.SYSTEM_PROMPT)
                .contains("context.today")
                .as("FR-AI-30: the application's clock, not the model's")
                .contains("list_team_members")
                .as("FR-AI-12: never invent an id")
                .contains("ask_user")
                .as("FR-AI-29: ask when ambiguous");
    }

    @Test
    void theStateOwnershipRuleIsPresent() {
        assertThat(AgentPrompts.STATE_PROMPT.apply("{}"))
                .as("FR-S-01: the model writes the whole state document")
                .contains("update_state")
                .contains("ENTIRE state object");
        assertThat(AgentPrompts.STATE_PROMPT.apply("{}"))
                .as("FR-S-01: context/draft are read-only, only assistant is writable")
                .contains("Treat `context` and `draft` as read-only inputs")
                .contains("You may only change `assistant`")
                .contains("Never clear `draft`");
    }

    @Test
    void everyToolTheAgentHasIsNamed() {
        assertThat(AgentPrompts.SYSTEM_PROMPT)
                .contains("query_tasks")
                .contains("get_task")
                .contains("get_task_stats")
                .contains("list_team_members")
                .contains("prefill_task_form")
                .contains("update_task_status")
                .contains("open_task")
                .contains("ask_user")
                .contains("propose_task_mutation");
    }

    @Test
    void httpVocabularyIsForbidden() {
        assertThat(AgentPrompts.SYSTEM_PROMPT)
                .contains("Never mention or invent HTTP endpoints")
                .as("FR-AI-10: the user never sees a REST path")
                .doesNotContain("http://", "https://", "GET /", "PATCH /");
    }

    /** Small models follow short prompts; this is the guard rail on that budget. */
    @Test
    void thePromptStaysShort() {
        assertThat(AgentPrompts.SYSTEM_PROMPT.split("\\s+")).hasSizeLessThan(600);
    }

    /** BE-09 §6: the approval contract is written into the prompt, not just the tool schema. */
    @Test
    void theApprovalContractRulesArePresent() {
        assertThat(AgentPrompts.SYSTEM_PROMPT)
                .as("FR-AI-14").contains("at most one mutation per user request")
                .as("bulk is one proposal").contains("ONE proposal with all")
                .as("result honesty").contains("Report only what that result actually says")
                .as("rejected alternative").contains("do not re-propose the same change")
                .as("dismissed").contains("cancelled")
                // INV-4 (BE-09 §4.5): a not_found is final; re-resolve, never re-guess.
                .as("INV-4 re-resolution").contains("not_found", "query_tasks");
    }

    @Test
    void theModelMustNotClaimMutationsHappenWithoutAResumeResult() {
        assertThat(AgentPrompts.SYSTEM_PROMPT)
                .contains("Never claim a change happened", "the human approves first");
    }
}