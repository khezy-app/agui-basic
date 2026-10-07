package io.github.khezyapp.backend.repository;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import io.github.khezyapp.backend.common.PageResponse;
import io.github.khezyapp.backend.domain.TaskQuery;
import io.github.khezyapp.backend.domain.TaskSortField;
import io.github.khezyapp.backend.domain.task.Task;
import io.github.khezyapp.backend.domain.task.TaskPriority;
import io.github.khezyapp.backend.domain.task.TaskStatus;
import io.github.khezyapp.backend.testsupport.MutableClock;
import io.github.khezyapp.backend.testsupport.TaskFixtures;

import static org.assertj.core.api.Assertions.assertThat;

class InMemoryTaskRepositoryTest {

    private static final Instant NOW = Instant.parse("2026-03-10T09:00:00Z");
    private static final LocalDate TODAY = LocalDate.of(2026, 3, 10);

    private MutableClock clock;
    private InMemoryTaskRepository repository;

    @BeforeEach
    void setUp() {
        clock = MutableClock.at("2026-03-10T09:00:00Z");
        repository = new InMemoryTaskRepository(clock);
    }

    private Task save(TaskFixtures fixture) {
        return repository.save(fixture.build());
    }

    @Test
    void insertStampsVersionOneAndTheClock() {
        UUID id = UUID.randomUUID();

        Task stored = save(TaskFixtures.aTask().id(id).createdAt(null).updatedAt(null));

        assertThat(stored.id()).isEqualTo(id);
        assertThat(stored.version()).isEqualTo(1);
        assertThat(stored.createdAt()).isEqualTo(NOW);
        assertThat(stored.updatedAt()).isEqualTo(NOW);
    }

    @Test
    void secondSaveIncrementsTheVersionAndAdvancesUpdatedAt() {
        Task inserted = save(TaskFixtures.aTask().title("before"));

        clock.advanceSeconds(90);
        Task updated = save(TaskFixtures.aTask().id(inserted.id()).title("after"));

        assertThat(updated.version()).isEqualTo(2);
        assertThat(updated.updatedAt()).isAfter(inserted.updatedAt());
        assertThat(updated.createdAt()).isEqualTo(inserted.createdAt());
        assertThat(updated.title()).isEqualTo("after");
    }

    @Test
    void aSuppliedCreatedAtSurvivesAnInsertSoSeedDataCanBeBackdated() {
        Instant backdated = Instant.parse("2026-01-05T10:15:30Z");

        Task stored = save(TaskFixtures.aTask().createdAt(backdated).updatedAt(backdated));

        assertThat(stored.createdAt()).isEqualTo(backdated);
        assertThat(stored.updatedAt()).isEqualTo(backdated);
    }

    @Test
    void findByIdReturnsEmptyForAnUnknownId() {
        assertThat(repository.findById(UUID.randomUUID())).isEmpty();
    }

    @Test
    void deleteByIdReportsWhetherSomethingWasRemoved() {
        Task stored = save(TaskFixtures.aTask());

        assertThat(repository.deleteById(stored.id())).isTrue();
        assertThat(repository.deleteById(stored.id())).isFalse();
        assertThat(repository.count()).isZero();
    }

    @Test
    void findAllByIdSkipsUnknownIds() {
        Task first = save(TaskFixtures.aTask().title("first"));
        Task second = save(TaskFixtures.aTask().title("second"));
        UUID unknown = UUID.randomUUID();

        List<Task> found = repository.findAllById(List.of(first.id(), second.id(), unknown));

        assertThat(found).hasSize(2).extracting(Task::title).containsExactlyInAnyOrder("first", "second");
        assertThat(repository.findAllById(List.of())).isEmpty();
        assertThat(repository.findAllById(null)).isEmpty();
    }

    @Test
    void pagingSplitsTwentyFiveTasksIntoTenTenFive() {
        for (int i = 0; i < 25; i++) {
            save(TaskFixtures.aTask().title("task-" + i).createdAt(NOW.plusSeconds(i)));
        }

        PageResponse<Task> first = repository.findAll(query(0, 10));
        PageResponse<Task> second = repository.findAll(query(1, 10));
        PageResponse<Task> third = repository.findAll(query(2, 10));

        assertThat(first.content()).hasSize(10);
        assertThat(second.content()).hasSize(10);
        assertThat(third.content()).hasSize(5);
        assertThat(first.totalElements()).isEqualTo(25);
        assertThat(first.totalPages()).isEqualTo(3);
        assertThat(third.totalPages()).isEqualTo(3);
        assertThat(first.page()).isZero();
        assertThat(third.page()).isEqualTo(2);
    }

    @Test
    void aPageBeyondTheEndIsEmptyRatherThanAnError() {
        for (int i = 0; i < 3; i++) {
            save(TaskFixtures.aTask().title("task-" + i));
        }

        PageResponse<Task> page = repository.findAll(query(9, 10));

        assertThat(page.content()).isEmpty();
        assertThat(page.totalElements()).isEqualTo(3);
        assertThat(page.totalPages()).isEqualTo(1);
    }

    @Test
    void defaultSortIsCreatedAtDescending() {
        Task newest = save(TaskFixtures.aTask().title("newest").createdAt(NOW.plusSeconds(300)));
        Task oldest = save(TaskFixtures.aTask().title("oldest").createdAt(NOW));

        PageResponse<Task> page = repository.findAll(TaskQuery.defaultQuery());

        assertThat(page.content()).extracting(Task::id).containsExactly(newest.id(), oldest.id());
    }

    @Test
    void separateFiltersCombineAsAnd() {
        Task match = save(TaskFixtures.aTask().title("login bug").status(TaskStatus.TODO).tags("bug"));
        save(TaskFixtures.aTask().title("login bug").status(TaskStatus.TODO).tags("ui"));
        save(TaskFixtures.aTask().title("login bug").status(TaskStatus.DONE).tags("bug"));
        save(TaskFixtures.aTask().title("logout").status(TaskStatus.TODO).tags("bug"));

        PageResponse<Task> page = repository.findAll(new TaskQuery.Builder()
                .statuses(TaskStatus.TODO)
                .tag("bug")
                .text("login")
                .build());

        assertThat(page.content()).extracting(Task::id).containsExactly(match.id());
        assertThat(page.totalElements()).isEqualTo(1);
    }

    @Test
    void arrayFiltersCombineAsOrWithinThemselves() {
        Task inReview = save(TaskFixtures.aTask().status(TaskStatus.IN_REVIEW));
        Task blocked = save(TaskFixtures.aTask().status(TaskStatus.BLOCKED));
        save(TaskFixtures.aTask().status(TaskStatus.TODO));

        PageResponse<Task> page = repository.findAll(new TaskQuery.Builder()
                .statuses(TaskStatus.IN_REVIEW, TaskStatus.BLOCKED)
                .build());

        assertThat(page.content()).extracting(Task::id).containsExactlyInAnyOrder(inReview.id(), blocked.id());
    }

    @Test
    void textMatchesTitleOrDescriptionCaseInsensitively() {
        Task byTitle = save(TaskFixtures.aTask().title("Fix LOGIN redirect"));
        Task byDescription = save(TaskFixtures.aTask().title("Unrelated").description("the login flow is broken"));
        save(TaskFixtures.aTask().title("Unrelated").description("nothing to see"));

        PageResponse<Task> page = repository.findAll(new TaskQuery.Builder().text("login").build());

        assertThat(page.content()).extracting(Task::id).containsExactlyInAnyOrder(byTitle.id(), byDescription.id());
    }

    @Test
    void textHandlesANullDescriptionWithoutFailing() {
        Task bare = save(TaskFixtures.aTask().title("bare").description(null));

        assertThat(repository.findAll(new TaskQuery.Builder().text("bare").build()).content())
                .extracting(Task::id).containsExactly(bare.id());
    }

    @Test
    void assigneeAndUnassignedFilters() {
        UUID ana = UUID.randomUUID();
        UUID ben = UUID.randomUUID();
        Task assignedToAna = save(TaskFixtures.aTask().assignee(ana));
        Task assignedToBen = save(TaskFixtures.aTask().assignee(ben));
        Task unassigned = save(TaskFixtures.aTask().assignee(null));

        assertThat(repository.findAll(new TaskQuery.Builder().assigneeId(ana).build()).content())
                .extracting(Task::id).containsExactly(assignedToAna.id());
        assertThat(repository.findAll(new TaskQuery.Builder().unassignedOnly(true).build()).content())
                .extracting(Task::id).containsExactly(unassigned.id());
    }

    @Test
    void unassignedOnlyWinsOverAnAssigneeFilter() {
        UUID ana = UUID.randomUUID();
        Task assignedToAna = save(TaskFixtures.aTask().assignee(ana));

        PageResponse<Task> page = repository.findAll(new TaskQuery.Builder()
                .assigneeId(ana)
                .unassignedOnly(true)
                .build());

        assertThat(page.content()).extracting(Task::id).doesNotContain(assignedToAna.id());
    }

    @Test
    void overdueOnlyUsesDueDateUpToTodayAndExcludesTerminalStatuses() {
        Task overdueOpen = save(TaskFixtures.aTask().status(TaskStatus.TODO).dueDate(TODAY.minusDays(1)));
        Task dueToday = save(TaskFixtures.aTask().status(TaskStatus.IN_PROGRESS).dueDate(TODAY));
        Task doneButLate = save(TaskFixtures.aTask().status(TaskStatus.DONE).dueDate(TODAY.minusDays(30)));
        Task cancelledButLate = save(TaskFixtures.aTask().status(TaskStatus.CANCELLED).dueDate(TODAY.minusDays(30)));
        Task future = save(TaskFixtures.aTask().status(TaskStatus.TODO).dueDate(TODAY.plusDays(1)));
        save(TaskFixtures.aTask().status(TaskStatus.TODO).dueDate(null));

        PageResponse<Task> page = repository.findAll(new TaskQuery.Builder().overdueOnly(true).build());

        assertThat(page.content()).extracting(Task::id)
                .containsExactlyInAnyOrder(overdueOpen.id(), dueToday.id())
                .doesNotContain(doneButLate.id(), cancelledButLate.id(), future.id());
    }

    @Test
    void dueWithinDaysIsInclusiveOfTheDeadline() {
        Task inThree = save(TaskFixtures.aTask().dueDate(TODAY.plusDays(3)));
        Task onTheDeadline = save(TaskFixtures.aTask().dueDate(TODAY.plusDays(7)));
        Task beyond = save(TaskFixtures.aTask().dueDate(TODAY.plusDays(8)));
        Task noDueDate = save(TaskFixtures.aTask().dueDate(null));

        PageResponse<Task> page = repository.findAll(new TaskQuery.Builder().dueWithinDays(7).build());

        assertThat(page.content()).extracting(Task::id)
                .containsExactlyInAnyOrder(inThree.id(), onTheDeadline.id())
                .doesNotContain(beyond.id(), noDueDate.id());
    }

    @Test
    void createdRangeIsOpenEndedAndInclusiveAtTheUpperBound() {
        Task early = save(TaskFixtures.aTask().title("early").createdAt(NOW.minusSeconds(600)));
        Task onBoundary = save(TaskFixtures.aTask().title("boundary").createdAt(NOW));
        Task late = save(TaskFixtures.aTask().title("late").createdAt(NOW.plusSeconds(600)));

        assertThat(repository.findAll(new TaskQuery.Builder().createdFrom(NOW).build()).content())
                .extracting(Task::title).containsExactlyInAnyOrder("boundary", "late");
        assertThat(repository.findAll(new TaskQuery.Builder().createdTo(NOW).build()).content())
                .extracting(Task::title).containsExactlyInAnyOrder("early", "boundary");
        assertThat(repository.findAll(new TaskQuery.Builder()
                .createdFrom(NOW.minusSeconds(600))
                .createdTo(NOW)
                .build()).content())
                .extracting(Task::title).containsExactlyInAnyOrder("early", "boundary");
    }

    @Test
    void sortByPriorityUsesRankNotTheEnumName() {
        Task urgent = save(TaskFixtures.aTask().title("urgent").priority(TaskPriority.URGENT));
        Task low = save(TaskFixtures.aTask().title("low").priority(TaskPriority.LOW));
        Task medium = save(TaskFixtures.aTask().title("medium").priority(TaskPriority.MEDIUM));
        Task high = save(TaskFixtures.aTask().title("high").priority(TaskPriority.HIGH));

        assertThat(sortedBy(TaskSortField.PRIORITY, false))
                .extracting(Task::id).containsExactly(low.id(), medium.id(), high.id(), urgent.id());
        assertThat(sortedBy(TaskSortField.PRIORITY, true))
                .extracting(Task::id).containsExactly(urgent.id(), high.id(), medium.id(), low.id());
    }

    @Test
    void sortByDueDatePutsNullsLastInBothDirections() {
        Task withDate = save(TaskFixtures.aTask().title("with-date").dueDate(TODAY.plusDays(5)));
        Task withoutDate = save(TaskFixtures.aTask().title("without-date").dueDate(null));
        Task earlier = save(TaskFixtures.aTask().title("earlier").dueDate(TODAY.minusDays(1)));

        assertThat(sortedBy(TaskSortField.DUE_DATE, false))
                .extracting(Task::id).containsExactly(earlier.id(), withDate.id(), withoutDate.id());
        assertThat(sortedBy(TaskSortField.DUE_DATE, true))
                .extracting(Task::id).containsExactly(withDate.id(), earlier.id(), withoutDate.id());
    }

    @Test
    void sortByTitleIsCaseSensitiveAsStored() {
        Task apple = save(TaskFixtures.aTask().title("apple"));
        Task Banana = save(TaskFixtures.aTask().title("Banana"));

        assertThat(sortedBy(TaskSortField.TITLE, false))
                .extracting(Task::id).containsExactly(Banana.id(), apple.id());
    }

    @Test
    void findAllWithoutAQueryIsOrderedLikeTheDefaultPage() {
        Task newest = save(TaskFixtures.aTask().createdAt(NOW.plusSeconds(300)));
        Task oldest = save(TaskFixtures.aTask().createdAt(NOW));
        save(TaskFixtures.aTask().createdAt(NOW.plusSeconds(150)));

        List<Task> all = repository.findAll();
        List<Task> firstPage = repository.findAll(TaskQuery.defaultQuery()).content();

        assertThat(all).extracting(Task::id).startsWith(newest.id());
        assertThat(all).isEqualTo(firstPage);
    }

    @Test
    void countReflectsTheStoreSize() {
        assertThat(repository.count()).isZero();
        save(TaskFixtures.aTask());
        save(TaskFixtures.aTask());
        repository.deleteById(repository.findAll().get(0).id());

        assertThat(repository.count()).isEqualTo(1);
    }

    @Test
    void aFilterMatchingNothingYieldsZeroPages() {
        save(TaskFixtures.aTask());

        PageResponse<Task> page = repository.findAll(new TaskQuery.Builder().text("nothing-matches").build());

        assertThat(page.content()).isEmpty();
        assertThat(page.totalElements()).isZero();
        assertThat(page.totalPages()).isZero();
    }

    @Test
    void savedTasksAreSnapshotsSoLaterSavesDoNotMutateEarlierOnes() {
        Task first = save(TaskFixtures.aTask().title("original"));

        save(TaskFixtures.aTask().id(first.id()).title("updated"));

        assertThat(first.title()).isEqualTo("original");
        assertThat(repository.findById(first.id()).orElseThrow().title()).isEqualTo("updated");
    }

    @Test
    void isOverdueIsSharedByTheFilterAndLaterThePresenter() {
        Task late = TaskFixtures.aTask().status(TaskStatus.TODO).dueDate(TODAY).build();
        Task lateButDone = TaskFixtures.aTask().status(TaskStatus.DONE).dueDate(TODAY).build();
        Task notDue = TaskFixtures.aTask().dueDate(null).build();

        assertThat(InMemoryTaskRepository.isOverdue(late, TODAY)).isTrue();
        assertThat(InMemoryTaskRepository.isOverdue(lateButDone, TODAY)).isFalse();
        assertThat(InMemoryTaskRepository.isOverdue(notDue, TODAY)).isFalse();
    }

    private List<Task> sortedBy(TaskSortField field, boolean descending) {
        TaskQuery query = new TaskQuery.Builder()
                .sort(new TaskQuery.SortSpec(field, descending))
                .build();
        return new ArrayList<>(repository.findAll(query).content());
    }

    private TaskQuery query(int page, int size) {
        return new TaskQuery.Builder().page(page).size(size).build();
    }

}