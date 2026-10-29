package com.bingoasm.seed;

import com.bingoasm.common.AppProperties;
import com.bingoasm.domain.*;
import com.bingoasm.repo.*;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.io.ClassPathResource;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Loads the demo dataset (identical to the reference system) when the database is empty. */
@Component
@org.springframework.core.annotation.Order(1)
public class DataSeeder implements CommandLineRunner {
    private static final Logger log = LoggerFactory.getLogger(DataSeeder.class);
    private final OrgRepository orgs;
    private final DepartmentRepository depts;
    private final UserRepository users;
    private final BuildingRepository buildings;
    private final FloorRepository floors;
    private final FileRepository files;
    private final CategoryRepository categories;
    private final AssetRepository assets;
    private final AssetHistoryRepository assetHistories;
    private final ServiceRequestRepository services;
    private final ServiceHistoryRepository serviceHistories;
    private final SatisfactionRepository satisfactions;
    private final BCryptPasswordEncoder encoder;
    private final AppProperties props;

    public DataSeeder(OrgRepository orgs, DepartmentRepository depts, UserRepository users, BuildingRepository buildings,
                      FloorRepository floors, FileRepository files, CategoryRepository categories, AssetRepository assets,
                      AssetHistoryRepository assetHistories, ServiceRequestRepository services,
                      ServiceHistoryRepository serviceHistories, SatisfactionRepository satisfactions,
                      BCryptPasswordEncoder encoder, AppProperties props) {
        this.orgs = orgs; this.depts = depts; this.users = users; this.buildings = buildings; this.floors = floors;
        this.files = files; this.categories = categories; this.assets = assets; this.assetHistories = assetHistories;
        this.services = services; this.serviceHistories = serviceHistories; this.satisfactions = satisfactions;
        this.encoder = encoder; this.props = props;
    }

    private static LocalDateTime t(String s) { return LocalDateTime.parse(s); }
    private static LocalDate d(String s) { return s == null ? null : LocalDate.parse(s); }

    @Override
    @Transactional
    public void run(String... args) throws Exception {
        copyDemoPlan();
        if (orgs.count() > 0) return;
        log.info("Empty database: loading BingoASM demo data");

        Org org = new Org();
        org.orgCode = "CB001"; org.orgName = "충청남도교육청"; org.bizNo = "123-45-67890"; org.repName = "교육감";
        org.tel = "043-290-2000"; org.zipCode = "28635"; org.address = "충북 청주시 서원구 청남로 1929"; org.addressDetail = "본관";
        org.createdAt = t("2026-09-04T16:18:07.633090");
        orgs.save(org);
        Long o = org.orgId;

        for (String[] row : new String[][]{{"정보통신과", "1"}, {"민원봉사과", "2"}, {"회계과", "3"}}) {
            Department dp = new Department();
            dp.orgId = o; dp.deptName = row[0]; dp.sortOrder = Integer.valueOf(row[1]);
            depts.save(dp);
        }

        user(o, 1L, "admin", "admin1234!", "김관리", "팀장", "admin@example.go.kr", "010-1000-0001", List.of("SYS_ADMIN", "SUPER_ADMIN"));
        user(o, 1L, "helpdesk", "user1234!", "박접수", "주무관", "help@example.go.kr", "010-1000-0002", List.of("REQUESTER", "RECEIVER"));
        user(o, 1L, "engineer", "user1234!", "이처리", "기술원", "eng@example.go.kr", "010-1000-0003", List.of("REQUESTER", "PROCESSOR"));
        user(o, 2L, "user01", "user1234!", "최요청", "주무관", "user01@example.go.kr", "010-1000-0004", List.of("REQUESTER"));

        building(o, "본관", "28635", "충청북도 청주시 서원구 청남로 1929", "본관동");
        building(o, "별관", "28635", "충청북도 청주시 서원구 청남로 1929", "별관동");
        building(o, "교육연구정보원", null, "충청북도 청주시 ", "청주시");

        StoredFile plan1 = demoPlanFile(), plan2 = demoPlanFile();
        // Insert in id order so floor ids match the reference system.
        floor(1L, 1, "1층", 1, plan1.fileId);
        floor(1L, 2, "2층", 2, null);
        floor(1L, 3, "3층", 3, null);
        floor(1L, -1, "지하1층", 0, null);
        floor(2L, 1, "1층", 1, plan2.fileId);
        floor(2L, 2, "2층", 2, null);
        floor(3L, 1, "1층", 1, null);
        floor(3L, 2, "2층", 2, null);

        String[][] cats = {{"HW", "컴퓨터"}, {"HW", "프린터"}, {"HW", "네트워크 장비"}, {"HW", "서버/스토리지"}, {"HW", "주변기기"},
                {"SW", "업무용 SW"}, {"SW", "보안 SW"}, {"SW", "운영체제"}};
        for (int i = 0; i < cats.length; i++) {
            Category c = new Category();
            c.assetType = cats[i][0]; c.categoryName = cats[i][1]; c.sortOrder = i + 1;
            categories.save(c);
        }

        Asset a1 = asset(o, "PC-2024-0001", "HW", 1L, "업무용 데스크탑", "삼성전자", "DB400T9A", "SN-PC0001", "i5-13400 / 16GB / 512GB", "2024-03-11", 980000L, "2027-03-10", 1L, 1L, "1층 민원실 창측 1번 자리", 72.6, 50.01, 4L, 2L, null);
        a1.hw = hw("GJ-PC-0001", "Intel i5-13400", "16GB", "512GB NVMe", "Windows 11 Pro", "10.10.1.21", "A4:BB:6D:11:22:33");
        Asset a2 = asset(o, "PC-2024-0002", "HW", 1L, "업무용 노트북", "LG전자", "15ZD90R", "SN-PC0002", "i7-1360P / 16GB / 512GB", "2024-05-02", 1450000L, "2027-05-01", 1L, 3L, "3층 정보통신과 창측", 60.41, 23.56, 3L, 1L, null);
        a2.hw = hw("GJ-NB-0002", "Intel i7-1360P", "16GB", "512GB NVMe", "Windows 11 Pro", "10.10.3.55", "A4:BB:6D:44:55:66");
        Asset a3 = asset(o, "PR-2023-0007", "HW", 2L, "복합기", "신도리코", "D420", "SN-PR0007", "A3 흑백 복합기", "2023-08-20", 2100000L, "2026-08-19", 1L, 1L, "1층 민원실 복도", 72.1, 32.54, 2L, 2L, null);
        a3.hw = hw("GJ-PRN-0007", null, null, null, null, "10.10.1.90", "00:1B:44:AA:BB:CC");
        Asset a4 = asset(o, "NW-2022-0011", "HW", 3L, "L2 스위치", "시스코", "C1000-24T", "SN-NW0011", "24포트 기가비트", "2022-11-15", 890000L, "2025-11-14", 1L, 2L, "지하1층 전산실 랙 A-3", 52.17, 22.54, 3L, 1L, null);
        a4.hw = hw("GJ-SW-0011", null, null, null, "IOS-XE", "10.10.0.2", "00:2A:10:12:34:56");
        Asset a5 = asset(o, "NW-2022-0012", "HW", 3L, "무선 AP", "유비쿼티", "U6-Pro", "SN-NW0012", "Wi-Fi6 실내형", "2022-11-15", 260000L, "2025-11-14", 1L, 2L, "2층 복도 천장", 53.09, 29.19, 3L, 1L, null);
        a5.note = "";
        a5.hw = hw("GJ-AP-0012", null, null, null, "UniFi OS", "10.10.0.31", "00:2A:10:65:43:21");
        Asset a6 = asset(o, "SW-2024-0101", "SW", 6L, "한글 2024", "한글과컴퓨터", "HWP 2024", null, "문서 작성 SW", "2024-01-10", 180000L, null, 1L, 1L, "PC-2024-0001 설치", 31.78, 34.83, 4L, 2L, 1L);
        a6.sw = sw("2024", "한글과컴퓨터", "PERPETUAL", "HWP-XXXX-XXXX-1234", 1, "2024-01-10", null);
        Asset a7 = asset(o, "SW-2024-0102", "SW", 7L, "백신 프로그램", "안랩", "V3 Endpoint", null, "엔드포인트 보안", "2024-01-10", 45000L, null, 1L, 3L, "PC-2024-0002 설치", null, null, 3L, 1L, 2L);
        a7.sw = sw("11.0", "안랩", "SUBSCRIPTION", "V3-XXXX-XXXX-5678", 1, "2024-01-10", "2027-01-09");
        assets.saveAll(List.of(a1, a2, a3, a4, a5, a6, a7));

        assetHistory(a4.assetId, "LOCATE", "도면 배치 (2층 → x:52.17, y:22.54)", 1L, "2026-10-07T09:12:12.398192");
        assetHistory(a1.assetId, "CREATE", "자산 등록", 1L, "2026-09-04T16:18:08.145142");

        // Service requests, in id order.
        ServiceRequest s1 = sr(o, "SR-20260810-0001", 3L, "FAULT", "HIGH", "스쿨넷 회선관련 AS", "무선 접속이 되지 않습니다.", "CLOSED", 4L, "2026-08-16T16:18:08.506364", "041-840-2222", 1L, 1L, "1층 민원실 복도");
        s1.receiverId = 2L; s1.receivedAt = t("2026-08-16T16:38:08.506364"); s1.processorId = 3L; s1.assignedAt = t("2026-08-16T16:48:08.506364");
        s1.startedAt = t("2026-08-16T18:18:08.506364"); s1.completedAt = t("2026-08-16T19:18:08.506364");
        s1.causeCode = "HW_FAULT"; s1.actionCode = "REPLACE"; s1.actionContent = "급지 롤러 교체 및 청소 수행"; s1.workMinutes = 60; s1.closedAt = t("2026-08-17T16:18:08.506364");
        ServiceRequest s2 = sr(o, "SR-20260820-0002", 1L, "INQUIRY", "NORMAL", "한글 파일이 열리지 않음", "문서 실행 시 오류 메시지가 표시됩니다.", "CLOSED", 4L, "2026-08-26T16:18:08.506364", "041-840-2223", 1L, 1L, "1층 민원실 창측 1번 자리");
        s2.receiverId = 2L; s2.receivedAt = t("2026-08-26T16:33:08.506364"); s2.processorId = 3L; s2.assignedAt = t("2026-08-26T16:43:08.506364");
        s2.startedAt = t("2026-08-26T17:18:08.506364"); s2.completedAt = t("2026-08-26T17:58:08.506364");
        s2.causeCode = "SW_ERROR"; s2.actionCode = "REINSTALL"; s2.actionContent = "한글 2024 재설치 후 정상 동작 확인"; s2.workMinutes = 40; s2.closedAt = t("2026-09-16T15:53:37.798033");
        ServiceRequest s3 = sr(o, "SR-20260828-0003", 5L, "FAULT", "URGENT", "2층 무선랜 접속 불가", "2층 전체 무선 접속이 되지 않습니다.", "HOLD", 4L, "2026-09-03T16:18:08.506364", "041-840-2224", 1L, 2L, "2층 복도 천장");
        s3.receiverId = 2L; s3.receivedAt = t("2026-09-03T16:28:08.506364"); s3.processorId = 3L; s3.assignedAt = t("2026-09-03T16:33:08.506364");
        s3.startedAt = t("2026-09-03T16:48:08.506364"); s3.holdReason = "부품 수급 대기";
        ServiceRequest s4 = sr(o, "SR-20260829-0004", 2L, "MOVE", "NORMAL", "노트북 자리 이동 요청", "3층 창측에서 중앙으로 이동 예정입니다.", "REQUESTED", 3L, "2026-09-04T14:18:08.506364", "041-840-2225", 1L, 3L, "3층 정보통신과 창측");
        ServiceRequest s5 = sr(o, "SR-20260917-9001", null, "WIRELESS_AS", "HIGH", "[무선망] 3층 컴퓨터실 무선 접속 불가", "3층 컴퓨터실에서 학생 태블릿 30대가 SSID 에 붙지 않습니다. AP 전원 램프는 켜져 있습니다.", "REQUESTED", 4L, "2026-09-17T06:12:14.522624", "043-290-2000", 1L, 4L, "3층 컴퓨터실");
        ServiceRequest s6 = sr(o, "SR-20260917-9002", null, "SCHOOLNET_AS", "URGENT", "[스쿨넷] 학교 전체 인터넷 불통", "오전 9시부터 교육망·행정망 모두 인터넷이 되지 않습니다. 라우터 WAN 램프가 꺼져 있습니다.", "REQUESTED", 4L, "2026-09-17T08:12:14.666284", "043-290-2000", 1L, 4L, "1층 정보실");
        List<ServiceRequest> all = List.of(s1, s2, s3, s4, s5, s6);
        services.saveAll(all);

        Satisfaction sat = new Satisfaction();
        sat.requestId = s1.requestId; sat.overallScore = 5; sat.kindnessScore = 5; sat.speedScore = 4; sat.expertiseScore = 5;
        sat.comment = "빠르게 조치해 주셔서 감사합니다."; sat.surveyedBy = 4L; sat.surveyedAt = t("2026-09-04T16:18:08.665517");
        satisfactions.save(sat);

        // Status history rebuilt from each request's timestamps.
        List<ServiceHistory> hs = new ArrayList<>();
        for (ServiceRequest r : all) {
            boolean as = r.requestNo.contains("-900");
            hs.add(hist(r.requestId, null, "REQUESTED", as ? "AS 신청 등록" : "서비스 요청 등록", r.requesterId, r.requestAt));
            if (r.receivedAt != null) hs.add(hist(r.requestId, "REQUESTED", "RECEIVED", "접수 처리", r.receiverId, r.receivedAt));
            if (r.assignedAt != null) hs.add(hist(r.requestId, "RECEIVED", "ASSIGNED", "이처리 배정", r.receiverId, r.assignedAt));
            if (r.startedAt != null) hs.add(hist(r.requestId, "ASSIGNED", "PROCESSING", "처리 시작", r.processorId, r.startedAt));
            if ("HOLD".equals(r.status)) hs.add(hist(r.requestId, "PROCESSING", "HOLD", "보류: " + r.holdReason, r.processorId, r.startedAt));
            if (r.completedAt != null) hs.add(hist(r.requestId, "PROCESSING", "COMPLETED", r.actionContent, r.processorId, r.completedAt));
            if (r.closedAt != null) hs.add(hist(r.requestId, "COMPLETED", "CLOSED", "종결 처리", 1L, r.closedAt));
            if (r == s1) hs.add(hist(r.requestId, r.status, r.status, "만족도 등록 (5점)", r.requesterId, sat.surveyedAt));
        }
        serviceHistories.saveAll(hs);
    }

    private void user(Long org, Long dept, String loginId, String pw, String name, String pos, String email, String mobile, List<String> roles) {
        AppUser u = new AppUser();
        u.orgId = org; u.deptId = dept; u.loginId = loginId; u.password = encoder.encode(pw); u.userName = name;
        u.positionName = pos; u.email = email; u.mobile = mobile; u.createdAt = t("2026-09-04T16:18:07.752425");
        u.roles = new ArrayList<>(roles);
        users.save(u);
    }

    private void building(Long org, String name, String zip, String addr, String detail) {
        Building b = new Building();
        b.orgId = org; b.buildingName = name; b.zipCode = zip; b.address = addr; b.addressDetail = detail;
        buildings.save(b);
    }

    private void floor(Long building, int no, String name, int sort, Long planFileId) {
        Floor f = new Floor();
        f.buildingId = building; f.floorNo = no; f.floorName = name; f.sortOrder = sort; f.planFileId = planFileId;
        floors.save(f);
    }

    private StoredFile demoPlanFile() {
        StoredFile f = new StoredFile();
        f.storedName = "demo-floor-plan.svg"; f.originalName = "demo-floor-plan.svg"; f.mimeType = "image/svg+xml";
        f.fileSize = 0L; f.createdAt = t("2026-09-04T16:18:08");
        return files.save(f);
    }

    private void copyDemoPlan() throws Exception {
        Path uploads = Path.of(props.dataDir(), "uploads");
        Files.createDirectories(uploads);
        Path target = uploads.resolve("demo-floor-plan.svg");
        if (Files.exists(target)) return;
        try (InputStream in = new ClassPathResource("seed/demo-floor-plan.svg").getInputStream()) {
            Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private static Asset asset(Long org, String no, String type, Long cat, String name, String mfr, String model, String serial, String spec,
                               String acquired, Long price, String warranty, Long building, Long floor, String loc,
                               Double x, Double y, Long owner, Long dept, Long parent) {
        Asset a = new Asset();
        a.orgId = org; a.assetNo = no; a.assetType = type; a.categoryId = cat; a.assetName = name; a.manufacturer = mfr;
        a.modelName = model; a.serialNo = serial; a.spec = spec; a.acquiredAt = d(acquired); a.acquirePrice = price;
        a.warrantyEnd = d(warranty); a.buildingId = building; a.floorId = floor; a.locationDetail = loc; a.posX = x; a.posY = y;
        a.ownerUserId = owner; a.deptId = dept; a.parentAssetId = parent;
        a.createdAt = t("2026-09-04T16:18:08.145142"); a.updatedAt = a.createdAt;
        return a;
    }

    private static HwDetail hw(String host, String cpu, String mem, String disk, String os, String ip, String mac) {
        HwDetail h = new HwDetail();
        h.hostName = host; h.cpu = cpu; h.memory = mem; h.disk = disk; h.osName = os; h.ipAddress = ip; h.macAddress = mac;
        return h;
    }

    private static SwDetail sw(String ver, String pub, String type, String key, Integer cnt, String start, String end) {
        SwDetail s = new SwDetail();
        s.version = ver; s.publisher = pub; s.licenseType = type; s.licenseKey = key; s.licenseCount = cnt;
        s.licenseStart = d(start); s.licenseEnd = d(end);
        return s;
    }

    private void assetHistory(Long assetId, String type, String content, Long worker, String at) {
        AssetHistory h = new AssetHistory();
        h.assetId = assetId; h.actionType = type; h.content = content; h.workerId = worker; h.createdAt = t(at);
        assetHistories.save(h);
    }

    private static ServiceRequest sr(Long org, String no, Long asset, String type, String prio, String title, String content, String status,
                                     Long requester, String at, String tel, Long building, Long floor, String loc) {
        ServiceRequest s = new ServiceRequest();
        s.orgId = org; s.requestNo = no; s.assetId = asset; s.requestType = type; s.priority = prio; s.title = title; s.content = content;
        s.status = status; s.requesterId = requester; s.requestAt = t(at); s.contactTel = tel; s.buildingId = building; s.floorId = floor;
        s.locationDetail = loc;
        return s;
    }

    private static ServiceHistory hist(Long req, String prev, String status, String content, Long worker, LocalDateTime at) {
        ServiceHistory h = new ServiceHistory();
        h.requestId = req; h.prevStatus = prev; h.status = status; h.content = content; h.workerId = worker; h.createdAt = at;
        return h;
    }
}
