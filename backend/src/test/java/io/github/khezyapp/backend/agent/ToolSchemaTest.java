package io.github.khezyapp.backend.agent;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.ai.tool.ToolCallback;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

import io.github.khezyapp.backend.domain.task.TaskPriority;
import io.github.khezyapp.backend.domain.task.TaskStatus;
import io.github.khezyapp.backend.domain.team.TeamMember;
import io.github.khezyapp.backend.domain.team.TeamMemberRole;
import io.github.khezyapp.backend.repository.InMemoryTaskRepository;
import io.github.khezyapp.backend.repository.InMemoryTeamMemberRepository;
import io.github.khezyapp.backend.service.TaskPresenter;
import io.github.khezyapp.backend.service.TaskService;
import io.github.khezyapp.backend.service.TaskStatsService;
import io.github.khezyapp.backend.service.TaskValidator;
import io.github.khezyapp.backend.service.TeamMemberService;
import io.github.khezyapp.backend.testsupport.TaskFixtures;

/**
 * BE-08 §6's second half: the <em>generated</em> JSON Schema and the exact wire JSON, both
 * pinned.
 *
 * <p>The schema is not an implementation detail here. A 3–4 B model reads the parameter
 * descriptions literally and nothing else, so a description that stops naming the legal
 * statuses turns every enum guess into a wasted turn. Pinning the text here makes that a
 * build failure rather than a demo regression.
 *
 * <p>The wire-JSON tests exist for FE-13, which renders a card per {@code TOOL_CALL_RESULT}
 * and keys the error state off the presence of {@code error}. If a field is renamed or a
 * null starts appearing, these fail.
 */
class ToolSchemaTest {

    private static final Instant NOW = Instant.parse("2026-01-07T12:00:00Z");
    private static final LocalDate TODAY = LocalDate.of(2026, 1, 7);

    private static final ObjectMapper JSON = new ObjectMapper();

    private static final UUID ANA =
            UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");
    private static final UUID LOGIN =
            UUID.fromString("bbbbbbbb-0000-0000-0000-000000000001");

    private Map<String, ToolCallback> byName;

    @BeforeEach
    void setUp() {
        Clock clock = Clock.fixed(NOW, ZoneId.of("UTC"));
        InMemoryTaskRepository tasks = new InMemoryTaskRepository(clock);
        InMemoryTeamMemberRepository members = new InMemoryTeamMemberRepository();
        TaskPresenter presenter = new TaskPresenter(clock);
        TaskReadTools tools = new TaskReadTools(
                new TaskService(tasks, new TaskValidator(members), clock),
                new TaskStatsService(tasks, members, presenter, clock),
                new TeamMemberService(members), presenter);

        byName = tools.asToolCallbacks().stream()
                .collect(Collectors.toMap(
                        callback -> callback.getToolDefinition().name(), callback -> callback));

        members.save(new TeamMember(ANA, "Ana Reyes", "ana.reyes@agui-basic.test",
                TeamMemberRole.ENGINEER));
        tasks.save(TaskFixtures.aTask().id(LOGIN).title("Login page times out")
                .status(TaskStatus.BLOCKED).priority(TaskPriority.HIGH)
                .assignee(ANA).dueDate(TODAY.minusDays(3)).tags("bug", "auth")
                .description("Blocked on the auth service.").build());
    }

    private Map<String, Object> schemaOf(String toolName) {
        return parseMap(byName.get(toolName).getToolDefinition().inputSchema());
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> parseMap(String json) {
        return JSON.readValue(json, new TypeReference<Map<String, Object>>() {
        });
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> propertiesOf(String toolName) {
        return (Map<String, Object>) schemaOf(toolName).get("properties");
    }

    @SuppressWarnings("unchecked")
    private List<String> requiredOf(String toolName) {
        return (List<String>) schemaOf(toolName).get("required");
    }

    // ------------------------------------------------------- registered surface

    @Test
    void theAgentAdvertisesExactlyTheFourReadTools() {
        assertThat(byName.keySet())
                .containsExactlyInAnyOrder("query_tasks", "get_task", "get_task_stats",
                        "list_team_members");
    }

    @Test
    void everyToolHasANonEmptyDescription() {
        byName.forEach((name, callback) -> {
            String description = callback.getToolDefinition().description();
            assertThat(description).as("%s description", name).isNotBlank();
            // A description is the only documentation a small model gets. Under ~40 words it
            // stops explaining what the tool is for.
            assertThat(description.split("\\s+").length).as("%s word count", name)
                    .isGreaterThan(20).isLessThan(160);
        });
    }

    @Test
    void everyToolTakesNoArgumentItDoesNotAdvertise() {
        // `additionalProperties: false` is what stops a model inventing a `sort` or a
        // `page` argument and having the call rejected by the provider.
        byName.forEach((name, callback) ->
                assertThat(schemaOf(name).get("additionalProperties")).as("%s", name).isEqualTo(false));
    }

    // ------------------------------------------------------------- query_tasks

    @Test
    void queryTasksAdvertisesExactlyTheEightDocumentedFilters() {
        assertThat(propertiesOf("query_tasks")).containsOnlyKeys(
                "q", "status", "priority", "assigneeName", "overdue", "unassigned",
                "dueWithinDays", "limit");
    }

    @Test
    void queryTasksRequiresNothing() {
        // Every filter is optional, so `{"q":"login"}` must be a legal call. The one
        // argument that is genuinely required, the id in get_task, is marked required there.
        assertThat(requiredOf("query_tasks")).isEmpty();
    }

    @Test
    void queryTasksGivesTheCorrectJsonTypes() {
        Map<String, Object> properties = propertiesOf("query_tasks");

        assertThat(typeOf(properties, "q")).isEqualTo("string");
        assertThat(typeOf(properties, "status")).isEqualTo("string");
        assertThat(typeOf(properties, "priority")).isEqualTo("string");
        assertThat(typeOf(properties, "assigneeName")).isEqualTo("string");
        assertThat(typeOf(properties, "overdue")).isEqualTo("boolean");
        assertThat(typeOf(properties, "unassigned")).isEqualTo("boolean");
        assertThat(typeOf(properties, "dueWithinDays")).isEqualTo("integer");
        assertThat(typeOf(properties, "limit")).isEqualTo("integer");
    }

    @Test
    void theStatusDescriptionNamesEveryLegalStatus() {
        // FR-AI-28 plus the small-model safety net: a 4 B model has no other source for
        // this list, so if it is not in the description the model invents a status.
        String description = descriptionOf("query_tasks", "status");

        assertThat(description).contains("BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW",
                "BLOCKED", "DONE", "CANCELLED");
        // Comma-separated rather than a JSON array, and the schema says so — a model that
        // guesses an array gets its arguments rejected by the provider instead of answered.
        assertThat(description).containsIgnoringCase("commas");
        // And no status outside the vocabulary may leak in.
        assertThat(description).doesNotContain("ARCHIVED", "WONT_FIX", "CLOSED");
    }

    @Test
    void thePriorityDescriptionNamesEveryLegalPriority() {
        assertThat(descriptionOf("query_tasks", "priority")).contains("LOW", "MEDIUM", "HIGH", "URGENT");
    }

    @Test
    void theAssigneeNameDescriptionPointsAtListTeamMembers() {
        assertThat(descriptionOf("query_tasks", "assigneeName")).contains("list_team_members");
    }

    @Test
    void theLimitDescriptionStatesTheClamp() {
        assertThat(descriptionOf("query_tasks", "limit")).contains("1", "100", "20");
    }

    // ---------------------------------------------------------- the other three

    @Test
    void getTaskTakesOneRequiredTaskId() {
        assertThat(propertiesOf("get_task")).containsOnlyKeys("taskId");
        assertThat(requiredOf("get_task")).containsExactly("taskId");
        assertThat(typeOf(propertiesOf("get_task"), "taskId")).isEqualTo("string");
    }

    @Test
    void getTaskDescriptionForbidsInventingIds() {
        assertThat(byName.get("get_task").getToolDefinition().description())
                .contains("never invent", "not_found");
    }

    @Test
    void getTaskStatsTakesNoArguments() {
        assertThat(propertiesOf("get_task_stats")).isEmpty();
        assertThat(requiredOf("get_task_stats")).isEmpty();
    }

    @Test
    void listTeamMembersTakesNoArguments() {
        assertThat(propertiesOf("list_team_members")).isEmpty();
        assertThat(requiredOf("list_team_members")).isEmpty();
    }

    @Test
    void theToolNamesMatchThePromptContract() {
        // AgentPrompts.SYSTEM_PROMPT lists the read tools by name; if the two ever drift the
        // model is told about tools it cannot see.
        for (String name : byName.keySet()) {
            assertThat(AgentPrompts.READ_TOOL_NAMES).contains(name);
        }
    }

    // -------------------------------------------------------------- wire shapes

    @Test
    void queryTasksResultJsonHasNoErrorFieldOnSuccess() {
        Map<String, Object> json = parseMap(byName.get("query_tasks").call("{\"q\":\"login\"}"));

        assertThat(json).containsOnlyKeys("tasks", "total", "limit");
        assertThat(json.get("limit")).isEqualTo(20);
        Map<String, Object> brief = (Map<String, Object>) ((List<?>) json.get("tasks")).getFirst();
        assertThat(brief).containsOnlyKeys("id", "title", "status", "priority", "assignee",
                "dueDate", "overdue", "tags");
        assertThat(brief.get("status")).isEqualTo("BLOCKED");
        assertThat(brief.get("assignee")).isEqualTo("Ana Reyes");
        assertThat(brief.get("dueDate")).isEqualTo("2026-01-04");
        assertThat(brief.get("overdue")).isEqualTo(true);
    }

    @Test
    void queryTasksErrorJsonCarriesTheErrorAndTheKnownNames() {
        Map<String, Object> json = parseMap(
                byName.get("query_tasks").call("{\"assigneeName\":\"Nobody\"}"));

        assertThat(json.get("error")).isEqualTo("unknown team member 'Nobody'");
        assertThat((List<String>) json.get("known")).containsExactly("Ana Reyes");
        assertThat((List<?>) json.get("tasks")).isEmpty();
    }

    @Test
    void getTaskNotFoundJsonIsRenderableAsAnErrorCard() {
        Map<String, Object> json = parseMap(
                byName.get("get_task").call("{\"taskId\":\"00000000-0000-0000-0000-0000000000ff\"}"));

        assertThat(json).containsOnlyKeys("taskId", "error");
        assertThat(json.get("error")).isEqualTo("not_found");
    }

    @Test
    void getTaskStatsResultJsonIsZeroFilledAndCarriesNoErrorField() {
        Map<String, Object> json = parseMap(byName.get("get_task_stats").call("{}"));

        assertThat(json).doesNotContainKey("error");
        Map<String, Object> byStatus = (Map<String, Object>) json.get("byStatus");
        assertThat(byStatus).containsOnlyKeys("BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW",
                "BLOCKED", "DONE", "CANCELLED");
        assertThat((Map<String, Object>) json.get("byPriority"))
                .containsOnlyKeys("LOW", "MEDIUM", "HIGH", "URGENT");
        assertThat(json.get("total")).isEqualTo(1);
        assertThat(json.get("overdue")).isEqualTo(1);
        assertThat((List<?>) json.get("assignees")).hasSize(1);
    }

    @Test
    void listTeamMembersResultJsonIsABareArray() {
        List<?> json = JSON.readValue(byName.get("list_team_members").call("{}"),
                new TypeReference<List<Object>>() {
                });

        assertThat(json).hasSize(1);
        assertThat((Map<String, Object>) json.getFirst())
                .containsOnlyKeys("id", "displayName", "role");
        assertThat(((Map<String, Object>) json.getFirst()).get("displayName")).isEqualTo("Ana Reyes");
    }

    @Test
    void aResultJsonIsAlwaysParsableEvenWithNoArguments() {
        // The agent will call these with `{}` when it has no filter in mind; none of them
        // may fail the loop.
        for (String name : List.of("query_tasks", "get_task_stats", "list_team_members")) {
            assertThat(byName.get(name).call("{}")).as("%s", name).isNotBlank();
        }
    }

    // ------------------------------------------------------------- test helpers

    @SuppressWarnings("unchecked")
    private static String typeOf(Map<String, Object> properties, String property) {
        return String.valueOf(((Map<String, Object>) properties.get(property)).get("type"));
    }

    @SuppressWarnings("unchecked")
    private String descriptionOf(String toolName, String property) {
        return String.valueOf(((Map<String, Object>) propertiesOf(toolName).get(property)).get("description"));
    }
}
