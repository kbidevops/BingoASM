package com.bingoasm.seed;

import com.bingoasm.domain.*;
import com.bingoasm.domain.as.*;
import com.bingoasm.repo.*;
import com.bingoasm.repo.as.*;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 원클릭 AS 데모 데이터. DataSeeder(기관·관리자) 다음에 실행되며 학교가 하나도 없을 때만 넣는다.
 * 학교·업체·사람 이름은 모두 가상이다.
 */
@Component
@Order(2)
public class AsDataSeeder implements CommandLineRunner {
    private static final Logger log = LoggerFactory.getLogger(AsDataSeeder.class);
    private static final String PW = "user1234!";

    private final OrgRepository orgs;
    private final UserRepository users;
    private final CategoryRepository categories;
    private final BuildingRepository buildings;
    private final FloorRepository floors;
    private final FileRepository files;
    private final AssetRepository assets;
    private final RegionRepository regions;
    private final SchoolRepository schools;
    private final VendorRepository vendors;
    private final SchoolVendorRepository schoolVendors;
    private final WirelessDeviceRepository devices;
    private final RoomRepository rooms;
    private final AsRequestRepository requests;
    private final AsHistoryRepository histories;
    private final AsCostItemRepository costItems;
    private final PostRepository posts;
    private final PostCommentRepository comments;
    private final ContactRepository contacts;
    private final BCryptPasswordEncoder encoder;

    public AsDataSeeder(OrgRepository orgs, UserRepository users, CategoryRepository categories, BuildingRepository buildings, FloorRepository floors,
                        FileRepository files, AssetRepository assets, RegionRepository regions, SchoolRepository schools, VendorRepository vendors,
                        SchoolVendorRepository schoolVendors, WirelessDeviceRepository devices, RoomRepository rooms, AsRequestRepository requests,
                        AsHistoryRepository histories, PostRepository posts, PostCommentRepository comments, ContactRepository contacts,
                        BCryptPasswordEncoder encoder, AsCostItemRepository costItems) {
        this.costItems = costItems;
        this.orgs = orgs; this.users = users; this.categories = categories; this.buildings = buildings; this.floors = floors; this.files = files;
        this.assets = assets; this.regions = regions; this.schools = schools; this.vendors = vendors; this.schoolVendors = schoolVendors;
        this.devices = devices; this.rooms = rooms; this.requests = requests; this.histories = histories; this.posts = posts; this.comments = comments;
        this.contacts = contacts; this.encoder = encoder;
    }

    private Long o;
    private final LocalDateTime base = LocalDateTime.of(2026, 10, 27, 9, 0);

    private LocalDateTime at(int daysAgo, int hour, int minute) { return base.minusDays(daysAgo).withHour(hour).withMinute(minute).withSecond(0).withNano(0); }

    @Override
    @Transactional
    public void run(String... args) {
        if (schools.count() > 0) return;
        Org org = orgs.findAll().stream().findFirst().orElse(null);
        if (org == null) return;
        log.info("Loading 원클릭 AS demo data");
        o = org.orgId;
        if (org.assetNoPrefix == null || org.assetNoPrefix.isBlank()) { org.assetNoPrefix = "CB"; orgs.save(org); }

        // ----- 지역: 충청남도교육청 산하 교육지원청 10곳 (괴산·증평은 한 곳) -----
        List<String> names = List.of("청주", "충주", "제천", "보은", "옥천", "영동", "진천", "괴산증평", "음성", "단양");
        Map<String, Region> rg = new LinkedHashMap<>();
        for (int k = 0; k < names.size(); k++) rg.put(names.get(k) + "교육지원청", region(names.get(k) + "교육지원청", k + 1));
        Region rCheongju = rg.get("청주교육지원청"), rChungju = rg.get("충주교육지원청"), rJecheon = rg.get("제천교육지원청"),
                rOkcheon = rg.get("옥천교육지원청"), rJincheon = rg.get("진천교육지원청");

        // ----- 분류 내용연수 -----
        Map<String, Integer> life = Map.of("컴퓨터", 5, "프린터", 5, "네트워크 장비", 6, "서버/스토리지", 6, "주변기기", 5);
        for (Category c : categories.findByUseYnOrderBySortOrderAsc("Y")) if (c.lifeYears == null && life.containsKey(c.categoryName)) { c.lifeYears = life.get(c.categoryName); categories.save(c); }
        Category cDesktop = category("데스크톱", 5, 11), cLaptop = category("노트북", 5, 12), cMonitor = category("모니터", 6, 13),
                cPrinter = category("프린터·복합기", 5, 14), cBoard = category("전자칠판", 7, 15), cTablet = category("태블릿", 5, 16);

        // ----- 학교 (이름·주소·전화는 모두 가상) -----
        School bonghwang = school(rCheongju, "M1010001", "봉황초등학교", "ELEM", "충북 청주시 상당구 봉황로 12", "043-200-1100", 18, "CONTRACTED");
        School geumseong = school(rCheongju, "M1010002", "미래중학교", "MID", "충북 청주시 서원구 미래로 45", "043-200-1200", 12, "CONTRACTED");
        School sanseong = school(rCheongju, "M1010003", "푸른고등학교", "HIGH", "충북 청주시 흥덕구 푸른로 7", "043-200-1300", 24, "CONTRACTED");
        School baekje = school(rCheongju, "M1010004", "새봄초등학교", "ELEM", "충북 청주시 청원구 새봄로 88", "043-200-1400", 10, "CONTRACTED");
        School oncheon = school(rChungju, "M1020001", "온천중학교", "MID", "충북 충주시 수안보면 온천대로 101", "043-800-2100", 15, "CONTRACTED");
        School haemi = school(rJecheon, "M1030001", "솔빛고등학교", "HIGH", "충북 제천시 솔빛로 3", "043-600-3100", 20, "CONTRACTED");
        School hongju = school(rOkcheon, "M1050001", "향수초등학교", "ELEM", "충북 옥천군 옥천읍 향수길 55", "043-700-4100", 14, "CONTRACTED");
        School gyeryong = school(rJincheon, "M1070001", "가람특수학교", "SPECIAL", "충북 진천군 진천읍 가람로 9", "043-500-5100", 6, "CONTRACTED");
        List<School> allSchools = List.of(bonghwang, geumseong, sanseong, baekje, oncheon, haemi, hongju, gyeryong);

        // ----- 업체 (가상) -----
        Vendor hanbit = vendor(rCheongju, "한빛네트웍스", "312-81-00011", "043-210-7000", "충북 청주시 흥덕구 직지대로 120", "M,S");

        // ----- 사용자 -----
        AppUser school01 = user("school01", "한보람", "정보부장", "school01@example.go.kr", "010-2000-0001", List.of("SCHOOL_USER"), bonghwang.schoolId, null, false);
        AppUser school02 = user("school02", "오세준", "교무행정사", "school02@example.go.kr", "010-2000-0002", List.of("SCHOOL_USER"), oncheon.schoolId, null, false);
        AppUser netEng = user("netengineer", "강민재", "기술과장", "net@hanbit.example.com", "010-3000-0001", List.of("AS_ENGINEER"), null, hanbit.vendorId, false);
        AppUser vendorAdmin = user("vendoradmin", "서정우", "대표", "ceo@hanbit.example.com", "010-3000-0009", List.of("VENDOR_ADMIN"), null, hanbit.vendorId, false);
        AppUser eduAdmin = user("eduadmin", "신현아", "주무관", "edu@example.go.kr", "010-4000-0001", List.of("EDU_ADMIN"), null, null, true);
        // 교육지원청 담당자: 청주교육지원청 관내 학교(봉황초·미래중·푸른고·새봄초)만 다룬다
        AppUser regionAdmin = user("regionadmin", "문가온", "정보지원팀 주무관", "region@example.go.kr", "010-4000-0002", List.of("REGION_ADMIN"), null, null, false);
        regionAdmin.regionId = rCheongju.regionId; users.save(regionAdmin);

        // ----- 학교별 담당 업체·기사 -----
        for (School s : allSchools) {
            map(s, "M", hanbit, netEng);
            map(s, "S", hanbit, netEng);
        }

        // ----- 무선망 장비 -----
        WirelessDevice apB1 = device(bonghwang, "AP-BH-001", "본관 1층 교무실 AP", "AP", "Aruba AP-515", "10.73.1.11", "본관 1층 교무실 천장", "NORMAL");
        WirelessDevice apB2 = device(bonghwang, "AP-BH-002", "본관 2층 복도 AP", "AP", "Aruba AP-515", "10.73.1.12", "본관 2층 복도", "NORMAL");
        WirelessDevice apB3 = device(bonghwang, "AP-BH-003", "본관 2층 컴퓨터실 AP", "AP", "Aruba AP-515", "10.73.1.13", "본관 2층 컴퓨터실", "FAULT");
        device(bonghwang, "SW-BH-001", "본관 1층 통신실 PoE 스위치", "SWITCH", "Cisco C9200L-24P", "10.73.1.2", "본관 1층 통신실", "NORMAL");
        device(bonghwang, "WC-BH-001", "무선 컨트롤러", "CONTROLLER", "Aruba 7210", "10.73.1.1", "본관 1층 통신실", "NORMAL");
        device(oncheon, "AP-OC-001", "본관 1층 교무실 AP", "AP", "Cisco C9120AXI", "10.74.5.11", "본관 1층 교무실", "NORMAL");
        WirelessDevice apO2 = device(oncheon, "AP-OC-002", "본관 2층 정보실 AP", "AP", "Cisco C9120AXI", "10.74.5.12", "본관 2층 정보실", "NORMAL");
        device(sanseong, "AP-SS-001", "교사동 3층 복도 AP", "AP", "Aruba AP-535", "10.73.9.11", "교사동 3층 복도", "NORMAL");
        device(sanseong, "AP-SS-002", "교사동 3층 컴퓨터실 AP", "AP", "Aruba AP-535", "10.73.9.12", "교사동 3층 컴퓨터실", "NORMAL");
        device(haemi, "AP-HM-001", "본관 2층 복도 AP", "AP", "Aruba AP-515", "10.75.2.11", "본관 2층 복도", "NORMAL");
        device(hongju, "AP-HJ-001", "본관 1층 복도 AP", "AP", "Cisco C9120AXI", "10.76.3.11", "본관 1층 복도", "NORMAL");

        // ----- 공간: 봉황초 본관(도면), 온천중 본관 -----
        StoredFile plan = planFile();
        Building bhMain = building(bonghwang, "본관", "충북 청주시 상당구 봉황로 12");
        Floor bh1 = floor(bhMain, 1, "1층", null), bh2 = floor(bhMain, 2, "2층", plan.fileId), bh3 = floor(bhMain, 3, "3층", null);
        Room bhOffice = room(bonghwang, bhMain, bh1, "101", "교무실", "OFFICE", "교감", null);
        Room bhAdmin = room(bonghwang, bhMain, bh1, "102", "행정실", "OFFICE", "행정실장", null);
        Room bhComm = room(bonghwang, bhMain, bh1, "103", "통신실", "SERVER", "정보부장", null);
        Room bhPc = room(bonghwang, bhMain, bh2, "201", "컴퓨터실", "LAB", "정보부장", new double[]{8, 12, 26, 30});
        Room bh11 = room(bonghwang, bhMain, bh2, "202", "1-1 교실", "CLASS", "1-1 담임", new double[]{38, 12, 20, 30});
        Room bh12 = room(bonghwang, bhMain, bh2, "203", "1-2 교실", "CLASS", "1-2 담임", new double[]{62, 12, 20, 30});
        Room bhSci = room(bonghwang, bhMain, bh3, "301", "과학실", "LAB", "과학부장", null);
        Room bhLib = room(bonghwang, bhMain, bh3, "302", "도서실", "ETC", "사서", null);
        Building ocMain = building(oncheon, "본관", "충북 충주시 수안보면 온천대로 101");
        Floor oc1 = floor(ocMain, 1, "1층", null), oc2 = floor(ocMain, 2, "2층", null);
        Room ocOffice = room(oncheon, ocMain, oc1, "101", "교무실", "OFFICE", "교감", null);
        Room ocInfo = room(oncheon, ocMain, oc2, "201", "정보실", "LAB", "정보부장", null);

        // ----- 학교 자산 -----
        Asset bhPc1 = asset(bonghwang, bhPc, cDesktop, "학생용 데스크톱 i5/16GB/512GB", "삼성전자", "DM500TGA", "BH-PC-2021-01", "2021-03-02", 920000L, "INUSE", null);
        Asset bhPc2 = asset(bonghwang, bhPc, cDesktop, "학생용 데스크톱 i5/16GB/512GB", "삼성전자", "DM500TGA", "BH-PC-2021-02", "2021-03-02", 920000L, "INUSE", null);
        Asset bhPc3 = asset(bonghwang, bhPc, cDesktop, "학생용 데스크톱 i5/16GB/512GB", "삼성전자", "DM500TGA", "BH-PC-2021-03", "2021-03-02", 920000L, "REPAIR", null);
        Asset bhMon1 = asset(bonghwang, bhPc, cMonitor, "24형 모니터", "LG전자", "24MP400", "BH-MO-2021-01", "2021-03-02", 180000L, "INUSE", null);
        Asset bhMon2 = asset(bonghwang, bhPc, cMonitor, "24형 모니터", "LG전자", "24MP400", "BH-MO-2021-02", "2021-03-02", 180000L, "INUSE", null);
        Asset bhBoard = asset(bonghwang, bh11, cBoard, "75형 전자칠판", "아하정보통신", "AHA-75", "BH-EB-2023-01", "2023-08-21", 3200000L, "INUSE", null);
        Asset bhBoard2 = asset(bonghwang, bh12, cBoard, "75형 전자칠판", "아하정보통신", "AHA-75", "BH-EB-2023-02", "2023-08-21", 3200000L, "INUSE", null);
        Asset bhNb = asset(bonghwang, bhOffice, cLaptop, "교사용 노트북 14형", "LG전자", "14ZD90Q", "BH-NB-2022-01", "2022-04-11", 1350000L, "INUSE", null);
        Asset bhOld = asset(bonghwang, bhAdmin, cDesktop, "행정용 데스크톱(구형)", "삼성전자", "DB400T7A", "BH-PC-2019-07", "2019-02-25", 850000L, "DISPOSE_PLANNED", "내용연수 경과 — 불용 예정");
        Asset bhPrn = asset(bonghwang, bhAdmin, cPrinter, "A3 컬러 복합기", "신도리코", "D451", "BH-PR-2022-01", "2022-06-14", 2400000L, "INUSE", null);
        Asset bhTab1 = asset(bonghwang, bh11, cTablet, "학생용 태블릿 10.4형", "삼성전자", "SM-X205", "BH-TB-2024-01", "2024-03-04", 420000L, "INUSE", null);
        Asset bhTab2 = asset(bonghwang, bh11, cTablet, "학생용 태블릿 10.4형", "삼성전자", "SM-X205", "BH-TB-2024-02", "2024-03-04", 420000L, "INUSE", null);
        Asset bhSciPc = asset(bonghwang, bhSci, cLaptop, "과학실 실습 노트북", "삼성전자", "NT550XDA", "BH-NB-2023-05", "2023-03-06", 980000L, "INUSE", null);
        Asset bhUnplaced = asset(bonghwang, null, cMonitor, "27형 모니터(미배치)", "삼성전자", "S27A600", "BH-MO-2025-09", "2025-09-01", 260000L, "IDLE", "위치 미지정");
        Asset ocPc = asset(oncheon, ocInfo, cDesktop, "정보실 데스크톱", "LG전자", "LG-DT-02", "OC-PC-2022-01", "2022-03-02", 900000L, "INUSE", null);
        Asset ocNb = asset(oncheon, ocOffice, cLaptop, "교사용 노트북 15형", "삼성전자", "NT950XDB", "OC-NB-2023-01", "2023-05-15", 1500000L, "INUSE", null);
        asset(oncheon, ocInfo, cPrinter, "흑백 레이저 프린터", "HP", "M404dn", "OC-PR-2021-01", "2021-11-01", 350000L, "INUSE", null);

        // ----- AS 신청 (정보기기 C · 스마트기기 T 데모 데이터는 넣지 않는다: 업체·기사·신청 모두) -----
        // 무선망(M)
        AsRequest m1 = req("M", bonghwang, school01, "P", "접속불량", "2", "2층 컴퓨터실 AP에 학생 태블릿 30대가 접속되지 않습니다. AP 램프는 주황색으로 점멸합니다.", "본관 2층 컴퓨터실", at(0, 8, 50), hanbit, netEng, "A");
        m1.deviceId = apB3.deviceId; m1.deviceName = apB3.deviceName; m1.visitRequestAt = at(-1, 10, 0);
        requests.save(m1); hist(m1, null, "A", "REQUEST", "AS 신청 등록", school01, m1.requestAt);
        AsRequest m2 = req("M", oncheon, school02, "S", "속도느림", "1", "정보실 무선 속도가 오후에 급격히 느려집니다. 원격 재부팅 요청드립니다.", "본관 2층 정보실", at(2, 14, 10), hanbit, netEng, "R");
        m2.deviceId = apO2.deviceId; m2.deviceName = apO2.deviceName; m2.receivedAt = at(2, 15, 0); m2.visitPlannedAt = at(-1, 9, 30);
        requests.save(m2); hist(m2, null, "A", "REQUEST", "AS 신청 등록", school02, m2.requestAt); hist(m2, "A", "R", "RECEIVE", "접수 처리 · 방문예정 " + m2.visitPlannedAt.toString().replace('T', ' '), netEng, m2.receivedAt);
        AsRequest m3 = done("M", sanseong, eduAdmin, "박하늘", "P", "접속불량", "3층 복도 AP 접속 불가", "교사동 3층 복도", at(20, 9, 0), hanbit, netEng, at(20, 9, 30), at(19, 10, 0), at(19, 11, 0), "AP 행업", "AP 재부팅 및 펌웨어 업데이트", "2", "장비행업", 0L, 4, "방문이 빨랐습니다.");
        m3.requestTypeCode = "2"; m3.deviceName = "교사동 3층 복도 AP"; requests.save(m3);
        done("M", haemi, eduAdmin, "최민호", "W", "직접입력", "본관 2층 복도 AP 전원이 들어오지 않음", "본관 2층 복도", at(55, 10, 0), hanbit, netEng, at(55, 10, 20), at(54, 14, 0), at(54, 15, 30), "PoE 인젝터 고장", "PoE 인젝터 교체", "6", "부속품불량", 85000L, null, null);
        done("M", bonghwang, school01, null, "S", "속도느림", "1층 교무실 무선 속도 저하", "본관 1층 교무실", at(90, 9, 0), hanbit, netEng, at(90, 9, 30), at(89, 10, 0), at(89, 10, 40), "채널 간섭", "채널·출력 재설정", "3", "설정오류", 0L, 5, "좋았습니다.");
        done("M", hongju, eduAdmin, "정유진", "P", "접속불량", "1층 복도 AP 간헐 끊김", "본관 1층 복도", at(150, 9, 0), hanbit, netEng, at(150, 9, 30), at(148, 10, 0), at(148, 12, 0), "케이블 불량", "UTP 케이블 재포설", "4", "케이블불량", 120000L, 3, "조치는 됐지만 시간이 걸렸습니다.");

        // 스쿨넷(S)
        AsRequest s1 = req("S", bonghwang, school01, "71", "전체", null, "오전 9시부터 교육망·행정망 모두 인터넷이 되지 않습니다. 라우터 WAN 램프가 꺼져 있습니다.", "본관 1층 통신실", at(0, 9, 5), hanbit, netEng, "A");
        s1.visitRequestAt = at(0, 13, 0);
        requests.save(s1); hist(s1, null, "A", "REQUEST", "AS 신청 등록", school01, s1.requestAt);
        done("S", hongju, eduAdmin, "정유진", "72", "일부", "별관만 인터넷 불가", "별관 1층 통신실", at(30, 9, 0), hanbit, netEng, at(30, 9, 20), at(30, 11, 0), at(30, 12, 0), "광 컨버터 고장", "광 컨버터 교체", "1", "장비불량", 150000L, 5, "당일 처리 감사합니다.");
        done("S", geumseong, eduAdmin, "김수현", "73", "기타", "학교 홈페이지 접속만 안 됨", "본관 1층 교무실", at(100, 10, 0), hanbit, netEng, at(100, 10, 30), at(99, 10, 0), at(99, 10, 30), "DNS 설정", "DNS 설정 변경", "3", "설정오류", 0L, 4, null);

        // ----- 게시판 -----
        Post n1 = post("NOTICE", eduAdmin, "[공지] 2026학년도 AS 운영 안내", "2026학년도 무선망·스쿨넷 AS 운영 방식을 안내드립니다.\n- 신청: 원클릭 AS 시스템 > 각 메뉴의 AS 신청\n- 처리: 담당 업체 접수 후 방문\n- 처리 완료 후 만족도 평가를 부탁드립니다.", "긴급", null, null, null, null, false, at(30, 9, 0));
        n1.viewCount = 128; posts.save(n1);
        post("NOTICE", eduAdmin, "[자료] 자산 일괄 등록 양식 사용 안내", "자산관리 > 일괄 등록 메뉴에서 양식을 내려받아 작성 후 올려 주세요. 기관명·분류·품명·취득일·내용연수·위치·상태 7개 열입니다.", "자료", null, null, null, null, false, at(20, 10, 0));
        post("NOTICE", eduAdmin, "QR 라벨 인쇄 및 재물조사 안내", "자산 상세 > 라벨 인쇄로 QR 라벨을 출력할 수 있습니다. 재물조사는 실 QR을 찍은 뒤 자산 라벨을 순서대로 스캔하면 됩니다.", "일반", null, null, null, null, false, at(10, 9, 30));
        Post q1 = post("QNA", school01, "무선 AP 원격 재부팅은 어떻게 신청하나요?", "무선망 AS신청에서 요청유형을 어떻게 골라야 하는지 궁금합니다.", "질문", "WIRELESS", null, bonghwang.schoolId, null, false, at(8, 14, 0));
        comment(q1, eduAdmin, "무선망 AS신청 > 요청유형에서 '무선 AP 원격 재부팅 요청'을 선택하고 대상 장비를 고르시면 업체에서 원격으로 처리합니다.", at(8, 16, 30));
        Post cs1 = post("CONSULT", school01, "컴퓨터실 네트워크 재구성 컨설팅 요청", "컴퓨터실 PC 30대 증설에 따른 네트워크 구성 자문을 요청합니다.", null, null, rCheongju.regionId, bonghwang.schoolId, "WAIT", false, at(4, 10, 0));
        Post d1 = post("DISPOSAL", school01, "불용 PC 12대 수거 신청", "내용연수 경과 PC 12대, 모니터 10대 수거 요청드립니다. 행정실 앞 복도에 모아 두었습니다.", null, null, rCheongju.regionId, bonghwang.schoolId, "RECEIVED", false, at(9, 9, 0));
        d1.visitDate = LocalDate.of(2026, 11, 5); posts.save(d1);
        comment(d1, eduAdmin, "11월 5일 오전 수거 예정입니다. 하드디스크 분리 여부를 확인해 주세요.", at(8, 13, 0));
        Post d2 = post("DISPOSAL", school02, "불용 프린터 3대 수거", "프린터 3대 수거 요청", null, null, rChungju.regionId, oncheon.schoolId, "DONE", false, at(40, 9, 0));
        d2.visitDate = LocalDate.of(2026, 9, 30); posts.save(d2);
        post("VENDOR", vendorAdmin, "10월 정기 점검 일정 공유", "한빛네트웍스 10월 무선망 정기 점검 일정을 공유합니다. 청주지역 10/28~10/30, 충주지역 11/3.", "의견사항", null, rCheongju.regionId, null, null, false, at(6, 15, 0));
        post("VENDOR", netEng, "AP 펌웨어 일괄 업데이트 문의", "Aruba AP-515 펌웨어 8.10 업데이트를 도교육청 차원에서 일괄 적용할지 문의드립니다.", "업무질의", null, rCheongju.regionId, null, null, false, at(3, 9, 0));
        post("SLA", eduAdmin, "2026년 3분기 스쿨넷 SLA 결과", "3분기 스쿨넷 가용률 99.93%, 평균 장애 복구 2.1시간. 세부 자료는 첨부 참조.", null, null, null, null, null, false, at(15, 9, 0));

        // ----- 문의처: cbe.go.kr 문의처 안내의 도교육청·교육지원청 공개 연락처 (seed/contacts-chungbuk.json) -----
        int i = 0;
        for (Map<String, Object> c : contactSeed()) {
            Region r = c.get("region") == null ? null : rg.get((String) c.get("region"));
            @SuppressWarnings("unchecked") List<String> duties = (List<String>) c.getOrDefault("duties", List.of());
            contact(r == null ? null : r.regionId, (String) c.get("groupName"), (String) c.get("itemName"), (String) c.get("tel"),
                    (String) c.get("note"), duties.isEmpty() ? null : String.join("\n", duties), ++i);
        }
        log.info("원클릭 AS demo data loaded: {} schools, {} vendors, {} requests", schools.count(), vendors.count(), requests.count());
    }

    // ---------- helpers ----------

    private Region region(String name, int sort) { Region r = new Region(); r.orgId = o; r.regionName = name; r.sortOrder = sort; return regions.save(r); }

    private Category category(String name, int life, int sort) {
        Category c = new Category(); c.assetType = "HW"; c.categoryName = name; c.lifeYears = life; c.sortOrder = sort; return categories.save(c);
    }

    private School school(Region region, String code, String name, String type, String addr, String tel, int classes, String contract) {
        School s = new School(); s.orgId = o; s.regionId = region.regionId; s.schoolCode = code; s.schoolName = name; s.schoolType = type;
        s.address = addr; s.tel = tel; s.classCount = classes; s.contractStatus = contract; s.createdAt = at(300, 9, 0);
        return schools.save(s);
    }

    private Vendor vendor(Region region, String name, String biz, String tel, String addr, String types) {
        Vendor v = new Vendor(); v.orgId = o; v.regionId = region == null ? null : region.regionId; v.vendorName = name; v.bizNo = biz; v.tel = tel; v.address = addr;
        v.serviceTypes = types; v.createdAt = at(300, 9, 0); v.updatedAt = v.createdAt;
        return vendors.save(v);
    }

    private AppUser user(String loginId, String name, String pos, String email, String mobile, List<String> roles, Long schoolId, Long vendorId, boolean otp) {
        AppUser u = new AppUser();
        u.orgId = o; u.loginId = loginId; u.password = encoder.encode(PW); u.userName = name; u.positionName = pos; u.email = email; u.mobile = mobile;
        u.roles = new ArrayList<>(roles); u.schoolId = schoolId; u.vendorId = vendorId; u.otpEnabled = otp; u.createdAt = at(300, 9, 0); u.passwordChangedAt = at(20, 9, 0);
        return users.save(u);
    }

    private void map(School s, String ty, Vendor v, AppUser eng) {
        SchoolVendor sv = new SchoolVendor(); sv.schoolId = s.schoolId; sv.rceptTy = ty; sv.vendorId = v.vendorId; sv.engineerUserId = eng.userId; schoolVendors.save(sv);
    }

    private WirelessDevice device(School s, String code, String name, String type, String model, String ip, String loc, String status) {
        WirelessDevice d = new WirelessDevice(); d.orgId = o; d.schoolId = s.schoolId; d.deviceCode = code; d.deviceName = name; d.deviceType = type; d.modelName = model;
        d.ipAddress = ip; d.macAddress = String.format("A8:BD:27:%02X:%02X:%02X", code.hashCode() & 0xff, (code.hashCode() >> 8) & 0xff, (code.hashCode() >> 16) & 0xff);
        d.location = loc; d.installedAt = LocalDate.of(2023, 2, 20); d.lastCheckedAt = LocalDate.of(2026, 9, 12); d.status = status;
        return devices.save(d);
    }

    private StoredFile planFile() {
        StoredFile f = new StoredFile(); f.storedName = "demo-floor-plan.svg"; f.originalName = "봉황초_본관_2층.svg"; f.mimeType = "image/svg+xml"; f.fileSize = 0L; f.createdAt = at(100, 9, 0);
        return files.save(f);
    }

    private Building building(School s, String name, String addr) {
        Building b = new Building(); b.orgId = o; b.schoolId = s.schoolId; b.buildingName = name; b.address = addr; return buildings.save(b);
    }

    private Floor floor(Building b, int no, String name, Long planFileId) {
        Floor f = new Floor(); f.buildingId = b.buildingId; f.floorNo = no; f.floorName = name; f.sortOrder = no; f.planFileId = planFileId; return floors.save(f);
    }

    private Room room(School s, Building b, Floor f, String no, String name, String type, String owner, double[] rect) {
        Room r = new Room(); r.orgId = o; r.schoolId = s.schoolId; r.buildingId = b.buildingId; r.floorId = f.floorId; r.roomNo = no; r.roomName = name; r.roomType = type; r.ownerName = owner;
        if (rect != null) { r.rectX = rect[0]; r.rectY = rect[1]; r.rectW = rect[2]; r.rectH = rect[3]; }
        return rooms.save(r);
    }

    private Asset asset(School s, Room room, Category cat, String name, String mfr, String model, String serial, String acquired, Long price, String status, String note) {
        Asset a = new Asset(); a.orgId = o; a.assetType = "HW"; a.categoryId = cat.categoryId; a.assetName = name; a.manufacturer = mfr; a.modelName = model; a.serialNo = serial;
        a.acquiredAt = LocalDate.parse(acquired); a.acquirePrice = price; a.warrantyEnd = a.acquiredAt.plusYears(3); a.status = status; a.lifeYears = cat.lifeYears;
        a.schoolId = s.schoolId; a.note = note;
        if (room != null) { a.roomId = room.roomId; a.buildingId = room.buildingId; a.floorId = room.floorId; a.locationDetail = room.roomName; }
        a.createdAt = at(60, 9, 0); a.updatedAt = a.createdAt;
        assets.save(a);
        a.assetNo = String.format("CB-%d-%05d", a.acquiredAt.getYear(), a.assetId);
        return assets.save(a);
    }

    private AsRequest req(String ty, School s, AppUser applicant, String faultCode, String faultName, String requestType, String symptom, String place,
                          LocalDateTime requestAt, Vendor v, AppUser eng, String status) {
        AsRequest r = new AsRequest(); r.orgId = o; r.rceptTy = ty; r.schoolId = s.schoolId; r.applicantUserId = applicant.userId; r.applicantName = applicant.userName;
        r.contactTel = applicant.mobile; r.faultTypeCode = faultCode; r.faultTypeName = faultName; r.requestTypeCode = requestType; r.symptom = symptom; r.installPlace = place;
        r.requestAt = requestAt; r.status = status; r.vendorId = v.vendorId; r.engineerUserId = eng.userId; r.engineerName = eng.userName;
        return r;
    }

    /** 처리완료 건: 접수 → 방문 → 보고서 → (평가). */
    private AsRequest done(String ty, School s, AppUser applicant, String applicantName, String faultCode, String faultName, String symptom, String place, LocalDateTime requestAt,
                           Vendor v, AppUser eng, LocalDateTime receivedAt, LocalDateTime visitAt, LocalDateTime completedAt,
                           String trouble, String inspect, String processType, String processContent, Long amount, Integer score, String opinion) {
        AsRequest r = req(ty, s, applicant, faultCode, faultName, null, symptom, place, requestAt, v, eng, "C");
        if (applicantName != null) { r.applicantName = applicantName; r.contactTel = s.tel; }
        r.receivedAt = receivedAt; r.visitPlannedAt = visitAt; r.visitAt = visitAt; r.visitEndAt = completedAt; r.completedAt = completedAt;
        r.troubleSymptom = trouble; r.inspectContent = inspect; r.processTypeCode = processType; r.processContent = processContent; r.processAmount = amount;
        if (score != null) { r.evalScore = score; r.evalOpinion = opinion; r.evaluatedAt = completedAt.plusDays(1); }
        // 계약 학교의 정보기기 AS와 스쿨넷(통신사 SLA)은 무상, 그 밖에는 비용이 있으면 유상.
        boolean covered = ("C".equals(ty) && "CONTRACTED".equals(s.contractStatus)) || "S".equals(ty);
        r.chargeType = covered || amount == null || amount == 0 ? "FREE" : "PAID";
        requests.save(r);
        if (amount != null && amount > 0) {
            long part = Math.round(amount * 0.6 / 1000) * 1000;
            costItem(r, 1, "PART", "M".equals(ty) ? "무선 AP 교체 부품" : "S".equals(ty) ? "회선 장비 부품" : "교체 부품", part);
            costItem(r, 2, "LABOR", "현장 수리 공임", amount - part);
        }
        hist(r, null, "A", "REQUEST", "AS 신청 등록", applicant, requestAt);
        hist(r, "A", "R", "RECEIVE", "접수 처리 · 방문예정 " + visitAt.toString().replace('T', ' '), eng, receivedAt);
        hist(r, "R", "R", "VISIT", "방문 · " + visitAt.toString().replace('T', ' '), eng, visitAt);
        hist(r, "R", "C", "REPORT", "처리 보고서 등록: " + processContent, eng, completedAt);
        if (score != null) hist(r, "C", "C", "EVALUATE", "만족도 평가 " + score + "점", applicant, r.evaluatedAt);
        return r;
    }

    private void costItem(AsRequest r, int sort, String type, String name, long amount) {
        if (amount <= 0) return;
        AsCostItem c = new AsCostItem(); c.asvcSn = r.asvcSn; c.costType = type; c.itemName = name; c.quantity = 1; c.unitPrice = amount; c.amount = amount; c.sortOrder = sort;
        costItems.save(c);
    }

    private void hist(AsRequest r, String prev, String status, String action, String content, AppUser worker, LocalDateTime at) {
        AsHistory h = new AsHistory(); h.asvcSn = r.asvcSn; h.prevStatus = prev; h.status = status; h.action = action; h.content = content; h.workerId = worker.userId; h.createdAt = at;
        histories.save(h);
    }

    private Post post(String board, AppUser author, String title, String content, String category, String field, Long regionId, Long schoolId, String status, boolean secret, LocalDateTime at) {
        Post p = new Post(); p.orgId = o; p.boardCode = board; p.title = title; p.content = content; p.authorUserId = author.userId; p.authorName = author.userName;
        p.categoryCode = category; p.fieldCode = field; p.regionId = regionId; p.schoolId = schoolId; p.status = status; p.secret = secret; p.viewCount = (int) (Math.abs(title.hashCode()) % 40);
        p.createdAt = at; p.updatedAt = at;
        return posts.save(p);
    }

    private void comment(Post p, AppUser author, String content, LocalDateTime at) {
        PostComment c = new PostComment(); c.postId = p.postId; c.content = content; c.authorUserId = author.userId; c.authorName = author.userName; c.createdAt = at;
        comments.save(c);
    }

    private static List<Map<String, Object>> contactSeed() {
        try (var in = new org.springframework.core.io.ClassPathResource("seed/contacts-chungbuk.json").getInputStream()) {
            return new com.fasterxml.jackson.databind.ObjectMapper().readValue(in, new com.fasterxml.jackson.core.type.TypeReference<>() {});
        } catch (java.io.IOException e) {
            log.warn("문의처 시드 파일을 읽지 못했습니다: {}", e.getMessage());
            return List.of();
        }
    }

    private void contact(Long regionId, String group, String item, String tel, String note, String duties, int sort) {
        Contact c = new Contact(); c.orgId = o; c.regionId = regionId; c.groupName = group; c.itemName = item; c.tel = tel; c.note = note; c.duties = duties; c.sortOrder = sort;
        contacts.save(c);
    }
}
