// Site menu (same structure as cbe.go.kr 원클릭 AS). `perm` is the backend permission code that opens the
// screen; signed-in users only see what GET /api/auth/me → permissions allows. Items without perm are public.

export interface MenuItem {
  title: string;
  href: string;
  perm?: string;
  /** Shown in the side menu only (not in the GNB mega menu). */
  sideOnly?: boolean;
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
    hidden: true,
    items: [
      { title: "스마트기기지원신청", href: "/smart", perm: "SMART_REQUEST" },
      { title: "스마트기기 결과조회", href: "/smart/list", perm: "SMART_REQUEST" },
    ],
  },
  {
    title: "정보기기 유지관리",
    hidden: true,
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
    title: "통합관리",
    items: [
      { title: "장애접수관리", href: "/admin/requests", perm: "AS_MANAGE" },
      { title: "무선장비관리", href: "/admin/devices", perm: "WDEVICE_MANAGE" },
      // 학교 담당자에게는 통합관리의 첫 화면이 된다 (장애접수·무선장비 메뉴가 없으므로).
      { title: "자산 관리 홈", href: "/admin/start", perm: "SPACE_MANAGE" },
      { title: "기관자산관리", href: "/admin/assets", perm: "ASSET_READ" },
      { title: "공간(실) 관리", href: "/admin/spaces", perm: "SPACE_MANAGE" },
      { title: "자산 위치(도면)", href: "/admin/floorplan", perm: "FLOOR_READ" },
      { title: "재물조사(QR)", href: "/admin/inventory", perm: "INVENTORY" },
      { title: "기관정보관리", href: "/admin/schools", perm: "SCHOOL_MANAGE" },
      { title: "업체관리", href: "/admin/vendors", perm: "VENDOR_MANAGE" },
      { title: "AS통계관리", href: "/admin/stats", perm: "AS_STATS" },
      { title: "사용자 메뉴 권한", href: "/admin/user-menus", perm: "ROLE_GRANT" },
    ],
  },
];

/** Pages outside the menu that still need a title and breadcrumb. */
const EXTRA: Record<string, string> = { "/mypage": "마이페이지", "/login": "통합 로그인", "/sitemap": "누리집 지도" };

export function findMenu(pathname: string): { group?: MenuGroup; item?: MenuItem; title: string } {
  const path = pathname.replace(/\/$/, "") || "/";
  for (const group of MENU) {
    const item = group.items.find((i) => i.href === path);
    if (item) return { group, item, title: item.title };
  }
  // /boards/view and /boards/write belong to the board named in ?code=; callers pass that path instead.
  return { title: EXTRA[path] ?? "" };
}

/** Filters the menu by permission. Signed out → full menu (pages then ask to sign in). */
export function visibleMenu(perms: Set<string> | null): MenuGroup[] {
  const shown = MENU.filter((g) => !g.hidden);
  if (!perms) return shown;
  return shown.map((g) => ({ ...g, items: g.items.filter((i) => !i.perm || perms.has(i.perm)) })).filter((g) => g.items.length > 0);
}
