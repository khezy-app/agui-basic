package io.github.khezyapp.backend.domain.task;

import java.util.Arrays;
import java.util.List;

import org.junit.jupiter.api.Test;

import io.github.khezyapp.backend.testsupport.TaskFixtures;

import static org.assertj.core.api.Assertions.assertThat;

class TaskPriorityTest {

    @Test
    void rankOrdersBySeverity() {
        assertThat(Arrays.stream(TaskPriority.values()).map(TaskPriority::rank).toList())
                .containsExactly(0, 1, 2, 3);
        assertThat(TaskPriority.LOW.rank()).isLessThan(TaskPriority.MEDIUM.rank());
        assertThat(TaskPriority.MEDIUM.rank()).isLessThan(TaskPriority.HIGH.rank());
        assertThat(TaskPriority.HIGH.rank()).isLessThan(TaskPriority.URGENT.rank());
    }

    @Test
    void everyPriorityHasADistinctLabel() {
        assertThat(Arrays.stream(TaskPriority.values()).map(TaskPriority::label).toList())
                .doesNotHaveDuplicates()
                .containsExactly("Low", "Medium", "High", "Urgent");
    }

    @Test
    void priorityIsStoredAsDeclared() {
        assertThat(TaskFixtures.aTask().priority(TaskPriority.URGENT).build().priority())
                .isEqualTo(TaskPriority.URGENT);
    }

    @Test
    void everyPriorityHasALabel() {
        List<TaskPriority> priorities = List.of(TaskPriority.values());
        assertThat(priorities).allSatisfy(priority ->
                assertThat(priority.label()).isNotBlank());
    }
}