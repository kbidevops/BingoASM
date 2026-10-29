package com.bingoasm.service.as;

import com.bingoasm.auth.CurrentUser;
import com.bingoasm.common.*;
import com.bingoasm.domain.*;
import com.bingoasm.domain.as.Room;
import com.bingoasm.domain.as.School;
import com.bingoasm.repo.*;
import com.bingoasm.repo.as.RoomRepository;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 공간(실) 관리: 학교 건물·층·실, 도면 위 실 영역, 실 단위 자산 배치.
 * 건물·층·도면은 BingoASM의 Building/Floor를 학교 ID와 함께 재사용한다.
 */
@Service
@Transactional
public class SpaceService {
    public static final Map<String, String> ROOM_TYPE_NAME = Map.of("CLASS", "교실", "SPECIAL", "특별실", "ADMIN", "행정·지원", "ETC", "기타");

    private final BuildingRepository buildings;
    private final FloorRepository floors;
    private final RoomRepository rooms;
    private final AssetRepository assets;
    private final AssetHistoryRepository assetHistories;
    private final SchoolService schoolService;

    public SpaceService(BuildingRepository buildings, FloorRepository floors, RoomRepository rooms, AssetRepository assets,
                        AssetHistoryRepository assetHistories, SchoolService schoolService) {
        this.buildings = buildings; this.floors = floors; this.rooms = rooms; this.assets = assets; this.assetHistories = assetHistories;
        this.schoolService = schoolService;
    }

    /** 실 이름으로 교실/특별실/행정·지원 추정 (일괄 등록·샘플용). */
    public static String guessType(String name) {
        if (name == null) return "ETC";
        if (name.matches(".*학년\\s*\\d+반.*") || name.matches(".*\\d+-\\d+.*")) return "CLASS";
        if (name.matches(".*(과학|음악|미술|컴퓨터|특별|도서|강당|돌봄|방과후|다목적|영어|체육|시청각).*")) return "SPECIAL";
        if (name.matches(".*(교장|교무|행정|보건|방송|상담|학부모|통신|교재|준비|급식|서버|전산).*")) return "ADMIN";
        return "ETC";
    }

    private School school(CurrentUser me, Long schoolId) {
        School s = schoolService.loadSchool(me, schoolId);
        schoolService.checkSchoolScope(me, s.schoolId);
        return s;
    }

    // ---------- buildings & floors ----------

    @Transactional(readOnly = true)
    public List<Json> buildings(CurrentUser me, Long schoolId) {
        school(me, schoolId);
        List<Building> bs = buildings.findByOrgIdAndUseYn(me.orgId(), "Y").stream().filter(b -> schoolId.equals(b.schoolId)).toList();
        Map<Long, List<Floor>> fm = floors.findByBuildingIdInOrderBySortOrderAsc(bs.stream().map(b -> b.buildingId).toList()).stream()
                .collect(Collectors.groupingBy(f -> f.buildingId, LinkedHashMap::new, Collectors.toList()));
        Map<Long, Long> roomCounts = rooms.findBySchoolIdAndUseYnOrderByBuildingIdAscFloorIdAscRoomNoAsc(schoolId, "Y").stream()
                .filter(r -> r.floorId != null).collect(Collectors.groupingBy(r -> r.floorId, Collectors.counting()));
        return bs.stream().map(b -> Json.obj().with("buildingId", b.buildingId).with("schoolId", b.schoolId).with("buildingName", b.buildingName)
                .with("address", b.address).with("floors", fm.getOrDefault(b.buildingId, List.of()).stream().map(f -> Json.obj()
                        .with("floorId", f.floorId).with("floorNo", f.floorNo).with("floorName", f.floorName).with("sortOrder", f.sortOrder)
                        .with("planUrl", f.planFileId == null ? null : "/files/" + f.planFileId).with("roomCount", roomCounts.getOrDefault(f.floorId, 0L))).toList())).toList();
    }

    public Json createBuilding(CurrentUser me, Map<String, Object> b) {
        School s = school(me, Params.lng(b, "schoolId"));
        if (!me.can("SPACE_MANAGE")) throw ApiException.forbidden("권한이 없습니다.");
        String name = Params.str(b, "buildingName");
        if (name == null) throw ApiException.badRequest("건물명을 입력해 주세요.");
        Building bd = new Building();
        bd.orgId = me.orgId(); bd.schoolId = s.schoolId; bd.buildingName = name; bd.address = Optional.ofNullable(Params.str(b, "address")).orElse(s.address);
        buildings.save(bd);
        Integer basement = Params.integer(b, "basementCount"), above = Params.integer(b, "floorCount");
        for (int i = basement == null ? 0 : Math.min(basement, 5); i >= 1; i--) addFloor(bd.buildingId, -i);
        for (int i = 1; i <= (above == null ? 1 : Math.min(above, 30)); i++) addFloor(bd.buildingId, i);
        return buildings(me, s.schoolId).stream().filter(j -> bd.buildingId.equals(j.get("buildingId"))).findFirst().orElseThrow();
    }

    private Floor addFloor(Long buildingId, int no) {
        Floor f = new Floor();
        f.buildingId = buildingId; f.floorNo = no; f.floorName = no < 0 ? "지하" + (-no) + "층" : no + "층"; f.sortOrder = no < 0 ? no + 1 : no;
        return floors.save(f);
    }

    public Json addFloor(CurrentUser me, Long buildingId, Map<String, Object> b) {
        Building bd = buildings.findById(buildingId).filter(x -> x.orgId.equals(me.orgId()) && x.schoolId != null).orElseThrow(() -> ApiException.notFound("건물을 찾을 수 없습니다."));
        school(me, bd.schoolId);
        if (!me.can("SPACE_MANAGE")) throw ApiException.forbidden("권한이 없습니다.");
        Integer no = Params.integer(b, "floorNo");
        if (no == null) throw ApiException.badRequest("층 번호를 입력해 주세요.");
        if (floors.existsByBuildingIdAndFloorNo(buildingId, no)) throw ApiException.conflict("이미 등록된 층입니다.");
        Floor f = addFloor(buildingId, no);
        String name = Params.str(b, "floorName");
        if (name != null) f.floorName = name;
        return Json.obj().with("floorId", f.floorId).with("floorNo", f.floorNo).with("floorName", f.floorName);
    }

    public void deleteBuilding(CurrentUser me, Long buildingId) {
        Building bd = buildings.findById(buildingId).filter(x -> x.orgId.equals(me.orgId()) && x.schoolId != null).orElseThrow(() -> ApiException.notFound("건물을 찾을 수 없습니다."));
        school(me, bd.schoolId);
        if (!me.can("SPACE_MANAGE")) throw ApiException.forbidden("권한이 없습니다.");
        for (Room r : rooms.findBySchoolIdAndUseYnOrderByBuildingIdAscFloorIdAscRoomNoAsc(bd.schoolId, "Y")) if (buildingId.equals(r.buildingId)) deleteRoomInternal(me, r);
        bd.useYn = "N";
    }

    // ---------- rooms ----------

    public Json roomView(Room r, Map<Long, Building> bm, Map<Long, Floor> fm, Map<Long, Long> assetCounts) {
        Building b = r.buildingId == null ? null : bm.get(r.buildingId);
        Floor f = r.floorId == null ? null : fm.get(r.floorId);
        Json j = Json.obj().with("roomId", r.roomId).with("schoolId", r.schoolId).with("buildingId", r.buildingId).with("buildingName", b == null ? null : b.buildingName)
                .with("floorId", r.floorId).with("floorName", f == null ? null : f.floorName).with("roomNo", r.roomNo).with("roomName", r.roomName)
                .with("roomType", r.roomType).with("roomTypeName", ROOM_TYPE_NAME.getOrDefault(r.roomType, r.roomType)).with("ownerName", r.ownerName)
                .with("fullName", (b == null ? "" : b.buildingName + " ") + (f == null ? "" : f.floorName + " · ") + r.roomName)
                .with("assetCount", assetCounts.getOrDefault(r.roomId, 0L));
        if (r.rectX != null) j.put("rect", Json.obj().with("x", r.rectX).with("y", r.rectY).with("w", r.rectW).with("h", r.rectH));
        return j;
    }

    private Map<Long, Building> buildingMap(Long orgId) {
        return buildings.findByOrgId(orgId).stream().collect(Collectors.toMap(b -> b.buildingId, Function.identity()));
    }

    private Map<Long, Floor> floorMap(Collection<Long> buildingIds) {
        return floors.findByBuildingIdInOrderBySortOrderAsc(buildingIds).stream().collect(Collectors.toMap(f -> f.floorId, Function.identity()));
    }

    private Map<Long, Long> assetCounts(Long schoolId) {
        return assets.findAll((root, q, cb) -> cb.and(cb.equal(root.get("schoolId"), schoolId), cb.equal(root.get("useYn"), "Y"), cb.isNotNull(root.get("roomId"))))
                .stream().collect(Collectors.groupingBy(a -> a.roomId, Collectors.counting()));
    }

    @Transactional(readOnly = true)
    public List<Json> rooms(CurrentUser me, Long schoolId, Long floorId) {
        school(me, schoolId);
        Map<Long, Building> bm = buildingMap(me.orgId());
        Map<Long, Floor> fm = floorMap(bm.keySet());
        Map<Long, Long> counts = assetCounts(schoolId);
        return rooms.findBySchoolIdAndUseYnOrderByBuildingIdAscFloorIdAscRoomNoAsc(schoolId, "Y").stream()
                .filter(r -> floorId == null || floorId.equals(r.floorId)).map(r -> roomView(r, bm, fm, counts)).toList();
    }

    public Room loadRoom(CurrentUser me, Long roomId) {
        Room r = rooms.findById(roomId == null ? -1L : roomId).filter(x -> x.orgId.equals(me.orgId()) && "Y".equals(x.useYn)).orElseThrow(() -> ApiException.notFound("실을 찾을 수 없습니다."));
        schoolService.checkSchoolScope(me, r.schoolId);
        return r;
    }

    /** 실 상세 + 이 실에 등록된 자산 목록(실 QR을 찍었을 때 보여 주는 화면). */
    public Json room(CurrentUser me, Long roomId) {
        Room r = loadRoom(me, roomId);
        Map<Long, Building> bm = buildingMap(me.orgId());
        Json j = roomView(r, bm, floorMap(bm.keySet()), assetCounts(r.schoolId));
        j.put("assets", assets.findAll((root, q, cb) -> cb.and(cb.equal(root.get("roomId"), r.roomId), cb.equal(root.get("useYn"), "Y"))).stream()
                .sorted(java.util.Comparator.comparing((Asset a) -> a.assetNo == null ? "" : a.assetNo))
                .map(a -> Json.obj().with("assetId", a.assetId).with("assetNo", a.assetNo).with("assetName", a.assetName).with("categoryId", a.categoryId)
                        .with("manufacturer", a.manufacturer).with("modelName", a.modelName).with("serialNo", a.serialNo).with("status", a.status)
                        .with("acquiredAt", a.acquiredAt).with("lifeYears", a.lifeYears)).toList());
        return j;
    }

    private void apply(CurrentUser me, Room r, Map<String, Object> b) {
        if (b.containsKey("roomName")) r.roomName = Params.str(b, "roomName");
        if (Params.blank(r.roomName)) throw ApiException.badRequest("실 이름을 입력해 주세요.");
        if (b.containsKey("roomNo")) r.roomNo = Params.str(b, "roomNo");
        if (b.containsKey("roomType")) { String t = Params.str(b, "roomType"); if (t != null && !ROOM_TYPE_NAME.containsKey(t)) throw ApiException.badRequest("실 구분이 올바르지 않습니다."); r.roomType = t == null ? guessType(r.roomName) : t; }
        if (r.roomType == null) r.roomType = guessType(r.roomName);
        if (b.containsKey("ownerName")) r.ownerName = Params.str(b, "ownerName");
        if (b.containsKey("floorId")) {
            Long fid = Params.lng(b, "floorId");
            if (fid != null) {
                Floor f = floors.findById(fid).orElseThrow(() -> ApiException.badRequest("층이 올바르지 않습니다."));
                Building bd = buildings.findById(f.buildingId).filter(x -> r.schoolId.equals(x.schoolId)).orElseThrow(() -> ApiException.badRequest("이 학교의 층이 아닙니다."));
                r.floorId = f.floorId; r.buildingId = bd.buildingId;
            } else { r.floorId = null; r.buildingId = null; }
        }
        if (b.containsKey("rect")) {
            Map<String, Object> rect = Params.map(b, "rect");
            if (rect == null) { r.rectX = r.rectY = r.rectW = r.rectH = null; }
            else {
                r.rectX = clamp(Params.dbl(rect, "x")); r.rectY = clamp(Params.dbl(rect, "y"));
                r.rectW = clamp(Params.dbl(rect, "w")); r.rectH = clamp(Params.dbl(rect, "h"));
                if (r.rectW == null || r.rectH == null || r.rectW <= 0 || r.rectH <= 0) throw ApiException.badRequest("실 영역이 올바르지 않습니다.");
            }
        }
    }

    /** 도면 위 영역은 자산 posX/posY와 같은 퍼센트(0~100) 단위. */
    private static Double clamp(Double v) { return v == null ? null : Math.max(0, Math.min(100, Math.round(v * 100) / 100.0)); }

    public Json createRoom(CurrentUser me, Map<String, Object> b) {
        School s = school(me, Params.lng(b, "schoolId"));
        if (!me.can("SPACE_MANAGE")) throw ApiException.forbidden("권한이 없습니다.");
        Room r = new Room();
        r.orgId = me.orgId(); r.schoolId = s.schoolId;
        apply(me, r, b);
        rooms.save(r);
        return room(me, r.roomId);
    }

    public Json updateRoom(CurrentUser me, Long roomId, Map<String, Object> b) {
        Room r = loadRoom(me, roomId);
        if (!me.can("SPACE_MANAGE")) throw ApiException.forbidden("권한이 없습니다.");
        apply(me, r, b);
        return room(me, roomId);
    }

    public void deleteRoom(CurrentUser me, Long roomId) {
        Room r = loadRoom(me, roomId);
        if (!me.can("SPACE_MANAGE")) throw ApiException.forbidden("권한이 없습니다.");
        deleteRoomInternal(me, r);
    }

    private void deleteRoomInternal(CurrentUser me, Room r) {
        for (Asset a : assets.findAll((root, q, cb) -> cb.equal(root.get("roomId"), r.roomId))) {
            a.roomId = null;
            log(a.assetId, "실 삭제로 위치 해제 (" + r.roomName + ")", me.userId());
        }
        r.useYn = "N";
    }

    private void log(Long assetId, String content, Long worker) {
        AssetHistory h = new AssetHistory();
        h.assetId = assetId; h.actionType = "LOCATE"; h.content = content; h.workerId = worker; h.createdAt = Times.now();
        assetHistories.save(h);
    }

    // ---------- assets in rooms ----------

    /** body: { assetIds:[...] | assetNos:[...], roomId, how? }. 실을 바꾸면 도면 핀 좌표는 지운다. */
    public Json moveAssets(CurrentUser me, Map<String, Object> b) {
        Room r = loadRoom(me, Params.lng(b, "roomId"));
        if (!me.can("SPACE_MANAGE") && !me.can("INVENTORY")) throw ApiException.forbidden("권한이 없습니다.");
        List<Asset> targets = new ArrayList<>();
        Object ids = b.get("assetIds");
        if (ids instanceof List<?> l) for (Object o : l) assets.findById(Params.toLong(o)).ifPresent(targets::add);
        Object nos = b.get("assetNos");
        if (nos instanceof List<?> l) for (Object o : l) assets.findAll((root, q, cb) -> cb.and(cb.equal(root.get("orgId"), me.orgId()), cb.equal(root.get("assetNo"), String.valueOf(o).trim().toUpperCase()))).forEach(targets::add);
        String how = Optional.ofNullable(Params.str(b, "how")).orElse("실 배치");
        int moved = 0;
        Map<Long, Building> bm = buildingMap(me.orgId());
        Map<Long, Floor> fm = floorMap(bm.keySet());
        String full = (String) roomView(r, bm, fm, Map.of()).get("fullName");
        for (Asset a : targets) {
            if (!a.orgId.equals(me.orgId()) || !"Y".equals(a.useYn)) continue;
            if (a.schoolId != null && !a.schoolId.equals(r.schoolId) && !me.can("AS_MANAGE")) throw ApiException.forbidden(a.assetNo + "은(는) 다른 학교의 자산입니다.");
            if (a.schoolId != null) schoolService.checkSchoolScope(me, a.schoolId);  // 교육지원청 담당자: 관외 학교 자산은 못 옮김
            if (r.roomId.equals(a.roomId)) continue;
            a.roomId = r.roomId; a.schoolId = r.schoolId; a.floorId = r.floorId; a.buildingId = r.buildingId;
            a.locationDetail = r.roomName; a.posX = null; a.posY = null; a.updatedAt = Times.now();
            log(a.assetId, how + " → " + full, me.userId());
            moved++;
        }
        return Json.obj().with("moved", moved).with("roomId", r.roomId).with("roomName", r.roomName);
    }
}
