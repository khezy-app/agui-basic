package io.github.khezyapp.backend.bootstrap;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * {@code app.seed.*} — the demo fixture profile (FR-B-15).
 *
 * <p>{@code tasks} must stay at 40 or above: the seeder's own self-check
 * ({@code SeedDataRunner.verify}) demands enough rows to satisfy every §4.2 requirement,
 * and a smaller number fails fast at boot rather than shipping a fixture that makes only
 * some filters demonstrable.
 */
@ConfigurationProperties(prefix = "app.seed")
public record SeedDataProperties(boolean enabled, int members, int tasks) {

    public static final int MINIMUM_TASKS = 40;
    public static final int MINIMUM_MEMBERS = 6;
    public static final int DEFAULT_MEMBERS = 6;
    public static final int DEFAULT_TASKS = 50;

    public SeedDataProperties {
        if (members <= 0) {
            members = DEFAULT_MEMBERS;
        }
        if (tasks <= 0) {
            tasks = DEFAULT_TASKS;
        }
    }
}