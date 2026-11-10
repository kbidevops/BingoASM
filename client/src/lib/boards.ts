"use client";

import { api } from "./api";
import type { BoardInfo, Region } from "./types";

// Boards are addressed by a lowercase slug in URLs (/boards/qna) and an uppercase code in the API (QNA).

export const BOARD_SLUGS = [
  "notice",
  "qna",
  "consult",
  "disposal",
  "vendor",
  "sla",
] as const;
export type BoardSlug = (typeof BOARD_SLUGS)[number];

export const BOARD_PERM: Record<BoardSlug, string> = {
  notice: "BOARD_NOTICE",
  qna: "BOARD_QNA",
  consult: "BOARD_CONSULT",
  disposal: "BOARD_DISPOSAL",
  vendor: "BOARD_VENDOR",
  sla: "BOARD_SLA",
};

export const FIELDS: [string, string][] = [
  ["WIRELESS", "무선"],
  ["SCHOOLNET", "스쿨넷"],
  ["ETC", "기타"],
];
export const POST_STATUSES: [string, string][] = [
  ["WAIT", "대기"],
  ["RECEIVED", "접수"],
  ["DONE", "완료"],
];

export function toSlug(v: string | null): BoardSlug | null {
  const s = (v ?? "").toLowerCase();
  return (BOARD_SLUGS as readonly string[]).includes(s)
    ? (s as BoardSlug)
    : null;
}

export const boardHref = (slug: BoardSlug) => `/boards/${slug}`;

let boardsCache: Promise<BoardInfo[]> | null = null;
let regionsCache: Promise<Region[]> | null = null;

/** Boards this user may read, with their options (categories, field, region, status, secret). */
export function loadBoards(): Promise<BoardInfo[]> {
  boardsCache ??= api.get<BoardInfo[]>("/api/as/boards").catch((e) => {
    boardsCache = null;
    throw e;
  });
  return boardsCache;
}

export function resetBoards() {
  boardsCache = null;
}

/** After regions change, so every screen reads the new names and order. */
export function clearRegionCache() {
  regionsCache = null;
}

/** 로그인 · 로그아웃 때: 게시판(쓰기 권한)과 지역(교육지원청은 관할 지역만)은 사용자마다 다르다. */
export function clearBoardCaches() {
  boardsCache = null;
  regionsCache = null;
}

export function loadRegions(): Promise<Region[]> {
  regionsCache ??= api.get<Region[]>("/api/as/regions").catch((e) => {
    regionsCache = null;
    throw e;
  });
  return regionsCache;
}
