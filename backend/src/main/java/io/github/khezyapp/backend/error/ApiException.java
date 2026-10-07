package io.github.khezyapp.backend.error;

import java.util.List;

/**
 * Base type for every error the API reports as a C1 envelope. Services throw
 * these; controllers never build error bodies.
 */
public abstract class ApiException extends RuntimeException {

    private final int status;
    private final String marker;
    private final String title;
    private final List<FieldError> errors;

    protected ApiException(String marker, int status, String title, String detail,
                           List<FieldError> errors) {
        super(detail);
        this.marker = marker;
        this.status = status;
        this.title = title;
        this.errors = errors == null ? List.of() : List.copyOf(errors);
    }

    public int getStatus() {
        return status;
    }

    public String getMarker() {
        return marker;
    }

    public String getTitle() {
        return title;
    }

    public List<FieldError> getErrors() {
        return errors;
    }
}