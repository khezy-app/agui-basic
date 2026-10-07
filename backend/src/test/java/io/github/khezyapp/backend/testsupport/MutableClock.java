package io.github.khezyapp.backend.testsupport;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;

/**
 * A {@link Clock} whose instant can be moved forward on demand. Repository tests need
 * two different "now" values to prove {@code updatedAt} advances; a fixed clock alone
 * cannot show that.
 */
public final class MutableClock extends Clock {

    private Instant instant;
    private final ZoneId zone;

    public MutableClock(Instant instant) {
        this(instant, ZoneOffset.UTC);
    }

    private MutableClock(Instant instant, ZoneId zone) {
        this.instant = instant;
        this.zone = zone;
    }

    public static MutableClock at(String isoInstant) {
        return new MutableClock(Instant.parse(isoInstant));
    }

    public void advanceSeconds(long seconds) {
        this.instant = this.instant.plusSeconds(seconds);
    }

    @Override
    public ZoneId getZone() {
        return zone;
    }

    @Override
    public Clock withZone(ZoneId zone) {
        return new MutableClock(instant, zone);
    }

    @Override
    public Instant instant() {
        return instant;
    }
}