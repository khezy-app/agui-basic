package io.github.khezyapp.backend.testsupport;

import java.util.List;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.chat.prompt.Prompt;
import reactor.core.publisher.Flux;

/**
 * A {@link ChatModel} that answers a fixed reply without contacting anything (NFR-10:
 * no model in CI). It records the last {@link Prompt} it saw so a test can assert what
 * the agent actually put in front of the model — which is how BE-07 proves the system
 * prompt and the state prompt are injected.
 */
public final class StubChatModel implements ChatModel {

    private final String reply;

    private Prompt lastPrompt;

    public StubChatModel(String reply) {
        this.reply = reply;
    }

    /** The prompt handed to the model by the most recent call, or {@code null}. */
    public Prompt lastPrompt() {
        return lastPrompt;
    }

    @Override
    public ChatResponse call(Prompt prompt) {
        this.lastPrompt = prompt;
        return response();
    }

    @Override
    public Flux<ChatResponse> stream(Prompt prompt) {
        this.lastPrompt = prompt;
        return Flux.just(response());
    }

    private ChatResponse response() {
        return new ChatResponse(List.of(new Generation(new AssistantMessage(reply))));
    }
}