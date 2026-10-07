package io.github.khezyapp.backend.error;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import io.github.khezyapp.backend.config.StrictJsonConfig;

@WebMvcTest(controllers = StrictJsonTest.ProbeController.class)
@Import({ StrictJsonConfig.class, StrictJsonTest.ProbeController.class })
@AutoConfigureMockMvc(addFilters = false)
class StrictJsonTest {

    private static final String GOOD_BODY = """
            {"name":"task","size":2}""";

    private static final String BODY_WITH_UNKNOWN_FIELD = """
            {"name":"task","size":2,"id":"11111111-1111-1111-1111-111111111111"}""";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void knownFieldsAreAccepted() throws Exception {
        mockMvc.perform(post("/probe").contentType(MediaType.APPLICATION_JSON).content(GOOD_BODY))
                .andExpect(status().isOk());
    }

    @Test
    void unknownFieldIsRejectedAsUnprocessable() throws Exception {
        MvcResult result = mockMvc.perform(post("/probe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(BODY_WITH_UNKNOWN_FIELD))
                .andExpect(status().isUnprocessableEntity())
                .andReturn();

        JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
        assertThat(body.get("type").asText()).endsWith("/unprocessable");
        assertThat(body.get("status").asInt()).isEqualTo(422);
        assertThat(body.get("detail").asText()).isEqualTo("malformed or unknown field in request body");
        assertThat(body.get("detail").asText()).doesNotContain("id");
        assertThat(body.get("instance").asText()).isEqualTo("/probe");
        assertThat(body.get("errors").isArray()).isTrue();
        assertThat(body.get("errors")).isEmpty();
    }

    @RestController
    static class ProbeController {

        @PostMapping("/probe")
        String accept(@RequestBody ProbeRequest request) {
            return request.name() + ":" + request.size();
        }
    }

    record ProbeRequest(String name, int size) {
    }
}