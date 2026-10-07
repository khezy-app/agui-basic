package io.github.khezyapp.backend.common;

import java.time.Clock;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Single source of {@link Clock} for the whole application. Every "now" — overdue
 * checks, {@code updatedAt} stamping, seed data, stats windows — resolves through this
 * bean so tests can replace it with a fixed clock (INV-5: the server owns timestamps).
 */
@Configuration
public class ClockConfig {

    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }
}