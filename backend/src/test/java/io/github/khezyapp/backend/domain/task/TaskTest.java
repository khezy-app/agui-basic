package io.github.khezyapp.backend.domain.task;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

import io.github.khezyapp.backend.testsupport.TaskFixtures;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatExceptionOfType;

class TaskTest {

    @Test
    void tagsAreLowerCasedTrimmedAndDeduplicatedInInsertionOrder() {
        Task task = TaskFixtures.aTask().tags("  Bug ", "auth", "BUG", " ui").build();

        assertThat(task.tags()).containsExactly("bug", "auth", "ui");
    }

    @Test
    void nullAndBlankTagsCollapseToAnEmptyList() {
        assertThat(TaskFixtures.aTask().build().tags()).isEmpty();
        assertThat(TaskFixtures.aTask().tags("", "   ").build().tags()).isEmpty();

        Task nullTags = new Task(null, "t", null, TaskStatus.TODO, TaskPriority.MEDIUM, null, null,
                null, null, null, null, null, 1);
        assertThat(nullTags.tags()).isEmpty();
    }

    @Test
    void theTagsListIsDefensivelyCopied() {
        List<String> source = new ArrayList<>(List.of("bug"));
        Task task = new Task(null, "t", null, TaskStatus.TODO, TaskPriority.MEDIUM, null, null,
                null, null, source, null, null, 1);

        source.add("auth");

        assertThat(task.tags()).containsExactly("bug");
    }

    @Test
    void theTagsListIsImmutable() {
        Task task = TaskFixtures.aTask().tags("bug").build();

        assertThatExceptionOfType(UnsupportedOperationException.class)
                .isThrownBy(() -> task.tags().add("auth"));
    }

    @Test
    void serverOwnedFieldsRoundTripUntouched() {
        Task task = TaskFixtures.aTask().version(7).build();

        assertThat(task.version()).isEqualTo(7);
        assertThat(task.createdAt()).isEqualTo(Instant.EPOCH);
    }
}