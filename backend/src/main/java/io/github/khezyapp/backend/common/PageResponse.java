package io.github.khezyapp.backend.common;

import java.util.List;

/**
 * The §3.6 list envelope. Consumed identically by the admin UI table and by the AI read
 * tool, so pagination semantics can never diverge between the two (FR-B-21).
 *
 * @param content       the page's items, never null
 * @param page          0-based page index that was returned
 * @param size          page size that was applied
 * @param totalElements number of items matching the query across all pages
 * @param totalPages    number of pages available for the query
 */
public record PageResponse<T>(List<T> content, int page, int size, long totalElements, int totalPages) {

    public PageResponse {
        content = List.copyOf(content);
    }

    /**
     * Builds a page and derives {@code totalPages} from {@code totalElements} and
     * {@code size}, rounding up. A zero-element query yields zero pages, not one.
     */
    public static <T> PageResponse<T> of(List<T> content, int page, int size, long totalElements) {
        int totalPages = (int) Math.ceil((double) totalElements / (double) size);
        return new PageResponse<>(content, page, size, totalElements, totalPages);
    }
}