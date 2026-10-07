package io.github.khezyapp.backend.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import io.github.khezyapp.backend.config.StrictJsonConfig;
import io.github.khezyapp.backend.domain.task.Task;
import io.github.khezyapp.backend.domain.team.TeamMember;
import io.github.khezyapp.backend.domain.team.TeamMemberRole;
import io.github.khezyapp.backend.error.ApiExceptionHandler;
import io.github.khezyapp.backend.repository.InMemoryTaskRepository;
import io.github.khezyapp.backend.repository.InMemoryTeamMemberRepository;
import io.github.khezyapp.backend.service.TaskPresenter;
import io.github.khezyapp.backend.service.TaskService;
import io.github.khezyapp.backend.service.TaskStatsService;
import io.github.khezyapp.backend.service.TaskValidator;
import io.github.khezyapp.backend.service.TeamMemberService;

/**
 * The HTTP contract, exercised through the real service and real in-memory repositories
 * rather than a mocked {@code TaskService}: "one illegal target writes nothing" is only
 * provable if there is a store to inspect.
 */
@WebMvcTest(controllers = { TaskController.class, TeamMemberController.class })
@Import({ StrictJsonConfig.class, ApiExceptionHandler.class, TaskController.class,
        TeamMemberController.class, TaskControllerTest.Fixtures.class })
@AutoConfigureMockMvc(addFilters = false)
class TaskControllerTest {

    private static final UUID MEMBER_ID = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private InMemoryTaskRepository tasks;

    @Autowired
    private InMemoryTeamMemberRepository members;

    @BeforeEach
    void reset() {
        for (Task task : tasks.findAll()) {
            tasks.deleteById(task.id());
        }
    }

    private String createTask(String json) throws Exception {
        return mockMvc.perform(post("/api/tasks").contentType(MediaType.APPLICATION_JSON).content(json))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
    }

    private String idOf(String json) throws Exception {
        return jsonPathOf(json, "id");
    }

    private static String jsonPathOf(String json, String field) throws Exception {
        return new tools.jackson.databind.ObjectMapper().readTree(json).get(field).asText();
    }

    // ------------------------------------------------------------------- list

    @Test
    // createdAt ordering is unobservable here: the slice runs on a frozen clock, so every
    // row shares a timestamp and the id tiebreak decides. listSortsAndPages covers order.
    void listDefaultsToPageZeroSizeTwentyNewestFirst() throws Exception {
        createTask("{\"title\":\"first\"}");
        createTask("{\"title\":\"second\"}");

        mockMvc.perform(get("/api/tasks"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(20))
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.totalPages").value(1))
                .andExpect(jsonPath("$.content.length()").value(2))
                .andExpect(jsonPath("$.content[0].isUnassigned").value(true))
                .andExpect(jsonPath("$.content[0].isOverdue").value(false))
                .andExpect(jsonPath("$.content[0].version").value(1));
    }

    @Test
    void listAppliesEveryFilter() throws Exception {
        createTask("{\"title\":\"alpha task\",\"status\":\"TODO\",\"priority\":\"HIGH\",\"tags\":[\"x\"]}");
        createTask("{\"title\":\"beta task\",\"status\":\"BLOCKED\",\"priority\":\"LOW\",\"tags\":[\"y\"],"
                + "\"description\":\"waiting\"}");

        mockMvc.perform(get("/api/tasks").param("status", "TODO").param("status", "BLOCKED")
                        .param("priority", "HIGH").param("priority", "LOW").param("tag", "x"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].title").value("alpha task"));

        mockMvc.perform(get("/api/tasks").param("q", "beta"))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].title").value("beta task"));

        mockMvc.perform(get("/api/tasks").param("unassigned", "true"))
                .andExpect(jsonPath("$.totalElements").value(2));

        mockMvc.perform(get("/api/tasks").param("overdue", "true"))
                .andExpect(jsonPath("$.totalElements").value(0));

        mockMvc.perform(get("/api/tasks").param("assigneeId", MEMBER_ID.toString()))
                .andExpect(jsonPath("$.totalElements").value(0));

        mockMvc.perform(get("/api/tasks").param("dueWithinDays", "30"))
                .andExpect(jsonPath("$.totalElements").value(0));
    }

    @Test
    void listSortsAndPages() throws Exception {
        createTask("{\"title\":\"bravo\"}");
        createTask("{\"title\":\"alpha\"}");

        mockMvc.perform(get("/api/tasks").param("sort", "title").param("size", "1"))
                .andExpect(jsonPath("$.content[0].title").value("alpha"))
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.totalPages").value(2));

        mockMvc.perform(get("/api/tasks").param("sort", "title").param("size", "1").param("page", "1"))
                .andExpect(jsonPath("$.content[0].title").value("bravo"))
                .andExpect(jsonPath("$.page").value(1));
    }

    @Test
    void listRejectsBadFilters() throws Exception {
        mockMvc.perform(get("/api/tasks").param("status", "NOPE"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.type").value(
                        "https://agui-basic.local/problems/unprocessable"))
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("NOPE")));

        mockMvc.perform(get("/api/tasks").param("sort", "-nope"))
                .andExpect(status().isUnprocessableEntity());

        mockMvc.perform(get("/api/tasks").param("size", "101"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0].field").value("size"));

        mockMvc.perform(get("/api/tasks").param("page", "-1"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0].field").value("page"));

        mockMvc.perform(get("/api/tasks").param("dueWithinDays", "-1"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0].field").value("dueWithinDays"));

        mockMvc.perform(get("/api/tasks").param("createdFrom", "yesterday"))
                .andExpect(status().isUnprocessableEntity());
    }

    // -------------------------------------------------------------------- get

    @Test
    void getReturnsTheTask() throws Exception {
        String id = idOf(createTask("{\"title\":\"find me\"}"));

        mockMvc.perform(get("/api/tasks/{id}", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("find me"))
                .andExpect(jsonPath("$.status").value("TODO"))
                .andExpect(jsonPath("$.priority").value("MEDIUM"));
    }

    @Test
    void getOfAnUnknownIdIs404WithTheC1Envelope() throws Exception {
        UUID missing = UUID.randomUUID();

        mockMvc.perform(get("/api/tasks/{id}", missing))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.type").value("https://agui-basic.local/problems/not-found"))
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.detail").value(
                        org.hamcrest.Matchers.containsString(missing.toString())))
                .andExpect(jsonPath("$.instance").value("/api/tasks/" + missing))
                .andExpect(jsonPath("$.errors").isArray());
    }

    @Test
    void aMalformedIdIs400RatherThan422() throws Exception {
        mockMvc.perform(get("/api/tasks/not-a-uuid"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value(
                        "https://agui-basic.local/problems/validation-failed"))
                .andExpect(jsonPath("$.instance").value("/api/tasks/not-a-uuid"));
    }

    // ----------------------------------------------------------------- create

    @Test
    void createReturns201WithALocationHeader() throws Exception {
        mockMvc.perform(post("/api/tasks").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"created\"}"))
                .andExpect(status().isCreated())
                .andExpect(header().string("Location", org.hamcrest.Matchers.startsWith("/api/tasks/")))
                .andExpect(jsonPath("$.title").value("created"))
                .andExpect(jsonPath("$.version").value(1));
    }

    @Test
    void createAppliesDefaultsAndNormalises() throws Exception {
        String body = createTask("{\"title\":\"  spaced  \",\"tags\":[\"A\",\"a\",\"B\"]}");

        assertThat(jsonPathOf(body, "title")).isEqualTo("spaced");
        assertThat(jsonPathOf(body, "status")).isEqualTo("TODO");
        assertThat(jsonPathOf(body, "priority")).isEqualTo("MEDIUM");
        assertThat(new tools.jackson.databind.ObjectMapper().readTree(body).get("tags").toString())
                .isEqualTo("[\"a\",\"b\"]");
    }

    @Test
    void createRejectsAServerOwnedFieldWith422() throws Exception {
        mockMvc.perform(post("/api/tasks").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"x\",\"id\":\"11111111-1111-1111-1111-111111111111\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.type").value(
                        "https://agui-basic.local/problems/unprocessable"));
    }

    @Test
    void createRejectsADerivedFlagWith422() throws Exception {
        mockMvc.perform(post("/api/tasks").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"x\",\"isOverdue\":true}"))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    void createReportsFieldErrorsIndividually() throws Exception {
        mockMvc.perform(post("/api/tasks").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"\",\"tags\":[\"a\",\"b\",\"c\",\"d\",\"e\",\"f\"]}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value(
                        "https://agui-basic.local/problems/validation-failed"))
                .andExpect(jsonPath("$.errors[?(@.field == 'title')].message")
                        .value(org.hamcrest.Matchers.hasItem("must not be blank")))
                .andExpect(jsonPath("$.errors[?(@.field == 'tags')].message")
                        .value(org.hamcrest.Matchers.hasItem("must contain at most 5 entries")));
    }

    @Test
    void createWithAnUnknownAssigneeIsA400OnThatField() throws Exception {
        mockMvc.perform(post("/api/tasks").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"x\",\"assigneeId\":\""
                                + UUID.randomUUID() + "\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0].field").value("assigneeId"))
                .andExpect(jsonPath("$.errors[0].message").value("unknown team member"));
    }

    @Test
    void createAsBlockedWithoutADescriptionIs400() throws Exception {
        mockMvc.perform(post("/api/tasks").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"x\",\"status\":\"BLOCKED\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0].field").value("description"));
    }

    @Test
    void anUnparseableEnumIs422() throws Exception {
        mockMvc.perform(post("/api/tasks").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"x\",\"priority\":\"NOPE\"}"))
                .andExpect(status().isUnprocessableEntity());
    }

    // ------------------------------------------------------------------ patch

    @Test
    void patchUpdatesOnlyTheSuppliedFields() throws Exception {
        String id = idOf(createTask("{\"title\":\"before\",\"description\":\"keep me\"}"));

        mockMvc.perform(patch("/api/tasks/{id}", id).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"after\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("after"))
                .andExpect(jsonPath("$.description").value("keep me"))
                .andExpect(jsonPath("$.version").value(2));
    }

    @Test
    void patchRejectsStatusWith400OnThatField() throws Exception {
        String id = idOf(createTask("{\"title\":\"before\"}"));

        mockMvc.perform(patch("/api/tasks/{id}", id).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"DONE\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.type").value(
                        "https://agui-basic.local/problems/validation-failed"))
                .andExpect(jsonPath("$.errors[0].field").value("status"))
                .andExpect(jsonPath("$.errors[0].message")
                        .value("status cannot be changed via field update"));
    }

    @Test
    void patchWithAStaleExpectedVersionIs409VersionConflict() throws Exception {
        String id = idOf(createTask("{\"title\":\"before\"}"));

        mockMvc.perform(patch("/api/tasks/{id}", id).param("expectedVersion", "7")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"after\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value(
                        "https://agui-basic.local/problems/version-conflict"));
    }

    @Test
    void patchWithTheCorrectExpectedVersionSucceeds() throws Exception {
        String id = idOf(createTask("{\"title\":\"before\"}"));

        mockMvc.perform(patch("/api/tasks/{id}", id).param("expectedVersion", "1")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"after\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(2));
    }

    // ----------------------------------------------------------------- delete

    @Test
    void deleteReturns204WithAnEmptyBody() throws Exception {
        String id = idOf(createTask("{\"title\":\"doomed\"}"));

        mockMvc.perform(delete("/api/tasks/{id}", id))
                .andExpect(status().isNoContent())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .content().string(""));

        mockMvc.perform(get("/api/tasks/{id}", id)).andExpect(status().isNotFound());
    }

    @Test
    void deleteAcceptsForceAndExpectedVersion() throws Exception {
        String id = idOf(createTask("{\"title\":\"doomed\"}"));

        mockMvc.perform(delete("/api/tasks/{id}", id).param("force", "true")
                        .param("expectedVersion", "1"))
                .andExpect(status().isNoContent());
    }

    @Test
    void deleteOfAnUnknownIdIs404() throws Exception {
        mockMvc.perform(delete("/api/tasks/{id}", UUID.randomUUID()))
                .andExpect(status().isNotFound());
    }

    // ----------------------------------------------------------------- status

    @Test
    void statusChangeAppliesALegalTransition() throws Exception {
        String id = idOf(createTask("{\"title\":\"movable\"}"));

        mockMvc.perform(post("/api/tasks/{id}/status", id).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"IN_PROGRESS\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("IN_PROGRESS"))
                .andExpect(jsonPath("$.version").value(2));
    }

    @Test
    void illegalTransitionIs409AndExplainsTheAllowedTargets() throws Exception {
        String id = idOf(createTask("{\"title\":\"movable\",\"status\":\"IN_REVIEW\"}"));

        mockMvc.perform(post("/api/tasks/{id}/status", id).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"BACKLOG\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value(
                        "https://agui-basic.local/problems/illegal-transition"))
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString(
                        "`IN_REVIEW` → `BACKLOG` is not allowed")))
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("DONE")));
    }

    @Test
    void leavingCancelledNeedsReopen() throws Exception {
        String id = idOf(createTask("{\"title\":\"dead\",\"status\":\"CANCELLED\"}"));

        mockMvc.perform(post("/api/tasks/{id}/status", id).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"TODO\"}"))
                .andExpect(status().isConflict());

        mockMvc.perform(post("/api/tasks/{id}/status", id).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"TODO\",\"reopen\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("TODO"));
    }

    @Test
    void reopeningToANonTodoTargetIs400() throws Exception {
        String id = idOf(createTask("{\"title\":\"dead\",\"status\":\"CANCELLED\"}"));

        mockMvc.perform(post("/api/tasks/{id}/status", id).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"IN_PROGRESS\",\"reopen\":true}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0].field").value("reopen"));
    }

    @Test
    void statusChangeToTheSameStatusIsA200NoOp() throws Exception {
        String id = idOf(createTask("{\"title\":\"steady\"}"));

        mockMvc.perform(post("/api/tasks/{id}/status", id).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"TODO\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(1));
    }

    @Test
    void statusChangeWithoutABodyStatusIs400() throws Exception {
        String id = idOf(createTask("{\"title\":\"steady\"}"));

        mockMvc.perform(post("/api/tasks/{id}/status", id).contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0].field").value("status"));
    }

    // ------------------------------------------------------------------- bulk

    @Test
    void bulkUpdatesEveryTask() throws Exception {
        String a = idOf(createTask("{\"title\":\"bulk a\"}"));
        String b = idOf(createTask("{\"title\":\"bulk b\"}"));

        mockMvc.perform(post("/api/tasks/bulk-status").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"ids\":[\"" + a + "\",\"" + b + "\"],\"status\":\"IN_PROGRESS\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.updated").value(2))
                .andExpect(jsonPath("$.tasks.length()").value(2))
                .andExpect(jsonPath("$.tasks[0].status").value("IN_PROGRESS"));
    }

    @Test
    void bulkWithOneIllegalTargetWritesNothingAndNamesTheOffender() throws Exception {
        String fine = idOf(createTask("{\"title\":\"fine one\"}"));
        String review = idOf(createTask("{\"title\":\"Review me\",\"status\":\"IN_REVIEW\"}"));

        mockMvc.perform(post("/api/tasks/bulk-status").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"ids\":[\"" + fine + "\",\"" + review + "\"],\"status\":\"BACKLOG\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.type").value(
                        "https://agui-basic.local/problems/illegal-transition"))
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("Review me")))
                .andExpect(jsonPath("$.errors[0].field").value("ids[1]"));

        assertThat(tasks.findById(UUID.fromString(fine)).orElseThrow().status().name()).isEqualTo("TODO");
        assertThat(tasks.findById(UUID.fromString(fine)).orElseThrow().version()).isEqualTo(1L);
    }

    @Test
    void bulkWithAMissingIdIs404() throws Exception {
        mockMvc.perform(post("/api/tasks/bulk-status").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"ids\":[\"" + UUID.randomUUID() + "\"],\"status\":\"DONE\"}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void bulkWithAnEmptyIdListIs400() throws Exception {
        mockMvc.perform(post("/api/tasks/bulk-status").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"ids\":[],\"status\":\"DONE\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0].field").value("ids"));
    }

    // ------------------------------------------------------------------ stats

    @Test
    void statsIsItsOwnRouteAndNeverFallsIntoTheIdPathVariable() throws Exception {
        mockMvc.perform(get("/api/tasks/stats"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(0))
                .andExpect(jsonPath("$.byStatus.TODO").value(0))
                .andExpect(jsonPath("$.byStatus.BACKLOG").value(0))
                .andExpect(jsonPath("$.byPriority.MEDIUM").value(0))
                .andExpect(jsonPath("$.overdueTotal").value(0))
                .andExpect(jsonPath("$.dueThisWeek").value(0))
                .andExpect(jsonPath("$.unassignedTotal").value(0))
                .andExpect(jsonPath("$.createdLast7Days").value(0))
                .andExpect(jsonPath("$.assignees").isArray());
    }

    @Test
    void statsCountsTheWholeStore() throws Exception {
        createTask("{\"title\":\"one\"}");
        createTask("{\"title\":\"two\",\"status\":\"IN_PROGRESS\",\"assigneeId\":\""
                + MEMBER_ID + "\"}");

        mockMvc.perform(get("/api/tasks/stats"))
                .andExpect(jsonPath("$.total").value(2))
                .andExpect(jsonPath("$.byStatus.TODO").value(1))
                .andExpect(jsonPath("$.byStatus.IN_PROGRESS").value(1))
                .andExpect(jsonPath("$.unassignedTotal").value(1))
                .andExpect(jsonPath("$.assignees[0].memberId").value(MEMBER_ID.toString()));
    }

    // ----------------------------------------------------------- team members

    @Test
    void teamMembersAreListed() throws Exception {
        mockMvc.perform(get("/api/team-members"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(MEMBER_ID.toString()))
                .andExpect(jsonPath("$[0].displayName").value("Ada Lovelace"))
                .andExpect(jsonPath("$[0].role").value("ENGINEER"));
    }

    // -------------------------------------------------------------- contracts

    @Test
    void anUnsupportedMethodIs405InTheEnvelope() throws Exception {
        mockMvc.perform(put("/api/tasks/stats"))
                .andExpect(status().isMethodNotAllowed())
                .andExpect(jsonPath("$.type").value(
                        "https://agui-basic.local/problems/method-not-allowed"));
    }

    @Configuration
    static class Fixtures {

        @Bean
        Clock clock() {
            return Clock.fixed(Instant.parse("2026-01-05T10:15:30Z"), ZoneId.of("UTC"));
        }

        @Bean
        InMemoryTaskRepository taskRepository(Clock clock) {
            return new InMemoryTaskRepository(clock);
        }

        @Bean
        InMemoryTeamMemberRepository teamMemberRepository() {
            InMemoryTeamMemberRepository repository = new InMemoryTeamMemberRepository();
            repository.save(new TeamMember(MEMBER_ID, "Ada Lovelace", "ada@example.test",
                    TeamMemberRole.ENGINEER));
            return repository;
        }

        @Bean
        TaskValidator taskValidator(InMemoryTeamMemberRepository members) {
            return new TaskValidator(members);
        }

        @Bean
        TaskService taskService(InMemoryTaskRepository tasks, InMemoryTeamMemberRepository members,
                                TaskValidator validator, Clock clock) {
            return new TaskService(tasks, validator, clock);
        }

        @Bean
        TaskPresenter taskPresenter(Clock clock) {
            return new TaskPresenter(clock);
        }

        @Bean
        TaskStatsService taskStatsService(InMemoryTaskRepository tasks,
                                          InMemoryTeamMemberRepository members,
                                          TaskPresenter presenter, Clock clock) {
            return new TaskStatsService(tasks, members, presenter, clock);
        }

        @Bean
        TeamMemberService teamMemberService(InMemoryTeamMemberRepository members) {
            return new TeamMemberService(members);
        }

        @Bean
        TaskQueryFactory taskQueryFactory(Clock clock) {
            return new TaskQueryFactory(clock);
        }
    }
}