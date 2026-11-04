"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Page } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ago, noticeHref, noticeTone, type AppNotice } from "@/lib/notifications";
import { Icon } from "./ui";

/** How often the unread count is refreshed while the tab is visible. */
const POLL_MS = 60_000;
const PANEL_SIZE = 8;

/**
 * 머리글의 종: 안 읽은 알림 수와 최근 알림. 알림은 서버가 AS 처리 단계마다 관계자에게 남긴다 (NotificationService).
 * 외부 푸시 없이 이 사이트 안에서만 보이므로, 사이트를 열어 둔 동안 1분마다 건수를 다시 읽는다.
 */
export default function NotificationBell() {
  const { status, can } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<AppNotice[] | null>(null);
  const [err, setErr] = useState("");
  const box = useRef<HTMLSpanElement>(null);
  // Phones: the panel is fixed to the screen edges, just under the bell (the header height varies).
  const [top, setTop] = useState<number | null>(null);

  const refreshCount = useCallback(() => {
    if (status !== "authed") return;
    api.get<{ count: number }>("/api/notifications/unread-count").then((d) => setCount(d.count)).catch(() => {});
  }, [status]);

  // On sign-in, on every page change, every minute while visible, and when the tab regains focus.
  useEffect(refreshCount, [refreshCount, pathname]);
  useEffect(() => {
    if (status !== "authed") return;
    const t = setInterval(() => { if (document.visibilityState === "visible") refreshCount(); }, POLL_MS);
    window.addEventListener("focus", refreshCount);
    return () => { clearInterval(t); window.removeEventListener("focus", refreshCount); };
  }, [status, refreshCount]);
  useEffect(() => setOpen(false), [pathname]);

  const loadList = useCallback(() => {
    setErr("");
    api.get<{ list: Page<AppNotice>; unreadCount: number }>("/api/notifications", { size: PANEL_SIZE })
      .then((d) => { setList(d.list.content); setCount(d.unreadCount); })
      .catch((e) => setErr((e as Error).message));
  }, []);
  useEffect(() => { if (open) loadList(); }, [open, loadList]);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", click);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", click); document.removeEventListener("keydown", key); };
  }, [open]);

  if (status !== "authed") return null;

  const go = (n: AppNotice) => {
    if (!n.read) {
      api.post(`/api/notifications/${n.notificationId}/read`).catch(() => {});
      setCount((c) => Math.max(0, c - 1));
    }
    setOpen(false);
    router.push(noticeHref(n, can));
  };
  const readAll = async () => {
    try {
      await api.post("/api/notifications/read-all");
      setCount(0);
      setList((l) => l?.map((n) => ({ ...n, read: true })) ?? l);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <span className="ntf-w" ref={box}>
      <button className="ic ntf-btn" type="button" aria-label={`알림${count ? ` (안 읽음 ${count}건)` : ""}`} aria-expanded={open}
        aria-haspopup="true" onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setTop(window.innerWidth <= 640 ? Math.round(r.bottom + 6) : null);
          setOpen((v) => !v);
        }}>
        <Icon name="bell" />
        {count > 0 && <b className="ntf-n" aria-hidden="true">{count > 99 ? "99+" : count}</b>}
      </button>
      {open && (
        <div className="ntf-pop" role="dialog" aria-label="알림" style={top == null ? undefined : { top }}>
          <div className="ntf-h">
            <b>알림</b>
            <button type="button" className="linkbtn" disabled={!count} onClick={readAll}>모두 읽음</button>
          </div>
          {err ? <p className="ntf-e">{err}</p> : !list ? <p className="ntf-e">불러오는 중입니다…</p> : list.length ? (
            <ul className="ntf-l">
              {list.map((n) => (
                <li key={n.notificationId}>
                  <button type="button" className={n.read ? "" : "unread"} onClick={() => go(n)}>
                    <i className={"ntf-dot " + noticeTone(n.type)} aria-hidden="true"></i>
                    <span className="ntf-t">
                      <b>{n.title}</b>
                      {n.body && <span>{n.body}</span>}
                      <small>{ago(n.createdAt)}{n.read ? "" : " · 안 읽음"}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="ntf-e">새 알림이 없습니다.</p>}
          <Link className="ntf-all" href="/notifications" onClick={() => setOpen(false)}>전체 알림 보기 ›</Link>
        </div>
      )}
    </span>
  );
}
