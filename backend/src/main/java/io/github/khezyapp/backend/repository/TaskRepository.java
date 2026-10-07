package io.github.khezyapp.backend.repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import io.github.khezyapp.backend.common.PageResponse;
import io.github.khezyapp.backend.domain.TaskQuery;
import io.github.khezyapp.backend.domain.task.Task;

/**
 * Persistence port for tasks (FR-B-16). The in-memory adapter ships for the demo, but the
 * contract is chosen so a JDBC/JPA implementation can replace it without touching
 * controllers or the AI layer.
 *
 * <p>Implementations own filtering, sorting and paging — callers pass a normalised
 * {@link TaskQuery} and must never pre-filter in memory (FR-B-17).
 */
public interface TaskRepository {

    /**
     * Inserts when {@code task.id()} is not present, otherwise overwrites and bumps
     * {@code version} and {@code updatedAt} from the adapter's clock. A caller that needs
     * to compare against a previously read version does so itself and relies on the
     * bump to be unconditional on overwrite.
     *
     * @return the stored task, with server-owned fields filled in
     */
    Task save(Task task);

    Optional<Task> findById(UUID id);

    /** Returns the tasks for the ids that exist; the returned order is unspecified. */
    List<Task> findAllById(Collection<UUID> ids);

    /** @return {@code true} when a task was removed, {@code false} when the id was absent */
    boolean deleteById(UUID id);

    PageResponse<Task> findAll(TaskQuery query);

    /** Every task, unpaged. For whole-store aggregation only (stats, seeding). */
    List<Task> findAll();

    long count();
}