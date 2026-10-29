"use client";

import { api } from "./api";
import type { AsCodes, RceptTy } from "./types";

// AS types: C 정보기기 · M 무선망 · S 스쿨넷 · T 스마트기기 (rceptTy on the server).

export const AS_NAME: Record<RceptTy, string> = { C: "정보기기", M: "무선망", S: "스쿨넷", T: "스마트기기" };
/** Types offered in selects, tiles and charts. 정보기기(C)·스마트기기(T) are hidden for now — add them back here to restore them everywhere. */
export const ACTIVE_TYPES: RceptTy[] = ["M", "S"];

export const AS_REQUEST_HREF: Record<RceptTy, string> = { C: "/as/info", M: "/as/wireless", S: "/as/schoolnet", T: "/smart" };
export const AS_LIST_HREF: Record<RceptTy, string> = { C: "/as/info/list", M: "/as/wireless/list", S: "/as/schoolnet/list", T: "/smart/list" };

export const AS_REQUEST_PERM: Record<RceptTy, string> = { C: "AS_C_REQUEST", M: "AS_M_REQUEST", S: "AS_S_REQUEST", T: "SMART_REQUEST" };
export const AS_VIEW_PERM: Record<RceptTy, string> = { C: "AS_C_VIEW", M: "AS_M_VIEW", S: "AS_S_VIEW", T: "SMART_REQUEST" };

/** What each processing action is called on the screen. */
export const ACTION_LABEL: Record<string, string> = {
  receive: "접수",
  return: "반려",
  "return-cancel": "반려 취소",
  transfer: "이관",
  cancel: "신청 취소",
  visit: "방문일 변경",
  report: "처리 보고서",
  evaluate: "만족도 평가",
  delete: "삭제",
};

let codesCache: Promise<AsCodes> | null = null;

/** Code tables rarely change; fetch once per page load. */
export function loadCodes(): Promise<AsCodes> {
  codesCache ??= api.get<AsCodes>("/api/as/requests/codes").catch((e) => {
    codesCache = null;
    throw e;
  });
  return codesCache;
}
