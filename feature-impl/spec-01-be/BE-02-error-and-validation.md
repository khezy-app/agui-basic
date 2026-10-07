# BE-02 — Error envelope and validation infrastructure

| | |
|---|---|
| Status | Done — see HANDOFF.md |
| Spec | `feature-spec/01-task-mgnt-feature-spec.md` §3.2 |
| Satisfies | FR-B-11, FR-B-12, FR-B-13, FR-B-14, INV-5 |
| Depends on | BE-01 |
| Blocks | BE-03, BE-04 |
| Parallel-safe | After BE-01, can run while BE-03 design is drafted |

## 1. Objective

One exception hierarchy, one error body shape, and one `@RestControllerAdvice` that
guarantees **every** error leaving the API is the C1 envelope from `00-index.md`. After
this task no other task constructs an error response by hand.

## 2. Context you need before starting

- Read `00-index.md` §3 C1 (the frozen envelope) and §5 (conventions).
- BE-01 has produced `common/PageResponse`, `domain/*`, `repository/*`. You do not
  modify them; if you need a field you cannot get, report it in the handoff.
- Spring Boot 4.1.1 + Jackson 3 on the classpath (Boot 4 baseline). Confirm the
  Jackson package names actually available before writing the handler — if the project
  resolves `tools.jackson.*` rather than `com.fasterxml.jackson.*`, use what the build
  resolves and note it in the handoff.
- Validation: `jakarta.validation` + `spring-boot-starter-validation`. **Check whether
  the starter is present**; if not, add `spring-boot-starter-validation` to
  `build.gradle` (it is part of the web starter's contract in Boot 4, but do not assume
  — verify by compiling one annotated record).

## 3. Scope

### 3.1 In scope

- [ ] `error/FieldError.java`, `error/ApiErrorResponse.java`
- [ ] `error/ApiException.java` + 4 subclasses
- [ ] `error/ApiExceptionHandler.java`
- [ ] Jackson configuration for **rejecting unknown request fields** (FR-B-19)
- [ ] Tests for the handler (standalone, no full context needed)

### 3.2 Out of scope

- Any validation of task fields themselves — annotations on request DTOs are **BE-04**;
  the *field rules* themselves are **BE-03**. You only build the machinery.
- Domain exceptions for illegal transitions (BE-03 throws them; you only define the
  type `ConflictApiException`).
- Problem-type URI hosting. `type` is a stable URN string, not a resolvable URL.

## 4. Design

### 4.1 Body

```java
public record FieldError(String field, String message) {}

public record ApiErrorResponse(
    String type, String title, int status, String detail, String instance,
    List<FieldError> errors) {
    public static ApiErrorResponse of(String marker, int status, String title,
                                      String detail, String instance,
                                      List<FieldError> errors) { … }
}
```
`type` = `"https://agui-basic.local/problems/" + marker`. `errors` is never null
(`List.of()` when empty). `instance` is the request path, obtained from
`HttpServletRequest.getRequestURI()` in the handler.

### 4.2 Exception hierarchy

```java
public abstract class ApiException extends RuntimeException {
    private final int status;
    private final String marker;
    private final String title;
    private final List<FieldError> errors;

    protected ApiException(String marker, int status, String title, String detail,
                           List<FieldError> errors) { … }
}
```

| Subclass | status | marker | title | Typical use |
|---|---|---|---|---|
| `ValidationApiException` | 400 | `validation-failed` | `Validation failed` | field errors from Bean Validation or manual checks |
| `NotFoundApiException` | 404 | `not-found` | `Not found` | unknown task/member id; `detail` names the id |
| `ConflictApiException` | 409 | caller-supplied | caller-supplied | `illegal-transition`, `version-conflict`, `blocked-delete` |
| `UnprocessableApiException` | 422 | `unprocessable` | `Unprocessable request` | unknown JSON field, unparseable enum, impossible request |

`ConflictApiException` takes an explicit marker because the frontend branches on it
(FR-F-11 reload-and-retry on `version-conflict`). Provide two static factories:
`ConflictApiException.illegalTransition(String detail)` and
`ConflictApiException.versionConflict(UUID id, long expected, long actual)`.

All constructors require a `detail` string. A stack trace is not the message — never
leak the raw exception message of an unexpected throwable into `detail`.

### 4.3 Handler

`@RestControllerAdvice` with `@RestController` (or base-package) scoping:

| Exception | Result |
|---|---|
| `ApiException` | its own status/marker/title/detail/errors |
| `MethodArgumentNotValidException` (Bean Validation) | 400, `errors` mapped from `FieldError` ordering by field name; `field` = the rejected field path, `message` = the default message |
| `HandlerMethodValidationException` (Spring 6.1 method validation) | same mapping |
| `HttpMessageNotReadableException` | 422 `unprocessable`, `detail` = `"malformed or unknown field in request body"`, never the raw Jackson message |
| `MethodArgumentTypeMismatchException` | 422 `unprocessable`, `detail` = `"parameter 'X' is not a valid value"` |
| `MissingServletRequestParameterException` | 400, `detail` names the parameter |
| `HttpRequestMethodNotSupportedException` | 405, `method-not-allowed` |
| `Exception` (last resort) | 500 `internal-error`, `detail` = `"unexpected server error"`, `errors = []`; log the throwable at ERROR with its message but never the request body |

`GET /actuator`-style paths do not exist. Do not add one.

### 4.4 Unknown-field rejection (FR-B-19)

Configure the MVC `ObjectMapper` so unknown JSON properties **fail**:

```java
@Bean
Jackson2ObjectMapperBuilderCustomizer strictJson() {
    return builder -> builder.failOnUnknownProperties(true);
}
```
(Adjust to the Jackson version actually resolved; see §2.) Then an AI tool or a bad
client that sends `"id"` in a create body gets a 422 instead of silent data loss.

Test this through a `@WebMvcTest` slice with a throwaway controller that accepts a
record with two fields and is POSTed a body containing a third.

## 5. Implementation order

1. `FieldError`, `ApiErrorResponse`.
2. `ApiException` + subclasses + factories.
3. `ApiExceptionHandler` with the mapping table.
4. Strict-Jackson configuration.
5. Tests.

Verify: `./gradlew test` green.

## 6. Tests

`ApiExceptionHandlerTest` (plain unit test, instantiate the advice directly and call
`handle…` with hand-built exceptions/requests — no Spring context needed)

| Case | Expect |
|---|---|
| `ValidationApiException` with 2 field errors | 400, marker `validation-failed`, both errors in order, `instance` from request URI |
| `NotFoundApiException` | 404, marker `not-found`, `errors = []` |
| `ConflictApiException.versionConflict` | 409, marker `version-conflict`, `detail` mentions both versions |
| `HttpMessageNotReadableException` | 422, marker `unprocessable`, detail does **not** contain the Jackson text |
| `RuntimeException("boom")` | 500, marker `internal-error`, detail is `"unexpected server error"` and does **not** contain `boom` |

`StrictJsonTest` (`@WebMvcTest`)
- POST body with an unknown property → 422 with marker `unprocessable`.

## 7. Definition of done

- [ ] Every row of the §4.3 mapping table has a test.
- [ ] `ApiErrorResponse` matches C1 field-for-field, in that order.
- [ ] No stack trace or framework message leaks into `detail` on the 500 path.
- [ ] `./gradlew test` green; `HANDOFF.md` entry appended.

## 8. Handoff report

**Files added / changed** …
**Decisions taken** (e.g. which Jackson package actually resolved) …
**Contract changes** (anything affecting C1) …
**Verification** `./gradlew test` → …
**Known gaps** …
