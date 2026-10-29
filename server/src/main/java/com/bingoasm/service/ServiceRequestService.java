package com.bingoasm.service;

import com.bingoasm.auth.CurrentUser;
import com.bingoasm.common.*;
import com.bingoasm.domain.*;
import com.bingoasm.repo.*;
import jakarta.persistence.criteria.Predicate;
import jakarta.persistence.criteria.Subquery;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional
public class ServiceRequestService {
    private static final Set<String> SORTABLE = Set.of("requestAt", "requestNo", "priority", "status", "completedAt", "requestId");
    private static final Set<String> STAFF_PERMS = Set.of("SERVICE_RECEIVE", "SERVICE_PROCESS", "SERVICE_CLOSE", "ROLE_GRANT");

    private final ServiceRequestRepository services;
    private final ServiceHistoryRepository histories;
    private final SatisfactionRepository satisfactions;
    private final AssetRepository assets;
    private final UserRepository users;
    private final RefData refData;

    public ServiceRequestService(ServiceRequestRepository services, ServiceHistoryRepository histories, SatisfactionRepository satisfactions,
                                 AssetRepository assets, UserRepository users, RefData refData) {
        this.services = services; this.histories = histories; this.satisfactions = satisfactions;
        this.assets = assets; this.users = users; this.refData = refData;
    }

    /** Requesters without staff permissions only see their own requests. */
    static boolean seesAll(CurrentUser me) {
        return STAFF_PERMS.stream().anyMatch(me::can);
    }

    // ---------- views ----------

    public Json row(ServiceRequest s, RefData.Ref ref, Map<Long, Asset> assetMap, Map<Long, Satisfaction> sats) {
        Asset a = s.assetId == null ? null : assetMap.get(s.assetId);
        Satisfaction sat = sats.get(s.requestId);
        return Json.obj()
                .with("requestId", s.requestId).with("orgId", s.orgId).with("requestNo", s.requestNo)
                .with("assetId", s.assetId).with("assetNo", a == null ? null : a.assetNo).with("assetName", a == null ? null : a.assetName)
                .with("manufacturer", a == null ? null : a.manufacturer).with("modelName", a == null ? null : a.modelName)
                .with("assetType", a == null ? null : a.assetType)
                .with("requestType", s.requestType).with("priority", s.priority).with("title", s.title).with("content", s.content)
                .with("status", s.status).with("requesterId", s.requesterId).with("requesterName", ref.userName(s.requesterId))
                .with("requestAt", s.requestAt).with("contactTel", s.contactTel)
                .with("buildingId", s.buildingId).with("buildingName", ref.buildingName(s.buildingId))
                .with("floorId", s.floorId).with("floorName", ref.floorName(s.floorId)).with("locationDetail", s.locationDetail)
                .with("receiverId", s.receiverId).with("receiverName", ref.userName(s.receiverId)).with("receivedAt", s.receivedAt)
                .with("processorId", s.processorId).with("processorName", ref.userName(s.processorId)).with("assignedAt", s.assignedAt)
                .with("dueAt", s.dueAt).with("startedAt", s.startedAt).with("completedAt", s.completedAt)
                .with("causeCode", s.causeCode).with("actionCode", s.actionCode).with("actionContent", s.actionContent)
                .with("workMinutes", s.workMinutes).with("closedAt", s.closedAt)
                .with("holdReason", s.holdReason).with("rejectReason", s.rejectReason)
                .with("overallScore", sat == null ? null : sat.overallScore);
    }

    public List<Json> rows(List<ServiceRequest> list, Long orgId) {
        RefData.Ref ref = refData.forOrg(orgId);
        Set<Long> assetIds = list.stream().map(s -> s.assetId).filter(Objects::nonNull).collect(Collectors.toSet());
        Map<Long, Asset> assetMap = assets.findAllById(assetIds).stream().collect(Collectors.toMap(a -> a.assetId, Function.identity()));
        Map<Long, Satisfaction> sats = satisfactions.findByRequestIdIn(list.stream().map(s -> s.requestId).toList()).stream()
                .collect(Collectors.toMap(x -> x.requestId, Function.identity()));
        return list.stream().map(s -> row(s, ref, assetMap, sats)).toList();
    }

    // ---------- queries ----------

    public record Filter(String keyword, String status, String statusGroup, String requestType, String priority,
                         LocalDate fromDate, LocalDate toDate, Long assetId, boolean myRequest, boolean myTask, String sort) {}

    private Specification<ServiceRequest> spec(CurrentUser me, Filter f) {
        return (root, q, cb) -> {
            List<Predicate> p = new ArrayList<>();
            p.add(cb.equal(root.get("orgId"), me.orgId()));
            if (!seesAll(me)) p.add(cb.equal(root.get("requesterId"), me.userId()));
            if (!Params.blank(f.keyword())) {
                String kw = "%" + f.keyword().trim().toLowerCase() + "%";
                Subquery<Long> sq = q.subquery(Long.class);
                var ar = sq.from(Asset.class);
                sq.select(ar.get("assetId")).where(cb.like(cb.lower(ar.get("assetNo")), kw));
                p.add(cb.or(
                        cb.like(cb.lower(cb.coalesce(root.get("requestNo"), "")), kw),
                        cb.like(cb.lower(cb.coalesce(root.get("title"), "")), kw),
                        cb.like(cb.lower(cb.coalesce(root.get("content"), "")), kw),
                        cb.like(cb.lower(cb.coalesce(root.get("locationDetail"), "")), kw),
                        root.get("assetId").in(sq)));
            }
            if (!Params.blank(f.status())) p.add(cb.equal(root.get("status"), f.status()));
            else if (!Params.blank(f.statusGroup()) && Codes.STATUS_GROUPS.containsKey(f.statusGroup()))
                p.add(root.get("status").in(Codes.STATUS_GROUPS.get(f.statusGroup())));
            if (!Params.blank(f.requestType())) p.add(cb.equal(root.get("requestType"), f.requestType()));
            if (!Params.blank(f.priority())) p.add(cb.equal(root.get("priority"), f.priority()));
            if (f.fromDate() != null) p.add(cb.greaterThanOrEqualTo(root.get("requestAt"), f.fromDate().atStartOfDay()));
            if (f.toDate() != null) p.add(cb.lessThan(root.get("requestAt"), f.toDate().plusDays(1).atStartOfDay()));
            if (f.assetId() != null) p.add(cb.equal(root.get("assetId"), f.assetId()));
            if (f.myRequest()) p.add(cb.equal(root.get("requesterId"), me.userId()));
            if (f.myTask()) {
                p.add(cb.equal(root.get("processorId"), me.userId()));
                p.add(root.get("status").in(List.of("ASSIGNED", "PROCESSING", "HOLD")));
            }
            return cb.and(p.toArray(Predicate[]::new));
        };
    }

    private static Sort sortOf(String sort) {
        String field = "requestAt";
        Sort.Direction dir = Sort.Direction.DESC;
        if (!Params.blank(sort)) {
            String[] parts = sort.trim().split("[ +,]+");
            String camel = AssetService.toCamel(parts[0]);
            if (SORTABLE.contains(camel)) field = camel;
            dir = parts.length > 1 && parts[1].equalsIgnoreCase("asc") ? Sort.Direction.ASC : Sort.Direction.DESC;
        }
        return Sort.by(dir, field).and(Sort.by(Sort.Direction.DESC, "requestId"));
    }

    @Transactional(readOnly = true)
    public PageResult<Json> list(CurrentUser me, Filter f, Integer page, Integer size) {
        int p = PageResult.page(page), s = PageResult.size(size);
        Page<ServiceRequest> res = services.findAll(spec(me, f), PageRequest.of(p - 1, s, sortOf(f.sort())));
        return new PageResult<>(rows(res.getContent(), me.orgId()), res.getTotalElements(), p, s, res.getTotalPages());
    }

    @Transactional(readOnly = true)
    public List<Json> listAll(CurrentUser me, Filter f) {
        return rows(services.findAll(spec(me, f), sortOf(f.sort())), me.orgId());
    }

    @Transactional(readOnly = true)
    public Json dashboard(CurrentUser me) {
        Long uid = me.userId();
        List<ServiceRequest> list = services.findByOrgId(me.orgId()).stream()
                .filter(s -> seesAll(me) || uid.equals(s.requesterId)).toList();
        Set<Long> surveyed = satisfactions.findByRequestIdIn(list.stream().map(s -> s.requestId).toList()).stream()
                .map(x -> x.requestId).collect(Collectors.toSet());
        LocalDate today = Times.today();
        java.util.function.Predicate<ServiceRequest> isToday = s -> s.requestAt != null && s.requestAt.toLocalDate().equals(today);
        return Json.obj()
                .with("myTask", count(list, s -> uid.equals(s.processorId) && List.of("ASSIGNED", "PROCESSING").contains(s.status)))
                .with("waitingReceive", count(list, s -> "REQUESTED".equals(s.status)))
                .with("todayRequest", count(list, isToday))
                .with("waitingProcess", count(list, s -> List.of("RECEIVED", "ASSIGNED").contains(s.status)))
                .with("onHold", count(list, s -> "HOLD".equals(s.status)))
                .with("processing", count(list, s -> "PROCESSING".equals(s.status)))
                .with("myRequest", count(list, s -> uid.equals(s.requesterId) && Codes.OPEN.contains(s.status)))
                .with("completed", count(list, s -> "COMPLETED".equals(s.status)))
                .with("waitingSurvey", count(list, s -> uid.equals(s.requesterId) && Codes.DONE.contains(s.status) && !surveyed.contains(s.requestId)))
                .with("todayCompleted", count(list, s -> s.completedAt != null && s.completedAt.toLocalDate().equals(today)));
    }

    private static long count(List<ServiceRequest> l, java.util.function.Predicate<ServiceRequest> p) {
        return l.stream().filter(p).count();
    }

    private ServiceRequest load(CurrentUser me, Long id) {
        return services.findById(id)
                .filter(s -> s.orgId.equals(me.orgId()) && (seesAll(me) || me.userId().equals(s.requesterId)))
                .orElseThrow(() -> ApiException.notFound("서비스 요청을 찾을 수 없습니다."));
    }

    @Transactional(readOnly = true)
    public Json detail(CurrentUser me, Long id) {
        ServiceRequest s = load(me, id);
        RefData.Ref ref = refData.forOrg(me.orgId());
        Json view = rows(List.of(s), me.orgId()).get(0);
        view.put("histories", histories.findByRequestIdOrderByCreatedAtAscHistoryIdAsc(s.requestId).stream()
                .map(h -> Json.obj().with("historyId", h.historyId).with("requestId", h.requestId).with("prevStatus", h.prevStatus)
                        .with("status", h.status).with("content", h.content).with("workerId", h.workerId)
                        .with("workerName", ref.userName(h.workerId)).with("createdAt", h.createdAt))
                .toList());
        satisfactions.findByRequestId(s.requestId).ifPresent(sat -> view.put("satisfaction", Json.obj()
                .with("satisId", sat.satisId).with("requestId", sat.requestId).with("overallScore", sat.overallScore)
                .with("kindnessScore", sat.kindnessScore).with("speedScore", sat.speedScore).with("expertiseScore", sat.expertiseScore)
                .with("comment", sat.comment).with("surveyedBy", sat.surveyedBy).with("surveyedByName", ref.userName(sat.surveyedBy))
                .with("surveyedAt", sat.surveyedAt)));
        return view;
    }

    // ---------- commands ----------

    private void history(ServiceRequest s, String prev, String content, Long worker) {
        ServiceHistory h = new ServiceHistory();
        h.requestId = s.requestId; h.prevStatus = prev; h.status = s.status; h.content = content; h.workerId = worker; h.createdAt = Times.now();
        histories.save(h);
    }

    public Long create(CurrentUser me, Map<String, Object> b) {
        String title = Params.str(b, "title");
        if (title == null) throw ApiException.badRequest("제목을 입력해 주세요.");
        Long assetId = Params.lng(b, "assetId");
        Asset asset = assetId == null ? null : assets.findById(assetId).filter(a -> a.orgId.equals(me.orgId())).orElse(null);
        ServiceRequest s = new ServiceRequest();
        s.orgId = me.orgId();
        s.assetId = asset == null ? null : asset.assetId;
        s.requestType = Optional.ofNullable(Params.str(b, "requestType")).orElse("FAULT");
        s.priority = Optional.ofNullable(Params.str(b, "priority")).orElse("NORMAL");
        s.title = title.length() > 200 ? title.substring(0, 200) : title;
        s.content = Optional.ofNullable(Params.str(b, "content")).orElse("");
        s.status = "REQUESTED";
        s.requesterId = me.userId();
        s.requestAt = Times.now();
        s.contactTel = Optional.ofNullable(Params.str(b, "contactTel")).orElse(me.user().mobile);
        Long bId = Params.lng(b, "buildingId"), fId = Params.lng(b, "floorId");
        s.buildingId = bId != null ? bId : asset == null ? null : asset.buildingId;
        s.floorId = fId != null ? fId : asset == null ? null : asset.floorId;
        String loc = Params.str(b, "locationDetail");
        s.locationDetail = loc != null ? loc : asset == null ? "" : asset.locationDetail;
        services.save(s);
        // SR-yyyyMMdd-nnnn, sequence = request id.
        s.requestNo = "SR-" + s.requestAt.format(DateTimeFormatter.BASIC_ISO_DATE) + "-" + String.format("%04d", s.requestId);
        history(s, null, "서비스 요청 등록", me.userId());
        return s.requestId;
    }

    public void satisfaction(CurrentUser me, Long id, Map<String, Object> b) {
        ServiceRequest s = load(me, id);
        if (!me.userId().equals(s.requesterId)) throw ApiException.forbidden("요청자만 만족도 조사에 응답할 수 있습니다.");
        if (!Codes.DONE.contains(s.status)) throw ApiException.badRequest("처리 완료된 요청만 평가할 수 있습니다.");
        if (satisfactions.findByRequestId(s.requestId).isPresent()) throw ApiException.conflict("이미 만족도 조사에 응답했습니다.");
        Satisfaction sat = new Satisfaction();
        sat.requestId = s.requestId;
        sat.overallScore = score(b, "overallScore"); sat.kindnessScore = score(b, "kindnessScore");
        sat.speedScore = score(b, "speedScore"); sat.expertiseScore = score(b, "expertiseScore");
        sat.comment = Optional.ofNullable(Params.rawStr(b, "comment")).orElse("");
        sat.surveyedBy = me.userId();
        sat.surveyedAt = Times.now();
        satisfactions.save(sat);
        history(s, s.status, "만족도 등록 (" + sat.overallScore + "점)", me.userId());
    }

    private static int score(Map<String, Object> b, String k) {
        Integer v = Params.integer(b, k);
        return v == null ? 5 : Math.min(5, Math.max(1, v));
    }

    /** Workflow transition. Each action checks permission and allowed source states. */
    public void act(CurrentUser me, Long id, String action, Map<String, Object> b) {
        if ("satisfaction".equals(action)) { satisfaction(me, id, b); return; }
        ServiceRequest s = load(me, id);
        String prev = s.status;
        String content = switch (action) {
            case "receive" -> {
                require(me, "SERVICE_RECEIVE"); from(s, "REQUESTED");
                s.receiverId = me.userId(); s.receivedAt = Times.now(); s.status = "RECEIVED";
                yield Optional.ofNullable(Params.str(b, "memo")).orElse("접수 처리");
            }
            case "assign" -> {
                require(me, "SERVICE_RECEIVE"); from(s, "RECEIVED", "ASSIGNED", "HOLD");
                Long pid = Params.lng(b, "processorId");
                AppUser p = pid == null ? null : users.findById(pid)
                        .filter(u -> u.orgId.equals(me.orgId()) && u.roles.contains("PROCESSOR") && "ACTIVE".equals(u.status)).orElse(null);
                if (p == null) throw ApiException.badRequest("처리자를 선택해 주세요.");
                s.processorId = p.userId; s.assignedAt = Times.now(); s.dueAt = Params.dateTime(b, "dueAt"); s.status = "ASSIGNED";
                if (s.receiverId == null) { s.receiverId = me.userId(); s.receivedAt = s.assignedAt; }
                String memo = Params.str(b, "memo");
                yield p.userName + " 배정" + (memo == null ? "" : " - " + memo);
            }
            case "start" -> {
                require(me, "SERVICE_PROCESS"); from(s, "ASSIGNED", "HOLD");
                if (!me.userId().equals(s.processorId) && !me.can("ROLE_GRANT")) throw ApiException.forbidden("배정된 처리자만 시작할 수 있습니다.");
                boolean resume = "HOLD".equals(s.status);
                if (s.startedAt == null) s.startedAt = Times.now();
                s.status = "PROCESSING";
                yield resume ? "보류 해제 후 처리 재개" : "처리 시작";
            }
            case "hold" -> {
                require(me, "SERVICE_PROCESS"); from(s, "PROCESSING", "ASSIGNED");
                s.holdReason = Optional.ofNullable(Params.str(b, "reason")).orElse("사유 미입력");
                s.status = "HOLD";
                yield "보류: " + s.holdReason;
            }
            case "complete" -> {
                require(me, "SERVICE_PROCESS"); from(s, "PROCESSING");
                String ac = Params.str(b, "actionContent");
                if (ac == null) throw ApiException.badRequest("처리 내용을 입력해 주세요.");
                s.causeCode = Optional.ofNullable(Params.str(b, "causeCode")).orElse("ETC");
                s.actionCode = Optional.ofNullable(Params.str(b, "actionCode")).orElse("ETC");
                s.actionContent = ac;
                Integer wm = Params.integer(b, "workMinutes");
                s.workMinutes = wm == null ? 0 : wm;
                s.completedAt = Times.now();
                s.status = "COMPLETED";
                yield ac;
            }
            case "close" -> {
                require(me, "SERVICE_CLOSE"); from(s, "COMPLETED");
                s.closedAt = Times.now(); s.status = "CLOSED";
                yield "종결 처리";
            }
            case "reject" -> {
                require(me, "SERVICE_RECEIVE"); from(s, "REQUESTED", "RECEIVED");
                String reason = Params.str(b, "reason");
                if (reason == null) throw ApiException.badRequest("반려 사유를 입력해 주세요.");
                s.rejectReason = reason; s.status = "REJECTED";
                yield "반려: " + reason;
            }
            default -> throw ApiException.notFound("지원하지 않는 처리입니다.");
        };
        history(s, prev, content, me.userId());
    }

    private static void require(CurrentUser me, String perm) {
        if (!me.can(perm)) throw ApiException.forbidden("권한이 없습니다.");
    }

    private static void from(ServiceRequest s, String... allowed) {
        if (!Arrays.asList(allowed).contains(s.status))
            throw ApiException.conflict("현재 상태(" + s.status + ")에서는 처리할 수 없습니다.");
    }
}
