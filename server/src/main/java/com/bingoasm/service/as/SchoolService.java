package com.bingoasm.service.as;

import com.bingoasm.auth.CurrentUser;
import com.bingoasm.auth.Scope;
import com.bingoasm.common.*;
import com.bingoasm.domain.AppUser;
import com.bingoasm.domain.as.*;
import com.bingoasm.repo.AssetRepository;
import com.bingoasm.repo.UserRepository;
import com.bingoasm.repo.as.*;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 지역(교육지원청), 기관(학교), 업체, 기관별 담당 업체. */
@Service
@Transactional
public class SchoolService {
    private final RegionRepository regions;
    private final SchoolRepository schools;
    private final VendorRepository vendors;
    private final SchoolVendorRepository schoolVendors;
    private final UserRepository users;
    private final AssetRepository assets;

    public SchoolService(RegionRepository regions, SchoolRepository schools, VendorRepository vendors, SchoolVendorRepository schoolVendors,
                         UserRepository users, AssetRepository assets) {
        this.regions = regions; this.schools = schools; this.vendors = vendors; this.schoolVendors = schoolVendors;
        this.users = users; this.assets = assets;
    }

    // ---------- lookups shared with other services ----------

    public Map<Long, Region> regionMap(Long orgId) {
        return regions.findByOrgIdOrderBySortOrderAsc(orgId).stream().collect(Collectors.toMap(r -> r.regionId, Function.identity()));
    }

    public Map<Long, School> schoolMap(Long orgId) {
        return schools.findByOrgIdAndUseYnOrderBySchoolNameAsc(orgId, "Y").stream().collect(Collectors.toMap(s -> s.schoolId, Function.identity()));
    }

    public Map<Long, Vendor> vendorMap(Long orgId) {
        return vendors.findByOrgIdAndUseYnOrderByVendorNameAsc(orgId, "Y").stream().collect(Collectors.toMap(v -> v.vendorId, Function.identity()));
    }

    /**
     * 범위({@link Scope}) 안의 학교 id. 학교 단위 데이터(학교·자산·공간·무선장비)의 범위는 모두 여기서 정한다.
     * 업체(기사·업체 관리자)는 자기 업체가 담당으로 배정된 학교만 — 메뉴 권한을 더 받아도 기관 전체로 넓어지지 않는다.
     * (AS 신청은 업체 기준(배정된 건)으로 따로 본다: AsRequestService·AsStatsService.)
     * null = 학교 제한 없음 (도교육청 관리자, 원클릭 AS 소속 없는 계정). 빈 집합 = 다룰 학교가 없음 (소속이 비어 있는 계정).
     */
    public Set<Long> scopeSchoolIds(CurrentUser me) {
        Scope sc = me.scope();
        return switch (sc.kind()) {
            case SCHOOL -> sc.schoolId() == null ? Set.of() : Set.of(sc.schoolId());
            case VENDOR -> sc.vendorId() == null ? Set.of()
                    : schoolVendors.findByVendorId(sc.vendorId()).stream().map(sv -> sv.schoolId).collect(Collectors.toSet());
            case REGION -> schools.findByOrgIdAndUseYnOrderBySchoolNameAsc(me.orgId(), "Y").stream()
                    .filter(s -> sc.regionId() != null && sc.regionId().equals(s.regionId)).map(s -> s.schoolId).collect(Collectors.toSet());
            default -> null;
        };
    }

    /** 학교 담당자는 자기 학교만, 교육지원청 담당자는 관내 학교만 다룰 수 있다 (403). */
    public void checkSchoolScope(CurrentUser me, Long schoolId) {
        Scope sc = me.scope();
        if (sc.school() && (sc.schoolId() == null || !sc.schoolId().equals(schoolId)))
            throw ApiException.forbidden("소속 학교의 정보만 다룰 수 있습니다.");
        if (sc.region()) {
            School s = schoolId == null ? null : schools.findById(schoolId).orElse(null);
            if (s == null || sc.regionId() == null || !sc.regionId().equals(s.regionId))
                throw ApiException.forbidden("관할 교육지원청 학교의 정보만 다룰 수 있습니다.");
        }
        if (sc.vendor() && (schoolId == null || !scopeSchoolIds(me).contains(schoolId)))
            throw ApiException.forbidden("담당으로 배정된 학교의 정보만 다룰 수 있습니다.");
    }

    /** Loads a school of this org that is inside the caller's scope (400 if missing, 403 if out of scope). */
    public School loadSchool(CurrentUser me, Long id) {
        School s = schools.findById(id == null ? -1L : id).filter(x -> x.orgId.equals(me.orgId()) && "Y".equals(x.useYn))
                .orElseThrow(() -> ApiException.badRequest("소속기관을 선택해주세요."));
        checkSchoolScope(me, s.schoolId);
        return s;
    }

    public Optional<SchoolVendor> resolveVendor(Long schoolId, String rceptTy) {
        return schoolVendors.findBySchoolIdAndRceptTy(schoolId, rceptTy).filter(sv -> sv.vendorId != null);
    }

    // ---------- regions ----------

    public List<Json> regions(CurrentUser me) {
        return regions.findByOrgIdOrderBySortOrderAsc(me.orgId()).stream()
                .filter(r -> !me.scope().region() || r.regionId.equals(me.scope().regionId()))
                .map(r -> Json.obj().with("regionId", r.regionId).with("regionName", r.regionName).with("sortOrder", r.sortOrder)).toList();
    }

    /** 지역(교육지원청) 자체의 추가·수정·삭제는 도교육청 관리자만. */
    private static void requireProvinceAdmin(CurrentUser me) {
        if (!me.scope().province()) throw ApiException.forbidden("교육지원청 목록은 도교육청 관리자만 바꿀 수 있습니다.");
    }

    public Json saveRegion(CurrentUser me, Long id, Map<String, Object> b) {
        requireProvinceAdmin(me);
        Region r = id == null ? new Region() : regions.findById(id).filter(x -> x.orgId.equals(me.orgId())).orElseThrow(() -> ApiException.notFound("지역을 찾을 수 없습니다."));
        String name = Params.str(b, "regionName");
        if (name == null) throw ApiException.badRequest("지역명을 입력해 주세요.");
        r.orgId = me.orgId(); r.regionName = name;
        Integer so = Params.integer(b, "sortOrder");
        r.sortOrder = so != null ? so : r.sortOrder != null ? r.sortOrder : (int) regions.count() + 1;
        regions.save(r);
        return Json.obj().with("regionId", r.regionId).with("regionName", r.regionName).with("sortOrder", r.sortOrder);
    }

    public void deleteRegion(CurrentUser me, Long id) {
        requireProvinceAdmin(me);
        Region r = regions.findById(id).filter(x -> x.orgId.equals(me.orgId())).orElseThrow(() -> ApiException.notFound("지역을 찾을 수 없습니다."));
        if (schools.findByOrgIdAndUseYnOrderBySchoolNameAsc(me.orgId(), "Y").stream().anyMatch(s -> id.equals(s.regionId)))
            throw ApiException.conflict("이 지역에 속한 기관이 있어 삭제할 수 없습니다.");
        regions.delete(r);
    }

    // ---------- schools ----------

    public Json schoolView(School s, Map<Long, Region> rm, Map<Long, Vendor> vm, Map<Long, List<SchoolVendor>> svm, Map<Long, Long> assetCounts, Map<Long, AppUser> um) {
        Region r = s.regionId == null ? null : rm.get(s.regionId);
        List<Json> svs = svm.getOrDefault(s.schoolId, List.of()).stream().map(sv -> {
            Vendor v = sv.vendorId == null ? null : vm.get(sv.vendorId);
            AppUser e = sv.engineerUserId == null ? null : um.get(sv.engineerUserId);
            return Json.obj().with("rceptTy", sv.rceptTy).with("rceptTyName", AsCodes.RCEPT_TY_NAME.get(sv.rceptTy))
                    .with("vendorId", sv.vendorId).with("vendorName", v == null ? null : v.vendorName)
                    .with("engineerUserId", sv.engineerUserId).with("engineerName", e == null ? null : e.userName);
        }).toList();
        return Json.obj().with("schoolId", s.schoolId).with("schoolCode", s.schoolCode).with("schoolName", s.schoolName)
                .with("schoolType", s.schoolType).with("schoolTypeName", s.schoolType == null ? null : AsCodes.SCHOOL_TYPE_NAME.getOrDefault(s.schoolType, s.schoolType))
                .with("regionId", s.regionId).with("regionName", r == null ? null : r.regionName)
                .with("address", s.address).with("tel", s.tel).with("classCount", s.classCount)
                .with("contractStatus", s.contractStatus).with("contractStatusName", "CONTRACTED".equals(s.contractStatus) ? "체결" : "미체결")
                .with("memo", s.memo).with("assetCount", assetCounts.getOrDefault(s.schoolId, 0L)).with("vendors", svs);
    }

    @Transactional(readOnly = true)
    public List<Json> schools(CurrentUser me, String keyword, Long regionId, String contractStatus) {
        Set<Long> inScope = scopeSchoolIds(me);
        List<School> list = schools.findByOrgIdAndUseYnOrderBySchoolNameAsc(me.orgId(), "Y").stream()
                .filter(s -> inScope == null || inScope.contains(s.schoolId))
                .filter(s -> Params.blank(keyword) || s.schoolName.contains(keyword.trim()) || (s.schoolCode != null && s.schoolCode.contains(keyword.trim())))
                .filter(s -> regionId == null || regionId.equals(s.regionId))
                .filter(s -> Params.blank(contractStatus) || contractStatus.equals(s.contractStatus))
                .toList();
        Map<Long, Region> rm = regionMap(me.orgId());
        Map<Long, Vendor> vm = vendorMap(me.orgId());
        Map<Long, List<SchoolVendor>> svm = schoolVendors.findBySchoolIdIn(list.stream().map(s -> s.schoolId).toList()).stream().collect(Collectors.groupingBy(sv -> sv.schoolId));
        Map<Long, AppUser> um = users.findByOrgIdOrderByUserIdAsc(me.orgId()).stream().collect(Collectors.toMap(u -> u.userId, Function.identity()));
        Map<Long, Long> counts = assets.findByOrgIdAndUseYn(me.orgId(), "Y").stream().filter(a -> a.schoolId != null).collect(Collectors.groupingBy(a -> a.schoolId, Collectors.counting()));
        return list.stream().map(s -> schoolView(s, rm, vm, svm, counts, um)).toList();
    }

    @Transactional(readOnly = true)
    public Json school(CurrentUser me, Long id) {
        School s = loadSchool(me, id);
        return schools(me, null, null, null).stream().filter(j -> id.equals(j.get("schoolId"))).findFirst().orElseGet(() -> schoolView(s, regionMap(me.orgId()), vendorMap(me.orgId()), Map.of(), Map.of(), Map.of()));
    }

    private void applySchool(CurrentUser me, School s, Map<String, Object> b) {
        if (b.containsKey("schoolName")) s.schoolName = Params.str(b, "schoolName");
        if (Params.blank(s.schoolName)) throw ApiException.badRequest("기관명을 입력해 주세요.");
        if (b.containsKey("schoolCode")) s.schoolCode = Params.str(b, "schoolCode");
        if (b.containsKey("schoolType")) { String t = Params.str(b, "schoolType"); if (t != null && !AsCodes.SCHOOL_TYPE_NAME.containsKey(t)) throw ApiException.badRequest("학교 구분이 올바르지 않습니다."); s.schoolType = t; }
        if (b.containsKey("regionId")) { Long rid = Params.lng(b, "regionId"); if (rid != null && !regionMap(me.orgId()).containsKey(rid)) throw ApiException.badRequest("지역이 올바르지 않습니다."); s.regionId = rid; }
        if (b.containsKey("address")) s.address = Params.str(b, "address");
        if (b.containsKey("tel")) s.tel = Params.str(b, "tel");
        if (b.containsKey("classCount")) s.classCount = Params.integer(b, "classCount");
        if (b.containsKey("contractStatus")) s.contractStatus = normContract(Params.str(b, "contractStatus"));
        if (b.containsKey("memo")) s.memo = Params.str(b, "memo");
    }

    /** 학교 등록·삭제와 계약·담당업체 지정은 도교육청·교육지원청만 — 학교·업체 계정은 메뉴를 받아도 못 한다. */
    private static void requireSchoolAdmin(CurrentUser me, String what) {
        if (!me.scope().schoolAdmin()) throw ApiException.forbidden(what + "은(는) 도교육청·교육지원청 담당자만 할 수 있습니다.");
    }

    public Json createSchool(CurrentUser me, Map<String, Object> b) {
        requireSchoolAdmin(me, "학교 등록");
        School s = new School();
        s.orgId = me.orgId(); s.createdAt = Times.now();
        applySchool(me, s, b);
        keepInDistrict(me, s);
        schools.save(s);
        return school(me, s.schoolId);
    }

    /** 모든 학교는 교육지원청 하나에 속하고, 교육지원청 담당자가 등록·수정하는 학교는 항상 자기 교육지원청 소속. */
    private static void keepInDistrict(CurrentUser me, School s) {
        if (me.scope().region()) {
            if (s.regionId == null) s.regionId = me.scope().regionId();
            if (!s.regionId.equals(me.scope().regionId())) throw ApiException.forbidden("다른 교육지원청으로 옮길 수 없습니다.");
        }
        if (s.regionId == null) throw ApiException.badRequest("지역(교육지원청)을 선택해 주세요.");
    }

    public Json updateSchool(CurrentUser me, Long id, Map<String, Object> b) {
        School s = loadSchool(me, id);
        if (me.scope().vendor()) throw ApiException.forbidden("업체 계정은 학교 정보를 바꿀 수 없습니다.");
        if (!me.scope().schoolAdmin()) {
            // 학교 담당자: 자기 학교의 기본 정보(이름·주소·전화·학급 수·메모)만. 계약·지역은 바꿀 수 없다.
            if (b.containsKey("contractStatus") && !Objects.equals(normContract(Params.str(b, "contractStatus")), s.contractStatus))
                throw ApiException.forbidden("유지관리 계약 상태는 도교육청·교육지원청 담당자만 바꿀 수 있습니다.");
            if (b.containsKey("regionId") && !Objects.equals(Params.lng(b, "regionId"), s.regionId))
                throw ApiException.forbidden("소속 교육지원청은 도교육청·교육지원청 담당자만 바꿀 수 있습니다.");
        }
        applySchool(me, s, b);
        keepInDistrict(me, s);
        return school(me, id);
    }

    private static String normContract(String c) { return "CONTRACTED".equals(c) ? "CONTRACTED" : "NONE"; }

    public void deleteSchool(CurrentUser me, Long id) {
        requireSchoolAdmin(me, "학교 삭제");
        School s = loadSchool(me, id);
        s.useYn = "N";
    }

    // ---------- school ↔ vendor mapping ----------

    /** body: [{ rceptTy, vendorId, engineerUserId }] — replaces all mappings of the school. */
    public List<Json> setSchoolVendors(CurrentUser me, Long schoolId, List<Map<String, Object>> rows) {
        loadSchool(me, schoolId);
        requireSchoolAdmin(me, "담당 업체·기사 지정");
        Map<Long, Vendor> vm = vendorMap(me.orgId());
        schoolVendors.deleteBySchoolId(schoolId);
        // Hibernate flushes INSERTs before DELETEs; without this, re-saving an existing (school, type) hits the unique key.
        schoolVendors.flush();
        for (Map<String, Object> r : rows == null ? List.<Map<String, Object>>of() : rows) {
            String ty = Params.str(r, "rceptTy");
            Long vid = Params.lng(r, "vendorId");
            if (ty == null || !AsCodes.RCEPT_TYPES.contains(ty) || vid == null) continue;
            Vendor v = vm.get(vid);
            if (v == null) throw ApiException.badRequest("업체가 올바르지 않습니다.");
            if (!v.serviceTypeList().contains(ty)) throw ApiException.badRequest(v.vendorName + "은(는) " + AsCodes.RCEPT_TY_NAME.get(ty) + " 유지관리 업체가 아닙니다.");
            SchoolVendor sv = new SchoolVendor();
            sv.schoolId = schoolId; sv.rceptTy = ty; sv.vendorId = vid;
            Long eid = Params.lng(r, "engineerUserId");
            if (eid != null) {
                AppUser e = users.findById(eid).filter(u -> vid.equals(u.vendorId)).orElseThrow(() -> ApiException.badRequest("담당 기사가 해당 업체 소속이 아닙니다."));
                sv.engineerUserId = e.userId;
            }
            schoolVendors.save(sv);
        }
        return (List<Json>) school(me, schoolId).get("vendors");
    }

    // ---------- vendors ----------

    public Json vendorView(Vendor v, Map<Long, Region> rm, long engineerCount) {
        Region r = v.regionId == null ? null : rm.get(v.regionId);
        return Json.obj().with("vendorId", v.vendorId).with("vendorName", v.vendorName).with("regionId", v.regionId)
                .with("regionName", r == null ? "전체" : r.regionName).with("bizNo", v.bizNo).with("tel", v.tel).with("address", v.address)
                .with("serviceTypes", v.serviceTypeList())
                .with("serviceTypeNames", v.serviceTypeList().stream().map(t -> AsCodes.RCEPT_TY_NAME.getOrDefault(t, t)).toList())
                .with("engineerCount", engineerCount).with("updatedAt", v.updatedAt != null ? v.updatedAt : v.createdAt);
    }

    @Transactional(readOnly = true)
    public List<Json> vendors(CurrentUser me, Long regionId, String rceptTy) {
        Map<Long, Region> rm = regionMap(me.orgId());
        Map<Long, Long> eng = users.findByOrgIdOrderByUserIdAsc(me.orgId()).stream().filter(u -> u.vendorId != null && "ACTIVE".equals(u.status))
                .collect(Collectors.groupingBy(u -> u.vendorId, Collectors.counting()));
        return vendors.findByOrgIdAndUseYnOrderByVendorNameAsc(me.orgId(), "Y").stream()
                .filter(v -> regionId == null || v.regionId == null || regionId.equals(v.regionId))
                .filter(v -> Params.blank(rceptTy) || v.serviceTypeList().contains(rceptTy))
                .map(v -> vendorView(v, rm, eng.getOrDefault(v.vendorId, 0L))).toList();
    }

    private Vendor loadVendor(CurrentUser me, Long id) {
        return vendors.findById(id == null ? -1L : id).filter(v -> v.orgId.equals(me.orgId()) && "Y".equals(v.useYn)).orElseThrow(() -> ApiException.notFound("업체를 찾을 수 없습니다."));
    }

    private void applyVendor(CurrentUser me, Vendor v, Map<String, Object> b) {
        if (b.containsKey("vendorName")) v.vendorName = Params.str(b, "vendorName");
        if (Params.blank(v.vendorName)) throw ApiException.badRequest("업체명을 입력해 주세요.");
        if (b.containsKey("regionId")) v.regionId = Params.lng(b, "regionId");
        if (b.containsKey("bizNo")) v.bizNo = Params.str(b, "bizNo");
        if (b.containsKey("tel")) v.tel = Params.str(b, "tel");
        if (b.containsKey("address")) v.address = Params.str(b, "address");
        if (b.containsKey("serviceTypes")) {
            Object raw = b.get("serviceTypes");
            List<String> types = raw instanceof List<?> l ? l.stream().map(String::valueOf).toList() : raw == null ? List.of() : Arrays.asList(String.valueOf(raw).split(","));
            List<String> ok = types.stream().map(String::trim).filter(AsCodes.RCEPT_TYPES::contains).distinct().toList();
            v.serviceTypes = String.join(",", ok);
        }
        v.updatedAt = Times.now();
    }

    /** 업체 등록·수정·삭제는 도교육청만 — 담당 분야를 바꾸면 그 업체 기사들의 AS 메뉴가 바뀌기 때문. 다른 계정은 조회만. */
    private static void requireVendorAdmin(CurrentUser me) {
        if (!me.scope().province()) throw ApiException.forbidden("업체 등록·수정·삭제는 도교육청 관리자만 할 수 있습니다.");
    }

    public Json createVendor(CurrentUser me, Map<String, Object> b) {
        requireVendorAdmin(me);
        Vendor v = new Vendor();
        v.orgId = me.orgId(); v.createdAt = Times.now();
        applyVendor(me, v, b);
        vendors.save(v);
        return vendorView(v, regionMap(me.orgId()), 0);
    }

    public Json updateVendor(CurrentUser me, Long id, Map<String, Object> b) {
        requireVendorAdmin(me);
        Vendor v = loadVendor(me, id);
        applyVendor(me, v, b);
        return vendors(me, null, null).stream().filter(j -> id.equals(j.get("vendorId"))).findFirst().orElseThrow();
    }

    public void deleteVendor(CurrentUser me, Long id) {
        requireVendorAdmin(me);
        loadVendor(me, id).useYn = "N";
    }

    @Transactional(readOnly = true)
    public List<Json> engineers(CurrentUser me, Long vendorId) {
        return users.findByOrgIdOrderByUserIdAsc(me.orgId()).stream()
                .filter(u -> vendorId.equals(u.vendorId) && "ACTIVE".equals(u.status) && (u.roles.contains("AS_ENGINEER") || u.roles.contains("VENDOR_ADMIN")))
                .map(u -> Json.obj().with("userId", u.userId).with("userName", u.userName).with("positionName", u.positionName).with("mobile", u.mobile)
                        .with("roles", u.roles)).toList();
    }
}
