package io.github.khezyapp.backend.config;

import org.springframework.boot.jackson.autoconfigure.JsonMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import tools.jackson.databind.DeserializationFeature;

/**
 * FR-B-19: an unknown JSON property is a client bug, not something to silently drop.
 * Jackson 3 ({@code tools.jackson}) is what Boot 4 resolves, so this hooks the
 * {@link JsonMapperBuilderCustomizer} rather than the Jackson 2 builder customizer.
 */
@Configuration
public class StrictJsonConfig {

    @Bean
    JsonMapperBuilderCustomizer strictJson() {
        return builder -> builder.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, true);
    }
}