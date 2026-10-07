# Backend — Task Management API + AG-UI Agent

Spring Boot 4.1.1 (Java 21, servlet stack) that serves a Task Management CRUD API
and, on top of it, an AG-UI-compatible AI agent at `POST /agent`.

## High level

The backend has two surfaces:

1. **REST API** (`/api/**`) — tasks, team members, stats. Plain CRUD, no AI required.
2. **AG-UI agent** (`POST /agent`) — an AI cowork layer. It streams events (SSE)
   over the AG-UI protocol so the frontend can render chat, shared state, and tool
   calls in real time.

The AI layer is strictly additive: set `app.ai.enabled=false` and `/api/**` keeps
working while `/agent` reports nothing registered.

## Functionality

- CRUD for tasks (create, patch, status change, bulk status, delete) with a strict
  status machine, validation, and conflict/error mapping to a consistent
  `ApiErrorResponse`.
- Pagination, sorting, and filtering for task lists; team-member reference data.
- Seeded demo data on startup (`SeedDataRunner`).
- AI cowork features over AG-UI:
  - Answers questions about tasks via **backend read tools** (`TaskReadTools`).
  - Prefills forms / updates state without submitting (shared state).
  - **Interrupt/approval tools** (`TaskMutationApprovalTools`) — backend-declared
    tools that pause the run and are executed only after frontend approval.
  - Durable conversation replay via `MESSAGES_SNAPSHOT` at end of run.

## AG-UI integration

### Dependencies

```gradle
ext {
    set('agUiSpringVersion', "4.1.0")   // matches Boot 4.1.x
    set('agUiSpringAiVersion', "2.0.0")  // matches Spring AI 2.x
}

dependencies {
    implementation 'org.springframework.boot:spring-boot-starter-webmvc'
    implementation 'org.springframework.ai:spring-ai-starter-model-openai'
    implementation "com.ag-ui.community:ag-ui-spring-webmvc-server:${agUiSpringVersion}"
    implementation "com.ag-ui.community:ag-ui-spring-ai:${agUiSpringAiVersion}"
}
```

Use the **webmvc** server for a servlet app — never alongside the WebFlux server.
The `*-boot-starter` modules are dependency-only aliases; the server module ships its
own `AutoConfiguration.imports` and auto-registers at `POST /agent` (override with
`ag-ui.server.path`).

### Key components

1. **`Agent` bean** — one per app; the auto-config serves it. We wrap
   `SpringAiAgent.builder(chatClient)` to configure state sharing, tools, and
   interrupt behavior:

```java
@Bean
Agent agent(ChatClient chatClient, TaskReadTools readTools,
            TaskMutationApprovalTools approvalTools) {
    return new SuccessOutcomeAgent(
        SpringAiAgent.builder(chatClient)
            .shareState(true)                                       // STATE_SNAPSHOT echo
            .stateUpdates(SpringAiAgent.StateUpdates.DELTA)         // RFC 6902 patches
            .statePrompt(AgentPrompts.STATE_PROMPT)
            .emitMessagesSnapshot(true)
            .tools(readTools.asToolCallbacks())                     // backend tools
            .interruptTools(approvalTools.declarations())            // pause-the-run tools
            .emitInterruptOutcome(true)
            .build());
}
```

2. **`ChatClient` bean carrying the system prompt** — clone the auto-configured
   builder so Boot advisors are kept. No memory advisor: history arrives in
   `RunAgentInput.messages` on every run.

3. **Backend tools** (`TaskReadTools`) — plain Spring AI `@Tool`-style
   `ToolCallback`s executed server-side; results stream back as `TOOL_CALL_*` events.

4. **Interrupt tools** (`TaskMutationApprovalTools`) — declared to the model but
   never executed server-side. A call ends the run with
   `RUN_FINISHED { outcome: { type: "interrupt" } }`; the frontend collects user
   approval and resumes the run with a `ResumePayload` (validated by
   `ResumePayloadValidator`).

5. **`Agent` decorator** (`SuccessOutcomeAgent`) — normalizes successful runs to an
   explicit outcome so the client can distinguish completion from interruption.

### What the server module gives you for free

- `Serializer`, `AgentRegistry`, `AgUiController` at `POST /agent`.
- SSE streaming of the AG-UI event sequence: `RUN_STARTED`, `STATE_SNAPSHOT` /
  `STATE_DELTA`, `TEXT_MESSAGE_*`, `TOOL_CALL_*`, `RUN_FINISHED`, `RUN_ERROR`.

Because we do **not** use `ag-ui-spring-ai-webmvc-boot-starter`, the
`ag-ui.spring-ai.*` properties are not read — everything (`shareState`,
`stateUpdates`, `tools`, `interruptTools`) is set in code in `AgentConfig`.

## Configuration

`src/main/resources/application.yaml` points Spring AI's OpenAI client at local
Ollama by default; override with `OPENAI_BASE_URL` / `OPENAI_MODEL` / `OPENAI_API_KEY`.
`app.ai.enabled=false` disables the agent entirely.

## Commands

```sh
./gradlew test       # JUnit 5
./gradlew bootRun
```
