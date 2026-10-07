package io.github.khezyapp.backend.agent;

import com.agui.community.core.agent.Agent;
import com.agui.community.core.agent.RunAgentInput;
import com.agui.community.core.event.Event;
import com.agui.community.core.event.RunFinishedEvent;
import com.agui.community.core.interrupt.SuccessOutcome;
import java.util.Objects;
import java.util.concurrent.Flow;
import org.springframework.context.annotation.Bean;

/**
 * Wraps an {@link Agent} so every {@code RUN_FINISHED} carries an explicit outcome.
 *
 * <p>Why this is needed: {@code SpringAiAgent} leaves {@code RunFinishedEvent.outcome}
 * {@code null} when nothing paused the run, so the wire reads
 * {@code {"type":"RUN_FINISHED","threadId":…,"runId":…}} with no {@code outcome} field at
 * all. Only an interrupt run carries {@code {"type":"interrupt","interrupts":[…]}}. The
 * spec's DoD and FE-13 both assume a run always says how it ended, and a client that
 * branches on "outcome is present" will eventually forget the absent case.
 *
 * <p>The invariant this decorator establishes:
 * <strong>{@code RUN_FINISHED.outcome.type} is always {@code "success"} or
 * {@code "interrupt"}.</strong> A {@code RUN_ERROR} is a separate terminal event and is
 * left untouched.
 *
 * <p>Declared as a {@link Bean} so it is the single {@code Agent} the container
 * registers — {@code AgentRegistry.single()} only serves the bare {@code /agent} path
 * when exactly one agent exists.
 */
public final class SuccessOutcomeAgent implements Agent {

    private final Agent delegate;

    public SuccessOutcomeAgent(Agent delegate) {
        this.delegate = Objects.requireNonNull(delegate, "delegate must not be null");
    }

    @Override
    public Flow.Publisher<Event> run(RunAgentInput input) {
        Objects.requireNonNull(input, "input must not be null");
        return downstream -> delegate.run(input).subscribe(new ForwardingSubscriber(downstream));
    }

    /** Re-emits every event, defaulting the outcome on the terminal {@code RUN_FINISHED}. */
    private static final class ForwardingSubscriber implements Flow.Subscriber<Event> {

        private final Flow.Subscriber<? super Event> downstream;

        private ForwardingSubscriber(Flow.Subscriber<? super Event> downstream) {
            this.downstream = Objects.requireNonNull(downstream, "downstream must not be null");
        }

        @Override
        public void onSubscribe(Flow.Subscription subscription) {
            downstream.onSubscribe(subscription);
        }

        @Override
        public void onNext(Event event) {
            downstream.onNext(withDefaultOutcome(event));
        }

        @Override
        public void onError(Throwable throwable) {
            downstream.onError(throwable);
        }

        @Override
        public void onComplete() {
            downstream.onComplete();
        }
    }

    /** Passes every event through untouched except a {@code RUN_FINISHED} with no outcome. */
    private static Event withDefaultOutcome(Event event) {
        if (!(event instanceof RunFinishedEvent finished) || finished.outcome() != null) {
            return event;
        }
        return new RunFinishedEvent(finished.threadId(), finished.runId(), new SuccessOutcome(),
                finished.result(), finished.timestamp(), finished.rawEvent());
    }
}