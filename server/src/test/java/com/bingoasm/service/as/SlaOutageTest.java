package com.bingoasm.service.as;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;

import java.time.LocalDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;

/** 회선 장애 구간 합치기 (SlaService.outage): [장애 횟수, 장애 분]. 11월 = 2026-11-01 ~ 2026-12-01. */
class SlaOutageTest {
    private static final LocalDateTime MS = t(1, 0, 0), ME = LocalDateTime.of(2026, 12, 1, 0, 0);

    private static LocalDateTime t(int d, int h, int m) { return LocalDateTime.of(2026, 11, d, h, m); }
    private static LocalDateTime[] s(LocalDateTime a, LocalDateTime b) { return new LocalDateTime[]{a, b}; }
    private static long[] run(LocalDateTime[]... spans) { return SlaOutage.of(List.of(spans)); }

    /** 테스트용 짧은 이름 */
    private static final class SlaOutage { static long[] of(List<LocalDateTime[]> l) { return SlaService.outage(l, MS, ME, ME); } }

    @Test void single() { assertArrayEquals(new long[]{1, 150}, run(s(t(3, 9, 10), t(3, 11, 40)))); }

    @Test void separateOutagesAdd() { assertArrayEquals(new long[]{2, 210}, run(s(t(3, 9, 10), t(3, 11, 40)), s(t(20, 14, 0), t(20, 15, 0)))); }

    /** 같은 장애를 두 사람이 신고 (10:00~12:00, 10:30~11:00) → 한 번, 120분 */
    @Test void duplicateReportInside() { assertArrayEquals(new long[]{1, 120}, run(s(t(5, 10, 0), t(5, 12, 0)), s(t(5, 10, 30), t(5, 11, 0)))); }

    /** 일부만 겹침 (10:00~11:00, 10:30~12:00) → 10:00~12:00 = 120분 */
    @Test void partialOverlap() { assertArrayEquals(new long[]{1, 120}, run(s(t(5, 10, 30), t(5, 12, 0)), s(t(5, 10, 0), t(5, 11, 0)))); }

    /** 맞닿음 (10~11, 11~12) → 하나로 */
    @Test void touching() { assertArrayEquals(new long[]{1, 120}, run(s(t(5, 10, 0), t(5, 11, 0)), s(t(5, 11, 0), t(5, 12, 0)))); }

    /** 지난달 31일 22시 ~ 이번 달 1일 02시 → 시간 120분만, 횟수는 지난달 것 */
    @Test void carriedFromLastMonth() {
        assertArrayEquals(new long[]{0, 120}, run(s(LocalDateTime.of(2026, 10, 31, 22, 0), t(1, 2, 0))));
    }

    /** 지난달부터 이어진 장애 중에 이번 달 중복 신고 → 횟수 0 (같은 장애), 시간은 한 번 */
    @Test void duplicateOfCarried() {
        assertArrayEquals(new long[]{0, 180}, run(s(LocalDateTime.of(2026, 10, 31, 23, 0), t(1, 3, 0)), s(t(1, 1, 0), t(1, 2, 0))));
    }

    /** 이번 달 진행 중: 지금(15일 12시)까지만 */
    @Test void ongoingCappedAtNow() {
        assertArrayEquals(new long[]{1, 120}, SlaService.outage(List.<LocalDateTime[]>of(s(t(15, 10, 0), t(15, 18, 0))), MS, ME, t(15, 12, 0)));
    }
}
