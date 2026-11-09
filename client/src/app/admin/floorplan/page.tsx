"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SchoolSelect, StatusDot, useSchoolChoice } from "@/components/admin/common";
import PlanUploadModal from "@/components/admin/PlanUploadModal";
import SubPage from "@/components/SubPage";
import { ErrorBox, FormMsg, FormRow, Icon, Loading, Modal, useToast } from "@/components/ui";
import { api, API_BASE } from "@/lib/api";
import { badgeClass, DEVICE_STATUSES, fetchAll, type Building, type Device, type DevicePlaces } from "@/lib/admin";
import { useAuth } from "@/lib/auth";
import { fmtDate } from "@/lib/format";

/**
 * 무선장비 위치(도면): 학교 건물 → 층 → 층 도면을 올리고, 무선장비(AP·스위치·컨트롤러)를 도면 위 아이콘으로 놓는다.
 * 위치는 도면 크기 대비 %(0~100)라 도면을 확대해도 그대로다. ?school=&building=&floor= 로 그 층을 바로 연다.
 */
export default function FloorplanPage() {
  return (
    <Suspense>
      <SubPage perm="WDEVICE_MANAGE">
        <Floorplan />
      </SubPage>
    </Suspense>
  );
}

function Floorplan() {
  const params = useSearchParams();
  const toast = useToast();
  const { can } = useAuth();
  // ?school= : 다른 화면(장비 정보 · 장비 수정)에서 그 학교 도면을 바로 연다.
  const { schools, schoolId, setSchoolId, fixed, err: schoolErr } = useSchoolChoice(Number(params.get("school")) || null);
  const [blds, setBlds] = useState<Building[] | null>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [bid, setBid] = useState<number | null>(null);
  const [fid, setFid] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [bust, setBust] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [adding, setAdding] = useState<"building" | "floor" | null>(null);
  const target = useRef<{ building?: number; floor?: number }>({
    building: Number(params.get("building")) || undefined, floor: Number(params.get("floor")) || undefined,
  });
  const cur = useRef({ bid, fid });
  cur.current = { bid, fid };

  const loadDevices = useCallback(() => {
    if (!schoolId) return;
    fetchAll<Device>("/api/as/wireless-devices", { schoolId }).then(setDevices).catch((e) => toast(e.message));
  }, [schoolId, toast]);

  const load = useCallback(() => {
    if (!schoolId) return;
    setErr("");
    api.get<Building[]>("/api/as/spaces/buildings", { schoolId }).then((b) => {
      setBlds(b);
      const t = target.current, c = cur.current;
      const b0 = b.find((x) => x.buildingId === t.building) ?? b.find((x) => x.buildingId === c.bid) ?? b[0];
      setBid(b0?.buildingId ?? null);
      const f0 = b0?.floors.find((x) => x.floorId === t.floor) ?? b0?.floors.find((x) => x.floorId === c.fid) ?? b0?.floors.find((x) => x.planUrl) ?? b0?.floors[0];
      setFid(f0?.floorId ?? null);
      target.current = {};
    }).catch((e) => setErr(e.message));
    loadDevices();
  }, [schoolId, loadDevices]);
  useEffect(load, [load]);

  if (schoolErr) return <ErrorBox message={schoolErr} />;
  const b = blds?.find((x) => x.buildingId === bid);
  const f = b?.floors.find((x) => x.floorId === fid);
  const onFloor = (floorId: number) => (devices ?? []).filter((d) => d.floorId === floorId).length;
  const canSpace = can("SPACE_MANAGE");

  const upload = async (file: File) => {
    if (!f) return;
    const form = new FormData();
    form.append("file", file);
    await api.upload(`/api/places/floors/${f.floorId}/plan`, form);
    setUploading(false);
    toast("도면을 올렸습니다. ‘장비 배치’에서 무선장비를 도면에 놓아 주세요.");
    setBust(Date.now());
    load();
  };
  const changed = (d: Device) => setDevices((list) => list && list.map((x) => (x.deviceId === d.deviceId ? d : x)));

  return (
    <div className="fpv">
      <div className="fpv-top">
        <SchoolSelect schools={schools} value={schoolId} fixed={fixed} onChange={(id) => { setSchoolId(id); setBlds(null); setDevices(null); }} />
        <span className="fpv-links">
          <Link className="btn sm sec" href="/admin/devices">무선장비관리</Link>
          {canSpace && <Link className="btn sm sec" href="/admin/spaces">건물·층 관리</Link>}
        </span>
      </div>
      {err ? <ErrorBox message={err} onRetry={load} /> : !blds ? <Loading /> : !blds.length ? (
        <div className="fpv-card fpv-noplan fpv-start">
          <h3>건물부터 등록하세요</h3>
          <ol className="fpv-steps">
            <li><b>건물 등록</b><span>학교의 건물(본관·별관 등)과 층 수</span></li>
            <li><b>층 도면 올리기</b><span>층마다 도면 이미지·PDF·사진</span></li>
            <li><b>장비 배치</b><span>무선 AP·스위치를 도면 위에 놓기</span></li>
          </ol>
          {canSpace ? <button type="button" className="btn sm" onClick={() => setAdding("building")}>건물 등록</button>
            : <p className="hint">건물 등록은 학교·교육청 담당자가 할 수 있습니다.</p>}
        </div>
      ) : (
        <>
          <nav className="fpv-nav" aria-label="건물·층">
            <div className="fpv-seg" role="group" aria-label="건물">
              {blds.map((x) => (
                <button key={x.buildingId} type="button" aria-pressed={x.buildingId === bid}
                  onClick={() => { setBid(x.buildingId); setFid((x.floors.find((y) => y.planUrl) ?? x.floors[0])?.floorId ?? null); }}>{x.buildingName}</button>
              ))}
              {canSpace && <button type="button" className="fpv-add" onClick={() => setAdding("building")} aria-label="건물 추가">＋ 건물</button>}
            </div>
            <div className="fpv-floors" role="tablist" aria-label="층">
              {b?.floors.map((x) => (
                <button key={x.floorId} type="button" role="tab" aria-selected={x.floorId === fid} onClick={() => setFid(x.floorId)}>
                  <b>{x.floorName}</b>
                  <small className={x.planUrl ? "" : "warn"}>{x.planUrl ? `장비 ${onFloor(x.floorId)}` : "도면 없음"}</small>
                </button>
              ))}
              {canSpace && b && <button type="button" className="fpv-add-floor" onClick={() => setAdding("floor")}><b>＋</b><small>층 추가</small></button>}
            </div>
          </nav>
          {!f ? <p className="empty">이 건물에 층이 없습니다.{canSpace ? " ‘층 추가’로 층을 만드세요." : ""}</p> : !f.planUrl ? (
            <div className="fpv-card fpv-noplan">
              {can("FLOOR_WRITE") ? (
                <button type="button" className="bk-drop" style={{ width: "100%" }} onClick={() => setUploading(true)}>
                  <b>{b!.buildingName} {f.floorName} 도면 올리기</b>
                  <span>이미지(PNG·JPG) · PDF · 휴대폰 사진 — 올리기 전에 쪽 선택·회전을 할 수 있습니다.</span>
                </button>
              ) : <p>이 층에는 아직 도면이 없습니다.</p>}
              <ul className="fx-tips">
                <li><b>건축 도면</b> — 행정실(시설 담당)에 PDF로 있는 경우가 많습니다. PDF를 그대로 올리고 이 층의 쪽을 고르세요.</li>
                <li><b>피난안내도</b> — 층마다 붙어 있어서 휴대폰으로 이 화면을 열고 ‘휴대폰 카메라로 찍기’로 바로 올릴 수 있습니다.</li>
              </ul>
            </div>
          ) : devices === null ? <Loading /> : (
            <PlanView key={f.floorId} planUrl={`${API_BASE}${f.planUrl}${bust ? `?v=${bust}` : ""}`} title={`${b!.buildingName} ${f.floorName}`}
              floorId={f.floorId} devices={devices} floorTexts={blds.flatMap((x) => x.floors.map((y) => `${x.buildingName} ${y.floorName}`))} canEdit={can("WDEVICE_MANAGE")} onChanged={changed} initialSel={Number(params.get("device")) || null}
              initialPlace={params.get("place") === "1" && f.floorId === Number(params.get("floor"))}
              onReplace={can("FLOOR_WRITE") ? () => setUploading(true) : undefined} />
          )}
        </>
      )}
      {uploading && f && <PlanUploadModal title={`${b!.buildingName} ${f.floorName}`} onClose={() => setUploading(false)} onUpload={upload} />}
      {adding === "building" && schoolId && (
        <AddBuilding schoolId={schoolId} onClose={() => setAdding(null)}
          onSaved={(nb) => { setAdding(null); target.current = { building: nb.buildingId, floor: (nb.floors.find((x) => x.floorNo === 1) ?? nb.floors[0])?.floorId }; toast(`${nb.buildingName}을(를) 등록했습니다. 층 도면을 올려 주세요.`); load(); }} />
      )}
      {adding === "floor" && b && (
        <AddFloor building={b} onClose={() => setAdding(null)}
          onSaved={(floorId, name) => { setAdding(null); target.current = { building: b.buildingId, floor: floorId }; toast(`${b.buildingName} ${name}을(를) 추가했습니다.`); load(); }} />
      )}
    </div>
  );
}

// ---------- 도면 + 장비 아이콘 ----------

type Mode = "view" | "place";
const HINTS: Record<Mode, string> = {
  view: "장비 아이콘을 누르면 정보가 나옵니다.",
  place: "목록에서 장비를 고른 뒤 도면에서 놓을 곳을 누르세요. 놓인 아이콘은 끌어서 옮깁니다.",
};
const STATUS_TONE: Record<string, string> = { NORMAL: "ok", CHECK: "chk", FAULT: "bad", DISPOSED: "off" };

/** 장비 유형 아이콘 (24×24, currentColor). */
function DeviceGlyph({ type }: { type?: string }) {
  if (type === "SWITCH") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="10" rx="2" /><path d="M7 11v2M10 11v2M13 11v2M16 11v2" /></svg>;
  if (type === "CONTROLLER") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8M8 11h8M9 16.5h.01M12 16.5h.01" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 10a10 10 0 0 1 14 0M8 13a6 6 0 0 1 8 0" /><circle cx="12" cy="17" r="1.6" /></svg>;
}

function PlanView({ planUrl, title, floorId, devices, floorTexts, canEdit, onChanged, onReplace, initialSel, initialPlace }: {
  planUrl: string; title: string; floorId: number; devices: Device[]; canEdit: boolean; onChanged: (d: Device) => void; onReplace?: () => void;
  /** 이 학교의 "건물 층" 이름들: 설치위치에서 떼고 실(상세 위치)만 보여 준다. */
  floorTexts: string[];
  /** 장비 정보 화면의 "도면에서 보기" (?device=): 그 장비를 골라 강조한다. */
  initialSel?: number | null;
  /** 장비 수정의 "다른 층으로 옮기기" 뒤 (?place=1): 장비 배치로 열고 그 장비를 놓을 장비로 고른다. */
  initialPlace?: boolean;
}) {
  const toast = useToast();
  const canvas = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>(initialPlace && canEdit ? "place" : "view");
  const [zoom, setZoom] = useState(1);
  const [sel, setSel] = useState<number | null>(initialSel ?? null);
  const [picked, setPicked] = useState<number | null>(initialPlace && canEdit ? initialSel ?? null : null);
  // 같은 층에서 옮기는 장비: 옮길 실을 받아야 저장한다 (그동안 아이콘은 새 자리에 표시).
  const [pending, setPending] = useState<{ id: number; x: number; y: number } | null>(null);
  const [moved, setMoved] = useState<{ id: number; location: string } | null>(null);
  const [labels, setLabels] = useState(true);
  const [q, setQ] = useState("");
  // Dragging an icon: where it is now; saved on release (a release without movement is a click).
  const [drag, setDrag] = useState<{ id: number; x: number; y: number; moved: boolean } | null>(null);

  const here = devices.filter((d) => d.floorId === floorId && d.posX != null && d.posY != null);
  const byId = useMemo(() => new Map(devices.map((d) => [d.deviceId, d])), [devices]);
  const selDev = sel ? byId.get(sel) : undefined;
  // 강조할 장비: 보기에서는 누른 장비, 장비 배치에서는 놓을(옮길) 장비. 도면 아이콘과 목록 줄이 함께 강조된다.
  const focus = mode === "place" ? picked : sel;
  const focusOnPlan = focus != null && here.some((d) => d.deviceId === focus);

  // 목록에서 고른 장비가 이 층 도면에 있으면, 확대해서 안 보이는 곳이라도 그 아이콘이 보이게 스크롤한다.
  useEffect(() => {
    if (focus == null) return;
    const el = canvas.current?.querySelector<HTMLElement>(`[data-dev="${focus}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [focus]);

  const frac = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)), y: Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)) };
  };

  const save = async (id: number, pos: { x: number; y: number } | null) => {
    try {
      const d = await api.put<Device>(`/api/as/wireless-devices/${id}/position`, pos ? { floorId, x: +pos.x.toFixed(2), y: +pos.y.toFixed(2) } : { floorId: null });
      onChanged(d);
      return d;
    } catch (e) {
      toast((e as Error).message);
      return null;
    }
  };

  const onCanvasClick = async (e: React.PointerEvent) => {
    if (mode !== "place" || !picked || drag || pending) return;
    const d = byId.get(picked);
    // 다른 층·건물에 놓인 장비를 이 층으로 옮기는 기능은 숨겼다 (같은 층 안에서만 옮긴다).
    if (d?.floorId && d.floorId !== floorId) return;
    // 이미 이 층에 놓인 장비를 옮기면: 옮길 실을 받은 뒤 저장한다.
    if (d?.floorId === floorId) { setMoved(null); setPending({ id: picked, ...frac(e) }); return; }
    const saved = await save(picked, frac(e));
    if (saved) {
      toast(`${saved.deviceCode}을(를) 도면에 놓았습니다.`);
      setSel(picked);
      // 처음 놓은 장비면 다음 미배치 장비를 바로 고르고, 이미 놓인 장비를 옮긴 거면 계속 그 장비를 강조한다.
      if (!d?.floorId) {
        const next = devices.find((x) => x.deviceId !== picked && !x.floorId && x.status !== "DISPOSED" && forHere(x));
        setPicked(next?.deviceId ?? picked);
      }
    }
  };

  const onIconDown = (e: React.PointerEvent, d: Device) => {
    e.stopPropagation();
    if (mode !== "place" || !canEdit || pending) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setDrag({ id: d.deviceId, x: d.posX!, y: d.posY!, moved: false });
  };
  const onIconMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = frac(e);
    if (!drag.moved && Math.abs(p.x - drag.x) < 0.4 && Math.abs(p.y - drag.y) < 0.4) return;
    setDrag({ ...drag, ...p, moved: true });
  };
  const onIconUp = async (d: Device) => {
    const g = drag;
    setDrag(null);
    if (g && g.moved) { setMoved(null); setPending({ id: d.deviceId, x: g.x, y: g.y }); }
    choose(d.deviceId);
  };
  /** 아이콘을 누르면 그 장비를 강조한다. 장비 배치에서는 다음에 도면을 누른 곳으로 옮길 장비가 된다. */
  const choose = (id: number) => {
    setSel(id);
    if (mode === "place") setPicked(id);
  };
  // 키보드: 장비 배치 중 선택한 아이콘을 방향키로 0.5%씩 옮긴다.
  const onIconKey = (e: React.KeyboardEvent, d: Device) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(d.deviceId); return; }
    if (mode !== "place" || !canEdit) return;
    const step = e.shiftKey ? 2 : 0.5;
    const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
    const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    save(d.deviceId, { x: Math.min(100, Math.max(0, d.posX! + dx)), y: Math.min(100, Math.max(0, d.posY! + dy)) });
  };

  const remove = async (d: Device) => {
    const r = await save(d.deviceId, null);
    if (r) { toast(`${d.deviceCode}을(를) 도면에서 뺐습니다.`); setSel(null); }
  };

  /** 목록에 보일 설치 실: 설치위치에서 앞의 "건물 층"을 뗀 나머지 (예: "본관 2층 교무실 천장" → "교무실 천장"). */
  /** 설치위치가 가리키는 "건물 층" (없으면 undefined). */
  const floorOf = (d: Device) => {
    const loc = (d.location ?? "").trim();
    return floorTexts.filter((t) => loc === t || loc.startsWith(t + " ")).sort((a, b) => b.length - a.length)[0];
  };
  const room = (d: Device) => {
    const loc = (d.location ?? "").trim(), hit = floorOf(d);
    return (hit ? loc.slice(hit.length) : loc).trim();
  };
  // 도면에 없는 장비 중 이 층에 놓을 수 있는 것: 설치위치가 이 층이거나 층을 모르는 장비 (다른 층 장비는 그 층 도면에서 놓는다).
  const forHere = (d: Device) => { const f = floorOf(d); return !f || f === title; };
  const roomText = (d: Device) => room(d) || <span className="fpv-noroom">실 미지정</span>;
  const query = q.trim().toLowerCase();
  const match = (d: Device) => !query || [d.deviceCode, d.deviceName, d.location, d.modelName, d.ipAddress].some((v) => v?.toLowerCase().includes(query));
  const list = devices.filter(match);
  const unplaced = list.filter((d) => !d.floorId && forHere(d));
  const inFloor = list.filter((d) => d.floorId === floorId);
  const allUnplaced = devices.filter((d) => !d.floorId && d.status !== "DISPOSED" && forHere(d));
  const count = (s: string) => here.filter((d) => d.status === s).length;

  const row = (d: Device) => (
    <li key={d.deviceId}>
      <button type="button" className={"fpv-row" + (picked === d.deviceId ? " on" : "")} aria-pressed={picked === d.deviceId} onClick={() => setPicked(picked === d.deviceId ? null : d.deviceId)}>
        <span className={"fpv-ico st-" + STATUS_TONE[d.status]}><DeviceGlyph type={d.deviceType} /></span>
        <span className="fpv-row-t">
          <b>{d.deviceCode}</b>
          <small title={d.deviceName}>{roomText(d)}</small>
        </span>
        <span className="fpv-tag">{d.deviceTypeName}</span>
      </button>
    </li>
  );
  const group = (name: string, l: Device[], open: boolean) => (
    <details className="fpv-grp" open={open || !!query}>
      <summary>{name}<span className="fpv-count">{l.length}</span></summary>
      {l.length ? <ul className="fpv-list">{l.map(row)}</ul> : <p className="fpv-none">없음</p>}
    </details>
  );

  return (
    <>
      <div className="fpv-tool">
        {canEdit && (
          <div className="fpv-seg fpv-modes" role="group" aria-label="모드">
            {([["view", "보기"], ["place", "장비 배치"]] as const).map(([m, l]) => (
              <button key={m} type="button" aria-pressed={mode === m}
                onClick={() => { setMode(m); setDrag(null); if (m === "place" && !picked) setPicked(allUnplaced[0]?.deviceId ?? null); }}>{l}</button>
            ))}
          </div>
        )}
        <div className="fpv-seg fpv-zoom" role="group" aria-label="확대">
          <button type="button" aria-label="축소" disabled={zoom <= 1} onClick={() => setZoom(Math.max(1, zoom - 0.5))}>−</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label="확대" disabled={zoom >= 3} onClick={() => setZoom(Math.min(3, zoom + 0.5))}>＋</button>
        </div>
        <label className="fpv-check"><input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> 장비번호 표시</label>
        <div className="fpv-stats">
          <span>이 층 <b>{here.length}</b>대</span>
          <span>미배치 <b>{allUnplaced.length}</b>대</span>
        </div>
        {onReplace && <button type="button" className="btn sm sec fpv-replace" onClick={onReplace}>도면 바꾸기</button>}
      </div>

      <div className="fpv-body">
        <section className="fpv-card fpv-stage">
          {pending && byId.get(pending.id) && (
            <MoveRoom key={pending.id} device={byId.get(pending.id)!} floorId={floorId} floorText={title} pos={pending}
              onSaved={(d, changed) => { setPending(null); onChanged(d); setSel(d.deviceId); if (changed) setMoved({ id: d.deviceId, location: d.location ?? "" }); else toast(`${d.deviceCode}을(를) 옮겼습니다.`); }}
              onCancel={() => setPending(null)} />
          )}
          {moved && !pending && (
            <div className="fpv-ask done" role="status">
              <div className="fpv-ask-h">
                <span className="fpv-ask-i" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7" /></svg></span>
                <div>
                  <b>{byId.get(moved.id)?.deviceCode} → {moved.location}</b>
                  <small>옮겼습니다. 붙어 있는 라벨에는 예전 위치가 적혀 있습니다 (QR은 그대로 쓸 수 있습니다).</small>
                </div>
              </div>
              <div className="fpv-ask-act">
                <Link className="btn sm" href={`/admin/devices?label=${moved.id}`}>라벨 다시 출력</Link>
                <button type="button" className="btn sm sec" onClick={() => setMoved(null)}>닫기</button>
              </div>
            </div>
          )}
          <p className={"fpv-hint m-" + mode}>{mode === "place" && picked ? <><b>{byId.get(picked)?.deviceCode}</b> {byId.get(picked)?.deviceName} — 도면에서 {byId.get(picked)?.floorId === floorId ? "옮길" : "놓을"} 곳을 누르세요.</> : HINTS[mode]}</p>
          <div className="fpv-scroll">
            <div ref={canvas} className={`fpv-canvas m-${mode}${mode === "place" && picked ? " picking" : ""}${focusOnPlan ? " has-sel" : ""}`} style={{ width: `${zoom * 100}%` }}
              onPointerUp={onCanvasClick}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={planUrl} alt={`${title} 도면`} draggable={false} />
              {here.map((d) => {
                const at = drag?.id === d.deviceId ? drag : pending?.id === d.deviceId ? pending : { x: d.posX!, y: d.posY! };
                return (
                  <button key={d.deviceId} type="button"
                    className={`fpv-dev st-${STATUS_TONE[d.status]}${focus === d.deviceId ? " sel" : ""}${drag?.id === d.deviceId ? " drag" : ""}${pending?.id === d.deviceId ? " pending" : ""}`}
                    data-dev={d.deviceId} aria-pressed={focus === d.deviceId}
                    style={{ left: `${at.x}%`, top: `${at.y}%` }}
                    title={`${d.deviceCode} ${d.deviceName} · ${d.statusName}`}
                    aria-label={`${d.deviceCode} ${d.deviceName}, ${d.deviceTypeName}, ${d.statusName}`}
                    onPointerDown={(e) => onIconDown(e, d)} onPointerMove={onIconMove}
                    onPointerUp={(e) => { e.stopPropagation(); onIconUp(d); }}
                    onKeyDown={(e) => onIconKey(e, d)}>
                    <span className="fpv-dev-i"><DeviceGlyph type={d.deviceType} /></span>
                    {labels && <span className="fpv-dev-l">{d.deviceCode}</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="fpv-legend">
            {DEVICE_STATUSES.map(([c, n]) => <span key={c}><i className={"lg-dev st-" + STATUS_TONE[c]} />{n}</span>)}
            <span className="fpv-legend-t"><DeviceGlyph type="AP" />AP <DeviceGlyph type="SWITCH" />스위치 <DeviceGlyph type="CONTROLLER" />컨트롤러</span>
          </div>
        </section>

        <aside className="fpv-card fpv-side">
          {mode === "place" ? (
            <>
              <header className="fpv-sh"><h3>장비 배치</h3><span className="fpv-count">{unplaced.length + inFloor.length}</span></header>
              <div className="fpv-search">
                <Icon name="search" />
                <input aria-label="장비 검색" placeholder="장비번호·장비명·위치·IP" value={q} onChange={(e) => setQ(e.target.value)} />
                {q && <button type="button" aria-label="검색어 지우기" onClick={() => setQ("")}>✕</button>}
              </div>
              <div className="fpv-groups">
                {group("도면에 없는 장비", unplaced, true)}
                {group("이 층", inFloor, true)}
              </div>
              {!devices.length && <p className="fpv-none" style={{ padding: "0 16px 16px" }}>이 학교에 등록된 무선장비가 없습니다. <Link href="/admin/devices">무선장비관리</Link>에서 등록하세요.</p>}
            </>
          ) : selDev ? (
            <>
              <header className="fpv-sh">
                <div><h3>{selDev.deviceCode}</h3><small>{selDev.deviceName}</small></div>
                <button type="button" className="fpv-x" aria-label="닫기" onClick={() => setSel(null)}>✕</button>
              </header>
              <dl className="fpv-dl">
                <dt>상태</dt><dd><StatusDot cls={badgeClass(DEVICE_STATUSES, selDev.status)} name={selDev.statusName} /></dd>
                <dt>유형</dt><dd>{selDev.deviceTypeName ?? "-"}</dd>
                <dt>모델</dt><dd>{selDev.modelName ?? "-"}</dd>
                <dt>IP / MAC</dt><dd>{selDev.ipAddress ?? "-"}{selDev.macAddress ? <><br /><small>{selDev.macAddress}</small></> : null}</dd>
                <dt>설치위치</dt><dd>{selDev.location ?? "-"}</dd>
                <dt>설치일</dt><dd>{fmtDate(selDev.installedAt)}</dd>
                <dt>최근 점검</dt><dd>{selDev.lastCheckedAt ? fmtDate(selDev.lastCheckedAt) : "기록 없음"}</dd>
              </dl>
              <div className="fpv-cta">
                <Link className="btn sm sec" href="/admin/devices">무선장비관리</Link>
                {canEdit && <button type="button" className="btn sm sec" onClick={() => remove(selDev)}>도면에서 빼기</button>}
              </div>
            </>
          ) : (
            <>
              <header className="fpv-sh"><h3>{title}</h3></header>
              <div className="fpv-kpis">
                <div><small>이 층 장비</small><b>{here.length}<em>대</em></b></div>
                <div><small>장애·점검중</small><b className={count("FAULT") ? "bad" : ""}>{count("FAULT") + count("CHECK")}<em>대</em></b></div>
              </div>
              <ul className="fpv-list fpv-floorlist">
                {here.map((d) => (
                  <li key={d.deviceId}>
                    <button type="button" className={"fpv-row" + (sel === d.deviceId ? " on" : "")} aria-pressed={sel === d.deviceId} onClick={() => setSel(d.deviceId)}>
                      <span className={"fpv-ico st-" + STATUS_TONE[d.status]}><DeviceGlyph type={d.deviceType} /></span>
                      <span className="fpv-row-t"><b>{d.deviceCode}</b><small title={d.deviceName}>{roomText(d)}</small></span>
                      <StatusDot cls={badgeClass(DEVICE_STATUSES, d.status)} name={d.statusName} />
                    </button>
                  </li>
                ))}
                {!here.length && <li className="fpv-none">이 층 도면에 놓인 장비가 없습니다.</li>}
              </ul>
              {canEdit && (
                <div className="fpv-cta">
                  <button type="button" className="btn sm" onClick={() => { setMode("place"); setPicked(allUnplaced[0]?.deviceId ?? null); }}>
                    장비 배치하기{allUnplaced.length ? ` (미배치 ${allUnplaced.length})` : ""}
                  </button>
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </>
  );
}

// ---------- 건물·층 추가 ----------

function AddBuilding({ schoolId, onClose, onSaved }: { schoolId: number; onClose: () => void; onSaved: (b: Building) => void }) {
  const [v, setV] = useState({ buildingName: "", basementCount: "0", floorCount: "3" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.buildingName.trim()) return setMsg("건물명을 입력해 주세요.");
    const above = Number(v.floorCount), below = Number(v.basementCount);
    if (!(above >= 1 && above <= 30)) return setMsg("지상 층수는 1~30 사이로 입력해 주세요.");
    if (!(below >= 0 && below <= 5)) return setMsg("지하 층수는 0~5 사이로 입력해 주세요.");
    setBusy(true);
    try {
      onSaved(await api.post<Building>("/api/as/spaces/buildings", { schoolId, buildingName: v.buildingName.trim(), floorCount: above, basementCount: below }));
    } catch (er) {
      setMsg((er as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal title="건물 등록" onClose={onClose}>
      <form className="ft2" noValidate onSubmit={save}>
        <table className="ftab"><tbody>
          <FormRow label="건물명" required><input aria-label="건물명" placeholder="예: 본관, 별관, 체육관" value={v.buildingName} onChange={(e) => setV({ ...v, buildingName: e.target.value })} /></FormRow>
          <FormRow label="층수">
            지상 <input aria-label="지상 층수" type="number" min={1} max={30} style={{ width: 80 }} value={v.floorCount} onChange={(e) => setV({ ...v, floorCount: e.target.value })} /> 층{" "}
            지하 <input aria-label="지하 층수" type="number" min={0} max={5} style={{ width: 80 }} value={v.basementCount} onChange={(e) => setV({ ...v, basementCount: e.target.value })} /> 층
            <small className="hint" style={{ display: "block", marginTop: 4 }}>층은 자동으로 만들어지고, 나중에 ‘층 추가’로 더할 수 있습니다.</small>
          </FormRow>
        </tbody></table>
        <FormMsg kind={msg ? "bad" : undefined} text={msg} />
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <button type="button" className="btn sm sec" onClick={onClose}>취소</button>
          <button type="submit" className="btn sm" disabled={busy}>{busy ? "등록 중…" : "등록"}</button>
        </div>
      </form>
    </Modal>
  );
}

function AddFloor({ building, onClose, onSaved }: { building: Building; onClose: () => void; onSaved: (floorId: number, name: string) => void }) {
  const top = Math.max(0, ...building.floors.map((f) => f.floorNo ?? 0));
  const [v, setV] = useState({ floorNo: String(top + 1), floorName: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const no = Number(v.floorNo);
  const auto = no < 0 ? `지하${-no}층` : `${no}층`;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!Number.isInteger(no) || no === 0 || no < -5 || no > 30) return setMsg("층 번호는 1~30, 지하는 -1~-5로 입력해 주세요.");
    setBusy(true);
    try {
      const f = await api.post<{ floorId: number; floorName: string }>(`/api/as/spaces/buildings/${building.buildingId}/floors`, { floorNo: no, floorName: v.floorName.trim() || undefined });
      onSaved(f.floorId, f.floorName);
    } catch (er) {
      setMsg((er as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal title={`층 추가 · ${building.buildingName}`} onClose={onClose}>
      <form className="ft2" noValidate onSubmit={save}>
        <table className="ftab"><tbody>
          <FormRow label="층 번호" required>
            <input aria-label="층 번호" type="number" min={-5} max={30} style={{ width: 90 }} value={v.floorNo} onChange={(e) => setV({ ...v, floorNo: e.target.value })} />
            <small className="hint"> 지하는 음수 (지하1층 = -1)</small>
          </FormRow>
          <FormRow label="층 이름"><input aria-label="층 이름" placeholder={Number.isInteger(no) && no ? auto : "예: 옥탑"} value={v.floorName} onChange={(e) => setV({ ...v, floorName: e.target.value })} /></FormRow>
        </tbody></table>
        <FormMsg kind={msg ? "bad" : undefined} text={msg} />
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <button type="button" className="btn sm sec" onClick={onClose}>취소</button>
          <button type="submit" className="btn sm" disabled={busy}>{busy ? "추가 중…" : "추가"}</button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * 도면에서 장비를 옮길 때: 옮길 실을 꼭 받는다 (건물 · 층은 이 층). 실을 적고 [옮기기]를 눌러야 자리와 설치위치가
 * 함께 저장되고, [취소]하면 아이콘은 원래 자리로 돌아간다. 이 학교에서 쓴 실 이름을 추천한다.
 */
function MoveRoom({ device, floorId, floorText, pos, onSaved, onCancel }: {
  device: Device; floorId: number; floorText: string; pos: { x: number; y: number };
  onSaved: (d: Device, locationChanged: boolean) => void; onCancel: () => void;
}) {
  const loc = (device.location ?? "").trim();
  const current = loc === floorText ? "" : loc.startsWith(floorText + " ") ? loc.slice(floorText.length + 1) : loc;
  const [room, setRoom] = useState("");
  const [details, setDetails] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    api.get<DevicePlaces>("/api/as/wireless-devices/places", { schoolId: device.schoolId }).then((p) => setDetails(p.details)).catch(() => {});
  }, [device.schoolId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!room.trim()) return setMsg("옮길 실을 입력해 주세요.");
    setBusy(true);
    try {
      const d = await api.put<Device>(`/api/as/wireless-devices/${device.deviceId}/position`, { floorId, x: +pos.x.toFixed(2), y: +pos.y.toFixed(2), room: room.trim() });
      onSaved(d, (d.location ?? "").trim() !== loc);
    } catch (er) {
      setMsg((er as Error).message);
      setBusy(false);
    }
  };

  const picks = details.filter((x) => x !== current).slice(0, 8);
  return (
    <form className="fpv-ask need" onSubmit={submit} noValidate aria-label="옮길 실 입력">
      <div className="fpv-ask-h">
        <span className="fpv-ask-i" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.6" /></svg></span>
        <div>
          <b>{device.deviceCode} 옮기기</b>
          <small>새 자리의 <b>실</b>을 입력해야 저장됩니다 · 지금: {current || "실 미지정"}</small>
        </div>
      </div>
      <div className="fpv-ask-row">
        <label className={"fpv-ask-field" + (msg ? " bad" : "")}>
          <span className="fpv-ask-floor">{floorText}</span>
          <input aria-label="옮길 실" aria-required="true" aria-invalid={!!msg || undefined} list="fpv-ask-details" placeholder="옮길 실 (예: 컴퓨터실)" value={room}
            onChange={(e) => { setRoom(e.target.value); setMsg(""); }} autoFocus />
        </label>
        <datalist id="fpv-ask-details">{details.map((x) => <option key={x} value={x} />)}</datalist>
        <div className="fpv-ask-act">
          <button type="submit" className="btn sm" disabled={busy || !room.trim()}>{busy ? "옮기는 중…" : "옮기기"}</button>
          <button type="button" className="btn sm sec" onClick={onCancel}>취소</button>
        </div>
      </div>
      {(picks.length > 0 || current) && (
        <div className="fpv-ask-chips" role="group" aria-label="이 학교에서 쓴 실">
          <small>자주 쓴 실</small>
          {current && <button type="button" className={"fpv-chip" + (room === current ? " on" : "")} onClick={() => { setRoom(current); setMsg(""); }}>{current} <em>지금</em></button>}
          {picks.map((x) => <button key={x} type="button" className={"fpv-chip" + (room === x ? " on" : "")} onClick={() => { setRoom(x); setMsg(""); }}>{x}</button>)}
        </div>
      )}
      {msg && <small className="fpv-ask-err" role="alert">{msg}</small>}
    </form>
  );
}
