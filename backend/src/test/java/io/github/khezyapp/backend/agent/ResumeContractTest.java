package io.github.khezyapp.backend.agent;

import com.agui.community.core.interrupt.Resume;
import com.agui.community.core.interrupt.ResumeStatus;
import com.agui.community.spring.server.core.JacksonSerializer;
import java.util.Map;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * BE-09 §6's resume contract test, with no model: the payload shapes we promise FE-12 are
 * the ones a {@code Resume} deserialises into and that {@link ResumePayloadValidator} then
 * accepts or rejects. Disagreement between this file and the FE mirror is the bug.
 */
class ResumeContractTest {

    private final JacksonSerializer serializer = new JacksonSerializer();

    @Test
    @SuppressWarnings("unchecked")
    void anApprovedSuccessPayloadDeserialisesAndValidates() {
        String wire = "{\"interruptId\":\"i1\",\"status\":\"resolved\","
                + "\"payload\":{\"approved\":true,\"result\":{\"id\":\"abc\",\"status\":\"DONE\"}}}";

        Resume resume = serializer.deserialize(wire, Resume.class);

        assertThat(resume.interruptId()).isEqualTo("i1");
        assertThat(resume.status()).isEqualTo(ResumeStatus.RESOLVED);
        Map<String, Object> payload = (Map<String, Object>) resume.payload();
        assertThat(payload.get("approved")).isEqualTo(true);
        assertThat(ResumePayloadValidator.isDocumented(payload)).isTrue();
        assertThat(ResumePayloadValidator.isApprovedSuccess(payload)).isTrue();
    }

    @Test
    @SuppressWarnings("unchecked")
    void anApprovedFailurePayloadDeserialisesAndValidates() {
        String wire = "{\"interruptId\":\"i1\",\"status\":\"resolved\","
                + "\"payload\":{\"approved\":true,\"error\":\"status IN_REVIEW → BACKLOG is not allowed.\"}}";

        Map<String, Object> payload = (Map<String, Object>) serializer.deserialize(wire, Resume.class).payload();

        assertThat(ResumePayloadValidator.isApprovedFailure(payload)).isTrue();
        assertThat(ResumePayloadValidator.isDocumented(payload)).isTrue();
    }

    @Test
    @SuppressWarnings("unchecked")
    void aRejectedPayloadCarriesTheUsersWords() {
        String wire = "{\"interruptId\":\"i1\",\"status\":\"resolved\","
                + "\"payload\":{\"approved\":false,\"reason\":\"not mine\"}}";

        Map<String, Object> payload = (Map<String, Object>) serializer.deserialize(wire, Resume.class).payload();

        assertThat(payload.get("reason")).isEqualTo("not mine");
        assertThat(ResumePayloadValidator.isRejected(payload)).isTrue();
        assertThat(ResumePayloadValidator.isDocumented(payload)).isTrue();
    }

    @Test
    @SuppressWarnings("unchecked")
    void aCancelledResumeNeedsNoPayload() {
        String wire = "{\"interruptId\":\"i1\",\"status\":\"cancelled\"}";

        Resume resume = serializer.deserialize(wire, Resume.class);

        assertThat(resume.status()).isEqualTo(ResumeStatus.CANCELLED);
        assertThat(resume.payload()).isNull();
    }

    @Test
    @SuppressWarnings("unchecked")
    void aPayloadMissingApprovedIsRejectedByTheValidator() {
        String wire = "{\"interruptId\":\"i1\",\"status\":\"resolved\","
                + "\"payload\":{\"result\":{\"id\":\"abc\"}}}";

        Map<String, Object> payload = (Map<String, Object>) serializer.deserialize(wire, Resume.class).payload();

        // Obs: a Resume with no `approved` deserialises fine on its own, but the FE validator
        // — and therefore the card — must refuse it, because the model would have no way of
        // telling "approved without a result" from "not approved".
        assertThat(payload).doesNotContainKey("approved");
        assertThat(ResumePayloadValidator.hasApprovedFlag(payload)).isFalse();
        assertThat(ResumePayloadValidator.isDocumented(payload)).isFalse();
    }

    @Test
    void aPayloadWithBothResultAndErrorIsNotDocumented() {
        Map<String, Object> payload = Map.of(
                "approved", true,
                "result", Map.of("id", "abc"),
                "error", "but it also failed");

        assertThat(ResumePayloadValidator.isDocumented(payload)).isFalse();
    }
}
