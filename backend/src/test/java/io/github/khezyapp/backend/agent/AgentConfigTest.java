package io.github.khezyapp.backend.agent;

import com.agui.community.core.agent.Agent;
import com.agui.community.core.agent.RunAgentInput;
import com.agui.community.core.event.Event;
import com.agui.community.core.event.EventType;
import com.agui.community.core.event.RunFinishedEvent;
import com.agui.community.core.event.RunStartedEvent;
import com.agui.community.core.event.StateSnapshotEvent;
import com.agui.community.core.interrupt.SuccessOutcome;
import com.agui.community.core.message.UserMessage;
import io.github.khezyapp.backend.testsupport.JdkFlowSupport;
import io.github.khezyapp.backend.testsupport.StubChatModel;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.client.ChatClient;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * BE-07's wiring tests. These drive a real {@code SpringAiAgent} over a
 * {@link StubChatModel}, so they prove the builder configuration and the AG-UI event
 * lifecycle without a model, a network call or a Spring context (NFR-10).
 *
 * <p>Model <em>behaviour</em> — whether the model actually calls a tool, whether it
 * obeys the prompt — is not testable here and is verified manually.
 */
class AgentConfigTest {

    private static final Object STATE = Map.of("context", Map.of("today", "2026-01-05"));

    /** Builds the agent over a stub model and returns the model so prompts can be inspected. */
    private static AgentAndModel agent(String reply) {
        StubChatModel model = new StubChatModel(reply);
        // The production chatClient() method, so the default-system wiring under test is
        // the wiring the container actually uses.
        ChatClient client = new AgentConfig().chatClient(ChatClient.builder(model));
        return new AgentAndModel(AgentConfig.buildAgent(client, List.of(), List.of()), model);
    }

    private record AgentAndModel(Agent agent, StubChatModel model) {
    }

    private static List<Event> run(Agent agent, Object state) throws InterruptedException {
        RunAgentInput input = new RunAgentInput("t1", "r1", state,
                List.of(new UserMessage("m1", "hi")), List.of(), List.of(), null);
        return JdkFlowSupport.collect(agent.run(input));
    }

    @Test
    void buildAgentReturnsAnAgentWithNoTools() {
        assertThat(agent("hello").agent()).isNotNull();
    }

    @Test
    void aRunEmitsStartedSnapshotTextSnapshotAndFinished() throws InterruptedException {
        List<Event> events = run(agent("hello there").agent(), STATE);

        assertThat(events).extracting(Event::type).containsSubsequence(
                EventType.RUN_STARTED,
                EventType.STATE_SNAPSHOT,
                EventType.TEXT_MESSAGE_START,
                EventType.TEXT_MESSAGE_CONTENT,
                EventType.TEXT_MESSAGE_END,
                EventType.RUN_FINISHED);
    }

    @Test
    void theInitialStateSnapshotEchoesTheRunInputState() throws InterruptedException {
        List<Event> events = run(agent("hello there").agent(), STATE);

        StateSnapshotEvent snapshot = events.stream()
                .filter(StateSnapshotEvent.class::isInstance)
                .map(StateSnapshotEvent.class::cast)
                .findFirst()
                .orElseThrow();
        assertThat(snapshot.snapshot()).isEqualTo(STATE);
    }

    @Test
    void runStartedAndRunFinishedCarryTheInputIds() throws InterruptedException {
        List<Event> events = run(agent("hello there").agent(), STATE);

        assertThat(events).filteredOn(RunStartedEvent.class::isInstance).singleElement()
                .isInstanceOfSatisfying(RunStartedEvent.class,
                        e -> assertThat(e.threadId()).isEqualTo("t1"));
        RunFinishedEvent finished = (RunFinishedEvent) events.stream()
                .filter(RunFinishedEvent.class::isInstance)
                .findFirst()
                .orElseThrow();
        assertThat(finished.runId()).isEqualTo("r1");
        assertThat(finished.type()).isEqualTo(EventType.RUN_FINISHED);
    }

    /**
     * The bare SDK leaves {@code outcome} null when nothing paused the run.
     * {@link SuccessOutcomeAgent} fills that in, so the wrapper — which is what the
     * container registers — always finishes with an explicit outcome.
     */
    @Test
    void theBareSdkLeavesTheOutcomeNullButTheWrapperDefaultsItToSuccess() throws InterruptedException {
        RunAgentInput input = new RunAgentInput("t1", "r1", STATE,
                List.of(new UserMessage("m1", "hi")), List.of(), List.of(), null);
        AgentAndModel wired = agent("hello there");

        assertThat(outcomeOf(JdkFlowSupport.collect(wired.agent().run(input))))
                .as("the raw SpringAiAgent emits no outcome at all")
                .isNull();
        assertThat(outcomeOf(JdkFlowSupport.collect(
                        new SuccessOutcomeAgent(wired.agent()).run(input))))
                .as("the registered agent always says how the run ended")
                .isInstanceOf(SuccessOutcome.class);
    }

    private static Object outcomeOf(List<Event> events) {
        return ((RunFinishedEvent) events.stream()
                .filter(RunFinishedEvent.class::isInstance)
                .findFirst()
                .orElseThrow())
                .outcome();
    }

    /**
     * The snapshot is intentionally disabled: its tool calls serialise without
     * {@code "type":"function"} and the client's schema rejects the event, aborting the
     * run (FE-14 defect). This pins the stopgap so it is not re-enabled silently.
     */
    @Test
    void aMessagesSnapshotIsNotEmitted() throws InterruptedException {
        List<Event> events = run(agent("hello there").agent(), STATE);

        assertThat(events).extracting(Event::type).doesNotContain(EventType.MESSAGES_SNAPSHOT);
    }

    /** No state on the input means no snapshot: sharing state is opt-in per run. */
    @Test
    void aRunWithoutStateEmitsNoStateSnapshot() throws InterruptedException {
        List<Event> events = run(agent("hello there").agent(), null);

        assertThat(events).extracting(Event::type).doesNotContain(EventType.STATE_SNAPSHOT);
    }

    @Test
    void theSystemPromptReachesTheModel() throws InterruptedException {
        AgentAndModel wired = agent("hello there");
        run(wired.agent(), STATE);

        assertThat(systemText(wired))
                .contains(AgentPrompts.SYSTEM_PROMPT)
                .as("the default system message is the whole prompt, verbatim");
    }

    @Test
    void theStatePromptIsInjectedWhenStateIsPresent() throws InterruptedException {
        AgentAndModel wired = agent("hello there");
        run(wired.agent(), STATE);

        assertThat(systemText(wired))
                .contains(AgentPrompts.STATE_PROMPT.apply(STATE))
                .contains("2026-01-05");
    }

    /** Everything the model was told, concatenated, so a `contains` sees whole prompts. */
    private static String systemText(AgentAndModel wired) {
        return wired.model().lastPrompt().getInstructions().stream()
                .filter(m -> m.getText() != null)
                .map(org.springframework.ai.chat.messages.Message::getText)
                .reduce("", (a, b) -> a + "\n" + b);
    }

}
