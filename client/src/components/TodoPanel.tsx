"use client";

import Link from "next/link";
import { AS_LIST_HREF, AS_NAME } from "@/lib/as";
import { useAuth } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import type { Todo, TodoBucket, TodoRow } from "@/lib/types";
import { HoldBadge } from "./ui";

/** 카드 위 띠 색 */
const TONE: Record<string, string> = { "low-score": "red", evaluate: "amber", hold: "violet" };
const ROWS = 4;
/** 재요청할 수 있는 기간: 처리완료 뒤 30일 (서버 AsRequestService.REOPEN_DAYS) */
const REOPEN_DAYS = 30;

/** "3분" · "5시간" · "2일 3시간" */
function span(min: number) {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m}분`;
  if (m < 1440) return `${Math.floor(m / 60)}시간`;
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return h && d < 7 ? `${d}일 ${h}시간` : `${d}일`;
}
const minsSince = (iso?: string) => (iso ? (Date.now() - new Date(iso).getTime()) / 60000 : null);

/** 오른쪽 칸: 얼마나 기다렸는지 (정확한 시각은 마우스를 올리면). */
function When({ b, r }: { b: TodoBucket; r: TodoRow }) {
  if (b.key === "low-score") return <span className="td-when bad">{r.evalScore}점</span>;
  if (b.key === "visit-soon") return <span className="td-when">{fmtDateTime(r.visitPlannedAt)}</span>;
  // 평가 대기: 신청이 아니라 처리완료부터 — 얼마 전에 끝났는지와 재요청(처리완료 뒤 30일)까지 남은 날
  if (b.key === "evaluate" && r.completedAt) {
    const m = minsSince(r.completedAt) ?? 0;
    const end = new Date(new Date(r.completedAt).getTime() + REOPEN_DAYS * 86400000);
    const left = Math.ceil((end.getTime() - Date.now()) / 86400000);
    return (
      <span className="td-when" title={`처리완료 ${fmtDateTime(r.completedAt)} · 재요청은 ${end.getFullYear()}.${String(end.getMonth() + 1).padStart(2, "0")}.${String(end.getDate()).padStart(2, "0")}.까지`}>
        처리 후 {m < 1440 ? "오늘" : `${Math.floor(m / 1440)}일`}
        {left > 0 && <small className={left <= 7 ? "soon" : ""}>재요청 {left}일 남음</small>}
      </span>
    );
  }
  const m = minsSince(r.requestAt);
  return <span className="td-when" title={`신청 ${fmtDateTime(r.requestAt)}`}>{m == null ? "-" : `${span(m)} 경과`}</span>;
}

/**
 * 홈의 '내 할 일' (GET /api/as/requests/todo — 홈에서 한 번 불러 넘겨준다).
 * 묶음마다 오래된 순 4건, 누르면 그 건의 상세가 열리고, 아래 링크로 마이페이지의 묶음 전체를 본다.
 */
export default function TodoPanel({ todo }: { todo: Todo | null }) {
  const { can } = useAuth();
  if (!todo || !todo.buckets.length) return null;
  // 장애접수관리를 가진 계정은 전체 목록에서, 아니면 그 유형의 결과조회에서 연다.
  const href = (r: TodoRow) => `${can("AS_MANAGE") ? "/admin/requests" : AS_LIST_HREF[r.rceptTy]}?open=${r.asvcSn}`;
  // 할 일이 있는 묶음만 보여 준다 (비어 있는 묶음의 "○○ 없음"은 표시하지 않는다).
  const busy = todo.buckets.filter((b) => b.count > 0);

  return (
    <section className="td-wrap" aria-labelledby="td-t">
      <div className="td-head">
        <h2 id="td-t" className="hm-h">내 할 일 {todo.total > 0 && <span className="td-total">{todo.total.toLocaleString()}</span>}</h2>
        {todo.dutyTypes.length > 0 && <small className="hint">담당 유형: {todo.dutyTypes.map((t) => AS_NAME[t]).join(", ")}</small>}
      </div>
      {busy.length === 0 ? (
        <p className="td-clear"><span aria-hidden="true">✓</span> 지금 처리할 일이 없습니다.</p>
      ) : (
        <div className="td-grid">
          {busy.map((b) => (
            <article key={b.key} className={"td-card tone-" + (TONE[b.key] ?? "blue")} aria-label={`${b.label} ${b.count}건`}>
              <header>
                <h3>{b.label}</h3>
                <b className="td-n">{b.count.toLocaleString()}</b>
              </header>
              <p className="td-hint">{b.hint}</p>
              <ul>
                {b.rows.slice(0, ROWS).map((r) => {
                  return (
                    <li key={r.asvcSn}>
                      <Link href={href(r)}>
                        <span className="td-ty">{r.rceptTyName}</span>
                        <span className="td-main">
                          <span className="td-line">
                            <b>{r.schoolName ?? "-"}</b>
                            <HoldBadge row={r} />
                          </span>
                          <small>{r.symptom}</small>
                        </span>
                        <When b={b} r={r} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <Link className="td-all" href={`/mypage?tab=todo&key=${b.key}`}>
                {b.count > ROWS ? `전체 ${b.count.toLocaleString()}건 보기` : "마이페이지에서 처리"} <span aria-hidden="true">→</span>
              </Link>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
