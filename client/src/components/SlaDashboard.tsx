"use client";

import { useCallback, useEffect, useState } from "react";
import AsDetailModal from "./AsDetailModal";
import { VBar } from "./admin/charts";
import { FilterField, FilterForm, Kpis } from "./admin/common";
import { ErrorBox, FormMsg, Icon, Loading, Modal, useToast } from "./ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { loadRegions } from "@/lib/boards";
import { fmtDateTime } from "@/lib/format";
import type { Region } from "@/lib/types";

/** /api/as/sla 응답. 값이 없으면(판정할 건 없음) 키가 빠진다. */
interface Targets { receiveMin: number; visitMin: number; recoverFullMin: number; recoverPartialMin: number; availabilityPct: number; isDefault?: boolean; updatedAt?: string }
interface Agg {
  total: number; completed: number; open: number; met: number; missed: number; pending: number; metRate?: number;
  avgReceiveMin?: number; avgVisitMin?: number; avgRecoverMin?: number; receiveMissed: number; visitMissed: number; recoverMissed: number;
}
interface Step { state: "MET" | "MISSED" | "PENDING"; minutes?: number; target: number; done?: boolean }
interface Line {
  deviceId: number; deviceCode: string; deviceName?: string; circuitId?: string; carrier?: string; bandwidth?: string; schoolName?: string; regionName?: string;
  failures: number; downtimeMin: number; availability: number; belowTarget: boolean;
}
interface Violation {
  asvcSn: number; schoolName?: string; regionName?: string; vendorName: string; faultTypeName?: string; fullOutage?: boolean; requestAt: string;
  status: string; statusName: string; receive: Step; visit: Step; recover: Step; missed: string[];
}
interface Sla {
  year: number; month: number; targets: Targets; canEdit: boolean;
  summary: Agg & { prevTotal: number; prevMetRate?: number };
  byVendor: (Agg & { vendorId?: number; vendorName: string })[];
  byRegion: (Agg & { regionId?: number; regionName: string })[];
  lines: Line[];
  lineSummary: { lineCount: number; failedLines: number; belowTarget: number; totalDowntimeMin: number };
  trend: { year: number; month: number; total: number; missed: number; metRate?: number }[];
  violations: Violation[];
}

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
    api.get<Sla>("/api/as/sla", query()).then(setD).catch((e) => setErr((e as Error).message));
  }, [query]);
  useEffect(load, [load]);

  const excel = () => {
    const x = query();
    api.download("/api/as/sla/excel", x, `스쿨넷_SLA_보고서_${x.year}-${String(x.month).padStart(2, "0")}.xlsx`).catch((e) => toast((e as Error).message));
  };

  return (
    <div className="sla">
      <FilterForm submitLabel="조회" onSubmit={() => setQ(draft)}>
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
      </FilterForm>

      {err ? <ErrorBox message={err} onRetry={load} /> : !d ? <Loading /> : (
        <>
          <section className="sla-tg" aria-label="SLA 기준">
            <div className="sla-tg-h">
              <b>SLA 기준</b>
              {d.targets.isDefault ? <span className="um-pill warn">기본값 — 계약 기준으로 바꿔 주세요</span> : <small className="hint">최종 수정 {fmtDateTime(d.targets.updatedAt)}</small>}
            </div>
            <ul>
              <li><span>접수</span><b>{dur(d.targets.receiveMin)}</b> 이내</li>
              <li><span>현장 도착</span><b>{dur(d.targets.visitMin)}</b> 이내</li>
              <li><span>복구 · 전체 장애</span><b>{dur(d.targets.recoverFullMin)}</b> 이내</li>
              <li><span>복구 · 일부 · 기타</span><b>{dur(d.targets.recoverPartialMin)}</b> 이내</li>
              <li><span>회선 월 가용률</span><b>{d.targets.availabilityPct}%</b> 이상</li>
            </ul>
            <div className="sla-tg-act">
              {d.canEdit && <button type="button" className="btn sm sec" onClick={() => setEdit(true)}>기준 설정</button>}
              <button type="button" className="btn sm sky" onClick={excel}>월간 보고서 (엑셀) <Icon name="down" /></button>
            </div>
          </section>

          <Kpis items={[
            [`${d.month}월 장애`, d.summary.total.toLocaleString(), "건", `지난달 ${d.summary.prevTotal}건 · 진행 중 ${d.summary.open}건`],
            ["SLA 충족률", pct(d.summary.metRate), d.summary.metRate == null ? "" : "%", d.summary.prevMetRate != null ? `지난달 ${pct(d.summary.prevMetRate)}%` : "판정할 건이 없으면 -"],
            ["위반", d.summary.missed.toLocaleString(), "건", `접수 ${d.summary.receiveMissed} · 도착 ${d.summary.visitMissed} · 복구 ${d.summary.recoverMissed}`],
            ["평균 복구", dur(d.summary.avgRecoverMin), "", `접수 ${dur(d.summary.avgReceiveMin)} · 도착 ${dur(d.summary.avgVisitMin)}`],
            ["가용률 미달 회선", `${d.lineSummary.belowTarget}`, `/${d.lineSummary.lineCount}`, `장애 회선 ${d.lineSummary.failedLines} · 누적 ${dur(d.lineSummary.totalDowntimeMin)}`],
          ]} />

          <div className="stg">
            <VBar title="최근 12개월 SLA 충족률" unit="%" fmt={(n) => n.toFixed(1)}
              bars={d.trend.map((t) => ({ label: `${t.month}월`, value: t.metRate ?? 0, tip: `${t.year}년 ${t.month}월 · ${t.metRate == null ? "판정할 건 없음" : `충족률 ${t.metRate}%`} (장애 ${t.total}건 · 위반 ${t.missed}건)` }))} />
            <VBar title="최근 12개월 장애 건수"
              bars={d.trend.map((t) => ({ label: `${t.month}월`, value: t.total, tip: `${t.year}년 ${t.month}월 · ${t.total}건 (위반 ${t.missed})` }))} />
          </div>

          <AggTable title="업체(통신사)별 SLA" name="업체" rows={d.byVendor.map((x) => ({ key: String(x.vendorId ?? "none"), label: x.vendorName, a: x }))} />
          {d.byRegion.length > 1 && <AggTable title="지역별 SLA" name="지역" rows={d.byRegion.map((x) => ({ key: String(x.regionId ?? "none"), label: x.regionName, a: x }))} />}

          <div className="glh"><span>회선별 가용률 · 장애가 난 회선 <b>{d.lines.length}</b>개 / 전체 {d.lineSummary.lineCount}개</span></div>
          <div className="tw">
            <table className="cards" style={{ minWidth: 820 }}>
              <thead><tr>{["학교", "회선 (장비)", "통신사 · 속도", "장애 횟수", "장애 시간", "가용률"].map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
              <tbody>
                {d.lines.length ? d.lines.map((l) => (
                  <tr key={l.deviceId}>
                    <td data-label="학교" className="tl">{l.schoolName ?? "-"}{l.regionName && <small className="hint"> · {l.regionName}</small>}</td>
                    <td data-label="회선 (장비)" className="tl">{l.circuitId ?? "회선번호 없음"}<br /><small className="hint">{l.deviceCode} {l.deviceName ?? ""}</small></td>
                    <td data-label="통신사 · 속도">{[l.carrier, l.bandwidth].filter(Boolean).join(" · ") || "-"}</td>
                    <td data-label="장애 횟수">{l.failures}회</td>
                    <td data-label="장애 시간">{dur(l.downtimeMin)}</td>
                    <td data-label="가용률"><b className={"st " + (l.belowTarget ? "s4" : "s1")}>{l.availability.toFixed(2)}%</b>{l.belowTarget && <small className="hint"> 목표 미달</small>}</td>
                  </tr>
                )) : <tr><td colSpan={6}>이 달에 장비(회선)를 지정해 신청한 장애가 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="hint sla-note">가용률은 스쿨넷 AS 신청에서 고른 장비(회선)의 장애 시간(신청 → 처리완료, 진행 중이면 지금까지)으로 계산합니다. 장비를 고르지 않은 신청은 회선별에서 빠집니다.</p>

          <div className="glh"><span>SLA 위반 내역 <b>{d.violations.length}</b>건</span></div>
          <div className="tw">
            <table className="cards sla-v" style={{ minWidth: 980 }}>
              <thead><tr>{["접수번호", "학교", "업체", "장애유형", "신청일시", "접수", "현장 도착", "복구", "상태"].map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
              <tbody>
                {d.violations.length ? d.violations.map((v) => (
                  <tr key={v.asvcSn}>
                    <td data-label="접수번호"><button type="button" className="linkbtn" onClick={() => setOpen(v.asvcSn)}>AS-{v.asvcSn}</button></td>
                    <td data-label="학교" className="tl">{v.schoolName ?? "-"}</td>
                    <td data-label="업체">{v.vendorName}</td>
                    <td data-label="장애유형">{v.faultTypeName ?? "-"}{v.fullOutage && <small className="hint"> (전체)</small>}</td>
                    <td data-label="신청일시">{fmtDateTime(v.requestAt)}</td>
                    <td data-label="접수"><StepCell s={v.receive} /></td>
                    <td data-label="현장 도착"><StepCell s={v.visit} /></td>
                    <td data-label="복구"><StepCell s={v.recover} /></td>
                    <td data-label="상태">{v.statusName}</td>
                  </tr>
                )) : <tr><td colSpan={9}>이 달에는 SLA 위반이 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>

          {open && <AsDetailModal sn={open} onClose={() => setOpen(null)} onChanged={load} />}
          {edit && <TargetForm t={d.targets} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); toast("SLA 기준을 저장했습니다."); load(); }} />}
        </>
      )}
    </div>
  );
}

function StepCell({ s }: { s: Step }) {
  const cls = s.state === "MISSED" ? "sla-s miss" : s.state === "MET" ? "sla-s ok" : "sla-s wait";
  const label = s.state === "MISSED" ? (s.done ? "위반" : "위반 · 진행 중") : s.state === "MET" ? "충족" : "진행 중";
  return (
    <span className={cls} title={`기준 ${dur(s.target)}`}>
      <b>{dur(s.minutes)}</b>
      <small>{label} · 기준 {dur(s.target)}</small>
    </span>
  );
}

function AggTable({ title, name, rows }: { title: string; name: string; rows: { key: string; label: string; a: Agg }[] }) {
  return (
    <>
      <div className="glh"><span>{title}</span></div>
      <div className="tw">
        <table className="cards" style={{ minWidth: 760 }}>
          <thead><tr>{[name, "장애 건수", "충족 / 위반 / 진행 중", "충족률", "평균 접수", "평균 도착", "평균 복구"].map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>
            {rows.length ? rows.map(({ key, label, a }) => (
              <tr key={key}>
                <td data-label={name} className="tl">{label}</td>
                <td data-label="장애 건수">{a.total}</td>
                <td data-label="충족 / 위반 / 진행 중">{a.met} / <b className={a.missed ? "sla-miss" : ""}>{a.missed}</b> / {a.pending}</td>
                <td data-label="충족률">{a.metRate == null ? "-" : <b className={"st " + (a.metRate >= 95 ? "s1" : a.metRate >= 80 ? "s3" : "s4")}>{pct(a.metRate)}%</b>}</td>
                <td data-label="평균 접수">{dur(a.avgReceiveMin)}</td>
                <td data-label="평균 도착">{dur(a.avgVisitMin)}</td>
                <td data-label="평균 복구">{dur(a.avgRecoverMin)}</td>
              </tr>
            )) : <tr><td colSpan={7}>이 달에는 스쿨넷 장애가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** SLA 기준 설정: 접수는 분, 나머지는 시간 단위로 받아 분으로 저장한다. */
function TargetForm({ t, onClose, onSaved }: { t: Targets; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({
    receiveMin: String(t.receiveMin), visitH: String(t.visitMin / 60), recoverFullH: String(t.recoverFullMin / 60),
    recoverPartialH: String(t.recoverPartialMin / 60), availabilityPct: String(t.availabilityPct),
  });
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
        availabilityPct: Number(v.availabilityPct),
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
        <p className="hint">계약서의 SLA 기준을 적습니다. 모든 시간은 학교가 AS를 신청한 시각부터 잽니다.</p>
        {row("접수", "receiveMin", "분 이내", "1")}
        {row("현장 도착", "visitH", "시간 이내", "0.5")}
        {row("복구 · 전체 장애", "recoverFullH", "시간 이내", "0.5", "장애유형 ‘전체’로 신청한 건")}
        {row("복구 · 일부 · 기타 장애", "recoverPartialH", "시간 이내", "0.5")}
        {row("회선 월 가용률", "availabilityPct", "% 이상", "0.1", "90 ~ 100")}
        <FormMsg kind={msg ? "bad" : undefined} text={msg} />
        <div className="sla-form-act">
          <button type="button" className="btn sm sec" onClick={onClose}>취소</button>
          <button type="submit" className="btn sm" disabled={busy}>{busy ? "저장 중…" : "저장"}</button>
        </div>
      </form>
    </Modal>
  );
}
