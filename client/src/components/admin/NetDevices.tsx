"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import PlaceField, { type PlaceValue } from "@/components/admin/PlaceField";
import { Confirm, FilterField, FilterForm, LabelSheet, ListHead, StatusDot, Tiles, usePrintSheet } from "@/components/admin/common";
import { ErrorBox, FormMsg, FormRow, Icon, Loading, Modal, Pager, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { badgeClass, DEVICE_STATUSES, DEVICE_TYPES, downloadCsv, fetchAll, loadSchools, SCHOOLNET_DEVICE_TYPES, type Device, type DeviceHistoryRow, type Label, type SchoolFull } from "@/lib/admin";
import { loadRegions } from "@/lib/boards";
import { fmtDate, fmtDateTime } from "@/lib/format";
import type { Region } from "@/lib/types";

const KIND = {
  M: { title: "무선장비관리", api: "/api/as/wireless-devices", types: DEVICE_TYPES, search: "장비번호·장비명·학교명", place: "예: 본관 2층 컴퓨터실" },
  S: { title: "스쿨넷장비관리", api: "/api/as/schoolnet-devices", types: SCHOOLNET_DEVICE_TYPES, search: "장비번호·장비명·학교명·회선번호", place: "예: 본관 1층 통신실" },
} as const;

interface Filter {
  regionId: string;
  deviceType: string;
  keyword: string;
}

/** 무선장비관리(M)·스쿨넷장비관리(S) 공통 화면. 스쿨넷은 장비 유형이 다르고 회선(통신사·회선번호·속도)을 더 적는다. */
export default function NetDevices({ ty }: { ty: "M" | "S" }) {
  const k = KIND[ty];
  const toast = useToast();
  // 메뉴 안의 기능 권한 (역할 권한 관리 · 사용자 메뉴 권한에서 끌 수 있다)
  const { can } = useAuth();
  const F = ty === "M" ? "WDEVICE" : "SDEVICE";
  const canCreate = can(`${F}_CREATE`), canEdit = can(`${F}_EDIT`), canLabel = can(`${F}_LABEL`);
  const [regions, setRegions] = useState<Region[]>([]);
  const empty: Filter = { regionId: "", deviceType: "", keyword: "" };
  const [draft, setDraft] = useState(empty);
  const [filter, setFilter] = useState(empty);
  const [status, setStatus] = useState("");
  const [all, setAll] = useState<Device[] | null>(null);
  const [err, setErr] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [edit, setEdit] = useState<Device | "new" | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const { print, sheet } = usePrintSheet();
  // ?id=123 (장비 정보 화면의 "장비 정보 수정"): 목록을 불러오면 그 장비의 수정 창을 연다.
  const [openId, setOpenId] = useState<number | null>(null);
  // 설치위치를 바꾼 장비: 붙어 있는 라벨의 위치 글자가 예전 것이라 다시 출력을 권한다. ?label=123 (도면에서 실을 바꾼 뒤)도 같다.
  const [relabel, setRelabel] = useState<{ id: number; code: string } | null>(null);
  const [labelId, setLabelId] = useState<number | null>(null);
  // 주소는 화면이 뜬 뒤에 읽는다 (다른 화면의 링크로 넘어올 때 첫 그리기에는 아직 예전 주소일 수 있다).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setOpenId(Number(q.get("id")) || null);
    setLabelId(Number(q.get("label")) || null);
  }, []);

  useEffect(() => {
    loadRegions().then(setRegions).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setErr("");
    fetchAll<Device>(k.api, { ...filter, keyword: filter.keyword.trim() }).then(setAll).catch((e) => setErr(e.message));
  }, [filter]);
  useEffect(load, [load]);

  useEffect(() => {
    if (!openId || !all) return;
    const d = all.find((x) => x.deviceId === openId);
    if (d) setEdit(d);
    setOpenId(null);
  }, [openId, all]);

  useEffect(() => {
    if (!labelId || !all) return;
    const d = all.find((x) => x.deviceId === labelId);
    if (d) setRelabel({ id: d.deviceId, code: d.deviceCode });
    setLabelId(null);
  }, [labelId, all]);

  /** 장비 라벨: 자산 라벨과 같은 A4 3×7. QR은 /d/{장비 id} — 찍으면 장비 정보 화면. */
  const printLabels = async (ids: number[]) => {
    if (!ids.length) return toast("라벨을 출력할 장비를 선택해 주세요.");
    try {
      const rows = await api.post<{ deviceId: number; code: string; qrText: string; title: string; sub: string }[]>("/api/qr/device-labels", { deviceIds: ids });
      if (ids.length > 60) toast("한 번에 60장까지 출력합니다. 앞 60건만 담았습니다.");
      print(<LabelSheet labels={rows.map((r): Label => ({ assetNo: r.code, qrText: r.qrText, title: r.title, sub: r.sub, blank: false }))} />);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const toggle = (id: number, on: boolean) => setSel((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });

  const shown = useMemo(() => (all ?? []).filter((d) => !status || d.status === status), [all, status]);
  if (err) return <ErrorBox message={err} onRetry={load} />;
  if (!all) return <Loading />;

  const pages = Math.max(1, Math.ceil(shown.length / size));
  const cur = Math.min(page, pages);
  const vis = shown.slice((cur - 1) * size, cur * size);
  const count = (s: string) => all.filter((d) => d.status === s).length;

  const head = ["장비번호", "지역", "학교명", "설치위치", "장비유형", "모델", ...(ty === "S" ? ["회선"] : []), "설치일 / 최근 점검", "상태", "관리"];
  const line = (d: Device) => [d.carrier, d.bandwidth].filter(Boolean).join(" · ") || "-";
  return (
    <>
      <Tiles
        tiles={[{ label: "전체 장비", value: all.length, unit: "대", pick: "" }, ...DEVICE_STATUSES.map(([c, n, cls]) => ({ label: n, value: count(c), unit: "대", cls: cls.replace("s", "c"), pick: c }))]}
        active={status}
        onPick={(v) => { setStatus(v); setPage(1); }}
      />
      <FilterForm onSubmit={() => { setFilter(draft); setPage(1); }} onReset={() => { setDraft(empty); setFilter(empty); setStatus(""); setPage(1); }}>
        <FilterField id="dv-reg" label="지역">
          <select id="dv-reg" value={draft.regionId} onChange={(e) => setDraft({ ...draft, regionId: e.target.value })}>
            <option value="">전체</option>
            {regions.map((r) => <option key={r.regionId} value={r.regionId}>{r.regionName}</option>)}
          </select>
        </FilterField>
        <FilterField id="dv-type" label="장비유형">
          <select id="dv-type" value={draft.deviceType} onChange={(e) => setDraft({ ...draft, deviceType: e.target.value })}>
            <option value="">전체</option>
            {k.types.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
        </FilterField>
        <FilterField id="dv-q" label="검색어">
          <input id="dv-q" placeholder={k.search} value={draft.keyword} onChange={(e) => setDraft({ ...draft, keyword: e.target.value })} />
        </FilterField>
      </FilterForm>
      <ListHead total={shown.length} page={cur} pages={pages}>
        <select aria-label="페이지당 건수" value={size} onChange={(e) => { setSize(+e.target.value); setPage(1); }}>
          {[10, 20, 50].map((n) => <option key={n} value={n}>{n}건씩</option>)}
        </select>
        <button className="btn sm sec" type="button" disabled={!shown.length}
          onClick={() => downloadCsv(k.title, ty === "S" ? [...head.slice(0, 6), "통신사", "회선번호", "회선 속도", ...head.slice(7, -1)] : head.slice(0, -1), shown.map((d) => [d.deviceCode, d.regionName, d.schoolName, d.location, d.deviceTypeName, d.modelName,
            ...(ty === "S" ? [d.carrier, d.circuitId, d.bandwidth] : []), `${fmtDate(d.installedAt)} / ${fmtDate(d.lastCheckedAt)}`, d.statusName]))}>
          엑셀출력 <Icon name="down" />
        </button>
        {canLabel && <button className="btn sm sec" type="button" onClick={() => printLabels([...sel])}>QR 라벨 출력{sel.size ? ` (${sel.size})` : ""}</button>}
        {canCreate && <button className="btn sm" type="button" onClick={() => setEdit("new")}>장비 등록</button>}
      </ListHead>
      {relabel && (
        <div className="dv-relabel" role="status">
          <span><b>{relabel.code}</b> 설치위치가 바뀌었습니다. 붙어 있는 라벨에는 예전 위치가 적혀 있습니다. (QR은 그대로 쓸 수 있습니다)</span>
          <span className="dv-relabel-b">
            {canLabel && <button type="button" className="btn sm" onClick={() => printLabels([relabel.id])}>라벨 다시 출력</button>}
            <button type="button" className="btn sm sec" onClick={() => setRelabel(null)}>닫기</button>
          </span>
        </div>
      )}
      <p className="hint" style={{ margin: "0 0 8px" }}>장비에 QR 라벨을 붙이면 휴대폰으로 찍어 어느 학교·건물·층의 장비인지 보고, 학교 담당자는 바로 AS를 신청할 수 있습니다.</p>
      <div className="tw">
        <table className="cards" style={{ minWidth: ty === "S" ? 980 : 900 }}>
          <thead><tr>
            <th scope="col" style={{ width: 40 }}><input type="checkbox" aria-label="이 쪽 장비 모두 선택" checked={vis.length > 0 && vis.every((d) => sel.has(d.deviceId))}
              onChange={(e) => vis.forEach((d) => toggle(d.deviceId, e.target.checked))} /></th>
            {head.map((h) => <th key={h} scope="col">{h}</th>)}
          </tr></thead>
          <tbody>
            {vis.length ? vis.map((d) => (
              <tr key={d.deviceId}>
                <td data-label="선택"><input type="checkbox" aria-label={`${d.deviceCode} 선택`} checked={sel.has(d.deviceId)} onChange={(e) => toggle(d.deviceId, e.target.checked)} /></td>
                <td data-label="장비번호">{d.deviceCode}</td>
                <td data-label="지역">{d.regionName ?? "-"}</td>
                <td data-label="학교명" className="tl">{d.schoolName}</td>
                <td data-label="설치위치">{d.location ?? "-"}</td>
                <td data-label="장비유형">{d.deviceTypeName ?? "-"}</td>
                <td data-label="모델">{d.modelName ?? "-"}</td>
                {ty === "S" && <td data-label="회선">{line(d)}{d.circuitId && <><br /><small className="hint">{d.circuitId}</small></>}</td>}
                <td data-label="설치일 / 최근 점검">{fmtDate(d.installedAt)}<br /><small className="hint">{d.lastCheckedAt ? fmtDate(d.lastCheckedAt) + " 점검" : "점검 기록 없음"}</small></td>
                <td data-label="상태"><StatusDot cls={badgeClass(DEVICE_STATUSES, d.status)} name={d.statusName} /></td>
                <td data-label="관리"><button className="btn sm sec" type="button" onClick={() => setEdit(d)}>{canEdit ? "수정" : "보기"}</button></td>
              </tr>
            )) : <tr><td colSpan={head.length + 1}>조회된 장비가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager page={cur} totalPages={pages} onPage={setPage} />
      {sheet}
      {edit && (
        <DeviceForm ty={ty} device={edit === "new" ? null : edit} onClose={() => setEdit(null)}
          onSaved={(m, moved) => { setEdit(null); toast(m); if (moved) setRelabel(moved); load(); }} />
      )}
    </>
  );
}

function DeviceForm({ ty, device, onClose, onSaved }: {
  ty: "M" | "S"; device: Device | null; onClose: () => void;
  /** moved: 설치위치가 바뀐 장비 (라벨 다시 출력을 권한다) */
  onSaved: (msg: string, moved?: { id: number; code: string }) => void;
}) {
  const k = KIND[ty];
  const router = useRouter();
  const { can } = useAuth();
  const F = ty === "M" ? "WDEVICE" : "SDEVICE";
  // 수정 기능이 꺼져 있으면 보기만 (등록 창은 등록 기능으로 연다)
  const readOnly = device ? !can(`${F}_EDIT`) : !can(`${F}_CREATE`);
  const canDelete = !!device && can(`${F}_DELETE`);
  const [place, setPlace] = useState<PlaceValue | null>(null);
  const [hist, setHist] = useState<DeviceHistoryRow[] | null>(null);
  const [schools, setSchools] = useState<SchoolFull[]>([]);
  const [v, setV] = useState({
    schoolId: device?.schoolId ? String(device.schoolId) : "", deviceCode: device?.deviceCode ?? "", deviceName: device?.deviceName ?? "",
    deviceType: device?.deviceType ?? k.types[0][0], modelName: device?.modelName ?? "", ipAddress: device?.ipAddress ?? "", macAddress: device?.macAddress ?? "",
    location: device?.location ?? "", installedAt: device?.installedAt ?? "", lastCheckedAt: device?.lastCheckedAt ?? "", status: device?.status ?? "NORMAL", note: device?.note ?? "",
    carrier: device?.carrier ?? "", circuitId: device?.circuitId ?? "", bandwidth: device?.bandwidth ?? "",
    vendorId: device?.vendorId ? String(device.vendorId) : "",
  });
  // 유지보수 업체: 이 유형을 맡는 업체 (무선망 AS는 장비의 업체가 맡는다)
  const [vendors, setVendors] = useState<{ vendorId: number; vendorName: string }[]>([]);
  useEffect(() => {
    api.get<{ vendorId: number; vendorName: string }[]>("/api/as/vendors", { rceptTy: ty }).then(setVendors).catch(() => setVendors([]));
  }, [ty]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(false);
  useEffect(() => {
    loadSchools().then(setSchools).catch(() => {});
    if (device) api.get<DeviceHistoryRow[]>(`${k.api}/${device.deviceId}/history`).then(setHist).catch(() => setHist([]));
  }, [device, k.api]);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.schoolId) return setMsg("학교를 선택해 주세요.");
    if (!v.deviceName.trim()) return setMsg("장비명을 입력해 주세요.");
    if (place?.error) return setMsg(place.error);
    setBusy(true);
    const body = { ...v, location: place ? place.location : v.location, ...(place?.unplace ? { unplace: true } : {}),
      schoolId: Number(v.schoolId), deviceCode: v.deviceCode.trim() || undefined, installedAt: v.installedAt || null, lastCheckedAt: v.lastCheckedAt || null,
      // 새 장비에서 업체를 고르지 않으면 보내지 않는다 → 서버가 학교 배정 업체로 채운다
      vendorId: v.vendorId ? Number(v.vendorId) : device ? null : undefined };
    try {
      const saved = device ? await api.put<Device>(`${k.api}/${device.deviceId}`, body) : await api.post<Device>(k.api, body);
      // 다른 층으로 옮기고 "새 층 도면에 바로 놓기"면 그 층 도면을 장비 배치로 연다.
      if (place?.placeAfter) {
        onSaved(`${saved.deviceCode}을(를) 옮겼습니다. 새 층 도면에서 놓을 곳을 누르세요.`);
        router.push(`/admin/floorplan?school=${saved.schoolId}&building=${place.placeAfter.buildingId}&floor=${place.placeAfter.floorId}&device=${saved.deviceId}&place=1`);
        return;
      }
      const moved = device && (device.location ?? "").trim() !== (saved.location ?? "").trim();
      onSaved(device ? (moved ? `설치위치를 ‘${saved.location ?? "-"}’(으)로 바꿨습니다.` : "장비 정보를 저장했습니다.") : "장비를 등록했습니다.",
        moved ? { id: saved.deviceId, code: saved.deviceCode } : undefined);
    } catch (er) {
      setMsg((er as Error).message);
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await api.del(`${k.api}/${device!.deviceId}`);
      onSaved("장비를 삭제했습니다.");
    } catch (er) {
      setMsg((er as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title={device ? `${readOnly ? "장비 정보" : "장비 수정"} · ${device.deviceCode}` : "장비 등록"} wide onClose={onClose}>
      <form className="ft2" noValidate onSubmit={save}>
        <fieldset className="ft-fs" disabled={readOnly}>
        <table className="ftab"><tbody>
          <FormRow label="학교" required>
            <select aria-label="학교" value={v.schoolId} onChange={set("schoolId")}>
              <option value="">-- 선택 --</option>
              {schools.map((s) => <option key={s.schoolId} value={s.schoolId}>{s.schoolName}</option>)}
            </select>
          </FormRow>
          <FormRow label="장비번호"><input aria-label="장비번호" placeholder="비우면 자동 부여" value={v.deviceCode} onChange={set("deviceCode")} /></FormRow>
          <FormRow label="장비명" required><input aria-label="장비명" value={v.deviceName} onChange={set("deviceName")} /></FormRow>
          <FormRow label="장비유형">
            <select aria-label="장비유형" value={v.deviceType} onChange={set("deviceType")}>{k.types.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
          </FormRow>
          <FormRow label="모델"><input aria-label="모델" value={v.modelName} onChange={set("modelName")} /></FormRow>
          <FormRow label="IP / MAC">
            <input aria-label="IP 주소" placeholder="IP 주소" value={v.ipAddress} onChange={set("ipAddress")} />{" "}
            <input aria-label="MAC 주소" placeholder="MAC 주소" value={v.macAddress} onChange={set("macAddress")} />
          </FormRow>
          <FormRow label="설치위치">
            <PlaceField apiBase={k.api} schoolId={v.schoolId} initial={device?.location ?? ""} planFloorId={ty === "M" ? device?.floorId : null} onChange={setPlace} />
          </FormRow>
          {ty === "S" && (
            <FormRow label="회선">
              <input aria-label="통신사" placeholder="예: KT" style={{ width: 120 }} list="snet-carriers" value={v.carrier} onChange={set("carrier")} />{" "}
              <input aria-label="회선번호" placeholder="회선번호" value={v.circuitId} onChange={set("circuitId")} />{" "}
              <input aria-label="회선 속도" placeholder="예: 500Mbps" style={{ width: 120 }} value={v.bandwidth} onChange={set("bandwidth")} />
              <datalist id="snet-carriers">{["KT", "SK브로드밴드", "LG U+"].map((c) => <option key={c} value={c} />)}</datalist>
              <small className="hint" style={{ display: "block", marginTop: 4 }}>통신사 · 회선번호 · 속도. 라우터 등 회선이 들어오는 장비에 적습니다. 장애 신고 때 통신사에 알려 줄 회선번호입니다.</small>
            </FormRow>
          )}
          <FormRow label="유지보수 업체">
            <select aria-label="유지보수 업체" value={v.vendorId} onChange={set("vendorId")}>
              <option value="">{device ? "-- 없음 --" : "-- 학교 배정 업체 (자동) --"}</option>
              {vendors.map((x) => <option key={x.vendorId} value={x.vendorId}>{x.vendorName}</option>)}
            </select>{" "}
            <small className="hint">{ty === "M" ? "이 장비의 무선망 AS를 맡는 업체입니다." : "통신사에 넘길 때 먼저 골라 두는 업체입니다."}</small>
          </FormRow>
          <FormRow label="설치일 / 최근 점검">
            <input type="date" aria-label="설치일" value={v.installedAt} onChange={set("installedAt")} />{" "}
            <input type="date" aria-label="최근 점검일" value={v.lastCheckedAt} onChange={set("lastCheckedAt")} />
          </FormRow>
          <FormRow label="상태">
            {DEVICE_STATUSES.map(([c, n]) => (
              <label key={c} style={{ marginRight: 12 }}><input type="radio" name="dst" checked={v.status === c} onChange={() => setV({ ...v, status: c })} /> {n}</label>
            ))}
          </FormRow>
          <FormRow label="비고"><textarea className="ta" aria-label="비고" value={v.note} onChange={set("note")} /></FormRow>
        </tbody></table>
        </fieldset>
        {device && hist && hist.length > 0 && (
          <details className="dv-hist">
            <summary>위치 변경 기록 <span className="fpv-count">{hist.length}</span></summary>
            <HistoryList rows={hist} />
          </details>
        )}
        <FormMsg kind={msg ? "bad" : undefined} text={msg} />
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          {canDelete && <button type="button" className="btn sm sec" onClick={() => setDel(true)}>삭제</button>}
          <button type="button" className="btn sm sec" onClick={onClose}>{readOnly ? "닫기" : "취소"}</button>
          {!readOnly && <button type="submit" className="btn sm" disabled={busy}>{busy ? "저장 중…" : "저장"}</button>}
        </div>
        {del && <Confirm text={`${device!.deviceCode} 장비를 삭제할까요? 이 장비로 접수된 AS 기록은 그대로 남습니다. 처리 중인 AS(신청완료 · 접수완료)가 있으면 삭제할 수 없습니다.`} onYes={remove} onNo={() => setDel(false)} busy={busy} />}
      </form>
    </Modal>
  );
}

/** 위치 변경 기록: 언제 · 누가 · 어떻게(수정/도면/다른 층) · 어디서 → 어디로. */
export function HistoryList({ rows }: { rows: DeviceHistoryRow[] }) {
  return (
    <ol className="dv-hlist">
      {rows.map((h) => (
        <li key={h.historyId}>
          <small>{fmtDateTime(h.createdAt)} · {h.workerName ?? "-"} · {h.actionName}</small>
          <span>{h.fromPlace ?? "(없음)"} <b aria-label="에서">→</b> <b>{h.toPlace ?? "(없음)"}</b></span>
        </li>
      ))}
    </ol>
  );
}
