package io.github.khezyapp.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.assertj.core.api.InstanceOfAssertFactories;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import io.github.khezyapp.backend.domain.task.Task;
import io.github.khezyapp.backend.domain.task.TaskPriority;
import io.github.khezyapp.backend.domain.task.TaskStatus;
import io.github.khezyapp.backend.domain.team.TeamMember;
import io.github.khezyapp.backend.domain.team.TeamMemberRole;
import io.github.khezyapp.backend.error.ConflictApiException;
import io.github.khezyapp.backend.error.FieldError;
import io.github.khezyapp.backend.error.NotFoundApiException;
import io.github.khezyapp.backend.error.UnprocessableApiException;
import io.github.khezyapp.backend.error.ValidationApiException;
import io.github.khezyapp.backend.repository.InMemoryTaskRepository;
import io.github.khezyapp.backend.repository.InMemoryTeamMemberRepository;
import io.github.khezyapp.backend.service.command.BulkStatusCommand;
import io.github.khezyapp.backend.service.command.CreateTaskCommand;
import io.github.khezyapp.backend.service.command.PatchTaskCommand;
import io.github.khezyapp.backend.testsupport.MutableClock;

class TaskServiceTest {

    private static final UUID MEMBER_ID = UUID.fromString("aaaaaaaa-0000-0000-0000-000000000001");

    private MutableClock clock;
    private InMemoryTaskRepository tasks;
    private InMemoryTeamMemberRepository members;
    private TaskService service;

    @BeforeEach
    void setUp() {
        clock = MutableClock.at("2026-01-05T10:15:30Z");
        tasks = new InMemoryTaskRepository(clock);
        members = new InMemoryTeamMemberRepository();
        members.save(new TeamMember(MEMBER_ID, "Ada Lovelace", "ada@example.test", TeamMemberRole.ENGINEER));
        service = new TaskService(tasks, new TaskValidator(members), clock);
    }

    private Builder command() {
        return new Builder();
    }

    private static final class Builder {
        private String title = "A task";
        private String description;
        private TaskStatus status;
        private TaskPriority priority;
        private UUID assigneeId;
        private UUID reporterId;
        private LocalDate dueDate;
        private BigDecimal estimateHours;
        private List<String> tags;

        Builder title(String title) {
            this.title = title;
            return this;
        }

        Builder description(String description) {
            this.description = description;
            return this;
        }

        Builder status(TaskStatus status) {
            this.status = status;
            return this;
        }

        Builder priority(TaskPriority priority) {
            this.priority = priority;
            return this;
        }

        Builder assignee(UUID assigneeId) {
            this.assigneeId = assigneeId;
            return this;
        }

        Builder tags(String... tags) {
            this.tags = List.of(tags);
            return this;
        }

        CreateTaskCommand build() {
            return new CreateTaskCommand(title, description, status, priority, assigneeId,
                    reporterId, dueDate, estimateHours, tags);
        }
    }

    private Task create(String title) {
        return service.create(command().title(title).build());
    }

    private Task store(TaskStatus status) {
        return store(status, "A task", "seed");
    }

    private Task store(TaskStatus status, String title, String seed) {
        return tasks.save(TaskFixturesStore.of(title, status, seed));
    }

    // ------------------------------------------------------------------ create

    @Test
    void createAppliesDefaultsAndServerOwnedFields() {
        Task task = service.create(command().title("  Trim me  ").build());

        assertThat(task.id()).isNotNull();
        assertThat(task.status()).isEqualTo(TaskStatus.TODO);
        assertThat(task.priority()).isEqualTo(TaskPriority.MEDIUM);
        assertThat(task.title()).isEqualTo("Trim me");
        assertThat(task.version()).isEqualTo(1L);
        assertThat(task.createdAt()).isEqualTo(Instant.parse("2026-01-05T10:15:30Z"));
        assertThat(task.updatedAt()).isEqualTo(task.createdAt());
    }

    @Test
    void createNormalisesTags() {
        Task task = service.create(command().title("tagged").tags(" Alpha ", "alpha", "BETA").build());

        assertThat(task.tags()).containsExactly("alpha", "beta");
    }

    @Test
    void createRejectsAServerOwnedFieldByName() {
        Map<String, Object> extras = Map.of("id", UUID.randomUUID().toString());

        assertThatThrownBy(() -> service.create(command().title("x").build(), extras))
                .isInstanceOf(UnprocessableApiException.class)
                .hasMessageContaining("'id'")
                .hasMessageContaining("server-owned");
    }

    @Test
    void createRejectsEveryServerOwnedField() {
        for (String field : List.of("id", "version", "createdAt", "updatedAt", "isOverdue", "isUnassigned")) {
            assertThatThrownBy(() -> service.create(command().title("x").build(), Map.of(field, "anything")))
                    .as(field)
                    .isInstanceOf(UnprocessableApiException.class);
        }
    }

    @Test
    void createAsBlockedWithoutADescriptionIsA400OnDescription() {
        assertThatThrownBy(() -> service.create(command().title("x").status(TaskStatus.BLOCKED).build()))
                .isInstanceOf(ValidationApiException.class)
                .hasMessage("a blocked task must describe the blocker")
                .extracting(ex -> ((ValidationApiException) ex).getErrors())
                .asInstanceOf(InstanceOfAssertFactories.list(FieldError.class))
                .containsExactly(new FieldError("description", "a blocked task must describe the blocker"));
    }

    @Test
    void createAsBlockedWithADescriptionIsAllowed() {
        Task task = service.create(command().title("x").status(TaskStatus.BLOCKED)
                .description("waiting on vendor").build());

        assertThat(task.status()).isEqualTo(TaskStatus.BLOCKED);
    }

    @Test
    void createReportsEveryFieldErrorAtOnce() {
        assertThatThrownBy(() -> service.create(command().title(" ").tags("x").build()))
                .isInstanceOf(ValidationApiException.class)
                .extracting(ex -> ((ValidationApiException) ex).getErrors())
                .asInstanceOf(InstanceOfAssertFactories.list(FieldError.class))
                .contains(new FieldError("title", "must not be blank"));
    }

    // ------------------------------------------------------------- idempotency

    @Test
    void repeatedCreateInsideTheWindowReturnsTheSameTask() {
        Task first = service.create(command().title("Ship it").build());

        clock.advanceSeconds(4);
        Task second = service.create(command().title(" ship IT ").build());

        assertThat(second.id()).isEqualTo(first.id());
        assertThat(tasks.count()).isEqualTo(1L);
    }

    @Test
    void repeatedCreateOutsideTheWindowCreatesASecondTask() {
        Task first = service.create(command().title("Ship it").build());

        clock.advanceSeconds(6);
        Task second = service.create(command().title("Ship it").build());

        assertThat(second.id()).isNotEqualTo(first.id());
        assertThat(tasks.count()).isEqualTo(2L);
    }

    @Test
    void idempotencyDistinguishesStatusAndAssignee() {
        service.create(command().title("Ship it").build());
        Task assigned = service.create(command().title("Ship it").assignee(MEMBER_ID).build());

        assertThat(tasks.count()).isEqualTo(2L);
        assertThat(assigned.assigneeId()).isEqualTo(MEMBER_ID);
    }

    @Test
    void theWindowIsConfigurable() {
        TaskService wide = new TaskService(tasks, new TaskValidator(members), clock, Duration.ofHours(1));
        Task first = wide.create(command().title("Ship it").build());

        clock.advanceSeconds(600);

        assertThat(wide.create(command().title("Ship it").build()).id()).isEqualTo(first.id());
    }

    // ------------------------------------------------------------------- patch

    @Test
    void patchLeavesNullFieldsUnchanged() {
        Task task = create("original");
        clock.advanceSeconds(10);

        Task patched = service.patch(task.id(),
                new PatchTaskCommand("renamed", null, null, null, null, null, null, null), null);

        assertThat(patched.title()).isEqualTo("renamed");
        assertThat(patched.priority()).isEqualTo(TaskPriority.MEDIUM);
        assertThat(patched.createdAt()).isEqualTo(task.createdAt());
        assertThat(patched.updatedAt()).isEqualTo(Instant.parse("2026-01-05T10:15:40Z"));
        assertThat(patched.version()).isEqualTo(2L);
    }

    @Test
    void patchWithAnEmptyTagListClearsTags() {
        Task task = service.create(command().title("tagged").tags("a", "b").build());

        Task patched = service.patch(task.id(),
                new PatchTaskCommand(null, null, null, null, null, null, null, List.of()), null);

        assertThat(patched.tags()).isEmpty();
    }

    @Test
    void patchWithAnEmptyDescriptionClearsIt() {
        Task task = service.create(command().title("described").description("something").build());

        Task patched = service.patch(task.id(),
                new PatchTaskCommand(null, "", null, null, null, null, null, null), null);

        assertThat(patched.description()).isNull();
    }

    @Test
    void patchWithNothingToChangeDoesNotBumpTheVersion() {
        Task task = create("unchanged");

        Task patched = service.patch(task.id(), PatchTaskCommand.empty(), null);

        assertThat(patched.version()).isEqualTo(task.version());
        assertThat(patched.updatedAt()).isEqualTo(task.updatedAt());
    }

    @Test
    void patchRejectsStatusByFieldName() {
        Task task = create("t");

        assertThatThrownBy(() -> service.patch(task.id(), PatchTaskCommand.empty(), null, Map.of("status", "DONE")))
                .isInstanceOf(ValidationApiException.class)
                .hasMessage("status cannot be changed via field update")
                .extracting(ex -> ((ValidationApiException) ex).getErrors())
                .asInstanceOf(InstanceOfAssertFactories.list(FieldError.class))
                .containsExactly(new FieldError("status", "status cannot be changed via field update"));
    }

    @Test
    void patchRejectsServerOwnedFields() {
        Task task = create("t");

        assertThatThrownBy(() -> service.patch(task.id(), PatchTaskCommand.empty(), null, Map.of("version", 4)))
                .isInstanceOf(UnprocessableApiException.class);
    }

    @Test
    void patchOfAnUnknownTaskIs404() {
        assertThatThrownBy(() -> service.patch(UUID.randomUUID(), PatchTaskCommand.empty(), null))
                .isInstanceOf(NotFoundApiException.class);
    }

    @Test
    void patchValidatesTheMergedResult() {
        Task task = create("t");

        assertThatThrownBy(() -> service.patch(task.id(),
                new PatchTaskCommand("  ", null, null, null, null, null, null, null), null))
                .isInstanceOf(ValidationApiException.class);
    }

    // -------------------------------------------------------------- versioning

    @Test
    void patchWithAStaleExpectedVersionIs409VersionConflict() {
        Task task = create("t");
        service.patch(task.id(), new PatchTaskCommand("v2", null, null, null, null, null, null, null), 1L);

        ConflictApiException thrown = catchThrowableOfType(
                () -> service.patch(task.id(),
                        new PatchTaskCommand("v3", null, null, null, null, null, null, null), 1L),
                ConflictApiException.class);

        assertThat(thrown.getMarker()).isEqualTo("version-conflict");
        assertThat(thrown).hasMessageContaining("expected version 1").hasMessageContaining("current version is 2");
    }

    @Test
    void patchWithTheCorrectExpectedVersionSucceeds() {
        Task task = create("t");

        Task patched = service.patch(task.id(),
                new PatchTaskCommand("v2", null, null, null, null, null, null, null), 1L);

        assertThat(patched.title()).isEqualTo("v2");
    }

    @Test
    void patchWithoutAnExpectedVersionAlwaysWins() {
        Task task = create("t");

        assertThatCode(() -> service.patch(task.id(),
                new PatchTaskCommand("v2", null, null, null, null, null, null, null), null))
                .doesNotThrowAnyException();
    }

    // ------------------------------------------------------------------ delete

    @Test
    void deleteRemovesTheTask() {
        Task task = create("t");

        service.delete(task.id(), false);

        assertThat(service.find(task.id())).isEmpty();
    }

    @Test
    void deleteWithForceBehavesTheSameBecauseTheBackendNeverConsultsAiState() {
        Task task = create("t");

        service.delete(task.id(), true);

        assertThat(tasks.count()).isZero();
    }

    @Test
    void deleteOfAnUnknownTaskIs404() {
        assertThatThrownBy(() -> service.delete(UUID.randomUUID(), false))
                .isInstanceOf(NotFoundApiException.class)
                .hasMessageContaining("no task with id");
    }

    // ----------------------------------------------------------- change status

    @Test
    void changeStatusAppliesALegalTransition() {
        Task task = create("t");

        Task moved = service.changeStatus(task.id(), TaskStatus.IN_PROGRESS, false, null);

        assertThat(moved.status()).isEqualTo(TaskStatus.IN_PROGRESS);
        assertThat(moved.version()).isEqualTo(2L);
    }

    @Test
    void changeStatusToTheSameStatusChangesNothing() {
        Task task = create("t");

        Task moved = service.changeStatus(task.id(), TaskStatus.TODO, false, null);

        assertThat(moved.version()).isEqualTo(1L);
        assertThat(moved.updatedAt()).isEqualTo(task.updatedAt());
    }

    @Test
    void changeStatusReportsTheAllowedTargetsOnAnIllegalTransition() {
        Task task = tasks.save(TaskFixturesStore.of("Review me", TaskStatus.IN_REVIEW, "seed"));

        assertThatThrownBy(() -> service.changeStatus(task.id(), TaskStatus.BACKLOG, false, null))
                .isInstanceOf(ConflictApiException.class)
                .hasMessage("`IN_REVIEW` → `BACKLOG` is not allowed. "
                        + "Allowed targets from `IN_REVIEW`: `TODO`, `IN_PROGRESS`, `DONE`, `CANCELLED`.");
    }

    @Test
    void leavingCancelledRequiresReopen() {
        Task task = tasks.save(TaskFixturesStore.of("Dead", TaskStatus.CANCELLED, "seed"));

        assertThatThrownBy(() -> service.changeStatus(task.id(), TaskStatus.TODO, false, null))
                .isInstanceOf(ConflictApiException.class)
                .hasMessageContaining("reopen=true");
    }

    @Test
    void leavingCancelledWithReopenLandsOnTodo() {
        Task task = tasks.save(TaskFixturesStore.of("Dead", TaskStatus.CANCELLED, "seed"));

        Task moved = service.changeStatus(task.id(), TaskStatus.TODO, true, null);

        assertThat(moved.status()).isEqualTo(TaskStatus.TODO);
    }

    @Test
    void reopenWithANonTodoTargetIs400() {
        Task task = tasks.save(TaskFixturesStore.of("Dead", TaskStatus.CANCELLED, "seed"));

        assertThatThrownBy(() -> service.changeStatus(task.id(), TaskStatus.IN_PROGRESS, true, null))
                .isInstanceOf(ValidationApiException.class);
    }

    @Test
    void enteringBlockedWithoutADescriptionIs400() {
        Task task = create("t");

        assertThatThrownBy(() -> service.changeStatus(task.id(), TaskStatus.BLOCKED, false, null))
                .isInstanceOf(ValidationApiException.class)
                .hasMessage("a blocked task must describe the blocker");
    }

    @Test
    void changeStatusOfAnUnknownTaskIs404() {
        assertThatThrownBy(() -> service.changeStatus(UUID.randomUUID(), TaskStatus.TODO, false, null))
                .isInstanceOf(NotFoundApiException.class);
    }

    @Test
    void changeStatusWithAStaleVersionIs409() {
        Task task = create("t");
        service.changeStatus(task.id(), TaskStatus.IN_PROGRESS, false, 1L);

        assertThatThrownBy(() -> service.changeStatus(task.id(), TaskStatus.IN_REVIEW, false, 1L))
                .isInstanceOf(ConflictApiException.class)
                .extracting(ex -> ((ConflictApiException) ex).getMarker())
                .isEqualTo("version-conflict");
    }

    // ------------------------------------------------------------ bulk status

    @Test
    void bulkUpdatesEveryLegalTask() {
        Task a = create("a");
        Task b = create("b");

        TaskService.BulkOutcome outcome = service.bulkChangeStatus(
                new BulkStatusCommand(List.of(a.id(), b.id()), TaskStatus.IN_PROGRESS, null));

        assertThat(outcome.updated()).isEqualTo(2);
        assertThat(outcome.tasks()).hasSize(2)
                .allMatch(task -> task.status() == TaskStatus.IN_PROGRESS);
    }

    @Test
    void bulkSkipsIdsAlreadyAtTheTargetWithoutBumpingThem() {
        Task a = create("a");
        Task b = create("b");
        Task alreadyThere = tasks.save(TaskFixturesStore.of("c", TaskStatus.IN_PROGRESS, "seed"));

        TaskService.BulkOutcome outcome = service.bulkChangeStatus(
                new BulkStatusCommand(List.of(a.id(), b.id(), alreadyThere.id()), TaskStatus.IN_PROGRESS, null));

        assertThat(outcome.updated()).isEqualTo(2);
        assertThat(outcome.tasks()).extracting(Task::id).doesNotContain(alreadyThere.id());
        assertThat(service.require(alreadyThere.id()).version()).isEqualTo(1L);
    }

    @Test
    void bulkIsAllOrNothingAndNamesTheOffendingTask() {
        Task ok = create("Fine one");
        Task bad = tasks.save(TaskFixturesStore.of("Review me", TaskStatus.IN_REVIEW, "seed"));

        assertThatThrownBy(() -> service.bulkChangeStatus(
                new BulkStatusCommand(List.of(ok.id(), bad.id()), TaskStatus.BACKLOG, null)))
                .isInstanceOf(ConflictApiException.class)
                .hasMessageContaining("Review me")
                .hasMessageContaining("IN_REVIEW → BACKLOG")
                .extracting(ex -> ((ConflictApiException) ex).getErrors())
                .asInstanceOf(InstanceOfAssertFactories.list(FieldError.class))
                .containsExactly(new FieldError("ids[1]", "`IN_REVIEW` → `BACKLOG` is not allowed. "
                        + "Allowed targets from `IN_REVIEW`: `TODO`, `IN_PROGRESS`, `DONE`, `CANCELLED`."));

        assertThat(service.require(ok.id()).status()).isEqualTo(TaskStatus.TODO);
        assertThat(service.require(ok.id()).version()).isEqualTo(1L);
    }

    @Test
    void bulkCollectsEveryOffendingTask() {
        Task a = tasks.save(TaskFixturesStore.of("First", TaskStatus.IN_REVIEW, "seed"));
        Task b = tasks.save(TaskFixturesStore.of("Second", TaskStatus.IN_REVIEW, "seed"));

        assertThatThrownBy(() -> service.bulkChangeStatus(
                new BulkStatusCommand(List.of(a.id(), b.id()), TaskStatus.BACKLOG, null)))
                .isInstanceOf(ConflictApiException.class)
                .hasMessageContaining("First")
                .hasMessageContaining("Second");
    }

    @Test
    void bulkWithAnEmptyIdListIs400() {
        assertThatThrownBy(() -> service.bulkChangeStatus(
                new BulkStatusCommand(List.of(), TaskStatus.DONE, null)))
                .isInstanceOf(ValidationApiException.class)
                .extracting(ex -> ((ValidationApiException) ex).getErrors())
                .asInstanceOf(InstanceOfAssertFactories.list(FieldError.class))
                .containsExactly(new FieldError("ids", "must contain at least 1 id"));
    }

    @Test
    void bulkWithAMissingIdIs404NamingIt() {
        Task a = create("a");
        UUID missing = UUID.fromString("cccccccc-0000-0000-0000-000000000003");

        assertThatThrownBy(() -> service.bulkChangeStatus(
                new BulkStatusCommand(List.of(a.id(), missing), TaskStatus.DONE, null)))
                .isInstanceOf(NotFoundApiException.class)
                .hasMessageContaining(missing.toString());
    }

    @Test
    void bulkChecksEveryExpectedVersionBeforeWritingAnything() {
        Task a = create("a");
        Task b = create("b");
        Map<UUID, Long> expected = new HashMap<>();
        expected.put(a.id(), 1L);
        expected.put(b.id(), 7L);

        assertThatThrownBy(() -> service.bulkChangeStatus(
                new BulkStatusCommand(List.of(a.id(), b.id()), TaskStatus.DONE, expected)))
                .isInstanceOf(ConflictApiException.class)
                .extracting(ex -> ((ConflictApiException) ex).getMarker())
                .isEqualTo("version-conflict");

        assertThat(service.require(a.id()).status()).isEqualTo(TaskStatus.TODO);
    }

    @Test
    void bulkToleratesAMissingExpectationForSomeIds() {
        Task a = create("a");
        Task b = create("b");
        Map<UUID, Long> expected = Map.of(a.id(), 1L);

        TaskService.BulkOutcome outcome = service.bulkChangeStatus(
                new BulkStatusCommand(List.of(a.id(), b.id()), TaskStatus.IN_PROGRESS, expected));

        assertThat(outcome.updated()).isEqualTo(2);
    }

    // -------------------------------------------------------------------- read

    @Test
    void requireThrows404ForAnUnknownId() {
        UUID missing = UUID.randomUUID();

        assertThatThrownBy(() -> service.require(missing))
                .isInstanceOf(NotFoundApiException.class)
                .hasMessage("no task with id " + missing);
    }

    @Test
    void findAllDelegatesToTheRepositoryWithTheDefaultQuery() {
        create("a");
        create("b");

        assertThat(service.findAll(null).content()).hasSize(2);
        assertThat(service.count()).isEqualTo(2L);
    }

    private static <T extends Throwable> T catchThrowableOfType(org.assertj.core.api.ThrowableAssert.ThrowingCallable callable,
                                                                   Class<T> type) {
        return org.assertj.core.api.Assertions.catchThrowableOfType(callable, type);
    }

    /** Small store-side helper so a seed row lands with a unique {@code createdAt}. */
    private static final class TaskFixturesStore {

        private static long sequence;

        static Task of(String title, TaskStatus status, String seed) {
            return new Task(UUID.nameUUIDFromBytes((seed + title).getBytes(java.nio.charset.StandardCharsets.UTF_8)),
                    title, "seeded for the service test", status, TaskPriority.MEDIUM, null, null,
                    LocalDate.of(2026, 2, 1), null, List.of(seed),
                    Instant.parse("2026-01-01T00:00:00Z").plusSeconds(sequence++ * 60), null, 0L);
        }
    }
}