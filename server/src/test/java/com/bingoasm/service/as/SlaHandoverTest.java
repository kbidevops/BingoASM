package com.bingoasm.service.as;

import static org.junit.jupiter.api.Assertions.*;

import com.bingoasm.common.Json;
import com.bingoasm.domain.as.AsHandover;
import com.bingoasm.domain.as.AsRequest;
import com.bingoasm.domain.as.SlaTarget;
import java.time.LocalDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;

/** SLA와 처리 흐름 (V20): 넘겨받은 때부터 재기 · 담당별 접수 · 실제 도착 기록만 · 직접 처리 분리. 기준 접수 30분 · 도착 4시간. */
class SlaHandoverTest {
    private static LocalDateTime t(int h, int m) { return LocalDateTime.of(2026, 11, 13, h, m); }
    private final SlaTarget st = new SlaTarget();   // 30분 · 240분 · 480분 · 1440분, 모두 24시간
    private final LocalDateTime now = t(18, 0);

    private static AsRequest req() {
        AsRequest r = new AsRequest();
        r.rceptTy = "S"; r.useYn = "Y"; r.status = "A"; r.requestAt = t(10, 0); r.faultTypeCode = "72"; r.handlerType = "VENDOR"; r.vendorId = 1L;
        return r;
    }

    private static AsHandover seg(String type, Long vendor, LocalDateTime start, LocalDateTime received, LocalDateTime end) {
        AsHandover h = new AsHandover();
        h.handlerType = type; h.vendorId = vendor; h.startAt = start; h.receivedAt = received; h.endAt = end;
        return h;
    }

    /** 교육지원청이 25분 확인하고 넘김 → 통신사는 넘겨받은 10:25부터: 10:40 접수 = 15분, 충족. 1차 확인 25분은 따로 */
    @Test void receiveCountsFromHandover() {
        AsRequest r = req();
        r.handoverAt = t(10, 25); r.status = "R"; r.receivedAt = t(10, 40);
        var x = SlaService.judge(r, st, null, now, List.of(seg("REGION", null, t(10, 0), null, t(10, 25)), seg("VENDOR", 1L, t(10, 25), t(10, 40), null)));
        assertEquals(15L, x.receive().minutes());
        assertFalse(x.receive().missed());
        assertEquals(25L, x.triageMin());
        assertFalse(x.office());
    }

    /** 예전처럼 신청부터 쟀다면 40분 → 위반이었을 건 */
    @Test void withoutHandoverItWouldHaveMissed() {
        AsRequest r = req();
        r.status = "R"; r.receivedAt = t(10, 40);
        assertTrue(SlaService.judge(r, st, null, now, List.of()).receive().missed());
    }

    /** 통신사 A가 1시간 동안 접수하지 않고 B로 넘어감: A의 위반은 남고, B는 새로 잰다 */
    @Test void earlierVendorKeepsItsViolation() {
        AsRequest r = req();
        r.vendorId = 2L; r.handoverAt = t(11, 0); r.status = "R"; r.receivedAt = t(11, 10);
        var x = SlaService.judge(r, st, null, now, List.of(seg("VENDOR", 1L, t(10, 0), null, t(11, 0)), seg("VENDOR", 2L, t(11, 0), t(11, 10), null)));
        assertFalse(x.receive().missed());            // B: 10분
        assertEquals(1, x.prior().size());
        assertTrue(x.prior().get(0).missed());          // A: 60분, 접수 안 함
        assertEquals(1L, x.prior().get(0).vendorId());
        assertTrue(x.missed());                          // 건 전체로는 위반
    }

    /** A가 10분 만에 접수했는데 나중에 B로 옮김: A 위반 아님, B는 넘겨받은 때부터 */
    @Test void earlierVendorReceivedInTime() {
        AsRequest r = req();
        r.vendorId = 2L; r.handoverAt = t(12, 0); r.status = "A";
        var x = SlaService.judge(r, st, null, t(12, 10), List.of(seg("VENDOR", 1L, t(10, 0), t(10, 10), t(12, 0)), seg("VENDOR", 2L, t(12, 0), null, null)));
        assertFalse(x.prior().get(0).missed());
        assertEquals(10L, x.prior().get(0).minutes());
        assertEquals("PENDING", x.receive().state());   // B: 10분 흐름
        assertFalse(x.missed());
    }

    /** 교육지원청 직접 처리: 통신사 SLA에서 빼고 따로 */
    @Test void officeHandledIsSeparate() {
        AsRequest r = req();
        r.handlerType = "REGION"; r.vendorId = null;
        var x = SlaService.judge(r, st, null, now, List.of());
        assertTrue(x.office());
        assertNull(x.triageMin());
    }

    /** 도착을 기록하지 않고 처리완료 → 도착은 판정하지 않고, 나머지가 충족이면 충족 */
    @Test void unrecordedArrivalIsNotJudged() {
        AsRequest r = req();
        r.status = "C"; r.receivedAt = t(10, 10); r.visitAt = t(11, 0); r.visitRecorded = false; r.completedAt = t(12, 0);
        var x = SlaService.judge(r, st, null, now, List.of());
        assertTrue(x.visit().noRecord());
        assertNull(x.visit().minutes());
        assertTrue(x.met());
    }

    /** 이전 자료(기록 여부 모름)도 도착 판정에서 뺀다 */
    @Test void legacyArrivalIsNotJudged() {
        AsRequest r = req();
        r.status = "C"; r.receivedAt = t(10, 10); r.visitAt = t(16, 0); r.completedAt = t(16, 30);
        assertTrue(SlaService.judge(r, st, null, now, List.of()).visit().noRecord());
    }

    /** 기록한 도착은 넘겨받은 때부터 판정: 10:30에 넘겨받아 15:00 도착 = 4시간 30분 → 위반 */
    @Test void recordedArrivalIsJudgedFromHandover() {
        AsRequest r = req();
        r.handoverAt = t(10, 30); r.status = "C"; r.receivedAt = t(10, 40); r.visitAt = t(15, 0); r.visitRecorded = true; r.completedAt = t(16, 0);
        var x = SlaService.judge(r, st, null, now, List.of());
        assertEquals(270L, x.visit().minutes());
        assertTrue(x.visit().missed());
    }

    /** 처리 중 건의 기한도 넘겨받은 때부터 */
    @Test void dueStartsAtHandover() {
        AsRequest r = req();
        r.handoverAt = t(10, 25);
        Json d = SlaService.due(r, st, t(10, 30));
        assertEquals("RECEIVE", d.get("stage"));
        assertEquals(t(10, 55), d.get("dueAt"));
        assertEquals(25L, d.get("remainingMin"));
    }

    /** 넘겨받기 전의 보류는 새 담당의 시간에서 빼지 않는다 */
    @Test void holdBeforeHandoverNotSubtracted() {
        AsRequest r = req();
        r.firstHoldAt = t(10, 5); r.holdMinutes = 60; r.handoverAt = t(11, 30); r.status = "R"; r.receivedAt = t(11, 50);
        assertEquals(20L, SlaService.judge(r, st, null, now, List.of()).receive().minutes());
    }
}
