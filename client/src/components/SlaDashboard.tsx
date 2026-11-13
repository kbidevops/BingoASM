"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AsDetailModal from "./AsDetailModal";
import { FilterField } from "./admin/common";
import { ErrorBox, FormMsg, Icon, Loading, Modal, useToast } from "./ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { loadRegions } from "@/lib/boards";
import { fmtDateTime } from "@/lib/format";
import type { Region } from "@/lib/types";

/** /api/as/sla 응답. 값이 없으면(판정할 건 없음) 키가 빠진다. */
interface Targets {
  receiveMin: number; visitMin: number; recoverFullMin: number; recoverPartialMin: number; availabilityPct: number; isDefault?: boolean; updatedAt?: string;
  /** 단계마다 근무 시간으로 세는가 (false = 24시간). 가용률은 늘 24시간. */
  receiveBiz?: boolean; visitBiz?: boolean; recoverBiz?: boolean;
  /** 근무 시간 달력 요약 ("월~금 09:00~18:00 · 휴일 12일") */
  calendar?: string;
}
/** "(24시간)" · "(근무 시간)" */
const how = (biz?: boolean) => (biz ? "근무 시간" : "24시간");
interface Agg {
  total: number; completed: number; open: number; met: number; missed: number; pending: number; metRate?: number;
  avgReceiveMin?: number; avgVisitMin?: number; avgRecoverMin?: number; receiveMissed: number; visitMissed: number; recoverMissed: number;
}
/** NO_RECORD = 현장 도착을 기록하지 않고 처리완료 (판정 안 함), legacy = 이 기능 전의 자료 */
interface Step { state: "MET" | "MISSED" | "PENDING" | "NO_RECORD"; minutes?: number; target: number; done?: boolean; legacy?: boolean }
/** 넘기기 전 통신사 구간의 접수 */
interface Prior { vendorName: string; minutes: number; target: number; received: boolean; missed: boolean }
interface Line {
  deviceId: number; deviceCode: string; deviceName?: string; circuitId?: string; carrier?: string; bandwidth?: string; schoolName?: string; regionName?: string;
  failures: number; downtimeMin: number; availability: number; belowTarget: boolean;
}
interface Violation {
  asvcSn: number; schoolName?: string; regionName?: string; vendorName: string; faultTypeName?: string; fullOutage?: boolean; requestAt: string;
  status: string; statusName: string; receive: Step; visit: Step; recover: Step; missed: string[];
  handoverAt?: string; prior?: Prior[];
}
interface FlowWarning { key: string; level: "warn" | "info"; text: string }
interface TrendPt { year: number; month: number; total: number; missed: number; metRate?: number }
interface Sla {
  year: number; month: number; targets: Targets; canEdit: boolean;
  summary: Agg & { prevTotal: number; prevMetRate?: number };
  byVendor: (Agg & { vendorId?: number; vendorName: string; handoffMissed?: number })[];
  /** 교육지원청 · 교육청이 직접 처리한 건 (통신사 SLA 제외) + 통신사에 넘기기 전 1차 확인 시간 */
  office?: Agg & { triageCount: number; triageAvgMin?: number; triageMaxMin?: number };
  flowWarnings?: FlowWarning[];
  byRegion: (Agg & { regionId?: number; regionName: string })[];
  lines: Line[];
  lineSummary: { lineCount: number; failedLines: number; belowTarget: number; totalDowntimeMin: number };
  trend: TrendPt[];
  violations: Violation[];
  quality?: Quality;
}
interface QReq { asvcSn: number; requestAt?: string; status: string; schoolName?: string; symptom?: string }
interface QLine { deviceId: number; deviceCode: string; deviceName?: string; schoolName?: string; carrier?: string; circuitId?: string }
interface Quality {
  unlinked: { count: number; rows: QReq[] };
  noOutageTime: { count: number; rows: QReq[] };
  lineNoCircuit: { count: number; rows: QLine[] };
  lineNoVendor: { count: number; rows: QLine[] };
  noArrival?: { count: number; legacy: number; rows: (QReq & { legacy?: boolean })[] };
}

/** 충족률 목표 (업체 · 지역 표의 색 기준과 같다) */
const MET_GOAL = 95;

/** 분 → "45분" · "2시간 15분" · "1일 3시간" */
export function dur(m?: number | null) {
  if (m == null) return "-";
  if (m < 60) return `${m}분`;
  if (m < 1440) return `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ""}`;
  const h = Math.floor((m % 1440) / 60);
  return `${Math.floor(m / 1440)}일${h ? ` ${h}시간` : ""}`;
}
const pct = (v?: number | null) => (v == null ? "-" : `${v.toFixed(1)}`);
const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

const SECTIONS: [string, string][] = [["sla-sum", "요약"], ["sla-trend", "추이"], ["sla-vendor", "업체"], ["sla-region", "지역"], ["sla-office", "직접 처리"], ["sla-lines", "회선"], ["sla-q", "점검"], ["sla-v", "위반"]];
const STAGES = ["접수", "현장 도착", "복구", "넘기기 전 접수"] as const;
/** 업체 · 지역 표의 '없음' 행으로 거를 때 */
const NONE = "__none";

/**
 * 스쿨넷 SLA 현황: 교육청이 정한 SLA 기준(접수 · 현장 도착 · 복구 시간, 회선 가용률)에 스쿨넷 AS가 얼마나 맞았는지.
 * 학교는 자기 학교, 교육지원청은 관할 지역만 집계된다 (서버가 정한다).
 */
export default function SlaDashboard() {
  const { me } = useAuth();
  const [regions, setRegions] = useState<Region[]>([]);
  const [draft, setDraft] = useState({ ym: thisMonth(), regionId: "" });
  const [q, setQ] = useState(draft);
  const [d, setD] = useState<Sla | null>(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [edit, setEdit] = useState(false);
  // 위반 내역 거르기 (업체 · 지역 표의 행을 눌러도 바뀐다)
  const [vf, setVf] = useState<{ stage: string; ongoing: boolean; vendor: string; region: string }>({ stage: "", ongoing: false, vendor: "", region: "" });
  const toast = useToast();

  useEffect(() => {
    // 학교 계정은 지역을 고를 일이 없다.
    if (me?.schoolId) return;
    loadRegions().then(setRegions).catch(() => {});
  }, [me?.schoolId]);

  const query = useCallback(() => {
    const [y, m] = q.ym.split("-").map(Number);
    return { year: y, month: m, regionId: q.regionId || undefined };
  }, [q]);
  const load = useCallback(() => {
    setErr("");
    setD(null);
    setVf({ stage: "", ongoing: false, vendor: "", region: "" });
    api.get<Sla>("/api/as/sla", query()).then(setD).catch((e) => setErr((e as Error).message));
  }, [query]);
  useEffect(load, [load]);

  const excel = () => {
    const x = query();
    api.download("/api/as/sla/excel", x, `스쿨넷_SLA_보고서_${x.year}-${String(x.month).padStart(2, "0")}.xlsx`).catch((e) => toast((e as Error).message));
  };
  const showViolations = (patch: Partial<typeof vf>) => { setVf({ stage: "", ongoing: false, vendor: "", region: "", ...patch }); setTimeout(() => go("sla-v"), 0); };

  // '업체 없음' · '지역 없음' 행은 이름이 위반 내역과 다르다 (미배정 등): 이름 있는 업체 · 지역이 아닌 건으로 맞춘다.
  const violations = useMemo(() => {
    const vendors = new Set((d?.byVendor ?? []).filter((x) => x.vendorId != null).map((x) => x.vendorName));
    const regions = new Set((d?.byRegion ?? []).filter((x) => x.regionId != null).map((x) => x.regionName));
    return (d?.violations ?? []).filter((v) =>
      (!vf.stage || v.missed.includes(vf.stage)) && (!vf.ongoing || v.status !== "C")
      && (!vf.vendor || (vf.vendor === NONE ? !vendors.has(v.vendorName) : v.vendorName === vf.vendor))
      && (!vf.region || (vf.region === NONE ? !regions.has(v.regionName ?? "") : v.regionName === vf.region)));
  }, [d, vf]);

  const qIssues = d?.quality ? d.quality.unlinked.count + d.quality.noOutageTime.count + d.quality.lineNoCircuit.count + d.quality.lineNoVendor.count + (d.quality.noArrival?.count ?? 0) : 0;

  return (
    <div className="sla">
      <form className="glf" role="search" onSubmit={(e) => { e.preventDefault(); setQ(draft); }}>
        <FilterField id="sla-ym" label="기간">
          <input id="sla-ym" type="month" value={draft.ym} max={thisMonth()} onChange={(e) => setDraft({ ...draft, ym: e.target.value || thisMonth() })} />
        </FilterField>
        {regions.length > 1 && (
          <FilterField id="sla-r" label="지역">
            <select id="sla-r" value={draft.regionId} onChange={(e) => setDraft({ ...draft, regionId: e.target.value })}>
              <option value="">전체</option>
              {regions.map((r) => <option key={r.regionId} value={r.regionId}>{r.regionName}</option>)}
            </select>
          </FilterField>
        )}
        <div className="glb sla-act">
          <button className="btn sm" type="submit">조회</button>
          {d?.canEdit && <button type="button" className="btn sm sec" onClick={() => setEdit(true)}>기준 설정</button>}
          {d && <button type="button" className="btn sm sky" onClick={excel}>월간 보고서 (엑셀) <Icon name="down" /></button>}
        </div>
      </form>

      {err ? <ErrorBox message={err} onRetry={load} /> : !d ? <Loading /> : (
        <>
          <p className="sla-tgl">
            <b>SLA 기준</b>
            <span>접수 {dur(d.targets.receiveMin)} <Clock biz={d.targets.receiveBiz} /></span>
            <span>도착 {dur(d.targets.visitMin)} <Clock biz={d.targets.visitBiz} /></span>
            <span>복구 {dur(d.targets.recoverFullMin)} (전체) · {dur(d.targets.recoverPartialMin)} (일부) <Clock biz={d.targets.recoverBiz} /></span>
            <span>가용률 {d.targets.availabilityPct}% <Clock /></span>
            {(d.targets.receiveBiz || d.targets.visitBiz || d.targets.recoverBiz) && d.targets.calendar && <span title="알림 기준 · 근무 시간 달력과 같습니다">근무 시간: {d.targets.calendar}</span>}
            <span>충족률 목표 {MET_GOAL}%</span>
            {d.targets.isDefault ? <span className="um-pill warn">기본값 — 계약 기준으로 바꿔 주세요</span> : <small className="hint">최종 수정 {fmtDateTime(d.targets.updatedAt)}</small>}
          </p>

          <FlowWarnings list={d.flowWarnings} canEdit={d.canEdit} />

          <nav className="sla-nav" aria-label="SLA 화면 구역">
            {SECTIONS.filter(([id]) => (id !== "sla-region" || d.byRegion.length > 1) && (id !== "sla-office" || hasOffice(d))).map(([id, l]) => (
              <a key={id} href={`#${id}`} onClick={(e) => { e.preventDefault(); go(id); }}>
                {l}
                {id === "sla-q" && qIssues > 0 && <span className="sla-nav-n warn">{qIssues}</span>}
                {id === "sla-v" && d.violations.length > 0 && <span className="sla-nav-n">{d.violations.length}</span>}
              </a>
            ))}
          </nav>

          {qIssues > 0 && (
            <div className="sla-qwarn" role="note">
              <span aria-hidden="true">⚠</span>
              <span>데이터 점검 <b>{qIssues}</b>건 — 회선 미지정 · 장애 시각 미입력이 있으면 가용률 · 복구 시간이 실제와 다를 수 있습니다.</span>
              <button type="button" className="linkbtn" onClick={() => go("sla-q")}>점검 항목 보기</button>
            </div>
          )}

          <section id="sla-sum" className="sla-sec" aria-label="요약">
            <SummaryCards d={d} onViolations={() => showViolations({})} />
          </section>

          <section id="sla-trend" className="sla-sec" aria-labelledby="sla-trend-t">
            <h2 id="sla-trend-t" className="sla-h">최근 12개월 추이</h2>
            <Trend pts={d.trend} goal={MET_GOAL} />
          </section>

          <section id="sla-vendor" className="sla-sec" aria-labelledby="sla-vendor-t">
            <h2 id="sla-vendor-t" className="sla-h">업체(통신사)별 SLA <small>행을 누르면 그 업체의 위반 내역</small></h2>
            <AggTable name="업체" rows={d.byVendor.map((x) => ({ key: String(x.vendorId ?? "none"), label: x.vendorName, a: x, handoff: x.handoffMissed }))}
              onPick={(label, key) => showViolations({ vendor: key === "none" ? NONE : label })} />
            {d.byVendor.some((x) => x.handoffMissed) && <p className="hint sla-note">&lsquo;넘기기 전 위반&rsquo;: 그 업체가 맡았다가 접수하지 않고(또는 늦게 접수하고) 다른 담당으로 넘어간 건. 새 담당의 시간에는 넣지 않고 원래 업체에 남깁니다.</p>}
          </section>
          {d.byRegion.length > 1 && (
            <section id="sla-region" className="sla-sec" aria-labelledby="sla-region-t">
              <h2 id="sla-region-t" className="sla-h">지역별 SLA <small>행을 누르면 그 지역의 위반 내역</small></h2>
              <AggTable name="지역" rows={d.byRegion.map((x) => ({ key: String(x.regionId ?? "none"), label: x.regionName, a: x }))}
                onPick={(label, key) => showViolations({ region: key === "none" ? NONE : label })} />
            </section>
          )}

          {hasOffice(d) && d.office && <OfficeBlock o={d.office} />}

          <section id="sla-lines" className="sla-sec" aria-labelledby="sla-lines-t">
            <h2 id="sla-lines-t" className="sla-h">회선별 가용률 <small>장애가 난 회선 {d.lines.length}개 / 전체 {d.lineSummary.lineCount}개 · 낮은 순</small></h2>
            <Lines lines={d.lines} goal={d.targets.availabilityPct} />
            <p className="hint sla-note">가용률은 스쿨넷 AS에 지정된 회선(장비)의 장애 시간으로 계산합니다: 실제 장애 시각을 입력했으면 그 시각, 아니면 신청 → 처리완료(진행 중이면 지금까지). 같은 회선의 겹치는 신고는 한 번만 셉니다. 회선이 지정되지 않은 신고는 회선별에서 빠집니다.</p>
          </section>

          {d.quality && (
            <section id="sla-q" className="sla-sec" aria-labelledby="sla-q-t">
              <h2 id="sla-q-t" className="sla-h">데이터 점검</h2>
              <QualityPanel q={d.quality} onOpen={setOpen} />
            </section>
          )}

          <section id="sla-v" className="sla-sec" aria-labelledby="sla-v-t">
            <h2 id="sla-v-t" className="sla-h">SLA 위반 내역 <small>{violations.length === d.violations.length ? `${d.violations.length}건` : `${violations.length}건 / 전체 ${d.violations.length}건`}</small></h2>
            <ViolationFilter d={d} vf={vf} setVf={setVf} />
            <Violations rows={violations} t={d.targets} total={d.violations.length} onOpen={setOpen} />
          </section>

          {open && <AsDetailModal sn={open} onClose={() => setOpen(null)} onChanged={load} />}
          {edit && <TargetForm t={d.targets} warnings={d.flowWarnings?.filter((w) => w.level === "warn")} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); toast("SLA 기준을 저장했습니다."); load(); }} />}
        </>
      )}
    </div>
  );
}

/* ---------- 요약 카드: 목표 대비 색 · 지난달 대비 화살표 · 누르면 해당 구역 ---------- */

function Delta({ now, prev, unit, goodUp }: { now?: number | null; prev?: number | null; unit: string; goodUp: boolean }) {
  if (now == null || prev == null) return null;
  const diff = Math.round((now - prev) * 10) / 10;
  if (diff === 0) return <span className="sla-dl">지난달과 같음</span>;
  const good = goodUp ? diff > 0 : diff < 0;
  return <span className={"sla-dl " + (good ? "good" : "bad")}>{diff > 0 ? "▲" : "▼"} {Math.abs(diff)}{unit} <small>지난달 대비</small></span>;
}

function SummaryCards({ d, onViolations }: { d: Sla; onViolations: () => void }) {
  const s = d.summary;
  const rateTone = s.metRate == null ? "" : s.metRate >= MET_GOAL ? " good" : " bad";
  const recoverOver = s.avgRecoverMin != null && s.avgRecoverMin > d.targets.recoverPartialMin;
  return (
    <div className="sla-kpi">
      <div className="sla-k">
        <span className="sla-kl">{d.month}월 장애</span>
        <b className="sla-kv">{s.total.toLocaleString()}<small>건</small></b>
        <Delta now={s.total} prev={s.prevTotal} unit="건" goodUp={false} />
        <small className="sla-ks">진행 중 {s.open}건</small>
      </div>
      <div className={"sla-k" + rateTone}>
        <span className="sla-kl">SLA 충족률</span>
        <b className="sla-kv">{pct(s.metRate)}{s.metRate != null && <small>%</small>}</b>
        {s.metRate == null ? <small className="sla-ks">판정할 건이 없습니다</small> : <Delta now={s.metRate} prev={s.prevMetRate} unit="%p" goodUp />}
        <small className="sla-ks">목표 {MET_GOAL}% 이상</small>
      </div>
      <button type="button" className={"sla-k link" + (s.missed ? " bad" : " good")} onClick={onViolations} disabled={!s.missed}>
        <span className="sla-kl">위반</span>
        <b className="sla-kv">{s.missed.toLocaleString()}<small>건</small></b>
        <small className="sla-ks">접수 {s.receiveMissed} · 도착 {s.visitMissed} · 복구 {s.recoverMissed}</small>
        {s.missed > 0 && <small className="sla-go">위반 내역 보기 →</small>}
      </button>
      <div className={"sla-k" + (recoverOver ? " bad" : "")}>
        <span className="sla-kl">평균 복구</span>
        <b className="sla-kv sm">{dur(s.avgRecoverMin)}</b>
        <small className="sla-ks">평균 접수 {dur(s.avgReceiveMin)}</small>
        <small className="sla-ks">평균 도착 {dur(s.avgVisitMin)}</small>
      </div>
      <button type="button" className={"sla-k link" + (d.lineSummary.belowTarget ? " bad" : " good")} onClick={() => go("sla-lines")}>
        <span className="sla-kl">가용률 미달 회선</span>
        <b className="sla-kv">{d.lineSummary.belowTarget}<small>/ {d.lineSummary.lineCount}</small></b>
        <small className="sla-ks">목표 {d.targets.availabilityPct}% · 장애 회선 {d.lineSummary.failedLines}</small>
        <small className="sla-ks">누적 장애 {dur(d.lineSummary.totalDowntimeMin)}</small>
      </button>
    </div>
  );
}

/* ---------- 12개월 추이: 같은 달 축을 쓰는 두 칸 (위: 충족률 선 + 목표선, 아래: 장애 건수 막대 중 위반) ---------- */

function Trend({ pts, goal }: { pts: TrendPt[]; goal: number }) {
  const [hi, setHi] = useState<number | null>(null);
  // 좁은 화면에서는 차트가 옆으로 스크롤된다: 최근 달이 보이도록 오른쪽 끝에서 시작
  const fig = useRef<HTMLElement>(null);
  useEffect(() => { if (fig.current) fig.current.scrollLeft = fig.current.scrollWidth; }, [pts]);
  const W = 720, L = 40, R = 12, n = pts.length || 1;
  const step = (W - L - R) / n;
  const cx = (i: number) => L + step * i + step / 2;
  // 위 칸: 충족률 0~100
  const RT = 24, RH = 120;
  const ry = (v: number) => RT + RH - (v / 100) * RH;
  // 아래 칸: 장애 건수
  const BT = RT + RH + 44, BH = 80;
  const maxN = Math.max(1, ...pts.map((p) => p.total));
  const top = maxN <= 4 ? maxN : Math.ceil(maxN / 4) * 4;
  const by = (v: number) => BT + BH - (v / top) * BH;
  const H = BT + BH + 34;
  const bw = Math.min(22, step * 0.5);
  // 장애가 없던 달은 선을 끊는다 (0%로 그리지 않는다)
  const segs: string[] = [];
  let cur = "";
  pts.forEach((p, i) => {
    if (p.metRate == null) { if (cur) segs.push(cur); cur = ""; return; }
    cur += `${cur ? "L" : "M"}${cx(i).toFixed(1)},${ry(p.metRate).toFixed(1)}`;
  });
  if (cur) segs.push(cur);
  const h = hi == null ? null : pts[hi];

  return (
    <figure className="sla-tr" ref={fig}>
      <ul className="sla-tr-lg" aria-hidden="true">
        <li><i className="ln" /> 충족률</li>
        <li><i className="tg" /> 목표 {goal}%</li>
        <li><i className="bk ok" /> 장애 (충족 · 진행 중)</li>
        <li><i className="bk miss" /> 위반</li>
      </ul>
      <div className="sla-tr-w" onMouseLeave={() => setHi(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`최근 12개월: ${pts.map((p) => `${p.month}월 장애 ${p.total}건 위반 ${p.missed}건 충족률 ${p.metRate == null ? "없음" : p.metRate + "%"}`).join(", ")}`}>
          {/* 충족률 칸 */}
          <text x={L} y={RT - 12} className="ax">충족률 (%)</text>
          {[0, 50, 100].map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={ry(t)} y2={ry(t)} className="gd" />
              <text x={L - 6} y={ry(t) + 4} className="ax" textAnchor="end">{t}</text>
            </g>
          ))}
          <line x1={L} x2={W - R} y1={ry(goal)} y2={ry(goal)} className="tgl" />
          {hi != null && <rect x={L + step * hi} y={RT - 6} width={step} height={H - RT - 20} className="hv" />}
          {segs.map((s, i) => <path key={i} d={s} className="ln" />)}
          {pts.map((p, i) => p.metRate == null
            ? (p.total === 0 ? <text key={i} x={cx(i)} y={ry(0) - 8} className="none" textAnchor="middle">장애 없음</text> : null)
            : <circle key={i} cx={cx(i)} cy={ry(p.metRate)} r={hi === i ? 5.5 : 4} className={"pt" + (p.metRate >= goal ? "" : " miss")} />)}
          {/* 장애 건수 칸 */}
          <text x={L} y={BT - 12} className="ax">장애 건수 (건)</text>
          {[0, top / 2, top].map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={by(t)} y2={by(t)} className="gd" />
              <text x={L - 6} y={by(t) + 4} className="ax" textAnchor="end">{Number.isInteger(t) ? t : ""}</text>
            </g>
          ))}
          {pts.map((p, i) => {
            if (!p.total) return null;
            const ok = p.total - p.missed, x = cx(i) - bw / 2;
            return (
              <g key={i}>
                {ok > 0 && <rect x={x} y={by(ok)} width={bw} height={Math.max(0, by(0) - by(ok))} rx={p.missed ? 0 : 3} className="bk ok" />}
                {p.missed > 0 && <rect x={x} y={by(p.total)} width={bw} height={Math.max(1, by(ok) - by(p.total) - (ok ? 2 : 0))} rx={3} className="bk miss" />}
              </g>
            );
          })}
          {pts.map((p, i) => (
            <g key={i}>
              <text x={cx(i)} y={BT + BH + 16} className={"ax mo" + (hi === i ? " on" : "")} textAnchor="middle">{p.month}월</text>
              {(i === 0 || p.month === 1) && <text x={cx(i)} y={BT + BH + 30} className="ax yr" textAnchor="middle">{p.year}</text>}
              <rect x={L + step * i} y={0} width={step} height={H} className="hit" onMouseEnter={() => setHi(i)} onFocus={() => setHi(i)} onBlur={() => setHi(null)} tabIndex={0}
                aria-label={`${p.year}년 ${p.month}월: 장애 ${p.total}건, 위반 ${p.missed}건, 충족률 ${p.metRate == null ? "판정할 건 없음" : p.metRate + "%"}`} />
            </g>
          ))}
        </svg>
        {h && hi != null && (
          <div className="sla-tip" style={{ left: `${(cx(hi) / W) * 100}%` }} role="status">
            <b>{h.year}년 {h.month}월</b>
            <span>장애 <b>{h.total}</b>건 · 위반 <b>{h.missed}</b>건</span>
            <span>충족률 {h.metRate == null ? (h.total ? "판정 전" : "장애 없음") : <b className={h.metRate >= goal ? "" : "bad"}>{h.metRate}%</b>}</span>
          </div>
        )}
      </div>
      <details className="sla-tr-tb">
        <summary>표로 보기</summary>
        <div className="tw">
          <table>
            <thead><tr><th scope="col">월</th><th scope="col">장애</th><th scope="col">위반</th><th scope="col">충족률</th></tr></thead>
            <tbody>{pts.map((p) => <tr key={`${p.year}-${p.month}`}><td>{p.year}.{String(p.month).padStart(2, "0")}</td><td>{p.total}</td><td>{p.missed}</td><td>{p.metRate == null ? "-" : `${p.metRate}%`}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/* ---------- 업체 · 지역 표: 나쁜 순, 충족률 막대, 행을 누르면 위반 내역 ---------- */

function Meter({ v, goal, max = 100, min = 0 }: { v: number; goal: number; max?: number; min?: number }) {
  const p = (x: number) => Math.max(0, Math.min(100, ((x - min) / (max - min)) * 100));
  return (
    <span className={"sla-m" + (v >= goal ? " ok" : " bad")} aria-hidden="true">
      <i style={{ width: `${p(v)}%` }} />
      <em style={{ left: `${p(goal)}%` }} />
    </span>
  );
}

function AggTable({ name, rows, onPick }: { name: string; rows: { key: string; label: string; a: Agg; handoff?: number }[]; onPick: (label: string, key: string) => void }) {
  const sorted = [...rows].sort((x, y) => (x.a.metRate ?? 101) - (y.a.metRate ?? 101) || y.a.missed - x.a.missed);
  const showHandoff = rows.some((r) => r.handoff);
  return (
    <div className="tw">
      <table className="cards sla-agg" style={{ minWidth: 760 }}>
        <thead><tr>{[name, "장애 건수", "충족 / 위반 / 진행 중", "충족률", "평균 접수", "평균 도착", "평균 복구", ...(showHandoff ? ["넘기기 전 위반"] : [])].map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
        <tbody>
          {sorted.length ? sorted.map(({ key, label, a, handoff }) => (
            <tr key={key} className={a.missed ? "pick" : undefined} onClick={a.missed ? () => onPick(label, key) : undefined}>
              <td data-label={name} className="tl">
                {a.missed ? <button type="button" className="linkbtn" onClick={(e) => { e.stopPropagation(); onPick(label, key); }}>{label}</button> : label}
              </td>
              <td data-label="장애 건수">{a.total}</td>
              <td data-label="충족 / 위반 / 진행 중">{a.met} / <b className={a.missed ? "sla-miss" : ""}>{a.missed}</b> / {a.pending}</td>
              <td data-label="충족률" className="sla-rc">
                {a.metRate == null ? "-" : <><Meter v={a.metRate} goal={MET_GOAL} /><b className={a.metRate >= MET_GOAL ? "sla-ok" : "sla-miss"}>{pct(a.metRate)}%</b></>}
              </td>
              <td data-label="평균 접수">{dur(a.avgReceiveMin)}</td>
              <td data-label="평균 도착">{dur(a.avgVisitMin)}</td>
              <td data-label="평균 복구">{dur(a.avgRecoverMin)}</td>
              {showHandoff && <td data-label="넘기기 전 위반">{handoff ? <b className="sla-miss">{handoff}</b> : 0}</td>}
            </tr>
          )) : <tr><td colSpan={showHandoff ? 8 : 7}>이 달에는 스쿨넷 장애가 없습니다.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function Lines({ lines, goal }: { lines: Line[]; goal: number }) {
  const sorted = [...lines].sort((a, b) => a.availability - b.availability);
  // 가용률 막대는 90~100% 구간을 보여 준다 (99.5%와 92%의 차이가 보이도록)
  const min = Math.min(90, Math.floor(Math.min(goal, ...sorted.map((l) => l.availability))));
  return (
    <div className="tw">
      <table className="cards" style={{ minWidth: 820 }}>
        <thead><tr>{["학교", "회선 (장비)", "통신사 · 속도", "장애 횟수", "장애 시간", `가용률 (목표 ${goal}%)`].map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
        <tbody>
          {sorted.length ? sorted.map((l) => (
            <tr key={l.deviceId}>
              <td data-label="학교" className="tl">{l.schoolName ?? "-"}{l.regionName && <small className="hint"> · {l.regionName}</small>}</td>
              <td data-label="회선 (장비)" className="tl">{l.circuitId ?? <span className="hint">회선번호 없음</span>}<br /><small className="hint">{l.deviceCode} {l.deviceName ?? ""}</small></td>
              <td data-label="통신사 · 속도">{[l.carrier, l.bandwidth].filter(Boolean).join(" · ") || "-"}</td>
              <td data-label="장애 횟수">{l.failures}회</td>
              <td data-label="장애 시간">{dur(l.downtimeMin)}</td>
              <td data-label="가용률" className="sla-rc">
                <Meter v={l.availability} goal={goal} min={min} />
                <b className={l.belowTarget ? "sla-miss" : "sla-ok"}>{l.availability.toFixed(2)}%</b>
                {l.belowTarget && <small className="sla-tag bad">미달</small>}
              </td>
            </tr>
          )) : <tr><td colSpan={6}>이 달에 장비(회선)를 지정해 신청한 장애가 없습니다.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- 위반 내역: 거르기 칩 · 상태를 앞으로 · 칸에는 걸린 시간만 ---------- */

function ViolationFilter({ d, vf, setVf }: { d: Sla; vf: { stage: string; ongoing: boolean; vendor: string; region: string }; setVf: (v: typeof vf) => void }) {
  const vendors = [...new Set(d.violations.map((v) => v.vendorName))];
  const count = (st: string) => d.violations.filter((v) => v.missed.includes(st)).length;
  if (!d.violations.length) return null;
  return (
    <div className="sla-vf">
      <div className="my-chips" role="group" aria-label="위반 단계">
        <button type="button" className={!vf.stage ? "on" : ""} aria-pressed={!vf.stage} onClick={() => setVf({ ...vf, stage: "" })}>전체 <b>{d.violations.length}</b></button>
        {STAGES.map((st) => (
          <button key={st} type="button" className={(vf.stage === st ? "on" : "") + (count(st) ? "" : " zero")} aria-pressed={vf.stage === st} onClick={() => setVf({ ...vf, stage: st })}>{st} 위반 <b>{count(st)}</b></button>
        ))}
      </div>
      <label><input type="checkbox" checked={vf.ongoing} onChange={(e) => setVf({ ...vf, ongoing: e.target.checked })} /> 진행 중만</label>
      {vendors.length > 1 && (
        <select aria-label="업체" value={vf.vendor} onChange={(e) => setVf({ ...vf, vendor: e.target.value })}>
          <option value="">업체 전체</option>
          {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      )}
      {vf.vendor && (vendors.length <= 1 || !vendors.includes(vf.vendor)) && <span className="sla-fchip">업체: {vf.vendor === NONE ? "업체 없음 · 미배정" : vf.vendor} <button type="button" aria-label="업체 거르기 해제" onClick={() => setVf({ ...vf, vendor: "" })}>✕</button></span>}
      {vf.region && <span className="sla-fchip">지역: {vf.region === NONE ? "지역 없음" : vf.region} <button type="button" aria-label="지역 거르기 해제" onClick={() => setVf({ ...vf, region: "" })}>✕</button></span>}
    </div>
  );
}

function StepCell({ s, stage, missedHere }: { s: Step; stage: string; missedHere: boolean }) {
  if (s.state === "NO_RECORD")
    return <span className="sla-c nr" title={s.legacy ? "이 기능 전의 자료라 도착을 실제로 기록했는지 알 수 없습니다" : "현장 도착을 기록하지 않고 처리완료 — 도착 SLA는 판정하지 않습니다"}>{s.legacy ? "이전 자료" : "기록 없음"}</span>;
  const ongoing = !s.done && s.state !== "MET";
  const label = s.state === "MISSED" ? (s.done ? "위반" : "위반 · 진행 중") : s.state === "MET" ? "충족" : "진행 중";
  return (
    <span className={"sla-c" + (missedHere ? " miss" : s.state === "MET" ? " ok" : " wait")} title={`${stage}: ${label} · 기준 ${dur(s.target)}`}>
      {ongoing && <i className="sla-live" aria-hidden="true" />}
      {dur(s.minutes)}
      <span className="sr"> ({label})</span>
    </span>
  );
}

function Violations({ rows, t, total, onOpen }: { rows: Violation[]; t: Targets; total: number; onOpen: (sn: number) => void }) {
  return (
    <>
      <div className="tw">
        <table className="cards sla-v" style={{ minWidth: 860 }}>
          <thead>
            <tr>
              <th scope="col">접수번호</th><th scope="col">상태</th><th scope="col">학교</th><th scope="col">업체</th><th scope="col">장애유형</th><th scope="col">신청일시</th>
              <th scope="col">접수<small>기준 {dur(t.receiveMin)}{t.receiveBiz ? " · 근무 시간" : ""} · 넘겨받은 때부터</small></th>
              <th scope="col">현장 도착<small>기준 {dur(t.visitMin)}{t.visitBiz ? " · 근무 시간" : ""}</small></th>
              <th scope="col">복구<small>기준 {dur(t.recoverFullMin)} · {dur(t.recoverPartialMin)}{t.recoverBiz ? " · 근무 시간" : ""}</small></th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((v) => (
              <tr key={v.asvcSn} className="pick" onClick={() => onOpen(v.asvcSn)}>
                <td data-label="접수번호"><button type="button" className="linkbtn" onClick={(e) => { e.stopPropagation(); onOpen(v.asvcSn); }}>AS-{v.asvcSn}</button></td>
                <td data-label="상태"><span className={"sla-st" + (v.status === "C" ? " done" : "")}>{v.status !== "C" && <i className="sla-live" aria-hidden="true" />}{v.statusName}</span></td>
                <td data-label="학교" className="tl">{v.schoolName ?? "-"}</td>
                <td data-label="업체">{v.vendorName}</td>
                <td data-label="장애유형">{v.faultTypeName ?? "-"}{v.fullOutage && <small className="hint"> (전체)</small>}</td>
                <td data-label="신청일시">{fmtDateTime(v.requestAt)}</td>
                <td data-label="접수">
                  <StepCell s={v.receive} stage="접수" missedHere={v.missed.includes("접수")} />
                  {v.prior?.filter((x) => x.missed).map((x, i) => (
                    <small key={i} className="sla-prior" title={`${x.vendorName}가 맡은 동안 ${x.received ? "늦게 접수" : "접수하지 않고 넘어감"}`}>
                      넘기기 전 {x.vendorName} {dur(x.minutes)}{x.received ? "" : " (미접수)"}
                    </small>
                  ))}
                </td>
                <td data-label="현장 도착"><StepCell s={v.visit} stage="현장 도착" missedHere={v.missed.includes("현장 도착")} /></td>
                <td data-label="복구"><StepCell s={v.recover} stage={`복구 (${v.fullOutage ? "전체" : "일부"})`} missedHere={v.missed.includes("복구")} /></td>
              </tr>
            )) : <tr><td colSpan={9}>{total ? "고른 조건에 맞는 위반이 없습니다." : "이 달에는 SLA 위반이 없습니다."}</td></tr>}
          </tbody>
        </table>
      </div>
      {total > 0 && <p className="hint sla-note"><span className="sla-c miss">빨간 시간</span>은 그 단계에서 기준을 넘긴 것, <i className="sla-live" aria-hidden="true" /> 표시는 아직 진행 중입니다. 시간은 신청 시각부터 잽니다 (보류 기간 제외{t.receiveBiz || t.visitBiz || t.recoverBiz ? ", ‘근무 시간’ 단계는 근무 시간만" : ""}). 행을 누르면 상세가 열립니다.</p>}
    </>
  );
}

const hasOffice = (d: Sla) => !!d.office && (d.office.total > 0 || d.office.triageCount > 0);

/** SLA를 약하게 만드는 처리 흐름 설정 (경고) · SLA가 처리 흐름에 맞춰 계산한다는 안내 (정보) */
function FlowWarnings({ list, canEdit }: { list?: FlowWarning[]; canEdit: boolean }) {
  if (!list?.length) return null;
  return (
    <ul className="sla-fw">
      {list.map((w) => (
        <li key={w.key} className={w.level}>
          <span aria-hidden="true">{w.level === "warn" ? "⚠" : "ℹ"}</span>
          <span>{w.text}</span>
          {w.level === "warn" && canEdit && <a href="/admin/workflow" className="linkbtn">처리 흐름 바꾸기 →</a>}
        </li>
      ))}
    </ul>
  );
}

/** 교육지원청 · 교육청: 직접 처리한 건 (통신사 SLA에 넣지 않는다) + 통신사에 넘기기 전 1차 확인 시간 */
function OfficeBlock({ o }: { o: NonNullable<Sla["office"]> }) {
  return (
    <section id="sla-office" className="sla-sec" aria-labelledby="sla-office-t">
      <h2 id="sla-office-t" className="sla-h">교육지원청 · 교육청 <small>직접 처리한 건과 1차 확인 시간 — 통신사 SLA에는 넣지 않습니다</small></h2>
      <div className="sla-kpi">
        <div className="sla-k">
          <span className="sla-kl">직접 처리</span>
          <b className="sla-kv">{o.total}<small>건</small></b>
          <small className="sla-ks">처리완료 {o.completed} · 진행 중 {o.open}</small>
        </div>
        <div className="sla-k">
          <span className="sla-kl">같은 기준으로 본 충족률</span>
          <b className="sla-kv">{pct(o.metRate)}{o.metRate != null && <small>%</small>}</b>
          <small className="sla-ks">참고용 · 평균 복구 {dur(o.avgRecoverMin)}</small>
        </div>
        <div className="sla-k">
          <span className="sla-kl">1차 확인 (통신사에 넘기기 전)</span>
          <b className="sla-kv sm">{o.triageAvgMin == null ? "-" : `평균 ${dur(o.triageAvgMin)}`}</b>
          <small className="sla-ks">{o.triageCount ? `${o.triageCount}건 · 가장 길게 ${dur(o.triageMaxMin)}` : "이 달에 넘긴 건이 없습니다"}</small>
        </div>
      </div>
    </section>
  );
}

/** 기준 옆의 작은 표시: 24시간 · 근무 시간 */
function Clock({ biz }: { biz?: boolean }) {
  return <small className={"sla-clk" + (biz ? " biz" : "")}>{how(biz)}</small>;
}

/** SLA 기준 설정: 접수는 분, 나머지는 시간 단위로 받아 분으로 저장한다. 단계마다 24시간 · 근무 시간을 고른다. */
function TargetForm({ t, warnings, onClose, onSaved }: { t: Targets; warnings?: FlowWarning[]; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({
    receiveMin: String(t.receiveMin), visitH: String(t.visitMin / 60), recoverFullH: String(t.recoverFullMin / 60),
    recoverPartialH: String(t.recoverPartialMin / 60), availabilityPct: String(t.availabilityPct),
  });
  const [bz, setBz] = useState({ receiveBiz: !!t.receiveBiz, visitBiz: !!t.visitBiz, recoverBiz: !!t.recoverBiz });
  const clock = (k: keyof typeof bz, label: string) => (
    <div className="sla-clkpick" role="radiogroup" aria-label={`${label} 시간 세는 법`}>
      {([false, true] as const).map((b) => (
        <label key={String(b)} className={bz[k] === b ? "on" : ""}>
          <input type="radio" name={k} checked={bz[k] === b} onChange={() => setBz({ ...bz, [k]: b })} /> {how(b)}
        </label>
      ))}
    </div>
  );
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const h = (s: string) => Math.round(Number(s) * 60);
    setBusy(true);
    setMsg("");
    try {
      await api.put("/api/as/sla/targets", {
        receiveMin: Number(v.receiveMin), visitMin: h(v.visitH), recoverFullMin: h(v.recoverFullH), recoverPartialMin: h(v.recoverPartialH),
        availabilityPct: Number(v.availabilityPct), ...bz,
      });
      onSaved();
    } catch (er) {
      setMsg((er as Error).message);
      setBusy(false);
    }
  };
  const row = (label: string, k: keyof typeof v, unit: string, step: string, hint?: string) => (
    <label className="sla-f">
      <span>{label}</span>
      <span className="sla-f-in"><input type="number" min="0" step={step} value={v[k]} onChange={set(k)} aria-label={label} /> {unit}</span>
      {hint && <small className="hint">{hint}</small>}
    </label>
  );
  return (
    <Modal title="스쿨넷 SLA 기준 설정" onClose={onClose}>
      <form className="sla-form" noValidate onSubmit={save}>
        <p className="hint">계약서의 SLA 기준을 적습니다. 접수 · 현장 도착은 지금 담당이 넘겨받은 시각부터(교육지원청 1차 확인 시간 제외), 복구는 장애 발생부터 잽니다.</p>
        <FlowWarnings list={warnings} canEdit />
        {row("접수", "receiveMin", "분 이내", "1")}
        {clock("receiveBiz", "접수")}
        {row("현장 도착", "visitH", "시간 이내", "0.5")}
        {clock("visitBiz", "현장 도착")}
        {row("복구 · 전체 장애", "recoverFullH", "시간 이내", "0.5", "장애유형 ‘전체’로 신청한 건")}
        {row("복구 · 일부 · 기타 장애", "recoverPartialH", "시간 이내", "0.5")}
        {clock("recoverBiz", "복구")}
        {row("회선 월 가용률", "availabilityPct", "% 이상", "0.1", "90 ~ 100 · 늘 24시간으로 셉니다")}
        <p className="hint sla-clk-note">
          <b>24시간</b>: 밤 · 주말 · 휴일도 셉니다. <b>근무 시간</b>: 지연 알림과 같은 근무 시간 달력(알림 기준 화면의 근무 요일 · 시간 · 휴일)으로만 셉니다
          {t.calendar ? <> — 지금 달력: {t.calendar}</> : null}. 예) 금 17:50 신청 · 월 09:00 접수 → 24시간 2일 15시간 10분, 근무 시간 10분.
        </p>
        <FormMsg kind={msg ? "bad" : undefined} text={msg} />
        <div className="sla-form-act">
          <button type="button" className="btn sm sec" onClick={onClose}>취소</button>
          <button type="submit" className="btn sm" disabled={busy}>{busy ? "저장 중…" : "저장"}</button>
        </div>
      </form>
    </Modal>
  );
}

/** 데이터 점검: 한 줄씩, 누르면 그 자리에서 펼친다. 문제 없는 항목은 한 줄로 모은다. */
function QualityPanel({ q, onOpen }: { q: Quality; onOpen: (sn: number) => void }) {
  const items: [string, string, { count: number; rows: (QReq | QLine)[] }, "req" | "line"][] = [
    ["회선 미지정 장애", "가용률에 들어가지 않습니다. 교육지원청이 대상 장비(회선)를 지정하세요.", q.unlinked, "req"],
    ["장애 시각 미입력 (처리완료)", "신청 · 처리완료 시각으로 계산했습니다. NMS로 확인한 실제 시각을 '장애 시각 수정'으로 넣으면 정확해집니다.", q.noOutageTime, "req"],
    ["회선번호 · 통신사 누락 회선", "스쿨넷장비관리에서 회선 정보를 채우세요.", q.lineNoCircuit, "line"],
    ["유지보수 업체 없는 회선", "통신사에 넘길 때 추천할 업체가 없습니다.", q.lineNoVendor, "line"],
    ...(q.noArrival ? [["현장 도착 기록 없음 (처리완료)",
      `도착을 기록하지 않고 끝내 현장 도착 SLA를 판정하지 못한 건입니다. 처리 흐름에서 ‘현장 도착 기록 필수’를 켜면 생기지 않습니다.${q.noArrival.legacy ? ` 그중 ${q.noArrival.legacy}건은 이 기능 전의 자료입니다.` : ""}`,
      q.noArrival, "req"] as [string, string, { count: number; rows: (QReq | QLine)[] }, "req" | "line"]] : []),
  ];
  const bad = items.filter(([, , it]) => it.count > 0);
  const ok = items.filter(([, , it]) => it.count === 0);
  return (
    <div className="slaq2">
      {bad.map(([title, hint, it, kind]) => (
        <details key={title} className="slaq2-i">
          <summary><b className="slaq2-n">{it.count.toLocaleString()}</b><span>{title}</span><small className="hint">{hint}</small></summary>
          <ul>
            {it.rows.map((x) => kind === "req" ? (
              <li key={(x as QReq).asvcSn}><button type="button" className="linkbtn" onClick={() => onOpen((x as QReq).asvcSn)}>AS-{(x as QReq).asvcSn}</button> {(x as QReq).schoolName} · {fmtDateTime((x as QReq).requestAt)} <small className="hint">{(x as QReq).symptom}</small></li>
            ) : (
              <li key={(x as QLine).deviceId}><b>{(x as QLine).deviceCode}</b> {(x as QLine).schoolName} <small className="hint">{(x as QLine).carrier ?? "통신사 없음"} · {(x as QLine).circuitId ?? "회선번호 없음"}</small></li>
            ))}
            {it.count > it.rows.length && <li className="hint">외 {it.count - it.rows.length}건</li>}
          </ul>
        </details>
      ))}
      {ok.length > 0 && <p className="slaq2-ok"><span aria-hidden="true">✓</span> 이상 없음: {ok.map(([t]) => t).join(" · ")}</p>}
    </div>
  );
}
