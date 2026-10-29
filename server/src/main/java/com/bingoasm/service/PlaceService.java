package com.bingoasm.service;

import com.bingoasm.auth.CurrentUser;
import com.bingoasm.common.*;
import com.bingoasm.domain.*;
import com.bingoasm.repo.*;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

@Service
@Transactional
public class PlaceService {
    private static final Set<String> IMAGE_TYPES = Set.of("image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml");

    private final BuildingRepository buildings;
    private final FloorRepository floors;
    private final FileRepository files;
    private final AssetRepository assets;
    private final AppProperties props;

    public PlaceService(BuildingRepository buildings, FloorRepository floors, FileRepository files, AssetRepository assets, AppProperties props) {
        this.buildings = buildings; this.floors = floors; this.files = files; this.assets = assets; this.props = props;
    }

    public Path uploadDir() {
        return Path.of(props.dataDir(), "uploads");
    }

    private Map<Long, Long> placedCounts(Long orgId) {
        return assets.findByOrgIdAndUseYn(orgId, "Y").stream()
                .filter(a -> a.posX != null && a.floorId != null)
                .collect(Collectors.groupingBy(a -> a.floorId, Collectors.counting()));
    }

    public Json floorView(Floor f, String buildingName, Map<Long, Long> counts) {
        Json j = Json.obj().with("floorId", f.floorId).with("buildingId", f.buildingId).with("buildingName", buildingName)
                .with("floorNo", f.floorNo).with("floorName", f.floorName);
        if (f.planFileId != null) {
            j.with("planFileId", f.planFileId).with("planUrl", "/files/" + f.planFileId)
                    .with("planWidth", f.planWidth).with("planHeight", f.planHeight);
        }
        return j.with("sortOrder", f.sortOrder).with("assetCount", counts.getOrDefault(f.floorId, 0L));
    }

    @Transactional(readOnly = true)
    public List<Json> buildings(CurrentUser me) {
        List<Building> bs = buildings.findByOrgIdAndUseYn(me.orgId(), "Y");
        Map<Long, Long> counts = placedCounts(me.orgId());
        Map<Long, List<Floor>> byBuilding = floors.findByBuildingIdInOrderBySortOrderAsc(bs.stream().map(b -> b.buildingId).toList())
                .stream().collect(Collectors.groupingBy(f -> f.buildingId, LinkedHashMap::new, Collectors.toList()));
        return bs.stream().map(b -> Json.obj().with("buildingId", b.buildingId).with("orgId", b.orgId).with("buildingName", b.buildingName)
                .with("zipCode", b.zipCode).with("address", b.address).with("addressDetail", b.addressDetail).with("useYn", b.useYn)
                .with("floors", byBuilding.getOrDefault(b.buildingId, List.of()).stream().map(f -> floorView(f, b.buildingName, counts)).toList()))
                .toList();
    }

    private Building building(CurrentUser me, Long id) {
        return buildings.findById(id == null ? -1L : id).filter(b -> b.orgId.equals(me.orgId()))
                .orElseThrow(() -> ApiException.badRequest("건물을 선택해 주세요."));
    }

    private Floor floor(CurrentUser me, Long id) {
        Floor f = floors.findById(id).orElseThrow(() -> ApiException.notFound("층을 찾을 수 없습니다."));
        building(me, f.buildingId);
        return f;
    }

    public Json createBuilding(CurrentUser me, Map<String, Object> body) {
        String name = Params.str(body, "buildingName");
        if (name == null) throw ApiException.badRequest("건물명을 입력해 주세요.");
        Building b = new Building();
        b.orgId = me.orgId(); b.buildingName = name; b.zipCode = Params.str(body, "zipCode");
        b.address = Params.str(body, "address"); b.addressDetail = Params.str(body, "addressDetail");
        buildings.save(b);
        // Optional: pre-create floors B{n}..B1, 1..N.
        Integer basement = Params.integer(body, "basementCount"), above = Params.integer(body, "floorCount");
        for (int i = basement == null ? 0 : Math.min(basement, 10); i >= 1; i--) addFloor(b.buildingId, -i, null);
        for (int i = 1; i <= (above == null ? 0 : Math.min(above, 99)); i++) addFloor(b.buildingId, i, null);
        return Json.obj().with("buildingId", b.buildingId).with("orgId", b.orgId).with("buildingName", b.buildingName)
                .with("zipCode", b.zipCode).with("address", b.address).with("addressDetail", b.addressDetail).with("useYn", b.useYn);
    }

    private Floor addFloor(Long buildingId, int no, String name) {
        Floor f = new Floor();
        f.buildingId = buildingId;
        f.floorNo = no;
        f.floorName = Params.blank(name) ? (no < 0 ? "지하" + (-no) + "층" : no + "층") : name.trim();
        f.sortOrder = no < 0 ? no + 1 : no;
        return floors.save(f);
    }

    public Json createFloor(CurrentUser me, Map<String, Object> body) {
        Building b = building(me, Params.lng(body, "buildingId"));
        Integer no = Params.integer(body, "floorNo");
        if (no == null) throw ApiException.badRequest("층 번호를 입력해 주세요.");
        if (floors.existsByBuildingIdAndFloorNo(b.buildingId, no)) throw ApiException.conflict("이미 등록된 층입니다.");
        Floor f = addFloor(b.buildingId, no, Params.str(body, "floorName"));
        return floorView(f, b.buildingName, Map.of());
    }

    @Transactional(readOnly = true)
    public Json floorDetail(CurrentUser me, Long id) {
        Floor f = floor(me, id);
        return floorView(f, buildings.findById(f.buildingId).map(b -> b.buildingName).orElse(null), placedCounts(me.orgId()));
    }

    public Json uploadPlan(CurrentUser me, Long floorId, MultipartFile file) throws IOException {
        Floor f = floor(me, floorId);
        if (file == null || file.isEmpty() || file.getContentType() == null || !IMAGE_TYPES.contains(file.getContentType()))
            throw ApiException.badRequest("이미지 파일(PNG/JPG/SVG 등)을 선택해 주세요.");
        Files.createDirectories(uploadDir());
        String original = Optional.ofNullable(file.getOriginalFilename()).orElse("plan");
        String ext = original.contains(".") ? original.substring(original.lastIndexOf('.')).toLowerCase() : "";
        if (!ext.matches("\\.[a-z0-9]{1,5}")) ext = "";
        String stored = System.currentTimeMillis() + "-" + UUID.randomUUID().toString().substring(0, 8) + ext;
        file.transferTo(uploadDir().resolve(stored).toAbsolutePath());
        StoredFile sf = new StoredFile();
        sf.storedName = stored; sf.originalName = original; sf.mimeType = file.getContentType(); sf.fileSize = file.getSize(); sf.createdAt = Times.now();
        files.save(sf);
        f.planFileId = sf.fileId;
        return floorDetail(me, floorId);
    }
}
