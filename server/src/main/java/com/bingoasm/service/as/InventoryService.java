package com.bingoasm.service.as;

import com.bingoasm.auth.CurrentUser;
import com.bingoasm.common.*;
import com.bingoasm.domain.Asset;
import com.bingoasm.domain.as.*;
import com.bingoasm.repo.AssetRepository;
import com.bingoasm.repo.as.*;
import java.util.*;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 재물조사(QR): 실 QR 또는 실 선택 → 자산 라벨 QR 스캔 → 확인/이동 발견/미등록 기록 → 실 완료 → 보고서 → 이동 반영.
 */
@Service
@Transactional
public class InventoryService {
    private final InventorySessionRepository sessions;
    private final InventoryScanRepository scans;
    private final RoomRepository rooms;
    private final AssetRepository assets;
    private final SchoolService schoolService;
    private final SpaceService spaceService;

    public InventoryService(InventorySessionRepository sessions, InventoryScanRepository scans, RoomRepository rooms, AssetRepository assets,
                            SchoolService schoolService, SpaceService spaceService) {
        this.sessions = sessions; this.scans = scans; this.rooms = rooms; this.assets = assets; this.schoolService = schoolService; this.spaceService = spaceService;
    }

    private static Set<Long> doneRooms(InventorySession s) {
        if (s.doneRoomIds == null || s.doneRoomIds.isBlank()) return new LinkedHashSet<>();
        return Arrays.stream(s.doneRoomIds.split(",")).map(String::trim).filter(x -> !x.isEmpty()).map(Long::valueOf).collect(Collectors.toCollection(LinkedHashSet::new));
    }

    private InventorySession load(CurrentUser me, Long id) {
        InventorySession s = sessions.findById(id).filter(x -> x.orgId.equals(me.orgId())).orElseThrow(() -> ApiException.notFound("재물조사를 찾을 수 없습니다."));
        schoolService.checkSchoolScope(me, s.schoolId);
        return s;
    }

    private static Json sessionView(InventorySession s) {
        return Json.obj().with("sessionId", s.sessionId).with("schoolId", s.schoolId).with("title", s.title).with("startedBy", s.startedBy)
                .with("startedAt", s.startedAt).with("endedAt", s.endedAt).with("status", s.status).with("doneRoomIds", doneRooms(s));
    }

    public Json start(CurrentUser me, Map<String, Object> b) {
        School school = schoolService.loadSchool(me, Params.lng(b, "schoolId"));
        schoolService.checkSchoolScope(me, school.schoolId);
        InventorySession s = new InventorySession();
        s.orgId = me.orgId(); s.schoolId = school.schoolId; s.startedBy = me.userId(); s.startedAt = Times.now();
        s.title = Optional.ofNullable(Params.str(b, "title")).orElse(Times.today() + " 재물조사");
        sessions.save(s);
        return sessionView(s);
    }

    @Transactional(readOnly = true)
    public List<Json> sessions(CurrentUser me, Long schoolId) {
        schoolService.checkSchoolScope(me, schoolId);
        return sessions.findBySchoolIdOrderByStartedAtDesc(schoolId).stream().map(InventoryService::sessionView).toList();
    }

    /** 스캔 1건. body: { roomId, assetNo | text } — text는 라벨 QR 내용(…/a/CB-2021-00012)도 받는다. */
    public Json scan(CurrentUser me, Long sessionId, Map<String, Object> b) {
        InventorySession s = load(me, sessionId);
        if (!"OPEN".equals(s.status)) throw ApiException.conflict("종료된 재물조사입니다.");
        Room room = spaceService.loadRoom(me, Params.lng(b, "roomId"));
        if (!room.schoolId.equals(s.schoolId)) throw ApiException.badRequest("이 기관의 실 QR이 아닙니다.");
        String assetNo = QrService.assetNoFrom(Optional.ofNullable(Params.str(b, "assetNo")).orElse(Params.str(b, "text")));
        if (assetNo == null) throw ApiException.badRequest("원클릭AS 자산 QR이 아닙니다.");
        Asset a = assets.findAll((root, q, cb) -> cb.and(cb.equal(root.get("orgId"), me.orgId()), cb.equal(root.get("assetNo"), assetNo), cb.equal(root.get("useYn"), "Y")))
                .stream().findFirst().orElse(null);
        // 같은 실에서 같은 번호를 다시 찍으면 기록을 늘리지 않는다 (카메라 연속 스캔·재확인).
        List<InventoryScan> sameRoom = scans.findBySessionIdOrderByScannedAtAsc(sessionId).stream()
                .filter(p -> room.roomId.equals(p.roomId) && assetNo.equals(p.assetNo)).toList();
        InventoryScan sc = new InventoryScan();
        sc.sessionId = sessionId; sc.roomId = room.roomId; sc.assetNo = assetNo; sc.scannedBy = me.userId(); sc.scannedAt = Times.now();
        String message;
        if (a == null || !s.schoolId.equals(a.schoolId)) {
            if (sameRoom.stream().anyMatch(p -> "UNKNOWN".equals(p.result)))
                return Json.obj().with("result", "DUPLICATE").with("message", assetNo + " 이미 미등록 번호로 기록했습니다.").with("assetNo", assetNo);
            sc.result = "UNKNOWN";
            message = assetNo + " — 등록되지 않은 번호입니다.";
        } else if (room.roomId.equals(a.roomId)) {
            // 제자리 확인 또는 이 실로 옮김을 반영한 뒤 다시 찍은 경우
            if (sameRoom.stream().anyMatch(p -> "FOUND".equals(p.result) || ("MOVED".equals(p.result) && Boolean.TRUE.equals(p.applied))))
                return Json.obj().with("result", "DUPLICATE").with("message", assetNo + " 이미 확인했습니다.").with("assetId", a.assetId).with("assetNo", assetNo);
            sc.assetId = a.assetId; sc.result = "FOUND";
            message = "✓ " + assetNo + " " + a.assetName + " 확인";
        } else {
            if (sameRoom.stream().anyMatch(p -> "MOVED".equals(p.result) && !Boolean.TRUE.equals(p.applied)))
                return Json.obj().with("result", "DUPLICATE").with("message", assetNo + " 이미 이동 발견으로 기록했습니다. 이 실로 옮기려면 목록에서 ‘이 실로 옮기기’를 누르세요.")
                        .with("assetId", a.assetId).with("assetNo", assetNo);
            sc.assetId = a.assetId; sc.result = "MOVED"; sc.fromRoomId = a.roomId;
            String from = a.roomId == null ? "위치 미지정" : rooms.findById(a.roomId).map(r -> r.roomName).orElse("다른 실");
            message = assetNo + "은(는) " + from + "에 등록된 자산입니다. 이 실로 옮길지 확인하세요.";
        }
        scans.save(sc);
        return Json.obj().with("scanId", sc.scanId).with("result", sc.result).with("message", message).with("assetId", sc.assetId).with("assetNo", assetNo)
                .with("assetName", a == null ? null : a.assetName).with("fromRoomId", sc.fromRoomId);
    }

    public Json completeRoom(CurrentUser me, Long sessionId, Long roomId, boolean done) {
        InventorySession s = load(me, sessionId);
        Room room = spaceService.loadRoom(me, roomId);
        if (!room.schoolId.equals(s.schoolId)) throw ApiException.badRequest("이 기관의 실이 아닙니다.");
        Set<Long> ids = doneRooms(s);
        if (done) ids.add(roomId); else ids.remove(roomId);
        s.doneRoomIds = ids.stream().map(String::valueOf).collect(Collectors.joining(","));
        return sessionView(s);
    }

    /** 실별 등록·확인·미확인·이동 발견·미등록 집계와 스캔 목록. */
    @Transactional(readOnly = true)
    public Json report(CurrentUser me, Long sessionId) {
        InventorySession s = load(me, sessionId);
        Set<Long> done = doneRooms(s);
        List<InventoryScan> all = scans.findBySessionIdOrderByScannedAtAsc(sessionId);
        Map<Long, List<InventoryScan>> byRoom = all.stream().collect(Collectors.groupingBy(x -> x.roomId));
        Map<Long, List<Asset>> registered = assets.findAll((root, q, cb) -> cb.and(cb.equal(root.get("schoolId"), s.schoolId), cb.equal(root.get("useYn"), "Y"), cb.isNotNull(root.get("roomId"))))
                .stream().collect(Collectors.groupingBy(a -> a.roomId));
        List<Json> roomRows = new ArrayList<>();
        long tOk = 0, tMiss = 0, tMoved = 0, tUnk = 0, tReg = 0;
        Map<Long, Asset> assetMap = assets.findByOrgIdAndUseYn(me.orgId(), "Y").stream().collect(Collectors.toMap(a -> a.assetId, a -> a));
        for (Json rv : spaceService.rooms(me, s.schoolId, null)) {
            Long rid = (Long) rv.get("roomId");
            List<InventoryScan> sc = byRoom.getOrDefault(rid, List.of());
            // 제자리 확인 + 이 실로 옮김을 반영한 이동 발견 (반영 후 이 실의 등록 자산이 되므로 확인으로 센다)
            Set<Long> found = sc.stream().filter(x -> "FOUND".equals(x.result) || ("MOVED".equals(x.result) && Boolean.TRUE.equals(x.applied)))
                    .map(x -> x.assetId).collect(Collectors.toSet());
            List<Asset> reg = registered.getOrDefault(rid, List.of());
            List<Json> missing = done.contains(rid) ? reg.stream().filter(a -> !found.contains(a.assetId)).map(a -> Json.obj().with("assetId", a.assetId).with("assetNo", a.assetNo).with("assetName", a.assetName)).toList() : null;
            long moved = sc.stream().filter(x -> "MOVED".equals(x.result)).map(x -> x.assetId).distinct().count();
            long unknown = sc.stream().filter(x -> "UNKNOWN".equals(x.result)).map(x -> x.assetNo).distinct().count();
            tOk += found.size(); tMoved += moved; tUnk += unknown; tReg += reg.size(); if (missing != null) tMiss += missing.size();
            roomRows.add(Json.obj().with("roomId", rid).with("roomNo", rv.get("roomNo")).with("roomName", rv.get("roomName")).with("fullName", rv.get("fullName"))
                    .with("registered", (long) reg.size()).with("found", (long) found.size()).with("missing", missing == null ? null : (long) missing.size())
                    .with("moved", moved).with("unknown", unknown).with("done", done.contains(rid))
                    .with("status", done.contains(rid) ? "완료" : sc.isEmpty() ? "대기" : "진행 중").with("missingAssets", missing));
        }
        List<Json> scanRows = all.stream().map(x -> {
            Asset a = x.assetId == null ? null : assetMap.get(x.assetId);
            return Json.obj().with("scanId", x.scanId).with("roomId", x.roomId).with("assetNo", x.assetNo).with("assetId", x.assetId)
                    .with("assetName", a == null ? null : a.assetName).with("result", x.result).with("fromRoomId", x.fromRoomId)
                    .with("fromRoomName", x.fromRoomId == null ? null : rooms.findById(x.fromRoomId).map(r -> r.roomName).orElse(null))
                    .with("applied", x.applied).with("scannedAt", x.scannedAt);
        }).toList();
        return Json.obj().with("session", sessionView(s))
                .with("totals", Json.obj().with("rooms", (long) roomRows.size()).with("doneRooms", (long) done.size()).with("registered", tReg)
                        .with("found", tOk).with("missing", tMiss).with("moved", tMoved).with("unknown", tUnk))
                .with("rooms", roomRows).with("scans", scanRows);
    }

    /** 다른 실에서 발견된 자산을 스캔한 실로 옮긴다. body: { scanIds:[...] } 없으면 전체. */
    public Json applyMoves(CurrentUser me, Long sessionId, Map<String, Object> b) {
        InventorySession s = load(me, sessionId);
        Set<Long> only = new HashSet<>();
        Object ids = b == null ? null : b.get("scanIds");
        if (ids instanceof List<?> l) for (Object o : l) only.add(Params.toLong(o));
        Map<Long, List<Long>> byRoom = new LinkedHashMap<>();
        List<InventoryScan> targets = scans.findBySessionIdOrderByScannedAtAsc(sessionId).stream()
                .filter(x -> "MOVED".equals(x.result) && !Boolean.TRUE.equals(x.applied) && (only.isEmpty() || only.contains(x.scanId))).toList();
        for (InventoryScan x : targets) byRoom.computeIfAbsent(x.roomId, k -> new ArrayList<>()).add(x.assetId);
        int moved = 0;
        for (Map.Entry<Long, List<Long>> e : byRoom.entrySet()) {
            Json r = spaceService.moveAssets(me, Map.of("roomId", e.getKey(), "assetIds", e.getValue(), "how", "재물조사에서 이동 확인"));
            moved += ((Number) r.get("moved")).intValue();
        }
        for (InventoryScan x : targets) x.applied = true;
        return Json.obj().with("moved", moved).with("sessionId", s.sessionId);
    }

    public Json close(CurrentUser me, Long sessionId) {
        InventorySession s = load(me, sessionId);
        s.status = "CLOSED"; s.endedAt = Times.now();
        return sessionView(s);
    }
}
