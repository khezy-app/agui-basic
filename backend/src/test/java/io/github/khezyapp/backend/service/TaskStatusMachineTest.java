package io.github.khezyapp.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.stream.Stream;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.MethodSource;

import io.github.khezyapp.backend.domain.task.TaskStatus;
import io.github.khezyapp.backend.error.ConflictApiException;
import io.github.khezyapp.backend.error.FieldError;
import io.github.khezyapp.backend.error.ValidationApiException;
import io.github.khezyapp.backend.testsupport.TaskFixtures;

class TaskStatusMachineTest {

    static Stream<Arguments> everyPair() {
        return Stream.of(TaskStatus.values()).flatMap(from -> Stream.of(TaskStatus.values())
                .map(to -> Arguments.of(from, to)));
    }

    @ParameterizedTest(name = "{0} -> {1}")
    @MethodSource("everyPair")
    void legalityMatchesTheSingleTransitionTable(TaskStatus from, TaskStatus to) {
        for (boolean reopen : new boolean[] { false, true }) {
            assertThat(TaskStatusMachine.isLegal(from, to, reopen))
                    .as("%s -> %s (reopen=%s)", from, to, reopen)
                    .isEqualTo(TaskStatusMachine.allowedTargets(from, reopen).contains(to));
        }
    }

    @ParameterizedTest(name = "{0} -> {1}")
    @CsvSource({
            "BACKLOG, TODO, true",
            "BACKLOG, CANCELLED, true",
            "TODO, BACKLOG, true",
            "TODO, IN_PROGRESS, true",
            "TODO, BLOCKED, true",
            "IN_PROGRESS, IN_REVIEW, true",
            "IN_REVIEW, DONE, true",
            "IN_REVIEW, TODO, true",
            "BLOCKED, IN_PROGRESS, true",
            "DONE, IN_REVIEW, true",
            "DONE, CANCELLED, true",
            "CANCELLED, TODO, true"
    })
    void legalTransitionsFromC4Pass(TaskStatus from, TaskStatus to, boolean reopen) {
        assertThat(TaskStatusMachine.isLegal(from, to, reopen)).isTrue();
    }

    @Test
    void inv1DoneCannotReachBacklogDirectly() {
        assertThat(TaskStatusMachine.isLegal(TaskStatus.DONE, TaskStatus.BACKLOG, false)).isFalse();
        assertThat(TaskStatusMachine.isLegal(TaskStatus.DONE, TaskStatus.TODO, false)).isFalse();
        assertThat(TaskStatusMachine.isLegal(TaskStatus.DONE, TaskStatus.TODO, true)).isFalse();
        assertThat(TaskStatusMachine.isLegal(TaskStatus.DONE, TaskStatus.IN_REVIEW, false)).isTrue();
    }

    @Test
    void inv2CancelledOnlyLeavesViaReopenOntoTodo() {
        assertThat(TaskStatusMachine.allowedTargets(TaskStatus.CANCELLED, false)).isEmpty();
        assertThat(TaskStatusMachine.allowedTargets(TaskStatus.CANCELLED, true))
                .containsExactly(TaskStatus.TODO);
    }

    @Test
    void rule1SameStatusIsANoOpAndReportsIt() {
        var task = TaskFixtures.aTask().status(TaskStatus.IN_REVIEW).build();

        assertThat(TaskStatusMachine.isNoOp(task, TaskStatus.IN_REVIEW)).isTrue();
        assertThat(TaskStatusMachine.validate(task, TaskStatus.IN_REVIEW, false)).isTrue();
    }

    @Test
    void rule1NoOpWinsEvenForACancelledTaskThatWouldOtherwiseNeedReopen() {
        var task = TaskFixtures.aTask().status(TaskStatus.CANCELLED).build();

        assertThatCode(() -> TaskStatusMachine.validate(task, TaskStatus.CANCELLED, false))
                .doesNotThrowAnyException();
    }

    @Test
    void rule2CancelledWithoutReopenIsA409() {
        var task = TaskFixtures.aTask().status(TaskStatus.CANCELLED).build();

        assertThatThrownBy(() -> TaskStatusMachine.validate(task, TaskStatus.TODO, false))
                .isInstanceOf(ConflictApiException.class)
                .hasMessageContaining("reopen=true")
                .extracting(ex -> ((ConflictApiException) ex).getMarker())
                .isEqualTo("illegal-transition");
    }

    @Test
    void rule3ReopenWithANonTodoTargetIsA400OnFieldReopen() {
        var task = TaskFixtures.aTask().status(TaskStatus.CANCELLED).build();

        assertThatThrownBy(() -> TaskStatusMachine.validate(task, TaskStatus.IN_PROGRESS, true))
                .isInstanceOf(ValidationApiException.class)
                .extracting(ex -> ((ValidationApiException) ex).getErrors())
                .asInstanceOf(org.assertj.core.api.InstanceOfAssertFactories.list(FieldError.class))
                .containsExactly(new FieldError("reopen", "reopen=true is only allowed together with target TODO"));
    }

    @Test
    void rule4IllegalTransitionNamesTheAllowedTargetsInEnumDeclarationOrder() {
        var task = TaskFixtures.aTask().status(TaskStatus.IN_REVIEW).build();

        assertThatThrownBy(() -> TaskStatusMachine.validate(task, TaskStatus.BACKLOG, false))
                .isInstanceOf(ConflictApiException.class)
                .hasMessage("`IN_REVIEW` → `BACKLOG` is not allowed. "
                        + "Allowed targets from `IN_REVIEW`: `TODO`, `IN_PROGRESS`, `DONE`, `CANCELLED`.");
    }

    @Test
    void rule5EnteringBlockedWithoutADescriptionIsA400OnFieldDescription() {
        var task = TaskFixtures.aTask().status(TaskStatus.TODO).build();

        assertThatThrownBy(() -> TaskStatusMachine.validate(task, TaskStatus.BLOCKED, false))
                .isInstanceOf(ValidationApiException.class)
                .hasMessage("a blocked task must describe the blocker")
                .extracting(ex -> ((ValidationApiException) ex).getErrors())
                .asInstanceOf(org.assertj.core.api.InstanceOfAssertFactories.list(FieldError.class))
                .containsExactly(new FieldError("description", "a blocked task must describe the blocker"));
    }

    @Test
    void rule5AWhitespaceOnlyDescriptionIsNotADescription() {
        var task = TaskFixtures.aTask().status(TaskStatus.TODO).description("   ").build();

        assertThatThrownBy(() -> TaskStatusMachine.validate(task, TaskStatus.BLOCKED, false))
                .isInstanceOf(ValidationApiException.class);
    }

    @Test
    void rule5ABlockedTaskWithADescriptionIsLegal() {
        var task = TaskFixtures.aTask().status(TaskStatus.TODO).description("waiting on vendor").build();

        assertThat(TaskStatusMachine.validate(task, TaskStatus.BLOCKED, false)).isFalse();
    }

    @Test
    void reopenFromCancelledOntoTodoIsTheOnlyWayThrough() {
        var task = TaskFixtures.aTask().status(TaskStatus.CANCELLED).build();

        assertThat(TaskStatusMachine.validate(task, TaskStatus.TODO, true)).isFalse();
    }

    @Test
    void theAllowedTargetListIsTheOnlyTransitionTable() {
        for (TaskStatus from : TaskStatus.values()) {
            assertThat(TaskStatusMachine.allowedTargets(from, false))
                    .isEqualTo(from.allowedTargets(false));
            assertThat(TaskStatusMachine.allowedTargets(from, true))
                    .isEqualTo(from.allowedTargets(true));
        }
    }

    @Test
    void defaultsArePinned() {
        assertThat(TaskStatusMachine.DEFAULT_STATUS).isEqualTo(TaskStatus.TODO);
        assertThat(TaskStatusMachine.DEFAULT_PRIORITY).isEqualTo(
                io.github.khezyapp.backend.domain.task.TaskPriority.MEDIUM);
    }
}