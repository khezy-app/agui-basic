package io.github.khezyapp.backend.agent;

import java.util.List;
import java.util.Map;

import com.agui.community.core.tool.Tool;
import com.agui.community.core.tool.ToolParameters;
import org.springframework.stereotype.Component;

/**
 * The mutation contract (BE-09): one tool the agent may <em>propose</em> through, and
 * nothing else. There are deliberately no write {@code ToolCallback}s anywhere — the
 * backend cannot prove a tool call covered by an approval (the agent drives its own
 * execution loop, OPEN-2), so approval is enforced <em>in the protocol</em>: the proposal
 * is an interrupt, the human decides, the frontend performs the mutation and answers via
 * {@code RunAgentInput.resume()}. The backend only ships no-write read tools otherwise.
 *
 * <p>An interrupt call ends the run with
 * {@code RUN_FINISHED { outcome: { type: "interrupt", interrupts: [...] } }}; the next run
 * on the same {@code threadId} must carry the matching {@code resume} or the conversation
 * stops making sense.
 *
 * <h2>What this SDK version <em>actually</em> emits for the interrupt (verified against
 * {@code SpringAiAgent} 4.1.0/2.0.0, recorded because the frozen C6 table predates it)</h2>
 *
 * <pre>
 * Interrupt {
 *   id:            call id,
 *   reason:        "input_required"          (NOT C6's "tool_call"),
 *   message:       "propose_task_mutation"    (the tool NAME, not the user-facing summary),
 *   toolCallId:    call id,
 *   responseSchema: the tool's INPUT-parameter schema  (NOT the resume-payload schema),
 *   expiresAt:     null                       (never invented — FR-AI-15 holds),
 *   metadata:      { "toolName": "propose_task_mutation", "arguments": "<args json>" }
 * }
 * </pre>
 *
 * <p>So the C6 row reading {@code reason: "tool_call"}, {@code message: <summary>},
 * metadata {@code {tool, args, summary, origin}} and a resume-payload responseSchema does
 * <strong>not</strong> match what reaches the wire. This task does not work around the SDK;
 * FE-12 must (a) parse the interrupt's {@code arguments} to render the approval card, and
 * (b) validate the resume payload itself via {@link ResumePayloadValidator}. Both are pinned
 * in the tests and in the HANDOFF entry.
 *
 * <p>Because {@code message} is just the tool name, the human-readable line the user sees is
 * the {@code summary} argument, which the model is instructed to make plain-spoken.
 */
@Component
public class TaskMutationApprovalTools {

    public static final String NAME = "propose_task_mutation";

    private static final String DESCRIPTION = "Propose a change to tasks for the user to approve. "
            + "Use this for EVERY create, update, status change or delete — there is no other way to "
            + "change data; this is the only mutation tool. The user sees a confirmation card and "
            + "either approves or rejects. The app then performs the change and tells you the result. "
            + "Never claim a change was made before you have seen its result. Never call this tool "
            + "more than once per user request: if the user asked for several changes, put all the "
            + "ids into ONE args object, for example \"update all six login tasks\" becomes one "
            + "update_task_status call with taskIds.\n\n"
            + "Set \"tool\" to one of:\n"
            + "- create_task: args = title (required), description, status, priority, assigneeName, "
            + "dueDate (yyyy-MM-dd), estimateHours, tags (list). Use assigneeName as the display name "
            + "from list_team_members.\n"
            + "- update_task_status: args = status (required), reason (required when moving to "
            + "BLOCKED), reopen (true only to move a CANCELLED task back to TODO), and taskId (one "
            + "task) or taskIds (a list, for a bulk change — one proposal with all ids, never a "
            + "chain of single-item proposals).\n"
            + "- update_task_fields: args = taskId (required) plus any of title, description, "
            + "priority, assigneeName, dueDate, estimateHours, tags.\n"
            + "- delete_task: args = taskId (required) and reason (required — destructive).\n\n"
            + "Write \"summary\" as one plain sentence a non-technical user understands, for example "
            + "\"Mark 3 login tasks In Review\". Write \"reason\" as why this change is needed.";

    /** The four arguments {@code propose_task_mutation} is allowed to differ over. */
    public static final List<String> TOOLS =
            List.of("create_task", "update_task_status", "update_task_fields", "delete_task");

    /**
     * The tool call schema: which mutation ({@code tool}), its arguments ({@code args}), a
     * human-readable one-liner ({@code summary}), and why ({@code reason}).
     *
     * <p>{@code args} is intentionally an open {@code object} — the four intents have
     * different shapes, and a nested {@code oneOf} is too clever for a 4 B model. The
     * per-intent field list therefore lives in the tool {@link #DESCRIPTION} instead of the
     * schema, and both are pinned by tests.
     */
    public static ToolParameters parameters() {
        return new ToolParameters(Map.of(
                        "tool", Map.of(
                                "type", "string",
                                "enum", TOOLS,
                                "description", "which mutation to perform"),
                        "args", Map.of(
                                "type", "object",
                                "description", "arguments for that mutation, exactly the fields "
                                        + "documented in this tool's description for the chosen "
                                        + "\"tool\""),
                        "summary", Map.of(
                                "type", "string",
                                "description", "one short line a non-technical user understands, "
                                        + "for example 'Mark 3 login tasks In Review'"),
                        "reason", Map.of(
                                "type", "string",
                                "description", "why this change is needed, in one sentence")),
                List.of("tool", "args", "summary", "reason"));
    }

    public List<Tool> declarations() {
        return List.of(new Tool(NAME, DESCRIPTION, parameters()));
    }
}
