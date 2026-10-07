# BE-06 — CORS/proxy strategy and application configuration

| | |
|---|---|
| Status | Done (2026-10-07) |
| Spec | `feature-spec/01-task-mgnt-feature-spec.md` FR-B-10, NFR-8, NFR-9, NFR-10 |
| Satisfies | FR-B-10, NFR-8, NFR-9 |
| Depends on | — |
| Blocks | frontend dev server, any browser-side demo |
| Parallel-safe | **Yes — start this first**; it touches no domain code |

## 1. Objective

One documented strategy that lets `http://localhost:5173` reach both `/api/**` and
`POST /agent` (SSE), with no CORS failures, and a `application.yaml` that makes the app
run offline against Ollama with no secret committed.

## 2. Context you need before starting

Current `backend/src/main/resources/application.yaml`:

```yaml
spring:
  application:
    name: backend
spring.ai:
  model:
    chat: openai
  openai:
    api-key: ${OPENAI_API_KEY:openai-key}
    base-url: ${OPENAI_BASE_URL:http://localhost:11434/v1}
    chat:
      model: ${OPENAI_MODEL:gemma4:e4b}
```

Facts you must respect:
- The AG-UI Spring servers register **no** CORS configuration (project `AGENTS.md`).
- `POST /agent` responds `text/event-stream`; a naive CORS setup with
  `allowedOrigins("*")` + credentials will fail, and a proxy avoids the whole class of
  problem because the browser only ever talks to one origin.
- Vite 8 dev server config lives in `frontend/vite.config.ts` (owned by the frontend
  side; you only *document* the expectation here).

## 3. Scope

### 3.1 In scope

- [x] `config/CorsConfig.java` **only if** the chosen strategy needs it — needed; added
- [x] `application.yaml` additions: ports, seed toggle, AI toggle, logging levels
- [x] A written strategy note (this doc §4 plus the handoff entry)
- [x] A test proving the chosen strategy works for `/api/**` and `/agent`

### 3.2 Out of scope

- Editing `frontend/vite.config.ts` (that is FE-08's file). Do not touch the frontend.
- Production deployment concerns (TLS, real origins) — out of demo scope, but note them.

## 4. Design — the decision

**Chosen strategy: Vite dev proxy for the dev environment, permissive-but-explicit CORS
as a fallback so `curl` and non-Vite clients work too.**

| Environment | Frontend origin | Strategy |
|---|---|---|
| Local dev | `http://localhost:5173` | Vite proxies `/api` and `/agent` to `http://localhost:8080`; **plus** backend CORS allowing `http://localhost:5173` so a direct browser call also works |
| Test / CI | none | CORS config must not require the frontend to exist |
| Production | n/a for this demo | Not configured; document what would be needed |

Why both: the proxy keeps SSE and cookies simple and is what the frontend will use, but
a backend-only CORS config means `feature-spec`'s AC checks can be done from a browser
console or a static HTML page, and means the FE task does not block on proxy work
(FR-B-10 allows either; NFR-9 demands exactly one *documented* approach per environment
— this table is that documentation).

### 4.1 `CorsConfig`

```java
@Configuration
public class CorsConfig {
    @Value("${app.cors.allowed-origins:http://localhost:5173}") List<String> allowedOrigins;

    @Bean
    WebMvcConfigurer corsConfigurer() {
        return new WebMvcConfigurer() {
            @Override public void addCorsMappings(CorsRegistry registry) {
                registry.addMapping("/api/**")
                        .allowedOrigins(allowedOrigins.toArray(String[]::new))
                        .allowedMethods("GET","POST","PATCH","DELETE","OPTIONS")
                        .allowedHeaders("*")
                        .maxAge(3600);
                registry.addMapping("/agent")
                        .allowedOrigins(allowedOrigins.toArray(String[]::new))
                        .allowedMethods("POST","OPTIONS")
                        .allowedHeaders("*")
                        .exposedHeaders("Content-Type")
                        .maxAge(3600);
            }
        };
    }
}
```

Rules:
- **No** `allowCredentials(true)` — the app has no cookies (spec non-goal: no auth).
  Credentials + wildcard origins is also invalid.
- Origins come from configuration with a localhost default; never hard-code a
  production origin.
- `/agent` needs no special SSE header handling: the browser reads the body stream, and
  `Cache-Control`/`Connection` are not required to be exposed. Add
  `exposedHeaders("Content-Type")` anyway so error bodies can be read.

**Do not** register a `CorsFilter`/`OncePerRequestFilter` for this — `WebMvcConfigurer`
is enough for the MVC stack that serves `/agent` via `SseEmitter`.

### 4.2 `application.yaml` additions

```yaml
server:
  port: 8080

app:
  cors:
    allowed-origins: http://localhost:5173
  seed:
    enabled: true
  ai:
    enabled: true            # NFR-4 single switch for the AI layer

logging:
  level:
    root: INFO
    io.github.khezyapp.backend: DEBUG
    # NFR-3: keep model traffic out of logs
    org.springframework.ai: INFO
    com.agui: INFO

spring:
  mvc:
    async:
      request-timeout: 300000   # 5 min: long agent runs must not be cut off
```

Notes:
- `server.servlet.encoding` is not needed (JSON only).
- `spring.mvc.async.request-timeout` matters for the SSE endpoint; the AG-UI Java client
  default is a 5-minute request timeout — match it.
- Do **not** add `spring.jpa.*`, a datasource, or any database property.
- `app.ai.enabled` is read by BE-07 to decide whether to register the `Agent` bean
  (NFR-4: with it false, `/agent` 404s and everything else works). Implement the
  condition with `@ConditionalOnProperty(name = "app.ai.enabled",
  havingValue = "true", matchIfMissing = true)`.
- Never inline a real API key; keep `${OPENAI_API_KEY:openai-key}` (NFR-8).

## 5. Implementation order

1. Add the `server`, `app`, `logging` blocks to `application.yaml`.
2. `CorsConfig` with the two mappings.
3. Tests.
4. Write the strategy table (§4) into the handoff so FE-08 and the demo script can quote
   it verbatim.

Verify: `./gradlew test` green; `./gradlew bootRun`; `curl -i -X OPTIONS
localhost:8080/api/tasks -H 'Origin: http://localhost:5173' -H
'Access-Control-Request-Method: GET'` shows the CORS headers.

## 6. Tests

`CorsConfigTest` (`@SpringBootTest` + `TestRestTemplate`/`MockMvc`, or a lightweight
`WebMvcTest` + imported config)
- Preflight `OPTIONS /api/tasks` with `Origin: http://localhost:5173` →
  `Access-Control-Allow-Origin: http://localhost:5173`.
- Preflight with a disallowed origin (`https://evil.example`) → no allow-origin header.
- `POST /agent` is not reachable with `GET` through CORS (`allowedMethods` excludes it).

If `/agent` does not exist yet (BE-07 not done), assert the CORS mapping for `/agent`
by checking the registry rather than performing a live preflight, and note it in the
handoff so BE-07 re-runs the check.

## 7. Definition of done

- [x] `curl -i -X OPTIONS localhost:8080/api/tasks -H 'Origin: http://localhost:5173' …`
      → `200` + `Access-Control-Allow-Origin: http://localhost:5173`; denied origin → `403`.
- [x] `curl localhost:8080/api/tasks` from the CLI is unaffected by CORS (`404` today,
      no CORS headers — BE-04 owns the controller; re-check then).
- [x] `application.yaml` contains no secret and documents the strategy.
- [x] `./gradlew test` green (7 tests); `HANDOFF.md` entry appended with the FE-08
      requirements (proxy paths + SSE note).

**Implementation notes**
- Boot 4 moved `@AutoConfigureMockMvc` to `org.springframework.boot.webmvc.test.autoconfigure`;
  the old `…boot.test.autoconfigure.web.servlet` package no longer exists.
- `CorsRegistry.getCorsConfigurations()` is protected, so `CorsConfigTest` asserts the
  `/agent` mapping through a small `CorsRegistry` subclass.
- `app.*` values are env-overridable: `APP_CORS_ALLOWED_ORIGINS`, `APP_SEED_ENABLED`,
  `APP_AI_ENABLED`.

## 8. Handoff report

**Files added / changed** …
**Decisions taken** …
**Verification** `./gradlew test` → …; curl outputs …
**Handoff to FE-08** — exact proxy paths and any header caveats …
**Known gaps** …
