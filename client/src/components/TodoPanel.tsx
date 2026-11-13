"use client";

import Link from "next/link";
import { AS_LIST_HREF, AS_NAME } from "@/lib/as";
import { useAuth } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import type { Todo, TodoBucket, TodoRow } from "@/lib/types";
import { HoldBadge, LateBadge, SlaBadge } from "./ui";

/** 카드 위 띠 색 */
const TONE: Record<string, string> = { "receive-late": "red", "visit-late": "orange", "low-score": "red", evaluate: "amber", hold: "violet" };
/** 카드 제목이 이미 말해 주는 지연 표시 — 그 카드 안에서는 다시 붙이지 않는다 */
const SAME_AS_TITLE: Record<string, string[]> = { "receive-late": ["RECEIVE", "ESCALATED"], "visit-late": ["VISIT"] };
const ROWS = 4;

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
  if (b.key === "visit-late") {
    const m = minsSince(r.visitPlannedAt);
    return <span className="td-when bad" title={`방문예정 ${fmtDateTime(r.visitPlannedAt)}`}>{m == null ? "-" : `${span(m)} 지남`}</span>;
  }
  const m = minsSince(r.requestAt);
  return <span className={"td-when" + (b.key === "receive-late" ? " bad" : "")} title={`신청 ${fmtDateTime(r.requestAt)}`}>{m == null ? "-" : `${span(m)} 경과`}</span>;
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
  const busy = todo.buckets.filter((b) => b.count > 0);
  const idle = todo.buckets.filter((b) => b.count === 0);

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
                  const esc = r.late === "ESCALATED";
                  // 에스컬레이션은 아래 작은 표시로, 카드 제목과 같은 지연은 빼고 나머지 지연만 배지로
                  const late = esc || SAME_AS_TITLE[b.key]?.includes(r.late ?? "") ? null : r.late;
                  return (
                    <li key={r.asvcSn} className={esc ? "esc" : undefined}>
                      <Link href={href(r)} title={esc ? "미접수 에스컬레이션 — 상급 담당자에게도 알렸습니다" : undefined}>
                        <span className="td-ty">{r.rceptTyName}</span>
                        <span className="td-main">
                          <span className="td-line">
                            <b>{r.schoolName ?? "-"}</b>
                            {esc && <span className="td-esc">에스컬레이션</span>}
                            <HoldBadge row={r} /><LateBadge late={late} /><SlaBadge sla={r.sla} compact />
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
      {idle.length > 0 && (
        <p className="td-idle">
          {idle.map((b) => <span key={b.key}><i aria-hidden="true">✓</i> {b.label} 없음</span>)}
        </p>
      )}
    </section>
  );
}
