package com.bingoasm.service.as;

import com.bingoasm.auth.CurrentUser;
import com.bingoasm.auth.PermissionService;
import com.bingoasm.common.*;
import com.bingoasm.domain.AppUser;
import com.bingoasm.domain.Asset;
import com.bingoasm.domain.as.*;
import com.bingoasm.repo.AssetRepository;
import com.bingoasm.repo.UserRepository;
import com.bingoasm.repo.as.*;
import jakarta.persistence.criteria.Predicate;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 원클릭 AS 신청 (정보기기 C · 무선망 M · 스쿨넷 S · 스마트기기 T).
 * 상태: A 신청완료 → R 접수완료 → C 처리완료, X 반려. 취소는 useYn='N'.
 * 범위: 교육청 관리자 전체 / 업체·기사 소속 업체 건 / 학교 사용자 소속 학교 건 / 그 외 본인 신청 건.
 */
@Service
@Transactional
public class AsRequestService {
    private final AsRequestRepository requests;
    private final AsHistoryRepository histories;
    private final com.bingoasm.repo.FileRepository files;
    private final SchoolService schoolService;
    private final UserRepository users;
    private final WirelessDeviceRepository devices;
    private final AssetRepository assets;
    private final AsCostItemRepository costItems;
    private final PermissionService permissions;
    private final NotificationService notices;
    private final WirelessDeviceService deviceService;
    private final AsAlertService alerts;
    private final com.bingoasm.repo.OrgRepository orgs;

    /** 스쿨넷 신고를 먼저 받는 곳: REGION 교육지원청(기본) · VENDOR 통신사. */
    String schoolnetRoute(Long orgId) {
        return orgs.findById(orgId).map(o -> o.schoolnetRoute).filter(x -> x != null && !x.isBlank()).orElse("REGION");
    }

    /** 교육지원청 · 교육청이 처리 담당인 건 */
    static boolean officeHandled(AsRequest r) { return "REGION".equals(r.handlerType) || "PROVINCE".equals(r.handlerType); }

    public AsRequestService(AsRequestRepository requests, AsHistoryRepository histories, SchoolService schoolService, UserRepository users,
                            WirelessDeviceRepository devices, AssetRepository assets, com.bingoasm.repo.FileRepository files, AsCostItemRepository costItems,
                            PermissionService permissions, NotificationService notices, WirelessDeviceService deviceService, AsAlertService alerts,
                            com.bingoasm.repo.OrgRepository orgs) {
        this.deviceService = deviceService;
        this.orgs = orgs;
        this.alerts = alerts;
        this.files = files; this.costItems = costItems; this.permissions = permissions; this.notices = notices;
        this.requests = requests; this.histories = histories; this.schoolService = schoolService; this.users = users;
        this.devices = devices; this.assets = assets;
    }

    // ---------- scope ----------

    // 범위는 CurrentUser.scope() 하나로 정한다. 도교육청: 전체 / 교육지원청·학교: 범위 안 학교 / 업체: 배정된 AS / 그 밖: 본인 신청.

    /** 도교육청·시스템 관리자 (전체 범위). */
    static boolean isAdmin(CurrentUser me) { return me.scope().province(); }
    /** 교육지원청 담당자: 관내 학교의 AS만 보고 배정·취소할 수 있다 (삭제는 도교육청만). */
    static boolean isRegionManager(CurrentUser me) { return me.scope().region() && me.can("AS_MANAGE"); }
    static boolean isVendorSide(CurrentUser me) { return me.scope().vendor() && me.scope().vendorId() != null; }
    static boolean isSchoolSide(CurrentUser me) { return me.scope().school() && me.scope().schoolId() != null; }
    /** 업체 쪽 사용자 중 기사 배정 권한이 없는 사람(기사): 자기에게 배정된 AS만 본다. 업체 관리자는 업체 전체를 보고 기사를 정한다. */
    static boolean engineerOnly(CurrentUser me) { return isVendorSide(me) && !me.can("AS_ENGINEER_ASSIGN"); }

    private Specification<AsRequest> scope(CurrentUser me) {
        Set<Long> inScope = me.scope().vendor() ? null : schoolService.scopeSchoolIds(me);
        return (root, q, cb) -> {
            List<Predicate> p = new ArrayList<>();
            p.add(cb.equal(root.get("orgId"), me.orgId()));
            p.add(cb.equal(root.get("useYn"), "Y"));
            if (isAdmin(me)) return cb.and(p.toArray(Predicate[]::new));
            // 업체는 학교가 아니라 자기 업체에 배정된 AS를 본다.
            if (me.scope().vendor()) {
                p.add(isVendorSide(me) ? cb.equal(root.get("vendorId"), me.scope().vendorId()) : cb.disjunction());
                // 기사(기사 배정 권한 없음)는 자기에게 배정된 건만
                if (engineerOnly(me)) p.add(cb.equal(root.get("engineerUserId"), me.userId()));
            }
            else if (inScope != null) p.add(inScope.isEmpty() ? cb.disjunction() : root.get("schoolId").in(inScope));
            else p.add(cb.equal(root.get("applicantUserId"), me.userId()));
            return cb.and(p.toArray(Predicate[]::new));
        };
    }

    private boolean inScope(CurrentUser me, AsRequest r) {
        if (!r.orgId.equals(me.orgId())) return false;
        if (isAdmin(me)) return true;
        if (me.scope().vendor()) return isVendorSide(me) && me.scope().vendorId().equals(r.vendorId)
                && (!engineerOnly(me) || me.userId().equals(r.engineerUserId));
        Set<Long> inScope = schoolService.scopeSchoolIds(me);
        if (inScope != null) return inScope.contains(r.schoolId);
        return me.userId().equals(r.applicantUserId);
    }

    private AsRequest load(CurrentUser me, Long sn) {
        return requests.findById(sn).filter(r -> "Y".equals(r.useYn) && inScope(me, r)).orElseThrow(() -> ApiException.notFound("AS 신청을 찾을 수 없습니다."));
    }

    // ---------- views ----------

    public record Ref(Map<Long, School> schools, Map<Long, Region> regions, Map<Long, Vendor> vendors, Map<Long, AppUser> users) {}

    public Ref ref(Long orgId) {
        // 삭제된 업체도 포함한다: 지난 AS 기록에는 처리한 업체 이름이 남아야 한다.
        return new Ref(schoolService.schoolMap(orgId), schoolService.regionMap(orgId), schoolService.allVendorMap(orgId),
                users.findByOrgIdOrderByUserIdAsc(orgId).stream().collect(Collectors.toMap(u -> u.userId, Function.identity())));
    }

    public Json row(AsRequest r, Ref ref) {
        School s = r.schoolId == null ? null : ref.schools().get(r.schoolId);
        Region reg = s == null || s.regionId == null ? null : ref.regions().get(s.regionId);
        Vendor v = r.vendorId == null ? null : ref.vendors().get(r.vendorId);
        AppUser eng = r.engineerUserId == null ? null : ref.users().get(r.engineerUserId);
        return Json.obj().with("asvcSn", r.asvcSn).with("rceptTy", r.rceptTy).with("rceptTyName", AsCodes.RCEPT_TY_NAME.get(r.rceptTy))
                .with("schoolId", r.schoolId).with("schoolName", s == null ? null : s.schoolName)
                .with("regionId", s == null ? null : s.regionId).with("regionName", reg == null ? null : reg.regionName)
                .with("applicantUserId", r.applicantUserId).with("applicantName", r.applicantName).with("contactTel", r.contactTel)
                .with("faultTypeCode", r.faultTypeCode).with("faultTypeName", r.faultTypeName)
                .with("requestTypeCode", r.requestTypeCode).with("requestTypeName", r.requestTypeCode == null ? null : AsCodes.REQUEST_TYPE_NAME.get(r.requestTypeCode))
                .with("symptom", r.symptom).with("installPlace", r.installPlace)
                .with("deviceId", r.deviceId).with("deviceName", r.deviceName).with("assetId", r.assetId)
                .with("equipmentName", r.equipmentName).with("productName", r.productName).with("modelName", r.modelName).with("quantity", r.quantity)
                .with("visitRequestAt", r.visitRequestAt).with("status", r.status).with("statusName", AsCodes.STATUS_NAME.get(r.status))
                .with("requestAt", r.requestAt).with("vendorId", r.vendorId).with("vendorName", v == null ? null : v.vendorName)
                .with("engineerUserId", r.engineerUserId).with("engineerName", r.engineerName != null ? r.engineerName : eng == null ? null : eng.userName)
                .with("engineerTel", eng == null ? null : eng.mobile)
                // 처리 담당: VENDOR 업체 · REGION 교육지원청 · PROVINCE 교육청 (담당자는 engineerName)
                .with("handlerType", r.handlerType == null ? "VENDOR" : r.handlerType)
                .with("handlerName", "REGION".equals(r.handlerType) ? (reg == null ? "교육지원청" : reg.regionName + " 교육지원청")
                        : "PROVINCE".equals(r.handlerType) ? "교육청" : v == null ? null : v.vendorName)
                .with("receivedAt", r.receivedAt).with("visitPlannedAt", r.visitPlannedAt).with("completedAt", r.completedAt)
                .with("returnReason", r.returnReason).with("transferFromTy", r.transferFromTy).with("transferContent", r.transferContent)
                .with("hasReport", r.processContent != null)
                // 현장 도착 시각 (도착 기록 또는 보고서의 방문일시)
                .with("visitAt", r.visitAt)
                .with("processTypeCode", r.processTypeCode).with("processTypeName", r.processTypeCode == null ? null : AsCodes.PROCESS_TYPE_NAME.get(r.processTypeCode))
                .with("processAmount", r.processAmount)
                .with("evalScore", r.evalScore).with("evaluatedAt", r.evaluatedAt)
                .with("attachFileIds", ids(r.attachFileIds));
    }

    private static String userName(Ref ref, Long userId) {
        AppUser u = userId == null ? null : ref.users().get(userId);
        return u == null ? null : u.userName;
    }

    private static List<Long> ids(String csv) {
        if (csv == null || csv.isBlank()) return List.of();
        return Arrays.stream(csv.split(",")).map(String::trim).filter(x -> !x.isEmpty()).map(Long::valueOf).toList();
    }

    public List<Json> rows(List<AsRequest> list, Long orgId) {
        Ref ref = ref(orgId);
        return list.stream().map(r -> row(r, ref)).toList();
    }

    /** 첨부 파일 id csv → [{fileId, name, size, url}] */
    private List<Json> fileInfos(String csv) {
        if (csv == null || csv.isBlank()) return List.of();
        List<Long> fid = java.util.Arrays.stream(csv.split(",")).map(String::trim).filter(x -> !x.isEmpty()).map(Long::valueOf).toList();
        Map<Long, com.bingoasm.domain.StoredFile> m = files.findAllById(fid).stream().collect(Collectors.toMap(f -> f.fileId, f -> f));
        return fid.stream().map(m::get).filter(java.util.Objects::nonNull).map(f -> Json.obj().with("fileId", f.fileId).with("name", f.originalName)
                .with("size", f.fileSize).with("url", "/files/" + f.fileId + "/download")).toList();
    }

    // ---------- queries ----------

    public record Filter(String rceptTy, String keyword, String searchType, LocalDate fromDate, LocalDate toDate, String status,
                         Long schoolId, Long regionId, Long vendorId, Long engineerUserId, boolean mine, boolean unassigned, String sort, boolean myTypes) {}

    private Specification<AsRequest> spec(CurrentUser me, Filter f) {
        Set<Long> regionSchools = f.regionId() == null && !"region".equals(f.searchType()) ? null
                : schoolService.schoolMap(me.orgId()).values().stream()
                .filter(s -> f.regionId() != null ? f.regionId().equals(s.regionId)
                        : s.regionId != null && schoolService.regionMap(me.orgId()).getOrDefault(s.regionId, new Region()).regionName != null
                        && schoolService.regionMap(me.orgId()).get(s.regionId).regionName.contains(Optional.ofNullable(f.keyword()).orElse("")))
                .map(s -> s.schoolId).collect(Collectors.toSet());
        // 교육청이 쓰지 않는 서비스의 신청은 목록·엑셀에서 빠진다. 기록은 남아 다시 켜면 그대로 보인다.
        List<String> inUse = permissions.asTypes(me.orgId());
        // 내 담당 유형만: 교육지원청 담당자에게 정해 둔 담당 AS 유형 (정하지 않았으면 거르지 않는다)
        List<String> duty = f.myTypes() ? me.user().asTypeList() : List.of();
        return scope(me).and((root, q, cb) -> {
            List<Predicate> p = new ArrayList<>();
            p.add(root.get("rceptTy").in(inUse));
            if (!duty.isEmpty()) p.add(root.get("rceptTy").in(duty));
            if (!Params.blank(f.rceptTy())) p.add(cb.equal(root.get("rceptTy"), f.rceptTy()));
            if (!Params.blank(f.status())) p.add(cb.equal(root.get("status"), f.status()));
            if (f.fromDate() != null) p.add(cb.greaterThanOrEqualTo(root.get("requestAt"), f.fromDate().atStartOfDay()));
            if (f.toDate() != null) p.add(cb.lessThan(root.get("requestAt"), f.toDate().plusDays(1).atStartOfDay()));
            if (f.schoolId() != null) p.add(cb.equal(root.get("schoolId"), f.schoolId()));
            if (f.vendorId() != null) p.add(cb.equal(root.get("vendorId"), f.vendorId()));
            if (f.engineerUserId() != null) p.add(cb.equal(root.get("engineerUserId"), f.engineerUserId()));
            if (f.mine()) p.add(cb.equal(root.get("applicantUserId"), me.userId()));
            if (f.unassigned()) p.add(cb.isNull(root.get("vendorId")));
            if (regionSchools != null) p.add(regionSchools.isEmpty() ? cb.disjunction() : root.get("schoolId").in(regionSchools));
            if (!Params.blank(f.keyword()) && !"region".equals(f.searchType())) {
                String kw = f.keyword().trim();
                String like = "%" + kw.toLowerCase() + "%";
                if ("applicant".equals(f.searchType())) p.add(cb.like(cb.lower(cb.coalesce(root.get("applicantName"), "")), like));
                else if ("school".equals(f.searchType()) || Params.blank(f.searchType())) {
                    Set<Long> ids = schoolService.schoolMap(me.orgId()).values().stream().filter(s -> s.schoolName.contains(kw)).map(s -> s.schoolId).collect(Collectors.toSet());
                    if ("school".equals(f.searchType())) p.add(ids.isEmpty() ? cb.disjunction() : root.get("schoolId").in(ids));
                    else p.add(cb.or(ids.isEmpty() ? cb.disjunction() : root.get("schoolId").in(ids),
                            cb.like(cb.lower(cb.coalesce(root.get("applicantName"), "")), like),
                            cb.like(cb.lower(cb.coalesce(root.get("symptom"), "")), like),
                            cb.like(cb.lower(cb.coalesce(root.get("deviceName"), "")), like)));
                }
            }
            return cb.and(p.toArray(Predicate[]::new));
        });
    }

    private static Sort sortOf(String sort) {
        boolean asc = sort != null && sort.toLowerCase().endsWith("asc");
        return Sort.by(asc ? Sort.Direction.ASC : Sort.Direction.DESC, "requestAt").and(Sort.by(Sort.Direction.DESC, "asvcSn"));
    }

    @Transactional(readOnly = true)
    public PageResult<Json> list(CurrentUser me, Filter f, Integer page, Integer size) {
        int p = PageResult.page(page), s = PageResult.size(size);
        Page<AsRequest> res = requests.findAll(spec(me, f), PageRequest.of(p - 1, s, sortOf(f.sort())));
        List<Json> rs = rows(res.getContent(), me.orgId());
        // 목록에서 ‘만족도 평가 대기’를 강조하도록: 지금 이 사용자가 평가할 수 있는 건 (상세의 평가 버튼과 같은 조건)
        for (int i = 0; i < rs.size(); i++) if (canEvaluate(me, res.getContent().get(i))) rs.get(i).put("canEvaluate", true);
        // 지연 표시: RECEIVE(접수 지연) · ESCALATED(에스컬레이션) · VISIT(방문 지연)
        Map<String, AsAlertService.Rule> rules = alerts.rules(me.orgId());
        WorkCalendar cal = alerts.calendar(me.orgId());
        LocalDateTime now = Times.now();
        for (int i = 0; i < rs.size(); i++) {
            AsRequest r = res.getContent().get(i);
            String late = AsAlertService.lateOf(r, rules.get(r.rceptTy), cal, now);
            if (late != null) rs.get(i).put("late", late);
        }
        return new PageResult<>(rs, res.getTotalElements(), p, s, res.getTotalPages());
    }

    // ---------- 스쿨넷 처리 담당 ----------

    private static boolean provinceUser(AppUser u) {
        return u.schoolId == null && u.vendorId == null && u.regionId == null && u.roles.contains("EDU_ADMIN");
    }

    private Long schoolRegion(AsRequest r) {
        School s = r.schoolId == null ? null : schoolService.schoolMap(r.orgId).get(r.schoolId);
        return s == null ? null : s.regionId;
    }

    /** 처리 담당 지정 창의 선택지: 통신사(스쿨넷 업체, 교육지원청은 관할 지역 업체만) · 관할 교육지원청 담당자 · 교육청 담당자. */
    private Json handlerOptions(CurrentUser me, AsRequest r, Ref ref) {
        Long rid = schoolRegion(r);
        List<Json> vendors = schoolService.vendorMap(me.orgId()).values().stream()
                .filter(v -> v.serviceTypeList().contains(r.rceptTy) && (!me.scope().region() || schoolService.vendorCovers(v, me.scope().regionId())))
                .sorted(Comparator.comparing((Vendor v) -> v.vendorName))
                .map(v -> Json.obj().with("vendorId", v.vendorId).with("vendorName", v.vendorName)).toList();
        // 추천 통신사: 대상 장비(회선)의 업체 → 학교 배정 업체
        Long suggested = r.deviceId == null ? null : devices.findById(r.deviceId).map(d -> d.vendorId).orElse(null);
        if (suggested == null) suggested = schoolService.resolveVendor(r.schoolId, r.rceptTy).map(sv -> sv.vendorId).orElse(null);
        List<Json> region = new ArrayList<>(), province = new ArrayList<>();
        for (AppUser u : ref.users().values()) {
            if (!"ACTIVE".equals(u.status)) continue;
            Json p = Json.obj().with("userId", u.userId).with("userName", u.userName).with("positionName", u.positionName)
                    .with("covers", u.coversAsType(r.rceptTy));
            if (u.roles.contains("REGION_ADMIN") && rid != null && rid.equals(u.regionId)) region.add(p);
            else if (provinceUser(u)) province.add(p);
        }
        return Json.obj().with("vendors", vendors).with("suggestedVendorId", suggested).with("regionUsers", region).with("provinceUsers", province)
                .with("current", Json.obj().with("handlerType", r.handlerType == null ? "VENDOR" : r.handlerType).with("vendorId", r.vendorId).with("userId", r.engineerUserId));
    }

    /**
     * 처리 담당 지정 (스쿨넷): body { handlerType: VENDOR|REGION|PROVINCE, vendorId?, userId? }.
     * VENDOR = 통신사에 넘김 (그 업체 관리자가 기사를 정한다). REGION = 교육지원청 직접 처리 (담당자를 비우면 그 교육지원청의 스쿨넷 담당 모두).
     * PROVINCE = 교육청으로 올림 (담당자 필수). 담당이 바뀌면 다시 신청완료(접수 전)로 돌아가 새 담당이 접수한다.
     */
    private void handler(CurrentUser me, AsRequest r, String prev, Map<String, Object> b) {
        String type = Params.str(b, "handlerType");
        Long uid = Params.lng(b, "userId");
        String before = (r.handlerType == null ? "VENDOR" : r.handlerType) + ":" + r.vendorId + ":" + r.engineerUserId;
        String text;
        Set<Long> to;
        switch (type == null ? "" : type) {
            case "VENDOR" -> {
                Long vid = Params.lng(b, "vendorId");
                Vendor v = vid == null ? null : schoolService.vendorMap(me.orgId()).get(vid);
                if (v == null) throw ApiException.badRequest("넘길 통신사(업체)를 선택해 주세요.");
                if (!v.serviceTypeList().contains(r.rceptTy)) throw ApiException.badRequest(v.vendorName + "은(는) " + AsCodes.RCEPT_TY_NAME.get(r.rceptTy) + " 업체가 아닙니다.");
                if (me.scope().region() && !schoolService.vendorCovers(v, me.scope().regionId()))
                    throw ApiException.badRequest(v.vendorName + "은(는) 관할 지역을 담당하지 않는 업체입니다.");
                r.handlerType = "VENDOR"; r.vendorId = v.vendorId; r.engineerUserId = null; r.engineerName = null;
                text = "통신사에 넘김: " + v.vendorName;
                to = notices.vendorSide(r);
            }
            case "REGION" -> {
                Long rid = schoolRegion(r);
                AppUser u = uid == null ? null : users.findById(uid)
                        .filter(x -> "ACTIVE".equals(x.status) && x.roles.contains("REGION_ADMIN") && rid != null && rid.equals(x.regionId))
                        .orElseThrow(() -> ApiException.badRequest("관할 교육지원청 담당자를 선택해 주세요."));
                r.handlerType = "REGION"; r.vendorId = null;
                r.engineerUserId = u == null ? null : u.userId; r.engineerName = u == null ? null : u.userName;
                text = "교육지원청 직접 처리" + (u == null ? "" : ": " + u.userName);
                to = u == null ? notices.regionSide(r, rid) : Set.of(u.userId);
            }
            case "PROVINCE" -> {
                AppUser u = uid == null ? null : users.findById(uid).filter(x -> "ACTIVE".equals(x.status) && x.orgId.equals(me.orgId()) && provinceUser(x)).orElse(null);
                if (u == null) throw ApiException.badRequest("교육청 담당자를 선택해 주세요.");
                r.handlerType = "PROVINCE"; r.vendorId = null; r.engineerUserId = u.userId; r.engineerName = u.userName;
                text = "교육청으로 올림: " + u.userName;
                to = Set.of(u.userId);
            }
            default -> throw ApiException.badRequest("처리 담당을 선택해 주세요.");
        }
        String after = r.handlerType + ":" + r.vendorId + ":" + r.engineerUserId;
        if (after.equals(before)) throw ApiException.badRequest("이미 그 담당입니다.");
        // 담당 종류 · 업체가 바뀌면 새 담당이 다시 접수한다 (같은 곳 안에서 담당자만 바꾸면 그대로).
        boolean moved = !after.split(":")[0].equals(before.split(":")[0]) || !String.valueOf(r.vendorId).equals(before.split(":")[1]);
        if (moved && "R".equals(r.status) && r.processContent == null) { r.status = "A"; r.receivedAt = null; r.visitPlannedAt = null; r.visitAt = null; }
        history(r, prev, "HANDLER", text, me.userId());
        notices.notify(to, me.userId(), r, "AS_ASSIGNED", label(r) + " 처리 담당", schoolName(r) + " · " + text + " · " + clip(r.symptom, 60));
    }

    // ---------- 장비 라벨 QR: 이 장비의 AS · 문의처 ----------

    /**
     * 장비 정보(QR) 화면에 붙는 AS 정보. 장비를 볼 수 있는지는 호출 전에 확인한다 (WirelessDeviceService.scanView).
     * <ul>
     *   <li>open — 이 장비에 걸린 처리 중 AS (신청완료 · 접수완료). 볼 수 없는 건(다른 기사 배정 등)은 상태만 (중복 신고 · 중복 출동 방지).</li>
     *   <li>count90 — 최근 90일 이 장비의 AS 건수 (취소 제외).</li>
     *   <li>unlinked — 같은 학교 · 같은 유형의 처리 중 신고 중 대상 장비가 아직 지정되지 않은 건수 (볼 수 있는 것만).</li>
     *   <li>contacts — 담당 업체 · 기본 담당 기사 · 이 유형을 맡은 관할 교육지원청 담당자.</li>
     * </ul>
     */
    @Transactional(readOnly = true)
    public Json deviceAs(CurrentUser me, Long deviceId, String ty, Long schoolId) {
        Ref ref = ref(me.orgId());
        LocalDateTime now = Times.now();
        List<AsRequest> mine = requests.findByOrgIdAndUseYn(me.orgId(), "Y").stream()
                .filter(r -> deviceId.equals(r.deviceId) && ty.equals(r.rceptTy)).toList();
        List<Json> open = new ArrayList<>();
        for (AsRequest r : mine.stream().filter(r -> "A".equals(r.status) || "R".equals(r.status))
                .sorted(Comparator.comparing((AsRequest r) -> r.requestAt, Comparator.nullsLast(Comparator.naturalOrder()))).toList()) {
            boolean see = inScope(me, r);
            Json j = Json.obj().with("asvcSn", r.asvcSn).with("status", r.status).with("statusName", AsCodes.STATUS_NAME.get(r.status))
                    .with("requestAt", r.requestAt).with("canOpen", see);
            if (see) {
                List<String> acts = allowedActions(me, r);
                j.with("symptom", clip(r.symptom, 60)).with("visitPlannedAt", r.visitPlannedAt).with("visitAt", r.visitAt)
                        .with("engineerName", r.engineerName != null ? r.engineerName : userName(ref, r.engineerUserId))
                        .with("assignedToMe", me.userId().equals(r.engineerUserId))
                        .with("canArrive", acts.contains("arrive")).with("canReport", acts.contains("report")).with("canReceive", acts.contains("receive"));
            }
            open.add(j);
        }
        long count90 = mine.stream().filter(r -> r.requestAt != null && r.requestAt.isAfter(now.minusDays(90))).count();
        long unlinked = requests.findByOrgIdAndUseYnAndStatusIn(me.orgId(), "Y", List.of("A", "R")).stream()
                .filter(r -> ty.equals(r.rceptTy) && schoolId != null && schoolId.equals(r.schoolId) && r.deviceId == null && inScope(me, r)).count();

        // 문의처
        Json contacts = Json.obj();
        schoolService.resolveVendor(schoolId, ty).ifPresent(sv -> {
            Vendor v = sv.vendorId == null ? null : ref.vendors().get(sv.vendorId);
            if (v != null) contacts.put("vendor", Json.obj().with("vendorName", v.vendorName).with("tel", v.tel));
            AppUser e = sv.engineerUserId == null ? null : ref.users().get(sv.engineerUserId);
            if (e != null && "ACTIVE".equals(e.status)) contacts.put("engineer", Json.obj().with("userName", e.userName).with("tel", e.mobile));
        });
        School s = schoolId == null ? null : ref.schools().get(schoolId);
        AsRequest probe = new AsRequest(); probe.orgId = me.orgId(); probe.rceptTy = ty;
        List<Json> region = new ArrayList<>();
        for (Long uid : notices.regionSide(probe, s == null ? null : s.regionId)) {
            AppUser u = ref.users().get(uid);
            if (u != null && "ACTIVE".equals(u.status))
                region.add(Json.obj().with("userName", u.userName).with("positionName", u.positionName).with("tel", u.mobile)
                        .with("regionName", Optional.ofNullable(ref.regions().get(u.regionId)).map(x -> x.regionName).orElse(null)));
        }
        contacts.put("region", region);
        return Json.obj().with("open", open).with("count90", count90).with("unlinked", unlinked).with("contacts", contacts);
    }

    // ---------- 내 할 일 ----------

    private record Bucket(String key, String label, String hint, java.util.function.Predicate<AsRequest> test, Comparator<AsRequest> order) {}

    /**
     * 지금 이 사용자가 처리해야 할 AS를 묶음별로 (홈 화면의 '내 할 일'). 묶음은 계정 종류 · 처리 기능 권한에 맞는 것만 나오고,
     * 건수와 오래된 순 5건을 준다. 교육지원청 담당자는 담당 AS 유형만 (정했으면).
     */
    @Transactional(readOnly = true)
    public Json todo(CurrentUser me) {
        List<String> inUse = permissions.asTypes(me.orgId());
        List<String> duty = me.scope().region() ? me.user().asTypeList() : List.of();
        List<AsRequest> all = requests.findAll(scope(me)).stream()
                .filter(r -> inUse.contains(r.rceptTy) && (duty.isEmpty() || duty.contains(r.rceptTy))).toList();
        Map<String, AsAlertService.Rule> rules = alerts.rules(me.orgId());
        LocalDateTime now = Times.now();
        LocalDate today = Times.today();
        boolean manager = isAdmin(me) || isRegionManager(me);
        boolean vendor = isVendorSide(me);
        boolean vendorAdmin = vendor && me.can("AS_ENGINEER_ASSIGN");
        WorkCalendar cal = alerts.calendar(me.orgId());
        java.util.function.Function<AsRequest, String> late = r -> AsAlertService.lateOf(r, rules.get(r.rceptTy), cal, now);
        Comparator<AsRequest> oldest = Comparator.comparing((AsRequest r) -> r.requestAt, Comparator.nullsLast(Comparator.naturalOrder()));
        Comparator<AsRequest> byVisit = Comparator.comparing((AsRequest r) -> r.visitPlannedAt, Comparator.nullsLast(Comparator.naturalOrder()));

        List<Bucket> buckets = new ArrayList<>();
        if (manager || vendor) {
            buckets.add(new Bucket("receive-late", "접수 지연", "기준 시간 안에 접수되지 않은 신청",
                    r -> "A".equals(r.status) && late.apply(r) != null, oldest));
            buckets.add(new Bucket("visit-late", "방문 지연", "방문예정일시가 지났는데 처리 보고서가 없는 건",
                    r -> "VISIT".equals(late.apply(r)), byVisit));
        }
        if (manager && me.can("AS_ASSIGN"))
            buckets.add(new Bucket("triage", "스쿨넷 1차 확인", "교육지원청이 먼저 확인합니다 — 직접 처리하거나 통신사에 넘기세요",
                    r -> "S".equals(r.rceptTy) && "A".equals(r.status) && "REGION".equals(r.handlerType) && r.engineerUserId == null, oldest));
        if (manager)
            buckets.add(new Bucket("mine", "내가 처리할 건", "교육지원청 · 교육청이 직접 처리하기로 한, 내가 담당인 건",
                    r -> officeHandled(r) && me.userId().equals(r.engineerUserId) && ("A".equals(r.status) || "R".equals(r.status)), oldest));
        // 대상 장비는 무선망만 꼭 지정한다 (스쿨넷은 선택)
        if (manager && me.can("AS_DEVICE"))
            buckets.add(new Bucket("device", "대상 장비 지정", "학교가 신고한 무선망 AS에 장애 장비를 연결해 주세요 (장비의 업체가 맡게 됩니다)",
                    r -> "M".equals(r.rceptTy) && ("A".equals(r.status) || "R".equals(r.status)) && r.deviceId == null, oldest));
        if (manager && me.can("AS_ASSIGN"))
            buckets.add(new Bucket("vendor", "업체 미배정", "담당 업체가 정해지지 않은 신청",
                    r -> "A".equals(r.status) && r.vendorId == null && !officeHandled(r), oldest));
        if ((manager || vendorAdmin) && me.can("AS_ENGINEER_ASSIGN"))
            buckets.add(new Bucket("engineer", "기사 미배정", "업체는 정해졌지만 담당 기사가 없는 건",
                    r -> ("A".equals(r.status) || "R".equals(r.status)) && r.vendorId != null && r.engineerUserId == null, oldest));
        if (vendor && me.can("AS_RECEIVE"))
            buckets.add(new Bucket("receive", "접수 대기", "아직 접수하지 않은 신청",
                    r -> "A".equals(r.status), oldest));
        if (vendor)
            buckets.add(new Bucket("visit-soon", "오늘 · 내일 방문", "방문예정일이 오늘이나 내일인 건",
                    r -> "R".equals(r.status) && r.visitPlannedAt != null && AsAlertService.noReport(r)
                            && !r.visitPlannedAt.toLocalDate().isBefore(today) && !r.visitPlannedAt.toLocalDate().isAfter(today.plusDays(1)), byVisit));
        if (me.can("AS_EVALUATE"))
            buckets.add(new Bucket("evaluate", "만족도 평가 대기", "처리가 끝난 신청의 만족도를 평가해 주세요",
                    r -> canEvaluate(me, r), Comparator.comparing((AsRequest r) -> r.completedAt, Comparator.nullsLast(Comparator.naturalOrder()))));
        if (manager)
            buckets.add(new Bucket("low-score", "낮은 만족도", "최근 30일 안에 2점 이하로 평가된 건 — 확인이 필요합니다",
                    r -> "C".equals(r.status) && r.evalScore != null && r.evalScore <= 2 && r.evaluatedAt != null && r.evaluatedAt.isAfter(now.minusDays(30)),
                    Comparator.comparing((AsRequest r) -> r.evaluatedAt, Comparator.nullsLast(Comparator.reverseOrder()))));

        Ref ref = ref(me.orgId());
        List<Json> out = new ArrayList<>();
        long total = 0;
        for (Bucket b : buckets) {
            List<AsRequest> l = all.stream().filter(b.test()).sorted(b.order()).toList();
            total += l.size();
            out.add(Json.obj().with("key", b.key()).with("label", b.label()).with("hint", b.hint()).with("count", l.size())
                    .with("rows", l.stream().limit(5).map(r -> {
                        Json j = row(r, ref);
                        Json x = Json.obj();
                        for (String k : List.of("asvcSn", "rceptTy", "rceptTyName", "schoolName", "status", "statusName", "requestAt", "visitPlannedAt",
                                "vendorName", "engineerName", "evalScore")) x.put(k, j.get(k));
                        x.put("symptom", clip(r.symptom, 40));
                        x.put("late", late.apply(r));
                        return x;
                    }).toList()));
        }
        return Json.obj().with("buckets", out).with("total", total).with("dutyTypes", duty);
    }

    @Transactional(readOnly = true)
    public List<Json> listAll(CurrentUser me, Filter f) {
        return rows(requests.findAll(spec(me, f), sortOf(f.sort())), me.orgId());
    }

    /** 유형×상태 건수. 학교·업체 범위가 그대로 적용된다. */
    @Transactional(readOnly = true)
    public Json summary(CurrentUser me) {
        List<String> inUse = permissions.asTypes(me.orgId());
        List<AsRequest> list = requests.findAll(scope(me)).stream().filter(r -> inUse.contains(r.rceptTy)).toList();
        Json byType = Json.obj();
        for (String ty : AsCodes.RCEPT_TYPES) {
            Json st = Json.obj();
            for (String s : List.of("A", "R", "C", "X")) st.put(s, list.stream().filter(r -> ty.equals(r.rceptTy) && s.equals(r.status)).count());
            st.put("total", list.stream().filter(r -> ty.equals(r.rceptTy)).count());
            byType.put(ty, st);
        }
        LocalDate today = Times.today();
        return Json.obj().with("byType", byType)
                .with("requested", list.stream().filter(r -> "A".equals(r.status)).count())
                .with("received", list.stream().filter(r -> "R".equals(r.status)).count())
                .with("completed", list.stream().filter(r -> "C".equals(r.status)).count())
                .with("returned", list.stream().filter(r -> "X".equals(r.status)).count())
                .with("todayRequested", list.stream().filter(r -> r.requestAt != null && r.requestAt.toLocalDate().equals(today)).count())
                .with("waitingEval", list.stream().filter(r -> "C".equals(r.status) && r.evalScore == null).count());
    }

    @Transactional(readOnly = true)
    public Json detail(CurrentUser me, Long sn) {
        AsRequest r = load(me, sn);
        Ref ref = ref(me.orgId());
        Json j = row(r, ref);
        // installPlace·deviceName은 신청 당시 그대로 두고, 장비가 옮겨졌을 수 있으니 지금 위치를 따로 준다.
        j.put("deviceCurrentPlace", deviceService.currentPlace(me.orgId(), r.deviceId));
        School s = r.schoolId == null ? null : ref.schools().get(r.schoolId);
        if (s != null) j.put("school", Json.obj().with("schoolId", s.schoolId).with("schoolName", s.schoolName).with("address", s.address).with("tel", s.tel));
        Vendor v = r.vendorId == null ? null : ref.vendors().get(r.vendorId);
        if (v != null) j.put("vendor", Json.obj().with("vendorId", v.vendorId).with("vendorName", v.vendorName).with("tel", v.tel));
        if (r.processContent != null) {
            j.put("report", Json.obj().with("engineerName", r.engineerName).with("visitAt", r.visitAt).with("visitEndAt", r.visitEndAt)
                    .with("troubleSymptom", r.troubleSymptom).with("inspectContent", r.inspectContent)
                    .with("processTypeCode", r.processTypeCode).with("processTypeName", r.processTypeCode == null ? null : AsCodes.PROCESS_TYPE_NAME.get(r.processTypeCode))
                    .with("processContent", r.processContent).with("processAmount", r.processAmount)
                    .with("costItems", costItems.findByAsvcSnOrderBySortOrderAsc(sn).stream().map(c -> Json.obj()
                            .with("costType", c.costType).with("costTypeName", AsCodes.COST_TYPE_NAME.get(c.costType)).with("itemName", c.itemName)
                            .with("quantity", c.quantity).with("unitPrice", c.unitPrice).with("amount", c.amount)).toList())
                    .with("fileIds", ids(r.reportFileIds)).with("files", fileInfos(r.reportFileIds)));
        }
        // 신청 첨부는 보고서가 없어도(신청완료·접수완료 상태) 보여야 한다.
        j.put("attachments", fileInfos(r.attachFileIds));
        j.put("reportFiles", fileInfos(r.reportFileIds));
        if (r.evalScore != null) j.put("evaluation", Json.obj().with("score", r.evalScore).with("opinion", r.evalOpinion).with("evaluatedAt", r.evaluatedAt));
        j.put("histories", histories.findByAsvcSnOrderByCreatedAtAscHistoryIdAsc(sn).stream().map(h -> Json.obj()
                .with("historyId", h.historyId).with("prevStatus", h.prevStatus).with("status", h.status).with("statusName", AsCodes.STATUS_NAME.get(h.status))
                .with("action", h.action).with("content", h.content).with("workerId", h.workerId)
                .with("workerName", h.workerId == null ? null : Optional.ofNullable(ref.users().get(h.workerId)).map(u -> u.userName).orElse(null))
                .with("createdAt", h.createdAt)).toList());
        j.put("allowedActions", allowedActions(me, r));
        if (j.get("allowedActions") instanceof List<?> acts0 && acts0.contains("handler")) j.put("handlerOptions", handlerOptions(me, r, ref));
        // 기사 배정 추천: 학교 관리의 기본 담당 기사 (같은 업체 · 사용 중인 계정일 때만)
        if (r.engineerUserId == null && r.vendorId != null && j.get("allowedActions") instanceof List<?> acts && acts.contains("engineer"))
            schoolService.resolveVendor(r.schoolId, r.rceptTy)
                    .filter(sv -> sv.engineerUserId != null && r.vendorId.equals(sv.vendorId))
                    .map(sv -> ref.users().get(sv.engineerUserId))
                    .filter(u -> u != null && "ACTIVE".equals(u.status) && r.vendorId.equals(u.vendorId))
                    .ifPresent(u -> j.with("suggestedEngineerUserId", u.userId).with("suggestedEngineerName", u.userName));
        return j;
    }

    /** 동작 → 그 동작을 여는 처리 기능 권한. 여기 없는 동작(방문·보고서·평가·배정·수정)은 기존 조건만 본다. */
    private static final Map<String, String> ACTION_PERM = Map.ofEntries(
            Map.entry("receive", "AS_RECEIVE"), Map.entry("return", "AS_RETURN"), Map.entry("return-cancel", "AS_RETURN"), Map.entry("transfer", "AS_TRANSFER"),
            Map.entry("cancel", "AS_CANCEL"), Map.entry("delete", "AS_DELETE"), Map.entry("assign", "AS_ASSIGN"), Map.entry("visit", "AS_VISIT"),
            Map.entry("report", "AS_REPORT"), Map.entry("device", "AS_DEVICE"), Map.entry("engineer", "AS_ENGINEER_ASSIGN"),
            Map.entry("arrive", "AS_REPORT"), Map.entry("handler", "AS_ASSIGN"));

    /** 신청자(또는 그 학교 담당자)가 처리완료 건을 아직 평가하지 않았고 평가 권한이 있는가. */
    private boolean canEvaluate(CurrentUser me, AsRequest r) {
        return "C".equals(r.status) && r.evalScore == null && me.can("AS_EVALUATE") && isOwner(me, r);
    }

    private boolean isOwner(CurrentUser me, AsRequest r) {
        return me.userId().equals(r.applicantUserId) || (isSchoolSide(me) && me.scope().schoolId().equals(r.schoolId));
    }

    /** 현재 상태와 권한으로 지금 할 수 있는 동작. 화면의 버튼 표시용. */
    public List<String> allowedActions(CurrentUser me, AsRequest r) {
        List<String> a = new ArrayList<>();
        // 처리(접수 · 방문 · 보고서 · 반려 · 이관): 도교육청 · 배정된 업체, 그리고 처리 기능을 켜 준 교육지원청 담당자(관내 건만).
        // 어떤 처리를 할 수 있는지는 아래에서 처리 기능 권한(AS_RECEIVE 등)으로 거른다.
        // 교육지원청은 처리 담당이 교육지원청인 건(스쿨넷 직접 처리)만 처리한다. 업체가 맡은 건은 업체가.
        boolean process = (me.can("AS_PROCESS") && (isAdmin(me) || (isVendorSide(me) && me.scope().vendorId().equals(r.vendorId))))
                || (isRegionManager(me) && "REGION".equals(r.handlerType));
        boolean owner = isOwner(me, r);
        // load()/inScope already limit a 교육지원청 담당자 to their district, so here they act like an admin (minus delete).
        boolean manager = isAdmin(me) || isRegionManager(me);
        switch (r.status) {
            case "A" -> { if (process) a.addAll(List.of("receive", "return", "transfer")); if (owner || manager) a.addAll(List.of("update", "cancel")); }
            case "R" -> {
                if (process) a.addAll(List.of("visit", "report", "transfer"));
                // 현장 도착 기록 (장비 라벨 QR): 아직 도착 · 보고서가 없을 때
                if (process && r.visitAt == null && r.processContent == null) a.add("arrive");
            }
            case "C" -> {
                if (process) a.add("report");
                if (canEvaluate(me, r)) a.add("evaluate");
            }
            case "X" -> { if (process) a.add("return-cancel"); if (owner || manager) a.add("cancel"); }
            default -> { }
        }
        // 업체 배정. 스쿨넷은 대신 '처리 담당 지정' (통신사에 넘김 · 교육지원청 직접 처리 · 교육청으로 올림)
        if ("S".equals(r.rceptTy)) { if (manager && ("A".equals(r.status) || "R".equals(r.status))) a.add("handler"); }
        else if (manager && !"C".equals(r.status)) a.add("assign");
        // 대상 장비 지정: 교육청 · 교육지원청이 무선망 · 스쿨넷 건에 (취소 · 삭제 전까지)
        if (manager && ("M".equals(r.rceptTy) || "S".equals(r.rceptTy)) && !"X".equals(r.status)) a.add("device");
        // 기사 배정: 업체가 정해진 건을 처리 전(신청완료 · 접수완료)에 — 그 업체의 업체 관리자, 교육청 · 교육지원청
        if (r.vendorId != null && ("A".equals(r.status) || "R".equals(r.status))
                && (manager || (isVendorSide(me) && me.scope().vendorId().equals(r.vendorId)))) a.add("engineer");
        if (isAdmin(me)) a.add("delete");
        // 사용자별로 끈 처리 기능 (Roles.ACTION_PERMS)
        a.removeIf(x -> ACTION_PERM.containsKey(x) && !me.can(ACTION_PERM.get(x)));
        return a;
    }

    // ---------- commands ----------

    private static final long MAX_AMOUNT = 100_000_000L;
    private static final int MAX_COST_LINES = 20;
    private static final int MAX_REPORT_FILES = 5;

    /** 첨부 파일 id 목록 → csv (빈 목록은 null). 개수와 실제로 올라간 파일인지 확인한다. */
    private String attachments(Object raw, int max, String what) {
        String v = csv(raw);
        if (Params.blank(v)) return null;
        List<Long> fid;
        try { fid = ids(v).stream().distinct().toList(); } catch (NumberFormatException e) { throw ApiException.badRequest(what + " 파일이 올바르지 않습니다."); }
        if (fid.size() > max) throw ApiException.badRequest(what + " 파일은 " + max + "개까지 첨부할 수 있습니다.");
        if (files.findAllById(fid).size() != fid.size()) throw ApiException.badRequest(what + " 파일을 찾을 수 없습니다. 다시 올려 주세요.");
        return fid.stream().map(String::valueOf).collect(Collectors.joining(","));
    }

    /**
     * 보고서 비용 항목을 통째로 바꾼다. 줄마다 구분(PART·LABOR·TRAVEL·ETC)·품목·수량(1~999)·단가(0~1억)를 검사하고, 합계를 돌려준다.
     * 빈 목록이면 항목을 모두 지우고 0.
     */
    private long saveCostItems(Long asvcSn, List<?> lines) {
        if (lines.size() > MAX_COST_LINES) throw ApiException.badRequest("비용 항목은 " + MAX_COST_LINES + "줄까지 입력할 수 있습니다.");
        List<AsCostItem> items = new ArrayList<>();
        long total = 0;
        for (Object o : lines) {
            if (!(o instanceof Map<?, ?> raw)) throw ApiException.badRequest("비용 항목이 올바르지 않습니다.");
            @SuppressWarnings("unchecked") Map<String, Object> m = (Map<String, Object>) raw;
            AsCostItem c = new AsCostItem();
            c.asvcSn = asvcSn;
            c.costType = Params.str(m, "costType");
            if (c.costType == null || !AsCodes.COST_TYPE_NAME.containsKey(c.costType)) throw ApiException.badRequest("비용 구분이 올바르지 않습니다.");
            c.itemName = Params.str(m, "itemName");
            if (Params.blank(c.itemName)) c.itemName = AsCodes.COST_TYPE_NAME.get(c.costType);
            if (c.itemName.length() > 100) throw ApiException.badRequest("품목은 100자 이내로 입력해 주세요.");
            Integer qty = Params.integer(m, "quantity");
            c.quantity = qty == null ? 1 : qty;
            if (c.quantity < 1 || c.quantity > 999) throw ApiException.badRequest("수량은 1~999 사이로 입력해 주세요.");
            c.unitPrice = Params.lng(m, "unitPrice");
            if (c.unitPrice == null || c.unitPrice < 0 || c.unitPrice > MAX_AMOUNT) throw ApiException.badRequest("단가가 올바르지 않습니다.");
            c.amount = c.unitPrice * c.quantity;
            total += c.amount;
            if (total > MAX_AMOUNT) throw ApiException.badRequest("처리비용 합계가 너무 큽니다.");
            c.sortOrder = items.size() + 1;
            items.add(c);
        }
        costItems.deleteByAsvcSn(asvcSn);
        costItems.flush();
        costItems.saveAll(items);
        return total;
    }

    /** 예전 유상 청구 기록(단계·확인·지급·청구서 첨부)을 지운다. */
    private static void clearBill(AsRequest r) {
        r.billConfirmedAt = null; r.billConfirmedBy = null; r.billPaidAt = null; r.billPaidBy = null;
        r.billStatus = null; r.billFileIds = null;
    }

    // ---------- notifications (머리글 종) ----------

    /** "[무선망] AS-12" — 알림 제목 앞부분. */
    private static String label(AsRequest r) { return "[" + AsCodes.RCEPT_TY_NAME.get(r.rceptTy) + "] AS-" + r.asvcSn; }

    private String schoolName(AsRequest r) {
        School s = r.schoolId == null ? null : schoolService.schoolMap(r.orgId).get(r.schoolId);
        return s == null ? "" : s.schoolName;
    }

    /**
     * 관할 교육지원청의 담당자 중 이 AS 유형을 맡은 사람에게 알린다. 다른 쪽(학교·업체) 알림을 이미 받은 사람은 뺀다.
     */
    private void notifyRegion(AsRequest r, Set<Long> already, CurrentUser me, String type, String title, String body) {
        School s = r.schoolId == null ? null : schoolService.schoolMap(r.orgId).get(r.schoolId);
        Set<Long> to = new LinkedHashSet<>(notices.regionSide(r, s == null ? null : s.regionId));
        to.removeAll(already);
        notices.notify(to, me.userId(), r, type, title, body);
    }

    private static String when(LocalDateTime t) { return t == null ? "" : t.toString().replace('T', ' ').substring(0, 16); }

    private static String won(Long v) { return String.format("%,d원", v == null ? 0L : v); }

    private static String clip(String s, int n) { return s == null ? "" : s.length() <= n ? s : s.substring(0, n) + "…"; }

    private void history(AsRequest r, String prev, String action, String content, Long worker) {
        AsHistory h = new AsHistory();
        h.asvcSn = r.asvcSn; h.prevStatus = prev; h.status = r.status; h.action = action; h.content = content; h.workerId = worker; h.createdAt = Times.now();
        histories.save(h);
    }

    private static String tel(Map<String, Object> b) {
        String t = Params.str(b, "contactTel");
        if (t != null) return t;
        String p1 = Params.str(b, "phone1"), p2 = Params.str(b, "phone2"), p3 = Params.str(b, "phone3");
        return p1 == null && p2 == null ? null : String.join("-", Optional.ofNullable(p1).orElse(""), Optional.ofNullable(p2).orElse(""), Optional.ofNullable(p3).orElse(""));
    }

    /** visitRequestAt (ISO) 또는 visitRequestDate + visitTime("10:30") / visitTime1·visitTime2 */
    static LocalDateTime visitTime(Map<String, Object> b, String isoKey, String dateKey) {
        LocalDateTime dt = Params.dateTime(b, isoKey);
        if (dt != null) return dt;
        LocalDate d = Params.date(b, dateKey);
        if (d == null) return null;
        String t = Params.str(b, "visitTime");
        if (t == null) { String h = Params.str(b, "visitTime1"), m = Params.str(b, "visitTime2"); if (h != null) t = h + ":" + (m == null ? "00" : m); }
        if (t == null) return d.atStartOfDay().plusHours(9);
        String[] hm = t.split(":");
        return d.atTime(Integer.parseInt(hm[0]), hm.length > 1 ? Integer.parseInt(hm[1]) : 0);
    }

    private void applyRequestFields(CurrentUser me, AsRequest r, Map<String, Object> b, boolean creating) {
        String ty = r.rceptTy;
        if (b.containsKey("faultTypeCode") || creating) {
            String code = Params.str(b, "faultTypeCode");
            if (code == null) throw ApiException.badRequest("장애유형을 선택해주세요.");
            Map<String, String> names = AsCodes.FAULT_TYPES.get(ty);
            if (!names.containsKey(code)) throw ApiException.badRequest("장애유형이 올바르지 않습니다.");
            r.faultTypeCode = code;
            r.faultTypeName = "W".equals(code) ? Optional.ofNullable(Params.str(b, "faultTypeName")).orElseThrow(() -> ApiException.badRequest("장애유형을 직접 입력해주세요.")) : names.get(code);
        }
        if (b.containsKey("requestTypeCode")) { String c = Params.str(b, "requestTypeCode"); if (c != null && !AsCodes.REQUEST_TYPE_NAME.containsKey(c)) throw ApiException.badRequest("요청내용을 선택해주세요."); r.requestTypeCode = c; }
        if ("M".equals(ty) && creating && r.requestTypeCode == null) throw ApiException.badRequest("요청내용을 선택해주세요.");
        if (b.containsKey("symptom")) r.symptom = Params.str(b, "symptom");
        if (b.containsKey("installPlace")) r.installPlace = Params.str(b, "installPlace");
        if ("C".equals(ty) && creating && Params.blank(r.installPlace)) throw ApiException.badRequest("설치장소를 입력해주세요.");
        if (b.containsKey("applicantName") && Params.str(b, "applicantName") != null) r.applicantName = Params.str(b, "applicantName");
        String t = tel(b);
        if (t != null) r.contactTel = t;
        if (creating && Params.blank(r.contactTel)) throw ApiException.badRequest("연락처를 입력해주세요.");
        LocalDateTime visit = visitTime(b, "visitRequestAt", "visitRequestDate");
        if (visit != null) r.visitRequestAt = visit;
        if (creating && r.visitRequestAt == null) throw ApiException.badRequest("방문요청일자를 입력해주세요.");
        if (b.containsKey("deviceId")) {
            Long did = Params.lng(b, "deviceId");
            if (did != null) {
                // 무선망 AS는 무선장비, 스쿨넷 AS는 스쿨넷 장비만 (장비 라벨 QR에서 바로 신청할 때도 같은 규칙).
                WirelessDevice d = devices.findById(did).filter(x -> x.orgId.equals(me.orgId()) && x.rceptTy.equals(ty) && "Y".equals(x.useYn))
                        .orElseThrow(() -> ApiException.badRequest("S".equals(ty) ? "스쿨넷 장비를 다시 선택해 주세요." : "무선장비관리번호를 선택해주세요."));
                r.deviceId = d.deviceId; r.deviceName = d.deviceCode + " " + d.deviceName + (d.location == null ? "" : " (" + d.location + ")");
                // 무선망 · 스쿨넷의 설치장소는 대상 장비의 설치위치다 (직접 입력하지 않는다).
                if (d.location != null && !d.location.isBlank()) r.installPlace = d.location;
            } else r.deviceId = null;
        }
        if (b.containsKey("deviceName") && Params.str(b, "deviceName") != null) r.deviceName = Params.str(b, "deviceName");
        if (b.containsKey("assetId")) {
            Long aid = Params.lng(b, "assetId");
            if (aid != null) {
                Asset a = assets.findById(aid).filter(x -> x.orgId.equals(me.orgId())).orElseThrow(() -> ApiException.badRequest("장비를 선택해주세요."));
                r.assetId = a.assetId; r.equipmentName = a.assetName; r.productName = a.manufacturer; r.modelName = a.modelName;
                if (r.deviceName == null) r.deviceName = a.assetNo + " " + a.assetName;
            } else r.assetId = null;
        }
        if (b.containsKey("equipmentName")) r.equipmentName = Params.str(b, "equipmentName");
        if (b.containsKey("productName")) r.productName = Params.str(b, "productName");
        if (b.containsKey("modelName")) r.modelName = Params.str(b, "modelName");
        if (b.containsKey("quantity")) r.quantity = Params.integer(b, "quantity");
        if (b.containsKey("attachFileIds")) r.attachFileIds = csv(b.get("attachFileIds"));
    }

    static String csv(Object raw) {
        if (raw == null) return null;
        if (raw instanceof List<?> l) return l.stream().map(String::valueOf).filter(x -> !x.isBlank()).collect(Collectors.joining(","));
        return String.valueOf(raw);
    }

    /** 신청: 학교 담당 업체가 없으면 거부. 업체·기사는 학교 매핑에서 자동 지정. */
    public Long create(CurrentUser me, Map<String, Object> b) {
        String ty = Params.str(b, "rceptTy");
        if (ty == null || !AsCodes.RCEPT_TYPES.contains(ty)) throw ApiException.badRequest("접수 유형이 올바르지 않습니다.");
        if (!permissions.asTypes(me.orgId()).contains(ty)) throw ApiException.badRequest(AsCodes.RCEPT_TY_NAME.get(ty) + " AS는 이 교육청에서 사용하지 않는 서비스입니다.");
        String perm = "T".equals(ty) ? "SMART_REQUEST" : "AS_" + ty + "_REQUEST";
        if (!me.can(perm)) throw ApiException.forbidden("권한이 없습니다.");
        Long schoolId = isSchoolSide(me) ? me.scope().schoolId() : Params.lng(b, "schoolId");
        School school = schoolService.loadSchool(me, schoolId);
        // 스쿨넷은 교육청 설정에 따라 교육지원청이 먼저 받는다 (업체 없이). 그 밖은 학교 배정 업체.
        boolean office = "S".equals(ty) && "REGION".equals(schoolnetRoute(me.orgId()));
        SchoolVendor sv = schoolService.resolveVendor(school.schoolId, ty).orElse(null);
        if (sv == null && !office) throw ApiException.badRequest("기관에 등록된 유지보수 업체가 없습니다.");

        AsRequest r = new AsRequest();
        r.orgId = me.orgId(); r.rceptTy = ty; r.schoolId = school.schoolId;
        r.applicantUserId = me.userId(); r.applicantName = me.user().userName; r.contactTel = me.user().mobile;
        r.status = "A"; r.requestAt = Times.now();
        // 업체만 학교 배정에서 정한다. 기사는 업체 관리자가 정한다 (학교의 기본 담당 기사는 기사 배정 때 추천으로만 쓴다).
        if (office) { r.handlerType = "REGION"; r.vendorId = null; }
        else { r.handlerType = "VENDOR"; r.vendorId = sv.vendorId; }
        applyRequestFields(me, r, b, true);
        // 무선망: 장비가 붙어 온 신고(장비 라벨 QR)는 그 장비의 유지보수 업체가 맡는다.
        if ("M".equals(ty) && r.deviceId != null)
            devices.findById(r.deviceId).map(d -> d.vendorId).filter(v -> schoolService.vendorMap(me.orgId()).containsKey(v)).ifPresent(v -> r.vendorId = v);
        requests.save(r);
        history(r, null, "REQUEST", AsCodes.RCEPT_TY_NAME.get(ty) + " AS 신청 등록", me.userId());
        Set<Long> vs = notices.vendorSide(r);
        notices.notify(vs, me.userId(), r, "AS_NEW", label(r) + " 새 신청", schoolName(r) + " · " + clip(r.symptom, 80));
        notifyRegion(r, vs, me, "AS_NEW", label(r) + " 새 신청", schoolName(r) + " · " + clip(r.symptom, 80));
        return r.asvcSn;
    }

    public void update(CurrentUser me, Long sn, Map<String, Object> b) {
        AsRequest r = load(me, sn);
        if (!allowedActions(me, r).contains("update")) throw ApiException.conflict("신청완료 상태에서만 수정할 수 있습니다.");
        applyRequestFields(me, r, b, false);
        history(r, r.status, "UPDATE", "신청 내용 수정", me.userId());
    }

    public void act(CurrentUser me, Long sn, String action, Map<String, Object> b) {
        AsRequest r = load(me, sn);
        if (!allowedActions(me, r).contains(action)) {
            if (!List.of("receive", "return", "return-cancel", "transfer", "cancel", "visit", "report", "evaluate", "assign", "device", "engineer", "arrive", "handler", "delete", "update").contains(action))
                throw ApiException.notFound("지원하지 않는 처리입니다.");
            throw ApiException.conflict("현재 상태(" + AsCodes.STATUS_NAME.get(r.status) + ")에서는 처리할 수 없거나 권한이 없습니다.");
        }
        String prev = r.status;
        switch (action) {
            case "receive" -> {
                LocalDateTime planned = visitTime(b, "visitPlannedAt", "visitPlannedDate");
                if (planned == null) throw ApiException.badRequest("방문예정일시를 입력해주세요.");
                r.status = "R"; r.receivedAt = Times.now(); r.visitPlannedAt = planned;
                // 담당 기사가 아직 없을 때만 접수한 사람이 맡는다 (업체 관리자가 정해 둔 기사를 바꾸지 않는다).
                if ((isVendorSide(me) || officeHandled(r)) && r.engineerUserId == null) { r.engineerUserId = me.userId(); r.engineerName = me.user().userName; }
                history(r, prev, "RECEIVE", "접수 처리 · 방문예정 " + planned.toString().replace('T', ' '), me.userId());
                notices.notify(notices.schoolSide(r), me.userId(), r, "AS_RECEIVED", label(r) + " 접수", "방문예정 " + when(planned) + (r.engineerName == null ? "" : " · 담당 " + r.engineerName));
            }
            case "return" -> {
                String reason = Params.str(b, "reason");
                if (reason == null) throw ApiException.badRequest("반려 사유를 입력해주세요.");
                r.status = "X"; r.returnReason = reason;
                history(r, prev, "RETURN", "반려: " + reason, me.userId());
                Set<Long> ss = notices.schoolSide(r);
                notices.notify(ss, me.userId(), r, "AS_RETURNED", label(r) + " 반려", clip(reason, 200));
                notifyRegion(r, ss, me, "AS_RETURNED", label(r) + " 반려", schoolName(r) + " · " + clip(reason, 200));
            }
            case "return-cancel" -> {
                r.status = "A"; r.returnReason = null;
                history(r, prev, "RETURN_CANCEL", "반려 취소", me.userId());
                notices.notify(notices.schoolSide(r), me.userId(), r, "AS_RETURN_CANCELED", label(r) + " 반려 취소", "신청완료 상태로 돌아갔습니다.");
            }
            case "transfer" -> {
                String to = Params.str(b, "rceptTy");
                if (to == null || !AsCodes.RCEPT_TYPES.contains(to) || to.equals(r.rceptTy)) throw ApiException.badRequest("이관 메뉴를 선택해주세요.");
                if (!permissions.asTypes(r.orgId).contains(to)) throw ApiException.badRequest(AsCodes.RCEPT_TY_NAME.get(to) + " AS는 이 교육청에서 사용하지 않는 서비스입니다.");
                String content = Params.str(b, "content");
                if (content == null) throw ApiException.badRequest("이관 내용을 입력해주세요.");
                SchoolVendor sv = schoolService.resolveVendor(r.schoolId, to).orElseThrow(() -> ApiException.badRequest("이관 대상 서비스에 대한 AS 업체 또는 담당 기사가 지정되어 있지 않습니다."));
                r.transferFromTy = r.rceptTy; r.transferContent = content; r.rceptTy = to;
                // 이관된 유형의 업체로. 기사는 그 업체 관리자가 새로 정한다.
                r.vendorId = sv.vendorId; r.engineerUserId = null; r.engineerName = null;
                r.status = "A"; r.receivedAt = null; r.visitPlannedAt = null;
                Map<String, String> ft = AsCodes.FAULT_TYPES.get(to);
                if (!ft.containsKey(r.faultTypeCode)) { r.faultTypeCode = ft.keySet().iterator().next(); r.faultTypeName = ft.get(r.faultTypeCode); }
                history(r, prev, "TRANSFER", AsCodes.RCEPT_TY_NAME.get(r.transferFromTy) + " → " + AsCodes.RCEPT_TY_NAME.get(to) + " 이관: " + content, me.userId());
                String moved = AsCodes.RCEPT_TY_NAME.get(r.transferFromTy) + " → " + AsCodes.RCEPT_TY_NAME.get(to);
                Set<Long> vs = notices.vendorSide(r), ss = notices.schoolSide(r);
                notices.notify(vs, me.userId(), r, "AS_NEW", label(r) + " 이관 신청", schoolName(r) + " · " + moved);
                notices.notify(ss, me.userId(), r, "AS_TRANSFERRED", label(r) + " 이관", moved + " · " + clip(content, 120));
                // 이관된 유형을 맡은 교육지원청 담당자에게 (새 유형 기준)
                Set<Long> both = new LinkedHashSet<>(vs); both.addAll(ss);
                notifyRegion(r, both, me, "AS_NEW", label(r) + " 이관 신청", schoolName(r) + " · " + moved);
            }
            case "cancel" -> {
                r.useYn = "N";
                history(r, prev, "CANCEL", "신청 취소", me.userId());
                if (!"C".equals(prev)) {
                    Set<Long> vs = notices.vendorSide(r);
                    notices.notify(vs, me.userId(), r, "AS_CANCELED", label(r) + " 신청 취소", schoolName(r));
                    notifyRegion(r, vs, me, "AS_CANCELED", label(r) + " 신청 취소", schoolName(r));
                }
            }
            case "arrive" -> {
                // 기사가 장비 라벨을 찍고 도착을 기록한다: SLA의 현장 도착 시각, 방문 지연 알림도 멈춘다.
                r.visitAt = Times.now();
                if ((isVendorSide(me) || officeHandled(r)) && r.engineerUserId == null) { r.engineerUserId = me.userId(); r.engineerName = me.user().userName; }
                history(r, prev, "ARRIVE", "현장 도착" + (Boolean.TRUE.equals(b.get("byQr")) ? " (장비 라벨 QR)" : ""), me.userId());
                notices.notify(notices.schoolSide(r), me.userId(), r, "AS_ARRIVED", label(r) + " 기사 도착", (r.engineerName == null ? "" : r.engineerName + " · ") + when(r.visitAt));
            }
            case "visit" -> {
                LocalDateTime planned = visitTime(b, "visitPlannedAt", "visitPlannedDate");
                if (planned == null) throw ApiException.badRequest("방문예정일시를 입력해주세요.");
                r.visitPlannedAt = planned;
                history(r, prev, "VISIT", "방문예정일 수정 → " + planned.toString().replace('T', ' '), me.userId());
                notices.notify(notices.schoolSide(r), me.userId(), r, "AS_VISIT", label(r) + " 방문 일정 변경", "방문예정 " + when(planned));
            }
            case "report" -> {
                boolean first = !"C".equals(r.status);
                if (b.containsKey("engineerName") && Params.str(b, "engineerName") != null) r.engineerName = Params.str(b, "engineerName");
                LocalDateTime visitAt = visitTime(b, "visitAt", "visitDate");
                LocalDateTime endAt = visitTime(b, "visitEndAt", "visitEndDate");
                if (visitAt != null) r.visitAt = visitAt;
                if (endAt != null) r.visitEndAt = endAt;
                if (b.containsKey("troubleSymptom")) r.troubleSymptom = Params.str(b, "troubleSymptom");
                if (b.containsKey("inspectContent")) r.inspectContent = Params.str(b, "inspectContent");
                if (b.containsKey("processTypeCode")) { String c = Params.str(b, "processTypeCode"); if (c != null && !AsCodes.PROCESS_TYPE_NAME.containsKey(c)) throw ApiException.badRequest("처리유형이 올바르지 않습니다."); r.processTypeCode = c; }
                if (b.containsKey("processContent")) r.processContent = Params.str(b, "processContent");
                if (b.get("costItems") instanceof List<?> lines) r.processAmount = saveCostItems(r.asvcSn, lines);
                else if (b.containsKey("processAmount")) {
                    Long amt = Params.lng(b, "processAmount");
                    if (amt != null && (amt < 0 || amt > MAX_AMOUNT)) throw ApiException.badRequest("처리비용이 올바르지 않습니다.");
                    r.processAmount = amt;
                }
                // 처리 비용은 선택 입력. 유상·무상 구분과 청구 단계는 쓰지 않으므로, 보고서를 저장하면 예전 값을 지운다.
                r.chargeType = null;
                clearBill(r);
                if (b.containsKey("fileIds")) r.reportFileIds = attachments(b.get("fileIds"), MAX_REPORT_FILES, "보고서 첨부");
                if (Params.blank(r.processContent)) throw ApiException.badRequest("처리내용을 입력해주세요.");
                if (r.visitAt == null) r.visitAt = r.visitPlannedAt != null ? r.visitPlannedAt : Times.now();
                if (r.visitEndAt == null) r.visitEndAt = Times.now();
                r.status = "C";
                if (first || r.completedAt == null) r.completedAt = r.visitEndAt;
                history(r, prev, first ? "REPORT" : "REPORT_UPDATE", (first ? "처리 보고서 등록: " : "처리 보고서 수정: ") + r.processContent, me.userId());
                if (first) {
                    Set<Long> ss = notices.schoolSide(r);
                    notices.notify(ss, me.userId(), r, "AS_DONE", label(r) + " 처리 완료",
                            clip(r.processContent, 120) + " · 만족도 평가를 부탁드립니다.");
                    notifyRegion(r, ss, me, "AS_DONE", label(r) + " 처리 완료", schoolName(r) + " · " + clip(r.processContent, 120));
                }
            }
            case "evaluate" -> {
                Integer score = Params.integer(b, "score");
                if (score == null || score < 1 || score > 5) throw ApiException.badRequest("만족도 점수를 선택해주세요.");
                r.evalScore = score; r.evalOpinion = Params.str(b, "opinion"); r.evaluatedAt = Times.now();
                history(r, prev, "EVALUATE", "만족도 평가 " + score + "점", me.userId());
                notices.notify(notices.vendorSide(r), me.userId(), r, "AS_EVALUATED", label(r) + " 만족도 " + score + "점", schoolName(r) + (r.evalOpinion == null ? "" : " · " + clip(r.evalOpinion, 120)));
            }
            case "assign" -> {
                Long vid = Params.lng(b, "vendorId");
                Vendor v = vid == null ? null : schoolService.vendorMap(me.orgId()).get(vid);
                if (v == null) throw ApiException.badRequest("업체를 선택해주세요.");
                if (!v.serviceTypeList().contains(r.rceptTy)) throw ApiException.badRequest(v.vendorName + "은(는) " + AsCodes.RCEPT_TY_NAME.get(r.rceptTy) + " 유지관리 업체가 아닙니다.");
                // 교육지원청 담당자는 관할 지역을 맡는 업체에만 배정한다 (다른 지역 업체로 넘기지 못하게).
                if (me.scope().region() && !schoolService.vendorCovers(v, me.scope().regionId()))
                    throw ApiException.badRequest(v.vendorName + "은(는) 관할 지역을 담당하지 않는 업체입니다.");
                Long eid = Params.lng(b, "engineerUserId");
                AppUser e = eid == null ? null : users.findById(eid).filter(u -> vid.equals(u.vendorId)).orElseThrow(() -> ApiException.badRequest("담당 기사가 해당 업체 소속이 아닙니다."));
                r.vendorId = vid; r.engineerUserId = e == null ? null : e.userId; r.engineerName = e == null ? null : e.userName;
                history(r, prev, "ASSIGN", "업체 배정: " + v.vendorName + (e == null ? "" : " / " + e.userName), me.userId());
                notices.notify(notices.vendorSide(r), me.userId(), r, "AS_ASSIGNED", label(r) + " 배정", schoolName(r) + " · " + clip(r.symptom, 80));
            }
            case "device" -> {
                Long did = Params.lng(b, "deviceId");
                if (did == null) {
                    r.deviceId = null; r.deviceName = null; r.installPlace = null;
                    history(r, prev, "DEVICE", "대상 장비 지정 해제", me.userId());
                } else {
                    WirelessDevice d = devices.findById(did).filter(x -> x.orgId.equals(me.orgId()) && x.rceptTy.equals(r.rceptTy) && "Y".equals(x.useYn)
                                    && Objects.equals(x.schoolId, r.schoolId))
                            .orElseThrow(() -> ApiException.badRequest("이 학교의 " + ("S".equals(r.rceptTy) ? "스쿨넷 장비" : "무선장비") + "를 선택해 주세요."));
                    r.deviceId = d.deviceId; r.deviceName = d.deviceCode + " " + d.deviceName + (d.location == null ? "" : " (" + d.location + ")");
                    // 설치장소는 그 장비의 설치위치로 바뀐다.
                    r.installPlace = d.location;
                    history(r, prev, "DEVICE", "대상 장비 지정: " + r.deviceName, me.userId());
                    // 무선망: 처리 전이면 그 장비의 유지보수 업체가 맡는다 (업체가 바뀌면 기사는 새 업체 관리자가 정한다).
                    Vendor dv = d.vendorId == null ? null : schoolService.vendorMap(me.orgId()).get(d.vendorId);
                    if ("M".equals(r.rceptTy) && dv != null && !dv.vendorId.equals(r.vendorId) && ("A".equals(r.status) || "R".equals(r.status))) {
                        r.vendorId = dv.vendorId; r.engineerUserId = null; r.engineerName = null;
                        if ("R".equals(r.status)) { r.status = "A"; r.receivedAt = null; r.visitPlannedAt = null; }
                        history(r, prev, "ASSIGN", "업체 변경 (장비의 유지보수 업체): " + dv.vendorName, me.userId());
                        notices.notify(notices.vendorSide(r), me.userId(), r, "AS_ASSIGNED", label(r) + " 배정", schoolName(r) + " · " + clip(r.symptom, 80));
                    }
                }
            }
            case "engineer" -> {
                Long eid = Params.lng(b, "engineerUserId");
                AppUser e = eid == null ? null : users.findById(eid)
                        .filter(u -> r.vendorId.equals(u.vendorId) && "ACTIVE".equals(u.status) && (u.roles.contains("AS_ENGINEER") || u.roles.contains("VENDOR_ADMIN")))
                        .orElseThrow(() -> ApiException.badRequest("담당 기사가 이 업체 소속이 아닙니다."));
                if (e == null) throw ApiException.badRequest("담당 기사를 선택해 주세요.");
                r.engineerUserId = e.userId; r.engineerName = e.userName;
                history(r, prev, "ENGINEER", "기사 배정: " + e.userName, me.userId());
                notices.notify(Set.of(e.userId), me.userId(), r, "AS_ASSIGNED", label(r) + " 담당 배정", schoolName(r) + " · " + clip(r.symptom, 80));
            }
            case "handler" -> handler(me, r, prev, b);
            case "delete" -> {
                r.useYn = "N";
                history(r, prev, "DELETE", "관리자 삭제", me.userId());
            }
            case "update" -> { update(me, sn, b); return; }
            default -> throw ApiException.notFound("지원하지 않는 처리입니다.");
        }
    }
}
