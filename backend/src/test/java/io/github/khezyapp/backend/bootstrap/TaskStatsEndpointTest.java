package io.github.khezyapp.backend.bootstrap;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

/**
 * The seeded profile has to make every dashboard card non-zero — otherwise the frontend
 * dashboard renders as a row of zeroes and the demo looks broken.
 */
@SpringBootTest
@AutoConfigureMockMvc(addFilters = false)
class TaskStatsEndpointTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void statsOverTheSeededProfileHasEveryCounterNonZero() throws Exception {
        mockMvc.perform(get("/api/tasks/stats"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(org.hamcrest.Matchers.greaterThanOrEqualTo(40)))
                .andExpect(jsonPath("$.overdueTotal").value(org.hamcrest.Matchers.greaterThan(0)))
                .andExpect(jsonPath("$.dueThisWeek").value(org.hamcrest.Matchers.greaterThan(0)))
                .andExpect(jsonPath("$.unassignedTotal").value(org.hamcrest.Matchers.greaterThan(0)))
                .andExpect(jsonPath("$.createdLast7Days").value(org.hamcrest.Matchers.greaterThan(0)))
                .andExpect(jsonPath("$.assignees.length()").value(6));
    }

    @Test
    void everyStatusAndPriorityBucketIsPresent() throws Exception {
        mockMvc.perform(get("/api/tasks/stats"))
                .andExpect(jsonPath("$.byStatus.TODO").value(org.hamcrest.Matchers.greaterThan(0)))
                .andExpect(jsonPath("$.byStatus.BLOCKED").value(org.hamcrest.Matchers.greaterThan(0)))
                .andExpect(jsonPath("$.byStatus.DONE").value(org.hamcrest.Matchers.greaterThan(0)))
                .andExpect(jsonPath("$.byStatus.CANCELLED").value(org.hamcrest.Matchers.greaterThan(0)))
                .andExpect(jsonPath("$.byPriority.LOW").value(org.hamcrest.Matchers.greaterThan(0)))
                .andExpect(jsonPath("$.byPriority.URGENT").value(org.hamcrest.Matchers.greaterThan(0)));
    }

    @Test
    void theSeededStoreBacksTheListEndpointToo() throws Exception {
        mockMvc.perform(get("/api/tasks").param("size", "5"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(org.hamcrest.Matchers.greaterThanOrEqualTo(40)))
                .andExpect(jsonPath("$.content.length()").value(5));
    }

    @Test
    void theSeededMembersAreListable() throws Exception {
        mockMvc.perform(get("/api/team-members"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(6))
                .andExpect(jsonPath("$[0].displayName").value("Ana Reyes"));
    }

    @Test
    void theDemoScriptFilterForLoginTasksFindsThem() throws Exception {
        mockMvc.perform(get("/api/tasks").param("q", "login"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(org.hamcrest.Matchers.greaterThanOrEqualTo(4)));
    }
}