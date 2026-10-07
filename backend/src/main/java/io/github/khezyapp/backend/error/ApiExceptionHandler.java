package io.github.khezyapp.backend.error;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.MessageSourceResolvable;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.method.ParameterValidationResult;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.servlet.resource.NoResourceFoundException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

/**
 * The single exit point for errors: every response leaving the API is the frozen
 * C1 envelope. Framework messages and stack traces never reach {@code detail}.
 */
@RestControllerAdvice
public class ApiExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ApiErrorResponse> handleApiException(ApiException ex, HttpServletRequest request) {
        return response(ex.getMarker(), ex.getStatus(), ex.getTitle(), ex.getMessage(), request, ex.getErrors());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiErrorResponse> handleMethodArgumentNotValid(
            MethodArgumentNotValidException ex, HttpServletRequest request) {
        List<FieldError> errors = ex.getBindingResult().getFieldErrors().stream()
                .map(error -> new FieldError(error.getField(), error.getDefaultMessage()))
                .sorted(Comparator.comparing(FieldError::field))
                .toList();
        return validation(errors, request);
    }

    @ExceptionHandler(HandlerMethodValidationException.class)
    public ResponseEntity<ApiErrorResponse> handleHandlerMethodValidation(
            HandlerMethodValidationException ex, HttpServletRequest request) {
        List<FieldError> errors = new ArrayList<>();
        for (ParameterValidationResult result : ex.getParameterValidationResults()) {
            String name = result.getMethodParameter().getParameterName();
            String path = result.getContainerIndex() != null
                    ? name + "[" + result.getContainerIndex() + "]"
                    : name;
            for (MessageSourceResolvable error : result.getResolvableErrors()) {
                errors.add(new FieldError(path, error.getDefaultMessage()));
            }
        }
        errors.sort(Comparator.comparing(FieldError::field));
        return validation(errors, request);
    }

    @ExceptionHandler(MissingServletRequestParameterException.class)
    public ResponseEntity<ApiErrorResponse> handleMissingParameter(
            MissingServletRequestParameterException ex, HttpServletRequest request) {
        return response("validation-failed", 400, "Validation failed",
                "required parameter '" + ex.getParameterName() + "' is missing", request, List.of());
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ApiErrorResponse> handleTypeMismatch(
            MethodArgumentTypeMismatchException ex, HttpServletRequest request) {
        return unprocessable("parameter '" + ex.getName() + "' is not a valid value", request);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiErrorResponse> handleNotReadable(
            HttpMessageNotReadableException ex, HttpServletRequest request) {
        log.debug("Unreadable request body on {}: {}", request.getRequestURI(), ex.getMessage());
        return unprocessable("malformed or unknown field in request body", request);
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ApiErrorResponse> handleMethodNotAllowed(
            HttpRequestMethodNotSupportedException ex, HttpServletRequest request) {
        return response("method-not-allowed", 405, "Method not allowed",
                "HTTP method '" + ex.getMethod() + "' is not supported for this path", request, List.of());
    }

    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ApiErrorResponse> handleNoResource(
            NoResourceFoundException ex, HttpServletRequest request) {
        return new NotFoundApiException("no endpoint at " + request.getRequestURI()).asResponse(request);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiErrorResponse> handleUnexpected(Exception ex, HttpServletRequest request) {
        log.error("Unhandled exception on {} {}", request.getMethod(), request.getRequestURI(), ex);
        return response("internal-error", 500, "Internal server error",
                "unexpected server error", request, List.of());
    }

    private ResponseEntity<ApiErrorResponse> validation(List<FieldError> errors, HttpServletRequest request) {
        String detail = errors.isEmpty()
                ? "request is invalid"
                : errors.size() + (errors.size() == 1 ? " field is invalid" : " fields are invalid");
        return response("validation-failed", 400, "Validation failed", detail, request, errors);
    }

    private ResponseEntity<ApiErrorResponse> unprocessable(String detail, HttpServletRequest request) {
        return response("unprocessable", 422, "Unprocessable request", detail, request, List.of());
    }

    private ResponseEntity<ApiErrorResponse> response(String marker, int status, String title,
                                                      String detail, HttpServletRequest request,
                                                      List<FieldError> errors) {
        String instance = request == null ? "" : request.getRequestURI();
        return ResponseEntity.status(status)
                .body(ApiErrorResponse.of(marker, status, title, detail, instance, errors));
    }
}