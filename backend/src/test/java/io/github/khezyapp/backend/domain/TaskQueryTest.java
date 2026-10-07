package io.github.khezyapp.backend.domain;

import java.time.Instant;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import io.github.khezyapp.backend.domain.task.TaskPriority;
import io.github.khezyapp.backend.domain.task.TaskStatus;

import static org.assertj.core.api.Assertions.assertThat;

class TaskQueryTest {

    @Test
    void defaultQueryHasNoFiltersAndSortsNewestFirst() {
        TaskQuery query = TaskQuery.defaultQuery();

        assertThat(query.isEmpty()).isTrue();
        assertThat(query.page()).isZero();
        assertThat(query.size()).isEqualTo(20);
        assertThat(query.sort()).isEqualTo(TaskQuery.SortSpec.descending(TaskSortField.CREATED_AT));
        assertThat(query.statuses()).isEmpty();
        assertThat(query.priorities()).isEmpty();
        assertThat(query.assigneeId()).isNull();
        assertThat(query.unassignedOnly()).isFalse();
        assertThat(query.overdueOnly()).isFalse();
        assertThat(query.dueWithinDays()).isNull();
        assertThat(query.createdFrom()).isNull();
        assertThat(query.createdTo()).isNull();
    }

    @Test
    void blankAndWhitespaceTextMeanNoFilter() {
        assertThat(new TaskQuery.Builder().text("   ").build().text()).isNull();
        assertThat(new TaskQuery.Builder().text("").build().text()).isNull();
        assertThat(new TaskQuery.Builder().build().text()).isNull();
        assertThat(new TaskQuery.Builder().text("  ").build().isEmpty()).isTrue();
    }

    @Test
    void blankAndWhitespaceTagMeanNoFilter() {
        assertThat(new TaskQuery.Builder().tag(" ").build().tag()).isNull();
        assertThat(new TaskQuery.Builder().tag("").build().tag()).isNull();
    }

    @Test
    void textAndTagAreLowerCasedAndTrimmed() {
        TaskQuery query = new TaskQuery.Builder().text("  Login Page ").tag("  Auth ").build();

        assertThat(query.text()).isEqualTo("login page");
        assertThat(query.tag()).isEqualTo("auth");
    }

    @Test
    void anyFilterMakesTheQueryNonEmpty() {
        UUID id = UUID.randomUUID();
        Instant instant = Instant.EPOCH;

        assertThat(new TaskQuery.Builder().statuses(TaskStatus.TODO).build().isEmpty()).isFalse();
        assertThat(new TaskQuery.Builder().priorities(TaskPriority.HIGH).build().isEmpty()).isFalse();
        assertThat(new TaskQuery.Builder().assigneeId(id).build().isEmpty()).isFalse();
        assertThat(new TaskQuery.Builder().unassignedOnly(true).build().isEmpty()).isFalse();
        assertThat(new TaskQuery.Builder().tag("bug").build().isEmpty()).isFalse();
        assertThat(new TaskQuery.Builder().text("x").build().isEmpty()).isFalse();
        assertThat(new TaskQuery.Builder().overdueOnly(true).build().isEmpty()).isFalse();
        assertThat(new TaskQuery.Builder().dueWithinDays(7).build().isEmpty()).isFalse();
        assertThat(new TaskQuery.Builder().createdFrom(instant).build().isEmpty()).isFalse();
        assertThat(new TaskQuery.Builder().createdTo(instant).build().isEmpty()).isFalse();
    }

    @Test
    void pagingIsClampedIntoLegalBounds() {
        assertThat(new TaskQuery.Builder().page(-3).build().page()).isZero();
        assertThat(new TaskQuery.Builder().size(0).build().size()).isEqualTo(1);
        assertThat(new TaskQuery.Builder().size(500).build().size()).isEqualTo(100);
        assertThat(new TaskQuery.Builder().size(50).build().size()).isEqualTo(50);
    }

    @Test
    void aNullSortFallsBackToTheDefault() {
        assertThat(new TaskQuery.Builder().sort(null).build().sort())
                .isEqualTo(TaskQuery.SortSpec.descending(TaskSortField.CREATED_AT));
    }

    @Test
    void arrayFiltersAreKeptAsSets() {
        TaskQuery query = new TaskQuery.Builder()
                .statuses(TaskStatus.TODO, TaskStatus.DONE)
                .priorities(TaskPriority.LOW, TaskPriority.URGENT)
                .build();

        assertThat(query.statuses()).containsExactlyInAnyOrder(TaskStatus.TODO, TaskStatus.DONE);
        assertThat(query.priorities()).containsExactlyInAnyOrder(TaskPriority.LOW, TaskPriority.URGENT);
    }

    @Test
    void toBuilderKeepsFiltersAndAllowsRepaging() {
        TaskQuery original = new TaskQuery.Builder()
                .statuses(TaskStatus.TODO)
                .text("login")
                .tag("auth")
                .overdueOnly(true)
                .sort(TaskQuery.SortSpec.ascending(TaskSortField.TITLE))
                .build();

        TaskQuery repaged = original.toBuilder().page(2).size(5).build();

        assertThat(repaged.statuses()).isEqualTo(original.statuses());
        assertThat(repaged.text()).isEqualTo("login");
        assertThat(repaged.tag()).isEqualTo("auth");
        assertThat(repaged.overdueOnly()).isTrue();
        assertThat(repaged.sort()).isEqualTo(original.sort());
        assertThat(repaged.page()).isEqualTo(2);
        assertThat(repaged.size()).isEqualTo(5);
    }

    @Test
    void sortSpecHelpersSetTheDirection() {
        assertThat(TaskQuery.SortSpec.ascending(TaskSortField.DUE_DATE).descending()).isFalse();
        assertThat(TaskQuery.SortSpec.descending(TaskSortField.DUE_DATE).field()).isEqualTo(TaskSortField.DUE_DATE);
    }

    @Test
    void sortFieldsExposeTheWireNamesFromTheSpec() {
        assertThat(TaskSortField.CREATED_AT.wireName()).isEqualTo("createdAt");
        assertThat(TaskSortField.UPDATED_AT.wireName()).isEqualTo("updatedAt");
        assertThat(TaskSortField.DUE_DATE.wireName()).isEqualTo("dueDate");
        assertThat(TaskSortField.TITLE.wireName()).isEqualTo("title");
        assertThat(TaskSortField.PRIORITY.wireName()).isEqualTo("priority");
        assertThat(TaskSortField.STATUS.wireName()).isEqualTo("status");
    }
}