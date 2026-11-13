"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import SubPage from "@/components/SubPage";
import { ErrorBox, FormMsg, Loading, QuickIcon, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Me, RceptTy } from "@/lib/types";

interface AsServices {
  asTypes: RceptTy[];
  /** 스쿨넷 신고를 먼저 받는 곳: REGION 교육지원청 · VENDOR 통신사 */
  schoolnetRoute?: "REGION" | "VENDOR";
  /** openRequests: 처리 중(신청완료·접수완료) 건수. 끄면 목록에서 숨겨진다. */
  types: { rceptTy: RceptTy; name: string; enabled: boolean; openRequests?: number }[];
}

/** What turning a service on brings with it (Roles.AS_TYPE_PERMS on the server). */
const DESC: Record<RceptTy, string> = {
  M: "무선망 AS 신청·결과조회, 무선장비관리",
  S: "스쿨넷 AS 신청·결과조회, 스쿨넷 SLA 공유",
  C: "정보기기 AS 신청·결과조회, 불용PC수거신청, 유지관리업체(정보공유)",
  T: "스마트기기 지원신청·결과조회",
};
const ICON: Record<RceptTy, "wifi" | "net" | "pc" | "tab"> = { M: "wifi", S: "net", C: "pc", T: "tab" };

export default function Page() {
  return (
    <SubPage perm="ORG_WRITE">
      <nav className="svc-nav" aria-label="AS 서비스 설정 구역">
        <a href="#svc-1">① 사용 서비스</a>
        <a href="#svc-2">② 근무 시간 · 휴일</a>
        <a href="#svc-3">③ 지연 알림 기준</a>
        <Link href="/admin/workflow">AS 처리 흐름 →</Link>
      </nav>
      <AsServicesForm />
      <WorkCalendarForm />
      <AlertRulesForm />
    </SubPage>
  );
}

/** 구역 머리: 번호 · 제목 · 한 줄 요약, 긴 설명은 '자세히'로 접는다. */
function SecHead({ n, title, sub, children }: { n: number; title: string; sub: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="svc-h">
      <h2 className="sla-h"><span className="svc-n" aria-hidden="true">{n}</span>{title}</h2>
      <p className="svc-sub">{sub}</p>
      {children && (
        <details className="svc-more">
          <summary>자세히</summary>
          <div>{children}</div>
        </details>
      )}
    </header>
  );
}

/** 저장 막대: 바뀐 것이 있을 때만 눈에 띈다. */
function SaveBar({ dirty, busy, idle, onReset, onSave, extra }: { dirty: boolean; busy: boolean; idle: string; onReset: () => void; onSave: () => void; extra?: React.ReactNode }) {
  return (
    <div className={"um-bar svc-bar" + (dirty ? " dirty" : "")}>
      <span className="um-bar-t">{dirty ? "저장하지 않은 변경이 있습니다" : idle}</span>
      {extra}
      <button type="button" className="btn sm sec" disabled={!dirty || busy} onClick={onReset}>되돌리기</button>
      <button type="button" className="btn sm" disabled={!dirty || busy} onClick={onSave}>{busy ? "저장 중…" : "저장"}</button>
    </div>
  );
}

/* ---------- ① 사용 서비스 ---------- */

function AsServicesForm() {
  const toast = useToast();
  const { setMe } = useAuth();
  const [data, setData] = useState<AsServices | null>(null);
  const [on, setOn] = useState<Set<RceptTy>>(new Set());
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setErr("");
    api.get<AsServices>("/api/org/as-services").then((d) => {
      setData(d);
      setOn(new Set(d.asTypes));
    }).catch((e) => setErr((e as Error).message));
  }, []);
  useEffect(load, [load]);

  if (err) return <ErrorBox message={err} onRetry={load} />;
  if (!data) return <Loading />;

  const dirty = data.types.some((t) => t.enabled !== on.has(t.rceptTy));
  // 지금 켜져 있고 처리 중인 건이 있는데 끄려는 서비스: 저장 전에 무엇이 숨겨지는지 알린다.
  const hiding = data.types.filter((t) => t.enabled && !on.has(t.rceptTy) && (t.openRequests ?? 0) > 0);
  const flip = (t: RceptTy, v: boolean) => {
    const s = new Set(on);
    if (v) s.add(t); else s.delete(t);
    setOn(s);
    setMsg("");
  };

  const save = async () => {
    if (!on.size) return setMsg("AS 서비스를 하나 이상 켜 주세요.");
    setBusy(true);
    try {
      const d = await api.put<AsServices>("/api/org/as-services", { asTypes: [...on] });
      setData(d);
      setOn(new Set(d.asTypes));
      toast("AS 서비스 설정을 저장했습니다.");
      // 메뉴가 바로 바뀌도록 내 권한을 다시 읽는다.
      api.get<Me>("/api/auth/me").then(setMe).catch(() => {});
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="svc-1" className="svc-sec" aria-labelledby="svc-1-t">
      <SecHead n={1} title="사용 서비스" sub={<>이 교육청에서 쓰는 AS 서비스만 켜 두세요. 지금 <b>{on.size}</b>개 사용 중 / 전체 {data.types.length}개</>}>
        끈 서비스는 모든 사용자에게서 메뉴와 신청 · 이관이 함께 닫히고, 사용자별 메뉴 권한으로도 열 수 없습니다.
        이미 있는 신청 기록은 지우지 않으며 다시 켜면 그대로 보입니다. 신고를 누가 먼저 받는지 · 대상 장비 · 기사 배정 · 만족도 평가 등
        유형별 처리 단계는 <Link href="/admin/workflow">AS 처리 흐름</Link>에서 정합니다.
      </SecHead>
      <ul className="svc-grid">
        {data.types.map((t) => {
          const isOn = on.has(t.rceptTy), changed = t.enabled !== isOn;
          return (
            <li key={t.rceptTy} className={"svc-c" + (isOn ? " on" : "") + (changed ? " changed" : "")}>
              <label>
                <span className="svc-ic"><QuickIcon name={ICON[t.rceptTy]} /></span>
                <span className="svc-t">
                  <b>{t.name}</b>
                  <small>{DESC[t.rceptTy]}</small>
                  <span className="svc-meta">
                    <span className={"svc-st" + (isOn ? " on" : "")}>{isOn ? "사용" : "사용 안 함"}</span>
                    {!!t.openRequests && <span className="svc-open">처리 중 {t.openRequests.toLocaleString()}건</span>}
                    {changed && <span className="svc-chg">{isOn ? "켜짐 (저장 전)" : "꺼짐 (저장 전)"}</span>}
                  </span>
                </span>
                <input type="checkbox" role="switch" className="um-sw" aria-label={`${t.name} 사용`}
                  checked={isOn} onChange={(e) => flip(t.rceptTy, e.target.checked)} />
              </label>
            </li>
          );
        })}
      </ul>
      {hiding.length > 0 && (
        <div className="svc-warn" role="alert">
          <b>저장하면 처리 중인 AS가 숨겨집니다.</b>
          <ul>
            {hiding.map((t) => <li key={t.rceptTy}>{t.name}: 신청완료·접수완료 {t.openRequests}건</li>)}
          </ul>
          <span>이 건들은 목록·통계에서 빠지고 처리할 수 없게 됩니다. 기록은 지우지 않으며, 서비스를 다시 켜면 그대로 보입니다. 끄기 전에 처리를 끝내는 것을 권장합니다.</span>
        </div>
      )}
      {msg && <FormMsg kind="bad" text={msg} />}
      <SaveBar dirty={dirty} busy={busy} idle="변경 사항 없음" onReset={() => { setOn(new Set(data.asTypes)); setMsg(""); }} onSave={save} />
    </section>
  );
}

/* ---------- ③ 지연 알림 기준 ---------- */

interface AlertRule {
  rceptTy: RceptTy;
  name: string;
  inUse: boolean;
  receiveMin: number;
  escalateMin: number;
  visitGraceMin: number;
  enabled: boolean;
  isDefault: boolean;
  /** 근무 시간(근무 요일 · 시간대, 휴일 제외)으로 센다. false = 24시간 */
  businessHours: boolean;
}

/** 90 → "1시간 30분" */
function dur(min: number) {
  if (!Number.isFinite(min) || min <= 0) return "-";
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  return [d ? `${d}일` : "", h ? `${h}시간` : "", m && !d ? `${m}분` : ""].filter(Boolean).join(" ") || "0분";
}

/** 분을 숫자 + 단위(분 · 시간 · 일)로 입력한다. 저장은 분. */
function DurInput({ value, onChange, disabled, label }: { value: number; onChange: (m: number) => void; disabled?: boolean; label: string }) {
  const fit = (m: number) => (m > 0 && m % 1440 === 0 ? 1440 : m > 0 && m % 60 === 0 ? 60 : 1);
  const [u, setU] = useState(() => fit(value));
  // 고른 단위로 나누어떨어지지 않는 값(되돌리기 등)이면 맞는 단위로 보여 준다
  const unit = value % u === 0 ? u : fit(value);
  const shown = value / unit;
  return (
    <span className="svc-dur">
      <input type="number" min={1} max={unit === 1 ? 43200 : unit === 60 ? 720 : 30} step={1} aria-label={`${label} (숫자)`} value={shown} disabled={disabled}
        onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value) * unit)))} />
      <select aria-label={`${label} 단위`} value={unit} disabled={disabled} onChange={(e) => { const nu = Number(e.target.value); setU(nu); onChange(Math.max(nu, Math.round(value / nu) * nu)); }}>
        <option value={1}>분</option>
        <option value={60}>시간</option>
        <option value={1440}>일</option>
      </select>
    </span>
  );
}

function AlertRulesForm() {
  const toast = useToast();
  const [rules, setRules] = useState<AlertRule[] | null>(null);
  const [saved, setSaved] = useState("");
  // 되돌리기 · 저장 뒤에는 입력 칸의 단위를 값에 맞게 다시 고른다
  const [gen, setGen] = useState(0);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setErr("");
    api.get<{ rules: AlertRule[] }>("/api/org/alert-rules").then((d) => { setRules(d.rules); setSaved(JSON.stringify(d.rules)); })
      .catch((e) => setErr((e as Error).message));
  }, []);
  useEffect(load, [load]);

  if (err) return <ErrorBox message={err} onRetry={load} />;
  if (!rules) return <Loading />;
  const shown = rules.filter((r) => r.inUse);
  const dirty = JSON.stringify(rules) !== saved;
  const set = (ty: RceptTy, k: keyof AlertRule, v: number | boolean) => { setRules(rules.map((r) => (r.rceptTy === ty ? { ...r, [k]: v } : r))); setMsg(""); };

  const save = async () => {
    for (const r of shown) {
      if (r.receiveMin < 1 || r.escalateMin < 1 || r.visitGraceMin < 1) return setMsg(`${r.name}: 시간은 1분 이상이어야 합니다.`);
      if (r.escalateMin < r.receiveMin) return setMsg(`${r.name}: 에스컬레이션은 접수 지연 시간보다 같거나 길어야 합니다.`);
    }
    setBusy(true);
    try {
      const d = await api.put<{ rules: AlertRule[] }>("/api/org/alert-rules", { rules: shown });
      setRules(d.rules); setSaved(JSON.stringify(d.rules)); setGen((g) => g + 1);
      toast("지연 알림 기준을 저장했습니다.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const runNow = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ receive: number; escalated: number; visit: number }>("/api/org/alert-rules/run", {});
      const n = r.receive + r.escalated + r.visit;
      toast(n ? `지연 알림을 보냈습니다: 접수 지연 ${r.receive} · 에스컬레이션 ${r.escalated} · 방문 지연 ${r.visit}` : "새로 알릴 지연 건이 없습니다.");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="svc-3" className="svc-sec" aria-labelledby="svc-3-t">
      <SecHead n={3} title="지연 알림 기준" sub="처리 중인 AS를 5분마다 확인해, 늦어지는 건을 단계마다 한 번씩 알립니다.">
        <b>시간 계산</b>이 &lsquo;근무 시간&rsquo;이면 ② 근무 요일 · 시간대만 세고(휴일 제외), &lsquo;24시간&rsquo;이면 밤 · 주말도 셉니다 (스쿨넷처럼 24시간 관제하는 서비스).
        신청 후 <b>접수 지연</b> 시간이 지나도 접수되지 않으면 담당 업체(업체 관리자 · 배정된 기사)에, <b>에스컬레이션</b> 시간까지도 접수되지 않으면
        그 유형을 맡은 관할 교육지원청 담당자에게 알립니다. 방문예정일시에서 <b>방문 지연 여유</b>가 지나도 처리 보고서가 없으면 업체와 교육지원청에 알립니다.
      </SecHead>
      <div className="svc-rules">
        {shown.map((r) => {
          const w = r.businessHours ? "근무 " : "";
          return (
            <article key={r.rceptTy} className={"svc-rule" + (r.enabled ? "" : " off")} aria-label={`${r.name} 지연 알림`}>
              <header>
                <span className="svc-ic sm"><QuickIcon name={ICON[r.rceptTy]} /></span>
                <b>{r.name}</b>
                {r.isDefault && <small className="hint">기본값</small>}
                <span className="svc-rule-sw">
                  <small>{r.enabled ? "알림 켜짐" : "알림 꺼짐"}</small>
                  <input type="checkbox" role="switch" className="um-sw" aria-label={`${r.name} 지연 알림 사용`} checked={r.enabled} onChange={(e) => set(r.rceptTy, "enabled", e.target.checked)} />
                </span>
              </header>
              {r.enabled && (
                <>
                  <div className="svc-rule-f">
                    <div>
                      <span className="svc-fl">시간 계산</span>
                      <div className="sla-clkpick" role="radiogroup" aria-label={`${r.name} 시간 계산`}>
                        {([true, false] as const).map((b) => (
                          <label key={String(b)} className={r.businessHours === b ? "on" : ""}>
                            <input type="radio" name={`bh-${r.rceptTy}`} checked={r.businessHours === b} onChange={() => set(r.rceptTy, "businessHours", b)} /> {b ? "근무 시간" : "24시간"}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div><span className="svc-fl">접수 지연</span><DurInput key={`r${gen}`} label={`${r.name} 접수 지연`} value={r.receiveMin} onChange={(m) => set(r.rceptTy, "receiveMin", m)} /></div>
                    <div><span className="svc-fl">에스컬레이션</span><DurInput key={`e${gen}`} label={`${r.name} 에스컬레이션`} value={r.escalateMin} onChange={(m) => set(r.rceptTy, "escalateMin", m)} /></div>
                    <div><span className="svc-fl">방문 지연 여유</span><DurInput key={`v${gen}`} label={`${r.name} 방문 지연 여유`} value={r.visitGraceMin} onChange={(m) => set(r.rceptTy, "visitGraceMin", m)} /></div>
                  </div>
                  <ol className="svc-flow" aria-label="알림 순서">
                    <li><b>신청 후 {w}{dur(r.receiveMin)}</b> 미접수 → 업체에 알림</li>
                    <li className={r.escalateMin < r.receiveMin ? "bad" : ""}><b>{w}{dur(r.escalateMin)}</b>까지 미접수 → 교육지원청에 에스컬레이션</li>
                    <li><b>방문예정 + {w}{dur(r.visitGraceMin)}</b> 보고서 없음 → 방문 지연 알림</li>
                  </ol>
                </>
              )}
            </article>
          );
        })}
      </div>
      {msg && <FormMsg kind="bad" text={msg} />}
      <SaveBar dirty={dirty} busy={busy} idle="변경 사항 없음" onReset={() => { setRules(JSON.parse(saved)); setMsg(""); setGen((g) => g + 1); }} onSave={save}
        extra={<button type="button" className="btn sm sec" disabled={busy} onClick={runNow} title="저장된 기준으로 지금 바로 확인해 알립니다">지금 확인</button>} />
    </section>
  );
}

/* ---------- ② 근무 시간 · 휴일 ---------- */

interface WorkCal {
  workDays: number[];
  startTime: string;
  endTime: string;
  holidays: { date: string; name?: string }[];
  isDefault: boolean;
  workingNow: boolean;
}

const DOW = ["", "월", "화", "수", "목", "금", "토", "일"];
/** 양력 고정 공휴일. 설날 · 추석 · 부처님오신날(음력)과 대체공휴일 · 선거일은 해마다 직접 넣는다. */
const SOLAR_HOLIDAYS: [string, string][] = [
  ["01-01", "신정"], ["03-01", "삼일절"], ["05-05", "어린이날"], ["06-06", "현충일"],
  ["08-15", "광복절"], ["10-03", "개천절"], ["10-09", "한글날"], ["12-25", "성탄절"],
];

/** "월~금" · "월·수·금" */
function daysLabel(d: number[]) {
  const s = [...d].sort((a, b) => a - b);
  if (!s.length) return "근무 요일 없음";
  return s.length > 2 && s[s.length - 1] - s[0] === s.length - 1 ? `${DOW[s[0]]}~${DOW[s[s.length - 1]]}` : s.map((x) => DOW[x]).join("·");
}
const hm = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); };

/** 자주 쓰는 근무 시간 */
const WORK_PRESETS: [string, string][] = [["09:00", "18:00"], ["08:30", "17:30"], ["08:00", "17:00"], ["09:00", "17:00"]];
/** 직접 넣는 휴일 이름 (음력 · 해마다 바뀌는 날) */
const HOLIDAY_NAMES = ["설날", "추석", "부처님오신날", "대체공휴일", "선거일", "재량휴업일"];
/** 00:00 ~ 23:30, 30분 간격 */
const HALF_HOURS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

/** 24시간제 30분 단위 시각 고르기 (저장된 값이 30분 단위가 아니면 그 값도 보인다) */
function TimeSelect({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const opts = HALF_HOURS.includes(value) ? HALF_HOURS : [...HALF_HOURS, value].sort();
  return (
    <select className="wt-sel" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {opts.map((t) => <option key={t} value={t}>{t}</option>)}
    </select>
  );
}

/** 이 달력을 쓰는 곳: 근무 시간으로 세는 지연 알림 · SLA 단계 (SLA는 권한이 있을 때만 보인다) */
function useCalendarUsers() {
  const [u, setU] = useState<string[] | null>(null);
  useEffect(() => {
    Promise.all([
      api.get<{ rules: AlertRule[] }>("/api/org/alert-rules").then((d) => d.rules.filter((r) => r.inUse && r.enabled && r.businessHours).map((r) => `${r.name} 지연 알림`)).catch(() => [] as string[]),
      api.get<{ targets: { receiveBiz?: boolean; visitBiz?: boolean; recoverBiz?: boolean } }>("/api/as/sla").then((d) => {
        const st = [d.targets.receiveBiz && "접수", d.targets.visitBiz && "도착", d.targets.recoverBiz && "복구"].filter(Boolean);
        return st.length ? [`스쿨넷 SLA (${st.join(" · ")})`] : [];
      }).catch(() => [] as string[]),
    ]).then(([a, s]) => setU([...a, ...s]));
  }, []);
  return u;
}

function WorkCalendarForm() {
  const toast = useToast();
  const users = useCalendarUsers();
  const [c, setC] = useState<WorkCal | null>(null);
  const [saved, setSaved] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [nd, setNd] = useState("");
  const [nn, setNn] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());

  const load = useCallback(() => {
    setErr("");
    api.get<WorkCal>("/api/org/alert-rules/calendar").then((d) => { setC(d); setSaved(JSON.stringify(d)); }).catch((e) => setErr((e as Error).message));
  }, []);
  useEffect(load, [load]);

  if (err) return <ErrorBox message={err} onRetry={load} />;
  if (!c) return <Loading />;
  const dirty = JSON.stringify(c) !== saved;
  const upd = (x: Partial<WorkCal>) => { setC({ ...c, ...x }); setMsg(""); };
  const sortH = (h: WorkCal["holidays"]) => [...h].sort((a, z) => a.date.localeCompare(z.date));
  const addHoliday = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nd)) return setMsg("휴일 날짜를 선택해 주세요.");
    if (c.holidays.some((h) => h.date === nd)) return setMsg("이미 있는 날짜입니다.");
    upd({ holidays: sortH([...c.holidays, { date: nd, name: nn.trim() || undefined }]) });
    setYear(Number(nd.slice(0, 4)));
    setNd(""); setNn("");
  };
  const addSolar = () => {
    const have = new Set(c.holidays.map((h) => h.date));
    const add = SOLAR_HOLIDAYS.map(([md, name]) => ({ date: `${year}-${md}`, name })).filter((h) => !have.has(h.date));
    upd({ holidays: sortH([...c.holidays, ...add]) });
    toast(add.length ? `${year}년 양력 공휴일 ${add.length}일을 넣었습니다. 설날 · 추석 · 부처님오신날 · 대체공휴일은 직접 추가해 주세요.` : "이미 모두 들어 있습니다.");
  };
  const save = async () => {
    if (!c.workDays.length) return setMsg("근무 요일을 하루 이상 선택해 주세요.");
    if (c.endTime <= c.startTime) return setMsg("근무 종료 시각은 시작 시각보다 늦어야 합니다.");
    setBusy(true);
    try {
      const d = await api.put<WorkCal>("/api/org/alert-rules/calendar", { workDays: c.workDays, startTime: c.startTime, endTime: c.endTime, holidays: c.holidays });
      setC(d); setSaved(JSON.stringify(d));
      toast("근무 시간 · 휴일을 저장했습니다.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const thisYear = c.holidays.filter((h) => h.date.startsWith(String(year)));
  const other = c.holidays.length - thisYear.length;
  const dayMin = Math.max(0, hm(c.endTime) - hm(c.startTime));
  const weekH = Math.round((dayMin * c.workDays.length) / 6) / 10;

  return (
    <section id="svc-2" className="svc-sec" aria-labelledby="svc-2-t">
      <SecHead n={2} title="근무 시간 · 휴일" sub={
        <>
          <b>{daysLabel(c.workDays)} {c.startTime}~{c.endTime}</b> · 주 {weekH}시간 · {year}년 휴일 {thisYear.length}일{" "}
          <span className={"cal-now" + (c.workingNow ? " on" : "")}>{c.workingNow ? "지금은 근무 시간" : "지금은 근무 시간 아님"}</span>
        </>
      }>
        &lsquo;근무 시간&rsquo;으로 세는 지연 알림 · 스쿨넷 SLA 단계는 이 근무 요일 · 시간대만 셉니다. 예) 금요일 17시 신청, 기준 4시간 → 금요일 1시간 + 월요일 3시간 → 월요일 12시에 지연.
        휴일은 근무 요일이어도 세지 않습니다. 점심시간은 따로 빼지 않습니다.
      </SecHead>
      <p className="svc-users">
        <span>이 달력을 쓰는 곳:</span>
        {users == null ? <small className="hint">확인 중…</small> : users.length ? users.map((x) => <span key={x} className="svc-chip">{x}</span>) : <small className="hint">없음 — 모두 24시간으로 셉니다</small>}
      </p>
      <div className="um-card cal-card">
        <div className="cal-row">
          <b>근무 요일</b>
          <span className="cal-days" role="group" aria-label="근무 요일">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <label key={d} className={(c.workDays.includes(d) ? "on" : "") + (d >= 6 ? " we" : "")}>
                <input type="checkbox" checked={c.workDays.includes(d)} onChange={(e) => upd({ workDays: e.target.checked ? [...c.workDays, d].sort() : c.workDays.filter((x) => x !== d) })} />
                {DOW[d]}
              </label>
            ))}
          </span>
        </div>
        <div className="cal-row top">
          <b>근무 시간</b>
          <div className="wt">
            <div className="wt-pick">
              <TimeSelect label="근무 시작" value={c.startTime} onChange={(v) => upd({ startTime: v })} />
              <span className="wt-arrow" aria-hidden="true">→</span>
              <TimeSelect label="근무 종료" value={c.endTime} onChange={(v) => upd({ endTime: v })} />
              <span className={"wt-len" + (dayMin ? "" : " bad")}>{dayMin ? `하루 ${dur(dayMin)}` : "종료가 시작보다 늦어야 합니다"}</span>
            </div>
            <div className="wt-bar" aria-hidden="true">
              <i style={{ left: `${(hm(c.startTime) / 1440) * 100}%`, width: `${(dayMin / 1440) * 100}%` }} />
              {[0, 6, 12, 18, 24].map((h) => <span key={h} style={{ left: `${(h / 24) * 100}%` }}>{h}시</span>)}
            </div>
            <div className="wt-pre" role="group" aria-label="자주 쓰는 근무 시간">
              {WORK_PRESETS.map(([s, e]) => (
                <button key={s} type="button" className={c.startTime === s && c.endTime === e ? "on" : ""} onClick={() => upd({ startTime: s, endTime: e })}>{s}~{e}</button>
              ))}
              <small className="hint">점심시간은 빼지 않습니다.</small>
            </div>
          </div>
        </div>
        <div className="cal-row top">
          <b>휴일</b>
          <div className="hd">
            <div className="hd-top">
              <div className="my-chips" role="group" aria-label="연도">
                {[0, 1, 2].map((i) => { const y = new Date().getFullYear() - 1 + i; const n = c.holidays.filter((h) => h.date.startsWith(String(y))).length; return (
                  <button key={y} type="button" className={y === year ? "on" : ""} aria-pressed={y === year} onClick={() => setYear(y)}>{y}년 <b>{n}</b></button>
                ); })}
              </div>
              <button type="button" className="btn sm sec" onClick={addSolar}>{year}년 양력 공휴일 넣기</button>
            </div>
            <div className="hd-add">
              <input type="date" aria-label="휴일 날짜" value={nd} min={`${year}-01-01`} max={`${year}-12-31`} onChange={(e) => setNd(e.target.value)} />
              <input aria-label="휴일 이름" placeholder="이름 (선택)" maxLength={50} value={nn} onChange={(e) => setNn(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addHoliday(); } }} />
              <button type="button" className="btn sm" onClick={addHoliday} disabled={!nd}>추가</button>
              <span className="hd-sug" role="group" aria-label="이름 고르기">
                {HOLIDAY_NAMES.map((x) => <button key={x} type="button" className={nn === x ? "on" : ""} onClick={() => setNn(x)}>{x}</button>)}
              </span>
            </div>
            <div className="hd-grid" aria-label={`${year}년 휴일`}>
              {Array.from({ length: 12 }, (_, i) => {
                const mm = String(i + 1).padStart(2, "0");
                const list = thisYear.filter((h) => h.date.slice(5, 7) === mm);
                // 근무 요일에 걸린 휴일이 있는 달만 강조 (주말 휴일은 시간 계산에 영향이 없다)
                const counts = list.some((h) => c.workDays.includes(((new Date(h.date + "T00:00").getDay() + 6) % 7) + 1));
                return (
                  <div key={mm} className={"hd-m" + (list.length ? " has" : "") + (counts ? " hit" : "")}>
                    <span className="hd-mn">{i + 1}월</span>
                    {list.length ? (
                      <ul>
                        {list.map((h) => {
                          const dow = ((new Date(h.date + "T00:00").getDay() + 6) % 7) + 1;
                          const off = !c.workDays.includes(dow);
                          return (
                            <li key={h.date} className={off ? "off" : ""} title={off ? "근무하지 않는 요일이라 시간 계산에 영향이 없습니다" : undefined}>
                              <span className="hd-d">{Number(h.date.slice(8))}<small>({DOW[dow]})</small></span>
                              <span className="hd-n">{h.name ?? "휴일"}</span>
                              <button type="button" className="cal-x" aria-label={`${h.date} ${h.name ?? "휴일"} 빼기`} onClick={() => upd({ holidays: c.holidays.filter((x) => x.date !== h.date) })}>×</button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : <span className="hd-none">—</span>}
                  </div>
                );
              })}
            </div>
            <small className="hint">
              {thisYear.length ? `${year}년 휴일 ${thisYear.length}일 (근무 요일에 걸린 날 ${thisYear.filter((h) => c.workDays.includes(((new Date(h.date + "T00:00").getDay() + 6) % 7) + 1)).length}일). ` : `${year}년 휴일이 없습니다. `}
              설날 · 추석 · 부처님오신날 · 대체공휴일 · 선거일 · 재량휴업일은 날짜를 골라 직접 추가하세요.{other > 0 ? ` 다른 해의 휴일 ${other}일도 저장되어 있습니다.` : ""}
            </small>
          </div>
        </div>
      </div>
      {msg && <FormMsg kind="bad" text={msg} />}
      <SaveBar dirty={dirty} busy={busy} idle={c.isDefault ? "기본값 (월~금 09:00~18:00)" : "변경 사항 없음"} onReset={() => { setC(JSON.parse(saved)); setMsg(""); }} onSave={save} />
    </section>
  );
}
