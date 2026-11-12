"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { AS_LIST_HREF, AS_NAME } from "@/lib/as";
import { useAuth } from "@/lib/auth";
import { fmtDate, fmtDateTime } from "@/lib/format";
import type { Todo, TodoRow } from "@/lib/types";
import { LateBadge } from "./ui";

/** 급한 묶음이 먼저 보이도록 (지연 → 배정 → 방문 → 평가). */
const URGENT = new Set(["receive-late", "visit-late", "low-score"]);

/**
 * 홈의 '내 할 일' (GET /api/as/requests/todo): 계정마다 지금 처리할 AS 묶음.
 * 건이 있는 묶음은 오래된 순 5건을 보여 주고, 누르면 그 건의 상세가 열린다.
 */
export default function TodoPanel() {
  const { can } = useAuth();
  const [todo, setTodo] = useState<Todo | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    api.get<Todo>("/api/as/requests/todo").then(setTodo).catch(() => setErr(true));
  }, []);

  if (err || !todo || !todo.buckets.length) return null;
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
            <article key={b.key} className={"td-card" + (URGENT.has(b.key) ? " urgent" : "")} aria-label={`${b.label} ${b.count}건`}>
              <header>
                <h3>{b.label}</h3>
                <b className="td-n">{b.count.toLocaleString()}</b>
              </header>
              <p className="td-hint">{b.hint}</p>
              <ul>
                {b.rows.map((r) => (
                  <li key={r.asvcSn}>
                    <Link href={href(r)}>
                      <span className="td-ty">{r.rceptTyName}</span>
                      <span className="td-main">
                        <b>{r.schoolName ?? "-"}</b> <LateBadge late={r.late} />
                        <small>{r.symptom}</small>
                      </span>
                      <span className="td-when">
                        {b.key === "visit-soon" || b.key === "visit-late" ? fmtDateTime(r.visitPlannedAt) : b.key === "low-score" ? `${r.evalScore}점` : fmtDate(r.requestAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              {b.count > b.rows.length && <p className="td-more">외 {(b.count - b.rows.length).toLocaleString()}건</p>}
            </article>
          ))}
        </div>
      )}
      {idle.length > 0 && (
        <p className="td-idle">
          {idle.map((b) => <span key={b.key}>{b.label} 0</span>)}
        </p>
      )}
    </section>
  );
}
