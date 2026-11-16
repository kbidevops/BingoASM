package com.bingoasm.service.as;

import com.bingoasm.auth.CurrentUser;
import com.bingoasm.common.*;
import com.bingoasm.domain.AppUser;
import com.bingoasm.domain.StoredFile;
import com.bingoasm.domain.as.SlaReport;
import com.bingoasm.domain.as.Vendor;
import com.bingoasm.repo.FileRepository;
import com.bingoasm.repo.UserRepository;
import com.bingoasm.repo.as.SlaReportRepository;
import java.time.LocalDate;
import java.util.*;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 스쿨넷 SLA 결과 업로드 (네트워크 유지관리 › 스쿨넷 SLA 결과 업로드).
 * 스쿨넷 서비스 제공 업체(통신사)의 계정(업체 관리자 · 기사)이 SLA 결과 파일(한글 · 엑셀)을 올린다 — 매월이라는 보장이 없어 제목 · 대상 기간(선택)으로 몇 번이든.
 * 승인 · 반려: 교육청 관리자(모두) 또는 교육지원청 담당자(그 업체가 맡은 지역일 때).
 * 보는 범위: 교육청 = 모두, 업체 = 자기 업체 것, 교육지원청 = 승인된 것 + 자기가 승인할 수 있는 것, 학교 = 승인된 것만.
 */
@Service
@Transactional
public class SlaReportService {
    /** 한글 · 엑셀만 */
    static final Set<String> ALLOWED_EXT = Set.of("hwp", "hwpx", "xlsx", "xls");
    static final int MAX_FILES = 5;

    private final SlaReportRepository reports;
    private final FileRepository files;
    private final SchoolService schoolService;
    private final UserRepository users;
    private final NotificationService notices;

    public SlaReportService(SlaReportRepository reports, FileRepository files, SchoolService schoolService, UserRepository users, NotificationService notices) {
        this.reports = reports; this.files = files; this.schoolService = schoolService; this.users = users; this.notices = notices;
    }

    /** 이 결과를 승인 · 반려할 수 있는가: 교육청 관리자, 또는 그 업체가 관할 지역을 맡는 교육지원청 담당자 */
    private boolean reviewer(CurrentUser me, Vendor v) {
        if (me.scope().province()) return me.can("BOARD_ADMIN");
        return me.scope().region() && me.hasRole("REGION_ADMIN") && v != null && schoolService.vendorCovers(v, me.scope().regionId());
    }

    /** 승인할 수 있는 계정 종류인가 (화면 표시용) */
    private boolean reviewerKind(CurrentUser me) {
        return (me.scope().province() && me.can("BOARD_ADMIN")) || (me.scope().region() && me.hasRole("REGION_ADMIN"));
    }

    /** 올릴 수 있는 계정: 스쿨넷을 맡은 업체의 업체 관리자 · 기사 */
    private boolean uploader(CurrentUser me) {
        if (!me.scope().vendor() || me.scope().vendorId() == null || !(me.hasRole("VENDOR_ADMIN") || me.hasRole("AS_ENGINEER"))) return false;
        Vendor v = schoolService.vendorMap(me.orgId()).get(me.scope().vendorId());
        return v != null && v.serviceTypeList().contains("S");
    }

    private boolean canSee(CurrentUser me, SlaReport r, Map<Long, Vendor> vm) {
        if (me.scope().province()) return true;
        if (me.scope().vendor()) return Objects.equals(me.scope().vendorId(), r.vendorId);
        return "APPROVED".equals(r.status) || reviewer(me, vm.get(r.vendorId));
    }

    @Transactional(readOnly = true)
    public Json list(CurrentUser me, Long vendorId, String status) {
        Map<Long, Vendor> vm = schoolService.vendorMap(me.orgId());
        List<SlaReport> visible = reports.findByOrgIdOrderBySubmittedAtDescReportIdDesc(me.orgId()).stream().filter(r -> canSee(me, r, vm)).toList();
        // 상태 건수는 통신사 거르기를 따르고, 목록은 상태까지 거른다
        List<SlaReport> byVendor = visible.stream().filter(r -> vendorId == null || vendorId.equals(r.vendorId)).toList();
        Map<String, Long> counts = byVendor.stream().collect(Collectors.groupingBy(r -> r.status, Collectors.counting()));
        List<SlaReport> all = byVendor.stream().filter(r -> Params.blank(status) || status.equals(r.status)).toList();
        Set<Long> fileIds = all.stream().flatMap(r -> ids(r.fileIds).stream()).collect(Collectors.toSet());
        Map<Long, StoredFile> fm = files.findAllById(fileIds).stream().collect(Collectors.toMap(f -> f.fileId, f -> f));
        Set<Long> userIds = new HashSet<>();
        for (SlaReport r : all) { userIds.add(r.submittedBy); userIds.add(r.reviewedBy); }
        userIds.remove(null);
        Map<Long, String> un = users.findAllById(userIds).stream().collect(Collectors.toMap(u -> u.userId, u -> u.userName));
        boolean up = uploader(me);
        List<Json> rows = all.stream().map(r -> {
            Vendor v = vm.get(r.vendorId);
            boolean own = up && Objects.equals(me.scope().vendorId(), r.vendorId);
            return Json.obj().with("reportId", r.reportId).with("vendorId", r.vendorId).with("vendorName", v == null ? "업체" : v.vendorName)
                    .with("title", r.title).with("periodFrom", r.periodFrom).with("periodTo", r.periodTo)
                    .with("note", r.note).with("status", r.status).with("rejectReason", r.rejectReason)
                    .with("submittedAt", r.submittedAt).with("submittedByName", un.get(r.submittedBy))
                    .with("reviewedAt", r.reviewedAt).with("reviewedByName", un.get(r.reviewedBy))
                    .with("files", ids(r.fileIds).stream().map(fm::get).filter(Objects::nonNull).map(FileService::view).toList())
                    .with("canEdit", own && !"APPROVED".equals(r.status))
                    .with("canReview", "SUBMITTED".equals(r.status) && reviewer(me, v));
        }).toList();
        // 통신사 거르기: 이 계정이 볼 수 있는 결과가 있는 업체 + (교육청 · 교육지원청이면) 스쿨넷을 맡은 업체
        Set<Long> seen = visible.stream().map(r -> r.vendorId).collect(Collectors.toSet());
        List<Json> vendors = vm.values().stream()
                .filter(v -> seen.contains(v.vendorId) || (reviewerKind(me) && v.serviceTypeList().contains("S") && (me.scope().province() || schoolService.vendorCovers(v, me.scope().regionId()))))
                .sorted(Comparator.comparing(v -> v.vendorName)).map(v -> Json.obj().with("vendorId", v.vendorId).with("vendorName", v.vendorName)).toList();
        return Json.obj().with("rows", rows).with("counts", Json.obj().with("all", (long) byVendor.size())
                        .with("SUBMITTED", counts.getOrDefault("SUBMITTED", 0L)).with("APPROVED", counts.getOrDefault("APPROVED", 0L)).with("REJECTED", counts.getOrDefault("REJECTED", 0L)))
                .with("canUpload", up).with("canReview", reviewerKind(me))
                .with("myVendorId", me.scope().vendor() ? me.scope().vendorId() : null)
                .with("vendors", vendors)
                .with("allowedExt", ALLOWED_EXT.stream().sorted().toList()).with("maxFiles", MAX_FILES);
    }

    /**
     * 올리기 (업체): body {reportId?, title, periodFrom?, periodTo?, note?, fileIds[]}.
     * reportId가 있으면 그 결과를 고친다 (자기 업체 것 · 승인 전만) — 승인 대기로 돌아가고 반려 사유를 지운다.
     */
    public Json submit(CurrentUser me, Map<String, Object> b) {
        if (!uploader(me)) throw ApiException.forbidden("스쿨넷 서비스 제공 업체(통신사)의 계정만 SLA 결과를 올릴 수 있습니다.");
        String title = Params.str(b, "title");
        if (title == null) throw ApiException.badRequest("제목을 입력해 주세요.");
        if (title.length() > 200) throw ApiException.badRequest("제목은 200자까지 입력할 수 있습니다.");
        LocalDate from = Params.date(b, "periodFrom"), to = Params.date(b, "periodTo");
        if (from != null && to != null && to.isBefore(from)) throw ApiException.badRequest("대상 기간의 끝이 시작보다 이릅니다.");
        if (from != null && from.isAfter(Times.today())) throw ApiException.badRequest("대상 기간은 오늘 이전이어야 합니다.");
        String fileIds = checkFiles(b.get("fileIds"));
        String note = Params.str(b, "note");
        if (note != null && note.length() > 1000) throw ApiException.badRequest("메모는 1000자까지 입력할 수 있습니다.");
        Long vid = me.scope().vendorId();
        Long rid = Params.lng(b, "reportId");
        SlaReport r;
        if (rid != null) {
            r = load(me, rid);
            if (!vid.equals(r.vendorId)) throw ApiException.forbidden("올린 업체만 고칠 수 있습니다.");
            if ("APPROVED".equals(r.status)) throw ApiException.conflict("승인된 결과는 고칠 수 없습니다. 새로 올려 주세요.");
        } else { r = new SlaReport(); r.orgId = me.orgId(); r.vendorId = vid; }
        boolean again = r.reportId != null;
        r.title = title; r.periodFrom = from; r.periodTo = to;
        r.note = note; r.fileIds = fileIds; r.status = "SUBMITTED"; r.rejectReason = null;
        r.submittedBy = me.userId(); r.submittedAt = Times.now(); r.reviewedBy = null; r.reviewedAt = null;
        reports.save(r);
        Vendor v = schoolService.vendorMap(me.orgId()).get(vid);
        notices.notifyOrg(reviewers(me.orgId(), v), me.userId(), me.orgId(), "SLA_REPORT_SUBMITTED",
                "스쿨넷 SLA 결과 " + (again ? "다시 올림" : "올림") + ": " + (v == null ? "" : v.vendorName), title + " · 승인해 주세요");
        return Json.obj().with("reportId", r.reportId).with("status", r.status);
    }

    /** 알림 받을 승인자: 교육청 관리자 + 그 업체가 맡은 지역의 교육지원청 담당자 */
    private Set<Long> reviewers(Long orgId, Vendor v) {
        Set<Long> out = new LinkedHashSet<>(notices.provinceSide(orgId));
        if (v != null) for (AppUser u : users.findByOrgIdOrderByUserIdAsc(orgId))
            if ("ACTIVE".equals(u.status) && u.roles.contains("REGION_ADMIN") && u.regionId != null && schoolService.vendorCovers(v, u.regionId)) out.add(u.userId);
        return out;
    }

    /** 지우기: 올린 업체만, 승인 전에만 */
    public void delete(CurrentUser me, Long id) {
        SlaReport r = load(me, id);
        if (!uploader(me) || !Objects.equals(me.scope().vendorId(), r.vendorId)) throw ApiException.forbidden("올린 업체만 지울 수 있습니다.");
        if ("APPROVED".equals(r.status)) throw ApiException.conflict("승인된 SLA 결과는 지울 수 없습니다.");
        reports.delete(r);
    }

    /** 승인 (교육청 · 교육지원청) */
    public Json approve(CurrentUser me, Long id) {
        SlaReport r = review(me, id);
        r.status = "APPROVED"; r.rejectReason = null;
        r.reviewedBy = me.userId(); r.reviewedAt = Times.now();
        notices.notifyOrg(vendorUsers(me.orgId(), r.vendorId), me.userId(), me.orgId(), "SLA_REPORT_APPROVED",
                "스쿨넷 SLA 결과 승인", r.title + " — 승인되었습니다.");
        return Json.obj().with("reportId", r.reportId).with("status", r.status);
    }

    /** 반려 (교육청 · 교육지원청): body {reason} */
    public Json reject(CurrentUser me, Long id, Map<String, Object> b) {
        String reason = Params.str(b, "reason");
        if (reason == null) throw ApiException.badRequest("반려 사유를 입력해 주세요.");
        if (reason.length() > 1000) throw ApiException.badRequest("반려 사유는 1000자까지 입력할 수 있습니다.");
        SlaReport r = review(me, id);
        r.status = "REJECTED"; r.rejectReason = reason;
        r.reviewedBy = me.userId(); r.reviewedAt = Times.now();
        notices.notifyOrg(vendorUsers(me.orgId(), r.vendorId), me.userId(), me.orgId(), "SLA_REPORT_REJECTED",
                "스쿨넷 SLA 결과 반려", r.title + " · " + reason);
        return Json.obj().with("reportId", r.reportId).with("status", r.status);
    }

    /** 그 업체의 업체 관리자 · 기사 */
    private Set<Long> vendorUsers(Long orgId, Long vendorId) {
        Set<Long> out = new LinkedHashSet<>();
        for (AppUser u : users.findByOrgIdOrderByUserIdAsc(orgId))
            if (vendorId.equals(u.vendorId) && (u.roles.contains("VENDOR_ADMIN") || u.roles.contains("AS_ENGINEER"))) out.add(u.userId);
        return out;
    }

    private SlaReport review(CurrentUser me, Long id) {
        SlaReport r = load(me, id);
        if (!reviewer(me, schoolService.vendorMap(me.orgId()).get(r.vendorId)))
            throw ApiException.forbidden("SLA 결과는 교육청 관리자 또는 그 업체가 맡은 지역의 교육지원청이 승인합니다.");
        if (!"SUBMITTED".equals(r.status)) throw ApiException.conflict("승인 대기 중인 결과만 승인 · 반려할 수 있습니다.");
        return r;
    }

    private SlaReport load(CurrentUser me, Long id) {
        SlaReport r = reports.findById(id).filter(x -> x.orgId.equals(me.orgId())).orElseThrow(() -> ApiException.notFound("SLA 결과를 찾을 수 없습니다."));
        if (!canSee(me, r, schoolService.vendorMap(me.orgId()))) throw ApiException.notFound("SLA 결과를 찾을 수 없습니다.");
        return r;
    }

    /** 1~5개, 실제로 올라간 파일, 한글 · 엑셀만 */
    private String checkFiles(Object raw) {
        List<Long> fid = new ArrayList<>();
        try {
            if (raw instanceof Collection<?> c) for (Object o : c) fid.add(Long.valueOf(String.valueOf(o).trim()));
            else if (raw != null && !String.valueOf(raw).isBlank()) for (String s : String.valueOf(raw).split(",")) if (!s.isBlank()) fid.add(Long.valueOf(s.trim()));
        } catch (NumberFormatException e) { throw ApiException.badRequest("첨부 파일이 올바르지 않습니다."); }
        fid = fid.stream().distinct().toList();
        if (fid.isEmpty()) throw ApiException.badRequest("SLA 결과 파일(한글 · 엑셀)을 첨부해 주세요.");
        if (fid.size() > MAX_FILES) throw ApiException.badRequest("파일은 " + MAX_FILES + "개까지 첨부할 수 있습니다.");
        List<StoredFile> found = files.findAllById(fid);
        if (found.size() != fid.size()) throw ApiException.badRequest("첨부 파일을 찾을 수 없습니다. 다시 올려 주세요.");
        for (StoredFile f : found) {
            String n = f.originalName == null ? "" : f.originalName;
            String ext = n.contains(".") ? n.substring(n.lastIndexOf('.') + 1).toLowerCase() : "";
            if (!ALLOWED_EXT.contains(ext)) throw ApiException.badRequest("한글(.hwp · .hwpx) · 엑셀(.xlsx · .xls) 파일만 올릴 수 있습니다: " + n);
        }
        return fid.stream().map(String::valueOf).collect(Collectors.joining(","));
    }

    private static List<Long> ids(String csv) {
        if (csv == null || csv.isBlank()) return List.of();
        return Arrays.stream(csv.split(",")).map(String::trim).filter(x -> !x.isEmpty()).map(Long::valueOf).toList();
    }
}
