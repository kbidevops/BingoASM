"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import QrQuickScan from "@/components/admin/QrQuickScan";
import { SchoolSelect, useSchoolChoice } from "@/components/admin/common";
import SubPage from "@/components/SubPage";
import { ErrorBox, Icon, Loading } from "@/components/ui";
import { api } from "@/lib/api";
import { fetchAll, type Asset, type Building, type Room } from "@/lib/admin";
import { useAuth } from "@/lib/auth";
import { fmtDate } from "@/lib/format";

/**
 * 자산 관리 홈: 자산 관리를 처음 하는 학교 담당자를 위한 시작 화면.
 * 교실 등록 → 자산 등록 → 위치 정리 → QR 라벨 → 재물조사 다섯 단계를 실제 데이터로 확인해 다음 할 일을 보여 준다.
 */
export default function StartPage() {
  return (
    <SubPage perm="SPACE_MANAGE">
      <Start />
    </SubPage>
  );
}

interface Session { sessionId: number; title: string; startedAt: string; endedAt?: string; status: "OPEN" | "CLOSED" }
interface Facts { buildings: number; rooms: number; assets: number; unplaced: number; sessions: Session[] }

/** "라벨을 붙였어요" is the one step the server cannot see; it is a per-browser note, nothing depends on it. */
const labelKey = (schoolId: number) => `bingoasm.labels-done.${schoolId}`;
const readLabelDone = (schoolId: number) => { try { return localStorage.getItem(labelKey(schoolId)) === "1"; } catch { return false; } };
const writeLabelDone = (schoolId: number, v: boolean) => { try { if (v) localStorage.setItem(labelKey(schoolId), "1"); else localStorage.removeItem(labelKey(schoolId)); } catch { /* storage blocked: the tick just isn't remembered */ } };

function Start() {
  const { can } = useAuth();
  const { schools, schoolId, setSchoolId, fixed, err: schoolErr, school } = useSchoolChoice();
  const [f, setF] = useState<Facts | null>(null);
  const [err, setErr] = useState("");
  const [labelsDone, setLabelsDone] = useState(false);
  const [scan, setScan] = useState(false);

  const load = useCallback(() => {
    if (!schoolId) return;
    setErr("");
    setF(null);
    setLabelsDone(readLabelDone(schoolId));
    Promise.all([
      api.get<Building[]>("/api/as/spaces/buildings", { schoolId }),
      api.get<Room[]>("/api/as/spaces/rooms", { schoolId }),
      fetchAll<Asset>("/api/assets", { schoolId }),
      can("INVENTORY") ? api.get<Session[]>("/api/as/inventory", { schoolId }) : Promise.resolve([] as Session[]),
    ]).then(([b, r, a, s]) => setF({ buildings: b.length, rooms: r.length, assets: a.length, unplaced: a.filter((x) => !x.roomId).length, sessions: s }))
      .catch((e) => setErr(e.message));
  }, [schoolId, can]);
  useEffect(load, [load]);

  if (schoolErr) return <ErrorBox message={schoolErr} />;

  const open = f?.sessions.find((s) => s.status === "OPEN");
  const lastClosed = f?.sessions.filter((s) => s.status === "CLOSED").sort((a, b) => (b.endedAt ?? "").localeCompare(a.endedAt ?? ""))[0];
  const steps: Step[] = f ? [
    {
      key: "rooms", title: "교실·장소 등록", done: f.rooms > 0,
      why: "자산의 위치는 교실(실) 단위로 기록합니다. 건물과 층, 교실을 먼저 만들어 두세요.",
      status: f.rooms ? `건물 ${f.buildings}동 · 교실 ${f.rooms}개` : "아직 등록된 교실이 없습니다",
      action: { href: "/admin/spaces", label: f.rooms ? "교실 관리" : "교실 등록하기" },
    },
    {
      key: "assets", title: "자산 등록", done: f.assets > 0,
      why: "PC·모니터·전자칠판 등 학교 자산을 등록합니다. 엑셀 양식으로 한 번에 올릴 수 있습니다.",
      status: f.assets ? `자산 ${f.assets.toLocaleString()}대 등록됨` : "아직 등록된 자산이 없습니다",
      action: { href: "/admin/assets", label: f.assets ? "자산 목록" : "자산 등록하기" },
    },
    {
      key: "place", title: "자산 위치 정리", done: f.assets > 0 && f.unplaced === 0,
      why: "어느 교실에 있는 자산인지 지정합니다. 도면에서 자산을 골라 교실을 누르면 됩니다.",
      status: !f.assets ? "자산을 먼저 등록하세요" : f.unplaced ? `어느 교실인지 모르는 자산 ${f.unplaced}대` : "모든 자산의 교실이 정해졌습니다",
      action: { href: "/admin/floorplan", label: "도면에서 위치 정하기" },
    },
    {
      key: "labels", title: "QR 라벨 붙이기", done: labelsDone,
      why: "자산마다 QR 라벨을, 교실 문 옆에는 교실 QR을 붙입니다. A4 라벨지(3×7)에 인쇄됩니다.",
      status: labelsDone ? "라벨을 붙였습니다" : "자산 목록과 교실 관리에서 라벨을 인쇄하세요",
      action: { href: "/admin/assets", label: "자산 라벨 인쇄" },
      extra: { href: "/admin/spaces", label: "교실 QR 인쇄" },
      manual: true,
    },
    {
      key: "inventory", title: "재물조사", done: !!lastClosed,
      why: "교실 QR을 찍고 자산 라벨을 차례로 찍으면 없는 자산과 옮겨진 자산이 자동으로 정리됩니다.",
      status: open ? `진행 중 — ${open.title}` : lastClosed ? `마지막 조사 ${fmtDate(lastClosed.endedAt)}` : "아직 한 적이 없습니다",
      action: { href: "/admin/inventory", label: open ? "이어서 조사하기" : "재물조사 시작" },
    },
  ] : [];
  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);

  return (
    <div className="sth">
      <div className="sth-top">
        <SchoolSelect schools={schools} value={schoolId} fixed={fixed} onChange={setSchoolId} />
      </div>
      <section className="sth-card sth-hero">
        <div className="sth-hero-t">
          <h3>{school?.schoolName ?? "우리 학교"} 자산 관리</h3>
          <p>{!f ? "확인하는 중…" : next ? <>다음 할 일: <b>{next.title}</b></> : <>모든 단계를 마쳤습니다. 이제 <b>QR 찍기</b>로 자산을 바로 찾아보세요.</>}</p>
          {f && (
            <div className="sth-prog">
              <div className="sth-bar" role="progressbar" aria-valuenow={doneCount} aria-valuemin={0} aria-valuemax={steps.length} aria-label="준비 단계"><i style={{ width: `${(doneCount / steps.length) * 100}%` }} /></div>
              <span><b>{doneCount}</b>/{steps.length} 단계 완료</span>
            </div>
          )}
        </div>
        <button type="button" className="sth-qr" onClick={() => setScan(true)}>
          <span className="sth-qr-i" aria-hidden="true"><Icon name="qr" /></span>
          <b>QR 찍기</b>
          <small>자산 라벨이나 교실 문의 QR</small>
        </button>
      </section>

      {err ? <ErrorBox message={err} onRetry={load} /> : !f ? <Loading /> : (
        <ol className="sth-steps">
          {steps.map((s, i) => (
            <li key={s.key} className={"sth-card sth-step" + (s.done ? " done" : s === next ? " next" : "")}>
              <span className="sth-n" aria-hidden="true">{s.done ? "✓" : i + 1}</span>
              <div className="sth-step-t">
                <h4>{s.title} {s === next && <span className="sth-badge">지금 할 일</span>}</h4>
                <p>{s.why}</p>
                <small className={s.done ? "ok" : ""}>{s.status}</small>
              </div>
              <div className="sth-step-a">
                <Link className={"btn sm" + (s === next ? "" : " sec")} href={s.action.href}>{s.action.label}</Link>
                {s.extra && <Link className="btn sm sec" href={s.extra.href}>{s.extra.label}</Link>}
                {s.manual && schoolId && (
                  <label className="sth-tick">
                    <input type="checkbox" checked={labelsDone} onChange={(e) => { writeLabelDone(schoolId, e.target.checked); setLabelsDone(e.target.checked); }} /> 라벨을 다 붙였어요
                  </label>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      <section>
        <h3 className="sth-h">이럴 때는</h3>
        <ul className="sth-tasks">
          <li><Link href="/as/wireless"><b>무선이 안 돼요</b><span>무선망 AS 신청</span></Link></li>
          <li><Link href="/admin/assets"><b>자산을 찾고 싶어요</b><span>번호·품명으로 검색</span></Link></li>
          <li><Link href="/admin/floorplan"><b>교실에 뭐가 있나요</b><span>도면에서 교실 누르기</span></Link></li>
          <li><Link href="/boards/write?code=disposal"><b>오래된 PC를 버려요</b><span>불용PC 수거 신청</span></Link></li>
        </ul>
      </section>
      {scan && <QrQuickScan onClose={() => setScan(false)} />}
    </div>
  );
}

interface Step {
  key: string; title: string; done: boolean; why: string; status: string;
  action: { href: string; label: string }; extra?: { href: string; label: string }; manual?: boolean;
}
