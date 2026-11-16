"use client";

import { useCallback, useEffect, useState } from "react";
import SubPage from "@/components/SubPage";
import { ErrorBox, FormMsg, Loading, QuickIcon, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Me, RceptTy } from "@/lib/types";

interface AsServices {
  asTypes: RceptTy[];
  /** openRequests: 처리 중(신청완료·접수완료) 건수. 끄면 목록에서 숨겨진다. */
  types: { rceptTy: RceptTy; name: string; enabled: boolean; openRequests?: number }[];
}

/** What turning a service on brings with it (Roles.AS_TYPE_PERMS on the server). */
const DESC: Record<RceptTy, string> = {
  M: "무선망 AS 신청·결과조회, 무선장비관리",
  S: "스쿨넷 AS 신청·결과조회, 스쿨넷 SLA 결과 업로드",
  C: "정보기기 AS 신청·결과조회, 불용PC수거신청, 유지관리업체(정보공유)",
  T: "스마트기기 지원신청·결과조회",
};
const ICON: Record<RceptTy, "wifi" | "net" | "pc" | "tab"> = { M: "wifi", S: "net", C: "pc", T: "tab" };

export default function Page() {
  return (
    <SubPage perm="ORG_WRITE">
      <AsServicesForm />
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
        이미 있는 신청 기록은 지우지 않으며 다시 켜면 그대로 보입니다. AS는 학교가 신청 · 평가 · 재요청하고, 학교 · 장비의 담당 업체(업체 관리자 · 기사 누구나)가
        접수 · 처리합니다. 교육청 · 교육지원청은 보기만 합니다.
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
