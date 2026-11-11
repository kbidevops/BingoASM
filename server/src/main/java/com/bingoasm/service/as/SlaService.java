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

    public SlaService(AsRequestRepository requests, WirelessDeviceRepository devices, SlaTargetRepository targets, SchoolService schoolService,
                      AsRequestService requestService, PermissionService permissions) {
        this.requests = requests; this.devices = devices; this.targets = targets; this.schoolService = schoolService;
        this.requestService = requestService; this.permissions = permissions;
    }

    // ---------- 기준 ----------

    public SlaTarget target(Long orgId) {
        return targets.findById(orgId).orElseGet(() -> { SlaTarget t = new SlaTarget(); t.orgId = orgId; return t; });
    }

    static Json targetView(SlaTarget t) {
        return Json.obj().with("receiveMin", t.receiveMin).with("visitMin", t.visitMin).with("recoverFullMin", t.recoverFullMin)
                .with("recoverPartialMin", t.recoverPartialMin).with("availabilityPct", t.availabilityPct).with("updatedAt", t.updatedAt)
                .with("isDefault", t.updatedAt == null);
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
        t.updatedAt = Times.now();
        t.updatedBy = me.userId();
        targets.save(t);
        return targetView(t);
    }

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
    }

    static Step step(LocalDateTime from, LocalDateTime done, int target, LocalDateTime now) {
        if (from == null) return new Step("PENDING", null, target, false);
        if (done != null) {
            long m = Math.max(0, Duration.between(from, done).toMinutes());
            return new Step(m <= target ? "MET" : "MISSED", m, target, true);
        }
        long m = Math.max(0, Duration.between(from, now).toMinutes());
        return new Step(m <= target ? "PENDING" : "MISSED", m, target, false);
    }

    /** 한 AS의 판정. */
    record Item(AsRequest r, Step receive, Step visit, Step recover) {
        boolean missed() { return receive.missed() || visit.missed() || recover.missed(); }
        boolean met() { return receive.met() && visit.met() && recover.met(); }
        boolean pending() { return !missed() && !met(); }
    }

    static Item judge(AsRequest r, SlaTarget t, LocalDateTime now) {
        boolean done = "C".equals(r.status);
        LocalDateTime completed = done ? (r.completedAt != null ? r.completedAt : r.visitEndAt) : null;
        // 방문 기록 없이 처리완료된 건은 처리완료를 도착으로 본다. 보고서의 방문일시가 처리완료보다 늦으면
        // (방문 예정일이 그대로 들어간 경우) 처리완료 시각을 도착으로 본다 — 끝낸 뒤에 도착할 수는 없다.
        LocalDateTime visit = r.visitAt != null ? r.visitAt : completed;
        if (visit != null && completed != null && visit.isAfter(completed)) visit = completed;
        int recoverTarget = FULL_OUTAGE.equals(r.faultTypeCode) ? t.recoverFullMin : t.recoverPartialMin;
        return new Item(r, step(r.requestAt, r.receivedAt != null ? r.receivedAt : completed, t.receiveMin, now),
                step(r.requestAt, visit, t.visitMin, now), step(r.requestAt, completed, recoverTarget, now));
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
        LocalDateTime now = Times.now();
        AsRequestService.Ref ref = requestService.ref(me.orgId());
        // 그 달에 신청된 건 + 그 전에 신청돼 그 달까지 이어진 장애(가용률용)
        List<AsRequest> monthRows = load(me, p.start(), p.end(), regionId);
        List<Item> items = monthRows.stream().map(r -> judge(r, t, now)).toList();
        Period prev = new Period(p.start().minusMonths(1).getYear(), p.start().minusMonths(1).getMonthValue());
        List<Item> prevItems = load(me, prev.start(), prev.end(), regionId).stream().map(r -> judge(r, t, now)).toList();

        Json summary = summary(items);
        summary.put("prevTotal", (long) prevItems.size());
        summary.put("prevMetRate", rate(prevItems));

        // 업체별 · 지역별
        List<Json> byVendor = group(items, r -> r.vendorId, id -> Optional.ofNullable(ref.vendors().get(id)).map(v -> v.vendorName).orElse("미배정"), "vendorId", "vendorName");
        List<Json> byRegion = group(items, r -> Optional.ofNullable(ref.schools().get(r.schoolId)).map(s -> s.regionId).orElse(null),
                id -> Optional.ofNullable(ref.regions().get(id)).map(x -> x.regionName).orElse("지역 미지정"), "regionId", "regionName");

        // 회선별 가용률
        List<AsRequest> overlap = load(me, p.start().minusMonths(2), p.end(), regionId).stream()
                .filter(r -> r.deviceId != null).toList();
        Json lines = lines(me, p, t, now, overlap, ref, regionId);

        // 12개월 추이
        List<Json> trend = new ArrayList<>();
        List<AsRequest> year12 = load(me, p.start().minusMonths(11), p.end(), regionId);
        for (int i = 11; i >= 0; i--) {
            LocalDateTime s = p.start().minusMonths(i), e = s.plusMonths(1);
            List<Item> l = year12.stream().filter(r -> !r.requestAt.isBefore(s) && r.requestAt.isBefore(e)).map(r -> judge(r, t, now)).toList();
            trend.add(Json.obj().with("year", s.getYear()).with("month", s.getMonthValue()).with("total", (long) l.size())
                    .with("missed", l.stream().filter(Item::missed).count()).with("metRate", rate(l)));
        }

        List<Json> violations = items.stream().filter(Item::missed)
                .sorted(Comparator.comparing((Item x) -> x.r().requestAt).reversed())
                .map(x -> itemView(x, ref)).toList();

        return Json.obj().with("year", p.year()).with("month", p.month()).with("regionId", regionId)
                .with("targets", targetView(t))
                .with("canEdit", me.scope().province() && me.can("BOARD_ADMIN"))
                .with("summary", summary).with("byVendor", byVendor).with("byRegion", byRegion)
                .with("lines", lines.get("rows")).with("lineSummary", lines.get("summary"))
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
        Map<Long, long[]> agg = new LinkedHashMap<>();  // deviceId → [장애 횟수, 장애 분]
        for (AsRequest r : overlap) {
            if (!byId.containsKey(r.deviceId)) continue;
            LocalDateTime from = r.requestAt;
            LocalDateTime to = "C".equals(r.status) ? (r.completedAt != null ? r.completedAt : r.visitEndAt) : now;
            if (to == null) to = now;
            LocalDateTime a = from.isBefore(ms) ? ms : from, z = to.isAfter(me2) ? me2 : to;
            boolean inMonth = !r.requestAt.isBefore(ms) && r.requestAt.isBefore(p.end());
            long down = z.isAfter(a) ? Duration.between(a, z).toMinutes() : 0;
            if (!inMonth && down == 0) continue;
            long[] v = agg.computeIfAbsent(r.deviceId, k -> new long[2]);
            if (inMonth) v[0]++;
            v[1] += down;
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
        return Json.obj().with("asvcSn", r.asvcSn).with("schoolName", s == null ? null : s.schoolName).with("regionName", rg == null ? null : rg.regionName)
                .with("vendorName", v == null ? "미배정" : v.vendorName)
                .with("faultTypeName", AsCodes.FAULT_TYPES.get("S").getOrDefault(r.faultTypeCode, r.faultTypeCode))
                .with("fullOutage", FULL_OUTAGE.equals(r.faultTypeCode))
                .with("requestAt", r.requestAt).with("status", r.status).with("statusName", AsCodes.STATUS_NAME.get(r.status))
                .with("receive", stepView(x.receive())).with("visit", stepView(x.visit())).with("recover", stepView(x.recover()))
                .with("missed", missed);
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
        add.accept("기준: 접수", dur((Integer) t.get("receiveMin")));
        add.accept("기준: 현장 도착", dur((Integer) t.get("visitMin")));
        add.accept("기준: 복구(전체 장애)", dur((Integer) t.get("recoverFullMin")));
        add.accept("기준: 복구(일부 · 기타)", dur((Integer) t.get("recoverPartialMin")));
        add.accept("기준: 회선 가용률", t.get("availabilityPct") + "%");
        add.accept("장애 건수", s.get("total"));
        add.accept("처리완료 / 진행 중", s.get("completed") + " / " + s.get("open"));
        add.accept("SLA 충족률(%)", s.get("metRate"));
        add.accept("위반 건수 (접수 · 도착 · 복구)", s.get("missed") + " (" + s.get("receiveMissed") + " · " + s.get("visitMissed") + " · " + s.get("recoverMissed") + ")");
        add.accept("평균 접수", dur(s.get("avgReceiveMin")));
        add.accept("평균 현장 도착", dur(s.get("avgVisitMin")));
        add.accept("평균 복구", dur(s.get("avgRecoverMin")));
        add.accept("회선 수 / 장애 회선 / 가용률 미달", ls.get("lineCount") + " / " + ls.get("failedLines") + " / " + ls.get("belowTarget"));
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
