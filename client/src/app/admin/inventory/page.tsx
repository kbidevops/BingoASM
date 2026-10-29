"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Kpis, SchoolSelect, useSchoolChoice } from "@/components/admin/common";
import QrScanner, { ManualEntry } from "@/components/admin/QrScanner";
import SubPage from "@/components/SubPage";
import { ErrorBox, Icon, Loading, Modal, useToast } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { downloadCsv, type Room, type RoomDetail } from "@/lib/admin";
import { fmtDate, fmtDateTime } from "@/lib/format";

/**
 * 재물조사(QR): 실 QR(또는 실 선택) → 그 실의 자산 QR을 연속 스캔 → 실 완료 → 보고서 → 이동 반영 → 종료.
 * FOUND(제자리) · DUPLICATE(이미 확인) · MOVED(다른 실 자산) · UNKNOWN(미등록 번호)는 서버가 판정합니다.
 */
export default function InventoryPage() {
  return (
    <Suspense>
      <SubPage perm="INVENTORY">
        <Inventory />
      </SubPage>
    </Suspense>
  );
}

interface Session { sessionId: number; schoolId: number; title: string; startedAt: string; endedAt?: string; status: "OPEN" | "CLOSED"; doneRoomIds: number[] }
interface ReportRoom { roomId: number; roomNo?: string; roomName: string; fullName: string; registered: number; found: number; missing: number | null; moved: number; unknown: number; done: boolean; status: string; missingAssets: { assetId: number; assetNo: string; assetName: string }[] | null }
interface Scan { scanId: number; roomId: number; assetNo: string; assetId?: number; assetName?: string; result: "FOUND" | "MOVED" | "UNKNOWN"; fromRoomId?: number; fromRoomName?: string; applied?: boolean; scannedAt: string }
interface Report {
  session: Session;
  totals: { rooms: number; doneRooms: number; registered: number; found: number; missing: number; moved: number; unknown: number };
  rooms: ReportRoom[];
  scans: Scan[];
}

const ROOM_QR = /\/r\/(\d+)/;

function Inventory() {
  const toast = useToast();
  const { schools, schoolId, setSchoolId, fixed, err: schoolErr } = useSchoolChoice();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState<number | null>(null);
  const [showReport, setShowReport] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const open = sessions?.find((s) => s.status === "OPEN") ?? null;
  // ?room={id}: a room QR scanned with "QR 찍기" while a survey runs opens that room directly.
  const roomParam = Number(useSearchParams().get("room")) || null;
  const [wantRoom, setWantRoom] = useState<number | null>(null);
  useEffect(() => {
    if (!roomParam) return;
    setWantRoom(roomParam);
    api.get<{ schoolId: number }>(`/api/as/spaces/rooms/${roomParam}`).then((r) => setSchoolId(r.schoolId)).catch(() => setWantRoom(null));
  }, [roomParam, setSchoolId]);
  useEffect(() => {
    if (!wantRoom || !report || !rooms.some((r) => r.roomId === wantRoom)) return;
    setRoomId(wantRoom);
    setWantRoom(null);
  }, [wantRoom, report, rooms]);

  const loadSessions = useCallback(() => {
    if (!schoolId) return;
    setErr("");
    setReport(null);
    setRoomId(null);
    Promise.all([api.get<Session[]>("/api/as/inventory", { schoolId }), api.get<Room[]>("/api/as/spaces/rooms", { schoolId })])
      .then(([s, r]) => { setSessions(s); setRooms(r); }).catch((e) => setErr(e.message));
  }, [schoolId]);
  useEffect(loadSessions, [loadSessions]);

  const loadReport = useCallback(() => {
    if (!open) return;
    api.get<Report>(`/api/as/inventory/${open.sessionId}`).then(setReport).catch((e) => setErr(e.message));
  }, [open]);
  useEffect(loadReport, [loadReport]);

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/api/as/inventory", { schoolId, title: title.trim() || undefined });
      toast("재물조사를 시작했습니다. 조사할 실을 고르거나 실 QR을 찍으세요.");
      setTitle("");
      loadSessions();
    } catch (er) {
      toast((er as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (schoolErr) return <ErrorBox message={schoolErr} />;
  const assetTotal = rooms.reduce((n, r) => n + (r.assetCount ?? 0), 0);
  return (
    <div className="ivx">
      <div className="ivx-top">
        <SchoolSelect schools={schools} value={schoolId} fixed={fixed} onChange={setSchoolId} />
        <Link className="btn sm sec" href="/admin/spaces">공간(실) 관리 · 실 QR 출력</Link>
      </div>
      {err ? <ErrorBox message={err} onRetry={loadSessions} /> : !sessions ? <Loading /> : !open ? (
        <>
          <section className="ivx-card ivx-hero">
            <div className="ivx-hero-t">
              <h3>새 재물조사</h3>
              <p>실마다 문에 붙은 실 QR과 자산 라벨 QR을 차례로 찍으면, 확인·미확인·다른 실 자산이 자동으로 정리됩니다.</p>
              <ol className="ivx-steps">
                <li><b>1</b><span><strong>실 고르기</strong>실 QR을 찍거나 목록에서 선택</span></li>
                <li><b>2</b><span><strong>자산 스캔</strong>자산 라벨 QR을 연속으로</span></li>
                <li><b>3</b><span><strong>실 완료 · 보고서</strong>미확인·이동을 정리하고 종료</span></li>
              </ol>
            </div>
            {rooms.length ? (
              <form className="ivx-hero-f" onSubmit={start}>
                <div className="ivx-facts"><span><small>등록된 실</small><b>{rooms.length}</b>개</span><span><small>조사 대상 자산</small><b>{assetTotal.toLocaleString()}</b>대</span></div>
                <label htmlFor="iv-title">조사 이름</label>
                <input id="iv-title" maxLength={100} placeholder={`${new Date().toISOString().slice(0, 10)} 재물조사`} value={title} onChange={(e) => setTitle(e.target.value)} />
                <button type="submit" className="btn" disabled={busy}>{busy ? "시작하는 중…" : "재물조사 시작"}</button>
              </form>
            ) : (
              <div className="ivx-hero-f ivx-empty">
                <b>등록된 실이 없습니다</b>
                <p>재물조사는 실 단위로 진행합니다. 공간(실) 관리에서 건물·층·실을 먼저 등록하세요.</p>
                <Link className="btn" href="/admin/spaces">공간(실) 관리로 이동</Link>
              </div>
            )}
          </section>
          <h3 className="ivx-h">지난 재물조사 <span className="ivx-count">{sessions.length}</span></h3>
          {sessions.length ? (
            <ul className="ivx-hist">
              {sessions.map((s) => (
                <li key={s.sessionId}>
                  <div className="ivx-hist-t"><b>{s.title}</b><small>{fmtDateTime(s.startedAt)} ~ {s.endedAt ? fmtDateTime(s.endedAt) : "진행 중"}</small></div>
                  <span className="ivx-pill">완료 실 {s.doneRoomIds.length}/{rooms.length}</span>
                  <button type="button" className="btn sm sec" onClick={() => setShowReport(s.sessionId)}>보고서</button>
                </li>
              ))}
            </ul>
          ) : <p className="ivx-none">아직 진행한 재물조사가 없습니다.</p>}
        </>
      ) : !report ? <Loading /> : (
        <>
          <SessionHead session={open} report={report} compact={!!roomId} onReport={() => setShowReport(open.sessionId)} />
          {roomId ? (
            <RoomScan key={roomId} session={open} report={report} room={rooms.find((r) => r.roomId === roomId)!} rooms={rooms}
              onSwitch={(id) => setRoomId(id)} onBack={() => setRoomId(null)} onChanged={loadReport} />
          ) : <RoomPicker report={report} rooms={rooms} onPick={setRoomId} />}
        </>
      )}
      {showReport !== null && <ReportModal sessionId={showReport} rooms={rooms} onClose={() => setShowReport(null)} onChanged={() => { loadSessions(); }} />}
    </div>
  );
}

/** 진행 중인 조사의 요약: 실 진행률과 확인·이동·미등록 건수. */
function SessionHead({ session, report, compact, onReport }: { session: Session; report: Report; compact: boolean; onReport: () => void }) {
  const t = report.totals;
  const pct = t.rooms ? Math.round((t.doneRooms / t.rooms) * 100) : 0;
  // While a room is open the scanner matters most, so the summary shrinks to one line.
  if (compact) return (
    <section className="ivx-card ivx-sess-c">
      <span className="ivx-live">진행 중</span>
      <b>{session.title}</b>
      <span className="ivx-sess-c-p">실 완료 <b>{t.doneRooms}</b>/{t.rooms} · 확인 <b>{t.found}</b>/{t.registered}</span>
      <button type="button" className="linkbtn" onClick={onReport}>결과 보고서</button>
    </section>
  );
  return (
    <section className="ivx-card ivx-sess">
      <div className="ivx-sess-t">
        <span className="ivx-live">진행 중</span>
        <h3>{session.title}</h3>
        <small>{fmtDateTime(session.startedAt)} 시작</small>
      </div>
      <div className="ivx-sess-p">
        <div className="ivx-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="실 완료 비율"><i style={{ width: `${pct}%` }} /></div>
        <span>실 완료 <b>{t.doneRooms}</b>/{t.rooms} · {pct}%</span>
      </div>
      <dl className="ivx-stats">
        <div><dt>확인</dt><dd>{t.found}<em>/{t.registered}</em></dd></div>
        <div className="warn"><dt>이동 발견</dt><dd>{t.moved}</dd></div>
        <div className="bad"><dt>미등록</dt><dd>{t.unknown}</dd></div>
      </dl>
      <button type="button" className="btn sm sec" onClick={onReport}>결과 보고서 · 종료</button>
    </section>
  );
}

type RoomFilter = "all" | "todo" | "ing" | "done";

function RoomPicker({ report, rooms, onPick }: { report: Report; rooms: Room[]; onPick: (id: number) => void }) {
  const [scan, setScan] = useState(false);
  const [filter, setFilter] = useState<RoomFilter>("all");
  const toast = useToast();
  const byRoom = new Map(report.rooms.map((r) => [r.roomId, r]));
  const stateOf = (id: number): Exclude<RoomFilter, "all"> => {
    const s = byRoom.get(id);
    return s?.done ? "done" : s && s.found + s.moved + s.unknown > 0 ? "ing" : "todo";
  };
  const counts = { all: rooms.length, todo: 0, ing: 0, done: 0 };
  rooms.forEach((r) => { counts[stateOf(r.roomId)]++; });
  const groups = new Map<string, Room[]>();
  rooms.filter((r) => filter === "all" || stateOf(r.roomId) === filter).forEach((r) => {
    const k = `${r.buildingName ?? ""} ${r.floorName ?? ""}`.trim();
    groups.set(k, [...(groups.get(k) ?? []), r]);
  });
  const fromQr = (text: string) => {
    const m = text.match(ROOM_QR);
    const id = m ? Number(m[1]) : NaN;
    if (!m || !rooms.some((r) => r.roomId === id)) return toast("이 기관의 실 QR이 아닙니다. 문에 붙은 실 QR을 찍어 주세요.");
    setScan(false);
    onPick(id);
  };
  const FILTERS: [RoomFilter, string][] = [["all", "전체"], ["todo", "미조사"], ["ing", "진행 중"], ["done", "완료"]];
  return (
    <div id="iv">
      <div className="ivx-pick">
        <button type="button" className="ivx-qr" onClick={() => setScan(true)}>
          <span className="ivx-qr-i" aria-hidden="true"><Icon name="search" /></span>
          <span><b>실 QR 찍어서 시작</b><small>문 옆의 실 QR을 찍으면 그 실 조사가 열립니다</small></span>
        </button>
        <div className="ivx-filter" role="group" aria-label="실 상태">
          {FILTERS.map(([k, l]) => (
            <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l} <small>{counts[k]}</small></button>
          ))}
        </div>
      </div>
      {groups.size === 0 && <p className="ivx-none">이 상태의 실이 없습니다.</p>}
      {[...groups].map(([k, list]) => (
        <section key={k} className="ivx-floor">
          <h3 className="ivx-h">{k || "건물·층 미지정"} <span className="ivx-count">{list.length}</span></h3>
          <div className="ivx-grid">
            {list.map((r) => {
              const s = byRoom.get(r.roomId), st = stateOf(r.roomId);
              const reg = s?.registered ?? r.assetCount, found = s?.found ?? 0, pct = reg ? Math.round((found / reg) * 100) : 0;
              return (
                <button key={r.roomId} type="button" className={"ivx-room " + st} onClick={() => onPick(r.roomId)}>
                  <span className="ivx-room-h"><b>{r.roomName}</b><span className={"ivx-tag " + st}>{st === "done" ? "완료" : st === "ing" ? "진행 중" : "미조사"}</span></span>
                  <small>{r.roomNo ?? " "}</small>
                  <span className="ivx-mini"><i style={{ width: `${st === "todo" ? 0 : pct}%` }} /></span>
                  <span className="ivx-room-f">{st === "todo" ? `자산 ${reg}대` : `확인 ${found}/${reg}`}{s && s.moved + s.unknown > 0 ? ` · 확인 필요 ${s.moved + s.unknown}` : ""}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {scan && (
        <Modal title="실 QR 스캔" onClose={() => setScan(false)}>
          <QrScanner onText={fromQr} />
          <p className="hint scan-tip">조사할 실의 문에 붙은 실 QR을 찍으세요.</p>
        </Modal>
      )}
    </div>
  );
}

function RoomScan({ session, report, room, rooms, onSwitch, onBack, onChanged }: {
  session: Session; report: Report; room: Room; rooms: Room[]; onSwitch: (id: number) => void; onBack: () => void; onChanged: () => void;
}) {
  const toast = useToast();
  const [detail, setDetail] = useState<RoomDetail | null>(null);
  const [feed, setFeed] = useState<{ k: "" | "ok" | "warn" | "bad"; t: string }>({ k: "", t: "자산 라벨의 QR을 찍으세요. 다른 실의 실 QR을 찍으면 그 실로 바뀝니다." });
  const [cam, setCam] = useState(false);
  const [rev, setRev] = useState(0);
  const [tab, setTab] = useState<"todo" | "done" | "extra">("todo");
  const r = report.rooms.find((x) => x.roomId === room.roomId);

  useEffect(() => {
    api.get<RoomDetail>(`/api/as/spaces/rooms/${room.roomId}`).then(setDetail).catch((e) => toast(e.message));
  }, [room.roomId, toast, rev]);

  const scans = useMemo(() => report.scans.filter((s) => s.roomId === room.roomId), [report, room.roomId]);
  // An applied move makes the asset part of this room, so it counts as confirmed here.
  const foundIds = new Set(scans.filter((s) => s.result === "FOUND" || (s.result === "MOVED" && s.applied)).map((s) => s.assetId));
  const notYet = (detail?.assets ?? []).filter((a) => !foundIds.has(a.assetId));
  const confirmed = (detail?.assets ?? []).filter((a) => foundIds.has(a.assetId));
  // One line per number even if it was scanned several times.
  const extra = [...new Map(scans.filter((s) => s.result === "UNKNOWN" || (s.result === "MOVED" && !s.applied)).map((s) => [s.result + s.assetNo, s])).values()];

  /** 이동 발견 → 이 실로 옮기기: the asset's location becomes this room (자산 이력: 재물조사에서 이동 확인). */
  const moveHere = async (assetNo: string) => {
    const ids = scans.filter((s) => s.result === "MOVED" && !s.applied && s.assetNo === assetNo).map((s) => s.scanId);
    try {
      await api.post(`/api/as/inventory/${session.sessionId}/apply-moves`, { scanIds: ids });
      setFeed({ k: "ok", t: `✓ ${assetNo}을(를) ${room.roomName}(으)로 옮겼습니다.` });
      onChanged();
      setRev((n) => n + 1);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const handle = async (text: string) => {
    const m = text.match(ROOM_QR);
    if (m) {
      const id = Number(m[1]);
      if (id === room.roomId) return setFeed({ k: "warn", t: "지금 조사 중인 실입니다. 자산 QR을 찍으세요." });
      if (!rooms.some((x) => x.roomId === id)) return setFeed({ k: "bad", t: "이 기관의 실 QR이 아닙니다." });
      toast(`${rooms.find((x) => x.roomId === id)!.roomName}(으)로 바꿨습니다.`);
      return onSwitch(id);
    }
    try {
      const res = await api.post<{ result: string; message: string }>(`/api/as/inventory/${session.sessionId}/scans`, { roomId: room.roomId, text });
      setFeed({ k: res.result === "FOUND" ? "ok" : res.result === "DUPLICATE" ? "warn" : res.result === "MOVED" ? "warn" : "bad", t: res.message });
      if (res.result === "MOVED" || res.result === "UNKNOWN") setTab("extra");
      onChanged();
    } catch (e) {
      setFeed({ k: "bad", t: e instanceof ApiError ? e.message : "확인하지 못했습니다." });
    }
  };

  const setDone = async (done: boolean) => {
    try {
      await api.put(`/api/as/inventory/${session.sessionId}/rooms/${room.roomId}`, { done });
      toast(done ? `${room.roomName} 조사를 완료했습니다.` : "완료를 취소했습니다.");
      onChanged();
      if (done) onBack();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const reg = r?.registered ?? detail?.assets.length ?? 0, found = r?.found ?? 0;
  const pct = reg ? Math.round((found / reg) * 100) : 0;
  const FEED_ICON = { "": "•", ok: "✓", warn: "!", bad: "✕" } as const;
  const TABS = [["todo", "미확인", notYet.length], ["done", "확인됨", confirmed.length], ["extra", "다른 실 · 미등록", extra.length]] as const;
  return (
    <div id="iv">
      <section className="ivx-card ivx-roomhead">
        <button type="button" className="ivx-back" onClick={onBack} aria-label="실 목록으로">‹</button>
        <div className="ivx-roomhead-t">
          <small>{room.buildingName} {room.floorName}{room.roomNo ? ` · ${room.roomNo}` : ""}</small>
          <h3>{room.roomName} {r?.done && <span className="ivx-tag done">완료</span>}</h3>
        </div>
        <div className="ivx-ring" style={{ ["--p" as string]: pct }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="확인 비율">
          <span><b>{found}</b>/{reg}</span>
        </div>
        {r?.done
          ? <button type="button" className="btn sm sec" onClick={() => setDone(false)}>완료 취소</button>
          : <button type="button" className="btn sm" onClick={() => setDone(true)} disabled={!detail}>이 실 조사 완료</button>}
      </section>
      <div className="ivx-wrap">
        <section className="ivx-card ivx-scan">
          {cam ? <QrScanner continuous onText={handle} /> : (
            <button type="button" className="ivx-cam" onClick={() => setCam(true)}>
              <span className="ivx-qr-i" aria-hidden="true"><Icon name="search" /></span>
              <b>카메라로 연속 스캔</b>
              <small>자산 라벨을 차례로 비추면 자동으로 확인됩니다</small>
            </button>
          )}
          <div className="ivx-manual"><small>라벨이 손상됐다면 번호로 입력</small><ManualEntry onSubmit={handle} /></div>
          <div className={"ivx-feed " + feed.k} role="status" aria-live="assertive"><i aria-hidden="true">{FEED_ICON[feed.k]}</i><span>{feed.t}</span></div>
        </section>
        <section className="ivx-card ivx-lists">
          <div className="ivx-tabs" role="tablist" aria-label="자산 목록">
            {TABS.map(([k, l, n]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={k === "extra" && n ? "attn" : ""} onClick={() => setTab(k)}>{l} <span className="ivx-count">{n}</span></button>
            ))}
          </div>
          {!detail ? <Loading /> : tab === "todo" ? (
            notYet.length ? <ul className="ivx-l">{notYet.map((a) => <li key={a.assetId}><span className="ivx-dot todo" /><span className="ivx-l-t"><b>{a.assetNo}</b><em>{a.assetName}</em></span></li>)}</ul>
              : <p className="ivx-none ok">이 실의 자산을 모두 확인했습니다. ‘이 실 조사 완료’를 누르세요.</p>
          ) : tab === "done" ? (
            confirmed.length ? <ul className="ivx-l">{confirmed.map((a) => <li key={a.assetId}><span className="ivx-dot ok" /><span className="ivx-l-t"><b>{a.assetNo}</b><em>{a.assetName}</em></span></li>)}</ul>
              : <p className="ivx-none">아직 확인한 자산이 없습니다.</p>
          ) : extra.length ? (
            <>
              <ul className="ivx-l">
                {extra.map((s) => (
                  <li key={s.scanId}>
                    <span className={"ivx-dot " + (s.result === "MOVED" ? "warn" : "bad")} />
                    <span className="ivx-l-t">
                      <b>{s.assetNo}</b>
                      <em>{s.result === "MOVED" ? `${s.assetName ?? ""} — ${s.fromRoomName ?? "위치 미지정"}에 등록됨` : "등록되지 않은 번호"}</em>
                    </span>
                    {s.result === "MOVED"
                      ? <button type="button" className="btn sm" onClick={() => moveHere(s.assetNo)}>이 실로 옮기기</button>
                      : <Link className="btn sm sec" href={`/admin/assets?no=${encodeURIComponent(s.assetNo)}`}>이 번호로 등록</Link>}
                  </li>
                ))}
              </ul>
              {extra.some((s) => s.result === "MOVED") && (
                <p className="hint ivx-note">실제로 이 실에서 쓰는 자산이면 ‘이 실로 옮기기’를 누르세요. 원래 실로 다시 가져다 놓을 자산이면 그대로 두면 됩니다 — 위치는 바뀌지 않습니다.</p>
              )}
            </>
          ) : <p className="ivx-none">다른 실 자산이나 미등록 번호가 없습니다.</p>}
        </section>
      </div>
    </div>
  );
}

function ReportModal({ sessionId, rooms, onClose, onChanged }: { sessionId: number; rooms: Room[]; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [rep, setRep] = useState<Report | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api.get<Report>(`/api/as/inventory/${sessionId}`).then(setRep).catch((e) => setErr(e.message));
  }, [sessionId]);
  useEffect(load, [load]);

  const run = async (f: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await f();
      toast(ok);
      load();
      onChanged();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const roomName = (id?: number) => rooms.find((r) => r.roomId === id)?.fullName ?? "-";
  const allMoved = rep?.scans.filter((s) => s.result === "MOVED") ?? [];
  const pending = allMoved.filter((s) => !s.applied);
  // One line per asset and room, however many times it was scanned.
  const moved = [...new Map(allMoved.map((s) => [`${s.assetNo}@${s.roomId}`, s])).values()];
  const pendingCount = new Set(pending.map((s) => `${s.assetNo}@${s.roomId}`)).size;
  const unknown = [...new Map((rep?.scans.filter((s) => s.result === "UNKNOWN") ?? []).map((s) => [`${s.assetNo}@${s.roomId}`, s])).values()];
  const missing = rep?.rooms.flatMap((r) => (r.missingAssets ?? []).map((a) => ({ ...a, room: r.fullName }))) ?? [];
  const isOpen = rep?.session.status === "OPEN";

  const csv = () => rep && downloadCsv(`재물조사_${rep.session.title}`, ["실", "등록", "확인", "미확인", "이동 발견", "미등록", "상태"],
    rep.rooms.map((r) => [r.fullName, r.registered, r.found, r.missing ?? "", r.moved, r.unknown, r.status]));

  return (
    <Modal title="재물조사 결과 보고서" wide onClose={onClose}>
      {err ? <ErrorBox message={err} /> : !rep ? <Loading /> : (
        <>
          <p style={{ margin: "0 0 8px" }}><b>{rep.session.title}</b> <small className="hint">{fmtDateTime(rep.session.startedAt)} ~ {rep.session.endedAt ? fmtDateTime(rep.session.endedAt) : "진행 중"}</small></p>
          <Kpis items={[
            ["조사 완료 실", rep.totals.doneRooms, `/${rep.totals.rooms}`],
            ["확인", rep.totals.found, `/${rep.totals.registered}대`],
            ["미확인 (완료한 실)", rep.totals.missing, "대"],
            ["이동 발견 · 미등록", `${rep.totals.moved} · ${rep.totals.unknown}`, "건"],
          ]} />
          <div className="tw">
            <table className="cards">
              <thead><tr>{["실", "등록", "확인", "미확인", "이동 발견", "미등록", "상태"].map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
              <tbody>
                {rep.rooms.map((r) => (
                  <tr key={r.roomId}>
                    <td data-label="실" className="tl">{r.fullName}</td><td data-label="등록">{r.registered}</td><td data-label="확인">{r.found}</td>
                    <td data-label="미확인">{r.missing ?? "-"}</td><td data-label="이동 발견">{r.moved}</td><td data-label="미등록">{r.unknown}</td>
                    <td data-label="상태"><b className={"st " + (r.done ? "s1" : r.status === "대기" ? "s3" : "s2")}>{r.status}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {missing.length > 0 && (
            <details open><summary style={{ cursor: "pointer", fontWeight: 700 }}>미확인 자산 ({missing.length}) — 분실·이동 여부를 확인하세요</summary>
              <ul className="dash">{missing.map((a) => <li key={a.assetId}><b>{a.assetNo}</b> {a.assetName} <small className="hint">({a.room})</small></li>)}</ul>
            </details>
          )}
          {moved.length > 0 && (
            <details open><summary style={{ cursor: "pointer", fontWeight: 700 }}>이동 발견 ({moved.length})</summary>
              <ul className="dash">
                {moved.map((s) => <li key={s.scanId}><b>{s.assetNo}</b> {s.assetName} — {s.fromRoomName ?? "-"} → {roomName(s.roomId)} {s.applied && <b className="st s1">반영됨</b>}</li>)}
              </ul>
              {isOpen && pending.length > 0 && (
                <button type="button" className="btn sm" disabled={busy}
                  onClick={() => run(() => api.post(`/api/as/inventory/${sessionId}/apply-moves`, { scanIds: pending.map((s) => s.scanId) }), `자산 ${pendingCount}대의 위치를 스캔한 실로 옮겼습니다.`)}>
                  이동 {pendingCount}건 모두 자산 위치에 반영
                </button>
              )}
            </details>
          )}
          {unknown.length > 0 && (
            <details><summary style={{ cursor: "pointer", fontWeight: 700 }}>미등록 번호 ({unknown.length})</summary>
              <ul className="dash">{unknown.map((s) => <li key={s.scanId}><b>{s.assetNo}</b> — {roomName(s.roomId)} <small className="hint">{fmtDate(s.scannedAt)}</small></li>)}</ul>
              <p className="hint">기관자산관리에서 이 번호로 자산을 등록할 수 있습니다.</p>
            </details>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 14, flexWrap: "wrap" }}>
            <button type="button" className="btn sm sec" onClick={csv}>엑셀출력 <Icon name="down" /></button>
            <button type="button" className="btn sm bl" onClick={() => window.print()}>인쇄</button>
            {isOpen && (
              <button type="button" className="btn sm" disabled={busy}
                onClick={() => confirm("재물조사를 종료할까요? 종료하면 더 이상 스캔할 수 없습니다.") && run(() => api.post(`/api/as/inventory/${sessionId}/close`), "재물조사를 종료했습니다.")}>
                조사 종료
              </button>
            )}
            <button type="button" className="btn sm dk" onClick={onClose}>닫기</button>
          </div>
        </>
      )}
    </Modal>
  );
}
