# BE-07 — The `Agent` bean, ChatClient and shared-state wiring

| | |
|---|---|
| Status | Done (2026-10-08) — see the BE-07 entry in `HANDOFF.md` |
| Spec | `feature-spec/01-task-mgnt-feature-spec.md` §6.1, §6.9, §10 |
| Satisfies | FR-AI-01, FR-AI-02, FR-AI-28, FR-AI-30, FR-AI-31, FR-S-01 |
| Depends on | BE-03 (service layer must exist for tools), BE-06 (`app.ai.enabled` switch) |
| Blocks | BE-08, BE-09 |
| Parallel-safe | No |

## 1. Objective

A single `Agent` bean that the AG-UI WebMVC server auto-serves at `POST /agent`, with
shared state enabled (snapshot + delta), the domain-aware system prompt, and the
`app.ai.enabled` kill switch. After this task `POST /agent` answers with a streamed
conversation (even with zero tools), which makes the frontend wiring in FE-08 testable
early.

## 2. Context you need before starting

### 2.1 Hard constraints (project `AGENTS.md` + spec §10)

- Dependencies already present: `com.ag-ui.community:ag-ui-spring-webmvc-server:4.1.0`
  and `com.ag-ui.community:ag-ui-spring-ai:2.0.0`. **No** WebFlux server, **no**
  `*-boot-starter`. Never add one.
- We do **not** use `ag-ui-spring-ai-webmvc-boot-starter`, so:
  - the `Agent` bean must be declared explicitly;
  - the `ag-ui.spring-ai.*` properties are **not read** — `shareState`,
    `stateUpdates`, `tools`, `interruptTools` must all be set in code.
- `SpringAiAgent` API (verify against the jar before coding; the surface below is the
  documented one):
  `SpringAiAgent.builder(chatClient).shareState(true).stateUpdates(StateUpdates.DELTA)
   .tools(List<ToolCallback>).interruptTools(List<Tool>).emitInterruptOutcome(true)
   .emitMessagesSnapshot(boolean).statePrompt(Function<Object,String>).build()`.
- The server module registers `Serializer`, `AgentRegistry` and `AgUiController` at
  `POST /agent` for **any** `Agent` bean; the path is overridable with
  `ag-ui.server.path`. Leave it at `/agent`.

### 2.2 Shared-state behaviour you are enabling (from the `ag-ui-spring-ai` README)

With `shareState(true)` the agent:
1. emits an initial `STATE_SNAPSHOT` echoing `RunAgentInput.state` at run start;
2. injects the current state into the prompt;
3. advertises an internal `update_state` tool taking the **complete** new state, and
   intercepts the model's call to it, emitting the new state as `STATE_SNAPSHOT`, or as
   `STATE_DELTA` (RFC 6902, diffed by the agent against the run's input state) when
   `StateUpdates.DELTA`. The call is not surfaced as a tool call and is not executed.

This is exactly the mechanism spec §5 relies on: **the model must send the whole state
document**, so your system prompt (§4.3) must instruct it to include every existing key.

### 2.3 Available from earlier tasks

`TaskService`, `TeamMemberService`, `TaskStatsService` (BE-05), `TaskRepository`,
`TaskPresenter`, `Clock`, `app.ai.enabled` from BE-06.

## 3. Scope

### 3.1 In scope

- [x] `agent/AgentPrompts.java` — the system prompt
- [x] `agent/AgentConfig.java` — `ChatClient` + `Agent` beans
- [x] `agent/SuccessOutcomeAgent.java` — not in the plan; see the HANDOFF entry
- [x] A stub/no-op read-tool provider so the bean compiles (BE-08 fills it in)
- [x] Tests

### 3.2 Out of scope

- Actual tool implementations (BE-08, BE-09).
- Anything on the frontend.
- Chat memory on the server: history comes from `RunAgentInput.messages`
  (FR-AI-04). Do **not** add a `ChatMemory` advisor — it would duplicate the frontend's
  history.

## 4. Design

### 4.1 `AgentConfig`

```java
@Configuration
@ConditionalOnProperty(name = "app.ai.enabled", havingValue = "true", matchIfMissing = true)
public class AgentConfig {

    @Bean
    ChatClient chatClient(ChatClient.Builder builder,
                          ChatClientCustomizer promptAndState) {
        return builder.clone()
                      .defaultSystem(promptAndState.systemPrompt())
                      .build();
    }

    @Bean
    Agent agent(ChatClient chatClient,
                TaskReadTools readTools,
                TaskMutationApprovalTools approvalTools) {
        return SpringAiAgent.builder(chatClient)
                            .shareState(true)
                            .stateUpdates(SpringAiAgent.StateUpdates.DELTA)
                            .emitMessagesSnapshot(true)
                            .tools(readTools.asToolCallbacks())
                            .interruptTools(approvalTools.declarations())
                            .emitInterruptOutcome(true)
                            .build();
    }
}
```

Decisions:

| Choice | Value | Reason |
|---|---|---|
| `stateUpdates` | `DELTA` | The frontend implements RFC 6902 application anyway (FR-S-02); deltas keep token/latency cost low for a large state document. The agent computes the patch, so model JSON-Patch skill is irrelevant |
| `emitMessagesSnapshot` | `true` | FE replays history from `messages`; a snapshot after each run lets the frontend reconcile. Harmless if unused — document that FE may ignore it |
| `emitInterruptOutcome` | `true` | Required for BE-09's approval flow. Harmless when no interrupt tool is called |
| Memory advisor | none | FR-AI-04 |
| `statePrompt` | default | The default rendering of `state` into the prompt is acceptable; only add a customiser if the model demonstrably ignores `draft`/`context` |
| tools/interruptTools | injected | keeps BE-07 testable without BE-08/BE-09 by supplying empty lists |

If `app.ai.enabled=false`, no `Agent` bean exists → the server's controller reports
"no agent registered" for `POST /agent` while `/api/**` is untouched (NFR-4). Verify the
exact failure surface (404 vs 400 vs 500) and record it in the handoff — FE-13 renders
it as an error card.

### 4.2 `statePrompt` consideration

The default state prompt renders `state` as JSON in the system/user prompt. Because the
frontend owns the document (FR-S-01) and sends `context`, `draft` and `assistant`, the
prompt must state the ownership rule explicitly:

> The `state` object is owned by the application. Treat `context` and `draft` as
> read-only inputs. You may only change `assistant`. When you change anything, call
> `update_state` with the **entire** state object, copying every key you are not changing.

### 4.3 `AgentPrompts.SYSTEM_PROMPT`

One constant. Requirements it must satisfy: FR-AI-28 (never invent a status),
FR-AI-30 (`context.today` is the clock), FR-AI-31 (announce intent, report honestly),
FR-AI-13 (prefer prefill over create), FR-AI-10 (never mention REST paths),
FR-AI-29 (ask when ambiguous), FR-S-01 (state ownership), FR-S-03 (never submit).

Outline — write it as prose, not a bullet dump, but it must contain all of:

1. **Role**: you are the task-management assistant inside an admin dashboard called
   Task Manager. You help read, draft and change tasks. You are not the user.
2. **Your tools**: the four read tools (`query_tasks`, `get_task`, `get_task_stats`,
   `list_team_members`) are yours to run; the client tools (`prefill_task_form`,
   `update_task_status`, `open_task`, `ask_user`) are executed by the app. Never refer
   to HTTP endpoints or URLs.
3. **Status vocabulary**: exactly `BACKLOG, TODO, IN_PROGRESS, IN_REVIEW, BLOCKED,
   DONE, CANCELLED`. Legal transitions (paste the C4 table verbatim). `DONE` never goes
   straight to `BACKLOG`. `CANCELLED` leaves only via a reopen to `TODO`. Entering
   `BLOCKED` requires a description. Never invent a status or a priority.
4. **Prefill, do not create**: when the user describes a task they want to *make*, call
   the client tool `prefill_task_form`. The app fills a form and the **human** presses
   save. Never call a mutation tool to satisfy "help me write a task".
5. **Mutating existing data**: call `propose_task_mutation` with the target tool name,
   args, a one-line `summary` a non-technical user would understand, and a `reason`.
   Never claim a change happened; the human approves first and the app performs it.
   The result comes back in the next turn.
6. **Ambiguity**: if the referent, the assignee, or a relative date ("friday") is
   ambiguous or missing, call `ask_user` instead of guessing. Resolve relative dates
   against `context.today`, never against your own clock.
7. **Unknown values**: resolve human names with `list_team_members` first. If a name
   does not exist, ask the user; never invent an id and never silently drop a field.
8. **Honesty**: state failures and refusals plainly. One short sentence before each
   tool call saying what you are about to do.
9. **Shared state**: ownership rules from §4.2; also "never clear `draft` unless the
   user has submitted or abandoned it".

Keep it under ~500 words. Ollama models with 3–4 B parameters follow short prompts far
better than long ones — this is a demo constraint worth stating in the handoff.

### 4.4 Test seam

Define the bean assembly so it can be built without Spring:

```java
static Agent buildAgent(ChatClient client, List<ToolCallback> backendTools,
                        List<Tool> interruptTools) { … }
```
so tests can construct an agent with an empty tool list and assert the builder wiring
(not the model behaviour). Model behaviour is verified manually via the demo script
(there is no model in CI — NFR-10 requires offline capability).

## 5. Implementation order

1. `AgentPrompts` constant.
2. `AgentConfig` with `ChatClient` + `Agent`, both tools injected as empty lists first.
3. `app.ai.enabled` conditional + application.yaml key (BE-06).
4. Verify `POST /agent` streams: `RUN_STARTED`, `TEXT_MESSAGE_*`, `RUN_FINISHED` with
   `outcome: {type: success}`.
5. Verify `STATE_SNAPSHOT` is echoed at run start when the frontend sends state.
6. Stub `TaskReadTools` / `TaskMutationApprovalTools` types so the bean compiles
   (empty implementations, real ones in BE-08/BE-09).

Verify: `./gradlew test` green; manual `curl -N -X POST localhost:8080/agent -H
'content-type: application/json' -d '{"threadId":"t1","runId":"r1","state":{"context":{"today":"2026-01-05"}},"messages":[{"id":"m1","role":"user","content":"hi"}]}'`.

## 6. Tests

`AgentConfigTest`
- `buildAgent(...)` returns a non-null `Agent`; builder wiring is exercised without a
  model.
- With `app.ai.enabled=false` (`@SpringBootTest(properties = …)` + an `ApplicationContext`
  runner) **no** `Agent` bean exists while `/api/tasks` still answers 200 (NFR-4).
- The `Agent` bean is present and singular by default (the auto-config would otherwise
  also try to contribute one).

`AgentPromptsTest` (cheap, high value — the prompt is a contract)
- The C4 transition table appears verbatim in the prompt.
- All 7 statuses and all 4 priorities appear.
- The words `prefill_task_form` and `propose_task_mutation` appear, plus the
  "never submit / human presses save" instruction.
- `context.today` and `update_state` are mentioned.

## 7. Definition of done

- [x] `POST /agent` streams a full run with `outcome: {type:"success"}`. (Needed
      `SuccessOutcomeAgent` — the SDK omits the outcome on a normal finish.)
- [x] Initial `STATE_SNAPSHOT` echoes the input state.
- [x] `app.ai.enabled=false` disables only `/agent` — the surface is **404 C1 not-found**,
      not an AG-UI error, because no `Agent` bean means no controller is registered.
- [x] `./gradlew test` green (365); `HANDOFF.md` entry appended with the `curl` transcript
      and the disabled surface.

## 8. Handoff report

**Files added / changed** …
**Decisions taken** (snapshot/delta, messages snapshot, memory, prompt length) …
**Verification** `./gradlew test` → …; curl event sequence …
**Known gaps** …
