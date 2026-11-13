package com.bingoasm.service.as;

import static org.junit.jupiter.api.Assertions.*;

import com.bingoasm.domain.as.AsRequest;
import com.bingoasm.domain.as.SlaTarget;
import java.time.LocalDateTime;
import org.junit.jupiter.api.Test;

/** 보류 시간 빼기: AsRequest.pausedFor · SlaService.step/judge/due. */
class HoldPauseTest {
    private static LocalDateTime t(int h, int m) { return LocalDateTime.of(2026, 11, 13, h, m); }

    private static AsRequest req() {
        AsRequest r = new AsRequest();
        r.rceptTy = "S"; r.status = "R"; r.useYn = "Y"; r.faultTypeCode = "72";
        r.requestAt = t(9, 0); r.receivedAt = t(9, 10);
        return r;
    }

    @Test void noHoldNothingPaused() { assertEquals(0, req().pausedFor(null, t(12, 0), false)); }

    @Test void stageDoneBeforeFirstHoldNotShifted() {
        AsRequest r = req(); r.firstHoldAt = t(10, 0); r.holdMinutes = 120;
        assertEquals(0, r.pausedFor(t(9, 10), t(15, 0), false));     // 접수는 보류 전에 끝났다
        assertEquals(120, r.pausedFor(t(14, 0), t(15, 0), false));   // 그 뒤에 끝난 단계
        assertEquals(120, r.pausedFor(null, t(15, 0), false));       // 아직 안 끝난 단계
    }

    @Test void ongoingHoldCountsUntilNow() {
        AsRequest r = req(); r.firstHoldAt = t(10, 0); r.holdAt = t(10, 0); r.holdMinutes = 0;
        assertEquals(90, r.pausedFor(null, t(11, 30), false));
    }

    @Test void bizMinutesUsedForBusinessRules() {
        AsRequest r = req(); r.firstHoldAt = t(10, 0); r.holdMinutes = 900; r.holdBizMinutes = 60;
        assertEquals(60, r.pausedFor(null, t(15, 0), true));
        assertEquals(900, r.pausedFor(null, t(15, 0), false));
    }

    /** 일부 장애 복구 기준 24시간: 9시 신청, 25시간 뒤 복구했지만 그사이 2시간 보류 → 23시간 → 충족 */
    @Test void slaRecoverMetAfterSubtractingHold() {
        AsRequest r = req(); r.status = "C"; r.firstHoldAt = t(10, 0); r.holdMinutes = 120;
        r.completedAt = r.requestAt.plusHours(25); r.visitAt = t(11, 0);
        SlaTarget st = new SlaTarget();
        SlaService.Item it = SlaService.judge(r, st, r.completedAt);
        assertTrue(it.recover().met(), "recover should be met: " + it.recover());
    }

    @Test void dueIsNullWhileOnHoldAndShiftedAfter() {
        AsRequest r = req(); r.visitAt = t(9, 30);
        SlaTarget st = new SlaTarget();
        r.firstHoldAt = t(10, 0); r.holdAt = t(10, 0);
        assertNull(SlaService.due(r, st, t(11, 0)));
        r.holdAt = null; r.holdMinutes = 60;   // 1시간 보류 후 해제
        // 복구 기한 = 신청 9:00 + 24시간 + 1시간 보류
        assertEquals(r.requestAt.plusHours(25), SlaService.due(r, st, t(11, 0)).get("dueAt"));
    }

    @Test void lateOfIsNullOnHold() {
        AsRequest r = req(); r.status = "A"; r.receivedAt = null; r.holdAt = t(9, 5); r.firstHoldAt = t(9, 5);
        AsAlertService.Rule rule = new AsAlertService.Rule("S", 1, 1, 1, true, false, false);
        assertNull(AsAlertService.lateOf(r, rule, null, t(18, 0)));
    }
}
