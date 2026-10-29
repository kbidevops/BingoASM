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

    public AsRequestService(AsRequestRepository requests, AsHistoryRepository histories, SchoolService schoolService, UserRepository users,
                            WirelessDeviceRepository devices, AssetRepository assets, com.bingoasm.repo.FileRepository files, AsCostItemRepository costItems,
                            PermissionService permissions) {
        this.files = files; this.costItems = costItems; this.permissions = permissions;
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

    private Specification<AsRequest> scope(CurrentUser me) {
        Set<Long> inScope = schoolService.scopeSchoolIds(me);
        return (root, q, cb) -> {
            List<Predicate> p = new ArrayList<>();
            p.add(cb.equal(root.get("orgId"), me.orgId()));
            p.add(cb.equal(root.get("useYn"), "Y"));
            if (isAdmin(me)) return cb.and(p.toArray(Predicate[]::new));
            if (inScope != null) p.add(inScope.isEmpty() ? cb.disjunction() : root.get("schoolId").in(inScope));
            else if (me.scope().vendor()) p.add(isVendorSide(me) ? cb.equal(root.get("vendorId"), me.scope().vendorId()) : cb.disjunction());
            else p.add(cb.equal(root.get("applicantUserId"), me.userId()));
            return cb.and(p.toArray(Predicate[]::new));
        };
    }

    private boolean inScope(CurrentUser me, AsRequest r) {
        if (!r.orgId.equals(me.orgId())) return false;
        if (isAdmin(me)) return true;
        Set<Long> inScope = schoolService.scopeSchoolIds(me);
        if (inScope != null) return inScope.contains(r.schoolId);
        if (me.scope().vendor()) return isVendorSide(me) && me.scope().vendorId().equals(r.vendorId);
        return me.userId().equals(r.applicantUserId);
    }

    private AsRequest load(CurrentUser me, Long sn) {
        return requests.findById(sn).filter(r -> "Y".equals(r.useYn) && inScope(me, r)).orElseThrow(() -> ApiException.notFound("AS 신청을 찾을 수 없습니다."));
    }

    // ---------- views ----------

    public record Ref(Map<Long, School> schools, Map<Long, Region> regions, Map<Long, Vendor> vendors, Map<Long, AppUser> users) {}

    public Ref ref(Long orgId) {
        return new Ref(schoolService.schoolMap(orgId), schoolService.regionMap(orgId), schoolService.vendorMap(orgId),
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
                .with("receivedAt", r.receivedAt).with("visitPlannedAt", r.visitPlannedAt).with("completedAt", r.completedAt)
                .with("returnReason", r.returnReason).with("transferFromTy", r.transferFromTy).with("transferContent", r.transferContent)
                .with("hasReport", r.visitAt != null || r.processContent != null)
                .with("processTypeCode", r.processTypeCode).with("processTypeName", r.processTypeCode == null ? null : AsCodes.PROCESS_TYPE_NAME.get(r.processTypeCode))
                .with("processAmount", r.processAmount).with("chargeType", r.chargeType)
                .with("evalScore", r.evalScore).with("evaluatedAt", r.evaluatedAt)
                .with("attachFileIds", ids(r.attachFileIds));
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
                         Long schoolId, Long regionId, Long vendorId, Long engineerUserId, boolean mine, boolean unassigned, String sort) {}

    private Specification<AsRequest> spec(CurrentUser me, Filter f) {
        Set<Long> regionSchools = f.regionId() == null && !"region".equals(f.searchType()) ? null
                : schoolService.schoolMap(me.orgId()).values().stream()
                .filter(s -> f.regionId() != null ? f.regionId().equals(s.regionId)
                        : s.regionId != null && schoolService.regionMap(me.orgId()).getOrDefault(s.regionId, new Region()).regionName != null
                        && schoolService.regionMap(me.orgId()).get(s.regionId).regionName.contains(Optional.ofNullable(f.keyword()).orElse("")))
                .map(s -> s.schoolId).collect(Collectors.toSet());
        return scope(me).and((root, q, cb) -> {
            List<Predicate> p = new ArrayList<>();
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
        return new PageResult<>(rows(res.getContent(), me.orgId()), res.getTotalElements(), p, s, res.getTotalPages());
    }

    @Transactional(readOnly = true)
    public List<Json> listAll(CurrentUser me, Filter f) {
        return rows(requests.findAll(spec(me, f), sortOf(f.sort())), me.orgId());
    }

    /** 유형×상태 건수. 학교·업체 범위가 그대로 적용된다. */
    @Transactional(readOnly = true)
    public Json summary(CurrentUser me) {
        List<AsRequest> list = requests.findAll(scope(me));
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
        School s = r.schoolId == null ? null : ref.schools().get(r.schoolId);
        if (s != null) j.put("school", Json.obj().with("schoolId", s.schoolId).with("schoolName", s.schoolName).with("address", s.address).with("tel", s.tel)
                .with("contractStatus", s.contractStatus));
        Vendor v = r.vendorId == null ? null : ref.vendors().get(r.vendorId);
        if (v != null) j.put("vendor", Json.obj().with("vendorId", v.vendorId).with("vendorName", v.vendorName).with("tel", v.tel));
        if (r.visitAt != null || r.processContent != null) {
            j.put("report", Json.obj().with("engineerName", r.engineerName).with("visitAt", r.visitAt).with("visitEndAt", r.visitEndAt)
                    .with("troubleSymptom", r.troubleSymptom).with("inspectContent", r.inspectContent)
                    .with("processTypeCode", r.processTypeCode).with("processTypeName", r.processTypeCode == null ? null : AsCodes.PROCESS_TYPE_NAME.get(r.processTypeCode))
                    .with("processContent", r.processContent).with("processAmount", r.processAmount)
                    .with("chargeType", r.chargeType).with("chargeTypeName", r.chargeType == null ? null : AsCodes.CHARGE_TYPE_NAME.get(r.chargeType))
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
        return j;
    }

    /** 동작 → 그 동작을 여는 처리 기능 권한. 여기 없는 동작(방문·보고서·평가·배정·수정)은 기존 조건만 본다. */
    private static final Map<String, String> ACTION_PERM = Map.of(
            "receive", "AS_RECEIVE", "return", "AS_RETURN", "return-cancel", "AS_RETURN", "transfer", "AS_TRANSFER",
            "cancel", "AS_CANCEL", "delete", "AS_DELETE");

    /** 현재 상태와 권한으로 지금 할 수 있는 동작. 화면의 버튼 표시용. */
    public List<String> allowedActions(CurrentUser me, AsRequest r) {
        List<String> a = new ArrayList<>();
        boolean process = me.can("AS_PROCESS") && (isAdmin(me) || (isVendorSide(me) && me.scope().vendorId().equals(r.vendorId)));
        boolean owner = me.userId().equals(r.applicantUserId) || (isSchoolSide(me) && me.scope().schoolId().equals(r.schoolId));
        // load()/inScope already limit a 교육지원청 담당자 to their district, so here they act like an admin (minus delete).
        boolean manager = isAdmin(me) || isRegionManager(me);
        switch (r.status) {
            case "A" -> { if (process) a.addAll(List.of("receive", "return", "transfer")); if (owner || manager) a.addAll(List.of("update", "cancel")); }
            case "R" -> { if (process) a.addAll(List.of("visit", "report", "transfer")); }
            case "C" -> { if (process) a.add("report"); if (owner && r.evalScore == null && me.can("AS_EVALUATE")) a.add("evaluate"); }
            case "X" -> { if (process) a.add("return-cancel"); if (owner || manager) a.add("cancel"); }
            default -> { }
        }
        if (manager && !"C".equals(r.status)) a.add("assign");
        if (isAdmin(me)) a.add("delete");
        // 사용자별로 끈 처리 기능 (Roles.ACTION_PERMS)
        a.removeIf(x -> ACTION_PERM.containsKey(x) && !me.can(ACTION_PERM.get(x)));
        return a;
    }

    // ---------- commands ----------

    private static final long MAX_AMOUNT = 100_000_000L;
    private static final int MAX_COST_LINES = 20;

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
        if (("M".equals(ty) || "C".equals(ty)) && creating && Params.blank(r.installPlace)) throw ApiException.badRequest("설치장소를 입력해주세요.");
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
                WirelessDevice d = devices.findById(did).filter(x -> x.orgId.equals(me.orgId())).orElseThrow(() -> ApiException.badRequest("무선장비관리번호를 선택해주세요."));
                r.deviceId = d.deviceId; r.deviceName = d.deviceCode + " " + d.deviceName + (d.location == null ? "" : " (" + d.location + ")");
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
        if ("C".equals(ty) && !"CONTRACTED".equals(school.contractStatus) && !isAdmin(me))
            throw ApiException.badRequest("유지관리 표준계약 미체결 학교는 정보기기 AS를 신청할 수 없습니다.");
        SchoolVendor sv = schoolService.resolveVendor(school.schoolId, ty).orElseThrow(() -> ApiException.badRequest("기관에 등록된 유지보수 업체가 없습니다."));

        AsRequest r = new AsRequest();
        r.orgId = me.orgId(); r.rceptTy = ty; r.schoolId = school.schoolId;
        r.applicantUserId = me.userId(); r.applicantName = me.user().userName; r.contactTel = me.user().mobile;
        r.status = "A"; r.requestAt = Times.now();
        r.vendorId = sv.vendorId; r.engineerUserId = sv.engineerUserId;
        if (sv.engineerUserId != null) r.engineerName = users.findById(sv.engineerUserId).map(u -> u.userName).orElse(null);
        applyRequestFields(me, r, b, true);
        requests.save(r);
        history(r, null, "REQUEST", AsCodes.RCEPT_TY_NAME.get(ty) + " AS 신청 등록", me.userId());
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
            if (!List.of("receive", "return", "return-cancel", "transfer", "cancel", "visit", "report", "evaluate", "assign", "delete", "update").contains(action))
                throw ApiException.notFound("지원하지 않는 처리입니다.");
            throw ApiException.conflict("현재 상태(" + AsCodes.STATUS_NAME.get(r.status) + ")에서는 처리할 수 없거나 권한이 없습니다.");
        }
        String prev = r.status;
        switch (action) {
            case "receive" -> {
                LocalDateTime planned = visitTime(b, "visitPlannedAt", "visitPlannedDate");
                if (planned == null) throw ApiException.badRequest("방문예정일시를 입력해주세요.");
                r.status = "R"; r.receivedAt = Times.now(); r.visitPlannedAt = planned;
                if (isVendorSide(me)) { r.engineerUserId = me.userId(); r.engineerName = me.user().userName; }
                history(r, prev, "RECEIVE", "접수 처리 · 방문예정 " + planned.toString().replace('T', ' '), me.userId());
            }
            case "return" -> {
                String reason = Params.str(b, "reason");
                if (reason == null) throw ApiException.badRequest("반려 사유를 입력해주세요.");
                r.status = "X"; r.returnReason = reason;
                history(r, prev, "RETURN", "반려: " + reason, me.userId());
            }
            case "return-cancel" -> {
                r.status = "A"; r.returnReason = null;
                history(r, prev, "RETURN_CANCEL", "반려 취소", me.userId());
            }
            case "transfer" -> {
                String to = Params.str(b, "rceptTy");
                if (to == null || !AsCodes.RCEPT_TYPES.contains(to) || to.equals(r.rceptTy)) throw ApiException.badRequest("이관 메뉴를 선택해주세요.");
                if (!permissions.asTypes(r.orgId).contains(to)) throw ApiException.badRequest(AsCodes.RCEPT_TY_NAME.get(to) + " AS는 이 교육청에서 사용하지 않는 서비스입니다.");
                String content = Params.str(b, "content");
                if (content == null) throw ApiException.badRequest("이관 내용을 입력해주세요.");
                SchoolVendor sv = schoolService.resolveVendor(r.schoolId, to).orElseThrow(() -> ApiException.badRequest("이관 대상 서비스에 대한 AS 업체 또는 담당 기사가 지정되어 있지 않습니다."));
                r.transferFromTy = r.rceptTy; r.transferContent = content; r.rceptTy = to;
                r.vendorId = sv.vendorId; r.engineerUserId = sv.engineerUserId;
                r.engineerName = sv.engineerUserId == null ? null : users.findById(sv.engineerUserId).map(u -> u.userName).orElse(null);
                r.status = "A"; r.receivedAt = null; r.visitPlannedAt = null;
                Map<String, String> ft = AsCodes.FAULT_TYPES.get(to);
                if (!ft.containsKey(r.faultTypeCode)) { r.faultTypeCode = ft.keySet().iterator().next(); r.faultTypeName = ft.get(r.faultTypeCode); }
                history(r, prev, "TRANSFER", AsCodes.RCEPT_TY_NAME.get(r.transferFromTy) + " → " + AsCodes.RCEPT_TY_NAME.get(to) + " 이관: " + content, me.userId());
            }
            case "cancel" -> {
                r.useYn = "N";
                history(r, prev, "CANCEL", "신청 취소", me.userId());
            }
            case "visit" -> {
                LocalDateTime planned = visitTime(b, "visitPlannedAt", "visitPlannedDate");
                if (planned == null) throw ApiException.badRequest("방문예정일시를 입력해주세요.");
                r.visitPlannedAt = planned;
                history(r, prev, "VISIT", "방문예정일 수정 → " + planned.toString().replace('T', ' '), me.userId());
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
                if (b.containsKey("chargeType")) {
                    String c = Params.str(b, "chargeType");
                    if (c != null && !AsCodes.CHARGE_TYPE_NAME.containsKey(c)) throw ApiException.badRequest("유상·무상 구분이 올바르지 않습니다.");
                    r.chargeType = c;
                }
                // 구분을 안 보내면 비용이 있으면 유상, 없으면 무상.
                if (r.chargeType == null) r.chargeType = r.processAmount != null && r.processAmount > 0 ? "PAID" : "FREE";
                if (b.containsKey("fileIds")) r.reportFileIds = csv(b.get("fileIds"));
                if (Params.blank(r.processContent)) throw ApiException.badRequest("처리내용을 입력해주세요.");
                if (r.visitAt == null) r.visitAt = r.visitPlannedAt != null ? r.visitPlannedAt : Times.now();
                if (r.visitEndAt == null) r.visitEndAt = Times.now();
                r.status = "C";
                if (first || r.completedAt == null) r.completedAt = r.visitEndAt;
                history(r, prev, first ? "REPORT" : "REPORT_UPDATE", (first ? "처리 보고서 등록: " : "처리 보고서 수정: ") + r.processContent, me.userId());
            }
            case "evaluate" -> {
                Integer score = Params.integer(b, "score");
                if (score == null || score < 1 || score > 5) throw ApiException.badRequest("만족도 점수를 선택해주세요.");
                r.evalScore = score; r.evalOpinion = Params.str(b, "opinion"); r.evaluatedAt = Times.now();
                history(r, prev, "EVALUATE", "만족도 평가 " + score + "점", me.userId());
            }
            case "assign" -> {
                Long vid = Params.lng(b, "vendorId");
                Vendor v = vid == null ? null : schoolService.vendorMap(me.orgId()).get(vid);
                if (v == null) throw ApiException.badRequest("업체를 선택해주세요.");
                if (!v.serviceTypeList().contains(r.rceptTy)) throw ApiException.badRequest(v.vendorName + "은(는) " + AsCodes.RCEPT_TY_NAME.get(r.rceptTy) + " 유지관리 업체가 아닙니다.");
                Long eid = Params.lng(b, "engineerUserId");
                AppUser e = eid == null ? null : users.findById(eid).filter(u -> vid.equals(u.vendorId)).orElseThrow(() -> ApiException.badRequest("담당 기사가 해당 업체 소속이 아닙니다."));
                r.vendorId = vid; r.engineerUserId = e == null ? null : e.userId; r.engineerName = e == null ? null : e.userName;
                history(r, prev, "ASSIGN", "업체 배정: " + v.vendorName + (e == null ? "" : " / " + e.userName), me.userId());
            }
            case "delete" -> {
                r.useYn = "N";
                history(r, prev, "DELETE", "관리자 삭제", me.userId());
            }
            case "update" -> { update(me, sn, b); return; }
            default -> throw ApiException.notFound("지원하지 않는 처리입니다.");
        }
    }
}
