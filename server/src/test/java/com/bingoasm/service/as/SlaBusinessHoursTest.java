package com.bingoasm.service.as;

import static org.junit.jupiter.api.Assertions.*;

import com.bingoasm.common.Json;
import com.bingoasm.domain.as.AsRequest;
import com.bingoasm.domain.as.SlaTarget;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.EnumSet;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** SLA 단계별 근무 시간 세기 (V19). 2026-11-13은 금요일, 17일(화)은 휴일. 근무 09:00~18:00. */
class SlaBusinessHoursTest {
    private final WorkCalendar cal = new WorkCalendar(EnumSet.range(DayOfWeek.MONDAY, DayOfWeek.FRIDAY), LocalTime.of(9, 0), LocalTime.of(18, 0),
            Set.of(LocalDate.of(2026, 11, 17)));

    private static LocalDateTime t(int day, int h, int m) { return LocalDateTime.of(2026, 11, day, h, m); }

    private static SlaTarget target(boolean receiveBiz, boolean visitBiz, boolean recoverBiz) {
        SlaTarget s = new SlaTarget();
        s.receiveMin = 30; s.visitMin = 240; s.recoverFullMin = 480; s.recoverPartialMin = 1440;
        s.receiveBiz = receiveBiz; s.visitBiz = visitBiz; s.recoverBiz = recoverBiz;
        return s;
    }

    private static AsRequest req(LocalDateTime at) {
        AsRequest r = new AsRequest();
        r.rceptTy = "S"; r.useYn = "Y"; r.status = "A"; r.requestAt = at; r.faultTypeCode = "72";
        return r;
    }

    // ---- WorkCalendar.plus ----

    @Test void plusInsideDay() { assertEquals(t(13, 10, 30), cal.plus(t(13, 10, 0), 30)); }

    /** 금 17:50 + 30분 = 금 10분 + 월 20분 → 월 09:20 */
    @Test void plusOverWeekend() { assertEquals(t(16, 9, 20), cal.plus(t(13, 17, 50), 30)); }

    /** 밤에 들어온 신청은 다음 근무 시작부터 */
    @Test void plusFromNight() { assertEquals(t(16, 9, 30), cal.plus(t(14, 22, 0), 30)); }

    /** 월 17:00 + 4시간 = 월 1시간 + (화 휴일) + 수 3시간 → 수 12:00 */
    @Test void plusSkipsHoliday() { assertEquals(t(18, 12, 0), cal.plus(t(16, 17, 0), 240)); }

    @Test void plusEndsExactlyAtClosing() { assertEquals(t(13, 18, 0), cal.plus(t(13, 17, 0), 60)); }

    // ---- 판정 ----

    /** 금 17:50 신청, 월 09:00 접수: 24시간이면 위반, 근무 시간이면 10분 → 충족 */
    @Test void receiveJudgedByBusinessHours() {
        AsRequest r = req(t(13, 17, 50));
        r.status = "R"; r.receivedAt = t(16, 9, 0);
        LocalDateTime now = t(16, 9, 5);
        assertTrue(SlaService.judge(r, target(false, false, false), cal, now).receive().missed());
        SlaService.Step s = SlaService.judge(r, target(true, false, false), cal, now).receive();
        assertTrue(s.met());
        assertEquals(10L, s.minutes());
    }

    /** 복구는 24시간 그대로 두고 접수만 근무 시간이면, 복구 판정은 바뀌지 않는다 */
    @Test void stagesAreIndependent() {
        AsRequest r = req(t(13, 17, 50));
        LocalDateTime now = t(16, 9, 5);
        SlaService.Item x = SlaService.judge(r, target(true, false, false), cal, now);
        assertFalse(x.receive().missed());                 // 근무 시간 15분 흐름 → 진행 중
        assertEquals(15L, x.receive().minutes());
        assertEquals(3795L, x.recover().minutes());       // 24시간: 금 17:50 → 월 09:05 = 2일 15시간 15분
    }

    /** 달력이 없으면 (근무 시간 단계가 없으면) 24시간 */
    @Test void noCalendarMeansWallClock() {
        AsRequest r = req(t(13, 17, 50));
        assertTrue(SlaService.judge(r, target(true, false, false), null, t(16, 9, 5)).receive().missed());
    }

    // ---- 기한 (목록 · 상세의 남은 시간) ----

    /** 모든 단계를 근무 시간으로 (접수만 근무 시간이면 24시간 도착 기한이 더 이르다) */
    @Test void dueUsesBusinessHours() {
        AsRequest r = req(t(13, 17, 50));
        Json d = SlaService.due(r, target(true, true, true), cal, t(13, 17, 55));
        assertEquals("RECEIVE", d.get("stage"));
        assertEquals(t(16, 9, 20), d.get("dueAt"));
        assertEquals(25L, d.get("remainingMin"));          // 근무 시간으로 25분 남음
        assertEquals(Boolean.TRUE, d.get("biz"));
    }

    @Test void dueOverdueIsNegativeBusinessMinutes() {
        AsRequest r = req(t(13, 17, 50));
        Json d = SlaService.due(r, target(true, true, true), cal, t(16, 10, 0));
        assertEquals(t(16, 9, 20), d.get("dueAt"));
        assertEquals(-40L, d.get("remainingMin"));
    }

    @Test void wallClockDueUnchanged() {
        AsRequest r = req(t(13, 17, 50));
        Json d = SlaService.due(r, target(false, false, false), cal, t(13, 17, 55));
        assertEquals(t(13, 18, 20), d.get("dueAt"));
        assertNull(d.get("biz"));
    }

    /** 근무 시간 단계의 보류는 근무 시간(분)으로 뺀다: 첫 보류 뒤 끝난 보류 근무 시간 60분 → 기한 60분 뒤로 */
    @Test void holdShiftsDueInBusinessMinutes() {
        AsRequest r = req(t(13, 10, 0));
        r.firstHoldAt = t(13, 10, 5); r.holdMinutes = 1000; r.holdBizMinutes = 60;
        Json d = SlaService.due(r, target(true, true, true), cal, t(13, 10, 6));
        assertEquals(t(13, 11, 30), d.get("dueAt"));       // 10:00 + 30분 + 보류 60분
    }
}
