package com.bingoasm.service.as;

import com.bingoasm.auth.CurrentUser;
import com.bingoasm.common.*;
import com.bingoasm.domain.as.*;
import com.bingoasm.repo.as.AsCostItemRepository;
import com.bingoasm.repo.as.AsRequestRepository;
import java.time.Duration;
import java.time.LocalDate;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** AS통계관리: AS비용 통계, AS건수 통계, 만족도 관리. 교육청 관리자는 전체, 업체 관리자는 소속 업체 건만. */
@Service
@Transactional(readOnly = true)
public class AsStatsService {
    private final AsRequestRepository requests;
    private final AsRequestService requestService;
    private final SchoolService schoolService;
    private final AsCostItemRepository costItems;

    public AsStatsService(AsRequestRepository requests, AsRequestService requestService, SchoolService schoolService, AsCostItemRepository costItems) {
        this.requests = requests; this.requestService = requestService; this.schoolService = schoolService; this.costItems = costItems;
    }

    private List<AsRequest> base(CurrentUser me, int year, String rceptTy, Long regionId) {
        Map<Long, School> sm = schoolService.schoolMap(me.orgId());
        Set<Long> inScope = schoolService.scopeSchoolIds(me);  // 교육지원청 담당자는 관내 학교만 집계
        com.bingoasm.auth.Scope sc = me.scope();
        return requests.findByOrgIdAndUseYnAndRequestAtGreaterThanEqualAndRequestAtLessThan(me.orgId(), "Y",
                        LocalDate.of(year, 1, 1).atStartOfDay(), LocalDate.of(year + 1, 1, 1).atStartOfDay()).stream()
                .filter(r -> inScope == null || inScope.contains(r.schoolId))
                .filter(r -> !sc.vendor() || (sc.vendorId() != null && sc.vendorId().equals(r.vendorId)))
                .filter(r -> Params.blank(rceptTy) || rceptTy.equals(r.rceptTy))
                .filter(r -> regionId == null || (r.schoolId != null && sm.get(r.schoolId) != null && regionId.equals(sm.get(r.schoolId).regionId)))
                .toList();
    }

    private static boolean done(AsRequest r) { return "C".equals(r.status) && r.completedAt != null; }
    private static long cost(List<AsRequest> l) { return l.stream().filter(r -> r.processAmount != null).mapToLong(r -> r.processAmount).sum(); }
    /** 유상(별도 청구) 비용만. */
    private static long paidCost(List<AsRequest> l) { return cost(l.stream().filter(r -> "PAID".equals(r.chargeType)).toList()); }
    private static Double avgDays(List<AsRequest> l) {
        List<AsRequest> d = l.stream().filter(AsStatsService::done).toList();
        return d.isEmpty() ? null : Math.round(d.stream().mapToDouble(r -> Duration.between(r.requestAt, r.completedAt).toMinutes() / 1440.0).average().orElse(0) * 10) / 10.0;
    }
    private static Double avgScore(List<AsRequest> l) {
        List<AsRequest> s = l.stream().filter(r -> r.evalScore != null).toList();
        return s.isEmpty() ? null : Math.round(s.stream().mapToInt(r -> r.evalScore).average().orElse(0) * 100) / 100.0;
    }

    /** 월별 건수·비용·완료·평균 처리일 + 유형별·지역별·업체별. */
    public Json monthly(CurrentUser me, Integer yearParam, String rceptTy, Long regionId) {
        int year = yearParam == null ? Times.today().getYear() : yearParam;
        List<AsRequest> list = base(me, year, rceptTy, regionId);
        AsRequestService.Ref ref = requestService.ref(me.orgId());
        List<Json> rows = new ArrayList<>();
        int maxMonth = year == Times.today().getYear() ? Times.today().getMonthValue() : 12;
        for (int m = 1; m <= maxMonth; m++) {
            final int mm = m;
            List<AsRequest> l = list.stream().filter(r -> r.requestAt.getMonthValue() == mm).toList();
            rows.add(Json.obj().with("month", m).with("count", (long) l.size()).with("done", l.stream().filter(AsStatsService::done).count())
                    .with("returned", l.stream().filter(r -> "X".equals(r.status)).count()).with("cost", cost(l)).with("paidCost", paidCost(l)).with("avgDays", avgDays(l)));
        }
        List<Json> byType = AsCodes.RCEPT_TYPES.stream().map(ty -> {
            List<AsRequest> l = list.stream().filter(r -> ty.equals(r.rceptTy)).toList();
            return Json.obj().with("rceptTy", ty).with("name", AsCodes.RCEPT_TY_NAME.get(ty)).with("count", (long) l.size())
                    .with("done", l.stream().filter(AsStatsService::done).count()).with("cost", cost(l)).with("paidCost", paidCost(l)).with("avgDays", avgDays(l)).with("avgScore", avgScore(l));
        }).toList();
        Map<Long, List<AsRequest>> byRegionMap = list.stream().filter(r -> r.schoolId != null && ref.schools().get(r.schoolId) != null && ref.schools().get(r.schoolId).regionId != null)
                .collect(Collectors.groupingBy(r -> ref.schools().get(r.schoolId).regionId));
        List<Json> byRegion = ref.regions().values().stream().sorted(Comparator.comparing(r -> r.sortOrder == null ? 0 : r.sortOrder)).map(reg -> {
            List<AsRequest> l = byRegionMap.getOrDefault(reg.regionId, List.of());
            return Json.obj().with("regionId", reg.regionId).with("regionName", reg.regionName).with("count", (long) l.size())
                    .with("done", l.stream().filter(AsStatsService::done).count()).with("cost", cost(l)).with("paidCost", paidCost(l)).with("avgDays", avgDays(l));
        }).toList();
        Map<Long, List<AsRequest>> byVendorMap = list.stream().filter(r -> r.vendorId != null).collect(Collectors.groupingBy(r -> r.vendorId));
        List<Json> byVendor = byVendorMap.entrySet().stream().map(e -> {
            Vendor v = ref.vendors().get(e.getKey());
            return Json.obj().with("vendorId", e.getKey()).with("vendorName", v == null ? "(삭제된 업체)" : v.vendorName).with("count", (long) e.getValue().size())
                    .with("done", e.getValue().stream().filter(AsStatsService::done).count()).with("cost", cost(e.getValue())).with("paidCost", paidCost(e.getValue()))
                    .with("avgDays", avgDays(e.getValue())).with("avgScore", avgScore(e.getValue()));
        }).sorted((a, b) -> Long.compare((Long) b.get("count"), (Long) a.get("count"))).toList();
        // 비용 항목별 합계 (보고서에 항목을 적은 건만). 예전 보고서의 단일 금액은 "항목 없음"으로 따로 센다.
        Map<Long, AsRequest> byId = list.stream().collect(Collectors.toMap(r -> r.asvcSn, Function.identity()));
        List<AsCostItem> items = byId.isEmpty() ? List.of() : costItems.findByAsvcSnIn(byId.keySet());
        Set<Long> itemized = items.stream().map(c -> c.asvcSn).collect(Collectors.toSet());
        List<Json> byCostType = new ArrayList<>(AsCodes.COST_TYPE_NAME.entrySet().stream().map(e -> {
            List<AsCostItem> l = items.stream().filter(c -> e.getKey().equals(c.costType)).toList();
            long paid = l.stream().filter(c -> "PAID".equals(byId.get(c.asvcSn).chargeType)).mapToLong(c -> c.amount).sum();
            return Json.obj().with("costType", e.getKey()).with("name", e.getValue()).with("lines", (long) l.size())
                    .with("amount", l.stream().mapToLong(c -> c.amount).sum()).with("paidAmount", paid);
        }).toList());
        List<AsRequest> lump = list.stream().filter(r -> r.processAmount != null && r.processAmount > 0 && !itemized.contains(r.asvcSn)).toList();
        if (!lump.isEmpty()) byCostType.add(Json.obj().with("costType", "NONE").with("name", "항목 없음").with("lines", (long) lump.size())
                .with("amount", cost(lump)).with("paidAmount", paidCost(lump)));
        List<AsRequest> paid = list.stream().filter(r -> "PAID".equals(r.chargeType)).toList();
        List<AsRequest> free = list.stream().filter(r -> "FREE".equals(r.chargeType)).toList();
        return Json.obj().with("year", year).with("rceptTy", rceptTy).with("regionId", regionId)
                .with("total", Json.obj().with("count", (long) list.size()).with("done", list.stream().filter(AsStatsService::done).count())
                        .with("cost", cost(list)).with("paidCost", cost(paid)).with("freeCost", cost(free))
                        .with("paidCount", (long) paid.size()).with("freeCount", (long) free.size())
                        .with("avgDays", avgDays(list)).with("avgScore", avgScore(list)))
                .with("byCostType", byCostType)
                .with("months", rows).with("byType", byType).with("byRegion", byRegion).with("byVendor", byVendor);
    }

    /** 만족도 관리: 분포·업체별·기사별 평균, 평가 목록. */
    public Json satisfaction(CurrentUser me, Integer yearParam, String rceptTy, Long regionId, Integer page, Integer size) {
        int year = yearParam == null ? Times.today().getYear() : yearParam;
        List<AsRequest> list = base(me, year, rceptTy, regionId);
        List<AsRequest> done = list.stream().filter(r -> "C".equals(r.status)).toList();
        List<AsRequest> ev = done.stream().filter(r -> r.evalScore != null).sorted(Comparator.comparing((AsRequest r) -> r.evaluatedAt).reversed()).toList();
        AsRequestService.Ref ref = requestService.ref(me.orgId());
        Map<Integer, Long> dist = new TreeMap<>();
        for (int i = 1; i <= 5; i++) { final int s = i; dist.put(i, ev.stream().filter(r -> r.evalScore == s).count()); }
        Function<Map.Entry<Long, List<AsRequest>>, Json> vendorRow = e -> {
            Vendor v = ref.vendors().get(e.getKey());
            return Json.obj().with("vendorId", e.getKey()).with("vendorName", v == null ? "(삭제된 업체)" : v.vendorName)
                    .with("count", (long) e.getValue().size()).with("avgScore", avgScore(e.getValue()));
        };
        List<Json> byVendor = ev.stream().filter(r -> r.vendorId != null).collect(Collectors.groupingBy(r -> r.vendorId)).entrySet().stream().map(vendorRow).toList();
        List<Json> byEngineer = ev.stream().filter(r -> r.engineerUserId != null).collect(Collectors.groupingBy(r -> r.engineerUserId)).entrySet().stream().map(e -> {
            var u = ref.users().get(e.getKey());
            Vendor v = u == null || u.vendorId == null ? null : ref.vendors().get(u.vendorId);
            return Json.obj().with("engineerUserId", e.getKey()).with("engineerName", u == null ? "-" : u.userName).with("vendorName", v == null ? null : v.vendorName)
                    .with("count", (long) e.getValue().size()).with("avgScore", avgScore(e.getValue()));
        }).toList();
        List<Json> rows = ev.stream().map(r -> {
            Json j = requestService.row(r, ref);
            return Json.obj().with("asvcSn", r.asvcSn).with("rceptTy", r.rceptTy).with("rceptTyName", j.get("rceptTyName")).with("schoolName", j.get("schoolName"))
                    .with("regionName", j.get("regionName")).with("vendorName", j.get("vendorName")).with("engineerName", j.get("engineerName"))
                    .with("evalScore", r.evalScore).with("evalOpinion", r.evalOpinion).with("evaluatedAt", r.evaluatedAt).with("completedAt", r.completedAt);
        }).toList();
        return Json.obj().with("year", year)
                .with("summary", Json.obj().with("completed", (long) done.size()).with("evaluated", (long) ev.size())
                        .with("responseRate", done.isEmpty() ? 0 : Math.round(ev.size() * 1000.0 / done.size()) / 10.0)
                        .with("avgScore", avgScore(ev)).with("distribution", dist))
                .with("byVendor", byVendor).with("byEngineer", byEngineer).with("list", PageResult.of(rows, page, size));
    }
}
