"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FilterField, FilterForm } from "@/components/admin/common";
import SubPage from "@/components/SubPage";
import { ErrorBox, Icon, Loading, Pager } from "@/components/ui";
import { api, type Page } from "@/lib/api";
import { AS_NAME, useAsTypes } from "@/lib/as";
import { downloadCsv } from "@/lib/admin";
import { loadRegions } from "@/lib/boards";
import { fmtDate } from "@/lib/format";
import type { RceptTy, Region } from "@/lib/types";

/** AS통계관리 (/api/as/stats): 건수 (monthly) and 만족도 (satisfaction). 업체 관리자는 자기 업체만 집계됩니다. */
export default function StatsPage() {
  return (
    <SubPage perm="AS_STATS">
      <Stats />
    </SubPage>
  );
}

interface Agg { count: number; done: number; avgDays?: number | null; avgScore?: number | null }
interface MonthAgg extends Agg { month: number; returned: number }
interface Monthly {
  year: number;
  total: Agg;
  months: MonthAgg[];
  byType: (Agg & { rceptTy: string; name: string })[];
  byRegion: (Agg & { regionId: number; regionName: string })[];
  byVendor: (Agg & { vendorId: number; vendorName: string })[];
}
interface Satisfaction {
  summary: { completed: number; evaluated: number; responseRate: number; avgScore?: number | null; distribution: Record<string, number> };
  byVendor: { vendorId: number; vendorName: string; count: number; avgScore?: number | null }[];
  byEngineer: { engineerUserId: number; engineerName: string; vendorName?: string; count: number; avgScore?: number | null }[];
  list: Page<{ asvcSn: number; rceptTyName: string; schoolName?: string; vendorName?: string; engineerName?: string; evalScore: number; evalOpinion?: string; evaluatedAt?: string }>;
}

const SCORE = ["", "매우불만족", "불만족", "보통", "만족", "매우만족"];
const num = (n?: number | null, d = 1) => (n == null ? "-" : Number(n).toFixed(d));
const rateOf = (a: Agg) => (a.count ? (a.done / a.count) * 100 : null);
const rate = (a: Agg) => (a.count ? ((a.done / a.count) * 100).toFixed(1) : "0.0");
const days = (n?: number | null) => (n == null ? "-" : `${Number(n).toFixed(1)}일`);
/** 만족도 색: 4점 이상 좋음, 3점 미만 나쁨 */
const scoreTone = (n?: number | null) => (n == null ? "" : n >= 4 ? " good" : n < 3 ? " bad" : "");

function Stats() {
  const asTypes = useAsTypes();
  const thisYear = new Date().getFullYear();
  const [regions, setRegions] = useState<Region[]>([]);
  const [tab, setTab] = useState<"count" | "sat">("count");
  const [draft, setDraft] = useState({ year: String(thisYear), rceptTy: "", regionId: "" });
  const [q, setQ] = useState(draft);
  const [m, setM] = useState<Monthly | null>(null);
  const [prev, setPrev] = useState<Monthly | null>(null);
  const [s, setS] = useState<Satisfaction | null>(null);
  const [sPage, setSPage] = useState(1);
  const [err, setErr] = useState("");

  useEffect(() => {
    loadRegions().then(setRegions).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setErr("");
    setM(null);
    api.get<Monthly>("/api/as/stats/monthly", q).then(setM).catch((e) => setErr(e.message));
    api.get<Monthly>("/api/as/stats/monthly", { ...q, year: Number(q.year) - 1 }).then(setPrev).catch(() => setPrev(null));
  }, [q]);
  useEffect(load, [load]);
  useEffect(() => {
    if (tab !== "sat") return;
    api.get<Satisfaction>("/api/as/stats/satisfaction", { ...q, page: sPage, size: 10 }).then(setS).catch((e) => setErr(e.message));
  }, [tab, q, sPage]);

  return (
    <div className="ast">
      <div className="tabs" role="tablist" aria-label="통계 구분">
        {([["count", "AS건수 통계"], ["sat", "만족도 관리"]] as const).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <FilterForm submitLabel="조회" onSubmit={() => { setQ(draft); setSPage(1); }}>
        <FilterField id="st-y" label="연도">
          <select id="st-y" value={draft.year} onChange={(e) => setDraft({ ...draft, year: e.target.value })}>
            {[0, 1, 2, 3].map((i) => <option key={i} value={thisYear - i}>{thisYear - i}</option>)}
          </select>
        </FilterField>
        <FilterField id="st-k" label="구분">
          <select id="st-k" value={draft.rceptTy} onChange={(e) => setDraft({ ...draft, rceptTy: e.target.value })}>
            <option value="">전체</option>
            {asTypes.map((t) => <option key={t} value={t}>{AS_NAME[t]}</option>)}
          </select>
        </FilterField>
        <FilterField id="st-r" label="지역">
          <select id="st-r" value={draft.regionId} onChange={(e) => setDraft({ ...draft, regionId: e.target.value })}>
            <option value="">전체</option>
            {regions.map((r) => <option key={r.regionId} value={r.regionId}>{r.regionName}</option>)}
          </select>
        </FilterField>
      </FilterForm>

      {err ? <ErrorBox message={err} onRetry={load} /> : !m ? <Loading /> : tab === "count" ? (
        <CountTab m={m} prev={prev} asTypes={asTypes} />
      ) : !s ? <Loading /> : (
        <SatTab s={s} year={q.year} onPage={setSPage} />
      )}
    </div>
  );
}

/* ---------- 공통 조각 ---------- */

/** 전년(지난 기간) 대비: ▲/▼ 값, 좋아진 쪽은 초록 · 나빠진 쪽은 빨강 */
function Delta({ now, prev, unit, goodUp, pct }: { now?: number | null; prev?: number | null; unit: string; goodUp: boolean; pct?: boolean }) {
  if (now == null || prev == null || (pct && !prev)) return <span className="sla-dl">전년 자료 없음</span>;
  const diff = pct ? ((now - prev) / prev) * 100 : now - prev;
  const r = Math.round(diff * 10) / 10;
  if (r === 0) return <span className="sla-dl">전년과 같음</span>;
  const good = goodUp ? r > 0 : r < 0;
  return <span className={"sla-dl " + (good ? "good" : "bad")}>{r > 0 ? "▲" : "▼"} {Math.abs(r)}{unit} <small>전년 대비</small></span>;
}

function Card({ label, value, unit, tone = "", children }: { label: string; value: string; unit?: string; tone?: string; children?: React.ReactNode }) {
  return (
    <div className={"sla-k" + tone}>
      <span className="sla-kl">{label}</span>
      <b className="sla-kv">{value}{unit && <small>{unit}</small>}</b>
      {children}
    </div>
  );
}

/** 완료율 · 만족도 같은 비율 막대 */
function Meter({ v, max = 100, tone }: { v: number; max?: number; tone: "ok" | "mid" | "bad" }) {
  return <span className={"ast-m " + tone} aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, (v / max) * 100))}%` }} /></span>;
}
const doneTone = (r: number | null): "ok" | "mid" | "bad" => (r == null ? "mid" : r >= 80 ? "ok" : r >= 50 ? "mid" : "bad");

/* ---------- AS건수 통계 ---------- */

function CountTab({ m, prev, asTypes }: { m: Monthly; prev: Monthly | null; asTypes: RceptTy[] }) {
  const returned = m.months.reduce((n, x) => n + x.returned, 0);
  const open = Math.max(0, m.total.count - m.total.done - returned);
  const r = rateOf(m.total), pr = prev ? rateOf(prev.total) : null;
  const types = m.byType.filter((x) => asTypes.includes(x.rceptTy as RceptTy));
  return (
    <>
      <section className="sla-sec" aria-label="요약">
        <div className="sla-kpi">
          <Card label={`${m.year}년 접수`} value={m.total.count.toLocaleString()} unit="건">
            <Delta now={m.total.count} prev={prev?.total.count} unit="%" goodUp={false} pct />
            <small className="sla-ks">작년 {prev ? prev.total.count.toLocaleString() : "-"}건</small>
          </Card>
          <Card label="처리완료" value={m.total.done.toLocaleString()} unit="건">
            <small className="sla-ks">진행 중 {open.toLocaleString()} · 반려 {returned.toLocaleString()}</small>
          </Card>
          <Card label="처리완료율" value={r == null ? "-" : r.toFixed(1)} unit={r == null ? "" : "%"} tone={r == null ? "" : r >= 80 ? " good" : r < 50 ? " bad" : ""}>
            <Delta now={r} prev={pr} unit="%p" goodUp />
            {r != null && <Meter v={r} tone={doneTone(r)} />}
          </Card>
          <Card label="평균 처리기간" value={num(m.total.avgDays)} unit={m.total.avgDays == null ? "" : "일"}>
            <Delta now={m.total.avgDays} prev={prev?.total.avgDays} unit="일" goodUp={false} />
            <small className="sla-ks">신청 → 처리완료</small>
          </Card>
        </div>
      </section>

      <div className="ast-grid">
        <section className="sla-sec" aria-labelledby="ast-mo-t">
          <h2 id="ast-mo-t" className="sla-h">월별 접수 건수 <small>{m.year}년 · 작년 같은 달과 비교</small></h2>
          <MonthChart year={m.year} months={m.months} prev={prev?.months} />
        </section>
        <section className="sla-sec" aria-labelledby="ast-ty-t">
          <h2 id="ast-ty-t" className="sla-h">구분별 접수</h2>
          <div className="ast-ty">
            {types.length ? types.map((x) => {
              const share = m.total.count ? (x.count / m.total.count) * 100 : 0;
              const rr = rateOf(x);
              return (
                <div key={x.rceptTy} className="ast-ty-r">
                  <div className="ast-ty-h"><b>{x.name}</b><span><b>{x.count.toLocaleString()}</b>건 · {share.toFixed(0)}%</span></div>
                  <span className="ast-share" aria-hidden="true"><i style={{ width: `${share}%` }} /></span>
                  <small className="hint">완료율 {rr == null ? "-" : `${rr.toFixed(1)}%`} · 평균 {days(x.avgDays)}</small>
                </div>
              );
            }) : <p className="hint">자료가 없습니다.</p>}
          </div>
        </section>
      </div>

      <AggTable title="지역별 처리 현황" name="지역" rows={m.byRegion.map((x) => ({ key: x.regionId, label: x.regionName, a: x }))} csv={`AS건수통계_지역별_${m.year}`} />
      <AggTable title="업체별 처리 현황" name="업체" score rows={m.byVendor.map((x) => ({ key: x.vendorId, label: x.vendorName, a: x }))} csv={`AS건수통계_업체별_${m.year}`} />
    </>
  );
}

/** 월별 접수: 처리완료 + 미완료를 쌓은 막대, 작년 같은 달은 가는 가로선. 올해의 아직 오지 않은 달은 비운다. */
function MonthChart({ year, months, prev }: { year: number; months: MonthAgg[]; prev?: MonthAgg[] }) {
  const [hi, setHi] = useState<number | null>(null);
  // 좁은 화면에서는 옆으로 스크롤된다: 최근 달이 보이도록 오른쪽 끝에서 시작
  const fig = useRef<HTMLElement>(null);
  useEffect(() => { if (fig.current) fig.current.scrollLeft = fig.current.scrollWidth; }, [months]);
  const now = new Date();
  const lastMonth = year === now.getFullYear() ? now.getMonth() + 1 : 12;
  const all = Array.from({ length: 12 }, (_, i) => months.find((x) => x.month === i + 1) ?? { month: i + 1, count: 0, done: 0, returned: 0 });
  const pv = (mo: number) => prev?.find((x) => x.month === mo)?.count ?? 0;
  const W = 560, L = 30, R = 6, T = 12, BH = 190, step = (W - L - R) / 12, bw = Math.min(26, step * 0.5);
  const maxN = Math.max(1, ...all.map((x) => x.count), ...all.map((x) => pv(x.month)));
  const top = maxN <= 4 ? 4 : Math.ceil(maxN / 4) * 4;
  const y = (v: number) => T + BH - (v / top) * BH;
  const cx = (i: number) => L + step * i + step / 2;
  const H = T + BH + 28;
  const h = hi == null ? null : all[hi];
  return (
    <figure className="sla-tr ast-mc" ref={fig}>
      <ul className="sla-tr-lg" aria-hidden="true">
        <li><i className="bk ok ast-done" /> 처리완료</li>
        <li><i className="bk ok" /> 진행 중 · 반려</li>
        {prev && <li><i className="ast-prev" /> 작년 같은 달</li>}
      </ul>
      <div className="sla-tr-w" onMouseLeave={() => setHi(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${year}년 월별 접수: ${all.filter((x) => x.month <= lastMonth).map((x) => `${x.month}월 ${x.count}건`).join(", ")}`}>
          {[0, top / 2, top].map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="gd" />
              <text x={L - 6} y={y(t) + 4} className="ax" textAnchor="end">{t}</text>
            </g>
          ))}
          {hi != null && <rect x={L + step * hi} y={T - 6} width={step} height={BH + 8} className="hv" />}
          {all.map((x, i) => {
            const future = x.month > lastMonth;
            const rest = x.count - x.done, bx = cx(i) - bw / 2;
            return (
              <g key={x.month}>
                {!future && x.done > 0 && <rect x={bx} y={y(x.done)} width={bw} height={y(0) - y(x.done)} rx={rest ? 0 : 3} className="bk ast-done" />}
                {!future && rest > 0 && <rect x={bx} y={y(x.count)} width={bw} height={Math.max(1, y(x.done) - y(x.count) - (x.done ? 2 : 0))} rx={3} className="bk ok" />}
                {prev && pv(x.month) > 0 && <line x1={bx - 4} x2={bx + bw + 4} y1={y(pv(x.month))} y2={y(pv(x.month))} className="ast-prevl" />}
                <text x={cx(i)} y={T + BH + 18} className={"ax mo" + (hi === i ? " on" : "") + (future ? " fut" : "")} textAnchor="middle">{x.month}월</text>
                <rect x={L + step * i} y={0} width={step} height={H} className="hit" tabIndex={0} onMouseEnter={() => setHi(i)} onFocus={() => setHi(i)} onBlur={() => setHi(null)}
                  aria-label={`${x.month}월: 접수 ${x.count}건, 처리완료 ${x.done}건${prev ? `, 작년 ${pv(x.month)}건` : ""}`} />
              </g>
            );
          })}
        </svg>
        {h && hi != null && (
          <div className="sla-tip" style={{ left: `${(cx(hi) / W) * 100}%` }} role="status">
            <b>{year}년 {h.month}월</b>
            {h.month > lastMonth ? <span>아직 오지 않은 달</span> : (
              <>
                <span>접수 <b>{h.count}</b>건 · 처리완료 <b>{h.done}</b>건</span>
                {h.returned > 0 && <span>반려 {h.returned}건</span>}
              </>
            )}
            {prev && <span>작년 같은 달 {pv(h.month)}건</span>}
          </div>
        )}
      </div>
      <details className="sla-tr-tb">
        <summary>표로 보기</summary>
        <div className="tw">
          <table>
            <thead><tr><th scope="col">월</th><th scope="col">접수</th><th scope="col">처리완료</th><th scope="col">반려</th>{prev && <th scope="col">작년</th>}</tr></thead>
            <tbody>{all.map((x) => <tr key={x.month}><td>{x.month}월</td><td>{x.count}</td><td>{x.done}</td><td>{x.returned}</td>{prev && <td>{pv(x.month)}</td>}</tr>)}</tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** 지역 · 업체 표: 접수 많은 순, 완료율 막대, 접수 0건 행은 접어 둔다. */
function AggTable({ title, name, rows, csv, score }: { title: string; name: string; rows: { key: number; label: string; a: Agg }[]; csv: string; score?: boolean }) {
  const [showZero, setShowZero] = useState(false);
  const head = [name, "접수", "처리완료", "완료율", "평균 처리기간", ...(score ? ["평균 만족도"] : [])];
  const csvCells = (a: Agg) => [a.count.toLocaleString(), a.done.toLocaleString(), rate(a) + "%", a.avgDays == null ? "-" : num(a.avgDays) + "일", ...(score ? [num(a.avgScore, 2)] : [])];
  const sorted = [...rows].sort((x, y) => y.a.count - x.a.count || (rateOf(x.a) ?? 0) - (rateOf(y.a) ?? 0));
  const active = sorted.filter((r) => r.a.count > 0);
  const zero = sorted.filter((r) => r.a.count === 0);
  const shown = showZero ? sorted : active;
  const maxN = Math.max(1, ...rows.map((r) => r.a.count));
  return (
    <section className="sla-sec" aria-label={title}>
      <div className="ast-th">
        <h2 className="sla-h">{title} <small>접수 많은 순{zero.length ? ` · 접수 없는 ${name} ${zero.length}곳` : ""}</small></h2>
        <button className="btn sm sec" type="button" disabled={!rows.length} onClick={() => downloadCsv(csv, head, sorted.map((r) => [r.label, ...csvCells(r.a)]))}>엑셀출력 <Icon name="down" /></button>
      </div>
      <div className="tw">
        <table className="cards ast-t">
          <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>
            {shown.length ? shown.map(({ key, label, a }) => {
              const r = rateOf(a);
              return (
                <tr key={key} className={a.count ? undefined : "ast-zero"}>
                  <td data-label={name} className="tl"><b>{label}</b></td>
                  <td data-label="접수" className="ast-n">
                    <span className="ast-share sm" aria-hidden="true"><i style={{ width: `${(a.count / maxN) * 100}%` }} /></span>
                    {a.count.toLocaleString()}
                  </td>
                  <td data-label="처리완료">{a.done.toLocaleString()}</td>
                  <td data-label="완료율" className="ast-n">{r == null ? <span className="hint">-</span> : <><Meter v={r} tone={doneTone(r)} /><b className={"ast-r " + doneTone(r)}>{r.toFixed(1)}%</b></>}</td>
                  <td data-label="평균 처리기간">{a.avgDays == null ? <span className="hint">-</span> : days(a.avgDays)}</td>
                  {score && <td data-label="평균 만족도">{a.avgScore == null ? <span className="hint">-</span> : <span className={"ast-sc" + scoreTone(a.avgScore)}>★ {num(a.avgScore, 2)}</span>}</td>}
                </tr>
              );
            }) : <tr><td colSpan={head.length}>{rows.length ? "이 기간에 접수가 없습니다." : "자료가 없습니다."}</td></tr>}
          </tbody>
        </table>
      </div>
      {zero.length > 0 && (
        <button type="button" className="ast-more" onClick={() => setShowZero(!showZero)} aria-expanded={showZero}>
          {showZero ? "접수 없는 " + name + " 접기" : `접수 없는 ${name} ${zero.length}곳 보기 (${zero.slice(0, 4).map((r) => r.label).join(", ")}${zero.length > 4 ? " …" : ""})`}
        </button>
      )}
    </section>
  );
}

/* ---------- 만족도 관리 ---------- */

function SatTab({ s, year, onPage }: { s: Satisfaction; year: string; onPage: (p: number) => void }) {
  const dist = [5, 4, 3, 2, 1].map((k) => ({ k, n: s.summary.distribution[k] ?? 0 }));
  const distTotal = dist.reduce((n, d) => n + d.n, 0);
  const low = (s.summary.distribution[1] ?? 0) + (s.summary.distribution[2] ?? 0);
  const engineers = [...s.byEngineer].sort((a, b) => (a.avgScore ?? 9) - (b.avgScore ?? 9));
  const vendors = [...s.byVendor].sort((a, b) => (b.avgScore ?? 0) - (a.avgScore ?? 0));
  return (
    <>
      <section className="sla-sec" aria-label="요약">
        <div className="sla-kpi">
          <Card label="평균 만족도" value={num(s.summary.avgScore, 2)} unit={s.summary.avgScore == null ? "" : "/ 5점"} tone={scoreTone(s.summary.avgScore)}>
            <small className="sla-ks">4점 이상 좋음 · 3점 미만 확인 필요</small>
          </Card>
          <Card label="평가 건수" value={s.summary.evaluated.toLocaleString()} unit="건">
            <small className="sla-ks">처리완료 {s.summary.completed.toLocaleString()}건 중</small>
          </Card>
          <Card label="평가 참여율" value={num(s.summary.responseRate)} unit="%" tone={s.summary.responseRate < 50 ? " bad" : ""}>
            <Meter v={s.summary.responseRate} tone={s.summary.responseRate >= 70 ? "ok" : s.summary.responseRate >= 50 ? "mid" : "bad"} />
          </Card>
          <Card label="불만족 이하" value={low.toLocaleString()} unit="건" tone={low ? " bad" : " good"}>
            <small className="sla-ks">1 · 2점 — 원인 확인이 필요합니다</small>
          </Card>
        </div>
      </section>

      <div className="ast-grid even">
        <section className="sla-sec" aria-labelledby="ast-d-t">
          <h2 id="ast-d-t" className="sla-h">만족도 분포 <small>평가 {distTotal}건</small></h2>
          <div className="ast-ty">
            <span className="ast-stack" role="img" aria-label={dist.map((d) => `${SCORE[d.k]} ${d.n}건`).join(", ")}>
              {dist.filter((d) => d.n).map((d) => <i key={d.k} className={"sc" + d.k} style={{ flexGrow: d.n }} />)}
            </span>
            {dist.map((d) => (
              <div key={d.k} className="ast-dr">
                <span><i className={"ast-dot sc" + d.k} aria-hidden="true" />{SCORE[d.k]} <small className="hint">{d.k}점</small></span>
                <span><b>{d.n}</b>건 <small className="hint">{distTotal ? Math.round((d.n / distTotal) * 100) : 0}%</small></span>
              </div>
            ))}
          </div>
        </section>
        <section className="sla-sec" aria-labelledby="ast-v-t">
          <h2 id="ast-v-t" className="sla-h">업체별 평균 만족도 <small>높은 순</small></h2>
          <div className="ast-ty">
            {vendors.length ? vendors.map((x) => (
              <div key={x.vendorId} className="ast-ty-r">
                <div className="ast-ty-h"><b>{x.vendorName}</b><span className={"ast-sc" + scoreTone(x.avgScore)}>★ {num(x.avgScore, 2)} <small className="hint">({x.count}건)</small></span></div>
                <Meter v={x.avgScore ?? 0} max={5} tone={(x.avgScore ?? 0) >= 4 ? "ok" : (x.avgScore ?? 0) >= 3 ? "mid" : "bad"} />
              </div>
            )) : <p className="hint">평가 자료가 없습니다.</p>}
          </div>
        </section>
      </div>

      <section className="sla-sec" aria-labelledby="ast-e-t">
        <h2 id="ast-e-t" className="sla-h">기사별 만족도 <small>낮은 순 — 위쪽부터 확인하세요</small></h2>
        <div className="tw">
          <table className="cards ast-t">
            <thead><tr><th scope="col">기사</th><th scope="col">업체</th><th scope="col">평가 건수</th><th scope="col">평균</th></tr></thead>
            <tbody>
              {engineers.length ? engineers.map((x) => (
                <tr key={x.engineerUserId}>
                  <td data-label="기사" className="tl"><b>{x.engineerName}</b></td>
                  <td data-label="업체">{x.vendorName ?? "-"}</td>
                  <td data-label="평가 건수">{x.count}</td>
                  <td data-label="평균" className="ast-n"><Meter v={x.avgScore ?? 0} max={5} tone={(x.avgScore ?? 0) >= 4 ? "ok" : (x.avgScore ?? 0) >= 3 ? "mid" : "bad"} /><span className={"ast-sc" + scoreTone(x.avgScore)}>★ {num(x.avgScore, 2)}</span></td>
                </tr>
              )) : <tr><td colSpan={4}>평가 자료가 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="sla-sec" aria-labelledby="ast-l-t">
        <div className="ast-th">
          <h2 id="ast-l-t" className="sla-h">평가 목록 <small>전체 {s.list.totalElements}건</small></h2>
          <button className="btn sm sec" type="button" disabled={!s.list.content.length}
            onClick={() => downloadCsv(`만족도_${year}_p${s.list.page}`, ["번호", "구분", "학교", "업체", "기사", "점수", "의견", "평가일"],
              s.list.content.map((x) => [x.asvcSn, x.rceptTyName, x.schoolName, x.vendorName, x.engineerName, x.evalScore, x.evalOpinion, fmtDate(x.evaluatedAt)]))}>
            엑셀출력 <Icon name="down" />
          </button>
        </div>
        <div className="tw">
          <table className="cards ast-t" style={{ minWidth: 760 }}>
            <thead><tr>{["접수번호", "만족도", "구분", "학교", "업체 / 기사", "의견", "평가일"].map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
            <tbody>
              {s.list.content.length ? s.list.content.map((x) => (
                <tr key={x.asvcSn} className={x.evalScore <= 2 ? "ast-low" : undefined}>
                  <td data-label="접수번호">AS-{x.asvcSn}</td>
                  <td data-label="만족도"><span className={"ast-sc" + scoreTone(x.evalScore)}>{"★".repeat(x.evalScore)}<span className="ast-sc-off">{"★".repeat(5 - x.evalScore)}</span></span> <small className="hint">{SCORE[x.evalScore]}</small></td>
                  <td data-label="구분">{x.rceptTyName}</td>
                  <td data-label="학교">{x.schoolName ?? "-"}</td>
                  <td data-label="업체 / 기사">{x.vendorName ?? "-"} / {x.engineerName ?? "-"}</td>
                  <td data-label="의견" className="tl">{x.evalOpinion || <span className="hint">-</span>}</td>
                  <td data-label="평가일">{fmtDate(x.evaluatedAt)}</td>
                </tr>
              )) : <tr><td colSpan={7}>평가 자료가 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager page={s.list.page} totalPages={s.list.totalPages} onPage={onPage} />
      </section>
    </>
  );
}
