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
    private final com.bingoasm.repo.as.VendorRegionRepository vendorRegions;
    private final com.bingoasm.repo.as.AsRequestRepository requests;
    private final UserRepository users;
    private final AssetRepository assets;
    private final com.bingoasm.auth.PermissionService permissions;

    public SchoolService(com.bingoasm.repo.as.VendorRegionRepository vendorRegions, com.bingoasm.repo.as.AsRequestRepository requests, RegionRepository regions, SchoolRepository schools, VendorRepository vendors, SchoolVendorRepository schoolVendors,
                         UserRepository users, AssetRepository assets, com.bingoasm.auth.PermissionService permissions) {
        this.vendorRegions = vendorRegions; this.requests = requests; this.regions = regions; this.schools = schools; this.vendors = vendors; this.schoolVendors = schoolVendors;
        this.users = users; this.assets = assets; this.permissions = permissions;
    }

    /** 교육청이 쓰지 않는 AS 서비스를 새로 지정하려 하면 거절한다. 이미 있던 지정(keep)은 그대로 둔다 — 다른 정보를 고치다 막히지 않도록. */
    private void refuseUnusedService(CurrentUser me, String ty, boolean keep) {
        if (!keep && !permissions.asTypes(me.orgId()).contains(ty))
            throw ApiException.badRequest(AsCodes.RCEPT_TY_NAME.getOrDefault(ty, ty) + " AS는 이 교육청에서 사용하지 않는 서비스입니다. AS 서비스 설정에서 먼저 켜 주세요.");
    }

    // ---------- lookups shared with other services ----------

    public Map<Long, Region> regionMap(Long orgId) {
        // 순서를 지킨다: 문의처처럼 이 맵을 그대로 나열하는 화면이 있다.
        return activeRegions(orgId).stream().collect(Collectors.toMap(r -> r.regionId, Function.identity(), (a, b) -> a, LinkedHashMap::new));
    }

    private List<Region> activeRegions(Long orgId) {
        return regions.findByOrgIdOrderBySortOrderAsc(orgId).stream().filter(Region::active).toList();
    }

    /** 삭제된 지역까지. 문의처 안내만 쓴다. */
    public Map<Long, Region> allRegionMap(Long orgId) {
        return regions.findByOrgIdOrderBySortOrderAsc(orgId).stream().collect(Collectors.toMap(r -> r.regionId, Function.identity(), (a, b) -> a, LinkedHashMap::new));
    }

    /** 삭제된 업체까지 (useYn과 무관). 이름을 보여 주는 용도. */
    public Map<Long, Vendor> allVendorMap(Long orgId) {
        return vendors.findAll().stream().filter(v -> orgId.equals(v.orgId)).collect(Collectors.toMap(v -> v.vendorId, Function.identity()));
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
        return activeRegions(me.orgId()).stream()
                .filter(r -> !me.scope().region() || r.regionId.equals(me.scope().regionId()))
                .map(r -> Json.obj().with("regionId", r.regionId).with("regionName", r.regionName).with("sortOrder", r.sortOrder)).toList();
    }

    /** 지역(교육지원청) 자체의 추가·수정·삭제는 도교육청 관리자만. */
    private static void requireProvinceAdmin(CurrentUser me) {
        if (!me.scope().province()) throw ApiException.forbidden("교육지원청 목록은 도교육청 관리자만 바꿀 수 있습니다.");
    }

    public Json saveRegion(CurrentUser me, Long id, Map<String, Object> b) {
        requireProvinceAdmin(me);
        String name = Params.str(b, "regionName");
        if (name == null) throw ApiException.badRequest("지역명을 입력해 주세요.");
        // 삭제한 지역과 같은 이름으로 추가하면 그 지역을 되살린다. 문의처 항목이 다시 이어진다.
        Region revived = id != null ? null : regions.findByOrgIdOrderBySortOrderAsc(me.orgId()).stream().filter(x -> !x.active() && name.equals(x.regionName)).findFirst().orElse(null);
        Region r = id == null ? (revived != null ? revived : new Region()) : regions.findById(id).filter(x -> x.orgId.equals(me.orgId()) && x.active()).orElseThrow(() -> ApiException.notFound("지역을 찾을 수 없습니다."));
        List<Region> all = activeRegions(me.orgId());
        if (all.stream().anyMatch(x -> name.equals(x.regionName) && !x.regionId.equals(id))) throw ApiException.conflict("이미 있는 지역명입니다.");
        r.orgId = me.orgId(); r.regionName = name;
        if (revived != null) { r.useYn = "Y"; r.sortOrder = null; }
        Integer so = Params.integer(b, "sortOrder");
        r.sortOrder = so != null ? so : r.sortOrder != null ? r.sortOrder : all.stream().mapToInt(x -> x.sortOrder == null ? 0 : x.sortOrder).max().orElse(0) + 1;
        regions.save(r);
        return Json.obj().with("regionId", r.regionId).with("regionName", r.regionName).with("sortOrder", r.sortOrder);
    }

    public void deleteRegion(CurrentUser me, Long id) {
        requireProvinceAdmin(me);
        Region r = regions.findById(id).filter(x -> x.orgId.equals(me.orgId()) && x.active()).orElseThrow(() -> ApiException.notFound("지역을 찾을 수 없습니다."));
        if (schools.findByOrgIdAndUseYnOrderBySchoolNameAsc(me.orgId(), "Y").stream().anyMatch(s -> id.equals(s.regionId)))
            throw ApiException.conflict("이 지역에 속한 기관이 있어 삭제할 수 없습니다.");
        if (users.findByOrgIdOrderByUserIdAsc(me.orgId()).stream().anyMatch(u -> id.equals(u.regionId)))
            throw ApiException.conflict("이 지역의 담당자 계정이 있어 삭제할 수 없습니다.");
        // 문의처는 건드리지 않는다: 항목이 남아 있는 동안 문의처 안내에 "삭제됨"으로 나온다 (ContactService.grouped).
        vendorRegions.deleteAll(vendorRegions.findByOrgIdAndRegionId(me.orgId(), id));
        r.useYn = "N";
    }

    @Transactional(readOnly = true)
    public List<Json> regionUsage(CurrentUser me) {
        requireProvinceAdmin(me);
        Long org = me.orgId();
        Map<Long, Long> sc = schools.findByOrgIdAndUseYnOrderBySchoolNameAsc(org, "Y").stream().filter(s -> s.regionId != null).collect(Collectors.groupingBy(s -> s.regionId, Collectors.counting()));
        Map<Long, Long> us = users.findByOrgIdOrderByUserIdAsc(org).stream().filter(u -> u.regionId != null).collect(Collectors.groupingBy(u -> u.regionId, Collectors.counting()));
        Set<Long> active = vendors.findByOrgIdAndUseYnOrderByVendorNameAsc(org, "Y").stream().map(v -> v.vendorId).collect(Collectors.toSet());
        Map<Long, Long> vs = vendorRegions.findByOrgIdOrderBySortOrderAsc(org).stream().filter(l -> active.contains(l.vendorId)).collect(Collectors.groupingBy(l -> l.regionId, Collectors.counting()));
        return activeRegions(org).stream().map(r -> Json.obj().with("regionId", r.regionId).with("regionName", r.regionName).with("sortOrder", r.sortOrder)
                .with("schools", sc.getOrDefault(r.regionId, 0L)).with("users", us.getOrDefault(r.regionId, 0L))
                .with("vendors", vs.getOrDefault(r.regionId, 0L))).toList();
    }

    /** ids: 이 기관의 모든 지역을 새 순서대로. */
    public List<Json> orderRegions(CurrentUser me, List<Long> ids) {
        requireProvinceAdmin(me);
        Map<Long, Region> rm = regionMap(me.orgId());
        if (ids == null || ids.size() != rm.size() || !new HashSet<>(ids).equals(rm.keySet())) throw ApiException.badRequest("모든 지역을 한 번씩 보내 주세요.");
        int i = 0;
        for (Long id : ids) rm.get(id).sortOrder = ++i;
        return regions(me);
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
                .with("memo", s.memo).with("assetCount", assetCounts.getOrDefault(s.schoolId, 0L)).with("vendors", svs);
    }

    @Transactional(readOnly = true)
    public List<Json> schools(CurrentUser me, String keyword, Long regionId) {
        Set<Long> inScope = scopeSchoolIds(me);
        List<School> list = schools.findByOrgIdAndUseYnOrderBySchoolNameAsc(me.orgId(), "Y").stream()
                .filter(s -> inScope == null || inScope.contains(s.schoolId))
                .filter(s -> Params.blank(keyword) || s.schoolName.contains(keyword.trim()) || (s.schoolCode != null && s.schoolCode.contains(keyword.trim())))
                .filter(s -> regionId == null || regionId.equals(s.regionId))
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
        return schools(me, null, null).stream().filter(j -> id.equals(j.get("schoolId"))).findFirst().orElseGet(() -> schoolView(s, regionMap(me.orgId()), vendorMap(me.orgId()), Map.of(), Map.of(), Map.of()));
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
            // 학교 담당자: 자기 학교의 기본 정보(이름·주소·전화·학급 수·메모)만. 지역은 바꿀 수 없다.
            if (b.containsKey("regionId") && !Objects.equals(Params.lng(b, "regionId"), s.regionId))
                throw ApiException.forbidden("소속 교육지원청은 도교육청·교육지원청 담당자만 바꿀 수 있습니다.");
        }
        applySchool(me, s, b);
        keepInDistrict(me, s);
        return school(me, id);
    }


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
        School school = schools.findById(schoolId).orElseThrow();
        // 이전에 지정된 배정은 담당 지역 밖이어도 그대로 저장된다. 학교의 다른 정보를 고치다 AS 배정이 끊기지 않도록.
        Map<String, Long> before = new HashMap<>();
        for (SchoolVendor sv : schoolVendors.findBySchoolId(schoolId)) before.put(sv.rceptTy, sv.vendorId);
        schoolVendors.deleteBySchoolId(schoolId);
        // Hibernate flushes INSERTs before DELETEs; without this, re-saving an existing (school, type) hits the unique key.
        schoolVendors.flush();
        for (Map<String, Object> r : rows == null ? List.<Map<String, Object>>of() : rows) {
            String ty = Params.str(r, "rceptTy");
            Long vid = Params.lng(r, "vendorId");
            if (ty == null || !AsCodes.RCEPT_TYPES.contains(ty) || vid == null) continue;
            Vendor v = vm.get(vid);
            if (v == null) throw ApiException.badRequest("업체가 올바르지 않습니다.");
            refuseUnusedService(me, ty, vid.equals(before.get(ty)));
            if (!v.serviceTypeList().contains(ty)) throw ApiException.badRequest(v.vendorName + "은(는) " + AsCodes.RCEPT_TY_NAME.get(ty) + " 유지관리 업체가 아닙니다.");
            if (!vid.equals(before.get(ty)) && !vendorCovers(v, school.regionId))
                throw ApiException.badRequest(v.vendorName + "은(는) " + school.schoolName + "의 지역을 담당하지 않습니다. 업체관리에서 담당 지역을 확인해 주세요.");
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

    public Json vendorView(Vendor v, Map<Long, Region> rm, List<com.bingoasm.domain.as.VendorRegion> links, long engineerCount) {
        boolean all = Boolean.TRUE.equals(v.allRegions);
        List<com.bingoasm.domain.as.VendorRegion> mine = all ? List.of() : links.stream().filter(l -> rm.containsKey(l.regionId))
                .sorted(Comparator.comparing((com.bingoasm.domain.as.VendorRegion l) -> rm.get(l.regionId).sortOrder, Comparator.nullsLast(Comparator.naturalOrder()))).toList();
        return Json.obj().with("vendorId", v.vendorId).with("vendorName", v.vendorName).with("allRegions", all)
                .with("regions", mine.stream().map(l -> Json.obj().with("regionId", l.regionId).with("regionName", rm.get(l.regionId).regionName)).toList())
                .with("regionName", all ? "전체" : mine.isEmpty() ? "미지정" : String.join(", ", mine.stream().map(l -> rm.get(l.regionId).regionName).toList()))
                .with("bizNo", v.bizNo).with("tel", v.tel).with("address", v.address)
                .with("serviceTypes", v.serviceTypeList())
                .with("serviceTypeNames", v.serviceTypeList().stream().map(t -> AsCodes.RCEPT_TY_NAME.getOrDefault(t, t)).toList())
                .with("engineerCount", engineerCount).with("updatedAt", v.updatedAt != null ? v.updatedAt : v.createdAt);
    }

    @Transactional(readOnly = true)
    public List<Json> vendors(CurrentUser me, Long regionId, String rceptTy) {
        Map<Long, Region> rm = regionMap(me.orgId());
        Map<Long, Long> eng = users.findByOrgIdOrderByUserIdAsc(me.orgId()).stream().filter(u -> u.vendorId != null && "ACTIVE".equals(u.status))
                .collect(Collectors.groupingBy(u -> u.vendorId, Collectors.counting()));
        Map<Long, List<com.bingoasm.domain.as.VendorRegion>> links = vendorRegions.findByOrgIdOrderBySortOrderAsc(me.orgId()).stream().collect(Collectors.groupingBy(l -> l.vendorId));
        return vendors.findByOrgIdAndUseYnOrderByVendorNameAsc(me.orgId(), "Y").stream()
                .filter(v -> regionId == null || Boolean.TRUE.equals(v.allRegions) || links.getOrDefault(v.vendorId, List.of()).stream().anyMatch(l -> regionId.equals(l.regionId)))
                .filter(v -> Params.blank(rceptTy) || v.serviceTypeList().contains(rceptTy))
                .map(v -> vendorView(v, rm, links.getOrDefault(v.vendorId, List.of()), eng.getOrDefault(v.vendorId, 0L))).toList();
    }

    private Vendor loadVendor(CurrentUser me, Long id) {
        return vendors.findById(id == null ? -1L : id).filter(v -> v.orgId.equals(me.orgId()) && "Y".equals(v.useYn)).orElseThrow(() -> ApiException.notFound("업체를 찾을 수 없습니다."));
    }

    private void applyVendor(CurrentUser me, Vendor v, Map<String, Object> b) {
        if (b.containsKey("vendorName")) v.vendorName = Params.str(b, "vendorName");
        if (Params.blank(v.vendorName)) throw ApiException.badRequest("업체명을 입력해 주세요.");
        if (b.containsKey("bizNo")) v.bizNo = Params.str(b, "bizNo");
        if (b.containsKey("tel")) v.tel = Params.str(b, "tel");
        if (b.containsKey("address")) v.address = Params.str(b, "address");
        if (b.containsKey("serviceTypes")) {
            Object raw = b.get("serviceTypes");
            List<String> types = raw instanceof List<?> l ? l.stream().map(String::valueOf).toList() : raw == null ? List.of() : Arrays.asList(String.valueOf(raw).split(","));
            List<String> ok = types.stream().map(String::trim).filter(AsCodes.RCEPT_TYPES::contains).distinct().toList();
            List<String> had = v.serviceTypes == null ? List.of() : v.serviceTypeList();
            for (String t : ok) refuseUnusedService(me, t, had.contains(t));
            v.serviceTypes = String.join(",", ok);
        }
        v.updatedAt = Times.now();
    }

    /**
     * 담당 지역 저장. body: { allRegions, regions:[{regionId}] } 또는 예전 형식 { regionId } (없으면 전체). 빠진 지역은 지운다.
     */
    /** 이 업체가 그 지역을 담당하는가. */
    public boolean vendorCovers(Vendor v, Long regionId) {
        return Boolean.TRUE.equals(v.allRegions) || vendorRegions.findByVendorId(v.vendorId).stream().anyMatch(l -> l.regionId.equals(regionId));
    }

    /** 담당 지역에서 빠지는 지역에 이 업체가 배정된 학교가 있으면 거절한다. 그대로 두면 담당 지역 밖의 학교가 AS를 계속 보내게 된다. */
    private void refuseRemovingUsedRegions(CurrentUser me, Vendor v, Set<Long> kept, boolean keepsAll) {
        if (keepsAll || v.vendorId == null || v.allRegions == null) return;
        Set<Long> before = new HashSet<>();
        if (Boolean.TRUE.equals(v.allRegions)) before.addAll(regionMap(me.orgId()).keySet());
        else for (var l : vendorRegions.findByVendorId(v.vendorId)) before.add(l.regionId);
        before.removeAll(kept);
        Map<Long, School> sm = schoolMap(me.orgId());
        Map<Long, Region> rm = regionMap(me.orgId());
        List<String> used = schoolVendors.findByVendorId(v.vendorId).stream().map(sv -> sm.get(sv.schoolId))
                .filter(s -> s != null && before.contains(s.regionId)).map(s -> s.schoolName).distinct().toList();
        if (!used.isEmpty()) {
            String regionNames = String.join(", ", before.stream().filter(rm::containsKey).filter(id -> used.stream().anyMatch(n -> sm.values().stream().anyMatch(s -> n.equals(s.schoolName) && id.equals(s.regionId)))).map(id -> rm.get(id).regionName).toList());
            throw ApiException.conflict(regionNames + "을(를) 담당 지역에서 뺄 수 없습니다. 이 업체가 배정된 학교가 있습니다: " + String.join(", ", used) + ". 기관정보관리에서 먼저 다른 업체로 바꿔 주세요.");
        }
    }

    private void applyRegions(CurrentUser me, Vendor v, Map<String, Object> b) {
        boolean legacy = !b.containsKey("regions") && !b.containsKey("allRegions");
        if (legacy && !b.containsKey("regionId") && v.allRegions != null) return;
        Long legacyRegion = legacy ? Params.lng(b, "regionId") : null;
        boolean keepsAll = legacy ? legacyRegion == null : Boolean.TRUE.equals(b.get("allRegions"));
        Set<Long> kept = new HashSet<>();
        if (legacyRegion != null) kept.add(legacyRegion);
        if (!keepsAll && b.get("regions") instanceof List<?> l0) for (Object o : l0) if (o instanceof Map<?, ?> m0 && Params.toLong(m0.get("regionId")) != null) kept.add(Params.toLong(m0.get("regionId")));
        refuseRemovingUsedRegions(me, v, kept, keepsAll);
        v.allRegions = keepsAll;
        List<Map<String, Object>> rows = new ArrayList<>();
        if (legacyRegion != null) rows.add(Map.of("regionId", legacyRegion));
        if (b.get("regions") instanceof List<?> l && !v.allRegions) for (Object o : l) if (o instanceof Map<?, ?> m) {
            @SuppressWarnings("unchecked") Map<String, Object> row = (Map<String, Object>) m;
            rows.add(row);
        }
        Map<Long, Region> rm = regionMap(me.orgId());
        Map<Long, com.bingoasm.domain.as.VendorRegion> old = new HashMap<>();
        for (var l : vendorRegions.findByVendorId(v.vendorId)) old.put(l.regionId, l);
        for (Map<String, Object> r : rows) {
            Long rid = Params.lng(r, "regionId");
            if (rid == null || !rm.containsKey(rid)) throw ApiException.badRequest("담당 지역이 올바르지 않습니다.");
            var l = old.remove(rid);
            if (l == null) {
                l = new com.bingoasm.domain.as.VendorRegion();
                l.orgId = me.orgId(); l.vendorId = v.vendorId; l.regionId = rid;
                vendorRegions.save(l);
            }
        }
        vendorRegions.deleteAll(old.values());
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
        if (!b.containsKey("regions") && !b.containsKey("allRegions") && !b.containsKey("regionId")) v.allRegions = true;
        vendors.save(v);
        applyRegions(me, v, b);
        vendors.save(v);
        return vendorView(v, regionMap(me.orgId()), vendorRegions.findByVendorId(v.vendorId), 0);
    }

    public Json updateVendor(CurrentUser me, Long id, Map<String, Object> b) {
        requireVendorAdmin(me);
        Vendor v = loadVendor(me, id);
        applyVendor(me, v, b);
        applyRegions(me, v, b);
        vendorRegions.flush();
        return vendors(me, null, null).stream().filter(j -> id.equals(j.get("vendorId"))).findFirst().orElseThrow();
    }

    private static final List<String> OPEN_STATUS = List.of("A", "R");

    /** 이 업체의 처리 중(신청완료·접수완료) AS. inUse: 교육청이 쓰는 서비스의 것만(true) / 쓰지 않아 숨겨진 것만(false). */
    private List<AsRequest> openRequests(CurrentUser me, Long vendorId, boolean inUse) {
        List<String> on = permissions.asTypes(me.orgId());
        return requests.findByVendorIdAndUseYnAndStatusInOrderByRequestAtAsc(vendorId, "Y", OPEN_STATUS).stream()
                .filter(r -> on.contains(r.rceptTy) == inUse).toList();
    }

    private List<AppUser> vendorUsers(CurrentUser me, Long vendorId) {
        return users.findByOrgIdOrderByUserIdAsc(me.orgId()).stream().filter(u -> vendorId.equals(u.vendorId) && "ACTIVE".equals(u.status)).toList();
    }

    /** 삭제 확인 화면용: 이 업체를 지우면 영향받는 것들. */
    @Transactional(readOnly = true)
    public Json vendorUsage(CurrentUser me, Long id) {
        requireVendorAdmin(me);
        Vendor v = loadVendor(me, id);
        Map<Long, School> sm = schoolMap(me.orgId());
        List<AsRequest> open = openRequests(me, id, true);
        return Json.obj().with("vendorId", v.vendorId).with("vendorName", v.vendorName)
                .with("schools", schoolVendors.findByVendorId(id).stream().map(sv -> sv.schoolId).distinct().count())
                .with("users", vendorUsers(me, id).size())
                .with("openRequests", (long) open.size())
                // 삭제를 막는 AS: 무엇인지 보여 주어 처리하거나 다른 업체로 옮길 수 있게.
                .with("openList", open.stream().limit(20).map(r -> Json.obj().with("asvcSn", r.asvcSn).with("rceptTy", r.rceptTy)
                        .with("rceptTyName", AsCodes.RCEPT_TY_NAME.get(r.rceptTy)).with("statusName", AsCodes.STATUS_NAME.get(r.status))
                        .with("schoolName", r.schoolId == null || sm.get(r.schoolId) == null ? null : sm.get(r.schoolId).schoolName)
                        .with("requestAt", r.requestAt)).toList())
                // 쓰지 않는 서비스의 처리 중 AS는 아무도 볼 수 없으므로 삭제를 막지 않는다. 기록은 남는다.
                .with("hiddenOpenRequests", (long) openRequests(me, id, false).size())
                .with("allRequests", requests.countByVendorIdAndUseYn(id, "Y"));
    }

    /**
     * 업체 삭제. 처리 중인 AS(신청완료·접수완료)가 있으면 거절한다. 삭제하면 학교 배정과 담당 지역을 지우고 소속 계정을 사용 중지한다.
     * 업체 기록은 숨기기만 하므로 지난 AS에는 이름이 남는다. 문의처의 유지보수 사업자는 별개라 건드리지 않는다.
     */
    public void deleteVendor(CurrentUser me, Long id) {
        requireVendorAdmin(me);
        Vendor v = loadVendor(me, id);
        long open = openRequests(me, id, true).size();
        if (open > 0) throw ApiException.conflict("처리 중인 AS가 " + open + "건 있어 삭제할 수 없습니다. 처리를 끝내거나 다른 업체로 옮겨 주세요.");
        schoolVendors.deleteAll(schoolVendors.findByVendorId(id));
        vendorRegions.deleteAll(vendorRegions.findByVendorId(id));
        for (AppUser u : vendorUsers(me, id)) u.status = "DISABLED";
        v.useYn = "N";
        v.updatedAt = Times.now();
    }

    @Transactional(readOnly = true)
    public List<Json> engineers(CurrentUser me, Long vendorId) {
        return users.findByOrgIdOrderByUserIdAsc(me.orgId()).stream()
                .filter(u -> vendorId.equals(u.vendorId) && "ACTIVE".equals(u.status) && (u.roles.contains("AS_ENGINEER") || u.roles.contains("VENDOR_ADMIN")))
                .map(u -> Json.obj().with("userId", u.userId).with("userName", u.userName).with("positionName", u.positionName).with("mobile", u.mobile)
                        .with("roles", u.roles)).toList();
    }
}
