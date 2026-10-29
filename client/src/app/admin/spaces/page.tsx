"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Confirm, Kpis, SchoolSelect, ToolButton, usePrintSheet, useSchoolChoice } from "@/components/admin/common";
import SubPage from "@/components/SubPage";
import { ErrorBox, FormMsg, FormRow, Icon, Loading, Modal, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { protectedImage, ROOM_TYPES, type Building, type Floor, type Room } from "@/lib/admin";

/** 공간(실) 관리: 기관 → 건물 → 층 → 실. 실은 자산 위치·도면·재물조사의 기준이 됩니다. */
export default function SpacesPage() {
  return (
    <SubPage perm="SPACE_MANAGE">
      <Spaces />
    </SubPage>
  );
}

type Dialog =
  | { kind: "building" }
  | { kind: "floor"; building: Building }
  | { kind: "room"; room?: Room; floorId?: number }
  | { kind: "bulk"; floorId?: number }
  | { kind: "delBuilding"; building: Building };

function Spaces() {
  const toast = useToast();
  const { schools, schoolId, setSchoolId, fixed, err: schoolErr } = useSchoolChoice();
  const [blds, setBlds] = useState<Building[] | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [err, setErr] = useState("");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [delRoom, setDelRoom] = useState<Room | null>(null);
  const { print, sheet } = usePrintSheet();

  const load = useCallback(() => {
    if (!schoolId) return;
    setErr("");
    Promise.all([
      api.get<Building[]>("/api/as/spaces/buildings", { schoolId }),
      api.get<Room[]>("/api/as/spaces/rooms", { schoolId }),
    ]).then(([b, r]) => { setBlds(b); setRooms(r); }).catch((e) => setErr(e.message));
  }, [schoolId]);
  useEffect(load, [load]);

  const printRoomLabels = async (list: Room[]) => {
    if (!list.length) return toast("출력할 실이 없습니다.");
    try {
      const imgs = await Promise.all(list.slice(0, 60).map((r) => protectedImage(`/api/qr/room/${r.roomId}.png?size=240`)));
      print(
        <div className="lsheet">
          {list.slice(0, 60).map((r, i) => (
            <div className="lbl" key={r.roomId}>
              <img className="qr" src={imgs[i]} alt={`${r.roomName} 실 QR`} />
              <div className="lbl-t"><small>충북교육청 원클릭AS · 실 QR</small><b>{r.roomName}</b><span>{r.roomNo ?? ""}</span><em>{r.buildingName} {r.floorName}</em></div>
            </div>
          ))}
        </div>,
      );
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const removeRoom = async () => {
    try {
      await api.del(`/api/as/spaces/rooms/${delRoom!.roomId}`);
      toast("실을 삭제했습니다.");
      setDelRoom(null);
      load();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  if (schoolErr) return <ErrorBox message={schoolErr} />;
  const floors = (blds ?? []).flatMap((b) => b.floors.map((f) => ({ ...f, building: b })));
  const placed = rooms.filter((r) => r.rect).length;
  const assets = rooms.reduce((n, r) => n + r.assetCount, 0);

  return (
    <>
      <div className="pl-top">
        <SchoolSelect schools={schools} value={schoolId} fixed={fixed} onChange={setSchoolId} />
        <Link className="linkbtn" href="/admin/floorplan">자산 위치(도면)</Link>
      </div>
      {err ? <ErrorBox message={err} onRetry={load} /> : !blds ? <Loading /> : (
        <>
          <Kpis items={[
            ["건물 · 실", `${blds.length} · ${rooms.length}`, "개"],
            ["도면이 있는 층", `${floors.filter((f) => f.planUrl).length}`, `/${floors.length}`],
            ["도면에 표시된 실", `${placed}`, `/${rooms.length}`],
            ["실에 배정된 자산", assets.toLocaleString(), "대"],
          ]} />
          <div className="atool sp-tool">
            <ToolButton icon={<Icon name="school" />} label="+ 건물 추가" onClick={() => setDialog({ kind: "building" })} />
            <ToolButton icon={<Icon name="pen" />} label="+ 실 추가" onClick={() => floors.length ? setDialog({ kind: "room" }) : toast("먼저 건물을 추가하세요.")} />
            <ToolButton icon={<Icon name="inbox" />} label="여러 실 한 번에 추가" onClick={() => floors.length ? setDialog({ kind: "bulk" }) : toast("먼저 건물을 추가하세요.")} />
            <ToolButton icon={<Icon name="print" />} label="실 QR 라벨 출력" onClick={() => printRoomLabels(rooms)} />
          </div>
          {!blds.length && <p className="empty">등록된 건물이 없습니다. ‘+ 건물 추가’로 시작하세요.</p>}
          {blds.map((b) => (
            <section key={b.buildingId} className="sp-b">
              <div className="sp-bh">
                <h3>{b.buildingName}</h3>
                <span className="hint">{b.floors.map((f) => f.floorName).join(" · ") || "층 없음"}</span>
                <span className="sp-bt">
                  <button type="button" className="linkbtn" onClick={() => setDialog({ kind: "floor", building: b })}>층 추가</button>{" "}
                  <button type="button" className="linkbtn" onClick={() => setDialog({ kind: "delBuilding", building: b })}>건물 삭제</button>
                </span>
              </div>
              {b.floors.map((f) => <FloorBlock key={f.floorId} b={b} f={f} rooms={rooms.filter((r) => r.floorId === f.floorId)}
                onAddRooms={() => setDialog({ kind: "bulk", floorId: f.floorId })} onEdit={(r) => setDialog({ kind: "room", room: r })}
                onDelete={setDelRoom} onLabel={(r) => printRoomLabels([r])} />)}
            </section>
          ))}
          {delRoom && <Confirm text={`${delRoom.fullName}을(를) 삭제할까요? 이 실의 자산 ${delRoom.assetCount}대는 위치 미지정이 됩니다.`} onYes={removeRoom} onNo={() => setDelRoom(null)} />}
        </>
      )}
      {dialog && schoolId && (
        <SpaceDialog dialog={dialog} schoolId={schoolId} floors={floors} onClose={() => setDialog(null)}
          onSaved={(m) => { setDialog(null); toast(m); load(); }} />
      )}
      {sheet}
    </>
  );
}

function FloorBlock({ b, f, rooms, onAddRooms, onEdit, onDelete, onLabel }: {
  b: Building; f: Floor; rooms: Room[]; onAddRooms: () => void; onEdit: (r: Room) => void; onDelete: (r: Room) => void; onLabel: (r: Room) => void;
}) {
  return (
    <div className="sp-f">
      <div className="sp-fh">
        <b>{f.floorName}</b>
        <span className="hint">실 {rooms.length}개 · {f.planUrl ? "도면 있음" : "도면 없음"}</span>
        <Link className="linkbtn" href={`/admin/floorplan?building=${b.buildingId}&floor=${f.floorId}`}>{f.planUrl ? "도면 보기" : "도면 올리기"}</Link>
        <button type="button" className="linkbtn" onClick={onAddRooms}>이 층에 여러 실 추가</button>
      </div>
      {rooms.length > 0 && (
        <div className="tw">
          <table className="cards">
            <thead><tr>{["호실", "이름", "유형", "담당", "자산", "도면", "관리"].map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
            <tbody>
              {rooms.map((r) => (
                <tr key={r.roomId}>
                  <td data-label="호실">{r.roomNo ?? "-"}</td>
                  <td data-label="이름" className="tl">{r.roomName}</td>
                  <td data-label="유형">{r.roomTypeName ?? "-"}</td>
                  <td data-label="담당">{r.ownerName ?? "-"}</td>
                  <td data-label="자산"><Link href={`/admin/assets`}>{r.assetCount}</Link></td>
                  <td data-label="도면">{r.rect ? <b className="st s1">표시</b> : <span className="hint">미표시</span>}</td>
                  <td data-label="관리" style={{ whiteSpace: "nowrap" }}>
                    <button type="button" className="btn sm sec" onClick={() => onEdit(r)}>수정</button>{" "}
                    <button type="button" className="btn sm sec" onClick={() => onLabel(r)}>QR</button>{" "}
                    <button type="button" className="btn sm sec" onClick={() => onDelete(r)}>삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SpaceDialog({ dialog, schoolId, floors, onClose, onSaved }: {
  dialog: Dialog; schoolId: number; floors: (Floor & { building: Building })[]; onClose: () => void; onSaved: (m: string) => void;
}) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const room = dialog.kind === "room" ? dialog.room : undefined;
  const [v, setV] = useState({
    buildingName: "", address: "", floorCount: "3", basementCount: "0", floorNo: "", floorName: "",
    floorId: String(room?.floorId ?? (dialog.kind === "room" || dialog.kind === "bulk" ? dialog.floorId ?? floors[0]?.floorId ?? "" : "")),
    roomNo: room?.roomNo ?? "", roomName: room?.roomName ?? "", roomType: room?.roomType ?? "", ownerName: room?.ownerName ?? "", lines: "",
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });

  const run = async (f: () => Promise<string>) => {
    setBusy(true);
    setMsg("");
    try {
      onSaved(await f());
    } catch (e) {
      setMsg((e as Error).message);
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    switch (dialog.kind) {
      case "building":
        if (!v.buildingName.trim()) return setMsg("건물 이름을 입력해 주세요.");
        return run(async () => {
          await api.post("/api/as/spaces/buildings", { schoolId, buildingName: v.buildingName.trim(), address: v.address.trim() || undefined, floorCount: Number(v.floorCount) || 1, basementCount: Number(v.basementCount) || 0 });
          return "건물을 추가했습니다.";
        });
      case "floor":
        if (!v.floorNo) return setMsg("층 번호를 입력해 주세요. (지하는 -1, -2 …)");
        return run(async () => {
          await api.post(`/api/as/spaces/buildings/${dialog.building.buildingId}/floors`, { floorNo: Number(v.floorNo), floorName: v.floorName.trim() || undefined });
          return "층을 추가했습니다.";
        });
      case "delBuilding":
        return run(async () => {
          await api.del(`/api/as/spaces/buildings/${dialog.building.buildingId}`);
          return "건물을 삭제했습니다.";
        });
      case "room": {
        if (!v.floorId) return setMsg("건물·층을 선택해 주세요.");
        if (!v.roomName.trim()) return setMsg("실 이름을 입력해 주세요.");
        const body = { schoolId, floorId: Number(v.floorId), roomNo: v.roomNo.trim() || null, roomName: v.roomName.trim(), roomType: v.roomType || null, ownerName: v.ownerName.trim() || null };
        return run(async () => {
          if (room) await api.put(`/api/as/spaces/rooms/${room.roomId}`, body);
          else await api.post("/api/as/spaces/rooms", body);
          return room ? "실 정보를 저장했습니다." : "실을 추가했습니다.";
        });
      }
      case "bulk": {
        if (!v.floorId) return setMsg("건물·층을 선택해 주세요.");
        // "101 교장실" or "교장실" per line.
        const items = v.lines.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
          const m = l.match(/^(\S*\d\S*)\s+(.+)$/);
          return m ? { roomNo: m[1], roomName: m[2].trim() } : { roomNo: null, roomName: l };
        });
        if (!items.length) return setMsg("한 줄에 실 하나씩 입력해 주세요.");
        if (items.length > 60) return setMsg("한 번에 60개까지 추가할 수 있습니다.");
        return run(async () => {
          let n = 0;
          for (const it of items) {
            await api.post("/api/as/spaces/rooms", { schoolId, floorId: Number(v.floorId), ...it });
            n++;
          }
          return `실 ${n}개를 추가했습니다.`;
        });
      }
    }
  };

  const floorSelect = (
    <select aria-label="건물·층" value={v.floorId} onChange={set("floorId")}>
      <option value="">-- 건물·층 선택 --</option>
      {floors.map((f) => <option key={f.floorId} value={f.floorId}>{f.building.buildingName} {f.floorName}</option>)}
    </select>
  );
  const title = { building: "건물 추가", floor: "층 추가", room: room ? `실 수정 · ${room.roomName}` : "실 추가", bulk: "여러 실 한 번에 추가", delBuilding: "건물 삭제" }[dialog.kind];

  return (
    <Modal title={title} onClose={onClose}>
      <form className="ft2" noValidate onSubmit={submit}>
        {dialog.kind === "delBuilding" ? (
          <p>{dialog.building.buildingName}과(와) 그 안의 층·실을 삭제합니다. 실에 있던 자산은 위치 미지정이 됩니다. 계속할까요?</p>
        ) : (
          <table className="ftab"><tbody>
            {dialog.kind === "building" && (
              <>
                <FormRow label="건물 이름" required><input aria-label="건물 이름" placeholder="예: 본관" value={v.buildingName} onChange={set("buildingName")} /></FormRow>
                <FormRow label="주소"><input aria-label="주소" placeholder="비우면 학교 주소" style={{ width: "100%" }} value={v.address} onChange={set("address")} /></FormRow>
                <FormRow label="층 수">
                  지상 <input type="number" min={1} max={30} aria-label="지상 층 수" style={{ width: 70 }} value={v.floorCount} onChange={set("floorCount")} /> 층 ·
                  지하 <input type="number" min={0} max={10} aria-label="지하 층 수" style={{ width: 70 }} value={v.basementCount} onChange={set("basementCount")} /> 층
                </FormRow>
              </>
            )}
            {dialog.kind === "floor" && (
              <>
                <FormRow label="층 번호" required><input type="number" aria-label="층 번호" style={{ width: 90 }} value={v.floorNo} onChange={set("floorNo")} /> <small className="hint">지하는 -1, -2 …</small></FormRow>
                <FormRow label="층 이름"><input aria-label="층 이름" placeholder="비우면 ‘4층’처럼 자동" value={v.floorName} onChange={set("floorName")} /></FormRow>
              </>
            )}
            {dialog.kind === "room" && (
              <>
                <FormRow label="건물·층" required>{floorSelect}</FormRow>
                <FormRow label="호실"><input aria-label="호실" placeholder="예: 201호" value={v.roomNo} onChange={set("roomNo")} /></FormRow>
                <FormRow label="실 이름" required><input aria-label="실 이름" placeholder="예: 1학년 1반" value={v.roomName} onChange={set("roomName")} /></FormRow>
                <FormRow label="유형">
                  <select aria-label="유형" value={v.roomType} onChange={set("roomType")}>
                    <option value="">자동 (이름으로 추정)</option>
                    {ROOM_TYPES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                  </select>
                </FormRow>
                <FormRow label="담당"><input aria-label="담당" placeholder="예: 담임 홍길동" value={v.ownerName} onChange={set("ownerName")} /></FormRow>
              </>
            )}
            {dialog.kind === "bulk" && (
              <>
                <FormRow label="건물·층" required>{floorSelect}</FormRow>
                <FormRow label="실 목록" required>
                  <textarea className="ta" aria-label="실 목록" style={{ width: "100%", minHeight: 180 }} placeholder={"한 줄에 실 하나씩\n201호 1학년 1반\n202호 1학년 2반\n교재실"} value={v.lines} onChange={set("lines")} />
                </FormRow>
              </>
            )}
          </tbody></table>
        )}
        <FormMsg kind={msg ? "bad" : undefined} text={msg} />
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <button type="button" className="btn sm sec" onClick={onClose}>취소</button>
          <button type="submit" className="btn sm" disabled={busy}>{busy ? "처리 중…" : dialog.kind === "delBuilding" ? "삭제" : "저장"}</button>
        </div>
      </form>
    </Modal>
  );
}
