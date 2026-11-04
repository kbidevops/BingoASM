"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import SubPage from "@/components/SubPage";
import { ErrorBox, Loading, Pager, useToast } from "@/components/ui";
import { api, type Page } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { ago, noticeHref, noticeTone, type AppNotice } from "@/lib/notifications";

/** 내 알림 전체: 안 읽음만 보기, 모두 읽음, 누르면 해당 AS 상세로. */
export default function NotificationsPage() {
  return (
    <SubPage title="알림" auth side={false}>
      <Notifications />
    </SubPage>
  );
}

function Notifications() {
  const toast = useToast();
  const router = useRouter();
  const { can } = useAuth();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ list: Page<AppNotice>; unreadCount: number } | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    setErr("");
    api.get<{ list: Page<AppNotice>; unreadCount: number }>("/api/notifications", { unread: unreadOnly || undefined, page, size: 20 })
      .then(setData).catch((e) => setErr((e as Error).message));
  }, [unreadOnly, page]);
  useEffect(load, [load]);

  const open = (n: AppNotice) => {
    if (!n.read) api.post(`/api/notifications/${n.notificationId}/read`).catch(() => {});
    router.push(noticeHref(n, can));
  };
  const readAll = async () => {
    try {
      const r = await api.post<{ count: number }>("/api/notifications/read-all");
      toast(r.count ? `알림 ${r.count}건을 읽음으로 표시했습니다.` : "안 읽은 알림이 없습니다.");
      load();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <>
      <div className="ntf-bar">
        <div className="tabs" role="tablist" aria-label="알림 구분">
          {([[false, "전체"], [true, `안 읽음${data ? ` ${data.unreadCount}` : ""}`]] as const).map(([v, l]) => (
            <button key={String(v)} type="button" role="tab" aria-selected={unreadOnly === v} onClick={() => { setUnreadOnly(v); setPage(1); }}>{l}</button>
          ))}
        </div>
        <button type="button" className="btn sm sec" disabled={!data?.unreadCount} onClick={readAll}>모두 읽음</button>
      </div>
      <p className="hint" style={{ margin: "0 0 10px" }}>AS 신청·접수·처리·청구 단계가 바뀌면 관계된 분께 알림이 남습니다. 180일이 지난 알림은 자동으로 지워집니다.</p>
      {err ? <ErrorBox message={err} onRetry={load} /> : !data ? <Loading /> : (
        <>
          <ul className="ntf-l ntf-page">
            {data.list.content.length ? data.list.content.map((n) => (
              <li key={n.notificationId}>
                <button type="button" className={n.read ? "" : "unread"} onClick={() => open(n)}>
                  <i className={"ntf-dot " + noticeTone(n.type)} aria-hidden="true"></i>
                  <span className="ntf-t">
                    <b>{n.title}</b>
                    {n.body && <span>{n.body}</span>}
                    <small title={fmtDateTime(n.createdAt)}>{ago(n.createdAt)}{n.read ? "" : " · 안 읽음"}</small>
                  </span>
                </button>
              </li>
            )) : <li className="ntf-e">{unreadOnly ? "안 읽은 알림이 없습니다." : "알림이 없습니다."}</li>}
          </ul>
          <Pager page={data.list.page} totalPages={data.list.totalPages} onPage={setPage} />
        </>
      )}
    </>
  );
}
