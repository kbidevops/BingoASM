package com.bingoasm.auth;

import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Role → permission mapping. A user's permissions are the union over their roles. */
public final class Roles {
    private Roles() {}

    /** 원클릭 AS 포털 권한 (메뉴 단위). */
    public static final List<String> PORTAL_ALL = List.of(
            "PORTAL_INTRO", "BOARD_NOTICE", "BOARD_QNA", "BOARD_CONSULT", "PORTAL_CONTACT",
            "SMART_REQUEST", "AS_C_REQUEST", "AS_C_VIEW", "BOARD_DISPOSAL", "BOARD_VENDOR",
            "AS_M_REQUEST", "AS_M_VIEW", "AS_S_REQUEST", "AS_S_VIEW", "BOARD_SLA");
    public static final List<String> PORTAL_ADMIN = List.of(
            "AS_MANAGE", "WDEVICE_MANAGE", "SDEVICE_MANAGE", "SCHOOL_ASSET_MANAGE", "SCHOOL_MANAGE", "VENDOR_MANAGE", "AS_STATS",
            "BOARD_ADMIN", "AS_PROCESS", "SPACE_MANAGE", "INVENTORY", "ASSET_BULK", "ASSET_READ", "ASSET_WRITE", "FLOOR_READ", "FLOOR_WRITE", "REGION_MANAGE", "COST_MANAGE");
    /**
     * AS 처리 기능: 접수 · 반려(반려 취소 포함) · 이관 · 신청 취소 · 삭제. 역할마다 지금 할 수 있는 것을 기본으로 주고,
     * 사용자별로 끌 수 있다. 상태·소속 조건(AsRequestService.allowedActions)은 그대로라 켠다고 범위가 넓어지지 않는다.
     */
    public static final List<String> PROCESS_ACTION_PERMS = List.of("AS_RECEIVE", "AS_VISIT", "AS_REPORT", "AS_RETURN", "AS_TRANSFER");
    public static final List<String> ACTION_PERMS = List.of("AS_RECEIVE", "AS_VISIT", "AS_REPORT", "AS_RETURN", "AS_TRANSFER", "AS_CANCEL", "AS_DELETE", "AS_ASSIGN", "AS_EVALUATE");
    /**
     * 처리 기능 중 역할에 없어도 켤 수 있는 것 (역할 권한 관리 · 사용자 메뉴 권한). 나머지 처리 기능은 끄기만 된다.
     * 만족도 평가는 자기가 신청한 건(학교는 자기 학교 건)만 평가하므로 켜도 범위가 넓어지지 않는다 (AsRequestService.canEvaluate).
     */
    public static final List<String> GRANTABLE_ACTION_PERMS = List.of("AS_EVALUATE");

    /**
     * 사용자 메뉴 권한에서 이 계정에 켜고 끌 수 있는 처리 기능 (소속 종류별로 의미가 있는 것만).
     * 학교: 신청 취소 · 만족도 평가 / 업체(기사 · 업체 관리자): 접수 · 방문일 · 보고서 · 반려 · 이관 · 신청 취소 · 만족도 평가 /
     * 교육지원청: 삭제를 뺀 전부 (관내 학교 건만) / 도교육청 · 관리자: 전부. 켜도 데이터 범위는 그대로다 (AsRequestService.allowedActions).
     */
    public static List<String> applicableActions(java.util.Collection<String> roles) {
        String kind = roles.stream().map(AFFILIATION::get).filter(java.util.Objects::nonNull).findFirst().orElse(null);
        if ("school".equals(kind)) return List.of("AS_CANCEL", "AS_EVALUATE");
        if ("vendor".equals(kind)) return List.of("AS_RECEIVE", "AS_VISIT", "AS_REPORT", "AS_RETURN", "AS_TRANSFER", "AS_CANCEL", "AS_EVALUATE");
        if ("region".equals(kind)) return ACTION_PERMS.stream().filter(p -> !"AS_DELETE".equals(p)).toList();
        return ACTION_PERMS;
    }
    /**
     * 편집 기능: 화면은 보이지만 고치는 것은 따로 끌 수 있는 권한. CONTACT_EDIT = 문의처 안내 편집.
     * 처리 기능처럼 역할에 있는 것만 끈다 — 범위 조건(도교육청 전체 · 교육지원청은 자기 구역)은 ContactService가 그대로 본다.
     */
    public static final List<String> EDIT_PERMS = List.of("CONTACT_EDIT");
    /** 학교 사용자: 포털 메뉴 전체 + 자산·공간·재물조사 (자기 학교 범위). */
    public static final List<String> SCHOOL_USER_PERMS = concat(PORTAL_ALL,
            List.of("AS_EVALUATE", "AS_CANCEL", "SPACE_MANAGE", "INVENTORY", "ASSET_BULK", "ASSET_READ", "ASSET_WRITE", "FLOOR_READ", "FLOOR_WRITE"));
    /** AS 기사: 동료 전달 권한표 기준. 신청·조회 메뉴는 소속 업체의 담당 유형에 따라 추가됨. */
    public static final List<String> AS_ENGINEER_PERMS = concat(List.of(
            "PORTAL_INTRO", "BOARD_QNA", "BOARD_CONSULT", "PORTAL_CONTACT", "AS_C_VIEW", "BOARD_DISPOSAL", "BOARD_VENDOR", "AS_PROCESS"), PROCESS_ACTION_PERMS);
    public static final List<String> VENDOR_ADMIN_PERMS = concat(AS_ENGINEER_PERMS, List.of("AS_MANAGE", "AS_STATS"));
    public static final List<String> EDU_ADMIN_PERMS = concat(PORTAL_ALL, concat(PORTAL_ADMIN, concat(ACTION_PERMS,
            List.of("AS_EVALUATE", "USER_READ", "USER_WRITE", "ROLE_GRANT", "STATS_READ", "STATS_EXPORT", "ORG_READ", "CONTACT_EDIT"))));
    // 업체 배정(AS_ASSIGN)은 ACTION_PERMS에 있어 교육청 관리자는 위에서 받는다. 교육지원청은 아래에서.
    /**
     * 교육지원청 담당자(정보지원팀): 관할 교육지원청(AppUser.regionId) 관내 학교만 — 범위는 Scope / SchoolService.scopeSchoolIds가 정한다.
     * 업체 관리는 관할 지역만 맡는 업체만, 사용자 관리는 그 업체의 기사 · 업체 관리자 계정만 고친다. 공지 편집 · 역할 부여 · AS 삭제는 도교육청 몫이라 빠져 있다.
     */
    public static final List<String> REGION_ADMIN_PERMS = concat(PORTAL_ALL, List.of(
            "AS_MANAGE", "AS_CANCEL", "AS_ASSIGN", "SCHOOL_MANAGE", "VENDOR_MANAGE", "WDEVICE_MANAGE", "SDEVICE_MANAGE", "SCHOOL_ASSET_MANAGE",
            "SPACE_MANAGE", "INVENTORY", "ASSET_BULK", "ASSET_READ", "ASSET_WRITE", "FLOOR_READ", "FLOOR_WRITE", "CONTACT_EDIT",
            // 교육지원청도 AS를 신청하므로 자기 신청 건의 만족도를 평가한다
            "AS_EVALUATE",
            // 사용자 관리: 관할 지역만 맡는 업체의 기사 · 업체 관리자 계정만 (UserService.districtManaged)
            "USER_READ", "USER_WRITE"));

    /** 사용자별로 보이기·숨기기를 조정할 수 있는 메뉴 권한 (client/src/lib/menu.ts의 perm과 같다). */
    public static final List<String> MENU_PERMS = concat(PORTAL_ALL, List.of(
            "AS_MANAGE", "WDEVICE_MANAGE", "SDEVICE_MANAGE", "SPACE_MANAGE", "ASSET_READ", "FLOOR_READ", "INVENTORY", "SCHOOL_MANAGE", "VENDOR_MANAGE", "AS_STATS"));
    /**
     * AS 서비스(접수 유형)별 메뉴 권한. 교육청이 쓰지 않는 서비스의 권한은 그 교육청 사용자 전원에게서 빠진다
     * (PermissionService) — 메뉴·화면·API가 함께 닫힌다.
     */
    public static final Map<String, List<String>> AS_TYPE_PERMS = Map.of(
            "C", List.of("AS_C_REQUEST", "AS_C_VIEW", "BOARD_DISPOSAL", "BOARD_VENDOR"),
            "M", List.of("AS_M_REQUEST", "AS_M_VIEW", "WDEVICE_MANAGE"),
            "S", List.of("AS_S_REQUEST", "AS_S_VIEW", "BOARD_SLA", "SDEVICE_MANAGE"),
            "T", List.of("SMART_REQUEST"));

    /**
     * 메뉴 안의 기능 권한. 메뉴(parent)가 있으면 따라 켜지고, 역할 권한 관리 · 사용자 메뉴 권한에서 끄기만 한다
     * (메뉴 없이 켤 수 없어 범위가 넓어지지 않는다). 서버는 각 동작에서 이 코드를 검사한다.
     */
    public record Feature(String code, String parent, String label) {}
    public static final List<Feature> FEATURES = List.of(
            new Feature("WDEVICE_CREATE", "WDEVICE_MANAGE", "무선장비 등록"),
            new Feature("WDEVICE_EDIT", "WDEVICE_MANAGE", "무선장비 수정"),
            new Feature("WDEVICE_DELETE", "WDEVICE_MANAGE", "무선장비 삭제"),
            new Feature("WDEVICE_PLACE", "WDEVICE_MANAGE", "도면에 놓기 · 옮기기"),
            new Feature("WDEVICE_LABEL", "WDEVICE_MANAGE", "무선장비 라벨 출력"),
            new Feature("SDEVICE_CREATE", "SDEVICE_MANAGE", "스쿨넷장비 등록"),
            new Feature("SDEVICE_EDIT", "SDEVICE_MANAGE", "스쿨넷장비 수정"),
            new Feature("SDEVICE_DELETE", "SDEVICE_MANAGE", "스쿨넷장비 삭제"),
            new Feature("SDEVICE_LABEL", "SDEVICE_MANAGE", "스쿨넷장비 라벨 출력"),
            new Feature("SPACE_BUILDING_CREATE", "SPACE_MANAGE", "건물 추가"),
            new Feature("SPACE_BUILDING_DELETE", "SPACE_MANAGE", "건물 삭제"),
            new Feature("SPACE_FLOOR_CREATE", "SPACE_MANAGE", "층 추가"),
            new Feature("SPACE_FLOOR_DELETE", "SPACE_MANAGE", "층 삭제"),
            new Feature("SCHOOL_CREATE", "SCHOOL_MANAGE", "학교 등록"),
            new Feature("SCHOOL_EDIT", "SCHOOL_MANAGE", "학교 정보 수정"),
            new Feature("SCHOOL_VENDOR", "SCHOOL_MANAGE", "담당업체 지정"),
            new Feature("SCHOOL_DELETE", "SCHOOL_MANAGE", "학교 삭제"),
            new Feature("VENDOR_CREATE", "VENDOR_MANAGE", "업체 등록"),
            new Feature("VENDOR_EDIT", "VENDOR_MANAGE", "업체 수정"),
            new Feature("VENDOR_DELETE", "VENDOR_MANAGE", "업체 삭제"),
            new Feature("AS_EXCEL", "AS_MANAGE", "엑셀 다운로드"),
            new Feature("USER_CREATE", "USER_WRITE", "사용자 등록"),
            new Feature("USER_BULK", "USER_WRITE", "사용자 일괄 등록"),
            new Feature("USER_EDIT", "USER_WRITE", "사용자 수정 (역할 · 소속 · 비밀번호)"),
            new Feature("USER_DELETE", "USER_WRITE", "사용자 삭제"),
            new Feature("USER_UNLOCK", "USER_WRITE", "잠금 해제 · OTP 초기화"));
    public static final java.util.Set<String> FEATURE_CODES = java.util.Set.copyOf(FEATURES.stream().map(Feature::code).toList());

    public static boolean isFeature(String perm) { return FEATURE_CODES.contains(perm); }

    /** 사용자별 조정 대상 전체: 메뉴 권한 + AS 처리 기능 + 편집 기능 + 기능 권한. */
    public static final List<String> ADJUSTABLE_PERMS = concat(MENU_PERMS, concat(ACTION_PERMS, concat(EDIT_PERMS, FEATURES.stream().map(Feature::code).toList())));

    /** 역할 권한 관리 화면에서 교육청별로 조정하는 역할 (화면의 열 순서). 조정 범위는 ADJUSTABLE_PERMS. */
    public static final List<String> MANAGED_ROLES = List.of("SCHOOL_USER", "AS_ENGINEER", "VENDOR_ADMIN", "EDU_ADMIN", "REGION_ADMIN", "SYS_ADMIN");
    /** 업체 역할(AS 기사 · 업체 관리자)이 소속 업체의 담당 유형에 따라 받는 신청 · 조회 권한 (PermissionService.basePerms). */
    public static final List<String> VENDOR_TYPED_PERMS = List.of(
            "SMART_REQUEST", "AS_C_REQUEST", "AS_C_VIEW", "AS_M_REQUEST", "AS_M_VIEW", "AS_S_REQUEST", "AS_S_VIEW");

    /**
     * 소속 종류(AFFILIATION 값)별로 절대 줄 수 없는 권한. 역할 권한 관리 · 사용자 메뉴 권한에서 켤 수 없고,
     * 예전에 켜 둔 조정이 남아 있어도 PermissionService가 뺀다. AS통계관리는 도교육청 · 업체만.
     */
    public static final Map<String, List<String>> BLOCKED_BY_AFFILIATION = Map.of(
            "school", List.of("AS_STATS"), "region", List.of("AS_STATS"));
    public static final Map<String, String> PERM_LABEL = Map.of("AS_STATS", "AS통계관리");

    /** 이 역할(학교 담당자 · 교육지원청 담당자 등)에게 줄 수 없는 권한. */
    public static List<String> blockedFor(String role) {
        String kind = AFFILIATION.get(role);
        return kind == null ? List.of() : BLOCKED_BY_AFFILIATION.getOrDefault(kind, List.of());
    }

    public static boolean vendorRole(String role) {
        return "AS_ENGINEER".equals(role) || "VENDOR_ADMIN".equals(role);
    }

    private static List<String> concat(List<String> a, List<String> b) {
        java.util.ArrayList<String> l = new java.util.ArrayList<>(a);
        for (String s : b) if (!l.contains(s)) l.add(s);
        return List.copyOf(l);
    }

    public static final Map<String, List<String>> ROLE_PERMS = Map.ofEntries(
            Map.entry("REQUESTER", List.of("SERVICE_REQUEST", "SERVICE_READ", "SATIS_WRITE", "ASSET_READ", "FLOOR_READ")),
            Map.entry("RECEIVER", List.of("SERVICE_READ", "SERVICE_RECEIVE", "SERVICE_CLOSE", "ASSET_READ", "FLOOR_READ", "STATS_READ", "USER_READ")),
            Map.entry("PROCESSOR", List.of("SERVICE_READ", "SERVICE_PROCESS", "ASSET_READ", "ASSET_WRITE", "FLOOR_READ", "FLOOR_WRITE")),
            Map.entry("SYS_ADMIN", List.of("SERVICE_REQUEST", "SERVICE_READ", "SERVICE_RECEIVE", "SERVICE_PROCESS", "SERVICE_CLOSE", "SATIS_WRITE",
                    "ASSET_READ", "ASSET_WRITE", "ASSET_DELETE", "FLOOR_READ", "FLOOR_WRITE", "STATS_READ", "STATS_EXPORT",
                    "USER_READ", "USER_WRITE", "ROLE_GRANT", "ORG_READ",
                    "PORTAL_INTRO", "BOARD_NOTICE", "BOARD_QNA", "BOARD_CONSULT", "PORTAL_CONTACT", "SMART_REQUEST",
                    "AS_C_REQUEST", "AS_C_VIEW", "BOARD_DISPOSAL", "BOARD_VENDOR", "AS_M_REQUEST", "AS_M_VIEW",
                    "AS_S_REQUEST", "AS_S_VIEW", "BOARD_SLA", "AS_MANAGE", "WDEVICE_MANAGE", "SDEVICE_MANAGE", "SCHOOL_ASSET_MANAGE",
                    "SCHOOL_MANAGE", "VENDOR_MANAGE", "AS_STATS", "BOARD_ADMIN", "AS_PROCESS", "AS_EVALUATE",
                    "SPACE_MANAGE", "INVENTORY", "ASSET_BULK", "AS_RECEIVE", "AS_VISIT", "AS_REPORT", "AS_RETURN", "AS_TRANSFER", "AS_CANCEL", "AS_DELETE", "AS_ASSIGN", "REGION_MANAGE", "COST_MANAGE", "CONTACT_EDIT")),
            Map.entry("SUPER_ADMIN", List.of("ORG_READ", "ORG_WRITE")),
            Map.entry("SCHOOL_USER", SCHOOL_USER_PERMS),
            Map.entry("AS_ENGINEER", AS_ENGINEER_PERMS),
            Map.entry("VENDOR_ADMIN", VENDOR_ADMIN_PERMS),
            Map.entry("EDU_ADMIN", EDU_ADMIN_PERMS),
            Map.entry("REGION_ADMIN", REGION_ADMIN_PERMS));

    /**
     * 원클릭 AS 소속 역할이 요구하는 소속 칸. 한 계정은 한 종류의 소속(학교·업체·교육지원청)만 가진다.
     * 값: "school" = AppUser.schoolId, "vendor" = vendorId, "region" = regionId.
     */
    public static final Map<String, String> AFFILIATION = Map.of(
            "SCHOOL_USER", "school", "AS_ENGINEER", "vendor", "VENDOR_ADMIN", "vendor", "REGION_ADMIN", "region");
    /** 기존 자산관리 모듈 역할. 원클릭 AS 소속 역할과 함께 주면 학교·업체 범위 밖 자산까지 열리므로 함께 줄 수 없다. */
    public static final List<String> LEGACY = List.of("REQUESTER", "RECEIVER", "PROCESSOR");

    /** Fixed role order used when listing a user's roles. */
    public static final List<String> ORDER = List.of("REQUESTER", "RECEIVER", "PROCESSOR", "SYS_ADMIN", "SUPER_ADMIN",
            "SCHOOL_USER", "AS_ENGINEER", "VENDOR_ADMIN", "EDU_ADMIN", "REGION_ADMIN");

    public static Set<String> permsOf(Collection<String> roles) {
        Set<String> perms = new LinkedHashSet<>();
        for (String r : roles) perms.addAll(ROLE_PERMS.getOrDefault(r, List.of()));
        return perms;
    }
}
