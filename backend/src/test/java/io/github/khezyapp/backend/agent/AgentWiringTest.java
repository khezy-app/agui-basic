package io.github.khezyapp.backend.agent;

import com.agui.community.core.agent.Agent;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The default profile must expose exactly one {@link Agent} bean. Two would break
 * {@code POST /agent}: the base path only serves the <em>sole</em> registered agent
 * ({@code AgentRegistry.single()}), and a second one would silently become the
 * addressable id.
 */
@SpringBootTest
class AgentWiringTest {

    @Autowired
    private ApplicationContext context;

    @Test
    void exactlyOneAgentBeanIsRegistered() {
        assertThat(context.getBeanNamesForType(Agent.class)).hasSize(1);
        assertThat(context.getBeanNamesForType(Agent.class)[0]).isEqualTo("agent");
    }

    @Test
    void thePromptCarryingChatClientIsTheOnlyOne() {
        assertThat(context.getBeanNamesForType(ChatClient.class)).containsExactly("chatClient");
    }
}