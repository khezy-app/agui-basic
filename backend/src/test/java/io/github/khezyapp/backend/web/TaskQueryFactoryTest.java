package io.github.khezyapp.backend.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import io.github.khezyapp.backend.domain.TaskQuery;
import io.github.khezyapp.backend.domain.TaskSortField;
import io.github.khezyapp.backend.domain.task.TaskPriority;
import io.github.khezyapp.backend.domain.task.TaskStatus;
import io.github.khezyapp.backend.error.UnprocessableApiException;
import io.github.khezyapp.backend.error.ValidationApiException;

class TaskQueryFactoryTest {

    private static final UUID ASSIGNEE = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");

    private TaskQueryFactory factory;

    @BeforeEach
    void setUp() {
        factory = new TaskQueryFactory(Clock.fixed(Instant.parse("2026-01-05T10:15:30Z"), ZoneId.of("UTC")));
    }

    private TaskQuery build() {
        return factory.from(null, null, null, null, null, null, null, null, null, null, null, null, null);
    }

    private TaskQuery build(List<String> status, List<String> priority, UUID assigneeId, String unassigned,
                            String tag, String q, String overdue, Integer dueWithinDays,
                            String createdFrom, String createdTo,
                            String sort, Integer page, Integer size) {
        return factory.from(status, priority, assigneeId, unassigned, tag, q, overdue, dueWithinDays,
                createdFrom, createdTo, sort, page, size);
    }

    @Test
    void defaultsAreTheDocumentedOnes() {
        TaskQuery query = build();

        assertThat(query.statuses()).isEmpty();
        assertThat(query.priorities()).isEmpty();
        assertThat(query.assigneeId()).isNull();
        assertThat(query.unassignedOnly()).isFalse();
        assertThat(query.overdueOnly()).isFalse();
        assertThat(query.tag()).isNull();
        assertThat(query.text()).isNull();
        assertThat(query.dueWithinDays()).isNull();
        assertThat(query.page()).isZero();
        assertThat(query.size()).isEqualTo(TaskQuery.DEFAULT_SIZE);
        assertThat(query.sort()).isEqualTo(TaskQuery.SortSpec.descending(TaskSortField.CREATED_AT));
    }

    @Test
    void repeatedEnumParamsCombineAsAUnion() {
        TaskQuery query = build(List.of("todo", "BLOCKED"), null, null, null, null, null, null, null,
                null, null, null, null, null);

        assertThat(query.statuses()).containsExactlyInAnyOrder(TaskStatus.TODO, TaskStatus.BLOCKED);
    }

    @Test
    void blankEnumEntriesAreDropped() {
        TaskQuery query = build(Arrays("todo", "  ", null), null, null, null, null, null, null, null,
                null, null, null, null, null);

        assertThat(query.statuses()).containsExactly(TaskStatus.TODO);
    }

    @Test
    void prioritiesAreParsedToo() {
        TaskQuery query = build(null, List.of("urgent"), null, null, null, null, null, null,
                null, null, null, null, null);

        assertThat(query.priorities()).containsExactly(TaskPriority.URGENT);
    }

    @Test
    void anUnknownStatusValueIs422AndNamesTheValue() {
        assertThatThrownBy(() -> build(List.of("NOPE"), null, null, null, null, null, null, null,
                null, null, null, null, null))
                .isInstanceOf(UnprocessableApiException.class)
                .hasMessageContaining("'NOPE'")
                .hasMessageContaining("status");
    }

    @Test
    void anUnknownPriorityValueIs422() {
        assertThatThrownBy(() -> build(null, List.of("NOPE"), null, null, null, null, null, null,
                null, null, null, null, null))
                .isInstanceOf(UnprocessableApiException.class)
                .hasMessageContaining("'NOPE'");
    }

    @Test
    void unassignedAndOverdueOnlyCountTrue() {
        assertThat(build(null, null, null, "true", null, null, "true", null,
                null, null, null, null, null).unassignedOnly()).isTrue();
        assertThat(build(null, null, null, "false", null, null, "false", null,
                null, null, null, null, null).unassignedOnly()).isFalse();
        assertThat(build(null, null, null, null, null, null, null, null,
                null, null, null, null, null).unassignedOnly()).isFalse();
    }

    @Test
    void tagIsLowerCasedAndTextIsTrimmedByTheQuery() {
        TaskQuery query = build(null, null, null, null, "  Alpha ", "  hello  ", null, null,
                null, null, null, null, null);

        assertThat(query.tag()).isEqualTo("alpha");
        assertThat(query.text()).isEqualTo("hello");
    }

    @Test
    void blankSearchTextBecomesNoFilter() {
        assertThat(build(null, null, null, null, null, "   ", null, null,
                null, null, null, null, null).text()).isNull();
    }

    @Test
    void dueWithinDaysMustNotBeNegative() {
        assertThatThrownBy(() -> build(null, null, null, null, null, null, null, -1,
                null, null, null, null, null))
                .isInstanceOf(ValidationApiException.class)
                .hasMessageContaining("dueWithinDays");
    }

    @Test
    void createdFromExpandsToTheStartOfTheDay() {
        TaskQuery query = build(null, null, null, null, null, null, null, null,
                "2026-01-05", null, null, null, null);

        assertThat(query.createdFrom()).isEqualTo(Instant.parse("2026-01-05T00:00:00Z"));
    }

    @Test
    void createdToExpandsToTheEndOfTheDaySoItIsInclusive() {
        TaskQuery query = build(null, null, null, null, null, null, null, null,
                null, "2026-01-05", null, null, null);

        assertThat(query.createdTo()).isEqualTo(Instant.parse("2026-01-05T23:59:59.999999999Z"));
    }

    @Test
    void dateBoundsUseTheClockZone() {
        TaskQueryFactory zoned = new TaskQueryFactory(
                Clock.fixed(Instant.parse("2026-01-05T10:15:30Z"), ZoneId.of("Asia/Jakarta")));

        TaskQuery query = zoned.from(null, null, null, null, null, null, null, null,
                "2026-01-05", null, null, null, null);

        assertThat(query.createdFrom()).isEqualTo(Instant.parse("2026-01-04T17:00:00Z"));
    }

    @Test
    void sortAcceptsBothDirections() {
        assertThat(build(null, null, null, null, null, null, null, null,
                null, null, "-dueDate", null, null).sort())
                .isEqualTo(TaskQuery.SortSpec.descending(TaskSortField.DUE_DATE));
        assertThat(build(null, null, null, null, null, null, null, null,
                null, null, "title", null, null).sort())
                .isEqualTo(TaskQuery.SortSpec.ascending(TaskSortField.TITLE));
    }

    @Test
    void anUnknownSortFieldIs422AndListsTheAllowedOnes() {
        assertThatThrownBy(() -> build(null, null, null, null, null, null, null, null,
                null, null, "-nope", null, null))
                .isInstanceOf(UnprocessableApiException.class)
                .hasMessageContaining("'nope'")
                .hasMessageContaining("createdAt");
    }

    @Test
    void pageMustNotBeNegative() {
        assertThatThrownBy(() -> build(null, null, null, null, null, null, null, null,
                null, null, null, -1, null))
                .isInstanceOf(ValidationApiException.class)
                .hasMessageContaining("page");
    }

    @Test
    void sizeMustBeWithinTheBounds() {
        assertThatThrownBy(() -> build(null, null, null, null, null, null, null, null,
                null, null, null, null, 101))
                .isInstanceOf(ValidationApiException.class)
                .hasMessageContaining("size");
        assertThatThrownBy(() -> build(null, null, null, null, null, null, null, null,
                null, null, null, null, 0))
                .isInstanceOf(ValidationApiException.class);
    }

    @Test
    void sizeAndPagePassThrough() {
        TaskQuery query = build(null, null, ASSIGNEE, null, null, null, null, null,
                null, null, null, 2, 5);

        assertThat(query.assigneeId()).isEqualTo(ASSIGNEE);
        assertThat(query.page()).isEqualTo(2);
        assertThat(query.size()).isEqualTo(5);
    }

    @Test
    void everyFilterIsAcceptedTogether() {
        assertThatCode(() -> build(List.of("TODO"), List.of("HIGH"), ASSIGNEE, null, "alpha", "x",
                "true", 7, "2026-01-01", "2026-01-31",
                "-createdAt", 0, 50))
                .doesNotThrowAnyException();
    }

    @Test
    void aNonBooleanFlagIs422AndNamesTheValue() {
        assertThatThrownBy(() -> build(null, null, null, "yes", null, null, null, null,
                null, null, null, null, null))
                .isInstanceOf(UnprocessableApiException.class)
                .hasMessageContaining("'yes'");
    }

    @Test
    void anUnparseableDateIs422AndNamesTheValue() {
        assertThatThrownBy(() -> build(null, null, null, null, null, null, null, null,
                "yesterday", null, null, null, null))
                .isInstanceOf(UnprocessableApiException.class)
                .hasMessageContaining("createdFrom")
                .hasMessageContaining("'yesterday'");
    }

    private static List<String> Arrays(String... values) {
        return java.util.Arrays.asList(values);
    }
}