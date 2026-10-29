"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Confirm, FilterField, FilterForm, ListHead, StatusDot, Tiles } from "@/components/admin/common";
import SubPage from "@/components/SubPage";
import { ErrorBox, FormMsg, FormRow, Icon, Loading, Modal, Pager, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { badgeClass, DEVICE_STATUSES, DEVICE_TYPES, downloadCsv, fetchAll, loadSchools, type Device, type SchoolFull } from "@/lib/admin";
import { loadRegions } from "@/lib/boards";
import { fmtDate } from "@/lib/format";
import type { Region } from "@/lib/types";

/** 무선장비관리 (/api/as/wireless-devices). */
export default function DevicesPage() {
  return (
    <SubPage perm="WDEVICE_MANAGE">
      <Devices />
    </SubPage>
  );
}

interface Filter {
  regionId: string;
  deviceType: string;
  keyword: string;
}

function Devices() {
  const toast = useToast();
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

  useEffect(() => {
    loadRegions().then(setRegions).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setErr("");
    fetchAll<Device>("/api/as/wireless-devices", { ...filter, keyword: filter.keyword.trim() }).then(setAll).catch((e) => setErr(e.message));
  }, [filter]);
  useEffect(load, [load]);

  const shown = useMemo(() => (all ?? []).filter((d) => !status || d.status === status), [all, status]);
  if (err) return <ErrorBox message={err} onRetry={load} />;
  if (!all) return <Loading />;

  const pages = Math.max(1, Math.ceil(shown.length / size));
  const cur = Math.min(page, pages);
  const vis = shown.slice((cur - 1) * size, cur * size);
  const count = (s: string) => all.filter((d) => d.status === s).length;

  const head = ["장비번호", "지역", "학교명", "설치위치", "장비유형", "모델", "설치일 / 최근 점검", "상태", "관리"];
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
            {DEVICE_TYPES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
        </FilterField>
        <FilterField id="dv-q" label="검색어">
          <input id="dv-q" placeholder="장비번호·장비명·학교명" value={draft.keyword} onChange={(e) => setDraft({ ...draft, keyword: e.target.value })} />
        </FilterField>
      </FilterForm>
      <ListHead total={shown.length} page={cur} pages={pages}>
        <select aria-label="페이지당 건수" value={size} onChange={(e) => { setSize(+e.target.value); setPage(1); }}>
          {[10, 20, 50].map((n) => <option key={n} value={n}>{n}건씩</option>)}
        </select>
        <button className="btn sm sec" type="button" disabled={!shown.length}
          onClick={() => downloadCsv("무선장비관리", head.slice(0, -1), shown.map((d) => [d.deviceCode, d.regionName, d.schoolName, d.location, d.deviceTypeName, d.modelName, `${fmtDate(d.installedAt)} / ${fmtDate(d.lastCheckedAt)}`, d.statusName]))}>
          엑셀출력 <Icon name="down" />
        </button>
        <button className="btn sm" type="button" onClick={() => setEdit("new")}>장비 등록</button>
      </ListHead>
      <div className="tw">
        <table className="cards" style={{ minWidth: 900 }}>
          <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>
            {vis.length ? vis.map((d) => (
              <tr key={d.deviceId}>
                <td data-label="장비번호">{d.deviceCode}</td>
                <td data-label="지역">{d.regionName ?? "-"}</td>
                <td data-label="학교명" className="tl">{d.schoolName}</td>
                <td data-label="설치위치">{d.location ?? "-"}</td>
                <td data-label="장비유형">{d.deviceTypeName ?? "-"}</td>
                <td data-label="모델">{d.modelName ?? "-"}</td>
                <td data-label="설치일 / 최근 점검">{fmtDate(d.installedAt)}<br /><small className="hint">{d.lastCheckedAt ? fmtDate(d.lastCheckedAt) + " 점검" : "점검 기록 없음"}</small></td>
                <td data-label="상태"><StatusDot cls={badgeClass(DEVICE_STATUSES, d.status)} name={d.statusName} /></td>
                <td data-label="관리"><button className="btn sm sec" type="button" onClick={() => setEdit(d)}>수정</button></td>
              </tr>
            )) : <tr><td colSpan={head.length}>조회된 장비가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager page={cur} totalPages={pages} onPage={setPage} />
      {edit && (
        <DeviceForm device={edit === "new" ? null : edit} onClose={() => setEdit(null)}
          onSaved={(m) => { setEdit(null); toast(m); load(); }} />
      )}
    </>
  );
}

function DeviceForm({ device, onClose, onSaved }: { device: Device | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const [schools, setSchools] = useState<SchoolFull[]>([]);
  const [v, setV] = useState({
    schoolId: device?.schoolId ? String(device.schoolId) : "", deviceCode: device?.deviceCode ?? "", deviceName: device?.deviceName ?? "",
    deviceType: device?.deviceType ?? "AP", modelName: device?.modelName ?? "", ipAddress: device?.ipAddress ?? "", macAddress: device?.macAddress ?? "",
    location: device?.location ?? "", installedAt: device?.installedAt ?? "", lastCheckedAt: device?.lastCheckedAt ?? "", status: device?.status ?? "NORMAL", note: device?.note ?? "",
  });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(false);
  useEffect(() => {
    loadSchools().then(setSchools).catch(() => {});
  }, []);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.schoolId) return setMsg("학교를 선택해 주세요.");
    if (!v.deviceName.trim()) return setMsg("장비명을 입력해 주세요.");
    setBusy(true);
    const body = { ...v, schoolId: Number(v.schoolId), deviceCode: v.deviceCode.trim() || undefined, installedAt: v.installedAt || null, lastCheckedAt: v.lastCheckedAt || null };
    try {
      if (device) await api.put(`/api/as/wireless-devices/${device.deviceId}`, body);
      else await api.post("/api/as/wireless-devices", body);
      onSaved(device ? "장비 정보를 저장했습니다." : "장비를 등록했습니다.");
    } catch (er) {
      setMsg((er as Error).message);
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await api.del(`/api/as/wireless-devices/${device!.deviceId}`);
      onSaved("장비를 삭제했습니다.");
    } catch (er) {
      setMsg((er as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title={device ? `장비 수정 · ${device.deviceCode}` : "장비 등록"} wide onClose={onClose}>
      <form className="ft2" noValidate onSubmit={save}>
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
            <select aria-label="장비유형" value={v.deviceType} onChange={set("deviceType")}>{DEVICE_TYPES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
          </FormRow>
          <FormRow label="모델"><input aria-label="모델" value={v.modelName} onChange={set("modelName")} /></FormRow>
          <FormRow label="IP / MAC">
            <input aria-label="IP 주소" placeholder="IP 주소" value={v.ipAddress} onChange={set("ipAddress")} />{" "}
            <input aria-label="MAC 주소" placeholder="MAC 주소" value={v.macAddress} onChange={set("macAddress")} />
          </FormRow>
          <FormRow label="설치위치"><input aria-label="설치위치" placeholder="예: 본관 2층 컴퓨터실" value={v.location} onChange={set("location")} /></FormRow>
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
        <FormMsg kind={msg ? "bad" : undefined} text={msg} />
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          {device && <button type="button" className="btn sm sec" onClick={() => setDel(true)}>삭제</button>}
          <button type="button" className="btn sm sec" onClick={onClose}>취소</button>
          <button type="submit" className="btn sm" disabled={busy}>{busy ? "저장 중…" : "저장"}</button>
        </div>
        {del && <Confirm text={`${device!.deviceCode} 장비를 삭제할까요? 이 장비로 접수된 AS 기록은 그대로 남습니다.`} onYes={remove} onNo={() => setDel(false)} busy={busy} />}
      </form>
    </Modal>
  );
}
