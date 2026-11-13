package com.bingoasm.service.as;

import com.bingoasm.auth.CurrentUser;
import com.bingoasm.auth.PermissionService;
import com.bingoasm.common.*;
import com.bingoasm.domain.as.*;
import com.bingoasm.repo.as.AsRequestRepository;
import com.bingoasm.repo.as.SlaTargetRepository;
import com.bingoasm.repo.as.WirelessDeviceRepository;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.util.*;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 스쿨넷 SLA 현황: 스쿨넷 AS(rceptTy S)마다 신청 시각부터 접수 · 현장 도착(방문) · 복구(처리완료)까지 걸린 시간을
 * 교육청의 SLA 기준(SlaTarget)과 비교한다. 반려(X) · 취소(useYn N) 건은 뺀다.
 * <ul>
 *   <li>끝난 단계: 걸린 시간 ≤ 기준이면 충족, 넘으면 위반.</li>
 *   <li>아직 안 끝난 단계: 지금까지 흐른 시간이 기준 안이면 ‘진행 중’(집계 제외), 넘었으면 위반.</li>
 *   <li>복구 기준은 장애유형 71(전체)이면 전체 장애 기준, 그 밖(일부 · 기타)은 일부 장애 기준.</li>
 *   <li>회선 가용률: 그 장비(회선)로 신청한 AS의 장애 시간(신청 → 처리완료, 진행 중이면 지금까지)을 그 달 안으로 잘라 더한 값으로 계산.</li>
 * </ul>
 * 범위는 AS 통계와 같다: 학교는 자기 학교, 교육지원청은 관할, 업체는 자기 업체에 배정된 건.
 */
@Service
@Transactional(readOnly = true)
public class SlaService {
    static final String FULL_OUTAGE = "71";

    private final AsRequestRepository requests;
    private final WirelessDeviceRepository devices;
    private final SlaTargetRepository targets;
    private final SchoolService schoolService;
    private final AsRequestService requestService;
    private final PermissionService permissions;
    private final AsAlertService alerts;
    private final com.bingoasm.repo.as.AsHandoverRepository handovers;
    private final WorkflowService workflows;

    public SlaService(AsRequestRepository requests, WirelessDeviceRepository devices, SlaTargetRepository targets, SchoolService schoolService,
                      AsRequestService requestService, PermissionService permissions, AsAlertService alerts,
                      com.bingoasm.repo.as.AsHandoverRepository handovers, WorkflowService workflows) {
        this.requests = requests; this.devices = devices; this.targets = targets; this.schoolService = schoolService;
        this.requestService = requestService; this.permissions = permissions; this.alerts = alerts;
        this.handovers = handovers; this.workflows = workflows;
    }

    /** 건마다 담당 구간 (시작 순) */
    private Map<Long, List<AsHandover>> segments(Collection<AsRequest> rows) {
        if (rows.isEmpty()) return Map.of();
        Map<Long, List<AsHandover>> m = new HashMap<>();
        for (AsHandover h : handovers.findByAsvcSnInOrderByStartAtAsc(rows.stream().map(r -> r.asvcSn).collect(Collectors.toSet())))
            m.computeIfAbsent(h.asvcSn, k -> new ArrayList<>()).add(h);
        return m;
    }

    /**
     * SLA를 약하게 만드는 스쿨넷 처리 흐름 설정 (SLA 기준 화면에 알린다).
     * level: warn = SLA 일부를 판정할 수 없다, info = SLA가 그에 맞춰 계산한다는 안내.
     */
    List<Json> flowWarnings(Long orgId) {
        WorkflowService.Flow f = workflows.flow(orgId, "S");
        List<Json> out = new ArrayList<>();
        if (!f.arrivalRequired())
            out.add(Json.obj().with("key", "arrival").with("level", "warn")
                    .with("text", "스쿨넷 처리 흐름에서 ‘현장 도착 기록 필수’가 꺼져 있습니다. 도착을 기록하지 않고 처리완료한 건은 현장 도착 SLA를 판정하지 못합니다 (‘도착 기록 없음’)."));
        if (!"REQUIRED".equals(f.deviceLink()))
            out.add(Json.obj().with("key", "device").with("level", "warn")
                    .with("text", "스쿨넷 처리 흐름에서 대상 장비가 ‘필수’가 아닙니다. 회선(장비)이 지정되지 않은 장애는 회선 가용률에 들어가지 않습니다."));
        if (f.officeFirst())
            out.add(Json.obj().with("key", "triage").with("level", "info")
                    .with("text", "스쿨넷 신고는 교육지원청이 먼저 확인합니다. 통신사의 접수 · 현장 도착은 넘겨받은 때부터 재고, 1차 확인 시간은 따로 보여 줍니다."));
        return out;
    }

    /** 근무 시간으로 세는 단계가 있으면 그 교육청의 근무 시간 달력 (지연 알림과 같은 달력), 없으면 null (모두 24시간). */
    public static WorkCalendar calendarFor(SlaTarget t, java.util.function.Supplier<WorkCalendar> cal) { return t.anyBiz() ? cal.get() : null; }

    // ---------- 기준 ----------

    public SlaTarget target(Long orgId) {
        return targets.findById(orgId).orElseGet(() -> { SlaTarget t = new SlaTarget(); t.orgId = orgId; return t; });
    }

    static Json targetView(SlaTarget t, WorkCalendar cal) {
        return Json.obj().with("receiveMin", t.receiveMin).with("visitMin", t.visitMin).with("recoverFullMin", t.recoverFullMin)
                .with("recoverPartialMin", t.recoverPartialMin).with("availabilityPct", t.availabilityPct).with("updatedAt", t.updatedAt)
                .with("receiveBiz", biz(t, "RECEIVE")).with("visitBiz", biz(t, "VISIT")).with("recoverBiz", biz(t, "RECOVER"))
                .with("calendar", cal == null ? null : cal.label())
                .with("isDefault", t.updatedAt == null);
    }

    // ---------- 단계별 시간 세는 법 (24시간 · 근무 시간) ----------

    /** stage: RECEIVE 접수 · VISIT 현장 도착 · RECOVER 복구 */
    public static boolean biz(SlaTarget t, String stage) {
        return Boolean.TRUE.equals(switch (stage) { case "RECEIVE" -> t.receiveBiz; case "VISIT" -> t.visitBiz; default -> t.recoverBiz; });
    }

    /** 이 단계에서 from ~ to 사이에 흐른 분: 근무 시간 단계면 달력으로, 아니면 24시간. */
    public static long span(SlaTarget t, WorkCalendar cal, String stage, LocalDateTime from, LocalDateTime to) {
        if (from == null || to == null || !to.isAfter(from)) return 0;
        return biz(t, stage) && cal != null ? cal.minutes(from, to) : Duration.between(from, to).toMinutes();
    }

    /** 이 단계의 기한: from부터 minutes분 (근무 시간 단계면 근무 시간으로). */
    public static LocalDateTime plus(SlaTarget t, WorkCalendar cal, String stage, LocalDateTime from, long minutes) {
        return biz(t, stage) && cal != null ? cal.plus(from, minutes) : from.plusMinutes(minutes);
    }

    /** now 기준 남은 분 (넘었으면 음수), 단계의 단위로. */
    public static long remaining(SlaTarget t, WorkCalendar cal, String stage, LocalDateTime now, LocalDateTime dueAt) {
        return dueAt.isAfter(now) ? span(t, cal, stage, now, dueAt) : -span(t, cal, stage, dueAt, now);
    }

    /** 기준 저장: 도교육청 관리자(게시판 관리 권한)만. 분은 1분 ~ 30일, 가용률은 90 ~ 100%. */
    @Transactional
    public Json saveTarget(CurrentUser me, Map<String, Object> b) {
        if (!me.scope().province() || !me.can("BOARD_ADMIN")) throw ApiException.forbidden("SLA 기준은 교육청 관리자만 바꿀 수 있습니다.");
        SlaTarget t = targets.findById(me.orgId()).orElseGet(() -> { SlaTarget x = new SlaTarget(); x.orgId = me.orgId(); return x; });
        t.receiveMin = minutes(b, "receiveMin", "접수 시간");
        t.visitMin = minutes(b, "visitMin", "현장 도착 시간");
        t.recoverFullMin = minutes(b, "recoverFullMin", "전체 장애 복구 시간");
        t.recoverPartialMin = minutes(b, "recoverPartialMin", "일부 장애 복구 시간");
        Double pct;
        try { pct = b.get("availabilityPct") == null ? null : Double.valueOf(String.valueOf(b.get("availabilityPct")).trim()); }
        catch (NumberFormatException e) { pct = null; }
        if (pct == null || pct < 90 || pct > 100) throw ApiException.badRequest("가용률 목표는 90 ~ 100% 사이로 입력해 주세요.");
        t.availabilityPct = Math.round(pct * 100) / 100.0;
        // 단계별 시간 세는 법: 보내지 않으면 그대로
        if (b.containsKey("receiveBiz")) t.receiveBiz = bool(b.get("receiveBiz"));
        if (b.containsKey("visitBiz")) t.visitBiz = bool(b.get("visitBiz"));
        if (b.containsKey("recoverBiz")) t.recoverBiz = bool(b.get("recoverBiz"));
        t.updatedAt = Times.now();
        t.updatedBy = me.userId();
        targets.save(t);
        return targetView(t, calendarFor(t, () -> alerts.calendar(me.orgId())));
    }

    private static boolean bool(Object v) { return v instanceof Boolean x ? x : "true".equalsIgnoreCase(String.valueOf(v)); }

    private static int minutes(Map<String, Object> b, String key, String label) {
        Integer v = Params.integer(b, key);
        if (v == null || v < 1 || v > 30 * 1440) throw ApiException.badRequest(label + "을(를) 1분 ~ 30일 사이로 입력해 주세요.");
        return v;
    }

    // ---------- 판정 ----------

    /** 한 단계의 판정: MET 충족 · MISSED 위반 · PENDING 진행 중(기준 안). minutes = 걸린(또는 지금까지 흐른) 분. */
    record Step(String state, Long minutes, int target, boolean done) {
        boolean met() { return "MET".equals(state); }
        boolean missed() { return "MISSED".equals(state); }
        /** NO_RECORD: 현장 도착을 기록하지 않고 처리완료 — 판정 · 평균에서 뺀다 */
        boolean noRecord() { return "NO_RECORD".equals(state); }
    }

    static Step step(LocalDateTime from, LocalDateTime done, int target, LocalDateTime now) { return step(from, done, target, now, 0); }

    /** 24시간 기준 판정. paused = 이 단계에서 뺄 보류 시간 (분). */
    static Step step(LocalDateTime from, LocalDateTime done, int target, LocalDateTime now, long paused) {
        return step(new SlaTarget(), null, "RECEIVE", from, done, target, now, paused);
    }

    /** 단계 판정 (근무 시간 단계면 달력으로 센다). paused = 같은 단위의 보류 시간. 보류 중인 단계는 넘었어도 위반이 아니라 진행 중으로 둔다. */
    static Step step(SlaTarget t, WorkCalendar cal, String stage, LocalDateTime from, LocalDateTime done, int target, LocalDateTime now, long paused) {
        if (from == null) return new Step("PENDING", null, target, false);
        if (done != null) {
            long m = Math.max(0, span(t, cal, stage, from, done) - paused);
            return new Step(m <= target ? "MET" : "MISSED", m, target, true);
        }
        long m = Math.max(0, span(t, cal, stage, from, now) - paused);
        return new Step(m <= target ? "PENDING" : "MISSED", m, target, false);
    }

    /** 넘기기 전 통신사(업체) 구간의 접수 판정: 그 업체가 넘겨받은 뒤 접수(또는 접수 없이 넘길 때)까지 */
    record Prior(Long vendorId, long minutes, int target, boolean received, boolean missed) {}

    /**
     * 한 AS의 판정. receive · visit은 지금 담당 기준(넘겨받은 때부터), prior = 그 전 통신사 구간들,
     * triageMin = 교육지원청 1차 확인(또는 업체 미배정) 구간의 길이 (통신사에 넘긴 건만), office = 지금 교육지원청 · 교육청이 직접 처리.
     */
    record Item(AsRequest r, Step receive, Step visit, Step recover, List<Prior> prior, Long triageMin, boolean office) {
        Item(AsRequest r, Step receive, Step visit, Step recover) { this(r, receive, visit, recover, List.of(), null, false); }
        boolean priorMissed() { return prior.stream().anyMatch(Prior::missed); }
        boolean missed() { return receive.missed() || visit.missed() || recover.missed() || priorMissed(); }
        /** 현장 도착을 기록하지 않고 끝낸 건은 도착을 판정하지 않는다 (나머지로 충족 여부를 본다) */
        boolean met() { return receive.met() && (visit.met() || visit.noRecord()) && recover.met() && !priorMissed(); }
        boolean pending() { return !missed() && !met(); }
    }

    /** SLA 접수 · 현장 도착을 재기 시작하는 때: 지금 담당이 넘겨받은 시각 (없으면 신청 시각) */
    public static LocalDateTime clockStart(AsRequest r) { return r.handoverAt != null ? r.handoverAt : r.requestAt; }

    /** 이 단계에서 뺄 보류 시간: 지금 담당이 넘겨받기 전에 한 보류는 빼지 않는다 (그 시간은 이미 시계 밖) */
    static long paused(AsRequest r, LocalDateTime start, LocalDateTime stageDone, LocalDateTime now, boolean biz) {
        if (r.firstHoldAt != null && start != null && r.firstHoldAt.isBefore(start) && r.holdAt == null) return 0;
        return r.pausedFor(stageDone, now, biz);
    }

    /** 장애 시작: 실제 발생 시각(입력했으면) → 신청 시각 */
    public static LocalDateTime outageFrom(AsRequest r) { return r.outageStartAt != null ? r.outageStartAt : r.requestAt; }

    /** 장애 끝: 실제 복구 시각(입력했으면) → 처리완료 시각 → (진행 중이면) 지금 */
    public static LocalDateTime outageTo(AsRequest r, LocalDateTime now) {
        if (r.outageEndAt != null) return r.outageEndAt;
        if ("C".equals(r.status)) return r.completedAt != null ? r.completedAt : r.visitEndAt != null ? r.visitEndAt : now;
        return now;
    }

    /** 복구 기준 (분): 장애유형 71 전체면 전체 기준, 아니면 일부 기준 */
    public static int recoverTarget(AsRequest r, SlaTarget t) { return FULL_OUTAGE.equals(r.faultTypeCode) ? t.recoverFullMin : t.recoverPartialMin; }

    /**
     * 처리 중인 스쿨넷 건의 가장 가까운 SLA 기한 (목록 · 상세 · 할 일 · 장비 QR의 남은 시간). 아직 안 끝난 단계 중 기한이 가장 이른 것.
     * {stage RECEIVE|VISIT|RECOVER, label, dueAt, remainingMin(넘으면 음수), targetMin}. 스쿨넷 · 처리 중이 아니면 null.
     */
    public static Json due(AsRequest r, SlaTarget t, LocalDateTime now) { return due(r, t, null, now); }

    /** cal = 근무 시간 단계가 있을 때의 달력 ({@link #calendarFor}). 근무 시간 단계의 남은 시간은 근무 시간(분)이다. */
    public static Json due(AsRequest r, SlaTarget t, WorkCalendar cal, LocalDateTime now) {
        // 보류 중에는 기한이 멈춘다 (화면은 보류 표시만)
        if (!"S".equals(r.rceptTy) || !"Y".equals(r.useYn) || !("A".equals(r.status) || "R".equals(r.status)) || r.requestAt == null || r.onHold()) return null;
        Object[] best = null;
        // 접수 · 도착은 지금 담당이 넘겨받은 때부터 (교육지원청 1차 확인 · 전 담당의 시간은 빼고)
        LocalDateTime start = clockStart(r);
        if (r.receivedAt == null) best = pick(best, "RECEIVE", "접수", dueOf(r, t, cal, "RECEIVE", start, t.receiveMin, now), t.receiveMin);
        if (r.visitAt == null) best = pick(best, "VISIT", "도착", dueOf(r, t, cal, "VISIT", start, t.visitMin, now), t.visitMin);
        int rt = recoverTarget(r, t);
        best = pick(best, "RECOVER", "복구", dueOf(r, t, cal, "RECOVER", outageFrom(r), rt, now), rt);
        String stage = (String) best[0];
        LocalDateTime dueAt = (LocalDateTime) best[2];
        return Json.obj().with("stage", stage).with("label", best[1]).with("dueAt", dueAt)
                .with("remainingMin", remaining(t, cal, stage, now, dueAt)).with("targetMin", best[3])
                .with("biz", biz(t, stage) && cal != null ? Boolean.TRUE : null);
    }

    /** 한 단계의 기한: 시작 + 기준 + (그 단계 단위의) 보류 시간 */
    public static LocalDateTime dueOf(AsRequest r, SlaTarget t, WorkCalendar cal, String stage, LocalDateTime from, int target, LocalDateTime now) {
        boolean b = biz(t, stage) && cal != null;
        return plus(t, cal, stage, from, target + ("RECOVER".equals(stage) ? r.pausedFor(null, now, b) : paused(r, from, null, now, b)));
    }

    private static Object[] pick(Object[] cur, String stage, String label, LocalDateTime dueAt, int target) {
        return cur == null || dueAt.isBefore((LocalDateTime) cur[2]) ? new Object[]{stage, label, dueAt, target} : cur;
    }

    static Item judge(AsRequest r, SlaTarget t, LocalDateTime now) { return judge(r, t, null, now, List.of()); }

    static Item judge(AsRequest r, SlaTarget t, WorkCalendar cal, LocalDateTime now) { return judge(r, t, cal, now, List.of()); }

    /** 현장 도착을 실제로 기록한 건인가 (예정 시각으로 채운 값 · 이전 자료는 아니다) */
    static boolean visitRecorded(AsRequest r) { return r.visitAt != null && Boolean.TRUE.equals(r.visitRecorded); }

    /** segs = 이 건의 담당 구간 (시작 순). 없으면 담당이 한 번도 바뀌지 않은 건. */
    static Item judge(AsRequest r, SlaTarget t, WorkCalendar cal, LocalDateTime now, List<AsHandover> segs) {
        boolean done = "C".equals(r.status);
        LocalDateTime completed = done ? (r.completedAt != null ? r.completedAt : r.visitEndAt) : null;
        LocalDateTime start = clockStart(r);
        // 현장 도착: 실제로 기록한 도착만 쓴다. 기록한 도착이 처리완료보다 늦으면 처리완료 시각으로 본다 — 끝낸 뒤에 도착할 수는 없다.
        LocalDateTime visit = visitRecorded(r) ? r.visitAt : null;
        if (visit != null && completed != null && visit.isAfter(completed)) visit = completed;
        // 접수 · 도착은 지금 담당이 넘겨받은 때부터, 복구는 실제 장애 발생부터 실제 복구까지 (입력했으면)
        LocalDateTime recovered = done ? (r.outageEndAt != null ? r.outageEndAt : completed) : null;
        LocalDateTime received = r.receivedAt != null ? r.receivedAt : completed;
        // 보류한 시간은 그 뒤에 끝난 단계에서 뺀다 (보류 중인 단계는 멈춘 채로 진행 중). 근무 시간 단계는 근무 시간(분)으로 뺀다
        boolean rb = biz(t, "RECEIVE") && cal != null, vb = biz(t, "VISIT") && cal != null, cb = biz(t, "RECOVER") && cal != null;
        Step receive = step(t, cal, "RECEIVE", start, received, t.receiveMin, now, paused(r, start, received, now, rb));
        Step visitStep = done && visit == null
                ? new Step("NO_RECORD", null, t.visitMin, true)   // 도착 기록 없이 처리완료: 판정하지 않는다
                : step(t, cal, "VISIT", start, visit, t.visitMin, now, paused(r, start, visit, now, vb));
        Step recover = step(t, cal, "RECOVER", outageFrom(r), recovered, recoverTarget(r, t), now, r.pausedFor(recovered, now, cb));

        // 넘기기 전 통신사 구간: 그 업체가 자기 구간 안에서 접수했는가 (접수 없이 넘겼으면 넘긴 때까지 흐른 시간)
        List<Prior> prior = new ArrayList<>();
        Long triage = null;
        for (int i = 0; i < segs.size(); i++) {
            AsHandover h = segs.get(i);
            if (h.endAt == null) continue;
            if (h.vendorSegment()) {
                LocalDateTime end = h.receivedAt != null && h.receivedAt.isBefore(h.endAt) ? h.receivedAt : h.endAt;
                long m = span(t, cal, "RECEIVE", h.startAt, end);
                prior.add(new Prior(h.vendorId, m, t.receiveMin, h.receivedAt != null, m > t.receiveMin));
            } else if (i == 0) {
                // 첫 구간이 교육지원청 · 교육청(또는 업체 미배정)이면 1차 확인 시간 (24시간 기준)
                triage = Duration.between(h.startAt, h.endAt).toMinutes();
            }
        }
        boolean office = "REGION".equals(r.handlerType) || "PROVINCE".equals(r.handlerType);
        return new Item(r, receive, visitStep, recover, prior, office ? null : triage, office);
    }

    // ---------- 현황 ----------

    private List<AsRequest> load(CurrentUser me, LocalDateTime from, LocalDateTime to, Long regionId) {
        if (!permissions.asTypes(me.orgId()).contains("S")) return List.of();
        Map<Long, School> sm = schoolService.schoolMap(me.orgId());
        var sc = me.scope();
        Set<Long> inScope = sc.vendor() ? null : schoolService.scopeSchoolIds(me);
        return requests.findByOrgIdAndUseYnAndRequestAtGreaterThanEqualAndRequestAtLessThan(me.orgId(), "Y", from, to).stream()
                .filter(r -> "S".equals(r.rceptTy) && !"X".equals(r.status) && r.requestAt != null)
                .filter(r -> inScope == null || inScope.contains(r.schoolId))
                .filter(r -> !sc.vendor() || (sc.vendorId() != null && sc.vendorId().equals(r.vendorId)))
                .filter(r -> regionId == null || (r.schoolId != null && sm.get(r.schoolId) != null && regionId.equals(sm.get(r.schoolId).regionId)))
                .toList();
    }

    public record Period(int year, int month) {
        LocalDateTime start() { return LocalDate.of(year, month, 1).atStartOfDay(); }
        LocalDateTime end() { return start().plusMonths(1); }
    }

    public static Period period(Integer year, Integer month) {
        LocalDate today = Times.today();
        int y = year == null ? today.getYear() : year, m = month == null ? today.getMonthValue() : month;
        if (y < 2000 || y > 2100 || m < 1 || m > 12) throw ApiException.badRequest("조회할 연월이 올바르지 않습니다.");
        return new Period(y, m);
    }

    public Json dashboard(CurrentUser me, Integer year, Integer month, Long regionId) {
        Period p = period(year, month);
        SlaTarget t = target(me.orgId());
        WorkCalendar cal = calendarFor(t, () -> alerts.calendar(me.orgId()));
        LocalDateTime now = Times.now();
        AsRequestService.Ref ref = requestService.ref(me.orgId());
        // 그 달에 신청된 건 + 그 전에 신청돼 그 달까지 이어진 장애(가용률용)
        // 12개월(이번 달 포함)을 한 번에 읽고 담당 구간도 함께
        List<AsRequest> year12 = load(me, p.start().minusMonths(11), p.end(), regionId);
        Map<Long, List<AsHandover>> segs = segments(year12);
        java.util.function.Function<AsRequest, Item> judgeOf = r -> judge(r, t, cal, now, segs.getOrDefault(r.asvcSn, List.of()));
        List<AsRequest> monthRows = year12.stream().filter(r -> !r.requestAt.isBefore(p.start())).toList();
        List<Item> all = monthRows.stream().map(judgeOf).toList();
        // 통신사 SLA는 통신사(업체)가 맡은 건만. 교육지원청 · 교육청이 직접 처리한 건은 따로 보여 준다.
        List<Item> items = all.stream().filter(x -> !x.office()).toList();
        List<Item> officeItems = all.stream().filter(Item::office).toList();
        Period prev = new Period(p.start().minusMonths(1).getYear(), p.start().minusMonths(1).getMonthValue());
        List<Item> prevItems = year12.stream().filter(r -> !r.requestAt.isBefore(prev.start()) && r.requestAt.isBefore(prev.end()))
                .map(judgeOf).filter(x -> !x.office()).toList();

        Json summary = summary(items);
        summary.put("prevTotal", (long) prevItems.size());
        summary.put("prevMetRate", rate(prevItems));

        // 업체별 · 지역별 (통신사 건만). 넘기기 전 구간의 접수 위반은 그 업체 줄에 따로 센다.
        List<Json> byVendor = new ArrayList<>(group(items, r -> r.vendorId, id -> Optional.ofNullable(ref.vendors().get(id)).map(v -> v.vendorName).orElse("업체 미배정"), "vendorId", "vendorName"));
        Map<Long, Long> handoffMissed = new HashMap<>();
        for (Item x : all) for (Prior pr : x.prior()) if (pr.missed()) handoffMissed.merge(pr.vendorId(), 1L, Long::sum);
        for (Json j : byVendor) j.put("handoffMissed", handoffMissed.getOrDefault((Long) j.get("vendorId"), 0L));
        for (var e : handoffMissed.entrySet()) {
            if (byVendor.stream().anyMatch(j -> e.getKey().equals(j.get("vendorId")))) continue;
            Json j = summary(List.of());
            j.put("vendorId", e.getKey());
            j.put("vendorName", Optional.ofNullable(ref.vendors().get(e.getKey())).map(v -> v.vendorName).orElse("업체"));
            j.put("handoffMissed", e.getValue());
            byVendor.add(j);
        }
        List<Json> byRegion = group(items, r -> Optional.ofNullable(ref.schools().get(r.schoolId)).map(s -> s.regionId).orElse(null),
                id -> Optional.ofNullable(ref.regions().get(id)).map(x -> x.regionName).orElse("지역 미지정"), "regionId", "regionName");

        // 교육지원청 · 교육청: 직접 처리한 건 + 통신사에 넘기기 전 1차 확인 시간
        List<Long> triage = items.stream().map(Item::triageMin).filter(Objects::nonNull).toList();
        Json office = summary(officeItems);
        office.put("triageCount", (long) triage.size());
        office.put("triageAvgMin", triage.isEmpty() ? null : Math.round(triage.stream().mapToLong(Long::longValue).average().orElse(0)));
        office.put("triageMaxMin", triage.isEmpty() ? null : triage.stream().mapToLong(Long::longValue).max().orElse(0));

        // 회선별 가용률
        List<AsRequest> overlap = load(me, p.start().minusMonths(2), p.end(), regionId).stream()
                .filter(r -> r.deviceId != null).toList();
        Json lines = lines(me, p, t, now, overlap, ref, regionId);

        // 12개월 추이 (통신사 건)
        List<Json> trend = new ArrayList<>();
        for (int i = 11; i >= 0; i--) {
            LocalDateTime s = p.start().minusMonths(i), e = s.plusMonths(1);
            List<Item> l = year12.stream().filter(r -> !r.requestAt.isBefore(s) && r.requestAt.isBefore(e)).map(judgeOf).filter(x -> !x.office()).toList();
            trend.add(Json.obj().with("year", s.getYear()).with("month", s.getMonthValue()).with("total", (long) l.size())
                    .with("missed", l.stream().filter(Item::missed).count()).with("metRate", rate(l)));
        }

        List<Json> violations = items.stream().filter(Item::missed)
                .sorted(Comparator.comparing((Item x) -> x.r().requestAt).reversed())
                .map(x -> itemView(x, ref)).toList();

        return Json.obj().with("year", p.year()).with("month", p.month()).with("regionId", regionId)
                .with("targets", targetView(t, t.anyBiz() ? cal : alerts.calendar(me.orgId())))
                .with("canEdit", me.scope().province() && me.can("BOARD_ADMIN"))
                .with("summary", summary).with("byVendor", byVendor).with("byRegion", byRegion).with("office", office)
                .with("lines", lines.get("rows")).with("lineSummary", lines.get("summary"))
                .with("quality", quality(me, monthRows, all, ref, regionId))
                .with("flowWarnings", flowWarnings(me.orgId()))
                .with("trend", trend).with("violations", violations);
    }

    private static Json summary(List<Item> items) {
        long missed = items.stream().filter(Item::missed).count(), met = items.stream().filter(Item::met).count();
        return Json.obj().with("total", (long) items.size())
                .with("completed", items.stream().filter(x -> "C".equals(x.r().status)).count())
                .with("open", items.stream().filter(x -> !"C".equals(x.r().status)).count())
                .with("met", met).with("missed", missed).with("pending", items.size() - met - missed)
                .with("metRate", rate(items))
                .with("avgReceiveMin", avg(items, Item::receive)).with("avgVisitMin", avg(items, Item::visit)).with("avgRecoverMin", avg(items, Item::recover))
                .with("receiveMissed", items.stream().filter(x -> x.receive().missed()).count())
                .with("visitMissed", items.stream().filter(x -> x.visit().missed()).count())
                .with("recoverMissed", items.stream().filter(x -> x.recover().missed()).count());
    }

    /** 충족률(%): 충족 / (충족 + 위반). 판정할 건이 없으면 null. */
    static Double rate(List<Item> items) {
        long met = items.stream().filter(Item::met).count(), missed = items.stream().filter(Item::missed).count();
        return met + missed == 0 ? null : Math.round(met * 1000.0 / (met + missed)) / 10.0;
    }

    /** 끝난 단계만의 평균(분). */
    private static Long avg(List<Item> items, java.util.function.Function<Item, Step> f) {
        // 끝난 단계만 (진행 중인 건의 흐른 시간은 평균에 넣지 않는다)
        List<Long> done = items.stream().map(f).filter(s -> s.done() && s.minutes() != null).map(Step::minutes).toList();
        return done.isEmpty() ? null : Math.round(done.stream().mapToLong(Long::longValue).average().orElse(0));
    }

    private static List<Json> group(List<Item> items, java.util.function.Function<AsRequest, Long> key, java.util.function.Function<Long, String> name,
                                    String idKey, String nameKey) {
        Map<Long, List<Item>> m = new LinkedHashMap<>();
        for (Item x : items) m.computeIfAbsent(key.apply(x.r()), k -> new ArrayList<>()).add(x);
        return m.entrySet().stream().map(e -> {
            Json j = summary(e.getValue());
            j.put(idKey, e.getKey());
            j.put(nameKey, e.getKey() == null ? name.apply(null) : name.apply(e.getKey()));
            return j;
        }).sorted(Comparator.comparing((Json j) -> (Long) j.get("missed")).reversed().thenComparing(j -> -((Long) j.get("total")))).toList();
    }

    /**
     * 한 회선의 장애 구간들 → 그 달의 [장애 횟수, 장애 분]. 겹치거나 맞닿은 구간은 하나의 장애로 합친다.
     * 장애 분은 합친 구간을 그 달(monthStart ~ countEnd, 이번 달이면 지금까지) 안으로 잘라 더하고,
     * 장애 횟수는 그 달 안(monthStart ~ monthEnd)에 시작한 합친 장애만 센다 (지난달부터 이어진 장애는 시간만 더한다).
     */
    static long[] outage(List<LocalDateTime[]> spans, LocalDateTime monthStart, LocalDateTime monthEnd, LocalDateTime countEnd) {
        List<LocalDateTime[]> l = spans.stream().filter(s -> s[0] != null && s[1] != null && !s[1].isBefore(s[0]))
                .sorted(Comparator.comparing((LocalDateTime[] s) -> s[0])).toList();
        long count = 0, minutes = 0;
        LocalDateTime cs = null, ce = null;
        for (int i = 0; i <= l.size(); i++) {
            LocalDateTime[] s = i < l.size() ? l.get(i) : null;
            if (s != null && cs != null && !s[0].isAfter(ce)) {   // 겹침 → 늘린다
                if (s[1].isAfter(ce)) ce = s[1];
                continue;
            }
            if (cs != null) {                                         // 합친 구간 하나를 마감
                LocalDateTime a = cs.isBefore(monthStart) ? monthStart : cs, z = ce.isAfter(countEnd) ? countEnd : ce;
                if (z.isAfter(a)) minutes += Duration.between(a, z).toMinutes();
                if (!cs.isBefore(monthStart) && cs.isBefore(monthEnd)) count++;
            }
            if (s != null) { cs = s[0]; ce = s[1]; }
        }
        return new long[]{count, minutes};
    }

    /**
     * 데이터 점검: 가용률 · SLA가 정확하려면 채워야 할 것.
     * unlinked = 그 달 스쿨넷 장애 중 회선(대상 장비)이 지정되지 않은 건 (가용률에 안 들어간다),
     * noOutageTime = 그 달 처리완료 중 실제 장애 시각이 없는 건 (신청 · 처리완료 시각으로 계산됨),
     * lineNoCircuit = 회선번호 · 통신사가 빠진 스쿨넷 장비, lineNoVendor = 유지보수 업체가 없는 스쿨넷 장비.
     */
    private Json quality(CurrentUser me, List<AsRequest> monthRows, List<Item> judged, AsRequestService.Ref ref, Long regionId) {
        Set<Long> inScope = me.scope().vendor() ? null : schoolService.scopeSchoolIds(me);
        List<WirelessDevice> lines = devices.findByOrgIdAndRceptTyAndUseYnOrderBySchoolIdAscDeviceCodeAsc(me.orgId(), "S", "Y").stream()
                .filter(d -> inScope == null || inScope.contains(d.schoolId))
                .filter(d -> regionId == null || Optional.ofNullable(ref.schools().get(d.schoolId)).map(s -> regionId.equals(s.regionId)).orElse(false))
                .filter(d -> !me.scope().vendor() || Objects.equals(d.vendorId, me.scope().vendorId()))
                .toList();
        java.util.function.Function<AsRequest, Json> reqRow = r -> Json.obj().with("asvcSn", r.asvcSn).with("requestAt", r.requestAt).with("status", r.status)
                .with("schoolName", Optional.ofNullable(ref.schools().get(r.schoolId)).map(s -> s.schoolName).orElse(null))
                .with("symptom", r.symptom == null ? null : r.symptom.length() > 40 ? r.symptom.substring(0, 39) + "…" : r.symptom);
        java.util.function.Function<WirelessDevice, Json> lineRow = d -> Json.obj().with("deviceId", d.deviceId).with("deviceCode", d.deviceCode).with("deviceName", d.deviceName)
                .with("schoolName", Optional.ofNullable(ref.schools().get(d.schoolId)).map(s -> s.schoolName).orElse(null))
                .with("carrier", d.carrier).with("circuitId", d.circuitId);
        List<AsRequest> unlinked = monthRows.stream().filter(r -> r.deviceId == null).toList();
        List<AsRequest> noTime = monthRows.stream().filter(r -> "C".equals(r.status) && (r.outageStartAt == null || r.outageEndAt == null)).toList();
        List<WirelessDevice> noCircuit = lines.stream().filter(d -> d.circuitId == null || d.circuitId.isBlank() || d.carrier == null || d.carrier.isBlank()).toList();
        List<WirelessDevice> noVendor = lines.stream().filter(d -> d.vendorId == null).toList();
        // 현장 도착을 기록하지 않고 처리완료한 통신사 건 (legacy = 이 기능 전의 자료라 기록 여부를 모른다)
        List<AsRequest> noArrival = judged.stream().filter(x -> !x.office() && x.visit().noRecord()).map(Item::r).toList();
        long legacy = noArrival.stream().filter(r -> r.visitRecorded == null).count();
        return Json.obj()
                .with("unlinked", Json.obj().with("count", (long) unlinked.size()).with("rows", unlinked.stream().limit(20).map(reqRow).toList()))
                .with("noOutageTime", Json.obj().with("count", (long) noTime.size()).with("rows", noTime.stream().limit(20).map(reqRow).toList()))
                .with("lineNoCircuit", Json.obj().with("count", (long) noCircuit.size()).with("rows", noCircuit.stream().limit(20).map(lineRow).toList()))
                .with("lineNoVendor", Json.obj().with("count", (long) noVendor.size()).with("rows", noVendor.stream().limit(20).map(lineRow).toList()))
                .with("noArrival", Json.obj().with("count", (long) noArrival.size()).with("legacy", legacy)
                        .with("rows", noArrival.stream().limit(20).map(r -> reqRow.apply(r).with("legacy", r.visitRecorded == null)).toList()));
    }

    /** 회선(스쿨넷 장비)별 그 달의 장애 횟수 · 장애 시간 · 가용률. 장애가 없던 회선은 개수만 센다. */
    private Json lines(CurrentUser me, Period p, SlaTarget t, LocalDateTime now, List<AsRequest> overlap, AsRequestService.Ref ref, Long regionId) {
        Set<Long> inScope = me.scope().vendor() ? null : schoolService.scopeSchoolIds(me);
        List<WirelessDevice> all = devices.findByOrgIdAndRceptTyAndUseYnOrderBySchoolIdAscDeviceCodeAsc(me.orgId(), "S", "Y").stream()
                .filter(d -> inScope == null || inScope.contains(d.schoolId))
                .filter(d -> regionId == null || Optional.ofNullable(ref.schools().get(d.schoolId)).map(s -> regionId.equals(s.regionId)).orElse(false))
                .toList();
        Map<Long, WirelessDevice> byId = all.stream().collect(Collectors.toMap(d -> d.deviceId, d -> d));
        LocalDateTime ms = p.start(), me2 = p.end().isAfter(now) ? now : p.end();
        long monthMin = Duration.between(p.start(), p.end()).toMinutes();
        // 회선마다 장애 구간(신청 → 처리완료, 진행 중이면 지금)을 모은 뒤, 겹치는 구간은 하나로 합친다.
        // 같은 장애를 여러 건 신고해도 장애 시간 · 횟수를 두 번 세지 않는다.
        Map<Long, List<LocalDateTime[]>> spans = new LinkedHashMap<>();
        for (AsRequest r : overlap) {
            if (!byId.containsKey(r.deviceId)) continue;
            LocalDateTime to = outageTo(r, now);
            if (to == null) to = now;
            spans.computeIfAbsent(r.deviceId, k -> new ArrayList<>()).add(new LocalDateTime[]{outageFrom(r), to});
        }
        Map<Long, long[]> agg = new LinkedHashMap<>();  // deviceId → [장애 횟수, 장애 분]
        for (var e : spans.entrySet()) {
            long[] v = outage(e.getValue(), ms, p.end(), me2);
            if (v[0] > 0 || v[1] > 0) agg.put(e.getKey(), v);
        }
        List<Json> rows = agg.entrySet().stream().map(e -> {
            WirelessDevice d = byId.get(e.getKey());
            School s = ref.schools().get(d.schoolId);
            Region rg = s == null || s.regionId == null ? null : ref.regions().get(s.regionId);
            double avail = Math.round((1 - Math.min(e.getValue()[1], monthMin) / (double) monthMin) * 100000) / 1000.0;
            return Json.obj().with("deviceId", d.deviceId).with("deviceCode", d.deviceCode).with("deviceName", d.deviceName)
                    .with("circuitId", d.circuitId).with("carrier", d.carrier).with("bandwidth", d.bandwidth)
                    .with("schoolId", d.schoolId).with("schoolName", s == null ? null : s.schoolName).with("regionName", rg == null ? null : rg.regionName)
                    .with("failures", e.getValue()[0]).with("downtimeMin", e.getValue()[1]).with("availability", avail)
                    .with("belowTarget", avail < t.availabilityPct);
        }).sorted(Comparator.comparing((Json j) -> -((Long) j.get("downtimeMin")))).toList();
        Json summary = Json.obj().with("lineCount", (long) all.size()).with("failedLines", (long) rows.size())
                .with("belowTarget", rows.stream().filter(j -> Boolean.TRUE.equals(j.get("belowTarget"))).count())
                .with("totalDowntimeMin", rows.stream().mapToLong(j -> (Long) j.get("downtimeMin")).sum());
        return Json.obj().with("rows", rows).with("summary", summary);
    }

    private static Json stepView(Step s) {
        return Json.obj().with("state", s.state()).with("minutes", s.minutes()).with("target", s.target()).with("done", s.done());
    }

    private static Json itemView(Item x, AsRequestService.Ref ref) {
        AsRequest r = x.r();
        School s = r.schoolId == null ? null : ref.schools().get(r.schoolId);
        Region rg = s == null || s.regionId == null ? null : ref.regions().get(s.regionId);
        Vendor v = r.vendorId == null ? null : ref.vendors().get(r.vendorId);
        List<String> missed = new ArrayList<>();
        if (x.receive().missed()) missed.add("접수");
        if (x.visit().missed()) missed.add("현장 도착");
        if (x.recover().missed()) missed.add("복구");
        if (x.priorMissed()) missed.add("넘기기 전 접수");
        List<Json> prior = x.prior().stream().map(pr -> Json.obj().with("vendorName", Optional.ofNullable(ref.vendors().get(pr.vendorId())).map(z -> z.vendorName).orElse("업체"))
                .with("minutes", pr.minutes()).with("target", pr.target()).with("received", pr.received()).with("missed", pr.missed())).toList();
        return Json.obj().with("asvcSn", r.asvcSn).with("schoolName", s == null ? null : s.schoolName).with("regionName", rg == null ? null : rg.regionName)
                .with("vendorName", v == null ? "미배정" : v.vendorName)
                .with("faultTypeName", AsCodes.FAULT_TYPES.get("S").getOrDefault(r.faultTypeCode, r.faultTypeCode))
                .with("fullOutage", FULL_OUTAGE.equals(r.faultTypeCode))
                .with("requestAt", r.requestAt).with("status", r.status).with("statusName", AsCodes.STATUS_NAME.get(r.status))
                .with("receive", stepView(x.receive())).with("visit", stepView(x.visit()).with("legacy", x.visit().noRecord() && r.visitRecorded == null ? Boolean.TRUE : null))
                .with("recover", stepView(x.recover()))
                .with("handoverAt", r.handoverAt).with("prior", prior).with("missed", missed);
    }

    // ---------- 엑셀 보고서 ----------

    /** 월간 SLA 보고서용 행: 요약 · 업체별 · 지역별 · 회선별 · 위반 내역. */
    public Map<String, List<Map<String, Object>>> report(CurrentUser me, Integer year, Integer month, Long regionId) {
        Json d = dashboard(me, year, month, regionId);
        Json s = (Json) d.get("summary");
        Json ls = (Json) d.get("lineSummary");
        Json t = (Json) d.get("targets");
        List<Map<String, Object>> sum = new ArrayList<>();
        java.util.function.BiConsumer<String, Object> add = (k, v) -> sum.add(Json.obj().with("item", k).with("value", v == null ? "-" : v));
        add.accept("기간", d.get("year") + "년 " + d.get("month") + "월");
        java.util.function.Function<String, String> how = k -> Boolean.TRUE.equals(t.get(k)) ? " (근무 시간)" : " (24시간)";
        add.accept("기준: 접수", dur((Integer) t.get("receiveMin")) + how.apply("receiveBiz"));
        add.accept("기준: 현장 도착", dur((Integer) t.get("visitMin")) + how.apply("visitBiz"));
        add.accept("기준: 복구(전체 장애)", dur((Integer) t.get("recoverFullMin")) + how.apply("recoverBiz"));
        add.accept("기준: 복구(일부 · 기타)", dur((Integer) t.get("recoverPartialMin")) + how.apply("recoverBiz"));
        if (t.get("calendar") != null) add.accept("근무 시간 달력", t.get("calendar"));
        add.accept("기준: 회선 가용률", t.get("availabilityPct") + "%");
        add.accept("장애 건수", s.get("total"));
        add.accept("처리완료 / 진행 중", s.get("completed") + " / " + s.get("open"));
        add.accept("SLA 충족률(%)", s.get("metRate"));
        add.accept("위반 건수 (접수 · 도착 · 복구)", s.get("missed") + " (" + s.get("receiveMissed") + " · " + s.get("visitMissed") + " · " + s.get("recoverMissed") + ")");
        add.accept("평균 접수", dur(s.get("avgReceiveMin")));
        add.accept("평균 현장 도착", dur(s.get("avgVisitMin")));
        add.accept("평균 복구", dur(s.get("avgRecoverMin")));
        add.accept("회선 수 / 장애 회선 / 가용률 미달", ls.get("lineCount") + " / " + ls.get("failedLines") + " / " + ls.get("belowTarget"));
        Json of = (Json) d.get("office");
        add.accept("교육지원청 · 교육청 직접 처리 (통신사 SLA 제외)", of.get("total") + "건");
        add.accept("1차 확인 (통신사에 넘기기 전) 평균 / 최대", of.get("triageAvgMin") == null ? "-" : dur(of.get("triageAvgMin")) + " / " + dur(of.get("triageMaxMin")) + " (" + of.get("triageCount") + "건)");
        @SuppressWarnings("unchecked") Json qa = (Json) ((Json) d.get("quality")).get("noArrival");
        add.accept("현장 도착 기록 없음 (도착 판정 제외)", qa.get("count") + "건");
        Map<String, List<Map<String, Object>>> out = new LinkedHashMap<>();
        out.put("요약", sum);
        out.put("업체별", groupRows(d.get("byVendor"), "vendorName"));
        out.put("지역별", groupRows(d.get("byRegion"), "regionName"));
        @SuppressWarnings("unchecked") List<Json> lines = (List<Json>) d.get("lines");
        out.put("회선별", lines.stream().map(j -> (Map<String, Object>) Json.obj().with("school", j.get("schoolName")).with("region", j.get("regionName"))
                .with("code", j.get("deviceCode")).with("circuit", j.get("circuitId")).with("carrier", j.get("carrier")).with("bandwidth", j.get("bandwidth"))
                .with("failures", j.get("failures")).with("downtime", dur(j.get("downtimeMin"))).with("availability", j.get("availability"))
                .with("below", Boolean.TRUE.equals(j.get("belowTarget")) ? "미달" : "충족")).toList());
        @SuppressWarnings("unchecked") List<Json> vs = (List<Json>) d.get("violations");
        out.put("위반 내역", vs.stream().map(j -> (Map<String, Object>) Json.obj().with("sn", "AS-" + j.get("asvcSn")).with("school", j.get("schoolName"))
                .with("region", j.get("regionName")).with("vendor", j.get("vendorName")).with("fault", j.get("faultTypeName"))
                .with("requestAt", j.get("requestAt")).with("status", j.get("statusName"))
                .with("receive", stepText((Json) j.get("receive"))).with("visit", stepText((Json) j.get("visit"))).with("recover", stepText((Json) j.get("recover")))
                .with("missed", String.join(", ", (List<String>) j.get("missed")))).toList());
        return out;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> groupRows(Object list, String nameKey) {
        return ((List<Json>) list).stream().map(j -> (Map<String, Object>) Json.obj().with("name", j.get(nameKey)).with("total", j.get("total"))
                .with("met", j.get("met")).with("missed", j.get("missed")).with("pending", j.get("pending")).with("metRate", j.get("metRate"))
                .with("receive", dur(j.get("avgReceiveMin"))).with("visit", dur(j.get("avgVisitMin"))).with("recover", dur(j.get("avgRecoverMin")))).toList();
    }

    private static String stepText(Json s) {
        String state = switch (String.valueOf(s.get("state"))) { case "MET" -> "충족"; case "MISSED" -> "위반"; default -> "진행 중"; };
        return (s.get("minutes") == null ? "-" : dur(s.get("minutes"))) + " / 기준 " + dur(s.get("target")) + " (" + state + ")";
    }

    /** 분 → "2시간 15분" / "1일 3시간". */
    static String dur(Object v) {
        if (v == null) return "-";
        long m = ((Number) v).longValue();
        if (m < 60) return m + "분";
        if (m < 1440) return (m / 60) + "시간" + (m % 60 == 0 ? "" : " " + (m % 60) + "분");
        return (m / 1440) + "일" + ((m % 1440) / 60 == 0 ? "" : " " + (m % 1440) / 60 + "시간");
    }
}
