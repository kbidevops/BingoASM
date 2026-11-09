"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { StatusDot } from "@/components/admin/common";
import { HistoryList } from "@/components/admin/NetDevices";
import SubPage from "@/components/SubPage";
import { ErrorBox, Loading, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { badgeClass, DEVICE_STATUSES, type Device, type DeviceHistoryRow } from "@/lib/admin";
import { fmtDate, todayIso } from "@/lib/format";

/** GET /api/qr/devices/{id}: 장비 + 위치 + 이 사용자가 할 수 있는 것. */
interface ScanDevice extends Device {
  /** 어느 학교 · 건물 · 층 (도면에 놓였으면 그 층) */
  where: { schoolName?: string; buildingId?: number; buildingName?: string; floorId?: number; floorName?: string; onPlan: boolean; path?: string };
  canManage: boolean;
  canRequest: boolean;
  /** 관리자에게만: 최근 위치 변경 5건 */
  history?: DeviceHistoryRow[];
}

const KIND = {
  M: { name: "무선장비", as: "/as/wireless", list: "/admin/devices", api: "/api/as/wireless-devices", asName: "무선망 AS" },
  S: { name: "스쿨넷 장비", as: "/as/schoolnet", list: "/admin/schoolnet-devices", api: "/api/as/schoolnet-devices", asName: "스쿨넷 AS" },
} as const;

/**
 * 장비 라벨 QR(/d/{id})을 찍으면 여는 화면: 어느 학교 · 건물 · 층의 어떤 장비인지와 바로 할 일.
 * 학교 담당자는 "이 장비로 AS 신청"이 맨 위, 관리자는 도면 보기 · 점검 기록 · 정보 수정.
 */
export default function DevicePage() {
  return (
    <Suspense>
      <SubPage title="장비 정보" auth side={false}>
        <DeviceView />
      </SubPage>
    </Suspense>
  );
}

function DeviceView() {
  const id = Number(useSearchParams().get("id")) || null;
  const toast = useToast();
  const [d, setD] = useState<ScanDevice | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!id) return setErr("장비 번호가 없습니다. 장비 라벨의 QR을 다시 찍어 주세요.");
    setErr("");
    api.get<ScanDevice>(`/api/qr/devices/${id}`).then(setD).catch((e) => setErr((e as Error).message));
  }, [id]);
  useEffect(load, [load]);

  if (err) return <ErrorBox message={err} onRetry={id ? load : undefined} />;
  if (!d) return <Loading />;
  const k = KIND[d.rceptTy ?? "M"];
  const loc = d.where;
  const checkedToday = d.lastCheckedAt === todayIso();

  const markChecked = async () => {
    setBusy(true);
    try {
      await api.put(`${k.api}/${d.deviceId}`, { lastCheckedAt: todayIso() });
      toast(`${d.deviceCode} 점검일을 오늘로 기록했습니다.`);
      load();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const steps: [string, string | undefined][] = [["기관", loc.schoolName], ["건물", loc.buildingName], ["층", loc.floorName]];
  return (
    <div className="dvs">
      <header className="dvs-h">
        <span className={"dvs-ico st-" + ({ NORMAL: "ok", CHECK: "chk", FAULT: "bad", DISPOSED: "off" }[d.status] ?? "ok")} aria-hidden="true">{d.rceptTy === "S" ? "S" : "W"}</span>
        <div>
          <small>{k.name} · {d.deviceTypeName}</small>
          <h3>{d.deviceCode} <span>{d.deviceName}</span></h3>
        </div>
        <StatusDot cls={badgeClass(DEVICE_STATUSES, d.status)} name={d.statusName} />
      </header>

      <section className={"aloc" + (loc.buildingName ? "" : " warn")} aria-label={`장비 위치: ${loc.path || "미지정"}`}>
        <span className="aloc-i" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.6" /></svg>
        </span>
        <div className="aloc-b">
          <ol className="aloc-path">
            {steps.map(([n, v]) => <li key={n} className={v ? "" : "none"}><small>{n}</small><b>{v ?? "미지정"}</b></li>)}
          </ol>
          {d.location && <p className="aloc-d">설치위치: {d.location}</p>}
          {!loc.buildingName && <p className="aloc-d warn">도면에 놓이지 않은 장비라 건물·층을 모릅니다.{d.canManage && d.rceptTy === "M" ? " ‘무선장비 위치(도면)’에서 놓아 주세요." : ""}</p>}
        </div>
      </section>

      <div className="dvs-act">
        {d.canRequest && <Link className="btn dvs-main" href={`${k.as}?device=${d.deviceId}`}>이 장비로 {k.asName} 신청</Link>}
        {d.canManage && loc.onPlan && <Link className="btn sec" href={`/admin/floorplan?school=${d.schoolId}&building=${loc.buildingId}&floor=${loc.floorId}&device=${d.deviceId}`}>도면에서 보기</Link>}
        {d.canManage && <button type="button" className="btn sec" disabled={busy || checkedToday} onClick={markChecked}>{checkedToday ? "오늘 점검 기록됨" : "오늘 점검함"}</button>}
        {d.canManage && <Link className="btn sec" href={`${k.list}?id=${d.deviceId}`}>장비 정보 수정</Link>}
      </div>

      <table className="ftab rpt dvs-t"><tbody>
        <tr><th scope="row">모델</th><td>{d.modelName ?? "-"}</td><th scope="row">IP / MAC</th><td>{d.ipAddress ?? "-"}{d.macAddress && <><br /><small className="hint">{d.macAddress}</small></>}</td></tr>
        {d.rceptTy === "S" && <tr><th scope="row">회선</th><td colSpan={3}>{[d.carrier, d.bandwidth].filter(Boolean).join(" · ") || "-"}{d.circuitId && <small className="hint"> · 회선번호 {d.circuitId}</small>}</td></tr>}
        <tr><th scope="row">설치일</th><td>{fmtDate(d.installedAt)}</td><th scope="row">최근 점검</th><td>{d.lastCheckedAt ? fmtDate(d.lastCheckedAt) : "기록 없음"}</td></tr>
        {d.note && <tr><th scope="row">비고</th><td colSpan={3} style={{ whiteSpace: "pre-wrap" }}>{d.note}</td></tr>}
      </tbody></table>
      {d.history && d.history.length > 0 && (
        <section className="dv-hist dvs-hist" aria-label="최근 위치 변경">
          <h4>최근 위치 변경</h4>
          <HistoryList rows={d.history} />
        </section>
      )}
    </div>
  );
}
