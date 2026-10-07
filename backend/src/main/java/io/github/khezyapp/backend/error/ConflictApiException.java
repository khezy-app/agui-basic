package io.github.khezyapp.backend.error;

import java.util.List;
import java.util.UUID;

/**
 * 409. The marker is caller-supplied because the frontend branches on it
 * (FR-F-11 reload-and-retry on {@code version-conflict}).
 */
public class ConflictApiException extends ApiException {

    public ConflictApiException(String marker, String title, String detail) {
        super(marker, 409, title, detail, List.of());
    }

    public ConflictApiException(String marker, String title, String detail, List<FieldError> errors) {
        super(marker, 409, title, detail, errors);
    }

    public static ConflictApiException illegalTransition(String detail) {
        return new ConflictApiException("illegal-transition", "Illegal status transition", detail);
    }

    public static ConflictApiException versionConflict(UUID id, long expected, long actual) {
        return new ConflictApiException("version-conflict", "Version conflict",
                "task " + id + " was modified concurrently: expected version " + expected
                        + " but the current version is " + actual);
    }

    public static ConflictApiException blockedDelete(String detail) {
        return new ConflictApiException("blocked-delete", "Delete blocked", detail);
    }
}