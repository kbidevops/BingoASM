package com.bingoasm.service.as;

import com.bingoasm.auth.CurrentUser;
import com.bingoasm.common.*;
import com.bingoasm.domain.as.*;
import com.bingoasm.repo.as.WirelessDeviceRepository;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 무선장비관리(M)·스쿨넷장비관리(S). 같은 표·같은 규칙이고, 장비 유형과 번호 앞글자만 다르다. */
@Service
@Transactional
public class WirelessDeviceService {
    public static final Map<String, String> TYPE_NAME = Map.of("AP", "무선 AP", "SWITCH", "PoE 스위치", "CONTROLLER", "무선 컨트롤러");
    public static final Map<String, String> SCHOOLNET_TYPE_NAME = Map.of("ROUTER", "라우터", "L3", "L3 스위치", "L2", "L2 스위치", "FIREWALL", "보안장비(방화벽)", "ETC", "기타");
    /** 접수 유형 → 장비 유형 코드표. */
    public static final Map<String, Map<String, String>> TYPES = Map.of("M", TYPE_NAME, "S", SCHOOLNET_TYPE_NAME);
    private static final Map<String, String> NOUN = Map.of("M", "무선장비", "S", "스쿨넷 장비");
    private static final Map<String, String> CODE_PREFIX = Map.of("M", "W", "S", "N");
    public static final Map<String, String> STATUS_NAME = Map.of("NORMAL", "정상", "CHECK", "점검중", "FAULT", "장애", "DISPOSED", "폐기");

    private final WirelessDeviceRepository devices;
    private final SchoolService schoolService;

    public WirelessDeviceService(WirelessDeviceRepository devices, SchoolService schoolService) {
        this.devices = devices;
        this.schoolService = schoolService;
    }

    public Json view(WirelessDevice d, Map<Long, School> sm, Map<Long, Region> rm) {
        School s = d.schoolId == null ? null : sm.get(d.schoolId);
        Region r = s == null || s.regionId == null ? null : rm.get(s.regionId);
        return Json.obj().with("deviceId", d.deviceId).with("rceptTy", d.rceptTy).with("deviceCode", d.deviceCode).with("deviceName", d.deviceName)
                .with("deviceType", d.deviceType).with("deviceTypeName", TYPES.get(d.rceptTy).getOrDefault(d.deviceType, d.deviceType))
                .with("modelName", d.modelName).with("ipAddress", d.ipAddress).with("macAddress", d.macAddress).with("location", d.location)
                .with("installedAt", d.installedAt).with("lastCheckedAt", d.lastCheckedAt)
                .with("carrier", d.carrier).with("circuitId", d.circuitId).with("bandwidth", d.bandwidth)
                .with("status", d.status).with("statusName", STATUS_NAME.getOrDefault(d.status, d.status))
                .with("schoolId", d.schoolId).with("schoolName", s == null ? null : s.schoolName)
                .with("regionId", s == null ? null : s.regionId).with("regionName", r == null ? null : r.regionName).with("note", d.note);
    }

    @Transactional(readOnly = true)
    public PageResult<Json> list(CurrentUser me, String ty, Long schoolId, Long regionId, String deviceType, String status, String keyword, Integer page, Integer size) {
        Map<Long, School> sm = schoolService.schoolMap(me.orgId());
        Map<Long, Region> rm = schoolService.regionMap(me.orgId());
        if (schoolId != null) schoolService.checkSchoolScope(me, schoolId);  // 학교 사용자가 다른 학교를 지정하면 403
        Set<Long> inScope = schoolService.scopeSchoolIds(me);
        List<Json> rows = devices.findByOrgIdAndRceptTyAndUseYnOrderBySchoolIdAscDeviceCodeAsc(me.orgId(), ty, "Y").stream()
                .filter(d -> inScope == null || inScope.contains(d.schoolId))
                .filter(d -> schoolId == null || schoolId.equals(d.schoolId))
                .filter(d -> regionId == null || (sm.get(d.schoolId) != null && regionId.equals(sm.get(d.schoolId).regionId)))
                .filter(d -> Params.blank(deviceType) || deviceType.equals(d.deviceType))
                .filter(d -> Params.blank(status) || status.equals(d.status))
                .filter(d -> Params.blank(keyword) || contains(d.deviceCode, keyword) || contains(d.deviceName, keyword) || contains(d.modelName, keyword)
                        || contains(d.ipAddress, keyword) || contains(d.circuitId, keyword) || (sm.get(d.schoolId) != null && contains(sm.get(d.schoolId).schoolName, keyword)))
                .map(d -> view(d, sm, rm)).toList();
        return PageResult.of(rows, page, size);
    }

    private static boolean contains(String v, String kw) {
        return v != null && v.toLowerCase().contains(kw.trim().toLowerCase());
    }

    private WirelessDevice load(CurrentUser me, String ty, Long id) {
        WirelessDevice d = devices.findById(id).filter(x -> x.orgId.equals(me.orgId()) && ty.equals(x.rceptTy) && "Y".equals(x.useYn))
                .orElseThrow(() -> ApiException.notFound(NOUN.get(ty) + "를 찾을 수 없습니다."));
        if (d.schoolId != null) schoolService.checkSchoolScope(me, d.schoolId);  // 교육지원청 담당자는 관내 장비만
        return d;
    }

    private void apply(CurrentUser me, WirelessDevice d, Map<String, Object> b) {
        if (b.containsKey("schoolId")) { Long sid = Params.lng(b, "schoolId"); schoolService.loadSchool(me, sid); d.schoolId = sid; }
        if (d.schoolId == null) throw ApiException.badRequest("소속기관을 선택해주세요.");
        if (b.containsKey("deviceName")) d.deviceName = Params.str(b, "deviceName");
        if (Params.blank(d.deviceName)) throw ApiException.badRequest("장비명을 입력해 주세요.");
        if (b.containsKey("deviceType")) { String t = Params.str(b, "deviceType"); if (t != null && !TYPES.get(d.rceptTy).containsKey(t)) throw ApiException.badRequest("장비 구분이 올바르지 않습니다."); if (t != null) d.deviceType = t; }
        if (d.deviceType == null || !TYPES.get(d.rceptTy).containsKey(d.deviceType)) throw ApiException.badRequest("장비 구분을 선택해 주세요.");
        if (b.containsKey("modelName")) d.modelName = Params.str(b, "modelName");
        if (b.containsKey("ipAddress")) d.ipAddress = Params.str(b, "ipAddress");
        if (b.containsKey("macAddress")) d.macAddress = Params.str(b, "macAddress");
        if (b.containsKey("location")) d.location = Params.str(b, "location");
        if (b.containsKey("installedAt")) d.installedAt = Params.date(b, "installedAt");
        if (b.containsKey("lastCheckedAt")) d.lastCheckedAt = Params.date(b, "lastCheckedAt");
        if (b.containsKey("status")) { String s = Params.str(b, "status"); if (s != null && !STATUS_NAME.containsKey(s)) throw ApiException.badRequest("상태가 올바르지 않습니다."); if (s != null) d.status = s; }
        if (b.containsKey("note")) d.note = Params.str(b, "note");
        if ("S".equals(d.rceptTy)) {
            if (b.containsKey("carrier")) d.carrier = Params.str(b, "carrier");
            if (b.containsKey("circuitId")) d.circuitId = Params.str(b, "circuitId");
            if (b.containsKey("bandwidth")) d.bandwidth = Params.str(b, "bandwidth");
        }
        if (b.containsKey("deviceCode") && Params.str(b, "deviceCode") != null) d.deviceCode = Params.str(b, "deviceCode");
    }

    public Json create(CurrentUser me, String ty, Map<String, Object> b) {
        WirelessDevice d = new WirelessDevice();
        d.orgId = me.orgId();
        d.rceptTy = ty;
        // 무선망은 예전처럼 AP가 기본, 스쿨넷은 유형을 꼭 고른다.
        d.deviceType = "M".equals(ty) ? "AP" : null;
        apply(me, d, b);
        devices.save(d);
        if (d.deviceCode == null) d.deviceCode = String.format("%s-%04d", CODE_PREFIX.get(ty), d.deviceId);
        return view(d, schoolService.schoolMap(me.orgId()), schoolService.regionMap(me.orgId()));
    }

    public Json update(CurrentUser me, String ty, Long id, Map<String, Object> b) {
        WirelessDevice d = load(me, ty, id);
        apply(me, d, b);
        return view(d, schoolService.schoolMap(me.orgId()), schoolService.regionMap(me.orgId()));
    }

    public void delete(CurrentUser me, String ty, Long id) {
        load(me, ty, id).useYn = "N";
    }
}
