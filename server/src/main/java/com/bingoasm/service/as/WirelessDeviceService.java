package com.bingoasm.service.as;

import com.bingoasm.auth.CurrentUser;
import com.bingoasm.common.*;
import com.bingoasm.domain.as.*;
import com.bingoasm.domain.Building;
import com.bingoasm.domain.Floor;
import com.bingoasm.repo.BuildingRepository;
import com.bingoasm.repo.FloorRepository;
import com.bingoasm.repo.as.DeviceHistoryRepository;
import com.bingoasm.repo.as.WirelessDeviceRepository;
import java.util.HashMap;
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
    private final BuildingRepository buildings;
    private final FloorRepository floors;
    private final DeviceHistoryRepository histories;
    private final com.bingoasm.repo.as.AsRequestRepository requests;

    public WirelessDeviceService(WirelessDeviceRepository devices, SchoolService schoolService, BuildingRepository buildings, FloorRepository floors,
                                 DeviceHistoryRepository histories, com.bingoasm.repo.as.AsRequestRepository requests) {
        this.histories = histories;
        this.requests = requests;
        this.devices = devices;
        this.schoolService = schoolService;
        this.buildings = buildings;
        this.floors = floors;
    }

    /** 도면에 놓인 장비의 "건물 층" 이름. */
    private Map<Long, String> floorNames(List<WirelessDevice> list) {
        List<Long> ids = list.stream().map(d -> d.floorId).filter(java.util.Objects::nonNull).distinct().toList();
        if (ids.isEmpty()) return Map.of();
        List<Floor> fl = floors.findAllById(ids);
        Map<Long, String> bn = new HashMap<>();
        for (Building b : buildings.findAllById(fl.stream().map(f -> f.buildingId).distinct().toList())) bn.put(b.buildingId, b.buildingName);
        Map<Long, String> out = new HashMap<>();
        for (Floor f : fl) out.put(f.floorId, (bn.getOrDefault(f.buildingId, "") + " " + f.floorName).trim());
        return out;
    }

    public Json view(WirelessDevice d, Map<Long, School> sm, Map<Long, Region> rm) {
        return view(d, sm, rm, floorNames(List.of(d)));
    }

    public Json view(WirelessDevice d, Map<Long, School> sm, Map<Long, Region> rm, Map<Long, String> fn) {
        School s = d.schoolId == null ? null : sm.get(d.schoolId);
        Region r = s == null || s.regionId == null ? null : rm.get(s.regionId);
        return Json.obj().with("deviceId", d.deviceId).with("rceptTy", d.rceptTy).with("deviceCode", d.deviceCode).with("deviceName", d.deviceName)
                .with("deviceType", d.deviceType).with("deviceTypeName", TYPES.get(d.rceptTy).getOrDefault(d.deviceType, d.deviceType))
                .with("modelName", d.modelName).with("ipAddress", d.ipAddress).with("macAddress", d.macAddress).with("location", d.location)
                .with("installedAt", d.installedAt).with("lastCheckedAt", d.lastCheckedAt)
                .with("carrier", d.carrier).with("circuitId", d.circuitId).with("bandwidth", d.bandwidth)
                .with("floorId", d.floorId).with("posX", d.posX).with("posY", d.posY).with("floorFullName", d.floorId == null ? null : fn.get(d.floorId))
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
        List<WirelessDevice> all = devices.findByOrgIdAndRceptTyAndUseYnOrderBySchoolIdAscDeviceCodeAsc(me.orgId(), ty, "Y");
        Map<Long, String> fn = floorNames(all);
        List<Json> rows = all.stream()
                .filter(d -> inScope == null || inScope.contains(d.schoolId))
                .filter(d -> schoolId == null || schoolId.equals(d.schoolId))
                .filter(d -> regionId == null || (sm.get(d.schoolId) != null && regionId.equals(sm.get(d.schoolId).regionId)))
                .filter(d -> Params.blank(deviceType) || deviceType.equals(d.deviceType))
                .filter(d -> Params.blank(status) || status.equals(d.status))
                .filter(d -> Params.blank(keyword) || contains(d.deviceCode, keyword) || contains(d.deviceName, keyword) || contains(d.modelName, keyword)
                        || contains(d.ipAddress, keyword) || contains(d.circuitId, keyword) || (sm.get(d.schoolId) != null && contains(sm.get(d.schoolId).schoolName, keyword)))
                .map(d -> view(d, sm, rm, fn)).toList();
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

    /**
     * 장비 수정. 설치위치가 바뀌면 위치 변경 기록을 남긴다.
     * <ul>
     *   <li>도면에 놓인 무선장비는 설치위치의 "건물 층"이 도면 층을 따른다 (다른 층을 적어도 도면 층으로 바뀐다).</li>
     *   <li>{@code unplace: true} — "다른 층으로 옮기기": 도면에서 빼고 새 설치위치를 적는다 (새 층 도면에는 따로 놓는다).</li>
     *   <li>다른 학교로 옮기면 예전 학교 도면에서 뺀다.</li>
     * </ul>
     */
    public Json update(CurrentUser me, String ty, Long id, Map<String, Object> b) {
        WirelessDevice d = load(me, ty, id);
        String before = d.location;
        Long schoolBefore = d.schoolId;
        boolean unplace = Boolean.TRUE.equals(b.get("unplace")) || "true".equals(String.valueOf(b.get("unplace")));
        if (unplace) {
            if (d.floorId == null) throw ApiException.badRequest("도면에 놓인 장비가 아닙니다.");
            d.floorId = null; d.posX = null; d.posY = null;
        }
        apply(me, d, b);
        if (d.floorId != null && !java.util.Objects.equals(schoolBefore, d.schoolId)) { d.floorId = null; d.posX = null; d.posY = null; }
        if (d.floorId != null && b.containsKey("location")) {
            String plan = floorNames(List.of(d)).get(d.floorId);
            if (plan != null) d.location = relocate(d.location, plan, floorTexts(me.orgId(), d.schoolId));
        }
        record(me, d, before, unplace ? "FLOOR" : "EDIT");
        return view(d, schoolService.schoolMap(me.orgId()), schoolService.regionMap(me.orgId()));
    }

    // ---------- 설치위치: 건물 · 층 · 상세 위치(실) ----------

    public static final Map<String, String> HISTORY_NAME = Map.of("EDIT", "장비 수정", "PLAN", "도면에서 옮김", "FLOOR", "다른 층으로 옮김");

    /** 설치위치가 바뀌었으면 위치 변경 기록 한 줄. */
    private void record(CurrentUser me, WirelessDevice d, String before, String action) {
        String a = Params.blank(before) ? null : before.trim(), c = Params.blank(d.location) ? null : d.location.trim();
        if (java.util.Objects.equals(a, c)) return;
        DeviceHistory h = new DeviceHistory();
        h.deviceId = d.deviceId; h.orgId = d.orgId; h.actionType = action; h.fromPlace = a; h.toPlace = c;
        h.workerId = me.userId(); h.workerName = me.user().userName; h.createdAt = Times.now();
        histories.save(h);
    }

    /** 위치 변경 기록 (최근 것부터). */
    @Transactional(readOnly = true)
    public List<Json> history(CurrentUser me, String ty, Long id) {
        WirelessDevice d = load(me, ty, id);
        return historyOf(d.deviceId, Integer.MAX_VALUE);
    }

    private List<Json> historyOf(Long deviceId, int limit) {
        return histories.findByDeviceIdOrderByHistoryIdDesc(deviceId).stream().limit(limit)
                .map(h -> Json.obj().with("historyId", h.historyId).with("actionType", h.actionType).with("actionName", HISTORY_NAME.getOrDefault(h.actionType, h.actionType))
                        .with("fromPlace", h.fromPlace).with("toPlace", h.toPlace).with("workerName", h.workerName).with("createdAt", h.createdAt))
                .toList();
    }

    /**
     * 장비 등록·수정의 설치위치 고르기: 이 학교의 건물과 층(도면 있는지), 그리고 이 학교 장비들이 이미 쓴 상세 위치(실) 이름
     * (설치위치에서 "건물 층"을 뗀 나머지, 많이 쓴 순). 실 관리 없이도 같은 이름을 고르게 한다.
     */
    @Transactional(readOnly = true)
    public Json places(CurrentUser me, Long schoolId) {
        if (schoolId == null) throw ApiException.badRequest("학교를 선택해 주세요.");
        schoolService.checkSchoolScope(me, schoolId);
        List<Building> bl = buildings.findByOrgIdAndUseYn(me.orgId(), "Y").stream().filter(x -> java.util.Objects.equals(x.schoolId, schoolId))
                .sorted(java.util.Comparator.comparing(x -> x.buildingId)).toList();
        List<Floor> fl = bl.isEmpty() ? List.of() : floors.findByBuildingIdInOrderBySortOrderAsc(bl.stream().map(x -> x.buildingId).toList());
        List<String> texts = new java.util.ArrayList<>();
        List<Json> out = new java.util.ArrayList<>();
        for (Building x : bl) {
            List<Json> fs = new java.util.ArrayList<>();
            for (Floor f : fl) if (f.buildingId.equals(x.buildingId)) {
                fs.add(Json.obj().with("floorId", f.floorId).with("floorName", f.floorName).with("hasPlan", f.planFileId != null));
                texts.add(x.buildingName + " " + f.floorName);
            }
            out.add(Json.obj().with("buildingId", x.buildingId).with("buildingName", x.buildingName).with("floors", fs));
        }
        Map<String, Integer> count = new HashMap<>();
        for (WirelessDevice d : devices.findBySchoolIdAndUseYnOrderByDeviceCodeAsc(schoolId, "Y")) {
            if (!me.orgId().equals(d.orgId)) continue;
            String det = detail(d.location, texts);
            if (!Params.blank(det)) count.merge(det, 1, Integer::sum);
        }
        List<String> details = count.entrySet().stream()
                .sorted(Map.Entry.<String, Integer>comparingByValue().reversed().thenComparing(Map.Entry.comparingByKey()))
                .limit(30).map(Map.Entry::getKey).toList();
        return Json.obj().with("buildings", out).with("details", details);
    }

    /** 설치위치에서 앞의 "건물 층"을 뗀 상세 위치 (없으면 전체). */
    static String detail(String location, List<String> floorTexts) {
        if (Params.blank(location)) return null;
        String loc = location.trim(), hit = null;
        for (String t : floorTexts)
            if ((loc.equals(t) || loc.startsWith(t + " ")) && (hit == null || t.length() > hit.length())) hit = t;
        return hit == null ? loc : loc.substring(hit.length()).trim();
    }

    /**
     * 무선장비 위치(도면): 장비를 그 학교 건물의 층 도면 위 (x, y)%에 놓는다. floorId가 없으면 도면에서 뺀다.
     * 설치위치도 함께 맞춘다: 비었거나 이 학교의 "건물 층"으로 시작하면(예: "본관 2층", "본관 2층 교무실")
     * 그 부분을 새 "건물 층"으로 바꾼다. 직접 적은 다른 문구(예: "교무실 천장")는 그대로 둔다.
     * {@code room}(옮길 실)을 함께 보내면 설치위치를 "건물 층 실"로 적는다 — 도면에서 장비를 옮길 때 화면은 실을 꼭 받는다.
     */
    public Json position(CurrentUser me, String ty, Long id, Map<String, Object> b) {
        WirelessDevice d = load(me, ty, id);
        Long fid = Params.lng(b, "floorId");
        if (fid == null) {
            d.floorId = null; d.posX = null; d.posY = null;
        } else {
            Floor f = floors.findById(fid).orElseThrow(() -> ApiException.badRequest("층을 찾을 수 없습니다."));
            Building bd = buildings.findById(f.buildingId).filter(x -> x.orgId.equals(me.orgId()) && "Y".equals(x.useYn)).orElse(null);
            if (bd == null || !java.util.Objects.equals(bd.schoolId, d.schoolId)) throw ApiException.badRequest("장비가 있는 학교의 건물 층에만 놓을 수 있습니다.");
            if (f.planFileId == null) throw ApiException.badRequest("이 층에는 도면이 없습니다. 도면을 먼저 올려 주세요.");
            Double x = pct(b, "x"), y = pct(b, "y");
            String before = d.location;
            d.floorId = fid; d.posX = x; d.posY = y;
            d.location = relocate(d.location, bd.buildingName + " " + f.floorName, floorTexts(me.orgId(), d.schoolId));
            if (b.containsKey("room")) {
                String room = Params.str(b, "room");
                if (Params.blank(room)) throw ApiException.badRequest("옮길 실을 입력해 주세요.");
                if (room.trim().length() > 100) throw ApiException.badRequest("실 이름이 너무 깁니다.");
                d.location = bd.buildingName + " " + f.floorName + " " + room.trim();
            }
            record(me, d, before, "PLAN");
        }
        return view(d, schoolService.schoolMap(me.orgId()), schoolService.regionMap(me.orgId()));
    }

    private static Double pct(Map<String, Object> b, String k) {
        Object v = b.get(k);
        double n;
        try { n = v instanceof Number num ? num.doubleValue() : Double.parseDouble(String.valueOf(v)); } catch (NumberFormatException e) { n = Double.NaN; }
        if (Double.isNaN(n) || n < 0 || n > 100) throw ApiException.badRequest("도면 위 위치가 올바르지 않습니다.");
        return Math.round(n * 100) / 100.0;
    }

    /** 건물을 지우면 그 건물 층에 놓인 장비는 도면에서 빠진다 (장비 자체는 남는다). */
    /**
     * 서버 시작 때 한 번: 도면에 놓인 장비의 설치위치가 다른 층을 가리키면 도면 층에 맞춘다
     * (예전 버전에서 옮긴 장비, DB를 직접 고친 경우). 이미 맞는 장비는 그대로 둔다.
     */
    @org.springframework.context.event.EventListener(org.springframework.boot.context.event.ApplicationReadyEvent.class)
    @Transactional
    public void syncLocationsWithPlan() {
        List<WirelessDevice> placed = devices.findAll().stream().filter(d -> d.floorId != null && "Y".equals(d.useYn)).toList();
        if (placed.isEmpty()) return;
        Map<Long, Floor> fl = new HashMap<>();
        for (Floor f : floors.findAllById(placed.stream().map(d -> d.floorId).distinct().toList())) fl.put(f.floorId, f);
        Map<Long, Building> bl = new HashMap<>();
        for (Building b : buildings.findAllById(fl.values().stream().map(f -> f.buildingId).distinct().toList())) bl.put(b.buildingId, b);
        Map<String, List<String>> texts = new HashMap<>();
        int fixed = 0;
        for (WirelessDevice d : placed) {
            Floor f = fl.get(d.floorId);
            Building b = f == null ? null : bl.get(f.buildingId);
            if (b == null) continue;
            List<String> cand = texts.computeIfAbsent(d.orgId + ":" + d.schoolId, k -> floorTexts(d.orgId, d.schoolId));
            String loc = relocate(d.location, b.buildingName + " " + f.floorName, cand);
            if (!java.util.Objects.equals(loc, d.location)) { d.location = loc; fixed++; }
        }
        if (fixed > 0) org.slf4j.LoggerFactory.getLogger(WirelessDeviceService.class).info("설치위치를 도면 층에 맞춤: 장비 {}대", fixed);
    }

    /** 이 학교 건물들의 "건물 층" 문구 (설치위치에서 찾아 바꿀 후보). */
    private List<String> floorTexts(Long orgId, Long schoolId) {
        Map<Long, String> bn = new HashMap<>();
        for (Building b : buildings.findByOrgIdAndUseYn(orgId, "Y")) if (java.util.Objects.equals(b.schoolId, schoolId)) bn.put(b.buildingId, b.buildingName);
        if (bn.isEmpty()) return List.of();
        return floors.findByBuildingIdInOrderBySortOrderAsc(bn.keySet()).stream().map(f -> bn.get(f.buildingId) + " " + f.floorName).toList();
    }

    /** 설치위치 문구를 새 층에 맞춘다. 비었으면 새 "건물 층", 기존 "건물 층"으로 시작하면 그 부분만 바꾼다. */
    static String relocate(String location, String newText, List<String> floorTexts) {
        if (Params.blank(location)) return newText;
        String loc = location.trim(), hit = null;
        for (String t : floorTexts)
            if ((loc.equals(t) || loc.startsWith(t + " ")) && (hit == null || t.length() > hit.length())) hit = t;
        return hit == null ? location : newText + loc.substring(hit.length());
    }

    /**
     * 장비의 지금 위치 (AS 상세·보고서에 "장비 현재 위치"로 보인다). 도면에 놓였으면 "건물 층"을 앞에 둔다.
     * 장비가 없거나 삭제됐으면 null.
     */
    @Transactional(readOnly = true)
    public String currentPlace(Long orgId, Long deviceId) {
        WirelessDevice d = deviceId == null ? null : devices.findById(deviceId).filter(x -> x.orgId.equals(orgId) && "Y".equals(x.useYn)).orElse(null);
        if (d == null) return null;
        String fl = d.floorId == null ? null : floorNames(List.of(d)).get(d.floorId);
        String loc = Params.blank(d.location) ? null : d.location.trim();
        if (fl == null) return loc;
        if (loc == null || loc.equals(fl) || loc.startsWith(fl + " ")) return loc == null ? fl : loc;
        return fl + " (" + loc + ")";
    }

    /** 층별 도면에 놓인 장비 수 (무선 · 스쿨넷, 지운 장비 제외) — 건물·층 관리에서 층을 지울 때 알린다. */
    public Map<Long, Long> placedCounts(java.util.Collection<Long> floorIds) {
        if (floorIds.isEmpty()) return Map.of();
        return devices.findByFloorIdIn(floorIds).stream().filter(d -> "Y".equals(d.useYn))
                .collect(java.util.stream.Collectors.groupingBy(d -> d.floorId, java.util.stream.Collectors.counting()));
    }

    public void clearFloors(java.util.Collection<Long> floorIds) {
        if (floorIds.isEmpty()) return;
        for (WirelessDevice d : devices.findByFloorIdIn(floorIds)) { d.floorId = null; d.posX = null; d.posY = null; }
    }

    // ---------- 장비 라벨 QR ----------

    /** 접수 유형별: 장비를 관리하는 권한, 그 장비로 AS를 신청하는 권한, 볼 수 있는 권한. */
    private static final Map<String, String> MANAGE_PERM = Map.of("M", "WDEVICE_MANAGE", "S", "SDEVICE_MANAGE");
    /** 기능 권한 (Roles.FEATURES): 수정 · 라벨 출력 */
    private static final Map<String, String> EDIT_PERM = Map.of("M", "WDEVICE_EDIT", "S", "SDEVICE_EDIT");
    private static final Map<String, String> LABEL_PERM = Map.of("M", "WDEVICE_LABEL", "S", "SDEVICE_LABEL");
    private static final Map<String, String> REQUEST_PERM = Map.of("M", "AS_M_REQUEST", "S", "AS_S_REQUEST");
    private static final Map<String, List<String>> SEE_PERMS = Map.of(
            "M", List.of("WDEVICE_MANAGE", "AS_M_REQUEST", "AS_M_VIEW", "AS_PROCESS"),
            "S", List.of("SDEVICE_MANAGE", "AS_S_REQUEST", "AS_S_VIEW", "AS_PROCESS"));

    /** 라벨 QR을 찍었을 때 보여 줄 수 있는 장비인지: 그 유형을 볼 권한 + 범위 안 학교 (학교·업체·교육지원청). 아니면 404. */
    private WirelessDevice loadForScan(CurrentUser me, Long id) {
        WirelessDevice d = devices.findById(id).filter(x -> x.orgId.equals(me.orgId()) && "Y".equals(x.useYn)).orElse(null);
        java.util.Set<Long> scope = schoolService.scopeSchoolIds(me);
        if (d == null || SEE_PERMS.get(d.rceptTy).stream().noneMatch(me::can) || (scope != null && !scope.contains(d.schoolId)))
            throw ApiException.notFound("장비를 찾을 수 없습니다. 다른 학교 장비이거나 볼 권한이 없습니다.");
        return d;
    }

    /**
     * 장비 라벨 QR → 장비 정보: 기본 정보 + 어느 학교 · 건물 · 층 (도면에 놓였으면 그 층) + 이 사용자가 할 수 있는 것
     * (canManage: 장비 수정·점검 기록·도면, canRequest: 이 장비로 AS 신청).
     */
    @Transactional(readOnly = true)
    public Json scanView(CurrentUser me, Long id) {
        WirelessDevice d = loadForScan(me, id);
        Json j = view(d, schoolService.schoolMap(me.orgId()), schoolService.regionMap(me.orgId()));
        Floor f = d.floorId == null ? null : floors.findById(d.floorId).orElse(null);
        Building b = f == null ? null : buildings.findById(f.buildingId).orElse(null);
        String school = (String) j.get("schoolName");
        List<String> path = new java.util.ArrayList<>();
        for (String p : new String[]{school, b == null ? null : b.buildingName, f == null ? null : f.floorName}) if (p != null) path.add(p);
        j.put("where", Json.obj().with("schoolName", school).with("buildingId", b == null ? null : b.buildingId).with("buildingName", b == null ? null : b.buildingName)
                .with("floorId", f == null ? null : f.floorId).with("floorName", f == null ? null : f.floorName)
                .with("onPlan", f != null && f.planFileId != null && d.posX != null).with("path", String.join(" › ", path)));
        j.put("canManage", me.can(EDIT_PERM.get(d.rceptTy)));
        j.put("canRequest", me.can(REQUEST_PERM.get(d.rceptTy)));
        // 관리자에게만: 최근 위치 변경 (장비를 못 찾을 때 언제 어디로 옮겼는지)
        if (me.can(MANAGE_PERM.get(d.rceptTy))) j.put("history", historyOf(d.deviceId, 5));
        return j;
    }

    /** 장비 라벨 인쇄 항목 (자산 라벨과 같은 A4 3×7). 관리하는 유형의 장비만, 한 번에 60장까지. */
    @Transactional(readOnly = true)
    public List<Json> labels(CurrentUser me, Object ids, String qrBaseUrl) {
        List<WirelessDevice> list = new java.util.ArrayList<>();
        java.util.Set<Long> scope = schoolService.scopeSchoolIds(me);
        if (ids instanceof List<?> l) for (Object o : l) devices.findById(Params.toLong(o))
                .filter(x -> x.orgId.equals(me.orgId()) && "Y".equals(x.useYn) && me.can(LABEL_PERM.get(x.rceptTy)) && (scope == null || scope.contains(x.schoolId)))
                .ifPresent(list::add);
        if (list.isEmpty()) throw ApiException.badRequest("출력할 장비를 선택해 주세요.");
        if (list.size() > 60) list = list.subList(0, 60);
        Map<Long, School> sm = schoolService.schoolMap(me.orgId());
        return list.stream().map(d -> {
            School s = sm.get(d.schoolId);
            return Json.obj().with("deviceId", d.deviceId).with("code", d.deviceCode).with("qrText", qrBaseUrl + "/d/" + d.deviceId)
                    .with("title", d.deviceName).with("sub", (s == null ? "" : s.schoolName + " · ") + java.util.Optional.ofNullable(d.location).orElse("위치 미지정"));
        }).toList();
    }

    /** QR 해석용: 장비 번호가 이 기관 것인지와 유형 (자세한 내용은 scanView에서 권한을 보고 준다). */
    @Transactional(readOnly = true)
    public Json resolve(CurrentUser me, Long id) {
        WirelessDevice d = devices.findById(id).filter(x -> x.orgId.equals(me.orgId()) && "Y".equals(x.useYn)).orElse(null);
        return Json.obj().with("type", "DEVICE").with("deviceId", id).with("found", d != null).with("rceptTy", d == null ? null : d.rceptTy);
    }

    /**
     * 라벨이 손상돼 장비코드(라벨에 인쇄된 번호)를 직접 입력했을 때. 대소문자는 가리지 않는다.
     * 코드가 같은 장비가 여러 학교에 있으면 내 담당 범위의 것만 보고, 그래도 여럿이면 고를 수 없다고 알린다. 없으면 null.
     */
    @Transactional(readOnly = true)
    public Json resolveCode(CurrentUser me, String text) {
        String code = text == null ? "" : text.trim();
        if (code.isEmpty() || code.contains("/")) return null;
        List<WirelessDevice> hit = devices.findByOrgIdAndUseYnOrderBySchoolIdAscDeviceCodeAsc(me.orgId(), "Y").stream()
                .filter(d -> d.deviceCode != null && d.deviceCode.equalsIgnoreCase(code)).toList();
        if (hit.isEmpty()) return null;
        java.util.Set<Long> scope = schoolService.scopeSchoolIds(me);
        List<WirelessDevice> mine = scope == null ? hit : hit.stream().filter(d -> scope.contains(d.schoolId)).toList();
        if (mine.size() > 1) return Json.obj().with("type", "DEVICE").with("found", false)
                .with("message", code + " — 같은 장비코드가 여러 학교에 있습니다. 라벨의 QR을 찍어 주세요.");
        WirelessDevice d = mine.isEmpty() ? hit.get(0) : mine.get(0);
        return resolve(me, d.deviceId);
    }

    /**
     * 삭제(숨김). 이 장비로 신청해 아직 처리 중(신청완료 · 접수완료)인 AS가 있으면 막는다 — 모든 계정 공통.
     * 처리를 끝내거나 취소한 뒤 지운다. 지난 AS 기록은 그대로 남는다.
     */
    public void delete(CurrentUser me, String ty, Long id) {
        WirelessDevice d = load(me, ty, id);
        List<com.bingoasm.domain.as.AsRequest> open = requests.findByDeviceIdAndUseYnAndStatusIn(d.deviceId, "Y", List.of("A", "R"));
        if (!open.isEmpty()) {
            String nos = open.stream().limit(5).map(r -> "#" + r.asvcSn).collect(java.util.stream.Collectors.joining(", "));
            throw ApiException.conflict("이 장비로 처리 중인 AS가 " + open.size() + "건 있어 삭제할 수 없습니다 (" + nos + (open.size() > 5 ? " 외" : "")
                    + "). 처리를 끝내거나 신청을 취소한 뒤 삭제하세요.");
        }
        d.useYn = "N";
    }
}
