package com.bingoasm.service.as;

import com.bingoasm.auth.CurrentUser;
import com.bingoasm.common.*;
import com.bingoasm.domain.as.*;
import com.bingoasm.repo.AssetRepository;
import com.bingoasm.repo.as.AsCostItemRepository;
import com.bingoasm.repo.as.AsRequestRepository;
import com.bingoasm.repo.as.WirelessDeviceRepository;
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
    private final AsCostService costService;
    private final AssetRepository assets;
    private final WirelessDeviceRepository devices;
    private final com.bingoasm.auth.PermissionService permissions;

    public AsStatsService(AsRequestRepository requests, AsRequestService requestService, SchoolService schoolService, AsCostItemRepository costItems,
                          AsCostService costService, AssetRepository assets, WirelessDeviceRepository devices, com.bingoasm.auth.PermissionService permissions) {
        this.requests = requests; this.requestService = requestService; this.schoolService = schoolService; this.costItems = costItems;
        this.costService = costService; this.assets = assets; this.devices = devices; this.permissions = permissions;
    }

    private List<AsRequest> base(CurrentUser me, int year, String rceptTy, Long regionId) {
        return base(me, LocalDate.of(year, 1, 1), LocalDate.of(year + 1, 1, 1), rceptTy, regionId);
    }

    private List<AsRequest> base(CurrentUser me, LocalDate from, LocalDate to, String rceptTy, Long regionId) {
        Map<Long, School> sm = schoolService.schoolMap(me.orgId());
        com.bingoasm.auth.Scope sc = me.scope();
        // 교육지원청 담당자는 관내 학교만, 업체는 (학교와 상관없이) 자기 업체에 배정된 건만 집계.
        Set<Long> inScope = sc.vendor() ? null : schoolService.scopeSchoolIds(me);
        // 교육청이 쓰지 않는 서비스의 신청은 목록과 같이 통계에서도 뺀다 (다시 켜면 다시 잡힌다).
        List<String> inUse = permissions.asTypes(me.orgId());
        return requests.findByOrgIdAndUseYnAndRequestAtGreaterThanEqualAndRequestAtLessThan(me.orgId(), "Y",
                        from.atStartOfDay(), to.atStartOfDay()).stream()
                .filter(r -> inUse.contains(r.rceptTy))
                .filter(r -> inScope == null || inScope.contains(r.schoolId))
                .filter(r -> !sc.vendor() || (sc.vendorId() != null && sc.vendorId().equals(r.vendorId)))
                .filter(r -> Params.blank(rceptTy) || rceptTy.equals(r.rceptTy))
                .filter(r -> regionId == null || (r.schoolId != null && sm.get(r.schoolId) != null && regionId.equals(sm.get(r.schoolId).regionId)))
                .toList();
    }

    /** 계약 · 예산 금액을 보는가: 학교 계정은 아니다 (업체는 자기 계약만 — visibleContracts). */
    private static boolean seesMoney(CurrentUser me) {
        return !me.scope().school();
    }

    private static boolean done(AsRequest r) { return "C".equals(r.status) && r.completedAt != null; }
    private static long cost(List<AsRequest> l) { return l.stream().filter(r -> r.processAmount != null).mapToLong(r -> r.processAmount).sum(); }
    /** 유상(별도 청구) 비용만. */
    private static long paidCost(List<AsRequest> l) { return cost(l.stream().filter(r -> "PAID".equals(r.chargeType)).toList()); }
    /** 유상 중 지급 완료된 금액 — 실제로 나간 돈. */
    private static long paidOut(List<AsRequest> l) { return cost(l.stream().filter(r -> "PAID".equals(r.billStatus())).toList()); }
    /** 처리완료인데 금액이 0원이거나 비어 있는 건 (입력 누락일 수 있음). */
    private static long zeroCost(List<AsRequest> l) { return l.stream().filter(AsStatsService::done).filter(r -> r.processAmount == null || r.processAmount == 0).count(); }

    /** 기간의 계약 배분액 합 (원 단위 반올림). */
    private static long contractCost(List<AsContract> cs, LocalDate from, LocalDate to, Long regionId, String rceptTy, Set<Long> active) {
        return Math.round(cs.stream().mapToDouble(c -> AsCostService.share(c, from, to, regionId, rceptTy, active)).sum());
    }

    /** 집계 한 줄에 실제 지출을 붙인다: 계약 배분 + 유상 지급 완료. */
    private static Json withSpend(Json j, List<AsRequest> l, long contract) {
        long out = paidOut(l);
        return j.with("contractCost", contract).with("paidOut", out).with("spend", contract + out);
    }
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
        // 계약은 지역으로 나눠 배분한다. 교육지원청 담당자는 지역을 고르지 않아도 관내 몫만.
        Long effRegion = regionId != null ? regionId : me.scope().region() ? me.scope().regionId() : null;
        // 학교 계정(통합관리 메뉴를 받은 학교 담당자)은 계약 · 예산을 보지 않는다 — 계약은 교육청 · 지역 단위라 자기 학교 몫이 없다.
        List<AsContract> cs = seesMoney(me) ? costService.visibleContracts(me) : List.of();
        Set<Long> active = ref.regions().keySet();
        LocalDate y0 = LocalDate.of(year, 1, 1), y1 = y0.plusYears(1);
        List<Json> rows = new ArrayList<>();
        int maxMonth = year == Times.today().getYear() ? Times.today().getMonthValue() : 12;
        for (int m = 1; m <= maxMonth; m++) {
            final int mm = m;
            List<AsRequest> l = list.stream().filter(r -> r.requestAt.getMonthValue() == mm).toList();
            LocalDate m0 = LocalDate.of(year, m, 1);
            rows.add(withSpend(Json.obj().with("month", m).with("count", (long) l.size()).with("done", l.stream().filter(AsStatsService::done).count())
                    .with("returned", l.stream().filter(r -> "X".equals(r.status)).count()).with("cost", cost(l)).with("paidCost", paidCost(l)).with("avgDays", avgDays(l)),
                    l, contractCost(cs, m0, m0.plusMonths(1), effRegion, rceptTy, active)));
        }
        List<Json> byType = AsCodes.RCEPT_TYPES.stream().map(ty -> {
            List<AsRequest> l = list.stream().filter(r -> ty.equals(r.rceptTy)).toList();
            long contract = rceptTy != null && !rceptTy.equals(ty) ? 0 : contractCost(cs, y0, y1, effRegion, ty, active);
            return withSpend(Json.obj().with("rceptTy", ty).with("name", AsCodes.RCEPT_TY_NAME.get(ty)).with("count", (long) l.size())
                    .with("done", l.stream().filter(AsStatsService::done).count()).with("cost", cost(l)).with("paidCost", paidCost(l)).with("avgDays", avgDays(l)).with("avgScore", avgScore(l)),
                    l, contract);
        }).toList();
        Map<Long, List<AsRequest>> byRegionMap = list.stream().filter(r -> r.schoolId != null && ref.schools().get(r.schoolId) != null && ref.schools().get(r.schoolId).regionId != null)
                .collect(Collectors.groupingBy(r -> ref.schools().get(r.schoolId).regionId));
        List<Json> byRegion = ref.regions().values().stream().sorted(Comparator.comparing(r -> r.sortOrder == null ? 0 : r.sortOrder)).map(reg -> {
            List<AsRequest> l = byRegionMap.getOrDefault(reg.regionId, List.of());
            long contract = effRegion != null && !effRegion.equals(reg.regionId) ? 0 : contractCost(cs, y0, y1, reg.regionId, rceptTy, active);
            return withSpend(Json.obj().with("regionId", reg.regionId).with("regionName", reg.regionName).with("count", (long) l.size())
                    .with("done", l.stream().filter(AsStatsService::done).count()).with("cost", cost(l)).with("paidCost", paidCost(l)).with("avgDays", avgDays(l)),
                    l, contract);
        }).toList();
        Map<Long, List<AsRequest>> byVendorMap = list.stream().filter(r -> r.vendorId != null).collect(Collectors.groupingBy(r -> r.vendorId));
        Map<Long, Long> vendorContract = new HashMap<>();
        for (AsContract c : cs) {
            long v = Math.round(AsCostService.share(c, y0, y1, effRegion, rceptTy, active));
            if (v > 0 && c.vendorId != null) vendorContract.merge(c.vendorId, v, Long::sum);
        }
        Set<Long> vendorIds = new LinkedHashSet<>(byVendorMap.keySet());
        vendorIds.addAll(vendorContract.keySet());
        List<Json> byVendor = vendorIds.stream().map(id -> {
            Vendor v = ref.vendors().get(id);
            List<AsRequest> l = byVendorMap.getOrDefault(id, List.of());
            return withSpend(Json.obj().with("vendorId", id).with("vendorName", v == null ? "(삭제된 업체)" : v.vendorName).with("count", (long) l.size())
                    .with("done", l.stream().filter(AsStatsService::done).count()).with("cost", cost(l)).with("paidCost", paidCost(l))
                    .with("avgDays", avgDays(l)).with("avgScore", avgScore(l)), l, vendorContract.getOrDefault(id, 0L));
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
        Map<String, List<AsRequest>> bills = paid.stream().collect(Collectors.groupingBy(AsRequest::billStatus));
        Json billing = Json.obj();
        for (String st : List.of("BILLED", "CONFIRMED", "PAID")) {
            List<AsRequest> l = bills.getOrDefault(st, List.of());
            billing.put(st, Json.obj().with("name", AsCodes.BILL_STATUS_NAME.get(st)).with("count", (long) l.size()).with("amount", cost(l)));
        }
        long contractTotal = contractCost(cs, y0, y1, effRegion, rceptTy, active);
        Json total = withSpend(Json.obj().with("count", (long) list.size()).with("done", list.stream().filter(AsStatsService::done).count())
                .with("cost", cost(list)).with("paidCost", cost(paid)).with("freeCost", cost(free))
                .with("paidCount", (long) paid.size()).with("freeCount", (long) free.size()).with("zeroCostDone", zeroCost(list))
                .with("avgDays", avgDays(list)).with("avgScore", avgScore(list)), list, contractTotal);
        return Json.obj().with("year", year).with("rceptTy", rceptTy).with("regionId", regionId)
                .with("total", total).with("billing", billing)
                .with("byCostType", byCostType)
                .with("months", rows).with("byType", byType).with("byRegion", byRegion).with("byVendor", byVendor)
                .with("contracts", contractRows(cs, list, ref, y0, y1, effRegion, rceptTy, active))
                .with("budget", budget(me, year, rceptTy, regionId, effRegion, cs, active, ref, (Long) total.get("spend"), rows));
    }

    /** 그 해와 겹치는 계약마다: 올해 배분액, 그 업체가 계약 범위에서 처리완료한 건수, 건당 실제 비용. */
    private List<Json> contractRows(List<AsContract> cs, List<AsRequest> list, AsRequestService.Ref ref, LocalDate y0, LocalDate y1,
                                    Long effRegion, String rceptTy, Set<Long> active) {
        List<Json> out = new ArrayList<>();
        for (AsContract c : cs) {
            long allocated = Math.round(AsCostService.share(c, y0, y1, effRegion, rceptTy, active));
            if (allocated <= 0) continue;
            Set<Long> regions = Boolean.TRUE.equals(c.allRegions) ? null : new HashSet<>(c.regionIdList());
            long done = list.stream().filter(AsStatsService::done)
                    .filter(r -> c.vendorId != null && c.vendorId.equals(r.vendorId) && c.serviceTypeList().contains(r.rceptTy))
                    .filter(r -> r.completedAt != null && !r.completedAt.toLocalDate().isBefore(c.startDate) && !r.completedAt.toLocalDate().isAfter(c.endDate))
                    .filter(r -> regions == null || (r.schoolId != null && ref.schools().get(r.schoolId) != null && regions.contains(ref.schools().get(r.schoolId).regionId)))
                    .count();
            Vendor v = c.vendorId == null ? null : ref.vendors().get(c.vendorId);
            out.add(Json.obj().with("contractId", c.contractId).with("contractName", c.contractName).with("vendorName", v == null ? "(삭제된 업체)" : v.vendorName)
                    .with("startDate", c.startDate).with("endDate", c.endDate).with("amount", c.amount)
                    .with("serviceTypeNames", c.serviceTypeList().stream().map(t -> AsCodes.RCEPT_TY_NAME.getOrDefault(t, t)).toList())
                    .with("allocated", allocated).with("done", done).with("perCase", done == 0 ? null : Math.round((double) allocated / done)));
        }
        return out;
    }

    /**
     * 예산 대비 집행. 업체는 예산을 보지 않는다. rows: 예산 줄마다 집행액(그 지역·구분의 계약 배분 + 유상 지급완료).
     * current: 지금 고른 조건(지역·구분)과 똑같은 예산 줄이 있으면 그 금액 — 월별 누계와 비교한다.
     */
    private Json budget(CurrentUser me, int year, String rceptTy, Long regionId, Long effRegion, List<AsContract> cs, Set<Long> active,
                        AsRequestService.Ref ref, long spendNow, List<Json> months) {
        if (me.scope().vendor() || !seesMoney(me)) return null;
        List<AsBudget> bs = costService.budgetsOf(me.orgId(), year).stream()
                .filter(b -> !me.scope().region() || Objects.equals(b.regionId, me.scope().regionId())).toList();
        LocalDate y0 = LocalDate.of(year, 1, 1), y1 = y0.plusYears(1);
        List<AsRequest> all = base(me, year, null, null);
        Map<Long, Region> rm = schoolService.allRegionMap(me.orgId());
        List<Json> rows = bs.stream().sorted(Comparator.comparing((AsBudget b) -> b.regionId == null ? -1 : Optional.ofNullable(rm.get(b.regionId)).map(r -> r.sortOrder).orElse(999), Comparator.nullsLast(Comparator.naturalOrder()))
                        .thenComparing(b -> b.rceptTy == null ? "" : b.rceptTy))
                .map(b -> {
                    List<AsRequest> l = all.stream().filter(r -> b.rceptTy == null || b.rceptTy.equals(r.rceptTy))
                            .filter(r -> b.regionId == null || (r.schoolId != null && ref.schools().get(r.schoolId) != null && b.regionId.equals(ref.schools().get(r.schoolId).regionId)))
                            .toList();
                    long spent = contractCost(cs, y0, y1, b.regionId, b.rceptTy, active) + paidOut(l);
                    return AsCostService.budgetView(b, rm).with("spent", spent)
                            .with("rate", b.amount == null || b.amount == 0 ? null : Math.round(spent * 1000.0 / b.amount) / 10.0);
                }).toList();
        Long match = bs.stream().filter(b -> Objects.equals(b.regionId, effRegion) && Objects.equals(b.rceptTy, Params.blank(rceptTy) ? null : rceptTy))
                .map(b -> b.amount).findFirst().orElse(null);
        List<Long> cumulative = new ArrayList<>();
        long run = 0;
        for (Json m : months) { run += (Long) m.get("spend"); cumulative.add(run); }
        return Json.obj().with("rows", rows).with("current", match).with("spent", spendNow)
                .with("rate", match == null || match == 0 ? null : Math.round(spendNow * 1000.0 / match) / 10.0)
                .with("cumulative", cumulative);
    }

    /** 수리비가 취득가의 이 비율을 넘으면 교체를 검토한다. */
    private static final double REPLACE_RATIO = 0.5;

    /**
     * 장비별 누적 수리비 (모든 연도). 정보기기·스마트기기는 자산(취득가·내용연수), 무선망은 무선장비 기준.
     * 수리비는 보고서 금액 전체(무상 환산 포함) — 교체가 나은지 보려면 들어간 수리 가치를 모두 봐야 한다.
     */
    public Json repairs(CurrentUser me, String rceptTy, Long regionId) {
        List<AsRequest> list = base(me, LocalDate.of(2000, 1, 1), Times.today().plusDays(1), rceptTy, regionId).stream()
                .filter(AsStatsService::done).filter(r -> r.processAmount != null && r.processAmount > 0).filter(r -> r.assetId != null || r.deviceId != null).toList();
        AsRequestService.Ref ref = requestService.ref(me.orgId());
        Map<Long, List<AsRequest>> byAsset = list.stream().filter(r -> r.assetId != null).collect(Collectors.groupingBy(r -> r.assetId));
        Map<Long, List<AsRequest>> byDevice = list.stream().filter(r -> r.assetId == null).collect(Collectors.groupingBy(r -> r.deviceId));
        Map<Long, com.bingoasm.domain.Asset> am = assets.findAllById(byAsset.keySet()).stream().collect(Collectors.toMap(a -> a.assetId, a -> a));
        Map<Long, WirelessDevice> dm = devices.findAllById(byDevice.keySet()).stream().collect(Collectors.toMap(d -> d.deviceId, d -> d));
        LocalDate today = Times.today();
        List<Json> rows = new ArrayList<>();
        byAsset.forEach((id, l) -> {
            com.bingoasm.domain.Asset a = am.get(id);
            long c = cost(l);
            Long price = a == null ? null : a.acquirePrice;
            Double ratio = price == null || price <= 0 ? null : Math.round(c * 1000.0 / price) / 1000.0;
            boolean overLife = a != null && a.acquiredAt != null && a.lifeYears != null && !a.acquiredAt.plusYears(a.lifeYears).isAfter(today);
            List<String> reasons = new ArrayList<>();
            if (ratio != null && ratio >= REPLACE_RATIO) reasons.add("수리비가 취득가의 " + Math.round(ratio * 100) + "%");
            if (overLife) reasons.add("내용연수(" + a.lifeYears + "년) 경과");
            rows.add(repairRow(l, ref, c).with("kind", "ASSET").with("id", id)
                    .with("code", a == null ? null : a.assetNo).with("name", a == null ? l.get(0).equipmentName : a.assetName)
                    .with("price", price).with("ratio", ratio).with("acquiredAt", a == null ? null : a.acquiredAt).with("lifeYears", a == null ? null : a.lifeYears)
                    .with("reasons", reasons).with("replace", !reasons.isEmpty()));
        });
        byDevice.forEach((id, l) -> {
            WirelessDevice d = dm.get(id);
            rows.add(repairRow(l, ref, cost(l)).with("kind", "DEVICE").with("id", id)
                    .with("code", d == null ? null : d.deviceCode).with("name", d == null ? l.get(0).deviceName : d.deviceName)
                    .with("price", null).with("ratio", null).with("acquiredAt", d == null ? null : d.installedAt).with("lifeYears", null)
                    .with("reasons", List.of()).with("replace", false));
        });
        rows.sort(Comparator.comparing((Json j) -> (Boolean) j.get("replace")).reversed()
                .thenComparing(j -> (Double) j.get("ratio"), Comparator.nullsLast(Comparator.reverseOrder()))
                .thenComparing(j -> (Long) j.get("cost"), Comparator.reverseOrder()));
        return Json.obj().with("threshold", REPLACE_RATIO).with("replaceCount", rows.stream().filter(j -> (Boolean) j.get("replace")).count())
                .with("rows", rows.size() > 100 ? rows.subList(0, 100) : rows).with("total", (long) rows.size());
    }

    private static Json repairRow(List<AsRequest> l, AsRequestService.Ref ref, long cost) {
        AsRequest last = l.stream().max(Comparator.comparing(r -> r.completedAt)).orElseThrow();
        School s = last.schoolId == null ? null : ref.schools().get(last.schoolId);
        return Json.obj().with("schoolName", s == null ? null : s.schoolName).with("rceptTy", last.rceptTy).with("rceptTyName", AsCodes.RCEPT_TY_NAME.get(last.rceptTy))
                .with("repairs", (long) l.size()).with("cost", cost).with("paidCost", paidCost(l)).with("lastAt", last.completedAt).with("lastAsvcSn", last.asvcSn);
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
