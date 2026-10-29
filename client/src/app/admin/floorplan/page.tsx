"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SchoolSelect, StatusDot, useSchoolChoice } from "@/components/admin/common";
import PlanUploadModal from "@/components/admin/PlanUploadModal";
import SubPage from "@/components/SubPage";
import { ErrorBox, Icon, Loading, useToast } from "@/components/ui";
import { api, API_BASE } from "@/lib/api";
import { ASSET_STATUSES, badgeClass, fetchAll, label, type Asset, type Building, type Rect, type Room, type RoomDetail } from "@/lib/admin";
import { useAuth } from "@/lib/auth";

/**
 * 자산 위치(도면): 층 도면 이미지 위에 실 영역(rect, 퍼센트 0~100)을 그리고 자산을 실에 배치합니다.
 * /admin/floorplan?room={roomId} 는 실 QR(/r/{id})이 여는 주소입니다.
 */
export default function FloorplanPage() {
  return (
    <Suspense>
      <SubPage perm="FLOOR_READ">
        <Floorplan />
      </SubPage>
    </Suspense>
  );
}

type Mode = "view" | "rooms" | "assets";

function Floorplan() {
  const params = useSearchParams();
  const toast = useToast();
  const { can } = useAuth();
  const canEdit = can("SPACE_MANAGE");
  const { schools, schoolId, setSchoolId, fixed, err: schoolErr } = useSchoolChoice();
  const [blds, setBlds] = useState<Building[] | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [bid, setBid] = useState<number | null>(null);
  const [fid, setFid] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("view");
  const [zoom, setZoom] = useState(1);
  const [sel, setSel] = useState<number | null>(null);
  const [detail, setDetail] = useState<RoomDetail | null>(null);
  const [err, setErr] = useState("");
  const [bust, setBust] = useState(0);
  const [uploading, setUploading] = useState(false);
  const target = useRef<{ room?: number; building?: number; floor?: number }>({
    room: Number(params.get("room")) || undefined, building: Number(params.get("building")) || undefined, floor: Number(params.get("floor")) || undefined,
  });
  // Current building/floor for reloads (e.g. after a plan upload) so the view stays where the user is.
  const cur = useRef({ bid, fid });
  cur.current = { bid, fid };

  // A room QR may belong to another school than the default one.
  useEffect(() => {
    const room = target.current.room;
    if (!room) return;
    api.get<RoomDetail>(`/api/as/spaces/rooms/${room}`).then((r) => {
      setSchoolId(r.schoolId);
      target.current = { room, building: r.buildingId, floor: r.floorId };
    }).catch((e) => toast(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(() => {
    if (!schoolId) return;
    setErr("");
    Promise.all([api.get<Building[]>("/api/as/spaces/buildings", { schoolId }), api.get<Room[]>("/api/as/spaces/rooms", { schoolId })])
      .then(([b, r]) => {
        setBlds(b);
        setRooms(r);
        const t = target.current, c = cur.current;
        const b0 = b.find((x) => x.buildingId === t.building) ?? b.find((x) => x.buildingId === c.bid) ?? b[0];
        setBid(b0?.buildingId ?? null);
        const f0 = b0?.floors.find((x) => x.floorId === t.floor) ?? b0?.floors.find((x) => x.floorId === c.fid) ?? b0?.floors.find((x) => x.planUrl) ?? b0?.floors[0];
        setFid(f0?.floorId ?? null);
        if (t.room) { setSel(t.room); target.current = {}; }
      }).catch((e) => setErr(e.message));
  }, [schoolId]);
  useEffect(load, [load]);

  const reloadRooms = useCallback(() => schoolId && api.get<Room[]>("/api/as/spaces/rooms", { schoolId }).then(setRooms), [schoolId]);

  useEffect(() => {
    if (!sel) return setDetail(null);
    api.get<RoomDetail>(`/api/as/spaces/rooms/${sel}`).then(setDetail).catch(() => setDetail(null));
  }, [sel, rooms]);

  if (schoolErr) return <ErrorBox message={schoolErr} />;
  const b = blds?.find((x) => x.buildingId === bid);
  const f = b?.floors.find((x) => x.floorId === fid);
  const floorRooms = rooms.filter((r) => r.floorId === fid);

  /** Called by PlanUploadModal with the converted PNG/JPEG; errors are shown inside the dialog. */
  const upload = async (file: File) => {
    if (!f) return;
    const form = new FormData();
    form.append("file", file);
    await api.upload(`/api/places/floors/${f.floorId}/plan`, form);
    setUploading(false);
    toast("도면을 올렸습니다. ‘실 영역 표시’에서 실 위치를 그려 주세요.");
    setBust(Date.now());
    load();
  };

  return (
    <div className="fpv">
      <div className="fpv-top">
        <SchoolSelect schools={schools} value={schoolId} fixed={fixed} onChange={(id) => { setSchoolId(id); setSel(null); }} />
        <Link className="btn sm sec" href="/admin/spaces">공간(실) 관리</Link>
      </div>
      {err ? <ErrorBox message={err} onRetry={load} /> : !blds ? <Loading /> : !blds.length ? (
        <p className="empty">등록된 건물이 없습니다. <Link href="/admin/spaces">공간(실) 관리</Link>에서 건물과 실을 먼저 등록하세요.</p>
      ) : (
        <>
          <nav className="fpv-nav" aria-label="건물·층">
            <div className="fpv-seg" role="group" aria-label="건물">
              {blds.map((x) => (
                <button key={x.buildingId} type="button" aria-pressed={x.buildingId === bid}
                  onClick={() => { setBid(x.buildingId); setFid((x.floors.find((y) => y.planUrl) ?? x.floors[0])?.floorId ?? null); setSel(null); }}>{x.buildingName}</button>
              ))}
            </div>
            <div className="fpv-floors" role="tablist" aria-label="층">
              {b?.floors.map((x) => (
                <button key={x.floorId} type="button" role="tab" aria-selected={x.floorId === fid} onClick={() => { setFid(x.floorId); setSel(null); }}>
                  <b>{x.floorName}</b>
                  <small className={x.planUrl ? "" : "warn"}>{x.planUrl ? `실 ${rooms.filter((r) => r.floorId === x.floorId).length}` : "도면 없음"}</small>
                </button>
              ))}
            </div>
          </nav>
          {!f ? <p className="empty">이 건물에 층이 없습니다.</p> : !f.planUrl ? (
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
              <p className="hint">이 층의 실 {floorRooms.length}개{floorRooms.length ? ": " + floorRooms.map((r) => r.roomName).join(", ") : ""}</p>
            </div>
          ) : (
            <PlanView key={f.floorId} planUrl={`${API_BASE}${f.planUrl}${bust ? `?v=${bust}` : ""}`} title={`${b!.buildingName} ${f.floorName}`}
              schoolId={schoolId!} rooms={floorRooms} mode={mode} setMode={setMode} zoom={zoom} setZoom={setZoom} canEdit={canEdit}
              sel={sel} setSel={setSel} detail={detail} onRoomsChanged={reloadRooms} onReplace={can("FLOOR_WRITE") ? () => setUploading(true) : undefined} />
          )}
        </>
      )}
      {uploading && f && <PlanUploadModal title={`${b!.buildingName} ${f.floorName}`} onClose={() => setUploading(false)} onUpload={upload} />}
    </div>
  );
}

const MODES = [["view", "보기"], ["rooms", "실 영역 표시"], ["assets", "자산 배치"]] as const;
const HINTS: Record<Mode, string> = {
  view: "실을 누르면 그 실의 자산 목록이 나옵니다.",
  rooms: "목록에서 실을 고른 뒤, 도면 위에서 끌어서 영역을 그리세요. 다시 그리면 위치가 바뀝니다.",
  assets: "목록에서 자산을 체크한 뒤, 도면에서 넣을 실을 누르세요.",
};

function PlanView({ planUrl, title, schoolId, rooms, mode, setMode, zoom, setZoom, canEdit, sel, setSel, detail, onRoomsChanged, onReplace }: {
  planUrl: string; title: string; schoolId: number; rooms: Room[]; mode: Mode; setMode: (m: Mode) => void; zoom: number; setZoom: (z: number) => void;
  canEdit: boolean; sel: number | null; setSel: (id: number | null) => void; detail: RoomDetail | null; onRoomsChanged: () => void; onReplace?: () => void;
}) {
  const toast = useToast();
  const canvas = useRef<HTMLDivElement>(null);
  const [draw, setDraw] = useState<{ x0: number; y0: number; r: Rect } | null>(null);
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [q, setQ] = useState("");
  const placed = rooms.filter((r) => r.rect);

  useEffect(() => {
    if (mode !== "assets") return;
    fetchAll<Asset>("/api/assets", { schoolId }).then(setAssets).catch((e) => toast(e.message));
  }, [mode, schoolId, toast]);

  const frac = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)), y: Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)) };
  };

  const saveRect = async (roomId: number, rect: Rect | null) => {
    try {
      await api.put(`/api/as/spaces/rooms/${roomId}`, { rect });
      onRoomsChanged();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const onDown = (e: React.PointerEvent) => {
    if (mode !== "rooms" || !sel) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = frac(e);
    setDraw({ x0: p.x, y0: p.y, r: { x: p.x, y: p.y, w: 0, h: 0 } });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!draw) return;
    const p = frac(e);
    setDraw({ ...draw, r: { x: Math.min(draw.x0, p.x), y: Math.min(draw.y0, p.y), w: Math.abs(p.x - draw.x0), h: Math.abs(p.y - draw.y0) } });
  };
  const onUp = () => {
    if (!draw || !sel) return;
    const r = draw.r;
    setDraw(null);
    if (r.w < 1 || r.h < 1) return toast("도면 위에서 끌어서 실 영역을 그려 주세요.");
    saveRect(sel, { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.w.toFixed(2), h: +r.h.toFixed(2) });
    // Move on to the next room without an area.
    const next = rooms.find((x) => !x.rect && x.roomId !== sel);
    setSel(next?.roomId ?? sel);
  };

  const moveTo = async (roomId: number) => {
    if (!picked.size) return setSel(roomId);
    try {
      const r = await api.post<{ moved: number; roomName: string }>("/api/as/spaces/rooms/move-assets", { roomId, assetIds: [...picked], how: "도면에서 배치" });
      toast(`${r.roomName}에 자산 ${r.moved}대를 배치했습니다.`);
      setPicked(new Set());
      setAssets(await fetchAll<Asset>("/api/assets", { schoolId }));
      onRoomsChanged();
      setSel(roomId);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const roomName = useMemo(() => new Map(rooms.map((r) => [r.roomId, r.roomName])), [rooms]);
  const query = q.trim();
  const listAssets = (assets ?? []).filter((a) => !query || a.assetNo.includes(query.toUpperCase()) || a.assetName.includes(query));
  const here = new Set(rooms.map((r) => r.roomId));
  const unassigned = listAssets.filter((a) => !a.roomId);
  const elsewhere = listAssets.filter((a) => a.roomId && !here.has(a.roomId));
  const inFloor = listAssets.filter((a) => a.roomId && here.has(a.roomId));
  const unplaced = rooms.filter((r) => !r.rect);
  const assetTotal = rooms.reduce((n, r) => n + r.assetCount, 0);
  const toggle = (id: number, on: boolean) => setPicked((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });

  const assetRow = (a: Asset) => (
    <li key={a.assetId}>
      <label className={"fpv-row" + (picked.has(a.assetId) ? " on" : "")}>
        <input type="checkbox" checked={picked.has(a.assetId)} onChange={(e) => toggle(a.assetId, e.target.checked)} />
        <span className="fpv-row-t">
          <b>{a.assetNo}</b>
          <small>{a.assetName}{a.roomId ? ` · ${roomName.get(a.roomId) ?? a.floorName ?? "다른 층"}` : ""}</small>
        </span>
        {a.categoryName && <span className="fpv-tag">{a.categoryName}</span>}
      </label>
    </li>
  );
  const group = (name: string, list: Asset[], open: boolean) => (
    <details className="fpv-grp" open={open || !!query}>
      <summary>{name}<span className="fpv-count">{list.length}</span></summary>
      {list.length ? <ul className="fpv-list">{list.map(assetRow)}</ul> : <p className="fpv-none">없음</p>}
    </details>
  );

  return (
    <>
      <div className="fpv-tool">
        <div className="fpv-seg fpv-modes" role="group" aria-label="모드">
          {MODES.filter(([m]) => m === "view" || canEdit).map(([m, l]) => (
            <button key={m} type="button" aria-pressed={mode === m}
              onClick={() => { setMode(m); setDraw(null); if (m === "rooms" && !sel) setSel(rooms.find((r) => !r.rect)?.roomId ?? rooms[0]?.roomId ?? null); }}>{l}</button>
          ))}
        </div>
        <div className="fpv-seg fpv-zoom" role="group" aria-label="확대">
          <button type="button" aria-label="축소" disabled={zoom <= 1} onClick={() => setZoom(Math.max(1, zoom - 0.5))}>−</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label="확대" disabled={zoom >= 3} onClick={() => setZoom(Math.min(3, zoom + 0.5))}>＋</button>
        </div>
        <div className="fpv-stats">
          <span>실 표시 <b>{placed.length}</b>/{rooms.length}</span>
          <span>이 층 자산 <b>{assetTotal}</b>대</span>
        </div>
        {onReplace && <button type="button" className="btn sm sec fpv-replace" onClick={onReplace}>도면 바꾸기</button>}
      </div>

      <div className="fpv-body">
        <section className="fpv-card fpv-stage">
          <p className={"fpv-hint m-" + mode}>{HINTS[mode]}</p>
          <div className="fpv-scroll">
            <div ref={canvas} className={`fpv-canvas m-${mode}`} style={{ width: `${zoom * 100}%` }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={planUrl} alt={`${title} 도면`} draggable={false} />
              {placed.map((r) => (
                <div key={r.roomId} className={"fpv-room" + (sel === r.roomId ? " sel" : "") + (mode === "assets" && picked.size ? " drop" : "")} role="button" tabIndex={0}
                  title={`${r.roomNo ? r.roomNo + " " : ""}${r.roomName} · 자산 ${r.assetCount}대`}
                  style={{ left: `${r.rect!.x}%`, top: `${r.rect!.y}%`, width: `${r.rect!.w}%`, height: `${r.rect!.h}%`, pointerEvents: mode === "rooms" && draw ? "none" : undefined }}
                  aria-label={`${r.roomNo ?? ""} ${r.roomName}, 자산 ${r.assetCount}대`}
                  onPointerDown={(e) => { if (mode !== "rooms") e.stopPropagation(); }}
                  onClick={() => (mode === "assets" ? moveTo(r.roomId) : mode === "view" ? setSel(r.roomId) : undefined)}
                  onKeyDown={(e) => { if (e.key === "Enter") (mode === "assets" ? moveTo(r.roomId) : setSel(r.roomId)); }}>
                  <span className="fpv-lbl"><span className="nm">{r.roomName}</span><span className="ct">{r.assetCount}</span></span>
                </div>
              ))}
              {draw && <div className="fpv-draw" style={{ left: `${draw.r.x}%`, top: `${draw.r.y}%`, width: `${draw.r.w}%`, height: `${draw.r.h}%` }} />}
            </div>
          </div>
          <div className="fpv-legend">
            <span><i className="lg-room" />실 영역</span>
            <span><i className="lg-sel" />선택한 실</span>
            <span><i className="lg-ct">3</i>자산 수</span>
            {unplaced.length > 0 && <span className="fpv-warn">도면에 없는 실 {unplaced.length}개</span>}
          </div>
        </section>

        <aside className="fpv-card fpv-side">
          {mode === "rooms" ? (
            <>
              <header className="fpv-sh"><h3>실 영역 표시</h3><span className="fpv-count">{placed.length}/{rooms.length}</span></header>
              <ul className="fpv-list">
                {rooms.map((r) => (
                  <li key={r.roomId} className={"fpv-rrow" + (sel === r.roomId ? " on" : "")}>
                    <button type="button" className="fpv-rrow-t" aria-pressed={sel === r.roomId} onClick={() => setSel(r.roomId)}>
                      <b>{r.roomName}</b><small>{r.roomNo ?? ""}</small>
                    </button>
                    <span className={"fpv-pill " + (sel === r.roomId ? "now" : r.rect ? "ok" : "warn")}>{sel === r.roomId ? "그리는 중" : r.rect ? "표시됨" : "미표시"}</span>
                    {r.rect && <button type="button" className="fpv-x" aria-label={`${r.roomName} 영역 지우기`} title="영역 지우기" onClick={() => saveRect(r.roomId, null)}>✕</button>}
                  </li>
                ))}
                {!rooms.length && <li className="fpv-none">이 층에 실이 없습니다. <Link href="/admin/spaces">공간(실) 관리</Link>에서 추가하세요.</li>}
              </ul>
            </>
          ) : mode === "assets" ? (
            <>
              <header className="fpv-sh"><h3>자산 배치</h3>{assets && <span className="fpv-count">{assets.length}</span>}</header>
              <div className="fpv-search">
                <Icon name="search" />
                <input aria-label="자산 검색" placeholder="자산번호·품명 검색" value={q} onChange={(e) => setQ(e.target.value)} />
                {q && <button type="button" aria-label="검색어 지우기" onClick={() => setQ("")}>✕</button>}
              </div>
              {assets === null ? <Loading /> : (
                <div className="fpv-groups">
                  {group("위치 미지정", unassigned, true)}
                  {group("이 층", inFloor, true)}
                  {group("다른 층·건물", elsewhere, false)}
                </div>
              )}
              {picked.size > 0 && (
                <div className="fpv-action" role="status">
                  <div className="fpv-action-t"><b>{picked.size}대 선택</b><small>도면에서 넣을 실을 누르세요</small></div>
                  <button type="button" className="btn sm sec" onClick={() => setPicked(new Set())}>선택 해제</button>
                  {unplaced.length > 0 && (
                    <div className="fpv-chips"><small>도면에 없는 실로 넣기</small>
                      {unplaced.map((r) => <button key={r.roomId} type="button" onClick={() => moveTo(r.roomId)}>{r.roomName}</button>)}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : detail ? (
            <>
              <header className="fpv-sh">
                <div><h3>{detail.roomName}</h3><small>{[detail.roomNo, detail.fullName, detail.ownerName && `담당 ${detail.ownerName}`].filter(Boolean).join(" · ")}</small></div>
                <button type="button" className="fpv-x" aria-label="닫기" onClick={() => setSel(null)}>✕</button>
              </header>
              <ul className="fpv-list">
                {detail.assets.map((a) => (
                  <li key={a.assetId}>
                    <Link className="fpv-row" href={`/admin/assets?no=${encodeURIComponent(a.assetNo)}`}>
                      <span className="fpv-row-t"><b>{a.assetNo}</b><small>{a.assetName}</small></span>
                      <StatusDot cls={badgeClass(ASSET_STATUSES, a.status)} name={label(ASSET_STATUSES, a.status)} />
                    </Link>
                  </li>
                ))}
                {!detail.assets.length && <li className="fpv-none">이 실에 등록된 자산이 없습니다.</li>}
              </ul>
            </>
          ) : (
            <>
              <header className="fpv-sh"><h3>{title}</h3></header>
              <div className="fpv-kpis">
                <div><small>도면 표시</small><b>{placed.length}<em>/{rooms.length}</em></b></div>
                <div><small>자산</small><b>{assetTotal}<em>대</em></b></div>
              </div>
              {unplaced.length > 0 && (
                <div className="fpv-chips"><small>도면에 없는 실</small>
                  {unplaced.map((r) => <button key={r.roomId} type="button" onClick={() => setSel(r.roomId)}>{r.roomName}</button>)}
                </div>
              )}
              {canEdit && (
                <div className="fpv-cta">
                  {unplaced.length > 0 && <button type="button" className="btn sm sec" onClick={() => { setMode("rooms"); setSel(unplaced[0].roomId); }}>실 영역 표시</button>}
                  <button type="button" className="btn sm" onClick={() => setMode("assets")}>자산 배치하기</button>
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </>
  );
}
