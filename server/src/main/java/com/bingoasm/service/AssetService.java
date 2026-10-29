package com.bingoasm.service;

import com.bingoasm.auth.CurrentUser;
import com.bingoasm.common.*;
import com.bingoasm.domain.*;
import com.bingoasm.repo.*;
import jakarta.persistence.criteria.Predicate;
import java.time.LocalDate;
import java.util.*;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional
public class AssetService {
    private static final Set<String> SORTABLE = Set.of("assetNo", "assetName", "acquiredAt", "acquirePrice", "status", "createdAt", "updatedAt", "assetId");

    private final AssetRepository assets;
    private final AssetHistoryRepository histories;
    private final ServiceRequestRepository services;
    private final CategoryRepository categories;
    private final FloorRepository floors;
    private final RefData refData;
    private final OrgRepository orgs;
    private final com.bingoasm.repo.as.AssetNoReservationRepository reservations;
    private final com.bingoasm.service.as.SchoolService schoolService;

    public AssetService(AssetRepository assets, AssetHistoryRepository histories, ServiceRequestRepository services,
                        CategoryRepository categories, FloorRepository floors, RefData refData, OrgRepository orgs,
                        com.bingoasm.repo.as.AssetNoReservationRepository reservations, com.bingoasm.service.as.SchoolService schoolService) {
        this.assets = assets; this.histories = histories; this.services = services; this.categories = categories;
        this.floors = floors; this.refData = refData; this.orgs = orgs; this.reservations = reservations; this.schoolService = schoolService;
    }

    // ---------- school scope (원클릭 AS) ----------

    /** 학교 담당자(자기 학교)·교육지원청 담당자(관내 학교)는 범위 안 학교의 자산만. 그 밖의 계정은 기관 전체 (CurrentUser.scope()). */
    private Specification<Asset> scope(CurrentUser me) {
        Set<Long> inScope = schoolService.scopeSchoolIds(me);
        return (root, q, cb) -> inScope == null ? cb.conjunction() : inScope.isEmpty() ? cb.disjunction() : root.get("schoolId").in(inScope);
    }

    /** 범위가 있는 사용자는 학교 없는 자산(기관 공용)이나 관외 학교 자산을 다룰 수 없다. */
    private void checkScope(CurrentUser me, Asset a) {
        if (!me.scope().schoolBound()) return;
        if (a.schoolId == null) throw ApiException.notFound("자산을 찾을 수 없습니다.");
        schoolService.checkSchoolScope(me, a.schoolId);
    }

    // ---------- views ----------

    /** List row, field order matches the reference API. */
    public Json row(Asset a, RefData.Ref ref, Map<Long, Long> openCounts, Map<Long, Asset> parents) {
        Building b = ref.building(a.buildingId);
        Asset parent = a.parentAssetId == null ? null : parents.get(a.parentAssetId);
        return Json.obj()
                .with("assetId", a.assetId).with("orgId", a.orgId).with("assetNo", a.assetNo).with("assetType", a.assetType)
                .with("categoryId", a.categoryId).with("categoryName", ref.categoryName(a.categoryId)).with("assetName", a.assetName)
                .with("manufacturer", a.manufacturer).with("modelName", a.modelName).with("serialNo", a.serialNo).with("spec", a.spec)
                .with("acquiredAt", a.acquiredAt).with("acquirePrice", a.acquirePrice).with("warrantyEnd", a.warrantyEnd)
                .with("status", a.status).with("buildingId", a.buildingId).with("buildingName", b == null ? null : b.buildingName)
                .with("address", b == null ? null : b.address).with("floorId", a.floorId).with("floorName", ref.floorName(a.floorId))
                .with("locationDetail", a.locationDetail).with("posX", a.posX).with("posY", a.posY)
                .with("ownerUserId", a.ownerUserId).with("ownerName", ref.userName(a.ownerUserId))
                .with("deptId", a.deptId).with("deptName", ref.deptName(a.deptId))
                .with("parentAssetId", a.parentAssetId).with("parentAssetNo", parent == null ? null : parent.assetNo)
                .with("schoolId", a.schoolId).with("roomId", a.roomId).with("lifeYears", effectiveLife(a, ref))
                .with("lifeExceeded", lifeExceeded(a, ref))
                .with("note", a.note).with("useYn", a.useYn)
                .with("createdAt", a.createdAt).with("updatedAt", a.updatedAt)
                .with("openServiceCount", openCounts.getOrDefault(a.assetId, 0L));
    }

    /** 자산에 내용연수가 없으면 분류 기본값. */
    private static Integer effectiveLife(Asset a, RefData.Ref ref) {
        if (a.lifeYears != null) return a.lifeYears;
        Category c = a.categoryId == null ? null : ref.categories().get(a.categoryId);
        return c == null ? null : c.lifeYears;
    }

    /** 취득일 + 내용연수(자산 값, 없으면 분류 기본값)가 오늘 이전이면 true. */
    private static Boolean lifeExceeded(Asset a, RefData.Ref ref) {
        if (a.acquiredAt == null) return null;
        Integer life = effectiveLife(a, ref);
        return life == null ? null : a.acquiredAt.plusYears(life).isBefore(Times.today());
    }

    private Map<Long, Long> openCounts(Long orgId) {
        Map<Long, Long> m = new HashMap<>();
        for (Object[] r : services.countByAssetAndStatus(orgId, Codes.OPEN)) m.put((Long) r[0], (Long) r[1]);
        return m;
    }

    private Map<Long, Asset> parentsOf(Collection<Asset> list) {
        Set<Long> ids = new HashSet<>();
        for (Asset a : list) if (a.parentAssetId != null) ids.add(a.parentAssetId);
        Map<Long, Asset> m = new HashMap<>();
        for (Asset p : assets.findAllById(ids)) m.put(p.assetId, p);
        return m;
    }

    public List<Json> rows(List<Asset> list, Long orgId) {
        RefData.Ref ref = refData.forOrg(orgId);
        Map<Long, Long> open = openCounts(orgId);
        Map<Long, Asset> parents = parentsOf(list);
        return list.stream().map(a -> row(a, ref, open, parents)).toList();
    }

    // ---------- queries ----------

    public record Filter(String keyword, String assetType, Long categoryId, String status, Long buildingId, Long floorId,
                         LocalDate acquiredFrom, LocalDate acquiredTo, boolean unplacedOnly, String sort, Long schoolId, Long roomId) {
        public Filter(String keyword, String assetType, Long categoryId, String status, Long buildingId, Long floorId,
                      LocalDate acquiredFrom, LocalDate acquiredTo, boolean unplacedOnly, String sort) {
            this(keyword, assetType, categoryId, status, buildingId, floorId, acquiredFrom, acquiredTo, unplacedOnly, sort, null, null);
        }
    }

    private Specification<Asset> spec(Long orgId, Filter f) {
        return (root, q, cb) -> {
            List<Predicate> p = new ArrayList<>();
            p.add(cb.equal(root.get("orgId"), orgId));
            p.add(cb.equal(root.get("useYn"), "Y"));
            if (!Params.blank(f.keyword())) {
                String kw = "%" + f.keyword().trim().toLowerCase() + "%";
                p.add(cb.or(Arrays.stream(new String[]{"assetNo", "assetName", "manufacturer", "modelName", "serialNo", "locationDetail"})
                        .map(k -> cb.like(cb.lower(cb.coalesce(root.get(k), "")), kw)).toArray(Predicate[]::new)));
            }
            if (!Params.blank(f.assetType())) p.add(cb.equal(root.get("assetType"), f.assetType()));
            if (f.categoryId() != null) p.add(cb.equal(root.get("categoryId"), f.categoryId()));
            if (!Params.blank(f.status())) p.add(cb.equal(root.get("status"), f.status()));
            if (f.buildingId() != null) p.add(cb.equal(root.get("buildingId"), f.buildingId()));
            if (f.floorId() != null) p.add(cb.equal(root.get("floorId"), f.floorId()));
            if (f.acquiredFrom() != null) p.add(cb.greaterThanOrEqualTo(root.get("acquiredAt"), f.acquiredFrom()));
            if (f.acquiredTo() != null) p.add(cb.lessThanOrEqualTo(root.get("acquiredAt"), f.acquiredTo()));
            if (f.unplacedOnly()) p.add(cb.isNull(root.get("posX")));
            if (f.schoolId() != null) p.add(cb.equal(root.get("schoolId"), f.schoolId()));
            if (f.roomId() != null) p.add(cb.equal(root.get("roomId"), f.roomId()));
            return cb.and(p.toArray(Predicate[]::new));
        };
    }

    /** "asset_no desc" → Sort(assetNo DESC); unknown fields fall back to asset number. */
    private static Sort sortOf(String sort) {
        String field = "assetNo";
        Sort.Direction dir = Sort.Direction.ASC;
        if (!Params.blank(sort)) {
            String[] parts = sort.trim().split("[ +,]+");
            String camel = toCamel(parts[0]);
            if (SORTABLE.contains(camel)) field = camel;
            if (parts.length > 1 && parts[1].equalsIgnoreCase("desc")) dir = Sort.Direction.DESC;
        }
        return Sort.by(dir, field).and(Sort.by("assetId"));
    }

    static String toCamel(String s) {
        StringBuilder b = new StringBuilder();
        boolean up = false;
        for (char c : s.toCharArray()) {
            if (c == '_') { up = true; continue; }
            b.append(up ? Character.toUpperCase(c) : c);
            up = false;
        }
        return b.toString();
    }

    @Transactional(readOnly = true)
    public PageResult<Json> list(CurrentUser me, Filter f, Integer page, Integer size) {
        int p = PageResult.page(page), s = PageResult.size(size);
        Page<Asset> res = assets.findAll(spec(me.orgId(), f).and(scope(me)), PageRequest.of(p - 1, s, sortOf(f.sort())));
        return new PageResult<>(rows(res.getContent(), me.orgId()), res.getTotalElements(), p, s, res.getTotalPages());
    }

    @Transactional(readOnly = true)
    public List<Json> listAll(CurrentUser me, Filter f) {
        return rows(assets.findAll(spec(me.orgId(), f).and(scope(me)), sortOf(f.sort())), me.orgId());
    }

    @Transactional(readOnly = true)
    public Json summary(CurrentUser me) {
        RefData.Ref ref = refData.forOrg(me.orgId());
        List<Asset> list = assets.findByOrgIdAndUseYn(me.orgId(), "Y");
        Map<Long, long[]> byCat = new LinkedHashMap<>();
        Map<String, long[]> byStatus = new LinkedHashMap<>();
        for (Asset a : list) {
            byCat.computeIfAbsent(a.categoryId == null ? -1L : a.categoryId, k -> new long[1])[0]++;
            byStatus.computeIfAbsent(a.status, k -> new long[1])[0]++;
        }
        List<Json> byType = byCat.entrySet().stream()
                .sorted((x, y) -> Long.compare(y.getValue()[0], x.getValue()[0]))
                .map(e -> {
                    Category c = ref.categories().get(e.getKey());
                    return Json.obj().with("cnt", e.getValue()[0]).with("categoryName", c == null ? null : c.categoryName)
                            .with("assetType", c == null ? null : c.assetType);
                }).toList();
        List<Json> statuses = byStatus.entrySet().stream().map(e -> Json.obj().with("cnt", e.getValue()[0]).with("status", e.getKey())).toList();
        return Json.obj().with("byType", byType).with("byStatus", statuses);
    }

    @Transactional(readOnly = true)
    public List<Category> categories() {  // includes lifeYears
        return categories.findByUseYnOrderBySortOrderAsc("Y");
    }

    @Transactional(readOnly = true)
    public List<Json> byFloor(CurrentUser me, Long floorId) {
        List<Asset> list = assets.findByFloorIdAndUseYnAndPosXIsNotNull(floorId, "Y").stream()
                .filter(a -> a.orgId.equals(me.orgId())).toList();
        return rows(list, me.orgId());
    }

    private Asset load(CurrentUser me, Long id) {
        Asset a = assets.findById(id).filter(x -> x.orgId.equals(me.orgId()) && "Y".equals(x.useYn))
                .orElseThrow(() -> ApiException.notFound("자산을 찾을 수 없습니다."));
        checkScope(me, a);
        return a;
    }

    @Transactional(readOnly = true)
    public Json detail(CurrentUser me, Long id) {
        Asset a = load(me, id);
        RefData.Ref ref = refData.forOrg(me.orgId());
        Json view = row(a, ref, openCounts(me.orgId()), parentsOf(List.of(a)));
        if ("HW".equals(a.assetType)) {
            view.put("hw", hwJson(a));
            view.put("installedSoftware", assets.findByParentAssetIdAndUseYn(a.assetId, "Y").stream()
                    .map(s -> Json.obj().with("assetId", s.assetId).with("assetNo", s.assetNo).with("categoryName", ref.categoryName(s.categoryId))
                            .with("assetName", s.assetName).with("manufacturer", s.manufacturer).with("modelName", s.modelName)
                            .with("acquiredAt", s.acquiredAt).with("status", s.status))
                    .toList());
        } else {
            view.put("sw", swJson(a));
        }
        return view;
    }

    private static Json hwJson(Asset a) {
        HwDetail h = a.hw == null ? new HwDetail() : a.hw;
        return Json.obj().with("assetId", a.assetId).with("hostName", h.hostName).with("cpu", h.cpu).with("memory", h.memory)
                .with("disk", h.disk).with("osName", h.osName).with("ipAddress", h.ipAddress).with("macAddress", h.macAddress);
    }

    private static Json swJson(Asset a) {
        SwDetail s = a.sw == null ? new SwDetail() : a.sw;
        return Json.obj().with("assetId", a.assetId).with("version", s.version).with("licenseType", s.licenseType)
                .with("licenseKey", s.licenseKey).with("licenseCount", s.licenseCount).with("licenseStart", s.licenseStart)
                .with("licenseEnd", s.licenseEnd).with("publisher", s.publisher);
    }

    @Transactional(readOnly = true)
    public List<Json> histories(CurrentUser me, Long id) {
        load(me, id);
        RefData.Ref ref = refData.forOrg(me.orgId());
        return histories.findByAssetIdOrderByCreatedAtDescHistoryIdDesc(id).stream()
                .map(h -> Json.obj().with("actionType", h.actionType).with("createdAt", h.createdAt).with("historyId", h.historyId)
                        .with("workerName", ref.userName(h.workerId)).with("content", h.content))
                .toList();
    }

    // ---------- commands ----------

    private void log(Long assetId, String type, String content, Long worker) {
        AssetHistory h = new AssetHistory();
        h.assetId = assetId; h.actionType = type; h.content = content; h.workerId = worker; h.createdAt = Times.now();
        histories.save(h);
    }

    private static final List<String> FIELDS = List.of("assetNo", "categoryId", "assetName", "manufacturer", "modelName", "serialNo",
            "spec", "acquiredAt", "acquirePrice", "warrantyEnd", "status", "buildingId", "floorId", "locationDetail", "ownerUserId",
            "deptId", "parentAssetId", "note", "schoolId", "roomId", "lifeYears");

    /** Applies the fields present in the body; returns the names of fields whose value changed. */
    private List<String> apply(Asset a, Map<String, Object> body) {
        List<String> changed = new ArrayList<>();
        for (String k : FIELDS) {
            if (!body.containsKey(k)) continue;
            Object before = get(a, k);
            switch (k) {
                case "assetNo" -> a.assetNo = Params.str(body, k);
                case "categoryId" -> a.categoryId = Params.lng(body, k);
                case "assetName" -> a.assetName = Params.str(body, k);
                case "manufacturer" -> a.manufacturer = Params.str(body, k);
                case "modelName" -> a.modelName = Params.str(body, k);
                case "serialNo" -> a.serialNo = Params.str(body, k);
                case "spec" -> a.spec = Params.str(body, k);
                case "acquiredAt" -> a.acquiredAt = Params.date(body, k);
                case "acquirePrice" -> a.acquirePrice = Params.lng(body, k);
                case "warrantyEnd" -> a.warrantyEnd = Params.date(body, k);
                case "status" -> {
                    String s = Params.str(body, k);
                    if (s != null && !Codes.ASSET_STATUS.contains(s)) throw ApiException.badRequest("자산 상태가 올바르지 않습니다.");
                    if (s != null) a.status = s;
                }
                case "buildingId" -> a.buildingId = Params.lng(body, k);
                case "floorId" -> a.floorId = Params.lng(body, k);
                case "locationDetail" -> a.locationDetail = Params.str(body, k);
                case "ownerUserId" -> a.ownerUserId = Params.lng(body, k);
                case "deptId" -> a.deptId = Params.lng(body, k);
                case "parentAssetId" -> a.parentAssetId = Params.lng(body, k);
                case "note" -> a.note = Params.str(body, k);
                case "schoolId" -> a.schoolId = Params.lng(body, k);
                case "roomId" -> a.roomId = Params.lng(body, k);
                case "lifeYears" -> a.lifeYears = Params.integer(body, k);
                default -> { }
            }
            if (!Objects.equals(before, get(a, k))) changed.add(k);
        }
        Map<String, Object> hw = Params.map(body, "hw");
        if (hw != null && "HW".equals(a.assetType)) {
            HwDetail h = new HwDetail();
            h.hostName = Params.str(hw, "hostName"); h.cpu = Params.str(hw, "cpu"); h.memory = Params.str(hw, "memory");
            h.disk = Params.str(hw, "disk"); h.osName = Params.str(hw, "osName"); h.ipAddress = Params.str(hw, "ipAddress");
            h.macAddress = Params.str(hw, "macAddress");
            if (!hwJson(withHw(a, h)).equals(hwJson(a))) changed.add("hw");
            a.hw = h.isEmpty() ? null : h;
        }
        Map<String, Object> sw = Params.map(body, "sw");
        if (sw != null && "SW".equals(a.assetType)) {
            SwDetail s = new SwDetail();
            s.version = Params.str(sw, "version"); s.publisher = Params.str(sw, "publisher"); s.licenseType = Params.str(sw, "licenseType");
            s.licenseKey = Params.str(sw, "licenseKey"); s.licenseCount = Params.integer(sw, "licenseCount");
            s.licenseStart = Params.date(sw, "licenseStart"); s.licenseEnd = Params.date(sw, "licenseEnd");
            if (!swJson(withSw(a, s)).equals(swJson(a))) changed.add("sw");
            a.sw = s.isEmpty() ? null : s;
        }
        return changed;
    }

    private static Asset withHw(Asset a, HwDetail h) { Asset c = new Asset(); c.assetId = a.assetId; c.hw = h; return c; }
    private static Asset withSw(Asset a, SwDetail s) { Asset c = new Asset(); c.assetId = a.assetId; c.sw = s; return c; }

    private static Object get(Asset a, String k) {
        return switch (k) {
            case "assetNo" -> a.assetNo; case "categoryId" -> a.categoryId; case "assetName" -> a.assetName;
            case "manufacturer" -> a.manufacturer; case "modelName" -> a.modelName; case "serialNo" -> a.serialNo;
            case "spec" -> a.spec; case "acquiredAt" -> a.acquiredAt; case "acquirePrice" -> a.acquirePrice;
            case "warrantyEnd" -> a.warrantyEnd; case "status" -> a.status; case "buildingId" -> a.buildingId;
            case "floorId" -> a.floorId; case "locationDetail" -> a.locationDetail; case "ownerUserId" -> a.ownerUserId;
            case "deptId" -> a.deptId; case "parentAssetId" -> a.parentAssetId; case "note" -> a.note;
            case "schoolId" -> a.schoolId; case "roomId" -> a.roomId; case "lifeYears" -> a.lifeYears;
            default -> null;
        };
    }

    public Long create(CurrentUser me, Map<String, Object> body) {
        String type = Params.str(body, "assetType");
        if (!"HW".equals(type) && !"SW".equals(type)) throw ApiException.badRequest("자산 구분, 분류, 자산명은 필수입니다.");
        Asset a = new Asset();
        a.orgId = me.orgId();
        a.assetType = type;
        apply(a, body);
        if (a.schoolId == null && me.scope().school()) a.schoolId = me.scope().schoolId();
        checkScope(me, a);
        if (a.categoryId == null || Params.blank(a.assetName)) throw ApiException.badRequest("자산 구분, 분류, 자산명은 필수입니다.");
        if (a.assetNo != null && assets.existsByAssetNoAndUseYn(a.assetNo, "Y")) throw ApiException.conflict("이미 사용 중인 자산번호입니다.");
        if (a.status == null) a.status = "INUSE";
        if (a.lifeYears == null) a.lifeYears = categories.findById(a.categoryId).map(c -> c.lifeYears).orElse(null);
        a.useYn = "Y";
        a.createdAt = Times.now();
        a.updatedAt = a.createdAt;
        assets.save(a);
        if (a.assetNo == null) {
            // Auto number: HW-2026-0008 (sequence = asset id).
            a.assetNo = autoAssetNo(me.orgId(), type, a.acquiredAt, a.assetId);
        }
        log(a.assetId, "CREATE", "자산 등록", me.userId());
        reservations.findByAssetNo(a.assetNo).ifPresent(r -> { r.usedAssetId = a.assetId; r.usedAt = Times.now(); reservations.save(r); });
        return a.assetId;
    }

    /** 기관 접두어가 있으면 CB-2026-00012 형식, 없으면 HW-2026-0008 형식. */
    public String autoAssetNo(Long orgId, String type, java.time.LocalDate acquiredAt, Long seq) {
        String prefix = orgs.findById(orgId).map(o -> o.assetNoPrefix).orElse(null);
        int year = (acquiredAt != null ? acquiredAt : Times.today()).getYear();
        if (prefix == null || prefix.isBlank()) return String.format("%s-%d-%04d", type, Times.today().getYear(), seq);
        return String.format("%s-%d-%05d", prefix, year, seq);
    }

    public void update(CurrentUser me, Long id, Map<String, Object> body) {
        Asset a = load(me, id);
        String prevStatus = a.status;
        Long prevFloor = a.floorId;
        String prevNo = a.assetNo;
        List<String> changed = apply(a, body);
        checkScope(me, a);  // 관외 학교로 옮기는 것도 막는다
        if (Params.blank(a.assetName)) throw ApiException.badRequest("자산명을 입력해 주세요.");
        if (a.assetNo == null) a.assetNo = prevNo;
        if (!Objects.equals(prevNo, a.assetNo) && assets.existsByAssetNoAndUseYn(a.assetNo, "Y")) throw ApiException.conflict("이미 사용 중인 자산번호입니다.");
        if (!Objects.equals(prevFloor, a.floorId)) { a.posX = null; a.posY = null; }
        if (!Objects.equals(prevStatus, a.status)) log(a.assetId, "STATUS", "상태 변경 (" + prevStatus + " → " + a.status + ")", me.userId());
        a.updatedAt = Times.now();
        if (!changed.isEmpty()) log(a.assetId, "UPDATE", "정보 수정 (" + String.join(", ", changed) + ")", me.userId());
    }

    public void position(CurrentUser me, Long id, Map<String, Object> body) {
        Asset a = load(me, id);
        Double x = Params.dbl(body, "posX");
        if (x == null) {
            a.posX = null; a.posY = null;
            log(a.assetId, "LOCATE", "도면 배치 해제", me.userId());
        } else {
            Long floorId = Params.lng(body, "floorId");
            Floor f = floors.findById(floorId != null ? floorId : a.floorId == null ? -1L : a.floorId)
                    .orElseThrow(() -> ApiException.badRequest("층 정보가 올바르지 않습니다."));
            Double y = Params.dbl(body, "posY");
            a.floorId = f.floorId;
            a.buildingId = f.buildingId;
            a.posX = clamp(x);
            a.posY = clamp(y == null ? 50 : y);
            log(a.assetId, "LOCATE", "도면 배치 (" + f.floorName + " → x:" + fmt(a.posX) + ", y:" + fmt(a.posY) + ")", me.userId());
        }
        a.updatedAt = Times.now();
    }

    private static double clamp(double v) {
        return Math.round(Math.min(99, Math.max(1, v)) * 100) / 100.0;
    }

    private static String fmt(double v) {
        return v == Math.floor(v) ? String.valueOf((long) v) : String.valueOf(v);
    }

    public void delete(CurrentUser me, Long id) {
        Asset a = load(me, id);
        a.useYn = "N";
        a.updatedAt = Times.now();
        log(a.assetId, "DELETE", "자산 삭제", me.userId());
    }
}
