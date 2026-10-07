package io.github.khezyapp.backend.error;

import java.util.List;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;

public class NotFoundApiException extends ApiException {

    public NotFoundApiException(String detail) {
        super("not-found", 404, "Not found", detail, List.of());
    }

    ResponseEntity<ApiErrorResponse> asResponse(HttpServletRequest request) {
        String instance = request == null ? "" : request.getRequestURI();
        return ResponseEntity.status(getStatus())
                .body(ApiErrorResponse.of(getMarker(), getStatus(), getTitle(), getMessage(), instance, getErrors()));
    }
}