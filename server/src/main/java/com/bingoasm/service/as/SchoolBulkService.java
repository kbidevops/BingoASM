package com.bingoasm.service.as;

import com.bingoasm.auth.CurrentUser;
import com.bingoasm.auth.PermissionService;
import com.bingoasm.common.ApiException;
import com.bingoasm.common.Json;
import com.bingoasm.domain.as.*;
import com.bingoasm.repo.as.SchoolRepository;
import java.io.IOException;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/**
 * 학교(기관) 일괄 등록: 양식 → 검증 → 확정. 한 행의 저장은 기관 등록 화면과 같은 SchoolService.newSchool,
 * 담당 업체는 학교 관리의 담당업체 지정과 같은 SchoolService.saveSchoolVendors(업체의 서비스 · 담당 지역 확인)를 쓴다.
 * 담당 업체 열은 이 교육청이 쓰는 AS 서비스마다 하나씩 ("무선망 업체" …). 비우면 지정하지 않는다.
 */
@Service
@Transactional
public class SchoolBulkService {
    static final List<String> BASE = List.of("기관명", "기관코드", "학교 구분", "교육지원청", "주소", "전화", "학급 수", "메모");
    static final int MAX_ROWS = 1000;
    private static final Map<String, String> TYPE_ALIAS = new HashMap<>();
    static {
        AsCodes.SCHOOL_TYPE_NAME.forEach((code, name) -> { TYPE_ALIAS.put(AssetBulkService.norm(name), code); TYPE_ALIAS.put(code.toLowerCase(), code); });
        TYPE_ALIAS.put("초등", "ELEM"); TYPE_ALIAS.put("초", "ELEM"); TYPE_ALIAS.put("중", "MID"); TYPE_ALIAS.put("고등", "HIGH"); TYPE_ALIAS.put("고", "HIGH"); TYPE_ALIAS.put("특수", "SPECIAL");
    }
    private static final List<String> TYPE_ORDER = List.of("ELEM", "MID", "HIGH", "SPECIAL", "ETC");

    private final SchoolService schoolService;
    private final SchoolRepository schools;
    private final PermissionService permissions;

    public SchoolBulkService(SchoolService schoolService, SchoolRepository schools, PermissionService permissions) {
        this.schoolService = schoolService; this.schools = schools; this.permissions = permissions;
    }

    /** 이 교육청이 쓰는 AS 서비스 (담당 업체 열). */
    private List<String> services(CurrentUser me) {
        List<String> used = permissions.asTypes(me.orgId());
        return AsCodes.RCEPT_TYPES.stream().filter(used::contains).toList();
    }

    private List<String> head(CurrentUser me) {
        List<String> h = new ArrayList<>(BASE);
        for (String ty : services(me)) h.add(AsCodes.RCEPT_TY_NAME.get(ty) + " 업체");
        return h;
    }

    private static void requireAdmin(CurrentUser me) {
        if (!me.scope().schoolAdmin()) throw ApiException.forbidden("학교 일괄 등록은 도교육청 · 교육지원청 담당자만 할 수 있습니다.");
    }

    /** 이 계정이 학교를 넣을 수 있는 교육지원청: 도교육청 = 전체, 교육지원청 = 자기만. */
    private List<Region> regionsFor(CurrentUser me) {
        return schoolService.regionMap(me.orgId()).values().stream().filter(Region::active)
                .filter(r -> !me.scope().region() || r.regionId.equals(me.scope().regionId())).toList();
    }

    // ---------- template ----------

    @Transactional(readOnly = true)
    public byte[] template(CurrentUser me) throws IOException {
        requireAdmin(me);
        List<String> head = head(me);
        List<String> svc = services(me);
        List<Region> rs = regionsFor(me);
        Map<Long, Region> rm = schoolService.regionMap(me.orgId());
        List<Vendor> vs = schoolService.vendorMap(me.orgId()).values().stream().sorted(Comparator.comparing(v -> v.vendorName)).toList();
        String region = rs.isEmpty() ? "천안" : rs.get(0).regionName;
        List<String> s1 = new ArrayList<>(List.of("예시초등학교", "", "초등학교", region, "충청남도 천안시 동남구 예시로 12", "041-000-0000", "24", ""));
        for (String ty : svc) s1.add(vs.stream().filter(v -> v.serviceTypeList().contains(ty)).map(v -> v.vendorName).findFirst().orElse(""));
        List<String> s2 = new ArrayList<>(List.of("예시중학교", "", "중학교", region, "", "", "", ""));
        for (String ignored : svc) s2.add("");
        int[] widths = new int[head.size()];
        int[] base = {22, 12, 12, 14, 36, 16, 10, 24};
        for (int i = 0; i < widths.length; i++) widths[i] = i < base.length ? base[i] : 20;
        Map<Integer, List<String>> drop = new HashMap<>();
        drop.put(2, TYPE_ORDER.stream().map(AsCodes.SCHOOL_TYPE_NAME::get).toList());
        drop.put(3, rs.stream().map(r -> r.regionName).toList());

        List<String[]> guide = new ArrayList<>();
        guide.add(new String[]{"기관명", "필수. 100자 이내. 이미 등록된 기관명이나 파일 안에서 겹치는 이름은 등록되지 않습니다 (AS · 사용자 일괄 등록이 이름으로 학교를 찾습니다)."});
        guide.add(new String[]{"기관코드", "선택. 20자 이내 (예: NEIS 학교 코드). 이미 쓰는 코드는 등록되지 않습니다."});
        guide.add(new String[]{"학교 구분", "선택. " + String.join(" / ", TYPE_ORDER.stream().map(AsCodes.SCHOOL_TYPE_NAME::get).toList()) + " (초등 · 중 · 고도 됩니다)."});
        guide.add(new String[]{"교육지원청", me.scope().region()
                ? "비우면 자기 교육지원청(" + rs.stream().map(r -> r.regionName).findFirst().orElse("-") + ")으로 넣습니다. 다른 교육지원청은 넣을 수 없습니다."
                : "필수. ‘교육지원청 목록’ 시트의 이름 (‘천안’ 또는 ‘천안교육지원청’)."});
        guide.add(new String[]{"주소 · 전화 · 메모", "선택. 메모는 1000자 이내."});
        guide.add(new String[]{"학급 수", "선택. 0 이상의 숫자."});
        if (!svc.isEmpty()) guide.add(new String[]{"○○ 업체", "선택. 그 AS 서비스의 담당 업체 이름 (‘업체 목록’ 시트). 그 서비스를 맡고 학교의 교육지원청을 담당하는 업체만 됩니다. "
                + "비우면 지정하지 않습니다 — 담당 업체가 없으면 그 서비스의 AS 신청을 받을 업체가 없으니, 나중에 학교 관리에서 지정해 주세요."
                + (me.can("SCHOOL_VENDOR") ? "" : " (이 계정은 담당업체 지정 기능이 꺼져 있어 업체 열을 비워야 합니다.)")});
        guide.add(new String[]{"행 수", "한 번에 최대 " + MAX_ROWS + "행. 예시 행은 지우고 올려 주세요."});

        List<List<String>> regionRows = rs.stream().map(r -> List.of(r.regionName, r.regionName + "교육지원청")).toList();
        List<List<String>> vendorRows = vs.stream().map(v -> List.of(v.vendorName,
                String.join(" · ", v.serviceTypeList().stream().filter(svc::contains).map(AsCodes.RCEPT_TY_NAME::get).toList()),
                Boolean.TRUE.equals(v.allRegions) ? "전체 지역" : String.join(" · ", schoolService.vendorRegionIds(v.vendorId).stream().map(rm::get).filter(Objects::nonNull).map(r -> r.regionName).toList()))).toList();
        return BulkSheet.template("학교", head, widths, List.of(s1, s2), drop, Set.of(1, 5), guide,
                List.of(new BulkSheet.ListSheet("교육지원청 목록", List.of("이름", "다르게 쓰기"), regionRows),
                        new BulkSheet.ListSheet("업체 목록", List.of("업체", "맡는 서비스", "담당 지역"), vendorRows)), MAX_ROWS);
    }

    // ---------- validate ----------

    @Transactional(readOnly = true)
    public Json validate(CurrentUser me, MultipartFile file) throws IOException {
        List<String> head = head(me);
        return BulkSheet.view(head, check(me, head, BulkSheet.read(file, head, MAX_ROWS)));
    }

    private List<BulkSheet.Row> check(CurrentUser me, List<String> head, List<Map.Entry<Integer, List<String>>> rows) {
        requireAdmin(me);
        if (!me.can("SCHOOL_CREATE")) throw ApiException.forbidden("학교 등록 기능이 꺼져 있습니다.");
        List<String> svc = services(me);
        Map<String, Region> regionByName = new HashMap<>();
        for (Region r : regionsFor(me)) { regionByName.put(AssetBulkService.norm(r.regionName), r); regionByName.putIfAbsent(AssetBulkService.norm(r.regionName + "교육지원청"), r); }
        Map<String, Region> anyRegion = new HashMap<>();
        for (Region r : schoolService.regionMap(me.orgId()).values()) { anyRegion.put(AssetBulkService.norm(r.regionName), r); anyRegion.putIfAbsent(AssetBulkService.norm(r.regionName + "교육지원청"), r); }
        Map<String, List<Vendor>> vendorByName = new HashMap<>();
        for (Vendor v : schoolService.vendorMap(me.orgId()).values()) vendorByName.computeIfAbsent(AssetBulkService.norm(v.vendorName), k -> new ArrayList<>()).add(v);
        Set<String> names = new HashSet<>(), codes = new HashSet<>();
        for (School s : schools.findByOrgIdAndUseYnOrderBySchoolNameAsc(me.orgId(), "Y")) {
            names.add(AssetBulkService.norm(s.schoolName));
            if (s.schoolCode != null && !s.schoolCode.isBlank()) codes.add(s.schoolCode.trim().toLowerCase());
        }
        Map<String, Integer> nameRow = new HashMap<>(), codeRow = new HashMap<>();
        Region own = me.scope().region() ? schoolService.regionMap(me.orgId()).get(me.scope().regionId()) : null;

        List<BulkSheet.Row> out = new ArrayList<>();
        for (Map.Entry<Integer, List<String>> e : rows) {
            int rowNo = e.getKey();
            List<String> c = new ArrayList<>(e.getValue());
            List<String> errors = new ArrayList<>(), warnings = new ArrayList<>();
            BulkSheet.formulaCheck(head, c, errors);
            Map<String, Object> b = new LinkedHashMap<>();

            String name = c.get(0);
            if (name.isEmpty()) errors.add("기관명을 입력하세요.");
            else {
                BulkSheet.maxLen("기관명", name, 100, errors);
                String n = AssetBulkService.norm(name);
                Integer prev = nameRow.putIfAbsent(n, rowNo);
                if (names.contains(n)) errors.add("'" + name + "'은(는) 이미 등록된 기관입니다.");
                else if (prev != null) errors.add("기관명이 " + prev + "행과 겹칩니다.");
            }
            b.put("schoolName", name);

            String code = c.get(1);
            if (!code.isEmpty()) {
                BulkSheet.maxLen("기관코드", code, 20, errors);
                Integer prev = codeRow.putIfAbsent(code.toLowerCase(), rowNo);
                if (codes.contains(code.toLowerCase())) errors.add("기관코드 '" + code + "'은(는) 이미 다른 기관이 씁니다.");
                else if (prev != null) errors.add("기관코드가 " + prev + "행과 겹칩니다.");
            }
            b.put("schoolCode", BulkSheet.blankToNull(code));

            String type = c.get(2);
            if (!type.isEmpty()) {
                String t = TYPE_ALIAS.get(AssetBulkService.norm(type));
                if (t == null) errors.add("학교 구분 '" + type + "'은(는) 쓸 수 없습니다. (" + String.join(" / ", TYPE_ORDER.stream().map(AsCodes.SCHOOL_TYPE_NAME::get).toList()) + ")");
                else { b.put("schoolType", t); c.set(2, AsCodes.SCHOOL_TYPE_NAME.get(t)); }
            }

            String rn = c.get(3);
            Region region = null;
            if (rn.isEmpty() && own != null) { region = own; c.set(3, own.regionName); }
            else if (rn.isEmpty()) errors.add("교육지원청을 입력하세요.");
            else {
                region = regionByName.get(AssetBulkService.norm(rn));
                if (region == null) {
                    errors.add(anyRegion.containsKey(AssetBulkService.norm(rn)) ? "교육지원청 '" + rn + "'에는 이 계정이 학교를 넣을 수 없습니다 (관할 교육지원청만)." : "교육지원청 '" + rn + "'을(를) 찾을 수 없습니다.");
                }
            }
            if (region != null) b.put("regionId", region.regionId);

            b.put("address", BulkSheet.blankToNull(c.get(4)));
            BulkSheet.maxLen("주소", c.get(4), 255, errors);
            b.put("tel", BulkSheet.blankToNull(c.get(5)));
            BulkSheet.maxLen("전화", c.get(5), 50, errors);
            String cls = c.get(6);
            if (!cls.isEmpty()) {
                Integer n = AssetBulkService.parseInt(cls);
                if (n == null || n < 0 || n > 999) errors.add("학급 수는 0~999의 숫자여야 합니다: " + cls);
                else b.put("classCount", n);
            }
            b.put("memo", BulkSheet.blankToNull(c.get(7)));
            BulkSheet.maxLen("메모", c.get(7), 1000, errors);

            List<Map<String, Object>> vrows = new ArrayList<>();
            for (int i = 0; i < svc.size(); i++) {
                String ty = svc.get(i), vn = c.get(BASE.size() + i), label = AsCodes.RCEPT_TY_NAME.get(ty) + " 업체";
                if (vn.isEmpty()) continue;
                if (!me.can("SCHOOL_VENDOR")) { errors.add(label + ": 이 계정은 담당업체 지정 기능이 꺼져 있습니다. 업체 열을 비워 주세요."); continue; }
                List<Vendor> m = vendorByName.getOrDefault(AssetBulkService.norm(vn), List.of());
                if (m.isEmpty()) errors.add(label + ": 업체 '" + vn + "'을(를) 찾을 수 없습니다.");
                else if (m.size() > 1) errors.add(label + ": 이름이 '" + vn + "'인 업체가 " + m.size() + "곳입니다.");
                else if (!m.get(0).serviceTypeList().contains(ty)) errors.add(label + ": " + vn + "은(는) " + AsCodes.RCEPT_TY_NAME.get(ty) + " 유지관리 업체가 아닙니다.");
                else if (region != null && !schoolService.vendorCovers(m.get(0), region.regionId)) errors.add(label + ": " + vn + "은(는) " + region.regionName + " 지역을 담당하지 않습니다.");
                else vrows.add(Map.of("rceptTy", ty, "vendorId", m.get(0).vendorId));
            }
            b.put("_vendors", vrows);
            if (errors.isEmpty() && vrows.size() < svc.size())
                warnings.add("담당 업체를 지정하지 않은 서비스(" + String.join(" · ", svc.stream().filter(ty -> vrows.stream().noneMatch(v -> ty.equals(v.get("rceptTy")))).map(AsCodes.RCEPT_TY_NAME::get).toList())
                        + ")는 AS 신청을 받을 업체가 없습니다. 나중에 학교 관리에서 지정하세요.");
            out.add(new BulkSheet.Row(rowNo, c, errors, warnings, b));
        }
        return out;
    }

    // ---------- commit ----------

    /** 다시 검사한 뒤 오류 없는 행만 등록. 한 트랜잭션: 중간에 실패하면 아무것도 등록되지 않는다. */
    @SuppressWarnings("unchecked")
    public Json commit(CurrentUser me, MultipartFile file, boolean skipErrors) throws IOException {
        List<String> head = head(me);
        List<BulkSheet.Row> rows = check(me, head, BulkSheet.read(file, head, MAX_ROWS));
        long skipped = BulkSheet.requireCommittable(rows, skipErrors);
        List<Json> created = new ArrayList<>();
        for (BulkSheet.Row r : rows) {
            if (!r.ok()) continue;
            Map<String, Object> b = new LinkedHashMap<>(r.payload());
            List<Map<String, Object>> vrows = (List<Map<String, Object>>) b.remove("_vendors");
            School s = schoolService.newSchool(me, b);
            if (!vrows.isEmpty()) schoolService.saveSchoolVendors(me, s.schoolId, vrows);
            created.add(Json.obj().with("rowNo", r.rowNo()).with("id", s.schoolId).with("name", s.schoolName)
                    .with("sub", r.cells().get(3) + (vrows.isEmpty() ? " · 담당 업체 없음" : " · 담당 업체 " + vrows.size() + "개")));
        }
        return Json.obj().with("created", (long) created.size()).with("skipped", skipped).with("items", created);
    }
}
