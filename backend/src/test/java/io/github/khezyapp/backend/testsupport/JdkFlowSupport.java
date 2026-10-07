package io.github.khezyapp.backend.testsupport;

import com.agui.community.core.event.Event;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Collects a Flow of AG-UI events to a list with a latch guard. The SDK's publisher is
 * backed by a Reactor Flux, so events can arrive on another thread; the latch is what
 * makes the assertions deterministic. Moved here so BE-09's interrupt tests reuse it.
 */
public final class JdkFlowSupport {

    private JdkFlowSupport() {
    }

    public static List<Event> collect(java.util.concurrent.Flow.Publisher<Event> publisher)
            throws InterruptedException {
        List<Event> events = new ArrayList<>();
        CountDownLatch done = new CountDownLatch(1);
        publisher.subscribe(new java.util.concurrent.Flow.Subscriber<>() {
            @Override
            public void onSubscribe(java.util.concurrent.Flow.Subscription subscription) {
                subscription.request(Long.MAX_VALUE);
            }

            @Override
            public void onNext(Event item) {
                events.add(item);
            }

            @Override
            public void onError(Throwable throwable) {
                done.countDown();
            }

            @Override
            public void onComplete() {
                done.countDown();
            }
        });
        assertThat(done.await(10, TimeUnit.SECONDS))
                .as("the agent run terminated")
                .isTrue();
        return events;
    }
}
