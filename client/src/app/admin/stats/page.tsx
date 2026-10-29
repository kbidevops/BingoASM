"use client";

import { useCallback, useEffect, useState } from "react";
import { HBar, VBar } from "@/components/admin/charts";
import { FilterField, FilterForm, Kpis } from "@/components/admin/common";
import SubPage from "@/components/SubPage";
import { ErrorBox, Icon, Loading, Pager } from "@/components/ui";
import { api, type Page } from "@/lib/api";
import { AS_NAME, useAsTypes } from "@/lib/as";
import { downloadCsv } from "@/lib/admin";
import { loadRegions } from "@/lib/boards";
import { fmtDate } from "@/lib/format";
import type { RceptTy, Region } from "@/lib/types";

/** AS통계관리 (/api/as/stats): 건수·비용 (monthly) and 만족도 (satisfaction). 업체 관리자는 자기 업체만 집계됩니다. */
export default function StatsPage() {
  return (
    <SubPage perm="AS_STATS">
      <Stats />
    </SubPage>
  );
}

interface Agg { count: number; done: number; cost: number; paidCost?: number; avgDays?: number | null; avgScore?: number | null }
interface Monthly {
  year: number;
  // 유상/무상·비용 항목 필드는 비용 항목 기능 이전 서버에는 없다.
  total: Agg & { paidCost?: number; freeCost?: number; paidCount?: number; freeCount?: number };
  byCostType?: { costType: string; name: string; lines: number; amount: number; paidAmount: number }[];
  months: (Agg & { month: number; returned: number })[];
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
const rate = (a: Agg) => (a.count ? ((a.done / a.count) * 100).toFixed(1) : "0.0");
const won = (v?: number | null) => { const n = v ?? 0; return n >= 100_000_000 ? (n / 100_000_000).toFixed(2) + "억" : n >= 10_000 ? Math.round(n / 10_000).toLocaleString() + "만" : n.toLocaleString(); };

function Stats() {
  const asTypes = useAsTypes();
  const thisYear = new Date().getFullYear();
  const [regions, setRegions] = useState<Region[]>([]);
  const [tab, setTab] = useState<"count" | "cost" | "sat">("count");
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

  const delta = (a: number, b?: number) => {
    if (!b) return undefined;
    const p = ((a - b) / b) * 100;
    return `전년 대비 ${p >= 0 ? "▲" : "▼"} ${Math.abs(p).toFixed(1)}%`;
  };

  return (
    <>
      <div className="tabs" role="tablist" aria-label="통계 구분">
        {([["count", "AS건수 통계"], ["cost", "AS비용 통계"], ["sat", "만족도 관리"]] as const).map(([k, l]) => (
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
        <>
          <Kpis items={[
            [`${m.year}년 접수`, m.total.count.toLocaleString(), "건", delta(m.total.count, prev?.total.count)],
            ["처리완료", m.total.done.toLocaleString(), "건"],
            ["처리완료율", rate(m.total), "%"],
            ["평균 처리기간", num(m.total.avgDays), "일"],
          ]} />
          <div className="stg">
            <VBar title="월별 접수 건수" bars={m.months.map((x) => ({ label: `${x.month}월`, value: x.count, tip: `${m.year}년 ${x.month}월 · ${x.count.toLocaleString()}건 (완료 ${x.done})` }))} />
            <HBar title="구분별 접수 건수" bars={m.byType.filter((x) => x.count && asTypes.includes(x.rceptTy as RceptTy)).map((x) => ({ label: x.name, value: x.count }))} />
          </div>
          <AggTable title="지역별 처리 현황" name="지역" rows={m.byRegion.map((x) => ({ key: x.regionId, label: x.regionName, a: x }))} csv={`AS건수통계_지역별_${m.year}`} />
          <AggTable title="업체별 처리 현황" name="업체" score rows={m.byVendor.map((x) => ({ key: x.vendorId, label: x.vendorName, a: x }))} csv={`AS건수통계_업체별_${m.year}`} />
        </>
      ) : tab === "cost" ? (
        <>
          <Kpis items={[
            [`${m.year}년 AS 비용`, won(m.total.cost), "원", delta(m.total.cost, prev?.total.cost)],
            ["유상 청구", won(m.total.paidCost), "원", `${(m.total.paidCount ?? 0).toLocaleString()}건 · 학교에 별도 청구`],
            ["무상 처리", won(m.total.freeCost), "원", `${(m.total.freeCount ?? 0).toLocaleString()}건 · 계약·SLA 포함`],
            ["건당 평균 비용", m.total.done ? won(Math.round(m.total.cost / m.total.done)) : "-", "원"],
          ]} />
          <div className="stg">
            <VBar title="월별 AS 비용" unit="원" fmt={won} bars={m.months.map((x) => ({ label: `${x.month}월`, value: x.cost, tip: `${m.year}년 ${x.month}월 · ${x.cost.toLocaleString()}원 (유상 ${(x.paidCost ?? 0).toLocaleString()}원)` }))} />
            <HBar title="비용 항목별" unit="원" fmt={won} bars={(m.byCostType ?? []).filter((x) => x.amount).map((x) => ({ label: x.name, value: x.amount, tip: `${x.name} · ${x.amount.toLocaleString()}원 (${x.lines}줄, 유상 ${x.paidAmount.toLocaleString()}원)` }))} />
          </div>
          <div className="stg2">
            <HBar title="구분별 AS 비용" unit="원" fmt={won} bars={m.byType.filter((x) => asTypes.includes(x.rceptTy as RceptTy)).map((x) => ({ label: x.name, value: x.cost, tip: `${x.name} · ${x.cost.toLocaleString()}원 (유상 ${(x.paidCost ?? 0).toLocaleString()}원)` }))} />
            <CostTypeTable rows={m.byCostType ?? []} year={m.year} />
          </div>
          <AggTable title="지역별 AS 비용" name="지역" cost rows={m.byRegion.map((x) => ({ key: x.regionId, label: x.regionName, a: x }))} csv={`AS비용통계_지역별_${m.year}`} />
          <AggTable title="업체별 AS 비용" name="업체" cost rows={m.byVendor.map((x) => ({ key: x.vendorId, label: x.vendorName, a: x }))} csv={`AS비용통계_업체별_${m.year}`} />
        </>
      ) : !s ? <Loading /> : (
        <>
          <Kpis items={[
            ["평균 만족도", num(s.summary.avgScore, 2), "점", "5점 만점"],
            ["평가 건수", s.summary.evaluated.toLocaleString(), "건"],
            ["처리완료 건", s.summary.completed.toLocaleString(), "건"],
            ["평가 참여율", num(s.summary.responseRate), "%"],
          ]} />
          <div className="stg">
            <HBar title="만족도 분포" bars={[5, 4, 3, 2, 1].map((k) => ({ label: SCORE[k], value: s.summary.distribution[k] ?? 0 }))} />
            <HBar title="업체별 평균 만족도" unit="점" fmt={(n) => n.toFixed(2)} bars={s.byVendor.map((x) => ({ label: x.vendorName, value: x.avgScore ?? 0, tip: `${x.vendorName} · ${num(x.avgScore, 2)}점 (${x.count}건)` }))} />
          </div>
          <div className="glh"><span>기사별 만족도</span></div>
          <div className="tw">
            <table className="cards">
              <thead><tr><th scope="col">기사</th><th scope="col">업체</th><th scope="col">평가 건수</th><th scope="col">평균</th></tr></thead>
              <tbody>
                {s.byEngineer.length ? s.byEngineer.map((x) => (
                  <tr key={x.engineerUserId}><td data-label="기사">{x.engineerName}</td><td data-label="업체">{x.vendorName ?? "-"}</td><td data-label="평가 건수">{x.count}</td><td data-label="평균">{num(x.avgScore, 2)}</td></tr>
                )) : <tr><td colSpan={4}>평가 자료가 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="glh">
            <span>평가 목록 · 전체 <b>{s.list.totalElements}</b>건</span>
            <span className="glr">
              <button className="btn sm sec" type="button" disabled={!s.list.content.length}
                onClick={() => downloadCsv(`만족도_${q.year}_p${s.list.page}`, ["번호", "구분", "학교", "업체", "기사", "점수", "의견", "평가일"],
                  s.list.content.map((x) => [x.asvcSn, x.rceptTyName, x.schoolName, x.vendorName, x.engineerName, x.evalScore, x.evalOpinion, fmtDate(x.evaluatedAt)]))}>
                엑셀출력 <Icon name="down" />
              </button>
            </span>
          </div>
          <div className="tw">
            <table className="cards" style={{ minWidth: 760 }}>
              <thead><tr>{["접수번호", "구분", "학교", "업체 / 기사", "만족도", "의견", "평가일"].map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
              <tbody>
                {s.list.content.length ? s.list.content.map((x) => (
                  <tr key={x.asvcSn}>
                    <td data-label="접수번호">AS-{x.asvcSn}</td><td data-label="구분">{x.rceptTyName}</td><td data-label="학교">{x.schoolName ?? "-"}</td>
                    <td data-label="업체 / 기사">{x.vendorName ?? "-"} / {x.engineerName ?? "-"}</td>
                    <td data-label="만족도"><b className={"st " + (x.evalScore >= 4 ? "s1" : x.evalScore === 3 ? "s3" : "s4")}>{SCORE[x.evalScore]}</b></td>
                    <td data-label="의견" className="tl">{x.evalOpinion ?? ""}</td><td data-label="평가일">{fmtDate(x.evaluatedAt)}</td>
                  </tr>
                )) : <tr><td colSpan={7}>평가 자료가 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
          <Pager page={s.list.page} totalPages={s.list.totalPages} onPage={setSPage} />
        </>
      )}
    </>
  );
}

function AggTable({ title, name, rows, csv, cost, score }: { title: string; name: string; rows: { key: number; label: string; a: Agg }[]; csv: string; cost?: boolean; score?: boolean }) {
  const head = cost ? [name, "처리완료", "비용(원)", "유상 청구(원)", "건당 평균(원)"] : [name, "접수", "처리완료", "완료율", "평균 처리기간", ...(score ? ["평균 만족도"] : [])];
  const cells = (a: Agg) => cost
    ? [a.done.toLocaleString(), a.cost.toLocaleString(), (a.paidCost ?? 0).toLocaleString(), a.done ? Math.round(a.cost / a.done).toLocaleString() : "-"]
    : [a.count.toLocaleString(), a.done.toLocaleString(), rate(a) + "%", num(a.avgDays) + "일", ...(score ? [num(a.avgScore, 2)] : [])];
  return (
    <>
      <div className="glh">
        <span>{title}</span>
        <span className="glr">
          <button className="btn sm sec" type="button" disabled={!rows.length} onClick={() => downloadCsv(csv, head, rows.map((r) => [r.label, ...cells(r.a)]))}>엑셀출력 <Icon name="down" /></button>
        </span>
      </div>
      <div className="tw">
        <table className="cards">
          <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>
            {rows.length ? rows.map((r) => (
              <tr key={r.key}><td data-label={name}>{r.label}</td>{cells(r.a).map((c, i) => <td key={i} data-label={head[i + 1]}>{c}</td>)}</tr>
            )) : <tr><td colSpan={head.length}>자료가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** 비용 항목별 합계표. "항목 없음"은 비용 항목 없이 금액만 적은 예전 보고서. */
function CostTypeTable({ rows, year }: { rows: NonNullable<Monthly["byCostType"]>; year: number }) {
  const head = ["비용 항목", "줄 수", "금액(원)", "유상 청구(원)", "비율"];
  const total = rows.reduce((n, r) => n + r.amount, 0);
  const cells = (r: NonNullable<Monthly["byCostType"]>[number]) => [r.lines.toLocaleString(), r.amount.toLocaleString(), r.paidAmount.toLocaleString(), total ? ((r.amount / total) * 100).toFixed(1) + "%" : "-"];
  return (
    <div className="vtab">
      <div className="glh" style={{ margin: "0 0 8px" }}>
        <h4 style={{ margin: 0 }}>비용 항목별 합계</h4>
        <button className="btn sm sec" type="button" disabled={!rows.length} onClick={() => downloadCsv(`AS비용통계_항목별_${year}`, head, rows.map((r) => [r.name, ...cells(r)]))}>엑셀출력 <Icon name="down" /></button>
      </div>
      <div className="tw">
        <table className="cards">
          <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>
            {rows.some((r) => r.amount) ? rows.filter((r) => r.amount || r.lines).map((r) => (
              <tr key={r.costType}><td data-label="비용 항목">{r.name}</td>{cells(r).map((c, i) => <td key={i} data-label={head[i + 1]} className="num">{c}</td>)}</tr>
            )) : <tr><td colSpan={head.length}>자료가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
