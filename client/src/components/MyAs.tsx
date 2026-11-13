"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AsDetailModal from "./AsDetailModal";
import { AsBadge, ErrorBox, HoldBadge, LateBadge, Loading, Pager, SlaBadge } from "./ui";
import { api } from "@/lib/api";
import { ACTION_LABEL, AS_REQUEST_HREF, AS_REQUEST_PERM } from "@/lib/as";
import { useAuth } from "@/lib/auth";
import { fmtDate, fmtDateTime } from "@/lib/format";
import type { AsRow, AsSummary, Page, Todo } from "@/lib/types";

/** 할 일 행에서 바로 펼칠 처리 (보이는 순서) */
const QUICK = ["receive", "handler", "assign", "engineer", "device", "arrive", "report", "evaluate"];
const PAGE = 10;

/** 마이페이지 탭 배지: 내 할 일 건수 · 내 신청 중 진행 중 건수. */
export function useMyAsCounts() {
  const [c, setC] = useState<{ todo: number; open: number } | null>(null);
  useEffect(() => {
    Promise.all([
      api.get<Todo>("/api/as/requests/todo").then((t) => t.total).catch(() => 0),
      api.get<AsSummary>("/api/as/requests/summary", { mine: true }).then((s) => s.requested + s.received).catch(() => 0),
    ]).then(([todo, open]) => setC({ todo, open }));
  }, []);
  return c;
}

// ---------- 내 할 일 ----------

interface TodoPage { key: string; label: string; hint: string; list: Page<AsRow & { allowedActions: string[] }> }

/**
 * 내 할 일: 지금 내가 처리할 AS (GET /api/as/requests/todo). 묶음 칩을 고르면 그 묶음의 전체 목록 (페이지).
 * 행마다 할 수 있는 처리(접수 · 기사 지정 · 도착 기록 · 보고서 · 평가 …)를 바로 펼친다.
 */
export function TodoTab({ initialKey }: { initialKey?: string | null } = {}) {
  const [todo, setTodo] = useState<Todo | null>(null);
  const [key, setKey] = useState<string | null>(initialKey ?? null);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<TodoPage | null>(null);
  const [err, setErr] = useState("");
  const [work, setWork] = useState<{ sn: number; action?: string } | null>(null);

  const loadBuckets = useCallback(() => {
    setErr("");
    api.get<Todo>("/api/as/requests/todo").then((t) => {
      setTodo(t);
      // 처음엔 건이 있는 첫 묶음
      setKey((k) => k && t.buckets.some((b) => b.key === k) ? k : (t.buckets.find((b) => b.count > 0) ?? t.buckets[0])?.key ?? null);
    }).catch((e) => setErr(e.message));
  }, []);
  useEffect(loadBuckets, [loadBuckets]);
  const loadList = useCallback(() => {
    if (!key) return setData(null);
    api.get<TodoPage>(`/api/as/requests/todo/${key}`, { page, size: PAGE }).then(setData).catch((e) => setErr(e.message));
  }, [key, page]);
  useEffect(loadList, [loadList]);
  const reload = () => { loadBuckets(); loadList(); };

  if (err) return <ErrorBox message={err} onRetry={reload} />;
  if (!todo) return <Loading />;
  if (!todo.buckets.length) return <p className="td-clear">이 계정에는 처리할 AS 업무가 없습니다. 내가 신청한 AS는 &lsquo;내 신청&rsquo;에서 봅니다.</p>;

  return (
    <div className="my-as">
      <div className="my-chips" role="tablist" aria-label="할 일 묶음">
        {todo.buckets.map((b) => (
          <button key={b.key} type="button" role="tab" aria-selected={b.key === key} className={(b.key === key ? "on" : "") + (b.count ? "" : " zero")}
            onClick={() => { setKey(b.key); setPage(1); }}>
            {b.label} <b>{b.count}</b>
          </button>
        ))}
      </div>
      {todo.total === 0 && <p className="td-clear"><span aria-hidden="true">✓</span> 지금 처리할 일이 없습니다.</p>}
      {data && data.key === key && (
        <>
          <p className="my-hint">{data.hint}</p>
          {data.list.content.length ? (
            <ul className="my-list">
              {data.list.content.map((r) => {
                const acts = QUICK.filter((a) => r.allowedActions.includes(a)).slice(0, 3);
                return (
                  <li key={r.asvcSn} className="my-row">
                    <div className="my-main">
                      <div className="my-t">
                        <span className="td-ty">{r.rceptTyName}</span>
                        <button type="button" className="my-sn" onClick={() => setWork({ sn: r.asvcSn })}>AS-{r.asvcSn}</button>
                        <b>{r.schoolName}</b> <AsBadge status={r.status} name={r.statusName} /> <HoldBadge row={r} /> <LateBadge late={r.late} /> <SlaBadge sla={r.sla} />
                      </div>
                      <p className="my-sym">{r.symptom}</p>
                      <small className="my-meta">
                        신청 {fmtDateTime(r.requestAt)}
                        {r.visitPlannedAt && <> · 방문예정 {fmtDateTime(r.visitPlannedAt)}</>}
                        {(r.handlerName || r.vendorName) && <> · {r.handlerName ?? r.vendorName}{r.engineerName ? ` / ${r.engineerName}` : ""}</>}
                        {r.evalScore != null && <> · 만족도 {r.evalScore}점</>}
                      </small>
                    </div>
                    <div className="my-acts">
                      {acts.map((a, i) => (
                        <button key={a} type="button" className={"btn sm" + (i ? " sec" : "")} onClick={() => setWork({ sn: r.asvcSn, action: a })}>{ACTION_LABEL[a]}</button>
                      ))}
                      {!acts.length && <button type="button" className="btn sm sec" onClick={() => setWork({ sn: r.asvcSn })}>상세 보기</button>}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : <p className="my-empty">이 묶음에는 건이 없습니다.</p>}
          <Pager page={data.list.page} totalPages={data.list.totalPages} onPage={setPage} />
        </>
      )}
      {work && <AsDetailModal sn={work.sn} initialAction={work.action} onClose={() => { setWork(null); reload(); }} onChanged={reload} />}
    </div>
  );
}

// ---------- 내 신청 ----------

const MINE_FILTERS = [["A,R", "진행 중"], ["C", "처리완료"], ["X", "반려"], ["", "전체"]] as const;

/**
 * 내 신청: 내가 신청한 AS (mine=true). 학교 담당자는 '우리 학교 신청 모두 보기'로 같은 학교의 다른 담당자 신청까지.
 * 행마다 진행 단계 · 담당 · 연락처, 그리고 취소 · 만족도 평가 · 다시 신청.
 */
export function MineTab({ initialStatus, initialSchool }: { initialStatus?: string | null; initialSchool?: boolean } = {}) {
  const { me, can } = useAuth();
  const [status, setStatus] = useState<string>(MINE_FILTERS.some(([k]) => k === initialStatus) ? initialStatus! : "A,R");
  const [school, setSchool] = useState(!!initialSchool && !!me?.schoolId);
  const [page, setPage] = useState(1);
  const [sum, setSum] = useState<AsSummary | null>(null);
  const [data, setData] = useState<Page<AsRow> | null>(null);
  const [err, setErr] = useState("");
  const [work, setWork] = useState<{ sn: number; action?: string } | null>(null);
  const mine = !school;

  const load = useCallback(() => {
    setErr("");
    api.get<AsSummary>("/api/as/requests/summary", { mine: mine || undefined }).then(setSum).catch((e) => setErr(e.message));
    api.get<Page<AsRow>>("/api/as/requests", { mine: mine || undefined, status: status || undefined, page, size: PAGE })
      .then(setData).catch((e) => setErr(e.message));
  }, [mine, status, page]);
  useEffect(load, [load]);

  if (err) return <ErrorBox message={err} onRetry={load} />;
  if (!sum || !data) return <Loading />;
  const count: Record<string, number> = { "A,R": sum.requested + sum.received, C: sum.completed, X: sum.returned, "": sum.requested + sum.received + sum.completed + sum.returned };

  return (
    <div className="my-as">
      <div className="my-chips" role="tablist" aria-label="상태">
        {MINE_FILTERS.map(([k, l]) => (
          <button key={k || "all"} type="button" role="tab" aria-selected={status === k} className={status === k ? "on" : ""} onClick={() => { setStatus(k); setPage(1); }}>
            {l} <b>{count[k].toLocaleString()}</b>
          </button>
        ))}
        {me?.schoolId && (
          <label className="my-school">
            <input type="checkbox" checked={school} onChange={(e) => { setSchool(e.target.checked); setPage(1); }} /> 우리 학교 신청 모두 보기
          </label>
        )}
      </div>
      {sum.waitingEval > 0 && <p className="my-hint">만족도 평가를 기다리는 건이 <b>{sum.waitingEval}</b>건 있습니다.</p>}
      {data.content.length ? (
        <ul className="my-list">
          {data.content.map((r) => {
            const own = r.applicantUserId === me?.userId;
            const canCancel = own && (r.status === "A" || r.status === "X");
            const again = (r.status === "C" || r.status === "X") && can(AS_REQUEST_PERM[r.rceptTy]);
            return (
              <li key={r.asvcSn} className={"my-row" + (r.canEvaluate ? " evw-row" : "")}>
                <div className="my-main">
                  <div className="my-t">
                    <span className="td-ty">{r.rceptTyName}</span>
                    <button type="button" className="my-sn" onClick={() => setWork({ sn: r.asvcSn })}>AS-{r.asvcSn}</button>
                    <b className="my-sym-t">{r.symptom}</b>
                    {!own && r.applicantName && <small className="my-who"> · {r.applicantName}</small>}
                    <HoldBadge row={r} /> <SlaBadge sla={r.sla} />
                  </div>
                  <Stepper r={r} />
                  <small className="my-meta">
                    {r.onHold && <span className="my-hold">보류: {r.holdReason}{r.holdUntil ? ` (재개 예정 ${r.holdUntil.slice(5).replace("-", "/")})` : ""} · </span>}
                    {r.status === "X"
                      ? <span className="my-ret">반려: {r.returnReason ?? "-"}</span>
                      : <>
                          담당 {r.handlerName ?? r.vendorName ?? "배정 전"}{r.engineerName ? ` · ${r.engineerName}` : ""}
                          {r.engineerTel && <> <a className="my-tel" href={`tel:${r.engineerTel.replace(/[^0-9+]/g, "")}`}>☎ {r.engineerTel}</a></>}
                          {r.visitPlannedAt && r.status === "R" && <> · 방문예정 {fmtDateTime(r.visitPlannedAt)}</>}
                        </>}
                  </small>
                </div>
                <div className="my-acts">
                  {r.canEvaluate && <button type="button" className="btn sm evw-btn" onClick={() => setWork({ sn: r.asvcSn, action: "evaluate" })}>만족도 평가</button>}
                  <button type="button" className="btn sm sec" onClick={() => setWork({ sn: r.asvcSn })}>{r.hasReport ? "보고서 보기" : "상세 보기"}</button>
                  {canCancel && <button type="button" className="btn sm sec" onClick={() => setWork({ sn: r.asvcSn, action: "cancel" })}>취소</button>}
                  {again && <Link className="btn sm sec" href={`${AS_REQUEST_HREF[r.rceptTy]}?copy=${r.asvcSn}`}>다시 신청</Link>}
                </div>
              </li>
            );
          })}
        </ul>
      ) : <p className="my-empty">{school ? "우리 학교" : "내가"} 신청한 {MINE_FILTERS.find(([k]) => k === status)?.[1]} AS가 없습니다.</p>}
      <Pager page={data.page} totalPages={data.totalPages} onPage={setPage} />
      {work && <AsDetailModal sn={work.sn} initialAction={work.action} onClose={() => { setWork(null); load(); }} onChanged={load} />}
    </div>
  );
}

/** 진행 단계: 신청 → 접수 → 도착 → 완료 → 평가 (평가를 쓰지 않는 유형은 평가 없이). */
function Stepper({ r }: { r: AsRow }) {
  if (r.status === "X") return null;
  const steps: [string, string | undefined | null, boolean][] = [
    ["신청", r.requestAt, true],
    ["접수", r.receivedAt, !!r.receivedAt || r.status === "R" || r.status === "C"],
    ["도착", r.visitAt, !!r.visitAt],
    ["완료", r.completedAt, r.status === "C"],
  ];
  if (!r.evalOff) steps.push(["평가", r.evaluatedAt, r.evalScore != null]);
  const cur = steps.findIndex(([, , done]) => !done);
  return (
    <ol className="my-step" aria-label="진행 단계">
      {steps.map(([l, at, done], i) => (
        <li key={l} className={done ? "done" : i === cur ? "cur" : ""} aria-current={i === cur ? "step" : undefined}>
          <span aria-hidden="true" />{l}{done && at && <small>{fmtDate(at).slice(5)}</small>}
        </li>
      ))}
    </ol>
  );
}
