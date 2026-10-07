package io.github.khezyapp.backend.agent;

import com.agui.community.core.agent.Agent;
import com.agui.community.core.agent.RunAgentInput;
import com.agui.community.core.event.Event;
import com.agui.community.core.event.RunFinishedEvent;
import com.agui.community.core.interrupt.Interrupt;
import com.agui.community.core.interrupt.InterruptOutcome;
import com.agui.community.core.interrupt.Resume;
import com.agui.community.core.interrupt.ResumeStatus;
import com.agui.community.core.message.Message;
import com.agui.community.core.message.UserMessage;
import io.github.khezyapp.backend.testsupport.JdkFlowSupport;
import io.github.khezyapp.backend.testsupport.ToolCallChatModel;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.client.ChatClient;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * BE-09 §6's interrupt wiring: one advertised, never-executed tool
 * ({@code propose_task_mutation}) wired through {@link AgentConfig#buildAgent}. A model
 * calling it must end the run with an {@code InterruptOutcome} carrying one interrupt —
 * the whole approval design hangs on this.
 */
class AgentInterruptWiringTest {

    private static final Object STATE = Map.of("context", Map.of("today", "2026-01-05"));

    @Test
    void aModelCallToProposeTaskMutationPausesTheRunWithOneInterrupt() throws Exception {
        ToolCallChatModel model = new ToolCallChatModel("propose_task_mutation",
                "{\"tool\":\"update_task_status\",\"args\":{\"taskId\":\"abc\",\"status\":\"DONE\"},"
                        + "\"summary\":\"Mark the login task done\",\"reason\":\"user asked\"}");
        ChatClient client = new AgentConfig().chatClient(ChatClient.builder(model));
        Agent agent = AgentConfig.buildAgent(client, List.of(), new TaskMutationApprovalTools().declarations());

        List<Event> events = JdkFlowSupport.collect(agent.run(input("hi", null)));

        RunFinishedEvent finished = events.stream()
                .filter(RunFinishedEvent.class::isInstance)
                .map(RunFinishedEvent.class::cast)
                .findFirst()
                .orElseThrow();
        assertThat(finished.outcome()).isInstanceOf(InterruptOutcome.class);

        InterruptOutcome outcome = (InterruptOutcome) finished.outcome();
        assertThat(outcome.interrupts()).hasSize(1);

        Interrupt interrupt = outcome.interrupts().getFirst();
        assertThat(interrupt.toolCallId()).isEqualTo("call-1");
        // Verified against the shipped SpringAiAgent — this is the actual wire value, not
        // C6's preferred "tool_call"; the drift is the contract change BE-09 documented.
        assertThat(interrupt.reason()).isEqualTo("input_required");
        assertThat(interrupt.message()).isEqualTo("propose_task_mutation");
        assertThat(interrupt.expiresAt()).isNull();
        // Metadata is the SDK-fixed pair — NOT the C6 `{tool, args, summary, origin}` shape.
        assertThat(interrupt.metadata())
                .isInstanceOf(Map.class)
                .satisfies(map -> {
                    Map<?, ?> metadata = (Map<?, ?>) map;
                    assertThat(metadata.get("toolName")).isEqualTo("propose_task_mutation");
                    assertThat(String.valueOf(metadata.get("arguments")))
                            .contains("update_task_status", "DONE", "Mark the login task done");
                });
        // responseSchema is the tool's *input* parameters, not C6's resume-payload schema.
        assertThat(interrupt.responseSchema()).isInstanceOf(Map.class);
        assertThat(((Map<?, ?>) interrupt.responseSchema()).get("type")).isEqualTo("object");
    }

    @Test
    void theResumeIsFoldedBackAsAToolResultOnTheNextRun() throws Exception {
        ToolCallChatModel model = new ToolCallChatModel("propose_task_mutation",
                "{\"tool\":\"delete_task\",\"args\":{\"taskId\":\"abc\",\"reason\":\"done\"},"
                        + "\"summary\":\"Delete abc\",\"reason\":\"done\"}");
        ChatClient client = new AgentConfig().chatClient(ChatClient.builder(model));
        Agent agent = AgentConfig.buildAgent(client, List.of(), new TaskMutationApprovalTools().declarations());

        List<Event> firstEvents = JdkFlowSupport.collect(agent.run(input("delete abc", null)));
        InterruptOutcome outcome = (InterruptOutcome) ((RunFinishedEvent) firstEvents.stream()
                .filter(RunFinishedEvent.class::isInstance).findFirst().orElseThrow()).outcome();
        String interruptId = outcome.interrupts().getFirst().id();

        List<Message> followUp = List.of(new UserMessage("m2", "proceed"));
        JdkFlowSupport.collect(agent.run(input(followUp,
                List.of(new Resume(interruptId, ResumeStatus.RESOLVED,
                        Map.of("approved", true, "result", Map.of("deleted", "abc")))))));

        // The resume must have been threaded into the conversation: the second run's model
        // prompt is the place to prove it, because that is the whole point — the model
        // should see the interrupted call as completed by the human.
        assertThat(renderInstructions(model.lastPrompt()))
                .contains("approved", "deleted", "abc");
    }

    private static String renderInstructions(org.springframework.ai.chat.prompt.Prompt prompt) {
        return prompt.getInstructions().stream()
                .map(Object::toString)
                .reduce("", (a, b) -> a + "\n" + b);
    }

    private static RunAgentInput input(String userText, List<Resume> resume) {
        return input(List.of(new UserMessage("m1", userText)), resume);
    }

    private static RunAgentInput input(List<Message> messages, List<Resume> resume) {
        return new RunAgentInput("t1", "r2", STATE, messages, List.of(), List.of(), null,
                resume == null ? List.of() : resume);
    }
}
