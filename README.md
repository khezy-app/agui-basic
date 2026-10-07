# AG-UI Basic — AI Agent Streaming Demo

A small mono-repo that demonstrates how to stream an AI agent to a web UI over the
**AG-UI protocol**, retrofitted onto an ordinary CRUD app (Task Management).

## What this project demonstrates

- Wiring an AI agent into a **Spring Boot servlet** backend using AG-UI — without
  starters, just `ag-ui-spring-webmvc-server` + `ag-ui-spring-ai`.
- Bridging **Spring AI** `ChatClient` to an AG-UI `Agent`.
- Streaming agent events to a **Vue 3** frontend via `@ag-ui/client` `HttpAgent`.
- AG-UI features: shared state (snapshot + delta), client-defined tools, backend
  tools, tool results, run lifecycle, and error handling.
- Keeping the AI layer **additive**: the app must work as a plain CRUD app when the
  AI panel is closed or the model is unavailable.

## Layout

- `backend/` — Spring Boot 4.1.1, Java 21, Spring AI 2.0.1, AG-UI server at
  `POST /agent`. See `backend/` for details.
- `frontend/` — Vue 3 + Vite + TypeScript.
- `feature-spec/` — feature contracts (e.g. task management spec).
- `feature-impl/` — per-feature implementation task docs.

## Prerequisites

- Java 21, Node `^22.18 || >=24.12`
- A local [Ollama](https://ollama.com) with the configured model (default
  `gemma4:e4b`), or any OpenAI-compatible endpoint.

## Quick start

Backend:

```sh
cd backend
./gradlew bootRun
```

Frontend:

```sh
cd frontend
npm install
npm run dev
```

Or with Docker:

```sh
docker compose up --build
```

Backend listens on `localhost:8080`, frontend dev server on `localhost:5173`.

## Configuration

Backend env overrides (see `backend/src/main/resources/application.yaml`):

- `OPENAI_BASE_URL` (default `http://localhost:11434/v1`)
- `OPENAI_MODEL` (default `gemma4:e4b`)
- `OPENAI_API_KEY`

Frontend env (baked in at build time, see `frontend/.env.example`):

- `VITE_API_BASE_URL`, `VITE_AGUI_URL`, `VITE_AGUI_ENABLED`

## Testing

```sh
cd backend && ./gradlew test
cd frontend && npm run lint && npm run type-check && npx vitest run
```

## Learn more

- `AGENTS.md` — repo conventions, AG-UI integration notes, and gotchas.
- `feature-spec/01-task-mgnt-feature-spec.md` — the feature contract for the demo.
