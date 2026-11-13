"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import SubPage from "@/components/SubPage";
import { ErrorBox, FormMsg, Loading, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import type { RceptTy } from "@/lib/types";

/**
 * AS 처리 흐름 (/api/org/workflows): AS 유형마다 단계별로 누가 하는지 · 꼭 하는지를 고르면 흐름도가 바로 다시 그려진다.
 * 상태(신청완료 → 접수완료 → 처리완료 / 반려)는 고정이다. 지연 알림 기준은 AS 서비스 설정에서 (여기서는 흐름도에 함께 보여 준다).
 */
export default function Page() {
  return (
    <SubPage perm="ORG_WRITE">
      <WorkflowEditor />
    </SubPage>
  );
}

interface Flow {
  rceptTy: RceptTy;
  name: string;
  inUse: boolean;
  hasDevices: boolean;
  firstReceiver: "VENDOR" | "REGION";
  deviceLink: "REQUIRED" | "RECOMMENDED" | "OPTIONAL" | "NONE";
  vendorSource: "SCHOOL" | "DEVICE";
  engineerAssign: "ADMIN" | "AUTO";
  officeHandling: boolean;
  arrivalRequired: boolean;
  evaluation: boolean;
  isDefault: boolean;
}
interface AlertRule { rceptTy: RceptTy; receiveMin: number; escalateMin: number; visitGraceMin: number; enabled: boolean; businessHours: boolean }

function dur(min: number) {
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  return [d ? `${d}일` : "", h ? `${h}시간` : "", m && !d ? `${m}분` : ""].filter(Boolean).join(" ") || "0분";
}

function WorkflowEditor() {
  const toast = useToast();
  const [flows, setFlows] = useState<Flow[] | null>(null);
  const [saved, setSaved] = useState("");
  const [alerts, setAlerts] = useState<AlertRule[]>([]);
  const [ty, setTy] = useState<RceptTy | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setErr("");
    api.get<{ flows: Flow[] }>("/api/org/workflows").then((d) => {
      setFlows(d.flows); setSaved(JSON.stringify(d.flows));
      setTy((t) => t ?? (d.flows.find((f) => f.inUse) ?? d.flows[0]).rceptTy);
    }).catch((e) => setErr((e as Error).message));
    api.get<{ rules: AlertRule[] }>("/api/org/alert-rules").then((d) => setAlerts(d.rules)).catch(() => setAlerts([]));
  }, []);
  useEffect(load, [load]);

  if (err) return <ErrorBox message={err} onRetry={load} />;
  if (!flows || !ty) return <Loading />;
  const f = flows.find((x) => x.rceptTy === ty)!;
  const shown = flows.filter((x) => x.inUse);
  const dirty = JSON.stringify(flows) !== saved;
  const set = <K extends keyof Flow>(k: K, v: Flow[K]) => {
    setMsg("");
    setFlows(flows.map((x) => {
      if (x.rceptTy !== ty) return x;
      const n = { ...x, [k]: v };
      // 교육지원청이 먼저 받으면 직접 처리(처리 담당 지정)는 꼭 켜져 있어야 한다
      if (k === "firstReceiver" && v === "REGION") n.officeHandling = true;
      return n;
    }));
  };
  const save = async () => {
    setBusy(true);
    try {
      const d = await api.put<{ flows: Flow[] }>("/api/org/workflows", { flows: flows.filter((x) => x.inUse) });
      setFlows(d.flows); setSaved(JSON.stringify(d.flows));
      toast("AS 처리 흐름을 저장했습니다. 새로 들어오는 신고부터 적용됩니다.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wf">
      <p className="um-note">
        AS 유형마다 단계별로 <b>누가 하는지</b>, <b>꼭 하는지</b>를 고르세요. 오른쪽 흐름도가 바로 바뀝니다.
        상태(신청완료 → 접수완료 → 처리완료 / 반려)는 모든 유형이 같습니다. 바꾼 흐름은 <b>새로 들어오는 신고부터</b> 적용되고, 처리 중인 건의 담당은 그대로입니다.
      </p>
      <div className="wf-tabs" role="tablist" aria-label="AS 유형">
        {shown.map((x) => (
          <button key={x.rceptTy} type="button" role="tab" aria-selected={x.rceptTy === ty} className={x.rceptTy === ty ? "on" : ""} onClick={() => setTy(x.rceptTy)}>
            {x.name}{JSON.stringify(x) !== JSON.stringify(JSON.parse(saved).find((s: Flow) => s.rceptTy === x.rceptTy)) && <span className="wf-dot" aria-label="바뀜" />}
          </button>
        ))}
      </div>

      <div className="wf-body">
        <section className="wf-form um-card" aria-label={`${f.name} 처리 흐름 설정`}>
          <Choice label="① 첫 접수처" value={f.firstReceiver} onChange={(v) => set("firstReceiver", v)} options={[
            ["VENDOR", "업체로 바로", "학교 신고가 담당 업체(통신사)에 바로 갑니다."],
            ["REGION", "교육지원청이 먼저 확인", "업체 없이 교육지원청 담당자에게 갑니다. 확인 뒤 직접 처리하거나 업체에 넘깁니다."]]} />
          {f.hasDevices && (
            <Choice label="② 대상 장비 지정" value={f.deviceLink} onChange={(v) => set("deviceLink", v)} options={[
              ["REQUIRED", "필수", "장비가 지정돼야 처리 보고서를 쓸 수 있습니다."],
              ["RECOMMENDED", "권장", "교육지원청 '내 할 일'에 나옵니다. 없어도 처리는 됩니다."],
              ["OPTIONAL", "선택", "할 일에는 나오지 않습니다."],
              ["NONE", "사용 안 함", "대상 장비 지정 버튼이 없습니다."]]} />
          )}
          {f.hasDevices && (
            <Choice label="③ 업체 결정" value={f.vendorSource} onChange={(v) => set("vendorSource", v)} options={[
              ["SCHOOL", "학교 배정 업체", "학교 관리에서 정한 그 유형의 업체."],
              ["DEVICE", "장비의 유지보수 업체", "장비가 붙으면 그 장비의 업체가 맡습니다 (장비 없으면 학교 배정 업체)."]]} />
          )}
          <Choice label={`${f.hasDevices ? "④" : "②"} 기사 배정`} value={f.engineerAssign} onChange={(v) => set("engineerAssign", v)} options={[
            ["ADMIN", "업체 관리자가 지정", "학교 기본 담당 기사는 추천으로만 골라 둡니다."],
            ["AUTO", "학교 기본 담당 기사 자동", "신고와 함께 바로 배정됩니다. 업체 관리자가 바꿀 수 있습니다."]]} />
          <Toggle label="교육지원청 · 교육청 직접 처리" checked={f.officeHandling} disabled={f.firstReceiver === "REGION"} onChange={(v) => set("officeHandling", v)}
            hint={f.firstReceiver === "REGION" ? "교육지원청이 먼저 받으므로 켜져 있어야 합니다." : "업체 배정 대신 '처리 담당 지정' — 직접 처리 · 업체에 넘김 · 교육청으로 올림."} />
          <Toggle label="현장 도착 기록 필수" checked={f.arrivalRequired} onChange={(v) => set("arrivalRequired", v)}
            hint="업체가 처리하는 건은 처리 보고서 전에 '도착 기록'(장비 라벨 QR 등)이 있어야 합니다." />
          <Toggle label="만족도 평가" checked={f.evaluation} onChange={(v) => set("evaluation", v)} hint="끄면 처리완료 뒤 평가 요청 · 평가 대기 표시가 없습니다." />
        </section>

        <section className="wf-diagram" aria-label={`${f.name} 처리 흐름도`}>
          <h3>{f.name} AS 처리 흐름 {f.isDefault && JSON.stringify(flows) === saved && <small>(기본값)</small>}</h3>
          <Diagram f={f} alert={alerts.find((a) => a.rceptTy === f.rceptTy)} />
        </section>
      </div>

      {msg && <FormMsg kind="bad" text={msg} />}
      <div className={"um-bar" + (dirty ? " dirty" : "")}>
        <span className="um-bar-t">{dirty ? "저장하지 않은 변경이 있습니다" : "변경 사항 없음"}</span>
        <button type="button" className="btn sm sec" disabled={!dirty || busy} onClick={() => { setFlows(JSON.parse(saved)); setMsg(""); }}>되돌리기</button>
        <button type="button" className="btn sm" disabled={!dirty || busy} onClick={save}>{busy ? "저장 중…" : "저장"}</button>
      </div>
    </div>
  );
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, string, string])[]; onChange: (v: T) => void }) {
  return (
    <fieldset className="wf-q">
      <legend>{label}</legend>
      {options.map(([k, l, h]) => (
        <label key={k} className={value === k ? "on" : ""}>
          <input type="radio" name={label} checked={value === k} onChange={() => onChange(k)} />
          <b>{l}</b><small>{h}</small>
        </label>
      ))}
    </fieldset>
  );
}

function Toggle({ label, checked, onChange, hint, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint: string; disabled?: boolean }) {
  return (
    <div className="wf-t">
      <label>
        <input type="checkbox" role="switch" className="um-sw" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
        <b>{label}</b>
      </label>
      <small>{hint}</small>
    </div>
  );
}

type Actor = "school" | "region" | "vendor" | "engineer" | "system" | "province";
const ACTOR: Record<Actor, string> = { school: "학교", region: "교육지원청", vendor: "업체 관리자", engineer: "기사", system: "자동", province: "교육청" };
interface Step { actor: Actor; title: string; note?: string; badge?: string; off?: boolean; branches?: { label: string; note: string; actor: Actor }[] }

/** 고른 흐름 → 단계 목록 (서버 규칙과 같은 순서). */
function stepsOf(f: Flow): Step[] {
  const s: Step[] = [];
  s.push({ actor: "school", title: "증상 신고", note: f.hasDevices && f.deviceLink !== "NONE" ? "장비 라벨 QR로 신고하면 그 장비가 자동으로 연결됩니다." : undefined });
  if (f.firstReceiver === "REGION") {
    s.push({
      actor: "region", title: "1차 확인", note: "업체 없이, 그 유형을 맡은 관할 교육지원청 담당자에게 갑니다 (내 할 일 · 1차 확인).",
      branches: [
        { actor: "region", label: "직접 처리", note: "교육지원청 담당자가 접수 · 처리 보고서" },
        { actor: "vendor", label: f.rceptTy === "S" ? "통신사에 넘김" : "업체에 넘김", note: "아래 단계로 계속" },
        { actor: "province", label: "교육청으로 올림", note: "교육청 담당자가 처리" },
      ],
    });
  } else {
    s.push({ actor: "system", title: "업체에 전달", note: f.hasDevices && f.vendorSource === "DEVICE" ? "장비가 붙어 있으면 그 장비의 유지보수 업체, 없으면 학교 배정 업체" : "학교 배정 업체" });
  }
  if (f.hasDevices && f.deviceLink !== "NONE") {
    s.push({
      actor: "region", title: "대상 장비 지정", badge: { REQUIRED: "필수", RECOMMENDED: "권장", OPTIONAL: "선택", NONE: "" }[f.deviceLink],
      note: (f.vendorSource === "DEVICE" ? "다른 업체의 장비면 그 업체로 바뀝니다. " : "") + (f.deviceLink === "REQUIRED" ? "지정 전에는 처리 보고서를 쓸 수 없습니다." : f.deviceLink === "RECOMMENDED" ? "내 할 일에 나옵니다." : ""),
    });
  }
  if (f.officeHandling && f.firstReceiver !== "REGION")
    s.push({ actor: "region", title: "처리 담당 지정", badge: "필요할 때", note: "교육지원청 · 교육청이 직접 처리하거나 교육청으로 올릴 수 있습니다." });
  s.push(f.engineerAssign === "AUTO"
    ? { actor: "system", title: "기사 배정 (학교 기본 담당 기사)", note: "업체 관리자가 바꿀 수 있습니다." }
    : { actor: "vendor", title: "기사 지정", note: "학교 기본 담당 기사가 추천으로 골라져 있습니다." });
  s.push({ actor: "engineer", title: "접수", note: "방문예정일시를 정합니다." });
  s.push({ actor: "engineer", title: "현장 도착 기록", badge: f.arrivalRequired ? "필수" : "선택", note: f.hasDevices ? "장비 라벨 QR을 찍고 '도착 기록'." : "상세의 '도착 기록'." });
  s.push({ actor: "engineer", title: "처리 보고서 → 처리완료" });
  s.push(f.evaluation ? { actor: "school", title: "만족도 평가" } : { actor: "school", title: "만족도 평가 안 함", off: true });
  return s;
}

function Diagram({ f, alert }: { f: Flow; alert?: AlertRule }) {
  const steps = stepsOf(f);
  return (
    <>
      <ol className="wf-flow">
        {steps.map((s, i) => (
          <li key={i} className={"wf-step a-" + s.actor + (s.off ? " off" : "")}>
            <span className="wf-actor">{ACTOR[s.actor]}</span>
            <div className="wf-box">
              <b>{s.title}</b>{s.badge && <span className={"wf-badge" + (s.badge === "필수" ? " req" : "")}>{s.badge}</span>}
              {s.note && <small>{s.note}</small>}
              {s.branches && (
                <ul className="wf-br">
                  {s.branches.map((b) => <li key={b.label} className={"a-" + b.actor}><b>{b.label}</b><small>{b.note}</small></li>)}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
      <div className="wf-alert">
        <b>지연 알림</b>{" "}
        {alert && alert.enabled ? (
          <span>
            ({alert.businessHours ? "근무 시간" : "24시간"} 기준) 접수 지연 {dur(alert.receiveMin)} → {f.firstReceiver === "REGION" ? "교육지원청" : "업체"},
            {" "}에스컬레이션 {dur(alert.escalateMin)} → 교육지원청{f.officeHandling ? " (교육지원청 · 교육청이 맡은 건은 교육청까지)" : ""}, 방문 지연 여유 {dur(alert.visitGraceMin)}
          </span>
        ) : <span>사용 안 함</span>}
        {" "}<Link href="/admin/services">기준 바꾸기</Link>
      </div>
    </>
  );
}
