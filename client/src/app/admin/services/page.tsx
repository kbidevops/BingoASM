"use client";

import { useCallback, useEffect, useState } from "react";
import SubPage from "@/components/SubPage";
import { ErrorBox, FormMsg, Loading, useToast } from "@/components/ui";
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

export default function Page() {
  return (
    <SubPage perm="ORG_WRITE">
      <AsServicesForm />
      <SchoolnetRouteForm />
      <WorkCalendarForm />
      <AlertRulesForm />
    </SubPage>
  );
}

/** 통합관리 → AS 서비스 설정: which AS services this 교육청 uses. */
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
    <div style={{ display: "grid", gap: 14 }}>
      <p className="um-note">
        이 교육청에서 쓰는 AS 서비스만 켜 두세요. 끈 서비스는 모든 사용자에게서 메뉴와 신청·이관이 함께 닫히고,
        사용자별 메뉴 권한으로도 열 수 없습니다. 이미 있는 신청 기록은 지우지 않으며 다시 켜면 그대로 보입니다.
      </p>
      <section className="um-card" aria-label="AS 서비스">
        <div className="um-card-h">
          <div>
            <b>AS 서비스</b>
            <small>{on.size}/{data.types.length} 사용</small>
          </div>
        </div>
        <ul className="um-items">
          {data.types.map((t) => (
            <li key={t.rceptTy}>
              <div className="um-item-t">
                <span>{t.name}</span>
                <small>{DESC[t.rceptTy]}</small>
                {!!t.openRequests && <small className="svc-open">처리 중 AS {t.openRequests.toLocaleString()}건</small>}
              </div>
              {on.has(t.rceptTy) ? <span className="um-pill add">사용</span> : <span className="um-pill none">사용 안 함</span>}
              <input type="checkbox" role="switch" className="um-sw" aria-label={`${t.name} 사용`}
                checked={on.has(t.rceptTy)} onChange={(e) => flip(t.rceptTy, e.target.checked)} />
            </li>
          ))}
        </ul>
      </section>
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
      <div className={"um-bar" + (dirty ? " dirty" : "")}>
        <span className="um-bar-t">{dirty ? "저장하지 않은 변경이 있습니다" : "변경 사항 없음"}</span>
        <button type="button" className="btn sm sec" disabled={!dirty || busy} onClick={() => { setOn(new Set(data.asTypes)); setMsg(""); }}>되돌리기</button>
        <button type="button" className="btn sm" disabled={!dirty || busy} onClick={save}>{busy ? "저장 중…" : "저장"}</button>
      </div>
    </div>
  );
}

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

/**
 * 지연 알림 기준 (/api/org/alert-rules): 유형마다 접수 지연 → 업체, 에스컬레이션 → 교육지원청 담당자(담당 유형),
 * 방문 지연 → 업체 + 교육지원청. 서버가 5분마다 확인하고, 한 건에 단계마다 한 번만 알린다.
 */
function AlertRulesForm() {
  const toast = useToast();
  const [rules, setRules] = useState<AlertRule[] | null>(null);
  const [saved, setSaved] = useState("");
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
      if (r.escalateMin < r.receiveMin) return setMsg(`${r.name}: 에스컬레이션은 접수 지연 시간보다 같거나 길어야 합니다.`);
    }
    setBusy(true);
    try {
      const d = await api.put<{ rules: AlertRule[] }>("/api/org/alert-rules", { rules: shown });
      setRules(d.rules); setSaved(JSON.stringify(d.rules));
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
    <div style={{ display: "grid", gap: 14, marginTop: 28 }}>
      <p className="um-note">
        <b>지연 알림 기준</b> — 처리 중인 AS를 5분마다 확인합니다. <b>시간 계산</b>이 &lsquo;근무 시간&rsquo;이면 위 근무 요일 · 시간대만 세고(휴일 제외),
        &lsquo;24시간&rsquo;이면 밤 · 주말도 셉니다 (스쿨넷처럼 24시간 관제하는 서비스). 신청 후 <b>접수 지연</b> 시간이 지나도 접수되지 않으면 담당 업체(업체 관리자 · 배정된 기사)에,
        <b> 에스컬레이션</b> 시간까지도 접수되지 않으면 그 유형을 맡은 관할 교육지원청 담당자에게 알립니다. 방문예정일시에서 <b>방문 지연 여유</b>가 지나도
        처리 보고서가 없으면 업체와 교육지원청에 알립니다. 한 건에 단계마다 한 번만 알립니다.
      </p>
      <section className="um-card" aria-label="지연 알림 기준">
        <div className="tw">
          <table className="ar-tab" style={{ minWidth: 640 }}>
            <thead><tr><th scope="col">AS 유형</th><th scope="col">알림</th><th scope="col">시간 계산</th><th scope="col">접수 지연 (분)</th><th scope="col">에스컬레이션 (분)</th><th scope="col">방문 지연 여유 (분)</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.rceptTy}>
                  <th scope="row">{r.name}{r.isDefault && <small> (기본값)</small>}</th>
                  <td><input type="checkbox" role="switch" className="um-sw" aria-label={`${r.name} 지연 알림 사용`} checked={r.enabled} onChange={(e) => set(r.rceptTy, "enabled", e.target.checked)} /></td>
                  <td>
                    <select aria-label={`${r.name} 시간 계산`} value={r.businessHours ? "B" : "C"} disabled={!r.enabled} onChange={(e) => set(r.rceptTy, "businessHours", e.target.value === "B")}>
                      <option value="B">근무 시간</option>
                      <option value="C">24시간</option>
                    </select>
                  </td>
                  {(["receiveMin", "escalateMin", "visitGraceMin"] as const).map((k) => (
                    <td key={k}>
                      <input type="number" min={1} max={43200} aria-label={`${r.name} ${k === "receiveMin" ? "접수 지연" : k === "escalateMin" ? "에스컬레이션" : "방문 지연 여유"} (분)`}
                        value={r[k]} disabled={!r.enabled} onChange={(e) => set(r.rceptTy, k, Number(e.target.value))} />{" "}
                      <small>{r.businessHours ? "근무 " : ""}{dur(r[k])}</small>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {msg && <FormMsg kind="bad" text={msg} />}
      <div className={"um-bar" + (dirty ? " dirty" : "")}>
        <span className="um-bar-t">{dirty ? "저장하지 않은 변경이 있습니다" : "변경 사항 없음"}</span>
        <button type="button" className="btn sm sec" disabled={busy} onClick={runNow}>지금 확인</button>
        <button type="button" className="btn sm sec" disabled={!dirty || busy} onClick={() => { setRules(JSON.parse(saved)); setMsg(""); }}>되돌리기</button>
        <button type="button" className="btn sm" disabled={!dirty || busy} onClick={save}>{busy ? "저장 중…" : "저장"}</button>
      </div>
    </div>
  );
}

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

/** 근무 시간 · 휴일 (/api/org/alert-rules/calendar): 지연 알림을 '근무 시간'으로 셀 때 쓰는 달력. */
function WorkCalendarForm() {
  const toast = useToast();
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

  return (
    <div style={{ display: "grid", gap: 14, marginTop: 28 }}>
      <p className="um-note">
        <b>근무 시간 · 휴일</b> — 지연 알림의 시간 계산이 &lsquo;근무 시간&rsquo;인 서비스는 아래 근무 요일 · 시간대만 셉니다.
        예) 금요일 17시 신청, 기준 4시간 → 금요일 1시간 + 월요일 3시간 → 월요일 12시에 지연. 휴일은 근무 요일이어도 세지 않습니다.
        {" "}<span className={"cal-now" + (c.workingNow ? " on" : "")}>{c.workingNow ? "지금은 근무 시간입니다" : "지금은 근무 시간이 아닙니다"}</span>
      </p>
      <section className="um-card cal-card" aria-label="근무 시간">
        <div className="cal-row">
          <b>근무 요일</b>
          <span className="cal-days" role="group" aria-label="근무 요일">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <label key={d} className={c.workDays.includes(d) ? "on" : ""}>
                <input type="checkbox" checked={c.workDays.includes(d)} onChange={(e) => upd({ workDays: e.target.checked ? [...c.workDays, d].sort() : c.workDays.filter((x) => x !== d) })} />
                {DOW[d]}
              </label>
            ))}
          </span>
        </div>
        <div className="cal-row">
          <b>근무 시간</b>
          <span>
            <input type="time" aria-label="근무 시작" value={c.startTime} onChange={(e) => upd({ startTime: e.target.value })} /> ~{" "}
            <input type="time" aria-label="근무 종료" value={c.endTime} onChange={(e) => upd({ endTime: e.target.value })} />
            <small className="hint"> 점심시간은 따로 빼지 않습니다.</small>
          </span>
        </div>
        <div className="cal-row top">
          <b>휴일</b>
          <div className="cal-hol">
            <div className="cal-add">
              <input type="date" aria-label="휴일 날짜" value={nd} onChange={(e) => setNd(e.target.value)} />
              <input aria-label="휴일 이름" placeholder="이름 (예: 추석, 재량휴업일)" maxLength={50} value={nn} onChange={(e) => setNn(e.target.value)} />
              <button type="button" className="btn sm sec" onClick={addHoliday}>추가</button>
              <span className="cal-sep" aria-hidden="true" />
              <select aria-label="연도" value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {[0, 1, 2].map((i) => { const y = new Date().getFullYear() - 1 + i; return <option key={y} value={y}>{y}년</option>; })}
              </select>
              <button type="button" className="btn sm sec" onClick={addSolar}>양력 공휴일 넣기</button>
            </div>
            {thisYear.length ? (
              <ul className="cal-list">
                {thisYear.map((h) => (
                  <li key={h.date}>
                    <span>{h.date.slice(5).replace("-", "/")} ({DOW[((new Date(h.date + "T00:00").getDay() + 6) % 7) + 1]})</span>
                    <b>{h.name ?? "휴일"}</b>
                    <button type="button" className="cal-x" aria-label={`${h.date} 휴일 빼기`} onClick={() => upd({ holidays: c.holidays.filter((x) => x.date !== h.date) })}>×</button>
                  </li>
                ))}
              </ul>
            ) : <p className="hint">{year}년 휴일이 없습니다.</p>}
            {other > 0 && <small className="hint">다른 해의 휴일 {other}일도 저장되어 있습니다 (연도를 바꿔 보세요).</small>}
          </div>
        </div>
      </section>
      {msg && <FormMsg kind="bad" text={msg} />}
      <div className={"um-bar" + (dirty ? " dirty" : "")}>
        <span className="um-bar-t">{dirty ? "저장하지 않은 변경이 있습니다" : c.isDefault ? "기본값 (월~금 09:00~18:00)" : "변경 사항 없음"}</span>
        <button type="button" className="btn sm sec" disabled={!dirty || busy} onClick={() => { setC(JSON.parse(saved)); setMsg(""); }}>되돌리기</button>
        <button type="button" className="btn sm" disabled={!dirty || busy} onClick={save}>{busy ? "저장 중…" : "저장"}</button>
      </div>
    </div>
  );
}

/** 스쿨넷 신고 접수처 (/api/org/as-services의 schoolnetRoute). */
function SchoolnetRouteForm() {
  const toast = useToast();
  const [d, setD] = useState<AsServices | null>(null);
  const [route, setRoute] = useState<"REGION" | "VENDOR">("REGION");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get<AsServices>("/api/org/as-services").then((x) => { setD(x); setRoute(x.schoolnetRoute ?? "REGION"); }).catch(() => {});
  }, []);
  if (!d || !d.asTypes.includes("S")) return null;
  const dirty = route !== (d.schoolnetRoute ?? "REGION");
  const save = async () => {
    setBusy(true);
    try {
      const x = await api.put<AsServices>("/api/org/as-services", { asTypes: d.asTypes, schoolnetRoute: route });
      setD(x); setRoute(x.schoolnetRoute ?? "REGION");
      toast("스쿨넷 신고 접수처를 저장했습니다.");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: "grid", gap: 14, marginTop: 28 }}>
      <p className="um-note">
        <b>스쿨넷 신고 접수처</b> — 학교의 스쿨넷 신고를 누가 먼저 받을지 정합니다. 교육지원청이 먼저 받으면 NMS로 확인한 뒤
        직접 처리하거나, 통신사에 넘기거나, 교육청으로 올립니다 (AS 상세의 &lsquo;처리 담당 지정&rsquo;). 이미 들어온 신고는 바뀌지 않습니다.
      </p>
      <section className="um-card hd-pick" role="radiogroup" aria-label="스쿨넷 신고 접수처" style={{ padding: 12 }}>
        {([["REGION", "교육지원청이 먼저 확인 (권장)", "그 유형을 맡은 관할 교육지원청 담당자에게 갑니다. 업체는 정해지지 않습니다."],
           ["VENDOR", "통신사로 바로", "학교 관리에서 배정한 스쿨넷 업체(통신사)에게 바로 갑니다."]] as const).map(([k, l, h]) => (
          <label key={k} className={route === k ? "on" : ""}>
            <input type="radio" name="snroute" checked={route === k} onChange={() => setRoute(k)} />
            <b>{l}</b><small>{h}</small>
          </label>
        ))}
      </section>
      <div className={"um-bar" + (dirty ? " dirty" : "")}>
        <span className="um-bar-t">{dirty ? "저장하지 않은 변경이 있습니다" : "변경 사항 없음"}</span>
        <button type="button" className="btn sm" disabled={!dirty || busy} onClick={save}>{busy ? "저장 중…" : "저장"}</button>
      </div>
    </div>
  );
}
