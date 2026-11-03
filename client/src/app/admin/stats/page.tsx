"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { HBar, VBar } from "@/components/admin/charts";
import { FilterField, FilterForm, Kpis } from "@/components/admin/common";
import SubPage from "@/components/SubPage";
import { ErrorBox, Icon, Loading, NoticeBox, Pager } from "@/components/ui";
import { api, type Page } from "@/lib/api";
import { AS_NAME, useAsTypes } from "@/lib/as";
import { useAuth } from "@/lib/auth";
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

interface Agg {
  count: number; done: number; cost: number; paidCost?: number; avgDays?: number | null; avgScore?: number | null;
  /** 실제 지출 = 계약 배분(contractCost) + 유상 지급 완료(paidOut). */
  contractCost?: number; paidOut?: number; spend?: number;
}
interface BudgetRow { budgetId: number; regionName: string; rceptTyName: string; amount: number; spent: number; rate?: number | null; note?: string }
interface Monthly {
  year: number;
  // 유상/무상·비용 항목 필드는 비용 항목 기능 이전 서버에는 없다.
  total: Agg & { paidCost?: number; freeCost?: number; paidCount?: number; freeCount?: number; zeroCostDone?: number };
  billing?: Record<"BILLED" | "CONFIRMED" | "PAID", { name: string; count: number; amount: number }>;
  byCostType?: { costType: string; name: string; lines: number; amount: number; paidAmount: number }[];
  months: (Agg & { month: number; returned: number })[];
  byType: (Agg & { rceptTy: string; name: string })[];
  byRegion: (Agg & { regionId: number; regionName: string })[];
  byVendor: (Agg & { vendorId: number; vendorName: string })[];
  contracts?: { contractId: number; contractName: string; vendorName: string; startDate: string; endDate: string; amount: number; serviceTypeNames: string[]; allocated: number; done: number; perCase?: number | null }[];
  /** 업체 계정에는 없다. */
  budget?: { rows: BudgetRow[]; current?: number | null; spent: number; rate?: number | null; cumulative: number[] } | null;
}
interface Repairs {
  threshold: number;
  replaceCount: number;
  total: number;
  rows: { kind: "ASSET" | "DEVICE"; id: number; code?: string; name?: string; schoolName?: string; rceptTyName: string; repairs: number; cost: number; paidCost: number; price?: number | null; ratio?: number | null; acquiredAt?: string; lifeYears?: number | null; reasons: string[]; replace: boolean; lastAt?: string; lastAsvcSn: number }[];
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
  const { can } = useAuth();
  const thisYear = new Date().getFullYear();
  const [regions, setRegions] = useState<Region[]>([]);
  const [tab, setTab] = useState<"count" | "cost" | "sat">("count");
  const [draft, setDraft] = useState({ year: String(thisYear), rceptTy: "", regionId: "" });
  const [q, setQ] = useState(draft);
  const [m, setM] = useState<Monthly | null>(null);
  const [prev, setPrev] = useState<Monthly | null>(null);
  const [s, setS] = useState<Satisfaction | null>(null);
  const [rp, setRp] = useState<Repairs | null>(null);
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
  useEffect(() => {
    if (tab !== "cost") return;
    setRp(null);
    // 수리비 누적은 연도와 상관없이 전체 기간.
    api.get<Repairs>("/api/as/stats/repairs", { rceptTy: q.rceptTy, regionId: q.regionId }).then(setRp).catch(() => setRp({ threshold: 0.5, replaceCount: 0, total: 0, rows: [] }));
  }, [tab, q.rceptTy, q.regionId]);

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
        <CostTab m={m} prev={prev} rp={rp} asTypes={asTypes} canManage={can("COST_MANAGE")} delta={delta} />
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

const pct = (n?: number | null) => (n == null ? "-" : n.toFixed(1) + "%");

/**
 * AS비용 통계. 실제 지출 = 유지보수 계약(기간으로 나눈 몫) + 유상 청구 중 지급 완료. 보고서의 무상 금액은 계약 안에서 한 일을
 * 금액으로 환산한 값이라 지출이 아니다 — 따로 "계약 내 처리"로 보여 준다.
 */
function CostTab({ m, prev, rp, asTypes, canManage, delta }: {
  m: Monthly; prev: Monthly | null; rp: Repairs | null; asTypes: RceptTy[]; canManage: boolean; delta: (a: number, b?: number) => string | undefined;
}) {
  const t = m.total;
  const spend = t.spend ?? 0;
  const contracts = m.contracts ?? [];
  const b = m.billing;
  const budget = m.budget;
  const old = t.spend === undefined; // 계약·예산 기능 이전 서버
  return (
    <>
      <details className="cost-how">
        <summary>실제 지출은 어떻게 계산하나요?</summary>
        <ul className="dash">
          <li><b>실제 지출</b> = 유지보수 계약 금액 중 이 기간 몫 + 유상 청구 중 <b>지급 완료</b>된 금액.</li>
          <li>계약 금액은 계약 기간의 일수로 나눠 연·월에 배분합니다. 지역·구분으로 보면 계약이 맡은 지역 수·구분 수로 똑같이 나눕니다.</li>
          <li><b>계약 내 처리(무상)</b> 금액은 계약 안에서 한 일을 금액으로 환산한 값이라 지출에 넣지 않습니다.</li>
          <li>유상 청구는 업체 청구 → 학교 확인 → 지급 완료 순서로 진행되며, AS 상세에서 처리합니다.</li>
        </ul>
        {canManage && <p style={{ margin: "6px 0 0" }}><Link href="/admin/costs">계약·예산 관리</Link>에서 계약과 예산을 등록합니다.</p>}
      </details>
      {!old && !contracts.length && (
        <NoticeBox>
          {m.year}년에 등록된 유지보수 계약이 없어 실제 지출에 계약 금액이 빠져 있습니다.{" "}
          {canManage ? <Link href="/admin/costs">계약 등록하기</Link> : "도교육청 담당자에게 계약 등록을 요청해 주세요."}
        </NoticeBox>
      )}
      <Kpis items={[
        [`${m.year}년 실제 지출`, won(spend), "원", delta(spend, prev?.total.spend) ?? `계약 ${won(t.contractCost)} + 유상 지급 ${won(t.paidOut)}`],
        ["유지보수 계약", won(t.contractCost), "원", contracts.length ? `계약 ${contracts.length}건의 ${m.year}년 몫` : "등록된 계약 없음"],
        ["유상 청구", won(t.paidCost), "원", b ? `청구 ${b.BILLED.count} · 확인 ${b.CONFIRMED.count} · 지급 ${b.PAID.count}건` : `${(t.paidCount ?? 0).toLocaleString()}건`],
        budget
          ? ["예산 집행률", budget.rate == null ? "-" : budget.rate.toFixed(1), budget.rate == null ? "" : "%", budget.current ? `예산 ${won(budget.current)}원 중` : "이 조건의 예산 미설정"]
          : ["건당 실제 비용", t.done ? won(Math.round(spend / t.done)) : "-", t.done ? "원" : "", `처리완료 ${t.done.toLocaleString()}건 기준`],
      ]} />
      <Kpis items={[
        ["계약 내 처리(무상)", won(t.freeCost), "원", `${(t.freeCount ?? 0).toLocaleString()}건 · 환산 금액, 지출 아님`],
        ...(budget ? [["건당 실제 비용", t.done ? won(Math.round(spend / t.done)) : "-", t.done ? "원" : "", `처리완료 ${t.done.toLocaleString()}건 기준`] as [string, string, string, string]] : []),
        ["비용 0원 처리완료", t.done ? ((((t.zeroCostDone ?? 0) / t.done) * 100).toFixed(0)) : "-", t.done ? "%" : "", `${(t.zeroCostDone ?? 0).toLocaleString()}건 · 금액 입력 누락일 수 있음`],
        ["교체 검토 장비", rp ? rp.replaceCount.toLocaleString() : "…", "대", `수리비 ≥ 취득가 ${Math.round((rp?.threshold ?? 0.5) * 100)}% 또는 내용연수 경과`],
      ]} />
      <div className="stg">
        <VBar title="월별 실제 지출" unit="원" fmt={won} bars={m.months.map((x) => ({
          label: `${x.month}월`, value: x.spend ?? 0,
          tip: `${m.year}년 ${x.month}월 · ${(x.spend ?? 0).toLocaleString()}원 (계약 ${(x.contractCost ?? 0).toLocaleString()} + 유상 지급 ${(x.paidOut ?? 0).toLocaleString()})`,
        }))} />
        {budget?.current ? (
          <VBar title={`예산 대비 누계 (예산 ${won(budget.current)}원)`} unit="원" fmt={won} bars={budget.cumulative.map((v, i) => ({
            // 반쪽 폭 차트라 "월"을 빼야 10·11·12월 라벨이 줄바꿈되지 않는다.
            label: String(m.months[i]?.month ?? i + 1), value: v, tip: `${m.months[i]?.month ?? i + 1}월까지 ${v.toLocaleString()}원 · 예산의 ${((v / budget.current!) * 100).toFixed(1)}%`,
          }))} />
        ) : (
          <HBar title="구분별 실제 지출" unit="원" fmt={won} bars={m.byType.filter((x) => asTypes.includes(x.rceptTy as RceptTy)).map((x) => ({
            label: x.name, value: x.spend ?? 0, tip: `${x.name} · ${(x.spend ?? 0).toLocaleString()}원 (계약 ${(x.contractCost ?? 0).toLocaleString()} + 유상 지급 ${(x.paidOut ?? 0).toLocaleString()})`,
          }))} />
        )}
      </div>
      {budget && <BudgetTable rows={budget.rows} year={m.year} canManage={canManage} />}
      <ContractTable rows={contracts} year={m.year} />
      <div className="stg2">
        <BillingTable billing={b} />
        <CostTypeTable rows={m.byCostType ?? []} year={m.year} />
      </div>
      <AggTable title="지역별 AS 비용" name="지역" cost rows={m.byRegion.map((x) => ({ key: x.regionId, label: x.regionName, a: x }))} csv={`AS비용통계_지역별_${m.year}`} />
      <AggTable title="업체별 AS 비용" name="업체" cost rows={m.byVendor.map((x) => ({ key: x.vendorId, label: x.vendorName, a: x }))} csv={`AS비용통계_업체별_${m.year}`} />
      <RepairTable rp={rp} />
    </>
  );
}

function TableHead({ title, csv, head, rows, children }: { title: string; csv?: string; head?: string[]; rows?: (string | number)[][]; children?: React.ReactNode }) {
  return (
    <div className="glh">
      <span>{title}</span>
      <span className="glr">
        {children}
        {csv && head && rows && <button className="btn sm sec" type="button" disabled={!rows.length} onClick={() => downloadCsv(csv, head, rows)}>엑셀출력 <Icon name="down" /></button>}
      </span>
    </div>
  );
}

/** 예산 줄마다 집행액·집행률. */
function BudgetTable({ rows, year, canManage }: { rows: BudgetRow[]; year: number; canManage: boolean }) {
  const head = ["지역", "구분", "예산(원)", "집행(원)", "잔액(원)", "집행률"];
  const cells = (r: BudgetRow) => [r.regionName, r.rceptTyName, r.amount.toLocaleString(), r.spent.toLocaleString(), (r.amount - r.spent).toLocaleString(), pct(r.rate)];
  return (
    <>
      <TableHead title={`${year}년 예산 집행 현황`} csv={`AS예산집행_${year}`} head={head} rows={rows.map(cells)}>
        {canManage && <Link className="btn sm sec" href="/admin/costs?tab=budget">예산 설정</Link>}
      </TableHead>
      <div className="tw">
        <table className="cards">
          <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>
            {rows.length ? rows.map((r) => (
              <tr key={r.budgetId}>
                {cells(r).slice(0, 5).map((c, i) => <td key={i} data-label={head[i]} className={i > 1 ? "num" : undefined}>{c}</td>)}
                <td data-label="집행률">
                  <span className={"bgt" + ((r.rate ?? 0) > 100 ? " over" : "")}>
                    <span className="bgt-bar" aria-hidden="true"><b style={{ width: `${Math.min(100, r.rate ?? 0)}%` }}></b></span>
                    {pct(r.rate)}
                  </span>
                </td>
              </tr>
            )) : <tr><td colSpan={head.length}>{year}년 예산이 없습니다.{canManage ? " 예산 설정에서 입력하면 집행률이 나옵니다." : ""}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** 계약별: 올해 배분액과 그 업체가 계약 범위에서 처리완료한 건수 → 건당 실제 비용. */
function ContractTable({ rows, year }: { rows: NonNullable<Monthly["contracts"]>; year: number }) {
  const head = ["계약", "업체", "구분", "계약 기간", "계약 금액(원)", `${year}년 배분(원)`, "처리완료", "건당 비용(원)"];
  const cells = (r: (typeof rows)[number]) => [r.contractName, r.vendorName, r.serviceTypeNames.join(", "), `${r.startDate} ~ ${r.endDate}`,
    r.amount.toLocaleString(), r.allocated.toLocaleString(), r.done.toLocaleString(), r.perCase == null ? "-" : r.perCase.toLocaleString()];
  return (
    <>
      <TableHead title="계약별 실적" csv={`AS계약실적_${year}`} head={head} rows={rows.map(cells)} />
      <div className="tw">
        <table className="cards">
          <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>
            {rows.length ? rows.map((r) => (
              <tr key={r.contractId}>{cells(r).map((c, i) => <td key={i} data-label={head[i]} className={i === 0 ? "tl" : i > 3 ? "num" : undefined}>{c}</td>)}</tr>
            )) : <tr><td colSpan={head.length}>이 기간에 해당하는 계약이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function BillingTable({ billing }: { billing?: Monthly["billing"] }) {
  const keys = ["BILLED", "CONFIRMED", "PAID"] as const;
  return (
    <div className="vtab">
      <div className="glh" style={{ margin: "0 0 8px" }}><h4 style={{ margin: 0 }}>유상 청구 진행</h4></div>
      <div className="tw">
        <table className="cards">
          <thead><tr><th scope="col">단계</th><th scope="col">건수</th><th scope="col">금액(원)</th></tr></thead>
          <tbody>
            {billing ? keys.map((k) => (
              <tr key={k}><td data-label="단계">{billing[k].name}</td><td data-label="건수" className="num">{billing[k].count.toLocaleString()}</td><td data-label="금액(원)" className="num">{billing[k].amount.toLocaleString()}</td></tr>
            )) : <tr><td colSpan={3}>자료가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ margin: "6px 0 0" }}>지급 완료만 실제 지출에 들어갑니다. 청구·확인 단계는 AS 상세에서 처리합니다.</p>
    </div>
  );
}

/** 장비별 누적 수리비 (모든 연도). 교체 검토 대상을 위로. */
function RepairTable({ rp }: { rp: Repairs | null }) {
  const head = ["장비", "학교", "구분", "수리 횟수", "누적 수리비(원)", "취득가(원)", "취득가 대비", "판단"];
  const cells = (r: Repairs["rows"][number]) => [`${r.code ? r.code + " " : ""}${r.name ?? "-"}`, r.schoolName ?? "-", r.rceptTyName, r.repairs.toLocaleString(),
    r.cost.toLocaleString(), r.price == null ? "-" : r.price.toLocaleString(), r.ratio == null ? "-" : Math.round(r.ratio * 100) + "%",
    r.replace ? "교체 검토 · " + r.reasons.join(", ") : r.kind === "DEVICE" ? "취득가 정보 없음" : "-"];
  return (
    <>
      <TableHead title={`장비별 누적 수리비${rp ? ` · ${rp.total.toLocaleString()}대` : ""}`} csv="AS장비별수리비" head={head} rows={(rp?.rows ?? []).map(cells)} />
      {!rp ? <Loading /> : (
        <div className="tw">
          <table className="cards">
            <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
            <tbody>
              {rp.rows.length ? rp.rows.map((r) => (
                <tr key={r.kind + r.id} className={r.replace ? "rp-warn" : undefined}>
                  {cells(r).map((c, i) => <td key={i} data-label={head[i]} className={i === 0 || i === 7 ? "tl" : i > 2 && i < 7 ? "num" : undefined}>{i === 7 && r.replace ? <b>{c}</b> : c}</td>)}
                </tr>
              )) : <tr><td colSpan={head.length}>AS 신청에 장비(자산·무선장비)가 연결되고 비용이 입력된 처리 건이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint" style={{ margin: "6px 0 0" }}>모든 연도 합계입니다. 수리비는 무상(계약 내) 환산 금액도 포함합니다 — 교체가 나은지는 들어간 수리 가치 전체로 판단합니다.</p>
    </>
  );
}

function AggTable({ title, name, rows, csv, cost, score }: { title: string; name: string; rows: { key: number; label: string; a: Agg }[]; csv: string; cost?: boolean; score?: boolean }) {
  const head = cost
    ? [name, "처리완료", "계약 배분(원)", "유상 지급(원)", "실제 지출(원)", "건당 실제 비용(원)", "유상 청구(원)", "보고서 금액(원)"]
    : [name, "접수", "처리완료", "완료율", "평균 처리기간", ...(score ? ["평균 만족도"] : [])];
  const cells = (a: Agg) => cost
    ? [a.done.toLocaleString(), (a.contractCost ?? 0).toLocaleString(), (a.paidOut ?? 0).toLocaleString(), (a.spend ?? 0).toLocaleString(),
      a.done ? Math.round((a.spend ?? 0) / a.done).toLocaleString() : "-", (a.paidCost ?? 0).toLocaleString(), a.cost.toLocaleString()]
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
