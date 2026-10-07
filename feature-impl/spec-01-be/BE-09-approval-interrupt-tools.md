# BE-09 — Approval-gated mutations (interrupt tool) and resume contract

| | |
|---|---|
| Status | Done |
| Spec | `feature-spec/01-task-mgnt-feature-spec.md` §6.4, §6.5, §2.3 INV-4 |
| Satisfies | FR-AI-11, FR-AI-12, FR-AI-13, FR-AI-14, FR-AI-15/16/17/18 (backend half) |
| Depends on | BE-07 (agent bean), BE-08 (read tools) |
| Blocks | FE-11/FE-12 |
| Parallel-safe | No |

## 1. Objective

Make every mutation impossible without a human decision, using AG-UI **interrupts**:
the agent can only ever *propose* a mutation (`propose_task_mutation`), which pauses the
run as an interrupt; the human approves or rejects; the app performs the mutation and
answers via `resume`. The backend ships **no** write tools (OPEN-2).

## 2. Context you need before starting

Read `00-index.md` §3 **C6** (the frozen approval contract) and **OPEN-2** (why the
frontend performs the mutation), `HANDOFF.md`, the BE-07 and BE-08 reports, and the
`ag-ui-spring-ai` README's interrupt section. Verify the SDK surface in the jar:

- `SpringAiAgent.Builder.interruptTools(List<Tool>)` — tools from
  `com.agui.community.core.tool.Tool(name, description, ToolParameters)`, advertised to
  the model but **never executed** server-side.
- `.emitInterruptOutcome(true)` — required, otherwise no outcome is emitted.
- A model call to an interrupt tool ends the run with
  `RUN_FINISHED { outcome: { type: "interrupt", interrupts: [...] } }`.
- `RunAgentInput.resume()` is a `List<Resume>`; each `Resume(interruptId, status, payload)`
  with `status ∈ {RESOLVED, CANCELLED}` is folded back into the conversation as a tool
  result for the matching call.
- Protocol rules you must not violate: resume must use the **same `threadId`**; a single
  resume array must answer **every** open interrupt; a run on a thread with unresolved
  interrupts must carry the resume or the agent must `RUN_ERROR`.

## 3. Scope

### 3.1 In scope

- [x] `agent/TaskMutationApprovalTools.java` — declares `propose_task_mutation`
- [x] The per-mutation argument schemas for the four mutation intents (in the tool description, not the JSON Schema — see Decisions taken)
- [x] Resume payload validation helper (`agent/ResumePayloadValidator.java`)
- [x] Wiring into `AgentConfig` (the call site was already correct; verified by `AgentInterruptWiringTest`)
- [x] Tests (declarative — no model in CI)

### 3.2 Out of scope

- Performing the mutation (the frontend does it via REST, then returns the result in the
  resume payload).
- The approval card UI (FE-12).
- Read tools (BE-08).

## 4. Design

### 4.1 Why interrupts and not a gating backend tool

`SpringAiAgent` executes backend tools inside its own tool-calling loop, with no
per-run context hook the application can rely on (the loop runs on the model's
streaming thread, not the request thread). There is therefore no robust way to assert
"this tool call is covered by an approval" from inside a tool method. AG-UI interrupts
solve this in the protocol: the proposal is *the* pause, and the mutation happens only
after a human `resume`. See `00-index.md` OPEN-2 for the full rationale and the
alternative that would cost a hand-written `Agent`.

### 4.2 The declared tool

```java
@Component
public class TaskMutationApprovalTools {

    public static final String NAME = "propose_task_mutation";

    public List<Tool> declarations() {
        return List.of(new Tool(
            NAME,
            "Propose a change to tasks for the user to approve. Use this for EVERY "
          + "create, update, status change or delete — there is no other way to change "
          + "data. The user sees a confirmation card and either approves or rejects; "
          + "the app then performs the change and tells you the result. Never claim a "
          + "change was made before you have seen its result.",
            parameters)));
    }
}
```

`ToolParameters` must express (build with the AG-UI `ToolParameters` builder/helper for
this version; assert the produced schema in a test):

```jsonc
{
  "type": "object",
  "properties": {
    "tool": { "type": "string",
              "enum": ["create_task", "update_task_status", "update_task_fields", "delete_task"],
              "description": "which mutation to perform" },
    "args": { "type": "object",
              "description": "arguments for that mutation; fields as documented per tool below" },
    "summary": { "type": "string",
                 "description": "one short line a non-technical user understands, e.g. 'Mark 3 login tasks In Review'" },
    "reason": { "type": "string",
                "description": "why this change is needed, in one sentence" }
  },
  "required": ["tool", "args", "summary", "reason"]
}
```

Because `args` is intentionally open (`type: object`), the per-intent field list must
live in the **tool description text** — small models will not read a nested oneOf. Append
to the description:

| `tool` | `args` fields |
|---|---|
| `create_task` | `title` (required), `description`, `status`, `priority`, `assigneeName`, `dueDate` (`yyyy-MM-dd`), `estimateHours`, `tags` |
| `update_task_status` | `taskId` \| `taskIds` (one required), `status` (required), `reopen`, `reason` |
| `update_task_fields` | `taskId` (required), plus any of `title`, `description`, `priority`, `assigneeName`, `dueDate`, `estimateHours`, `tags` |
| `delete_task` | `taskId` (required), `reason` (required — destructive) |

### 4.3 Interrupt shape

The SDK derives `Interrupt` records from the interrupt tool call; where it allows
metadata, populate it (this is what the approval card renders from, and what the
frontend mirrors into `assistant.pendingAction`, FR-S-01):

| Field | Value |
|---|---|
| `reason` | `tool_call` |
| `message` | the `summary` |
| `toolCallId` | the interrupt tool's call id (SDK-provided) |
| `metadata` | `{ "tool": …, "args": { … }, "summary": …, "reason": … }` |
| `responseSchema` | C6's schema: `{ approved (bool, required), reason (string), result (object), error (string) }` |
| `expiresAt` | **omit** — a demo approval must not silently expire (FR-AI-15); note that the FE must not offer a resume after an expiry it invents itself |

If the SDK version in use does not allow supplying `responseSchema`/`metadata` for an
interrupt tool, do **not** work around it by inventing a second mechanism. Instead:
keep the declaration, record the limitation in `HANDOFF.md` under **Contract changes**,
and let FE-12 fall back to validating the payload shape client-side (the protocol says
clients *should* validate before submitting).

### 4.4 Resume payload contract (the FE mirror)

The backend does not execute the mutation, so its only remaining duty is to make the
folded-back result unambiguous to the model. Document (Javadoc + prompt) that:

| Case | Payload | Model must |
|---|---|---|
| Approved, success | `{"approved": true, "result": <REST response verbatim>}` | report the outcome from `result`, never invent extra detail |
| Approved, failed | `{"approved": true, "error": "status IN_REVIEW → BACKLOG is not allowed. Allowed: …"}` | explain the failure and propose a legal alternative |
| Rejected | `{"approved": false, "reason": "<user's words>"}` | acknowledge and offer an alternative; **do not** re-propose the same change |
| Dismissed | `status: "cancelled"` | acknowledge the user moved on; do not re-raise it in the same thread without a new user request |

FR-AI-14: the prompt must state that **at most one** mutation may be proposed per user
request, and that a `bulk` change must be a single proposal with all ids — never a chain
of single-item proposals.

### 4.5 INV-4 (stale references)

The backend cannot see AI state (OPEN-4). Therefore the prompt must require the agent to
treat a `not_found` in the resume payload as final for that id: report it and, if the
user asks, re-resolve with `query_tasks` before proposing again. This is the only place
INV-4 is enforceable.

## 5. Implementation order

1. `TaskMutationApprovalTools.declarations()` with the full description text.
2. Per-intent argument documentation embedded in the description.
3. Wire into `AgentConfig` (replace the BE-07 stub).
4. Extend `AgentPrompts` with §4.4 rules (one-approval-per-request, result honesty,
   INV-4 re-resolution).
5. Tests.

Verify: `./gradlew test` green; manual two-run curl:

```sh
# run 1
curl -N -X POST localhost:8080/agent -H 'content-type: application/json' -d '{
  "threadId":"t1","runId":"r1",
  "state":{"context":{"today":"2026-01-05"}},
  "messages":[{"id":"m1","role":"user","content":"mark task <uuid> as done"}]}'
# expect RUN_FINISHED outcome.type == "interrupt" with one interrupt

# run 2 (same threadId)
curl -N -X POST localhost:8080/agent -H 'content-type: application/json' -d '{
  "threadId":"t1","runId":"r2",
  "state":{"context":{"today":"2026-01-05"}},
  "messages":[{"id":"m1","role":"user","content":"mark task <uuid> as done"},
              {"id":"m2","role":"assistant","content":"",
               "toolCalls":[{"id":"<toolCallId>","type":"function",
                             "function":{"name":"propose_task_mutation","arguments":"{…}"}}]}],
  "resume":[{"interruptId":"<interruptId>","status":"resolved",
             "payload":{"approved":true,"result":{"id":"<uuid>","status":"DONE"}}}}]}'
# expect the model to report the result
```

Record the actual event sequence in the handoff — FE-12 codes against it.

## 6. Tests

`TaskMutationApprovalToolsTest`
- exactly one tool is declared, named `propose_task_mutation`;
- its schema requires `tool`, `args`, `summary`, `reason`;
- `tool` enum contains exactly the four mutation names;
- the description text mentions all four mutation intents and their fields (small-model
  guard), and contains the phrase that the user must approve.

`AgentConfigWiringTest`
- the `Agent` bean is built with a non-empty `interruptTools` list and
  `emitInterruptOutcome(true)`.

`ResumeContractTest` (contract test with no model — validates our own declaration)
- given the documented approve/reject/cancel payloads, a `Resume` deserialises and its
  `payload` is readable as the documented map (use the AG-UI `Serializer` bean);
- a payload missing `approved` is detectable by the FE validator helper mirrored in
  `agent/ResumePayloadValidator.java` — assert that helper rejects it.

`AgentPromptsTest` (extend BE-07's)
- the prompt mentions `propose_task_mutation`, "never claim a change was made",
  "one proposal per request", and `not_found` re-resolution.

## 7. Definition of done

- [x] The agent can produce an interrupt outcome and the manual two-run curl works.
- [x] **No** backend tool can mutate a task (asserted as `noRegisteredToolCanWrite` in `TaskReadToolsTest`)
- [x] C6 in `00-index.md` matches the shipped `responseSchema`/metadata exactly (C6 was updated to the shipped shape — see Decisions taken)
- [x] `./gradlew test` green (437); HANDOFF entry appended with the observed event sequence and the SDK limitation

## 8. Handoff report

**Files added / changed** …
**Decisions taken** (interrupt vs gate, schema layout, expiresAt omission) …
**Contract changes** …
**Verification** `./gradlew test` → …; two-run curl transcript …
**Handoff to FE-12** — interrupt fields actually emitted, payload validation rules, the
resume payload examples …
**Known gaps** …
