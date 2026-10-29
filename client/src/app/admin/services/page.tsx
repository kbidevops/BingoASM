"use client";

import { useCallback, useEffect, useState } from "react";
import SubPage from "@/components/SubPage";
import { ErrorBox, FormMsg, Loading, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Me, RceptTy } from "@/lib/types";

interface AsServices {
  asTypes: RceptTy[];
  types: { rceptTy: RceptTy; name: string; enabled: boolean }[];
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
              </div>
              {on.has(t.rceptTy) ? <span className="um-pill add">사용</span> : <span className="um-pill none">사용 안 함</span>}
              <input type="checkbox" role="switch" className="um-sw" aria-label={`${t.name} 사용`}
                checked={on.has(t.rceptTy)} onChange={(e) => flip(t.rceptTy, e.target.checked)} />
            </li>
          ))}
        </ul>
      </section>
      {msg && <FormMsg kind="bad" text={msg} />}
      <div className={"um-bar" + (dirty ? " dirty" : "")}>
        <span className="um-bar-t">{dirty ? "저장하지 않은 변경이 있습니다" : "변경 사항 없음"}</span>
        <button type="button" className="btn sm sec" disabled={!dirty || busy} onClick={() => { setOn(new Set(data.asTypes)); setMsg(""); }}>되돌리기</button>
        <button type="button" className="btn sm" disabled={!dirty || busy} onClick={save}>{busy ? "저장 중…" : "저장"}</button>
      </div>
    </div>
  );
}
