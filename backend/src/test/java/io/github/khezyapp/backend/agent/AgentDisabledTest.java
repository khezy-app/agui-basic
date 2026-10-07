package io.github.khezyapp.backend.agent;

import com.agui.community.core.agent.Agent;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.ApplicationContext;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * NFR-4: {@code app.ai.enabled=false} must disable the AI endpoint and <em>only</em> the
 * AI endpoint. The REST surface is untouched, and {@code POST /agent} fails cleanly
 * instead of 500-ing.
 *
 * <p>The failure surface is pinned because FE-13 renders it: with no {@link Agent} bean
 * the AG-UI auto-configuration contributes no {@code AgentRegistry} and therefore no
 * {@code AgUiController}, so the request 404s through the same handler as any unknown
 * path — as a C1 {@code not-found} envelope, not a stack trace.
 */
@SpringBootTest(properties = "app.ai.enabled=false")
@AutoConfigureMockMvc
class AgentDisabledTest {

    @Autowired
    private ApplicationContext context;

    @Autowired
    private MockMvc mockMvc;

    @Test
    void noAgentBeanIsRegistered() {
        assertThat(context.getBeanNamesForType(Agent.class)).isEmpty();
        assertThat(context.getBeanNamesForType(ChatClient.class)).isEmpty();
    }

    @Test
    void theRestApiStillAnswers() throws Exception {
        mockMvc.perform(get("/api/tasks"))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/team-members"))
                .andExpect(status().isOk());
    }

    @Test
    void postAgentAnswersFourHundredAndFour() throws Exception {
        mockMvc.perform(post("/agent").contentType("application/json").content("{}"))
                .andExpect(status().isNotFound());
    }
}