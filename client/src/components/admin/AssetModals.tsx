"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ASSET_STATUSES, badgeClass, label, protectedImage, type Asset, type Category, type Room, type SchoolFull } from "@/lib/admin";
import { useAuth } from "@/lib/auth";
import { fmtDate, fmtDateTime, won } from "@/lib/format";
import { ErrorBox, FormMsg, FormRow, Loading, Modal } from "../ui";
import { Confirm, StatusDot } from "./common";

interface History { historyId: number; actionType: string; content?: string; workerName?: string; createdAt: string }

/** 자산 상세: 정보 · 위치 · QR · 이력 (라벨 QR을 찍었을 때 열리는 화면). */
export function AssetDetailModal({ assetId, rooms, schoolName, onClose, onEdit, onPrint }: {
  assetId: number; rooms: Room[]; schoolName: (id?: number) => string; onClose: () => void; onEdit: (a: Asset) => void; onPrint: (id: number) => void;
}) {
  const { can } = useAuth();
  const [a, setA] = useState<Asset | null>(null);
  const [hist, setHist] = useState<History[]>([]);
  const [qr, setQr] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => {
    api.get<Asset>(`/api/assets/${assetId}`).then((x) => {
      setA(x);
      protectedImage(`/api/qr/asset/${encodeURIComponent(x.assetNo)}.png?size=220`).then(setQr).catch(() => {});
    }).catch((e) => setErr(e.message));
    api.get<History[]>(`/api/assets/${assetId}/histories`).then(setHist).catch(() => {});
  }, [assetId]);
  useEffect(() => () => { if (qr) URL.revokeObjectURL(qr); }, [qr]);

  const room = a?.roomId ? rooms.find((r) => r.roomId === a.roomId) : undefined;
  const r = (k: string, v: React.ReactNode, k2?: string, v2?: React.ReactNode) => (
    <tr><th scope="row">{k}</th><td>{v}</td>{k2 ? <><th scope="row">{k2}</th><td>{v2}</td></> : <td colSpan={2}></td>}</tr>
  );
  return (
    <Modal title="자산 상세" wide onClose={onClose}>
      {err ? <ErrorBox message={err} /> : !a ? <Loading /> : (
        <>
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 420px", minWidth: 0 }}>
              <table className="ftab rpt"><tbody>
                {r("자산번호", <b>{a.assetNo}</b>, "상태", <StatusDot cls={badgeClass(ASSET_STATUSES, a.status)} name={label(ASSET_STATUSES, a.status)} />)}
                {r("기관", schoolName(a.schoolId), "분류", a.categoryName ?? "-")}
                <tr><th scope="row">품명·규격</th><td colSpan={3} className="tl">{a.assetName}{a.spec ? ` · ${a.spec}` : ""}</td></tr>
                {r("제조사 / 모델", `${a.manufacturer ?? "-"} / ${a.modelName ?? "-"}`, "시리얼", a.serialNo ?? "-")}
                {r("취득일", fmtDate(a.acquiredAt), "취득가", won(a.acquirePrice))}
                {r("내용연수", a.lifeYears ? `${a.lifeYears}년${a.lifeExceeded ? " (경과 — 불용 검토)" : ""}` : "-", "진행 중 AS", `${a.openServiceCount ?? 0}건`)}
                <tr><th scope="row">위치</th><td colSpan={3} className="tl">
                  {room ? room.fullName : [a.buildingName, a.floorName, a.locationDetail].filter(Boolean).join(" ") || "위치 미지정"}{" "}
                  {a.roomId && <a className="linkbtn" href={`/admin/floorplan?room=${a.roomId}`}>도면에서 보기</a>}
                </td></tr>
                {a.note && <tr><th scope="row">비고</th><td colSpan={3} className="tl" style={{ whiteSpace: "pre-wrap" }}>{a.note}</td></tr>}
              </tbody></table>
            </div>
            <div style={{ textAlign: "center", width: 160 }}>
              {qr ? <img src={qr} alt={`${a.assetNo} QR`} width={150} height={150} style={{ background: "#fff", borderRadius: 6 }} /> : <div style={{ width: 150, height: 150 }} />}
              <p className="hint" style={{ margin: "4px 0 0" }}>{a.assetNo}</p>
            </div>
          </div>
          {hist.length > 0 && (
            <details style={{ marginTop: 12 }} open>
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>자산 이력 ({hist.length})</summary>
              <div className="tw" style={{ marginTop: 8 }}>
                <table>
                  <thead><tr><th scope="col">일시</th><th scope="col">내용</th><th scope="col">처리자</th></tr></thead>
                  <tbody>{hist.map((h) => <tr key={h.historyId}><td>{fmtDateTime(h.createdAt)}</td><td className="tl">{h.content ?? h.actionType}</td><td>{h.workerName ?? "-"}</td></tr>)}</tbody>
                </table>
              </div>
            </details>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 14 }}>
            {can("ASSET_WRITE") && <button type="button" className="btn sm sec" onClick={() => onEdit(a)}>수정</button>}
            <button type="button" className="btn sm bl" onClick={() => onPrint(a.assetId)}>라벨 출력</button>
            <button type="button" className="btn sm dk" onClick={onClose}>닫기</button>
          </div>
        </>
      )}
    </Modal>
  );
}

/** 자산 등록·수정. A reserved label number can be passed in `asset.assetNo` to register under it. */
export function AssetForm({ asset, schools, fixedSchool, categories, onClose, onSaved }: {
  asset: Partial<Asset>; schools: SchoolFull[]; fixedSchool: boolean; categories: Category[]; onClose: () => void; onSaved: (m: string) => void;
}) {
  const { can } = useAuth();
  const editing = !!asset.assetId;
  const [v, setV] = useState({
    schoolId: asset.schoolId ? String(asset.schoolId) : "", assetNo: asset.assetNo ?? "", categoryId: asset.categoryId ? String(asset.categoryId) : "",
    assetName: asset.assetName ?? "", manufacturer: asset.manufacturer ?? "", modelName: asset.modelName ?? "", serialNo: asset.serialNo ?? "",
    acquiredAt: asset.acquiredAt ?? "", acquirePrice: asset.acquirePrice != null ? String(asset.acquirePrice) : "", lifeYears: asset.lifeYears ? String(asset.lifeYears) : "",
    status: asset.status ?? "INUSE", roomId: asset.roomId ? String(asset.roomId) : "", note: asset.note ?? "",
  });
  const [rooms, setRooms] = useState<Room[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });

  useEffect(() => {
    if (!v.schoolId) return setRooms([]);
    api.get<Room[]>("/api/as/spaces/rooms", { schoolId: v.schoolId }).then(setRooms).catch(() => setRooms([]));
  }, [v.schoolId]);

  const cat = categories.find((c) => String(c.categoryId) === v.categoryId);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.schoolId) return setMsg("기관을 선택해 주세요.");
    if (!v.categoryId) return setMsg("분류를 선택해 주세요.");
    if (!v.assetName.trim()) return setMsg("품명·규격을 입력해 주세요.");
    if (v.acquiredAt && v.acquiredAt > new Date().toISOString().slice(0, 10)) return setMsg("취득일은 오늘 이후일 수 없습니다.");
    setBusy(true);
    setMsg("");
    const room = rooms.find((r) => String(r.roomId) === v.roomId);
    const body: Record<string, unknown> = {
      schoolId: Number(v.schoolId), categoryId: Number(v.categoryId), assetName: v.assetName.trim(), manufacturer: v.manufacturer.trim() || null,
      modelName: v.modelName.trim() || null, serialNo: v.serialNo.trim() || null, acquiredAt: v.acquiredAt || null,
      acquirePrice: v.acquirePrice ? Number(v.acquirePrice) : null, lifeYears: v.lifeYears ? Number(v.lifeYears) : null, status: v.status,
      roomId: room?.roomId ?? null, buildingId: room?.buildingId ?? null, floorId: room?.floorId ?? null, locationDetail: room?.roomName ?? null, note: v.note.trim() || null,
    };
    try {
      if (editing) await api.put(`/api/assets/${asset.assetId}`, body);
      else await api.post("/api/assets", { ...body, assetType: "HW", assetNo: v.assetNo.trim().toUpperCase() || undefined });
      onSaved(editing ? "자산 정보를 저장했습니다." : "자산을 등록했습니다.");
    } catch (er) {
      setMsg((er as Error).message);
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await api.del(`/api/assets/${asset.assetId}`);
      onSaved("자산을 삭제했습니다.");
    } catch (er) {
      setMsg((er as Error).message);
      setBusy(false);
      setDel(false);
    }
  };

  return (
    <Modal title={editing ? `자산 수정 · ${asset.assetNo}` : "자산 등록"} wide onClose={onClose}>
      <form className="ft2" noValidate onSubmit={save}>
        <table className="ftab"><tbody>
          <FormRow label="자산번호">
            {editing ? <b>{asset.assetNo}</b> : (
              <><input aria-label="자산번호" placeholder="비우면 자동 부여" value={v.assetNo} onChange={set("assetNo")} />{" "}
                <small className="hint">{asset.assetNo ? "미등록 라벨 번호로 등록합니다." : "미등록 라벨을 붙였다면 그 번호를 입력하세요."}</small></>
            )}
          </FormRow>
          <FormRow label="기관" required>
            <select aria-label="기관" value={v.schoolId} disabled={fixedSchool} onChange={(e) => setV({ ...v, schoolId: e.target.value, roomId: "" })}>
              <option value="">-- 선택 --</option>
              {schools.map((s) => <option key={s.schoolId} value={s.schoolId}>{s.schoolName}</option>)}
            </select>
          </FormRow>
          <FormRow label="분류" required>
            <select aria-label="분류" value={v.categoryId} onChange={(e) => setV({ ...v, categoryId: e.target.value })}>
              <option value="">-- 선택 --</option>
              {categories.filter((c) => c.assetType === "HW").map((c) => <option key={c.categoryId} value={c.categoryId}>{c.categoryName}</option>)}
            </select>
          </FormRow>
          <FormRow label="품명·규격" required><input aria-label="품명·규격" style={{ width: "100%" }} maxLength={60} placeholder="예: 업무용 PC (i5/16GB/SSD 512GB)" value={v.assetName} onChange={set("assetName")} /></FormRow>
          <FormRow label="제조사 / 모델">
            <input aria-label="제조사" placeholder="제조사" value={v.manufacturer} onChange={set("manufacturer")} />{" "}
            <input aria-label="모델" placeholder="모델" value={v.modelName} onChange={set("modelName")} />
          </FormRow>
          <FormRow label="시리얼"><input aria-label="시리얼" value={v.serialNo} onChange={set("serialNo")} /></FormRow>
          <FormRow label="취득일 / 취득가">
            <input type="date" aria-label="취득일" value={v.acquiredAt} onChange={set("acquiredAt")} />{" "}
            <input type="number" min={0} aria-label="취득가" placeholder="취득가(원)" value={v.acquirePrice} onChange={set("acquirePrice")} />
          </FormRow>
          <FormRow label="내용연수">
            <input type="number" min={1} max={15} aria-label="내용연수" style={{ width: 80 }} value={v.lifeYears} onChange={set("lifeYears")} /> 년{" "}
            <small className="hint">비우면 분류 기본값{cat?.lifeYears ? ` (${cat.lifeYears}년)` : ""}</small>
          </FormRow>
          <FormRow label="위치(실)">
            <select aria-label="위치(실)" value={v.roomId} onChange={set("roomId")} disabled={!v.schoolId}>
              <option value="">{rooms.length ? "-- 위치 미지정 --" : "등록된 실이 없습니다 (공간(실) 관리에서 추가)"}</option>
              {rooms.map((r) => <option key={r.roomId} value={r.roomId}>{r.fullName}</option>)}
            </select>
          </FormRow>
          <FormRow label="상태">
            {ASSET_STATUSES.map(([c, n]) => (
              <label key={c} style={{ marginRight: 12 }}><input type="radio" name="ast" checked={v.status === c} onChange={() => setV({ ...v, status: c })} /> {n}</label>
            ))}
          </FormRow>
          <FormRow label="비고"><textarea className="ta" aria-label="비고" value={v.note} onChange={set("note")} /></FormRow>
        </tbody></table>
        <FormMsg kind={msg ? "bad" : undefined} text={msg} />
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          {editing && can("ASSET_DELETE") && <button type="button" className="btn sm sec" onClick={() => setDel(true)}>삭제</button>}
          <button type="button" className="btn sm sec" onClick={onClose}>취소</button>
          <button type="submit" className="btn sm" disabled={busy}>{busy ? "저장 중…" : "저장"}</button>
        </div>
        {del && <Confirm text={`${asset.assetNo}을(를) 삭제할까요?`} onYes={remove} onNo={() => setDel(false)} busy={busy} />}
      </form>
    </Modal>
  );
}
