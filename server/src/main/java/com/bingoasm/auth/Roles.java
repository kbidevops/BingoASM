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
            "AS_MANAGE", "WDEVICE_MANAGE", "SCHOOL_ASSET_MANAGE", "SCHOOL_MANAGE", "VENDOR_MANAGE", "AS_STATS",
            "BOARD_ADMIN", "AS_PROCESS", "SPACE_MANAGE", "INVENTORY", "ASSET_BULK", "ASSET_READ", "ASSET_WRITE", "FLOOR_READ", "FLOOR_WRITE");
    /**
     * AS 처리 기능: 접수 · 반려(반려 취소 포함) · 이관 · 신청 취소 · 삭제. 역할마다 지금 할 수 있는 것을 기본으로 주고,
     * 사용자별로 끌 수 있다. 상태·소속 조건(AsRequestService.allowedActions)은 그대로라 켠다고 범위가 넓어지지 않는다.
     */
    public static final List<String> PROCESS_ACTION_PERMS = List.of("AS_RECEIVE", "AS_RETURN", "AS_TRANSFER");
    public static final List<String> ACTION_PERMS = List.of("AS_RECEIVE", "AS_RETURN", "AS_TRANSFER", "AS_CANCEL", "AS_DELETE");
    /** 학교 사용자: 포털 메뉴 전체 + 자산·공간·재물조사 (자기 학교 범위). */
    public static final List<String> SCHOOL_USER_PERMS = concat(PORTAL_ALL,
            List.of("AS_EVALUATE", "AS_CANCEL", "SPACE_MANAGE", "INVENTORY", "ASSET_BULK", "ASSET_READ", "ASSET_WRITE", "FLOOR_READ", "FLOOR_WRITE"));
    /** AS 기사: 동료 전달 권한표 기준. 신청·조회 메뉴는 소속 업체의 담당 유형에 따라 추가됨. */
    public static final List<String> AS_ENGINEER_PERMS = concat(List.of(
            "PORTAL_INTRO", "BOARD_QNA", "BOARD_CONSULT", "PORTAL_CONTACT", "AS_C_VIEW", "BOARD_DISPOSAL", "BOARD_VENDOR", "AS_PROCESS"), PROCESS_ACTION_PERMS);
    public static final List<String> VENDOR_ADMIN_PERMS = concat(AS_ENGINEER_PERMS, List.of("AS_MANAGE", "AS_STATS"));
    public static final List<String> EDU_ADMIN_PERMS = concat(PORTAL_ALL, concat(PORTAL_ADMIN, concat(ACTION_PERMS,
            List.of("AS_EVALUATE", "USER_READ", "USER_WRITE", "ROLE_GRANT", "STATS_READ", "STATS_EXPORT", "ORG_READ"))));
    /**
     * 교육지원청 담당자(정보지원팀): 관할 교육지원청(AppUser.regionId) 관내 학교만 — 범위는 Scope / SchoolService.scopeSchoolIds가 정한다.
     * 업체 관리·공지/문의처 편집·사용자 관리·AS 삭제는 도교육청 몫이라 빠져 있다.
     */
    public static final List<String> REGION_ADMIN_PERMS = concat(PORTAL_ALL, List.of(
            "AS_MANAGE", "AS_STATS", "AS_CANCEL", "SCHOOL_MANAGE", "WDEVICE_MANAGE", "SCHOOL_ASSET_MANAGE",
            "SPACE_MANAGE", "INVENTORY", "ASSET_BULK", "ASSET_READ", "ASSET_WRITE", "FLOOR_READ", "FLOOR_WRITE"));

    /** 사용자별로 보이기·숨기기를 조정할 수 있는 메뉴 권한 (client/src/lib/menu.ts의 perm과 같다). */
    public static final List<String> MENU_PERMS = concat(PORTAL_ALL, List.of(
            "AS_MANAGE", "WDEVICE_MANAGE", "SPACE_MANAGE", "ASSET_READ", "FLOOR_READ", "INVENTORY", "SCHOOL_MANAGE", "VENDOR_MANAGE", "AS_STATS"));
    /**
     * AS 서비스(접수 유형)별 메뉴 권한. 교육청이 쓰지 않는 서비스의 권한은 그 교육청 사용자 전원에게서 빠진다
     * (PermissionService) — 메뉴·화면·API가 함께 닫힌다.
     */
    public static final Map<String, List<String>> AS_TYPE_PERMS = Map.of(
            "C", List.of("AS_C_REQUEST", "AS_C_VIEW", "BOARD_DISPOSAL", "BOARD_VENDOR"),
            "M", List.of("AS_M_REQUEST", "AS_M_VIEW", "WDEVICE_MANAGE"),
            "S", List.of("AS_S_REQUEST", "AS_S_VIEW", "BOARD_SLA"),
            "T", List.of("SMART_REQUEST"));

    /** 사용자별 조정 대상 전체: 메뉴 권한 + AS 처리 기능. */
    public static final List<String> ADJUSTABLE_PERMS = concat(MENU_PERMS, ACTION_PERMS);

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
                    "AS_S_REQUEST", "AS_S_VIEW", "BOARD_SLA", "AS_MANAGE", "WDEVICE_MANAGE", "SCHOOL_ASSET_MANAGE",
                    "SCHOOL_MANAGE", "VENDOR_MANAGE", "AS_STATS", "BOARD_ADMIN", "AS_PROCESS", "AS_EVALUATE",
                    "SPACE_MANAGE", "INVENTORY", "ASSET_BULK", "AS_RECEIVE", "AS_RETURN", "AS_TRANSFER", "AS_CANCEL", "AS_DELETE")),
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
