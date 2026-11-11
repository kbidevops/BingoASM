import { Icon, QuickIcon } from "./ui";

/**
 * 메뉴 묶음의 아이콘 · 한 줄 설명. 머리글의 전체 메뉴(메가 메뉴)와 왼쪽 사이드 메뉴가 같이 쓴다.
 * 없는 묶음은 기본 아이콘만 보인다.
 */
type GroupIcon = { i: React.ComponentProps<typeof Icon>["name"] } | { q: React.ComponentProps<typeof QuickIcon>["name"] };
export const GROUP_META: Record<string, { icon: GroupIcon; desc: string }> = {
  학교정보업무지원: { icon: { i: "notice" }, desc: "공지 · 질문 · 문의처" },
  스마트기기ALL: { icon: { q: "tab" }, desc: "스마트기기 지원" },
  "정보기기 유지관리": { icon: { q: "pc" }, desc: "PC · 주변기기 AS" },
  "네트워크 유지관리": { icon: { q: "wifi" }, desc: "무선망 · 스쿨넷 AS" },
  장비관리: { icon: { q: "box" }, desc: "장비 · 건물 · 도면" },
  기관관리: { icon: { i: "school" }, desc: "지역 · 학교 · 업체" },
  통합관리: { icon: { i: "report" }, desc: "접수 · 통계" },
  "관리자 메뉴": { icon: { i: "lock" }, desc: "사용자 · 권한 · 설정" },
};
export const groupIcon = (g?: GroupIcon) => (!g ? <QuickIcon name="list" /> : "q" in g ? <QuickIcon name={g.q} /> : <Icon name={g.i} />);
