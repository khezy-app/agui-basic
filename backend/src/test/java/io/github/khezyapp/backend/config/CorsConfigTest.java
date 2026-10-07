package io.github.khezyapp.backend.config;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * BE-06 stubbed {@code GET /api/tasks} with its own controller; BE-04 added the real one,
 * so the stub is gone and these assertions now exercise the production mapping — which is
 * the follow-up BE-06's own handoff asked for.
 */
@SpringBootTest
@AutoConfigureMockMvc
class CorsConfigTest {

    private static final String ALLOWED_ORIGIN = "http://localhost:5173";
    private static final String DENIED_ORIGIN = "https://evil.example";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private CorsConfig corsConfig;

    @Test
    void preflightForApiIsAllowedFromTheDevServerOrigin() throws Exception {
        mockMvc.perform(options("/api/tasks")
                        .header(HttpHeaders.ORIGIN, ALLOWED_ORIGIN)
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "GET"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, ALLOWED_ORIGIN))
                .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_METHODS,
                        "GET,POST,PATCH,DELETE,OPTIONS"));
    }

    @Test
    void preflightForApiIsRejectedForAnUnknownOrigin() throws Exception {
        mockMvc.perform(options("/api/tasks")
                        .header(HttpHeaders.ORIGIN, DENIED_ORIGIN)
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "GET"))
                .andExpect(status().isForbidden())
                .andExpect(header().doesNotExist(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN));
    }

    @Test
    void apiRequestWithoutOriginIsUnaffectedByCors() throws Exception {
        mockMvc.perform(get("/api/tasks"))
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN));
    }

    @Test
    void agentMappingAllowsOnlyPost() {
        CorsConfiguration agent = registeredMappings().get("/agent");

        assertThat(agent).isNotNull();
        assertThat(agent.getAllowedOrigins()).containsExactly(ALLOWED_ORIGIN);
        assertThat(agent.getAllowedMethods()).containsExactlyInAnyOrder("POST", "OPTIONS");
        assertThat(agent.getExposedHeaders()).containsExactly("Content-Type");
        assertThat(agent.getAllowCredentials()).isNotEqualTo(true);
    }

    @Test
    void agentMappingDoesNotAllowGet() {
        assertThat(registeredMappings().get("/agent").getAllowedMethods()).doesNotContain("GET");
    }

    @Test
    void apiMappingIsRegisteredUnderTheApiPrefix() {
        CorsConfiguration api = registeredMappings().get("/api/**");

        assertThat(api).isNotNull();
        assertThat(api.getAllowedOrigins()).containsExactly(ALLOWED_ORIGIN);
    }

    private Map<String, CorsConfiguration> registeredMappings() {
        WebMvcConfigurer configurer = new CorsConfig(List.of(ALLOWED_ORIGIN)).corsConfigurer();
        InspectableCorsRegistry registry = new InspectableCorsRegistry();
        configurer.addCorsMappings(registry);
        return registry.configurations();
    }

    static class InspectableCorsRegistry extends CorsRegistry {
        Map<String, CorsConfiguration> configurations() {
            return getCorsConfigurations();
        }
    }
}