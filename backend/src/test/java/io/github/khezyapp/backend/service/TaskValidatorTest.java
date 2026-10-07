package io.github.khezyapp.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.assertj.core.api.InstanceOfAssertFactories;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import io.github.khezyapp.backend.domain.task.TaskPriority;
import io.github.khezyapp.backend.domain.team.TeamMember;
import io.github.khezyapp.backend.domain.team.TeamMemberRole;
import io.github.khezyapp.backend.error.FieldError;
import io.github.khezyapp.backend.error.ValidationApiException;
import io.github.khezyapp.backend.repository.InMemoryTeamMemberRepository;

class TaskValidatorTest {

    private final UUID memberId = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");
    private final UUID strangerId = UUID.fromString("bbbbbbbb-0000-0000-0000-000000000002");

    private InMemoryTeamMemberRepository members;
    private TaskValidator validator;

    @BeforeEach
    void setUp() {
        members = new InMemoryTeamMemberRepository();
        members.save(new TeamMember(memberId, "Ada Lovelace", "ada@example.test", TeamMemberRole.ENGINEER));
        validator = new TaskValidator(members);
    }

    private void validate(String title, String description, TaskPriority priority,
                          UUID assigneeId, UUID reporterId, LocalDate dueDate,
                          BigDecimal estimateHours, List<String> tags) {
        validator.validate(title, description, priority, assigneeId, reporterId, dueDate,
                estimateHours, tags);
    }

    private static List<FieldError> errorsOf(Throwable thrown) {
        return ((ValidationApiException) thrown).getErrors();
    }

    // -------------------------------------------------------------------- title

    @ParameterizedTest
    @ValueSource(strings = { "", " ", "\t\n " })
    void blankTitleIsRejected(String title) {
        assertThatThrownBy(() -> validate(title, null, TaskPriority.MEDIUM, null, null, null, null, null))
                .extracting(TaskValidatorTest::errorsOf)
                .asInstanceOf(InstanceOfAssertFactories.list(FieldError.class))
                .containsExactly(new FieldError("title", "must not be blank"));
    }

    @Test
    void nullTitleIsRejected() {
        assertThatThrownBy(() -> validate(null, null, TaskPriority.MEDIUM, null, null, null, null, null))
                .isInstanceOf(ValidationApiException.class);
    }

    @Test
    void titleOf160CharsIsAccepted() {
        assertThatCode(() -> validate("x".repeat(160), null, TaskPriority.MEDIUM, null, null, null, null, null))
                .doesNotThrowAnyException();
    }

    @Test
    void titleOver160CharsIsRejected() {
        assertThatThrownBy(() -> validate("x".repeat(161), null, TaskPriority.MEDIUM, null, null, null, null, null))
                .extracting(TaskValidatorTest::errorsOf)
                .asInstanceOf(InstanceOfAssertFactories.list(FieldError.class))
                .containsExactly(new FieldError("title", "must be at most 160 characters"));
    }

    // -------------------------------------------------------------- description

    @Test
    void descriptionOf4000CharsIsAccepted() {
        assertThatCode(() -> validate("t", "x".repeat(4000), TaskPriority.MEDIUM, null, null, null, null, null))
                .doesNotThrowAnyException();
    }

    @Test
    void descriptionOver4000CharsIsRejected() {
        assertThatThrownBy(() -> validate("t", "x".repeat(4001), TaskPriority.MEDIUM, null, null, null, null, null))
                .extracting(TaskValidatorTest::errorsOf)
                .asInstanceOf(InstanceOfAssertFactories.list(FieldError.class))
                .containsExactly(new FieldError("description", "must be at most 4000 characters"));
    }

    // ----------------------------------------------------------- estimateHours

    @ParameterizedTest
    @ValueSource(strings = { "0", "0.0", "0.5", "12", "999" })
    void legalEstimatesAreAccepted(String value) {
        assertThatCode(() -> validate("t", null, TaskPriority.MEDIUM, null, null, null,
                new BigDecimal(value), null))
                .doesNotThrowAnyException();
    }

    @ParameterizedTest
    @ValueSource(strings = { "-0.1", "-1", "999.9", "1000" })
    void outOfRangeEstimatesAreRejected(String value) {
        assertThatThrownBy(() -> validate("t", null, TaskPriority.MEDIUM, null, null, null,
                new BigDecimal(value), null))
                .extracting(TaskValidatorTest::errorsOf)
                .asInstanceOf(InstanceOfAssertFactories.list(FieldError.class))
                .containsExactly(new FieldError("estimateHours", "must be between 0 and 999"));
    }

    @Test
    void anEstimateWithTooManyDecimalsIsRejected() {
        assertThatThrownBy(() -> validate("t", null, TaskPriority.MEDIUM, null, null, null,
                new BigDecimal("1.234"), null))
                .extracting(TaskValidatorTest::errorsOf)
                .asInstanceOf(InstanceOfAssertFactories.list(FieldError.class))
                .containsExactly(new FieldError("estimateHours", "must have at most 1 decimal place"));
    }

    @Test
    void trailingZerosDoNotCountAsDecimalPlaces() {
        assertThatCode(() -> validate("t", null, TaskPriority.MEDIUM, null, null, null,
                new BigDecimal("1.50"), null))
                .doesNotThrowAnyException();
    }

    // --------------------------------------------------------------------- tags

    @Test
    void fiveTagsAreAccepted() {
        assertThatCode(() -> validate("t", null, TaskPriority.MEDIUM, null, null, null, null,
                List.of("a", "b", "c", "d", "e")))
                .doesNotThrowAnyException();
    }

    @Test
    void sixTagsAreRejected() {
        assertThatThrownBy(() -> validate("t", null, TaskPriority.MEDIUM, null, null, null, null,
                List.of("a", "b", "c", "d", "e", "f")))
                .extracting(TaskValidatorTest::errorsOf)
                .asInstanceOf(InstanceOfAssertFactories.list(FieldError.class))
                .containsExactly(new FieldError("tags", "must contain at most 5 entries"));
    }

    @Test
    void anOffendingTagIsReportedByIndex() {
        assertThatThrownBy(() -> validate("t", null, TaskPriority.MEDIUM, null, null, null, null,
                List.of("fine", "x".repeat(25), "alsogood", "y".repeat(25))))
                .extracting(TaskValidatorTest::errorsOf)
                .asInstanceOf(InstanceOfAssertFactories.list(FieldError.class))
                .containsExactly(
                        new FieldError("tags[1]", "must be 1–24 characters"),
                        new FieldError("tags[3]", "must be 1–24 characters"));
    }

    @Test
    void aBlankTagIsRejected() {
        assertThatThrownBy(() -> validate("t", null, TaskPriority.MEDIUM, null, null, null, null,
                List.of("ok", "  ")))
                .extracting(TaskValidatorTest::errorsOf)
                .asInstanceOf(InstanceOfAssertFactories.list(FieldError.class))
                .containsExactly(new FieldError("tags[1]", "must be 1–24 characters"));
    }

    @Test
    void collectTagErrorsAppendsToTheCallersSink() {
        List<FieldError> sink = new ArrayList<>();

        TaskValidator.collectTagErrors(List.of("ok"), sink);

        assertThat(sink).isEmpty();
    }

    // --------------------------------------------------------- team references

    @Test
    void aKnownAssigneeIsAccepted() {
        assertThatCode(() -> validate("t", null, TaskPriority.MEDIUM, memberId, memberId, null, null, null))
                .doesNotThrowAnyException();
    }

    @Test
    void unknownAssigneeAndReporterAreBothReported() {
        assertThatThrownBy(() -> validate("t", null, TaskPriority.MEDIUM, strangerId, strangerId, null, null, null))
                .extracting(TaskValidatorTest::errorsOf)
                .asInstanceOf(InstanceOfAssertFactories.list(FieldError.class))
                .containsExactly(
                        new FieldError("assigneeId", "unknown team member"),
                        new FieldError("reporterId", "unknown team member"));
    }

    @Test
    void aNullPriorityIsRejected() {
        assertThatThrownBy(() -> validate("t", null, null, null, null, null, null, null))
                .extracting(TaskValidatorTest::errorsOf)
                .asInstanceOf(InstanceOfAssertFactories.list(FieldError.class))
                .containsExactly(new FieldError("priority", "must not be null"));
    }

    // ------------------------------------------------------- collection order

    @Test
    void everyViolationArrivesInOneExceptionInRuleOrder() {
        assertThatThrownBy(() -> validate("  ", "x".repeat(4001), TaskPriority.MEDIUM,
                strangerId, strangerId, null, new BigDecimal("1000.55"),
                List.of("a", "b", "c", "d", "e", "z".repeat(30))))
                .isInstanceOf(ValidationApiException.class)
                .hasMessage("8 fields are invalid")
                .extracting(TaskValidatorTest::errorsOf)
                .asInstanceOf(InstanceOfAssertFactories.list(FieldError.class))
                .containsExactly(
                        new FieldError("title", "must not be blank"),
                        new FieldError("description", "must be at most 4000 characters"),
                        new FieldError("estimateHours", "must be between 0 and 999"),
                        new FieldError("estimateHours", "must have at most 1 decimal place"),
                        new FieldError("tags", "must contain at most 5 entries"),
                        new FieldError("tags[5]", "must be 1–24 characters"),
                        new FieldError("assigneeId", "unknown team member"),
                        new FieldError("reporterId", "unknown team member"));
    }

    @Test
    void statusIsRejectedByFieldName() {
        assertThatThrownBy(TaskValidator::rejectStatusChange)
                .isInstanceOf(ValidationApiException.class)
                .hasMessage("status cannot be changed via field update")
                .extracting(TaskValidatorTest::errorsOf)
                .asInstanceOf(InstanceOfAssertFactories.list(FieldError.class))
                .containsExactly(new FieldError("status", "status cannot be changed via field update"));
    }

    // ----------------------------------------------------------- normalisation

    @Test
    void normalisersProduceTheStoredForm() {
        assertThat(TaskValidator.normalizeTitle("  spaced  ")).isEqualTo("spaced");
        assertThat(TaskValidator.normalizeTitle(null)).isNull();
        assertThat(TaskValidator.normalizeDescription("   ")).isNull();
        assertThat(TaskValidator.normalizeDescription(null)).isNull();
        assertThat(TaskValidator.normalizeDescription(" text ")).isEqualTo("text");
        assertThat(TaskValidator.normalizeTags(null)).isEmpty();
        assertThat(TaskValidator.normalizeTags(java.util.Arrays.asList(" B ", "a", "b", null, "")))
                .containsExactly("b", "a");
    }

    @Test
    void validateNewAndValidatePatchApplyIdenticalRules() {
        assertThatThrownBy(() -> validator.validateNew("", null, TaskPriority.MEDIUM, null, null, null, null, null))
                .isInstanceOf(ValidationApiException.class);
        assertThatThrownBy(() -> validator.validatePatch("", null, TaskPriority.MEDIUM, null, null, null, null, null))
                .isInstanceOf(ValidationApiException.class);
    }
}