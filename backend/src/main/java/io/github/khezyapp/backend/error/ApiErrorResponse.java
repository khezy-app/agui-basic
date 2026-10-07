package io.github.khezyapp.backend.error;

import java.util.List;

/**
 * The frozen C1 error envelope. {@code type} is a stable URN built from the
 * exception marker; it is not a resolvable URL.
 */
public record ApiErrorResponse(
        String type, String title, int status, String detail, String instance,
        List<FieldError> errors) {

    public static final String PROBLEM_BASE = "https://agui-basic.local/problems/";

    public ApiErrorResponse {
        errors = errors == null ? List.of() : List.copyOf(errors);
    }

    public static ApiErrorResponse of(String marker, int status, String title,
                                      String detail, String instance,
                                      List<FieldError> errors) {
        return new ApiErrorResponse(PROBLEM_BASE + marker, title, status, detail, instance, errors);
    }
}