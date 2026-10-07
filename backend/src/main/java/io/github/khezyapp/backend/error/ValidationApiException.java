package io.github.khezyapp.backend.error;

import java.util.List;

public class ValidationApiException extends ApiException {

    public ValidationApiException(String detail, List<FieldError> errors) {
        super("validation-failed", 400, "Validation failed", detail, errors);
    }

    public ValidationApiException(String detail) {
        this(detail, List.of());
    }
}