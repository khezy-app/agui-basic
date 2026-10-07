package io.github.khezyapp.backend.domain;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import io.github.khezyapp.backend.domain.task.TaskPriority;
import io.github.khezyapp.backend.domain.task.TaskStatus;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatExceptionOfType;

class TaskStatsTest {

    @Test
    void everyStatusAndPriorityKeyIsPresentEvenWhenEmpty() {
        TaskStats stats = new TaskStats(0, Map.of(), Map.of(), List.of(), 0, 0, 0, 0);

        assertThat(stats.byStatus()).hasSize(TaskStatus.values().length)
                .containsKeys(TaskStatus.values())
                .allSatisfy((status, count) -> assertThat(count).isZero());
        assertThat(stats.byPriority()).hasSize(TaskPriority.values().length)
                .containsKeys(TaskPriority.values())
                .allSatisfy((priority, count) -> assertThat(count).isZero());
    }

    @Test
    void nullMapsAreTreatedAsEmpty() {
        TaskStats stats = new TaskStats(0, null, null, List.of(), 0, 0, 0, 0);

        assertThat(stats.byStatus()).hasSize(7);
        assertThat(stats.byPriority()).hasSize(4);
    }

    @Test
    void suppliedCountsWinOverTheZeroFill() {
        TaskStats stats = new TaskStats(9, Map.of(TaskStatus.DONE, 4L), Map.of(), List.of(), 3, 5, 6, 7);

        assertThat(stats.byStatus().get(TaskStatus.DONE)).isEqualTo(4);
        assertThat(stats.byStatus().get(TaskStatus.TODO)).isZero();
        assertThat(stats.total()).isEqualTo(9);
        assertThat(stats.overdueTotal()).isEqualTo(3);
        assertThat(stats.dueThisWeek()).isEqualTo(5);
        assertThat(stats.unassignedTotal()).isEqualTo(6);
        assertThat(stats.createdLast7Days()).isEqualTo(7);
    }

    @Test
    void bucketsIterateInDeclarationOrder() {
        TaskStats stats = new TaskStats(0, Map.of(), Map.of(), List.of(), 0, 0, 0, 0);

        assertThat(stats.byStatus().keySet()).containsExactly(TaskStatus.values());
        assertThat(stats.byPriority().keySet()).containsExactly(TaskPriority.values());
    }

    @Test
    void mapsAreImmutable() {
        TaskStats stats = new TaskStats(0, Map.of(), Map.of(), List.of(), 0, 0, 0, 0);

        assertThatExceptionOfType(UnsupportedOperationException.class)
                .isThrownBy(() -> stats.byStatus().put(TaskStatus.TODO, 1L));
    }

    @Test
    void rollupKeepsItsFields() {
        UUID id = UUID.randomUUID();
        AssigneeRollup rollup = new AssigneeRollup(id, "Ana Reyes", 3, 1);

        assertThat(rollup.memberId()).isEqualTo(id);
        assertThat(rollup.displayName()).isEqualTo("Ana Reyes");
        assertThat(rollup.openCount()).isEqualTo(3);
        assertThat(rollup.overdueCount()).isEqualTo(1);
    }
}