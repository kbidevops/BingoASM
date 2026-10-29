package com.bingoasm.service.as;

import com.bingoasm.auth.CurrentUser;
import com.bingoasm.common.*;
import com.bingoasm.domain.Asset;
import com.bingoasm.domain.Org;
import com.bingoasm.domain.as.*;
import com.bingoasm.repo.AssetRepository;
import com.bingoasm.repo.OrgRepository;
import com.bingoasm.repo.as.AssetNoReservationRepository;
import com.bingoasm.repo.as.RoomRepository;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.client.j2se.MatrixToImageWriter;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel;
import java.io.ByteArrayOutputStream;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** QR 코드 생성·해석, 자산 라벨, 빈 라벨용 자산번호 예약. */
@Service
@Transactional
public class QrService {
    private static final Pattern ASSET_IN_TEXT = Pattern.compile("(?:/a/|#asset/)([A-Za-z0-9-]+)");
    private static final Pattern ROOM_IN_TEXT = Pattern.compile("(?:/r/|#room/)([0-9]+)");
    private static final Pattern LOGIN_IN_TEXT = Pattern.compile("[?&]t=([A-Za-z0-9_-]+)");
    private static final Pattern ASSET_NO = Pattern.compile("^[A-Z]{1,6}-\\d{4}-\\d{4,6}$");

    private final AppProperties props;
    private final AssetRepository assets;
    private final RoomRepository rooms;
    private final OrgRepository orgs;
    private final AssetNoReservationRepository reservations;
    private final SchoolService schoolService;

    public QrService(AppProperties props, AssetRepository assets, RoomRepository rooms, OrgRepository orgs, AssetNoReservationRepository reservations, SchoolService schoolService) {
        this.props = props; this.assets = assets; this.rooms = rooms; this.orgs = orgs; this.reservations = reservations; this.schoolService = schoolService;
    }

    public String assetQrText(String assetNo) { return props.qrBaseUrl() + "/a/" + assetNo; }
    public String roomQrText(Long roomId) { return props.qrBaseUrl() + "/r/" + roomId; }

    /** QR 본문 또는 직접 입력에서 자산번호를 뽑는다. 없으면 null. */
    public static String assetNoFrom(String text) {
        if (text == null) return null;
        String t = text.trim();
        Matcher m = ASSET_IN_TEXT.matcher(t);
        if (m.find()) return m.group(1).toUpperCase();
        String up = t.toUpperCase();
        return ASSET_NO.matcher(up).matches() ? up : null;
    }

    public byte[] png(String text, int size) {
        try {
            Map<EncodeHintType, Object> hints = new EnumMap<>(EncodeHintType.class);
            hints.put(EncodeHintType.ERROR_CORRECTION, ErrorCorrectionLevel.M);
            hints.put(EncodeHintType.MARGIN, 1);
            hints.put(EncodeHintType.CHARACTER_SET, "UTF-8");
            int px = Math.max(64, Math.min(1024, size));
            BitMatrix matrix = new QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, px, px, hints);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            MatrixToImageWriter.writeToStream(matrix, "PNG", out);
            return out.toByteArray();
        } catch (Exception e) {
            throw ApiException.badRequest("QR 코드를 만들 수 없습니다.");
        }
    }

    /** 스캔한 문자열이 무엇인지: ASSET(등록/예약/미등록) · ROOM · LOGIN · UNKNOWN */
    @Transactional(readOnly = true)
    public Json resolve(CurrentUser me, String text) {
        String t = text == null ? "" : text.trim();
        Matcher r = ROOM_IN_TEXT.matcher(t);
        if (r.find()) {
            Long rid = Long.valueOf(r.group(1));
            Room room = rooms.findById(rid).filter(x -> x.orgId.equals(me.orgId()) && "Y".equals(x.useYn)).orElse(null);
            return Json.obj().with("type", "ROOM").with("roomId", rid).with("found", room != null).with("roomName", room == null ? null : room.roomName).with("schoolId", room == null ? null : room.schoolId);
        }
        Matcher l = LOGIN_IN_TEXT.matcher(t);
        if (l.find() && t.contains("/qr")) return Json.obj().with("type", "LOGIN").with("token", l.group(1));
        String no = assetNoFrom(t);
        if (no == null) return Json.obj().with("type", "UNKNOWN").with("message", "원클릭AS 자산 QR이 아닙니다. 자산 라벨의 QR을 찍어 주세요.");
        return byNo(me, no);
    }

    @Transactional(readOnly = true)
    public Json byNo(CurrentUser me, String assetNo) {
        String no = assetNo.trim().toUpperCase();
        Asset a = assets.findAll((root, q, cb) -> cb.and(cb.equal(root.get("orgId"), me.orgId()), cb.equal(root.get("assetNo"), no), cb.equal(root.get("useYn"), "Y"))).stream().findFirst().orElse(null);
        if (a != null) return Json.obj().with("type", "ASSET").with("state", "REGISTERED").with("assetNo", no).with("assetId", a.assetId).with("assetName", a.assetName)
                .with("schoolId", a.schoolId).with("roomId", a.roomId);
        AssetNoReservation res = reservations.findByAssetNo(no).filter(x -> x.orgId.equals(me.orgId())).orElse(null);
        if (res != null) return Json.obj().with("type", "ASSET").with("state", "RESERVED").with("assetNo", no).with("schoolId", res.schoolId)
                .with("message", "미등록 라벨입니다. 이 번호로 자산을 등록하세요.");
        return Json.obj().with("type", "ASSET").with("state", "NOT_FOUND").with("assetNo", no).with("message", no + " — 등록되지 않은 번호입니다.");
    }

    /** 빈 라벨용 번호 예약. 자산 ID와 겹치지 않도록 50000번대부터 쓴다. */
    public List<Json> reserve(CurrentUser me, Map<String, Object> b) {
        Integer count = Params.integer(b, "count");
        if (count == null || count < 1 || count > 100) throw ApiException.badRequest("1~100장까지 예약할 수 있습니다.");
        Integer year = Params.integer(b, "year");
        int y = year == null ? Times.today().getYear() : year;
        Long schoolId = Params.lng(b, "schoolId");
        if (schoolId != null) schoolService.checkSchoolScope(me, schoolId);
        Org org = orgs.findById(me.orgId()).orElseThrow();
        String prefix = org.assetNoPrefix == null || org.assetNoPrefix.isBlank() ? "HW" : org.assetNoPrefix;
        List<Json> out = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            AssetNoReservation r = new AssetNoReservation();
            r.orgId = me.orgId(); r.schoolId = schoolId; r.reservedBy = me.userId(); r.reservedAt = Times.now();
            r.assetNo = "PENDING-" + UUID.randomUUID();
            reservations.save(r);
            r.assetNo = String.format("%s-%d-%05d", prefix, y, 50000 + r.id);
            reservations.save(r);
            out.add(Json.obj().with("assetNo", r.assetNo).with("qrText", assetQrText(r.assetNo)).with("blank", true)
                    .with("title", "미등록 라벨").with("sub", "스캔해서 자산을 등록하세요"));
        }
        return out;
    }

    /** 라벨 인쇄용 항목. body: { assetIds:[...] | assetNos:[...] } (최대 60장) */
    @Transactional(readOnly = true)
    public List<Json> labels(CurrentUser me, Map<String, Object> b) {
        List<Asset> list = new ArrayList<>();
        Object ids = b.get("assetIds");
        if (ids instanceof List<?> l) for (Object o : l) assets.findById(Params.toLong(o)).filter(a -> a.orgId.equals(me.orgId())).ifPresent(list::add);
        Object nos = b.get("assetNos");
        if (nos instanceof List<?> l) for (Object o : l) list.addAll(assets.findAll((root, q, cb) -> cb.and(cb.equal(root.get("orgId"), me.orgId()), cb.equal(root.get("assetNo"), String.valueOf(o).trim().toUpperCase()))));
        if (list.isEmpty()) throw ApiException.badRequest("출력할 자산이 없습니다.");
        if (list.size() > 60) list = list.subList(0, 60);
        Map<Long, School> sm = schoolService.schoolMap(me.orgId());
        Map<Long, Room> rm = new HashMap<>();
        for (Asset a : list) if (a.roomId != null) rooms.findById(a.roomId).ifPresent(r -> rm.put(r.roomId, r));
        return list.stream().map(a -> {
            School s = a.schoolId == null ? null : sm.get(a.schoolId);
            Room r = a.roomId == null ? null : rm.get(a.roomId);
            String loc = r != null ? r.roomName : a.locationDetail;
            return Json.obj().with("assetId", a.assetId).with("assetNo", a.assetNo).with("qrText", assetQrText(a.assetNo)).with("blank", false)
                    .with("title", a.assetName).with("sub", (s == null ? "" : s.schoolName + " · ") + Optional.ofNullable(loc).orElse("위치 미지정"));
        }).toList();
    }
}
