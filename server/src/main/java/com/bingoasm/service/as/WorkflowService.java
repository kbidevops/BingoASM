package com.bingoasm.service.as;

import com.bingoasm.auth.CurrentUser;
import com.bingoasm.auth.PermissionService;
import com.bingoasm.common.ApiException;
import com.bingoasm.common.Json;
import com.bingoasm.common.Params;
import com.bingoasm.common.Times;
import com.bingoasm.domain.as.AsCodes;
import com.bingoasm.domain.as.AsWorkflow;
import com.bingoasm.repo.OrgRepository;
import com.bingoasm.repo.as.AsWorkflowRepository;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * AS 처리 흐름: 교육청 · AS 유형마다 단계별로 누가 하는지, 꼭 하는지를 정한다. 상태(신청완료 → 접수완료 → 처리완료 / 반려)는 고정.
 * <ul>
 *   <li>firstReceiver — VENDOR: 업체로 바로 · REGION: 교육지원청이 먼저 확인 (업체 없이 들어오고, 처리 담당 지정으로 넘긴다)</li>
 *   <li>deviceLink — 대상 장비 지정 (장비가 있는 무선망 · 스쿨넷만): REQUIRED 필수(없으면 보고서 불가) · RECOMMENDED 권장(할 일) · OPTIONAL 선택 · NONE 사용 안 함</li>
 *   <li>vendorSource — 업체 결정: SCHOOL 학교 배정 업체 · DEVICE 장비의 유지보수 업체 (장비가 붙으면 그 업체로)</li>
 *   <li>engineerAssign — 기사 배정: ADMIN 업체 관리자가 지정 · AUTO 학교 기본 담당 기사 자동</li>
 *   <li>officeHandling — 교육지원청 · 교육청 직접 처리 (업체 배정 대신 처리 담당 지정). firstReceiver=REGION이면 꼭 켠다.</li>
 *   <li>arrivalRequired — 업체 처리 건은 처리 보고서 전에 현장 도착 기록 필수</li>
 *   <li>evaluation — 만족도 평가</li>
 * </ul>
 * 지연 알림 기준은 AsAlertService (같은 화면에 함께 보여 준다).
 */
@Service
@Transactional
public class WorkflowService {
    public static final List<String> FIRST = List.of("VENDOR", "REGION");
    public static final List<String> DEVICE_LINK = List.of("REQUIRED", "RECOMMENDED", "OPTIONAL", "NONE");
    public static final List<String> VENDOR_SOURCE = List.of("SCHOOL", "DEVICE");
    public static final List<String> ENGINEER = List.of("ADMIN", "AUTO");

    public record Flow(String rceptTy, String firstReceiver, String deviceLink, String vendorSource, String engineerAssign,
                       boolean officeHandling, boolean arrivalRequired, boolean evaluation, boolean isDefault) {
        public boolean officeFirst() { return "REGION".equals(firstReceiver); }
        public boolean deviceFollows() { return "DEVICE".equals(vendorSource); }
        public boolean autoEngineer() { return "AUTO".equals(engineerAssign); }
        public boolean deviceUsed() { return !"NONE".equals(deviceLink); }
        public boolean deviceTask() { return "REQUIRED".equals(deviceLink) || "RECOMMENDED".equals(deviceLink); }
    }

    /** 장비(무선장비 · 스쿨넷 장비)가 있는 유형 */
    public static boolean hasDevices(String ty) { return "M".equals(ty) || "S".equals(ty); }

    private final AsWorkflowRepository repo;
    private final OrgRepository orgs;
    private final PermissionService permissions;
    /** 교육청마다 흐름 (저장할 때 비운다) */
    private final Map<Long, Map<String, Flow>> cache = new ConcurrentHashMap<>();

    public WorkflowService(AsWorkflowRepository repo, OrgRepository orgs, PermissionService permissions) {
        this.repo = repo; this.orgs = orgs; this.permissions = permissions;
    }

    /** 기본값: 지금까지의 흐름과 같다. 스쿨넷의 첫 접수처는 예전 설정(orgs.schoolnet_route, 없으면 교육지원청). */
    Flow defaults(Long orgId, String ty) {
        return switch (ty) {
            case "M" -> new Flow(ty, "VENDOR", "RECOMMENDED", "DEVICE", "ADMIN", false, false, true, true);
            case "S" -> {
                String route = orgs.findById(orgId).map(o -> o.schoolnetRoute).filter(x -> x != null && !x.isBlank()).orElse("REGION");
                yield new Flow(ty, route, "OPTIONAL", "SCHOOL", "ADMIN", true, false, true, true);
            }
            default -> new Flow(ty, "VENDOR", "NONE", "SCHOOL", "ADMIN", false, false, true, true);
        };
    }

    public Map<String, Flow> flows(Long orgId) {
        return cache.computeIfAbsent(orgId, id -> {
            Map<String, AsWorkflow> saved = new HashMap<>();
            for (AsWorkflow w : repo.findByOrgId(id)) saved.put(w.rceptTy, w);
            Map<String, Flow> m = new LinkedHashMap<>();
            for (String ty : AsCodes.RCEPT_TYPES) {
                AsWorkflow w = saved.get(ty);
                m.put(ty, w == null ? defaults(id, ty) : new Flow(ty, w.firstReceiver, w.deviceLink, w.vendorSource, w.engineerAssign,
                        Boolean.TRUE.equals(w.officeHandling), Boolean.TRUE.equals(w.arrivalRequired), Boolean.TRUE.equals(w.evaluation), false));
            }
            return Collections.unmodifiableMap(m);
        });
    }

    public Flow flow(Long orgId, String ty) {
        Flow f = flows(orgId).get(ty);
        return f != null ? f : defaults(orgId, ty);
    }

    @Transactional(readOnly = true)
    public Json view(Long orgId) {
        List<String> inUse = permissions.asTypes(orgId);
        return Json.obj().with("flows", flows(orgId).values().stream().map(f -> Json.obj()
                .with("rceptTy", f.rceptTy()).with("name", AsCodes.RCEPT_TY_NAME.get(f.rceptTy())).with("inUse", inUse.contains(f.rceptTy()))
                .with("hasDevices", hasDevices(f.rceptTy()))
                .with("firstReceiver", f.firstReceiver()).with("deviceLink", f.deviceLink()).with("vendorSource", f.vendorSource())
                .with("engineerAssign", f.engineerAssign()).with("officeHandling", f.officeHandling()).with("arrivalRequired", f.arrivalRequired())
                .with("evaluation", f.evaluation()).with("isDefault", f.isDefault())).toList());
    }

    /** body: { flows: [{rceptTy, firstReceiver, deviceLink, vendorSource, engineerAssign, officeHandling, arrivalRequired, evaluation}] } — 보낸 유형만. */
    public Json save(CurrentUser me, Map<String, Object> b) {
        if (!(b.get("flows") instanceof List<?> l)) throw ApiException.badRequest("flows 목록이 필요합니다.");
        Map<String, AsWorkflow> saved = new HashMap<>();
        for (AsWorkflow w : repo.findByOrgId(me.orgId())) saved.put(w.rceptTy, w);
        for (Object o : l) {
            if (!(o instanceof Map<?, ?> raw)) throw ApiException.badRequest("처리 흐름이 올바르지 않습니다.");
            @SuppressWarnings("unchecked") Map<String, Object> m = (Map<String, Object>) raw;
            String ty = Params.str(m, "rceptTy");
            if (ty == null || !AsCodes.RCEPT_TYPES.contains(ty)) throw ApiException.badRequest("알 수 없는 AS 유형입니다.");
            String name = AsCodes.RCEPT_TY_NAME.get(ty);
            String first = pick(m, "firstReceiver", FIRST, name + " 첫 접수처");
            String device = pick(m, "deviceLink", DEVICE_LINK, name + " 대상 장비 지정");
            String vendor = pick(m, "vendorSource", VENDOR_SOURCE, name + " 업체 결정");
            String eng = pick(m, "engineerAssign", ENGINEER, name + " 기사 배정");
            boolean office = bool(m, "officeHandling"), arrival = bool(m, "arrivalRequired"), eval = bool(m, "evaluation");
            if (!hasDevices(ty) && (!"NONE".equals(device) || "DEVICE".equals(vendor)))
                throw ApiException.badRequest(name + "은(는) 장비 관리가 없어 대상 장비 · 장비의 업체를 쓸 수 없습니다.");
            if ("REGION".equals(first) && !office)
                throw ApiException.badRequest(name + ": 교육지원청이 먼저 받으려면 '교육지원청 · 교육청 직접 처리'를 켜야 합니다 (통신사 · 업체에 넘길 수 있도록).");
            AsWorkflow w = saved.computeIfAbsent(ty, k -> { AsWorkflow x = new AsWorkflow(); x.orgId = me.orgId(); x.rceptTy = k; return x; });
            w.firstReceiver = first; w.deviceLink = device; w.vendorSource = vendor; w.engineerAssign = eng;
            w.officeHandling = office; w.arrivalRequired = arrival; w.evaluation = eval;
            w.updatedAt = Times.now(); w.updatedBy = me.userId();
            repo.save(w);
            // 예전 '스쿨넷 신고 접수처' 설정과 맞춘다
            if ("S".equals(ty)) orgs.findById(me.orgId()).ifPresent(org -> org.schoolnetRoute = first);
        }
        cache.remove(me.orgId());
        return view(me.orgId());
    }

    /** 예전 API(/api/org/as-services의 schoolnetRoute)로 스쿨넷 첫 접수처를 바꿀 때. 교육지원청이 먼저면 직접 처리도 켠다. */
    public void setFirstReceiver(Long orgId, String ty, String route) {
        Flow f = flow(orgId, ty);
        AsWorkflow w = repo.findByOrgId(orgId).stream().filter(x -> ty.equals(x.rceptTy)).findFirst().orElseGet(() -> {
            AsWorkflow x = new AsWorkflow(); x.orgId = orgId; x.rceptTy = ty; return x;
        });
        w.firstReceiver = route; w.deviceLink = f.deviceLink(); w.vendorSource = f.vendorSource(); w.engineerAssign = f.engineerAssign();
        w.officeHandling = f.officeHandling() || "REGION".equals(route); w.arrivalRequired = f.arrivalRequired(); w.evaluation = f.evaluation();
        w.updatedAt = Times.now();
        repo.save(w);
        cache.remove(orgId);
    }

    private static String pick(Map<String, Object> m, String key, List<String> allowed, String label) {
        String v = Params.str(m, key);
        if (v == null || !allowed.contains(v)) throw ApiException.badRequest(label + " 값이 올바르지 않습니다.");
        return v;
    }

    private static boolean bool(Map<String, Object> m, String key) {
        Object v = m.get(key);
        return Boolean.TRUE.equals(v) || "true".equals(String.valueOf(v));
    }

    /** 다른 곳에서 교육청 설정을 바꿨을 때 다시 읽게 한다. */
    public void evict(Long orgId) { cache.remove(orgId); }
}
