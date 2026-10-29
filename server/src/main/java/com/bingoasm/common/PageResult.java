package com.bingoasm.common;

import java.util.List;

/** Paged list: { content, totalElements, page (1-based), size, totalPages }. */
public record PageResult<T>(List<T> content, long totalElements, int page, int size, int totalPages) {

    public static int page(Integer p) {
        return p == null || p < 1 ? 1 : p;
    }

    public static int size(Integer s) {
        if (s == null || s < 1) return 10;
        return Math.min(s, 500);
    }

    /** In-memory paging for small, already filtered lists. */
    public static <T> PageResult<T> of(List<T> all, Integer pageParam, Integer sizeParam) {
        int page = page(pageParam), size = size(sizeParam);
        int from = Math.min((page - 1) * size, all.size());
        int to = Math.min(from + size, all.size());
        return new PageResult<>(all.subList(from, to), all.size(), page, size, (int) Math.ceil(all.size() / (double) size));
    }
}
