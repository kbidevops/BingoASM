"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { StatusDot } from "@/components/admin/common";
import { HistoryList } from "@/components/admin/NetDevices";
import AsDetailModal from "@/components/AsDetailModal";
import SubPage from "@/components/SubPage";
import { ErrorBox, HoldBadge, Loading, SlaBadge, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { AS_LIST_HREF } from "@/lib/as";
import { useAuth } from "@/lib/auth";
import { badgeClass, DEVICE_STATUSES, type Device, type DeviceHistoryRow } from "@/lib/admin";
import { fmtDate, fmtDateTime, todayIso } from "@/lib/format";

/** GET /api/qr/devices/{id}: 장비 + 위치 + 이 사용자가 할 수 있는 것. */
interface ScanDevice extends Device {
  /** 어느 학교 · 건물 · 층 (도면에 놓였으면 그 층) */
  where: { schoolName?: string; buildingId?: number; buildingName?: string; floorId?: number; floorName?: string; onPlan: boolean; path?: string };
  canManage: boolean;
  canRequest: boolean;
  /** 관리자에게만: 최근 위치 변경 5건 */
  history?: DeviceHistoryRow[];
  /** 이 장비의 AS · 문의처 (AsRequestService.deviceAs) */
  as?: DeviceAs;
}

interface OpenAs {
  asvcSn: number;
  status: "A" | "R";
  statusName: string;
  requestAt?: string;
  /** false = 볼 수 없는 건 (다른 기사 배정 등): 상태만 */
  canOpen: boolean;
  symptom?: string;
  visitPlannedAt?: string;
  visitAt?: string;
  engineerName?: string;
  assignedToMe?: boolean;
  sla?: { stage: string; label: string; dueAt: string; remainingMin: number; targetMin: number } | null;
  onHold?: boolean;
  holdReason?: string;
  holdUntil?: string;
  canArrive?: boolean;
  canReport?: boolean;
  canReceive?: boolean;
}
interface Person { userName: string; positionName?: string; tel?: string; regionName?: string }
interface DeviceAs {
  open: OpenAs[];
  count90: number;
  unlinked: number;
  contacts: { vendor?: { vendorName: string; tel?: string }; engineer?: Person; region: Person[] };
}

/** 전화번호 → tel: 링크 (숫자 · + 만) */
function Tel({ n }: { n?: string }) {
  if (!n) return <span className="hint">번호 없음</span>;
  return <a className="dvs-tel" href={`tel:${n.replace(/[^0-9+]/g, "")}`}>{n}</a>;
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
  const { can } = useAuth();
  const [d, setD] = useState<ScanDevice | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  /** 장비 화면에서 연 AS (처리 창을 바로 펼칠 수 있다) */
  const [work, setWork] = useState<{ sn: number; action?: string } | null>(null);

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
  const as = d.as;
  const open = as?.open ?? [];
  // 장애접수관리를 가진 계정은 전체 목록에서, 아니면 그 유형의 결과조회에서 연다.
  // 장비 화면을 떠나지 않고 그 건을 연다 (기사가 현장에서 접수 · 도착 · 보고서까지). 목록 메뉴가 없는 계정도 된다.
  const asHref = (sn: number) => `${can("AS_MANAGE") ? "/admin/requests" : AS_LIST_HREF[d.rceptTy ?? "M"]}?open=${sn}`;
  const openAs = (sn: number, action?: string) => (e?: React.MouseEvent) => { e?.preventDefault(); setWork({ sn, action }); };
  const arrive = async (sn: number) => {
    setBusy(true);
    try {
      await api.post(`/api/as/requests/${sn}/arrive`, { byQr: true });
      toast(`AS-${sn} 현장 도착을 기록했습니다.`);
      load();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
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

      {open.length > 0 && (
        <section className="dvs-open" aria-label="이 장비의 처리 중 장애">
          <h4><span aria-hidden="true">⚠</span> 이 장비에 처리 중인 장애가 있습니다 <span className="dvs-cnt">{open.length}</span></h4>
          <ul>
            {open.map((o) => (
              <li key={o.asvcSn} className={o.assignedToMe ? "mine" : ""}>
                <div className="dvs-open-b">
                  <b className={"st " + (o.status === "A" ? "s2" : "s3")}>{o.statusName}</b>{" "}
                  {o.canOpen ? <a href={asHref(o.asvcSn)} onClick={openAs(o.asvcSn)}>AS-{o.asvcSn}</a> : <span>AS-{o.asvcSn}</span>}
                  {o.assignedToMe && <span className="dvs-me">내 담당</span>} <HoldBadge row={o} /> <SlaBadge sla={o.sla} />
                  <small>
                    신청 {fmtDate(o.requestAt)}
                    {o.visitPlannedAt && <> · 방문예정 {fmtDateTime(o.visitPlannedAt)}</>}
                    {o.visitAt && <> · 도착 {fmtDateTime(o.visitAt)}</>}
                    {o.engineerName && <> · 담당 {o.engineerName}</>}
                  </small>
                  {o.canOpen ? (o.symptom ? <p>{o.symptom}</p> : null) : <p className="hint">다른 담당자가 처리 중인 건입니다.</p>}
                </div>
                {o.canOpen && (o.canArrive || o.canReport || o.canReceive) && (
                  <div className="dvs-open-a">
                    {o.canReceive && <button type="button" className="btn sm" onClick={openAs(o.asvcSn, "receive")}>접수</button>}
                    {o.canArrive && <button type="button" className="btn sm" disabled={busy} onClick={() => arrive(o.asvcSn)}>도착 기록</button>}
                    {o.canReport && <button type="button" className={"btn sm" + (o.canArrive ? " sec" : "")} onClick={openAs(o.asvcSn, "report")}>처리 보고서 작성</button>}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {d.canRequest && <p className="hint">같은 장애라면 새로 신청하지 말고 위 건의 진행 상황을 확인해 주세요.</p>}
        </section>
      )}
      {!!as?.unlinked && (
        <p className="dvs-note">이 학교에 대상 장비가 아직 지정되지 않은 {k.asName} 신고가 <b>{as.unlinked}</b>건 있습니다. 같은 장애일 수 있습니다.</p>
      )}

      <div className="dvs-act">
        {d.canRequest && (
          <Link className={"btn " + (open.length ? "sec" : "dvs-main")} href={`${k.as}?device=${d.deviceId}`}>
            {open.length ? `그래도 새로 ${k.asName} 신청` : `이 장비로 ${k.asName} 신청`}
          </Link>
        )}
        {d.canManage && loc.onPlan && <Link className="btn sec" href={`/admin/floorplan?school=${d.schoolId}&building=${loc.buildingId}&floor=${loc.floorId}&device=${d.deviceId}`}>도면에서 보기</Link>}
        {d.canManage && <button type="button" className="btn sec" disabled={busy || checkedToday} onClick={markChecked}>{checkedToday ? "오늘 점검 기록됨" : "오늘 점검함"}</button>}
        {d.canManage && <Link className="btn sec" href={`${k.list}?id=${d.deviceId}`}>장비 정보 수정</Link>}
      </div>

      <table className="ftab rpt dvs-t"><tbody>
        {/* IP · MAC은 장비를 다루는 사람에게만 서버가 준다 */}
        {"ipAddress" in d || "macAddress" in d
          ? <tr><th scope="row">모델</th><td>{d.modelName ?? "-"}</td><th scope="row">IP / MAC</th><td>{d.ipAddress ?? "-"}{d.macAddress && <><br /><small className="hint">{d.macAddress}</small></>}</td></tr>
          : <tr><th scope="row">모델</th><td colSpan={3}>{d.modelName ?? "-"}</td></tr>}
        {d.rceptTy === "S" && <tr><th scope="row">회선</th><td colSpan={3}>{[d.carrier, d.bandwidth].filter(Boolean).join(" · ") || "-"}{d.circuitId && <small className="hint"> · 회선번호 {d.circuitId}</small>}</td></tr>}
        <tr><th scope="row">설치일</th><td>{fmtDate(d.installedAt)}</td><th scope="row">최근 점검</th><td>{d.lastCheckedAt ? fmtDate(d.lastCheckedAt) : "기록 없음"}</td></tr>
        {as && <tr><th scope="row">최근 90일 장애</th><td colSpan={3}>{as.count90 ? <b className={as.count90 >= 3 ? "dvs-many" : ""}>{as.count90}회</b> : "없음"}{as.count90 >= 3 && <small className="hint"> · 자주 고장 나는 장비입니다. 교체를 검토해 보세요.</small>}</td></tr>}
        {d.note && <tr><th scope="row">비고</th><td colSpan={3} style={{ whiteSpace: "pre-wrap" }}>{d.note}</td></tr>}
      </tbody></table>
      {as && (as.contacts.vendor || as.contacts.engineer || as.contacts.region.length > 0) && (
        <section className="dvs-contacts" aria-labelledby="dvs-c-t">
          <h4 id="dvs-c-t">문의처</h4>
          <ul>
            {as.contacts.vendor && <li><span>유지보수 업체</span><b>{as.contacts.vendor.vendorName}</b><Tel n={as.contacts.vendor.tel} /></li>}
            {as.contacts.engineer && <li><span>담당 기사</span><b>{as.contacts.engineer.userName}</b><Tel n={as.contacts.engineer.tel} /></li>}
            {as.contacts.region.map((x, i) => (
              <li key={i}><span>{x.regionName ?? "교육지원청"} · {k.asName}</span><b>{x.userName}{x.positionName && <small> · {x.positionName}</small>}</b><Tel n={x.tel} /></li>
            ))}
          </ul>
        </section>
      )}
      {d.history && d.history.length > 0 && (
        <section className="dv-hist dvs-hist" aria-label="최근 위치 변경">
          <h4>최근 위치 변경</h4>
          <HistoryList rows={d.history} />
        </section>
      )}
      {work && <AsDetailModal sn={work.sn} initialAction={work.action} onClose={() => { setWork(null); load(); }} onChanged={load} />}
    </div>
  );
}
