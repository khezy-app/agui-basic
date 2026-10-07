package io.github.khezyapp.backend.domain.task;

import java.util.Arrays;
import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatExceptionOfType;

class TaskStatusTest {

    private static final Logger logger = LoggerFactory.getLogger(TaskStatusTest.class);

    @Test
    void allowedTargetsMatchesThePinnedTable() {
        assertThat(TaskStatus.BACKLOG.allowedTargets(false))
                .containsExactlyInAnyOrder(TaskStatus.TODO, TaskStatus.CANCELLED);
        assertThat(TaskStatus.TODO.allowedTargets(false))
                .containsExactlyInAnyOrder(TaskStatus.BACKLOG, TaskStatus.IN_PROGRESS,
                        TaskStatus.BLOCKED, TaskStatus.CANCELLED);
        assertThat(TaskStatus.IN_PROGRESS.allowedTargets(false))
                .containsExactlyInAnyOrder(TaskStatus.TODO, TaskStatus.IN_REVIEW,
                        TaskStatus.BLOCKED, TaskStatus.CANCELLED);
        assertThat(TaskStatus.IN_REVIEW.allowedTargets(false))
                .containsExactlyInAnyOrder(TaskStatus.IN_PROGRESS, TaskStatus.DONE,
                        TaskStatus.TODO, TaskStatus.CANCELLED);
        assertThat(TaskStatus.BLOCKED.allowedTargets(false))
                .containsExactlyInAnyOrder(TaskStatus.IN_PROGRESS, TaskStatus.TODO, TaskStatus.CANCELLED);
        assertThat(TaskStatus.DONE.allowedTargets(false))
                .containsExactlyInAnyOrder(TaskStatus.IN_REVIEW, TaskStatus.CANCELLED);
    }

    @Test
    void reopenDoesNotWidenAnyStatusExceptCancelled() {
        for (TaskStatus status : TaskStatus.values()) {
            if (status == TaskStatus.CANCELLED) {
                continue;
            }
            assertThat(status.allowedTargets(true))
                    .as("%s with reopen=true", status)
                    .isEqualTo(status.allowedTargets(false));
        }
    }

    @Test
    void doneCannotGoStraightToBacklog() {
        assertThat(TaskStatus.DONE.allowedTargets(false)).doesNotContain(TaskStatus.BACKLOG);
        assertThat(TaskStatus.DONE.allowedTargets(true)).doesNotContain(TaskStatus.BACKLOG);
    }

    @Test
    void cancelledNeedsExplicitReopenAndLandsOnTodo() {
        assertThat(TaskStatus.CANCELLED.allowedTargets(false)).isEmpty();
        assertThat(TaskStatus.CANCELLED.allowedTargets(true)).containsExactly(TaskStatus.TODO);
    }

    @Test
    void onlyDoneAndCancelledAreTerminal() {
        assertThat(TaskStatus.DONE.isTerminal()).isTrue();
        assertThat(TaskStatus.CANCELLED.isTerminal()).isTrue();
        assertThat(TaskStatus.BACKLOG.isTerminal()).isFalse();
        assertThat(TaskStatus.TODO.isTerminal()).isFalse();
        assertThat(TaskStatus.IN_PROGRESS.isTerminal()).isFalse();
        assertThat(TaskStatus.IN_REVIEW.isTerminal()).isFalse();
        assertThat(TaskStatus.BLOCKED.isTerminal()).isFalse();
    }

    @Test
    void everyStatusHasADistinctLabel() {
        assertThat(Arrays.stream(TaskStatus.values()).map(TaskStatus::label).toList())
                .doesNotHaveDuplicates();
        assertThat(TaskStatus.IN_REVIEW.label()).isEqualTo("In Review");
        assertThat(TaskStatus.BACKLOG.label()).isEqualTo("Backlog");
    }

    @Test
    void allowedTargetsIsImmutable() {
        Set<TaskStatus> targets = TaskStatus.TODO.allowedTargets(false);
        assertThatExceptionOfType(UnsupportedOperationException.class)
                .isThrownBy(() -> targets.add(TaskStatus.DONE));
    }

    /**
     * Prints the canonical table so the frontend's mirror in {@code statusFlow.ts} can be
     * diffed against it by eye (00-index.md C4). Run with {@code --info} to see output.
     *
     * <p>The targets are printed in C4's declared order, not in whatever order the
     * {@code Set} happens to iterate: the order carries no meaning, and a stable one makes
     * the two sides textually comparable.
     */
    @Test
    void printTableForTheFrontendMirror() {
        StringBuilder table = new StringBuilder();
        for (List<TaskStatus> row : CANONICAL_ROWS) {
            TaskStatus from = row.get(0);
            table.append(String.format("%-11s → %s%n", from,
                    row.subList(1, row.size()).stream().map(Enum::name).reduce((a, b) -> a + ", " + b).orElseThrow()));
        }
        table.append("CANCELLED   → (only via reopen=true → TODO, INV-2)");

        logger.info("Status transition table:{}{}", System.lineSeparator(), table);

        for (List<TaskStatus> row : CANONICAL_ROWS) {
            TaskStatus from = row.get(0);
            assertThat(from.allowedTargets(false))
                    .as("%s allowedTargets", from)
                    .containsExactlyInAnyOrderElementsOf(row.subList(1, row.size()));
        }
    }

    /** The C4 table verbatim, as a list so the print order is fixed and reviewable. */
    private static final List<List<TaskStatus>> CANONICAL_ROWS = List.of(
            List.of(TaskStatus.BACKLOG, TaskStatus.TODO, TaskStatus.CANCELLED),
            List.of(TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED, TaskStatus.CANCELLED,
                    TaskStatus.BACKLOG),
            List.of(TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW, TaskStatus.BLOCKED, TaskStatus.TODO,
                    TaskStatus.CANCELLED),
            List.of(TaskStatus.IN_REVIEW, TaskStatus.DONE, TaskStatus.IN_PROGRESS, TaskStatus.CANCELLED,
                    TaskStatus.TODO),
            List.of(TaskStatus.BLOCKED, TaskStatus.IN_PROGRESS, TaskStatus.TODO, TaskStatus.CANCELLED),
            List.of(TaskStatus.DONE, TaskStatus.IN_REVIEW, TaskStatus.CANCELLED));
}