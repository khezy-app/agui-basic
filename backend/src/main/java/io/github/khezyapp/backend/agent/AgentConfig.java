package io.github.khezyapp.backend.agent;

import com.agui.community.core.agent.Agent;
import com.agui.community.core.tool.Tool;
import com.agui.community.spring.ai.SpringAiAgent;
import java.util.List;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * The AG-UI wiring (BE-07): one {@link ChatClient} carrying the system prompt, and one
 * {@link Agent} bean that {@code ag-ui-spring-webmvc-server} auto-serves at
 * {@code POST /agent}.
 *
 * <p>We deliberately do <em>not</em> use {@code ag-ui-spring-ai-webmvc-boot-starter}, so
 * nothing here is configured by {@code ag-ui.spring-ai.*} properties: {@code shareState},
 * {@code stateUpdates}, {@code tools} and {@code interruptTools} are all set in code. Do
 * not add that starter alongside this class — the two would contribute competing beans.
 *
 * <p>With {@code app.ai.enabled=false} this whole configuration is skipped, so no
 * {@code Agent} bean exists and {@code POST /agent} reports that nothing is registered,
 * while {@code /api/**} keeps working (NFR-4).
 */
@Configuration
@ConditionalOnProperty(name = "app.ai.enabled", havingValue = "true", matchIfMissing = true)
public class AgentConfig {

    /**
     * The system-prompt-carrying {@link ChatClient}. Cloned from the auto-configured
     * builder so Boot's {@code ChatClient.Builder} (and its advisors) are preserved.
     *
     * <p>No memory advisor is registered: conversation history arrives on every run in
     * {@code RunAgentInput.messages} (FR-AI-04), so server-side memory would duplicate it.
     */
    @Bean
    ChatClient chatClient(ChatClient.Builder builder) {
        return builder.clone()
                .defaultSystem(AgentPrompts.SYSTEM_PROMPT)
                .build();
    }

    /**
     * The single {@link Agent} bean. All state sharing is enabled here because the
     * properties that would otherwise do it are not read without the starter.
     *
     * @param chatClient   the prompt-carrying client
     * @param readTools    backend read tools, executed by the agent (BE-08 fills this in)
     * @param approvalTools backend interrupt declarations — advertised, never executed
     *                     (BE-09 fills this in)
     */
    @Bean
    Agent agent(ChatClient chatClient,
                TaskReadTools readTools,
                TaskMutationApprovalTools approvalTools) {
        return new SuccessOutcomeAgent(
                buildAgent(chatClient, readTools.asToolCallbacks(), approvalTools.declarations()));
    }

    /**
     * The agent assembly as a pure static factory, so tests can build an agent with an
     * empty tool list and assert the wiring without a Spring context or a model.
     */
    static Agent buildAgent(ChatClient chatClient,
                            List<ToolCallback> backendTools,
                            List<Tool> interruptTools) {
        return SpringAiAgent.builder(chatClient)
                // Emits an initial STATE_SNAPSHOT echoing RunAgentInput.state, injects the
                // state into the prompt, and advertises update_state to the model.
                .shareState(true)
                // The model always sends the whole state document; the agent diffs it into
                // an RFC 6902 patch. The frontend implements patch application anyway
                // (FR-S-02), and deltas keep a large state document off the wire.
                .stateUpdates(SpringAiAgent.StateUpdates.DELTA)
                .statePrompt(AgentPrompts.STATE_PROMPT)
                // Deliberately OFF (FE-14 defect). The snapshot serialises assistant tool
                // calls through com.agui.community.core.message.ToolCall, which is a record
                // (id, function) with no serialised `type`, so @ag-ui/client's
                // z.literal("function") schema rejects the MESSAGES_SNAPSHOT event and
                // aborts the run before RUN_FINISHED. The frontend rebuilds history from
                // TEXT_MESSAGE_*/TOOL_CALL_*, so nothing is lost; re-enable once java-core
                // ToolCall / server-core MessageMixin emit `type`. See
                // ../spec-01-fe/HANDOFF.md (FE-14 session-2 addendum).
                .emitMessagesSnapshot(false)
                .tools(backendTools)
                // Backend-declared interrupt tools pause the run instead of executing;
                // a call always yields an interrupt outcome regardless of the flag below.
                .interruptTools(interruptTools)
                // Required for BE-09's approval flow: pending client tool calls finish the
                // run with RUN_FINISHED { outcome: { type: "interrupt", … } }. Harmless
                // while nothing pauses the run.
                .emitInterruptOutcome(true)
                .build();
    }
}