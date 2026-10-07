package io.github.khezyapp.backend.agent;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonInclude;

import io.github.khezyapp.backend.domain.task.TaskPriority;
import io.github.khezyapp.backend.domain.task.TaskStatus;
import io.github.khezyapp.backend.domain.team.TeamMemberRole;

/**
 * The wire shapes the four {@link TaskReadTools} return (BE-08 §4.2).
 *
 * <p>These are deliberately <em>smaller</em> than the REST DTOs. Model context is scarce and
 * the demo runs a 3–4 B parameter model, so every field that the model does not need to
 * answer a question has been dropped. Two consequences worth stating out loud:
 *
 * <ul>
 *   <li>{@link TaskBrief#assignee()} is the member's <strong>display name</strong>, resolved
 *       server-side. An id is useless to a model; a name is the thing the user said. The
 *       id stays available on {@code getTask}'s {@code TaskDetailResult} for nothing — it is
 *       simply not repeated.
 *   <li>There is no {@code page}/{@code totalPages}. The agent never pages: it filters and
 *       re-queries. {@link TaskPageResult#total()} is kept so the model can say "12 of 37".
 * </ul>
 *
 * <p><strong>Error channel (FR-AI-09).</strong> Every tool result carries an
 * {@code error} field rather than throwing, so a bad argument reaches the model as text it
 * can act on instead of a stack trace. {@code error} is {@code null} on success and is
 * omitted from the JSON when null (FE-13 keys the error card off its presence). Where the
 * model can recover from a mistake, the matching record carries the recovery data:
 * {@link TaskPageResult#known()} for an unknown team member, {@link TaskDetailResult#taskId()}
 * for {@code not_found}.
 */
public final class ToolResults {

    private ToolResults() {
    }

    /**
     * One task, reduced to what a model needs to talk about it.
     *
     * @param assignee display name or {@code null}; never an id
     * @param overdue  the shared {@code dueDate <= today && !terminal} flag (OPEN-5)
     */
    public record TaskBrief(
            UUID id,
            String title,
            TaskStatus status,
            TaskPriority priority,
            String assignee,
            LocalDate dueDate,
            boolean overdue,
            List<String> tags) {
    }

    /**
     * One page of {@link TaskBrief}s.
     *
     * @param total how many tasks match the filters across the whole store, so the model can
     *              say "12 of 37" instead of implying it saw everything
     * @param known the display names the model <em>may</em> use for {@code assigneeName};
     *              present only on an unknown-assignee error
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record TaskPageResult(
            List<TaskBrief> tasks,
            long total,
            int limit,
            String error,
            @JsonInclude(JsonInclude.Include.NON_EMPTY) List<String> known) {

        public TaskPageResult {
            tasks = tasks == null ? List.of() : List.copyOf(tasks);
            known = known == null ? List.of() : List.copyOf(known);
        }

        public static TaskPageResult ok(List<TaskBrief> tasks, long total, int limit) {
            return new TaskPageResult(tasks, total, limit, null, List.of());
        }

        /**
         * A failure result. It always carries <strong>zero</strong> tasks: returning an
         * unfiltered page next to an error would let the model report numbers that have
         * nothing to do with what was asked (BE-08 §4.2).
         */
        public static TaskPageResult failed(String error, List<String> known) {
            return new TaskPageResult(List.of(), 0, 0, error, known);
        }

        public boolean failed() {
            return error != null;
        }
    }

    /**
     * One task plus its description. {@code error} is {@code "not_found"} for an unknown
     * id, in which case {@code brief} is {@code null} and {@link #taskId()} echoes the id
     * that was asked for, so a model can name the row it missed.
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record TaskDetailResult(TaskBrief brief, String description, String taskId, String error) {

        public static TaskDetailResult ok(TaskBrief brief, String description) {
            return new TaskDetailResult(brief, description, brief.id().toString(), null);
        }

        public static TaskDetailResult notFound(String taskId) {
            return new TaskDetailResult(null, null, taskId, "not_found");
        }

        /**
         * A malformed id is <strong>not</strong> {@code not_found}: that word means "the row
         * is gone", and telling the model a task vanished because it produced a malformed
         * uuid would send it looking for a deletion that never happened. Spring AI would
         * have thrown here; we answer with the same value in a shape the model can read.
         */
        public static TaskDetailResult malformedId(String taskId) {
            return new TaskDetailResult(null, null, taskId, "invalid_id");
        }

        public static TaskDetailResult internalError(String taskId) {
            return new TaskDetailResult(null, null, taskId, "internal error");
        }

        public boolean failed() {
            return error != null;
        }
    }

    /**
     * The whole-store aggregate behind questions like "how much work is in review?".
     *
     * <p>{@code byStatus} always has all 7 keys and {@code byPriority} all 4, zero-filled —
     * that invariant is guaranteed upstream by {@code TaskStats}, and BE-08's test pins it,
     * because a model asked about {@code BLOCKED} must be able to read a zero rather than
     * conclude the status does not exist.
     *
     * @param overdue      open tasks with {@code dueDate <= today} (OPEN-5)
     * @param dueThisWeek  open tasks due on or before Sunday of the current ISO week
     * @param unassigned   <strong>open</strong> unassigned tasks. Deliberately narrower than
     *                     the {@code unassigned=true} list filter, which returns every
     *                     unassigned row including terminal ones (BE-05's noted asymmetry)
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record StatsResult(
            long total,
            Map<TaskStatus, Long> byStatus,
            Map<TaskPriority, Long> byPriority,
            long overdue,
            long dueThisWeek,
            long unassigned,
            List<AssigneeRef> assignees,
            String error) {

        public StatsResult {
            assignees = assignees == null ? List.of() : List.copyOf(assignees);
        }

        public static StatsResult of(
                long total,
                Map<TaskStatus, Long> byStatus,
                Map<TaskPriority, Long> byPriority,
                long overdue,
                long dueThisWeek,
                long unassigned,
                List<AssigneeRef> assignees) {
            return new StatsResult(total, byStatus, byPriority, overdue, dueThisWeek, unassigned,
                    assignees, null);
        }

        public static StatsResult failed(String error) {
            return new StatsResult(0, Map.of(), Map.of(), 0, 0, 0, List.of(), error);
        }

        public boolean failed() {
            return error != null;
        }
    }

    /** A team member, for {@code list_team_members} and for name resolution. */
    public record MemberRef(UUID id, String displayName, TeamMemberRole role) {
    }

    /**
     * One row of the per-assignee rollup.
     *
     * @param open    non-terminal tasks for this member, including members with none — the
     *                zero is informative ("Ben has nothing assigned")
     * @param overdue the subset of {@code open} that is overdue
     */
    public record AssigneeRef(String displayName, long open, long overdue) {
    }
}
