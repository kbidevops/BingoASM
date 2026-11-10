// Site menu (same structure as cbe.go.kr 원클릭 AS). `perm` is the backend permission code that opens the
// screen; signed-in users only see what GET /api/auth/me → permissions allows. Items without perm are public.

export interface MenuItem {
  title: string;
  href: string;
  perm?: string;
  /** Shown in the side menu only (not in the GNB mega menu). */
  sideOnly?: boolean;
  /** Small heading above this item in the side menu (items of one section sit together). */
  section?: string;
}

export interface MenuGroup {
  title: string;
  items: MenuItem[];
  /** Left out of the GNB, side menu and sitemap (pages still open by URL). */
  hidden?: boolean;
}

export const MENU: MenuGroup[] = [
  {
    title: "학교정보업무지원",
    items: [
      { title: "시스템소개", href: "/intro" },
      { title: "공지 및 자료실", href: "/boards/notice", perm: "BOARD_NOTICE" },
      { title: "질문 및 건의하기", href: "/boards/qna", perm: "BOARD_QNA" },
      { title: "컨설팅 신청", href: "/boards/consult", perm: "BOARD_CONSULT" },
      { title: "문의처 안내", href: "/contact", perm: "PORTAL_CONTACT" },
    ],
  },
  {
    title: "스마트기기ALL",
    items: [
      { title: "스마트기기지원신청", href: "/smart", perm: "SMART_REQUEST" },
      { title: "스마트기기 결과조회", href: "/smart/list", perm: "SMART_REQUEST" },
    ],
  },
  {
    title: "정보기기 유지관리",
    items: [
      { title: "정보기기 AS신청", href: "/as/info", perm: "AS_C_REQUEST" },
      { title: "정보기기 AS결과조회", href: "/as/info/list", perm: "AS_C_VIEW" },
      { title: "불용PC수거신청", href: "/boards/disposal", perm: "BOARD_DISPOSAL" },
      { title: "유지관리업체(정보공유)", href: "/boards/vendor", perm: "BOARD_VENDOR" },
    ],
  },
  {
    title: "네트워크 유지관리",
    items: [
      { title: "무선망 AS신청", href: "/as/wireless", perm: "AS_M_REQUEST" },
      { title: "무선망 AS결과조회", href: "/as/wireless/list", perm: "AS_M_VIEW" },
      { title: "스쿨넷 AS신청", href: "/as/schoolnet", perm: "AS_S_REQUEST" },
      { title: "스쿨넷 AS결과조회", href: "/as/schoolnet/list", perm: "AS_S_VIEW" },
      { title: "스쿨넷 SLA 공유", href: "/boards/sla", perm: "BOARD_SLA", sideOnly: true },
    ],
  },
  {
    // 장비 목록(무엇이 있나) → 위치(어디 있나). 건물·층은 도면이 쓰는 기준이라 도면 앞에 둔다.
    title: "장비관리",
    items: [
      { title: "무선장비관리", href: "/admin/devices", perm: "WDEVICE_MANAGE", section: "장비 목록" },
      { title: "스쿨넷장비관리", href: "/admin/schoolnet-devices", perm: "SDEVICE_MANAGE", section: "장비 목록" },
      { title: "건물·층 관리", href: "/admin/spaces", perm: "SPACE_MANAGE", section: "위치" },
      { title: "무선장비 위치(도면)", href: "/admin/floorplan", perm: "WDEVICE_MANAGE", section: "위치" },
    ],
  },
  {
    title: "기관관리",
    items: [
      { title: "지역 관리", href: "/admin/regions", perm: "REGION_MANAGE" },
      { title: "학교 관리", href: "/admin/schools", perm: "SCHOOL_MANAGE" },
      { title: "업체 관리", href: "/admin/vendors", perm: "VENDOR_MANAGE" },
    ],
  },
  {
    title: "통합관리",
    items: [
      { title: "장애접수관리", href: "/admin/requests", perm: "AS_MANAGE" },
      { title: "AS통계관리", href: "/admin/stats", perm: "AS_STATS" },
    ],
  },
  {
    title: "관리자 메뉴",
    items: [
      { title: "사용자 관리", href: "/admin/users", perm: "USER_WRITE" },
      { title: "역할 권한 관리", href: "/admin/roles", perm: "ORG_WRITE" },
      { title: "사용자 메뉴 권한", href: "/admin/user-menus", perm: "ROLE_GRANT" },
      { title: "AS 서비스 설정", href: "/admin/services", perm: "ORG_WRITE" },
    ],
  },
];

/** Pages outside the menu that still need a title and breadcrumb. */
const EXTRA: Record<string, string> = { "/mypage": "마이페이지", "/login": "통합 로그인", "/sitemap": "누리집 지도", "/notifications": "알림",
  // 메뉴에는 없지만 자산 라벨 QR(/a/{번호})이 여는 화면.
  "/admin/assets": "기관자산관리",
  // 장비 라벨 QR(/d/{id})이 여는 화면.
  "/device": "장비 정보" };

export function findMenu(pathname: string): { group?: MenuGroup; item?: MenuItem; title: string } {
  const path = pathname.replace(/\/$/, "") || "/";
  for (const group of MENU) {
    const item = group.items.find((i) => i.href === path);
    if (item) return { group, item, title: item.title };
  }
  // /boards/view and /boards/write belong to the board named in ?code=; callers pass that path instead.
  return { title: EXTRA[path] ?? "" };
}

/**
 * Filters the menu by permission. Signed out → full menu (pages then ask to sign in) minus `off`, the menus of
 * AS services the 교육청 does not use; signed in, those are already missing from `perms`.
 */
export function visibleMenu(perms: Set<string> | null, off: Set<string> = new Set()): MenuGroup[] {
  const allowed = (i: MenuItem) => !i.perm || (perms ? perms.has(i.perm) : !off.has(i.perm));
  return MENU.filter((g) => !g.hidden)
    .map((g) => ({ ...g, items: g.items.filter(allowed) }))
    .filter((g) => g.items.length > 0);
}

/** 편집 기능 (Roles.EDIT_PERMS). 처리 기능처럼 역할에 있는 것만 끌 수 있다. */
/** (사용자 메뉴 권한 · 역할 권한 관리 화면) */
export const EDITS: [string, string, string][] = [
  ["CONTACT_EDIT", "문의처 안내 편집", "문의처 안내의 연락처를 고칩니다. 교육지원청 담당자는 자기 교육지원청 구역만 고칠 수 있습니다."],
];
