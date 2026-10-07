package io.github.khezyapp.backend.testsupport;

import java.util.List;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.chat.prompt.Prompt;
import reactor.core.publisher.Flux;

/**
 * A {@link ChatModel} that answers with an assistant message carrying <em>one</em> tool call
 * instead of text, so a test can drive the interrupt path end-to-end without a model: the
 * agent sees a model that wants a tool, and the SDK should fold that into an
 * {@code InterruptOutcome}. NFR-10 — no real model in CI.
 */
public final class ToolCallChatModel implements ChatModel {

    private final String toolName;
    private final String arguments;

    public ToolCallChatModel(String toolName, String arguments) {
        this.toolName = toolName;
        this.arguments = arguments;
    }

    private Prompt lastPrompt;

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
        AssistantMessage message = AssistantMessage.builder()
                .content("")
                .toolCalls(List.of(new AssistantMessage.ToolCall("call-1", "function", toolName,
                        arguments)))
                .build();
        return new ChatResponse(List.of(new Generation(message)));
    }
}
