package io.github.khezyapp.backend.error;

import java.util.List;

public class UnprocessableApiException extends ApiException {

    public UnprocessableApiException(String detail) {
        this(detail, List.of());
    }

    public UnprocessableApiException(String detail, List<FieldError> errors) {
        super("unprocessable", 422, "Unprocessable request", detail, errors);
    }
}