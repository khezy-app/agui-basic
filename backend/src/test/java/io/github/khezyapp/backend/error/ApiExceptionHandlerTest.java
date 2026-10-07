package io.github.khezyapp.backend.error;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.UUID;

import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.springframework.core.MethodParameter;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.validation.BeanPropertyBindingResult;
import org.springframework.validation.method.MethodValidationResult;
import org.springframework.validation.method.ParameterValidationResult;
import org.springframework.validation.ObjectError;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

class ApiExceptionHandlerTest {

    private final ApiExceptionHandler handler = new ApiExceptionHandler();

    private HttpServletRequest request(String uri) {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", uri);
        request.setRequestURI(uri);
        return request;
    }

    private ApiErrorResponse body(ResponseEntity<ApiErrorResponse> response) {
        assertThat(response.getStatusCode().is2xxSuccessful()).isFalse();
        return response.getBody();
    }

    @Test
    void validationApiExceptionKeepsFieldErrorsInOrder() {
        ValidationApiException ex = new ValidationApiException("2 fields are invalid", List.of(
                new FieldError("title", "must not be blank"),
                new FieldError("priority", "must not be null")));

        ResponseEntity<ApiErrorResponse> response = handler.handleApiException(ex, request("/api/tasks"));

        assertThat(response.getStatusCode().value()).isEqualTo(400);
        ApiErrorResponse body = body(response);
        assertThat(body.type()).isEqualTo("https://agui-basic.local/problems/validation-failed");
        assertThat(body.title()).isEqualTo("Validation failed");
        assertThat(body.detail()).isEqualTo("2 fields are invalid");
        assertThat(body.instance()).isEqualTo("/api/tasks");
        assertThat(body.errors()).containsExactly(
                new FieldError("title", "must not be blank"),
                new FieldError("priority", "must not be null"));
    }

    @Test
    void notFoundHasNoFieldErrors() {
        NotFoundApiException ex = new NotFoundApiException("no task with id 42");

        ResponseEntity<ApiErrorResponse> response = handler.handleApiException(ex, request("/api/tasks/42"));

        assertThat(response.getStatusCode().value()).isEqualTo(404);
        ApiErrorResponse body = body(response);
        assertThat(body.type()).endsWith("/not-found");
        assertThat(body.detail()).isEqualTo("no task with id 42");
        assertThat(body.errors()).isEmpty();
    }

    @Test
    void versionConflictMentionsBothVersions() {
        UUID id = UUID.fromString("11111111-1111-1111-1111-111111111111");

        ResponseEntity<ApiErrorResponse> response = handler.handleApiException(
                ConflictApiException.versionConflict(id, 3, 5), request("/api/tasks/" + id));

        assertThat(response.getStatusCode().value()).isEqualTo(409);
        ApiErrorResponse body = body(response);
        assertThat(body.type()).endsWith("/version-conflict");
        assertThat(body.detail()).contains("3").contains("5").contains(id.toString());
    }

    @Test
    void illegalTransitionUsesItsOwnMarker() {
        ApiErrorResponse body = body(handler.handleApiException(
                ConflictApiException.illegalTransition("DONE cannot go to BACKLOG"),
                request("/api/tasks/1/status")));

        assertThat(body.type()).endsWith("/illegal-transition");
        assertThat(body.status()).isEqualTo(409);
    }

    @Test
    void unreadableBodyDoesNotLeakJacksonText() {
        HttpMessageNotReadableException ex = new HttpMessageNotReadableException(
                "JSON parse error: Unrecognized field \"titel\"", (org.springframework.http.HttpInputMessage) null);

        ApiErrorResponse body = body(handler.handleNotReadable(ex, request("/api/tasks")));

        assertThat(body.status()).isEqualTo(422);
        assertThat(body.type()).endsWith("/unprocessable");
        assertThat(body.detail()).isEqualTo("malformed or unknown field in request body");
        assertThat(body.detail()).doesNotContain("titel");
    }

    @Test
    void beanValidationFailuresBecomeOrderedFieldErrors() throws Exception {
        BeanPropertyBindingResult bindingResult = new BeanPropertyBindingResult(new Object(), "request");
        bindingResult.addError(new org.springframework.validation.FieldError("request", "priority", "must not be null"));
        bindingResult.addError(new org.springframework.validation.FieldError("request", "title", "must not be blank"));
        MethodArgumentNotValidException ex = new MethodArgumentNotValidException(
                new MethodParameter(Throwing.class.getMethod("accept", String.class), 0), bindingResult);

        ApiErrorResponse body = body(handler.handleMethodArgumentNotValid(ex, request("/api/tasks")));

        assertThat(body.status()).isEqualTo(400);
        assertThat(body.type()).endsWith("/validation-failed");
        assertThat(body.errors()).containsExactly(
                new FieldError("priority", "must not be null"),
                new FieldError("title", "must not be blank"));
        assertThat(body.detail()).isEqualTo("2 fields are invalid");
    }

    @Test
    void missingParameterIsNamed() {
        ApiErrorResponse body = body(handler.handleMissingParameter(
                new MissingServletRequestParameterException("expectedVersion", "int"), request("/api/tasks/1")));

        assertThat(body.status()).isEqualTo(400);
        assertThat(body.detail()).contains("expectedVersion");
    }

    @Test
    void typeMismatchIsUnprocessable() throws Exception {
        MethodParameter parameter = new MethodParameter(Throwing.class.getMethod("accept", String.class), 0);
        MethodArgumentTypeMismatchException ex = new MethodArgumentTypeMismatchException(
                "abc", Integer.class, "id", parameter, null);

        ApiErrorResponse body = body(handler.handleTypeMismatch(ex, request("/api/tasks/abc")));

        assertThat(body.status()).isEqualTo(422);
        assertThat(body.type()).endsWith("/unprocessable");
        assertThat(body.detail()).isEqualTo("parameter 'id' is not a valid value");
    }

    @Test
    void unsupportedMethodIs405() {
        ApiErrorResponse body = body(handler.handleMethodNotAllowed(
                new HttpRequestMethodNotSupportedException("DELETE"), request("/api/tasks/stats")));

        assertThat(body.status()).isEqualTo(405);
        assertThat(body.type()).endsWith("/method-not-allowed");
        assertThat(body.title()).isEqualTo("Method not allowed");
    }

    @Test
    void unexpectedThrowableIsOpaque500() {
        ApiErrorResponse body = body(handler.handleUnexpected(new RuntimeException("boom"), request("/api/tasks")));

        assertThat(body.status()).isEqualTo(500);
        assertThat(body.type()).endsWith("/internal-error");
        assertThat(body.detail()).isEqualTo("unexpected server error");
        assertThat(body.detail()).doesNotContain("boom");
        assertThat(body.errors()).isEmpty();
    }

    @Test
    void errorEnvelopeFieldOrderIsFrozen() {
        assertThat(java.util.Arrays.stream(ApiErrorResponse.class.getRecordComponents())
                .map(java.lang.reflect.RecordComponent::getName))
                .containsExactly("type", "title", "status", "detail", "instance", "errors");
    }

    @Test
    void methodValidationFailuresMapToFieldErrors() throws Exception {
        MethodParameter parameter = new MethodParameter(Throwing.class.getMethod("accept", int.class), 0);
        parameter.initParameterNameDiscovery(new org.springframework.core.DefaultParameterNameDiscoverer());
        List<ParameterValidationResult> results = List.of(new ParameterValidationResult(
                parameter, 0,
                List.of(new ObjectError("request", "must be positive")),
                null, null, null, (r, t) -> r.getDefaultMessage()));

        ApiErrorResponse body = body(handler.handleHandlerMethodValidation(
                new HandlerMethodValidationException(MethodValidationResult.create(
                        new Throwing(), Throwing.class.getMethod("accept", int.class), results)),
                request("/api/tasks")));

        assertThat(body.status()).isEqualTo(400);
        assertThat(body.errors()).containsExactly(new FieldError("value", "must be positive"));
    }

    @Test
    void unmatchedPathsUseTheEnvelopeToo() {
        ApiErrorResponse body = body(handler.handleNoResource(null, request("/api/nope")));

        assertThat(body.status()).isEqualTo(404);
        assertThat(body.type()).endsWith("/not-found");
        assertThat(body.instance()).isEqualTo("/api/nope");
    }

    @Test
    void adviceIsUnscopedSoNoErrorBypassesTheEnvelope() {
        assertThat(ApiExceptionHandler.class.getAnnotation(RestControllerAdvice.class)).isNotNull();
        assertThat(ApiExceptionHandler.class.getAnnotation(RestControllerAdvice.class).basePackages())
                .isEmpty();
    }

    static class Throwing {
        public void accept(String value) {
        }

        public void accept(int value) {
        }
    }
}