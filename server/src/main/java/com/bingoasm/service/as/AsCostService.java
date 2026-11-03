package com.bingoasm.service.as;

import com.bingoasm.auth.CurrentUser;
import com.bingoasm.common.*;
import com.bingoasm.domain.as.*;
import com.bingoasm.repo.as.AsBudgetRepository;
import com.bingoasm.repo.as.AsContractRepository;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 유지보수 계약과 연간 예산. 실제 지출은 계약 금액(정액)과 유상 지급 완료액이다 — 처리 보고서의 무상 금액은
 * 계약 안에서 한 일의 환산 금액이라 지출에 넣지 않는다. 등록·수정은 도교육청만 (교육지원청·업체는 통계에서 자기 몫만 본다).
 */
@Service
@Transactional
public class AsCostService {
    private static final long MAX_AMOUNT = 1_000_000_000_000L;
    private final AsContractRepository contracts;
    private final AsBudgetRepository budgets;
    private final SchoolService schoolService;

    public AsCostService(AsContractRepository contracts, AsBudgetRepository budgets, SchoolService schoolService) {
        this.contracts = contracts; this.budgets = budgets; this.schoolService = schoolService;
    }

    private static void requireProvince(CurrentUser me) {
        if (!me.scope().province()) throw ApiException.forbidden("계약·예산은 도교육청 관리자만 관리할 수 있습니다.");
    }

    // ---------- allocation ----------

    /** 계약이 실제로 맡는 지역 id. 전체 지역이면 지금 있는 지역 모두. */
    private static Collection<Long> regionsOf(AsContract c, Set<Long> activeRegions) {
        if (Boolean.TRUE.equals(c.allRegions)) return activeRegions;
        List<Long> l = c.regionIdList().stream().filter(activeRegions::contains).toList();
        return l.isEmpty() ? c.regionIdList() : l;
    }

    /**
     * 기간 [from, to) 동안의 계약 금액 몫. 계약 기간 일수로 나누고, regionId·rceptTy를 주면 계약이 맡은 지역 수·구분 수로 똑같이 나눈다.
     * (지역마다 처리 건수가 달라도 금액은 균등 배분 — 계약서에 지역별 금액이 없기 때문.)
     */
    public static double share(AsContract c, LocalDate from, LocalDate to, Long regionId, String rceptTy, Set<Long> activeRegions) {
        if (c.amount == null || c.startDate == null || c.endDate == null) return 0;
        LocalDate end = c.endDate.plusDays(1);
        LocalDate a = c.startDate.isAfter(from) ? c.startDate : from, b = end.isBefore(to) ? end : to;
        long overlap = ChronoUnit.DAYS.between(a, b), total = ChronoUnit.DAYS.between(c.startDate, end);
        if (overlap <= 0 || total <= 0) return 0;
        double v = (double) c.amount * overlap / total;
        if (regionId != null) {
            Collection<Long> rs = regionsOf(c, activeRegions);
            if (!rs.contains(regionId)) return 0;
            v /= rs.size();
        }
        if (rceptTy != null) {
            List<String> ts = c.serviceTypeList();
            if (!ts.contains(rceptTy)) return 0;
            v /= ts.size();
        }
        return v;
    }

    /** 통계에 쓰는 계약: 업체는 자기 업체 계약만, 교육지원청은 관내를 맡는 계약만. */
    @Transactional(readOnly = true)
    public List<AsContract> visibleContracts(CurrentUser me) {
        Set<Long> active = schoolService.regionMap(me.orgId()).keySet();
        return contracts.findByOrgIdAndUseYnOrderByStartDateDescContractIdDesc(me.orgId(), "Y").stream()
                .filter(c -> !me.scope().vendor() || (me.scope().vendorId() != null && me.scope().vendorId().equals(c.vendorId)))
                .filter(c -> !me.scope().region() || regionsOf(c, active).contains(me.scope().regionId()))
                .toList();
    }

    @Transactional(readOnly = true)
    public List<AsBudget> budgetsOf(Long orgId, int year) { return budgets.findByOrgIdAndBudgetYear(orgId, year); }

    // ---------- contracts ----------

    public Json contractView(AsContract c, Map<Long, Region> rm, Map<Long, Vendor> vm) {
        Vendor v = c.vendorId == null ? null : vm.get(c.vendorId);
        boolean all = Boolean.TRUE.equals(c.allRegions);
        List<Long> rids = all ? List.of() : c.regionIdList();
        return Json.obj().with("contractId", c.contractId).with("contractName", c.contractName)
                .with("vendorId", c.vendorId).with("vendorName", v == null ? "(삭제된 업체)" : v.vendorName)
                .with("startDate", c.startDate).with("endDate", c.endDate).with("amount", c.amount)
                .with("serviceTypes", c.serviceTypeList())
                .with("serviceTypeNames", c.serviceTypeList().stream().map(t -> AsCodes.RCEPT_TY_NAME.getOrDefault(t, t)).toList())
                .with("allRegions", all)
                .with("regions", rids.stream().map(id -> Json.obj().with("regionId", id).with("regionName", rm.containsKey(id) ? rm.get(id).regionName : "(삭제된 지역)")).toList())
                .with("note", c.note).with("updatedAt", c.updatedAt != null ? c.updatedAt : c.createdAt);
    }

    @Transactional(readOnly = true)
    public List<Json> contracts(CurrentUser me) {
        requireProvince(me);
        Map<Long, Region> rm = schoolService.allRegionMap(me.orgId());
        Map<Long, Vendor> vm = schoolService.allVendorMap(me.orgId());
        return contracts.findByOrgIdAndUseYnOrderByStartDateDescContractIdDesc(me.orgId(), "Y").stream().map(c -> contractView(c, rm, vm)).toList();
    }

    private void applyContract(CurrentUser me, AsContract c, Map<String, Object> b) {
        Long vid = Params.lng(b, "vendorId");
        Vendor v = vid == null ? null : schoolService.allVendorMap(me.orgId()).get(vid);
        // 삭제된 업체의 지난 계약은 그대로 고칠 수 있게 둔다. 새로 고르는 업체는 지금 있는 업체여야 한다.
        if (v == null || (!vid.equals(c.vendorId) && !"Y".equals(v.useYn))) throw ApiException.badRequest("업체를 선택해 주세요.");
        c.vendorId = vid;
        c.contractName = Params.str(b, "contractName");
        if (c.contractName == null) throw ApiException.badRequest("계약명을 입력해 주세요.");
        if (c.contractName.length() > 200) throw ApiException.badRequest("계약명은 200자 이내로 입력해 주세요.");
        c.startDate = Params.date(b, "startDate");
        c.endDate = Params.date(b, "endDate");
        if (c.startDate == null || c.endDate == null) throw ApiException.badRequest("계약 기간을 입력해 주세요.");
        if (c.endDate.isBefore(c.startDate)) throw ApiException.badRequest("계약 종료일이 시작일보다 빠릅니다.");
        if (ChronoUnit.YEARS.between(c.startDate, c.endDate) >= 10) throw ApiException.badRequest("계약 기간은 10년 이내로 입력해 주세요.");
        c.amount = Params.lng(b, "amount");
        if (c.amount == null || c.amount <= 0 || c.amount > MAX_AMOUNT) throw ApiException.badRequest("계약 금액을 확인해 주세요.");
        Object raw = b.get("serviceTypes");
        List<String> types = raw instanceof List<?> l ? l.stream().map(String::valueOf).toList() : raw == null ? List.of() : Arrays.asList(String.valueOf(raw).split(","));
        List<String> ok = types.stream().map(String::trim).filter(AsCodes.RCEPT_TYPES::contains).distinct().toList();
        if (ok.isEmpty()) throw ApiException.badRequest("계약에 포함된 AS 구분을 하나 이상 선택해 주세요.");
        c.serviceTypes = String.join(",", ok);
        c.allRegions = Boolean.TRUE.equals(b.get("allRegions"));
        if (c.allRegions) c.regionIds = null;
        else {
            Map<Long, Region> rm = schoolService.regionMap(me.orgId());
            Set<Long> keep = new HashSet<>(c.regionIdList());
            List<Long> ids = new ArrayList<>();
            if (b.get("regionIds") instanceof List<?> l) for (Object o : l) {
                Long id = Params.toLong(o);
                // 삭제된 지역은 원래 있던 계약에서만 남길 수 있다.
                if (id == null || (!rm.containsKey(id) && !keep.contains(id))) throw ApiException.badRequest("지역이 올바르지 않습니다.");
                if (!ids.contains(id)) ids.add(id);
            }
            if (ids.isEmpty()) throw ApiException.badRequest("계약 지역을 하나 이상 선택해 주세요.");
            c.regionIds = ids.stream().map(String::valueOf).collect(Collectors.joining(","));
        }
        c.note = Params.str(b, "note");
        if (c.note != null && c.note.length() > 1000) throw ApiException.badRequest("메모는 1000자 이내로 입력해 주세요.");
        c.updatedAt = Times.now();
    }

    public Json saveContract(CurrentUser me, Long id, Map<String, Object> b) {
        requireProvince(me);
        AsContract c = id == null ? new AsContract() : load(me, id);
        if (id == null) { c.orgId = me.orgId(); c.createdAt = Times.now(); }
        applyContract(me, c, b);
        contracts.save(c);
        return contractView(c, schoolService.allRegionMap(me.orgId()), schoolService.allVendorMap(me.orgId()));
    }

    public void deleteContract(CurrentUser me, Long id) {
        requireProvince(me);
        AsContract c = load(me, id);
        c.useYn = "N";
        c.updatedAt = Times.now();
    }

    private AsContract load(CurrentUser me, Long id) {
        return contracts.findById(id).filter(c -> c.orgId.equals(me.orgId()) && "Y".equals(c.useYn)).orElseThrow(() -> ApiException.notFound("계약을 찾을 수 없습니다."));
    }

    // ---------- budgets ----------

    @Transactional(readOnly = true)
    public List<Json> budgets(CurrentUser me, int year) {
        requireProvince(me);
        Map<Long, Region> rm = schoolService.allRegionMap(me.orgId());
        return budgets.findByOrgIdAndBudgetYear(me.orgId(), year).stream().map(x -> budgetView(x, rm)).toList();
    }

    public static Json budgetView(AsBudget x, Map<Long, Region> rm) {
        return Json.obj().with("budgetId", x.budgetId).with("year", x.budgetYear)
                .with("regionId", x.regionId).with("regionName", x.regionId == null ? "전체 지역" : rm.containsKey(x.regionId) ? rm.get(x.regionId).regionName : "(삭제된 지역)")
                .with("rceptTy", x.rceptTy).with("rceptTyName", x.rceptTy == null ? "전체" : AsCodes.RCEPT_TY_NAME.get(x.rceptTy))
                .with("amount", x.amount).with("note", x.note);
    }

    /** 그 해의 예산 줄을 통째로 바꾼다. body: [{regionId?, rceptTy?, amount, note?}]. 지역·구분 조합은 한 번씩만. */
    public List<Json> saveBudgets(CurrentUser me, int year, List<Map<String, Object>> rows) {
        requireProvince(me);
        if (year < 2000 || year > 2100) throw ApiException.badRequest("연도가 올바르지 않습니다.");
        if (rows == null) rows = List.of();
        if (rows.size() > 100) throw ApiException.badRequest("예산은 100줄까지 입력할 수 있습니다.");
        Map<Long, Region> rm = schoolService.allRegionMap(me.orgId());
        Map<Long, Region> active = schoolService.regionMap(me.orgId());
        List<AsBudget> old = budgets.findByOrgIdAndBudgetYear(me.orgId(), year);
        Set<Long> kept = old.stream().map(x -> x.regionId).filter(Objects::nonNull).collect(Collectors.toSet());
        Set<String> seen = new HashSet<>();
        List<AsBudget> next = new ArrayList<>();
        for (Map<String, Object> m : rows) {
            AsBudget x = new AsBudget();
            x.orgId = me.orgId(); x.budgetYear = year;
            x.regionId = Params.lng(m, "regionId");
            if (x.regionId != null && !active.containsKey(x.regionId) && !(rm.containsKey(x.regionId) && kept.contains(x.regionId)))
                throw ApiException.badRequest("지역이 올바르지 않습니다.");
            x.rceptTy = Params.str(m, "rceptTy");
            if (x.rceptTy != null && !AsCodes.RCEPT_TYPES.contains(x.rceptTy)) throw ApiException.badRequest("AS 구분이 올바르지 않습니다.");
            x.amount = Params.lng(m, "amount");
            if (x.amount == null || x.amount <= 0 || x.amount > MAX_AMOUNT) throw ApiException.badRequest("예산 금액을 확인해 주세요.");
            x.note = Params.str(m, "note");
            if (x.note != null && x.note.length() > 200) throw ApiException.badRequest("메모는 200자 이내로 입력해 주세요.");
            String key = x.regionId + "/" + x.rceptTy;
            if (!seen.add(key)) {
                String name = (x.regionId == null ? "전체 지역" : rm.get(x.regionId).regionName) + " · " + (x.rceptTy == null ? "전체" : AsCodes.RCEPT_TY_NAME.get(x.rceptTy));
                throw ApiException.badRequest(name + " 예산이 두 번 들어 있습니다.");
            }
            next.add(x);
        }
        budgets.deleteAll(old);
        budgets.flush();
        budgets.saveAll(next);
        return next.stream().map(x -> budgetView(x, rm)).toList();
    }
}
