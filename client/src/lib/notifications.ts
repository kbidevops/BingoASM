import { AS_LIST_HREF, AS_VIEW_PERM } from "./as";
import { fmtDateTime } from "./format";
import type { RceptTy } from "./types";

/** One in-app notification (GET /api/notifications). */
export interface AppNotice {
  notificationId: number;
  type: string;
  title: string;
  body?: string;
  asvcSn?: number;
  rceptTy?: RceptTy;
  read: boolean;
  createdAt: string;
}

/** Colour group of a notification type, for the dot in the list. */
export function noticeTone(type: string): "new" | "done" | "warn" | "info" {
  if (type === "AS_NEW" || type === "AS_ASSIGNED") return "new";
  if (type === "AS_DONE" || type === "AS_EVALUATED") return "done";
  if (type === "AS_RETURNED" || type === "AS_CANCELED") return "warn";
  return "info";
}

/**
 * Where a notification leads: the AS request's detail, opened from the list the user can see
 * (장애접수관리 for managers, the type's 결과조회 otherwise).
 */
export function noticeHref(n: AppNotice, can: (perm?: string) => boolean): string {
  if (!n.asvcSn || !n.rceptTy) return "/notifications";
  if (can("AS_MANAGE")) return `/admin/requests?open=${n.asvcSn}`;
  if (can(AS_VIEW_PERM[n.rceptTy])) return `${AS_LIST_HREF[n.rceptTy]}?open=${n.asvcSn}`;
  return "/notifications";
}

/** "방금", "5분 전", "3시간 전", then the date. */
export function ago(iso: string): string {
  const t = new Date(iso).getTime();
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}일 전`;
  return fmtDateTime(iso);
}
