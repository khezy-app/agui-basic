# AGENTS.md

Two independent apps, no root build/manifest, no CI: `backend/` (Spring Boot) and
`frontend/` (Vue). The point of the repo is streaming an AI agent to the UI over the
**AG-UI** protocol via a local copy of the AG-UI library.

## Layout

- `backend/` — Spring Boot **4.1.1**, Java **21** toolchain, Spring AI **2.0.1** (BOM via
  `ext.springAiVersion`), **servlet** stack (`spring-boot-starter-webmvc`). Entry point:
  `backend/src/main/java/io/github/khezyapp/backend/BackendApplication.java`.
  AG-UI wired in **without starters**: `ag-ui-spring-webmvc-server:4.1.0` (endpoint +
  auto-config) and `ag-ui-spring-ai:2.0.0` (ChatClient → Agent adapter).
- `frontend/` — Vue 3 + Vite 8 + TS (create-vue template, still scaffold code).
  Entry point: `frontend/src/main.ts`. Frontend is edited in VS Code with GitHub Copilot.
- The two apps share nothing; edit them separately.

## Backend commands (run from `backend/`)

```sh
./gradlew test                                    # JUnit 5, verified green
./gradlew test --tests 'BackendApplicationTests'  # single test
./gradlew bootRun
```

- Gradle wrapper only — there is no root Gradle/Maven build.
- The Gradle build has **no** lint/format/spotless task; don't invent `./gradlew lint`.
- Lombok is on the annotation-processor path (main and test).
- `src/main/resources/application.yaml` points Spring AI's OpenAI client at a **local
  Ollama** by default: `base-url http://localhost:11434/v1`, model `gemma4:e4b`, dummy
  `api-key`. Override with `OPENAI_BASE_URL` / `OPENAI_MODEL` / `OPENAI_API_KEY`.

## Frontend commands (run from `frontend/`)

```sh
npm install           # no lockfile is committed — use npm install, not npm ci
npm run dev           # vite dev server
npm run lint          # oxlint --fix then eslint --fix — MUTATES files in place
npm run type-check    # vue-tsc --build
npx vitest run        # one-shot tests; `npm run test:unit` enters watch mode
npm run format        # prettier --write, over src/ only
npm run build         # type-check + vite build; fails on type errors
```

- Verify in this order: `npm run lint` → `npm run type-check` → `npx vitest run`.
- Formatter is Prettier only (`semi: false`, single quotes, width 100, indent 2, LF);
  ESLint runs `eslint-config-prettier` and does not format.
- Tests must live under `src/**/__tests__/` — the ESLint vitest rules are scoped to that
  glob. Environment is jsdom (`vitest.config.ts`, `e2e/**` excluded).
- The only existing test asserts scaffold text in `App.vue` (`You did it!`); it breaks
  as soon as `App.vue` is rewritten.
- Node `^22.18.0 || >=24.12.0`; npm is the package manager (IDE workspace set to npm).

## AG-UI integration

Reference implementation and docs: **`/mnt/data/protocols/ag-ui`** (a separate clone,
not part of this repo).

- This backend is servlet/WebMVC, so the matching artifact is
  `com.ag-ui.community:ag-ui-spring-webmvc-server` (Spring Boot line). Never add the
  WebFlux server/starter alongside it — one or the other. The `*-boot-starter` modules
  are dependency-only aliases; the server module already ships its own
  `AutoConfiguration.imports`, so no starter is required.
- The server module auto-registers `Serializer` + `AgentRegistry` + `AgUiController`
  at `POST /agent` (path override: `ag-ui.server.path`) for any `Agent` bean in a
  servlet app. The `SpringAiAgent` auto-registration lives only in
  `ag-ui-spring-ai-webmvc-boot-starter`, which we don't use: define an `Agent` bean
  yourself (`new SpringAiAgent(chatClientBuilder.build())`, or the builder for
  `shareState`/`StateUpdates`). Consequence — the `ag-ui.spring-ai.*` properties
  (`share-state`, `state-updates`) are **not** read without that starter.
- Versions verified on Maven Central: `ag-ui-spring-webmvc-server:4.1.0`,
  `ag-ui-spring-server-core:4.1.0`, `ag-ui-spring-ai:2.0.0`,
  `java-core`/`java-server:0.1.1`. Prefer published artifacts; build the local clone
  only when you need unreleased AG-UI changes. Transitive Boot/Spring-AI pins in the
  AG-UI POMs (4.1.0 / 2.0.0) are overridden to 4.1.1 / 2.0.1 by our BOMs.
- To build from the local clone (Maven): `mvn install` in `sdks/community/java/ag-ui`
  first, then `sdks/community/java/spring`. `~/.m2` already has `java-core`/`java-server`
  `0.1.1` but **not** the `ag-ui-spring-*` modules.
- Inside that clone, trust module READMEs (`sdks/community/java/spring/**/README.md`)
  over `docs/sdk/java/**`, which still show stale `com.ag-ui:*:0.0.1` coordinates.
- When working *inside* `/mnt/data/protocols/ag-ui`, follow its own `AGENTS.md` /
  `CLAUDE.md` (Nx + pnpm monorepo) — this file does not apply there.
- Frontend client for `/agent`: npm `@ag-ui/client` (1.0.2) — `HttpAgent`. Protocol and
  event definitions live in the clone's `spec/` and `docs/`.
- Gotcha: the AG-UI Spring servers register no CORS config, and the Vite origin
  (`localhost:5173`) differs from the backend (`localhost:8080`) — a browser-side
  `HttpAgent` needs CORS on the backend or a Vite proxy before it will work.
