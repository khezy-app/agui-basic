package io.github.khezyapp.backend.agent;

import com.agui.community.core.tool.Tool;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * BE-09 §6's declaration test: the model can only call a tool it can see, so the declaration
 * surface is the contract. The small-model guard is the small-model defence — if a phrase or
 * field vanishes from the description, this fails instead of the demo.
 */
class TaskMutationApprovalToolsTest {

    @Test
    void exactlyOneToolIsDeclaredNamedProposeTaskMutation() {
        List<Tool> declarations = new TaskMutationApprovalTools().declarations();

        assertThat(declarations).hasSize(1);
        assertThat(declarations.getFirst().name()).isEqualTo("propose_task_mutation");
    }

    @Test
    void theSchemaRequiresAllFourArguments() {
        Tool tool = new TaskMutationApprovalTools().declarations().getFirst();

        assertThat(tool.parameters().type()).isEqualTo("object");
        assertThat(tool.parameters().required())
                .containsExactlyInAnyOrder("tool", "args", "summary", "reason");
    }

    @Test
    @SuppressWarnings("unchecked")
    void theToolEnumContainsExactlyTheFourMutationIntents() {
        Tool tool = new TaskMutationApprovalTools().declarations().getFirst();

        Map<String, Object> toolProp = (Map<String, Object>) tool.parameters().properties().get("tool");
        @SuppressWarnings("unchecked")
        List<String> enumValues = (List<String>) toolProp.get("enum");
        assertThat(enumValues)
                .containsExactlyInAnyOrder("create_task", "update_task_status",
                        "update_task_fields", "delete_task");
    }

    @Test
    void theDescriptionMentionsEveryIntentAndItsFields() {
        Tool tool = new TaskMutationApprovalTools().declarations().getFirst();

        // A 4 B model reads prose, not a nested oneOf, so the field list lives in words.
        assertThat(tool.description())
                .contains("create_task", "title", "description", "status", "priority",
                        "assigneeName", "dueDate", "yyyy-MM-dd", "estimateHours", "tags");
        assertThat(tool.description())
                .contains("update_task_status", "taskId", "taskIds", "reopen", "reason");
        assertThat(tool.description())
                .contains("update_task_fields");
        assertThat(tool.description())
                .contains("delete_task", "destructive");
    }

    @Test
    void theDescriptionSaysTheUserMustApproveAndTheModelMustNeverLie() {
        Tool tool = new TaskMutationApprovalTools().declarations().getFirst();

        assertThat(tool.description())
                .contains("The user sees a confirmation card and either approves or rejects")
                .contains("Never claim a change was made before you have seen its result");
    }

    @Test
    void theDescriptionBansMultipleProposalsPerRequest() {
        Tool tool = new TaskMutationApprovalTools().declarations().getFirst();

        assertThat(tool.description())
                .contains("Never call this tool more than once per user request")
                .contains("one", "proposal with all", "ids");
    }

    @Test
    void aPerMutationArgsShapeIsNotEnforcedByJsonSchema() {
        // Deliberate: the model obeys prose; the frontend validates args after approval.
        // This pins the open-object design so nobody adds a oneOf "to be safe" by accident.
        Tool tool = new TaskMutationApprovalTools().declarations().getFirst();

        assertThat(tool.parameters().properties()).containsOnlyKeys(
                "tool", "args", "summary", "reason");
        assertThat(tool.parameters().properties().get("args")).isInstanceOf(Map.class)
                .extracting(Object::toString)
                .asString()
                .contains("object");
    }
}
