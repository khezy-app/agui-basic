package io.github.khezyapp.backend.common;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatExceptionOfType;

class PageResponseTest {

    @Test
    void totalPagesRoundsUp() {
        assertThat(PageResponse.of(List.of(), 0, 20, 137).totalPages()).isEqualTo(7);
        assertThat(PageResponse.of(List.of(), 0, 20, 140).totalPages()).isEqualTo(7);
        assertThat(PageResponse.of(List.of(), 0, 20, 141).totalPages()).isEqualTo(8);
        assertThat(PageResponse.of(List.of(), 0, 10, 25).totalPages()).isEqualTo(3);
    }

    @Test
    void anEmptyResultHasZeroPagesNotOne() {
        PageResponse<String> page = PageResponse.of(List.of(), 0, 20, 0);

        assertThat(page.totalPages()).isZero();
        assertThat(page.totalElements()).isZero();
        assertThat(page.content()).isEmpty();
    }

    @Test
    void envelopeFieldsRoundTrip() {
        PageResponse<String> page = new PageResponse<>(List.of("a", "b"), 1, 2, 10, 5);

        assertThat(page.content()).containsExactly("a", "b");
        assertThat(page.page()).isEqualTo(1);
        assertThat(page.size()).isEqualTo(2);
        assertThat(page.totalElements()).isEqualTo(10);
        assertThat(page.totalPages()).isEqualTo(5);
    }

    @Test
    void contentIsDefensivelyCopiedAndImmutable() {
        List<String> source = new ArrayList<>(List.of("a"));
        PageResponse<String> page = PageResponse.of(source, 0, 20, 1);

        source.add("b");

        assertThat(page.content()).containsExactly("a");
        assertThatExceptionOfType(UnsupportedOperationException.class)
                .isThrownBy(() -> page.content().add("c"));
    }
}