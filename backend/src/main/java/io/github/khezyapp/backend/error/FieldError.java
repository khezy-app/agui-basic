package io.github.khezyapp.backend.error;

/**
 * One field-scoped validation failure. {@code field} is a dotted/indexed path
 * ({@code tags[0]}) so the frontend can map it straight onto a form control.
 */
public record FieldError(String field, String message) {
}