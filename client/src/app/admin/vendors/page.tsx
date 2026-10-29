"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Confirm, FilterField, FilterForm, ListHead, Tiles } from "@/components/admin/common";
import SubPage from "@/components/SubPage";
import { ErrorBox, FormMsg, FormRow, Icon, Loading, Modal, Pager, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { AS_NAME, useAsTypes } from "@/lib/as";
import { isAdmin, useAuth } from "@/lib/auth";
import { downloadCsv, type Engineer, type Vendor } from "@/lib/admin";
import { loadRegions } from "@/lib/boards";
import { fmtDate } from "@/lib/format";
import type { Region } from "@/lib/types";

/** 업체관리 (/api/as/vendors): 유지관리 업체, 담당 분야(serviceTypes), 소속 기사. */
export default function VendorsPage() {
  return (
    <SubPage perm="VENDOR_MANAGE">
      <Vendors />
    </SubPage>
  );
}

function Vendors() {
  const TYPES = useAsTypes();
  // 업체 등록·수정·삭제는 도교육청 관리자만 (서버도 막는다). 다른 계정은 조회만.
  const canEdit = isAdmin(useAuth().me);
  const toast = useToast();
  const [regions, setRegions] = useState<Region[]>([]);
  const [all, setAll] = useState<Vendor[] | null>(null);
  const [err, setErr] = useState("");
  const empty = { regionId: "", keyword: "" };
  const [draft, setDraft] = useState(empty);
  const [filter, setFilter] = useState(empty);
  const [ty, setTy] = useState("");
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<Vendor | "new" | null>(null);

  const load = useCallback(() => {
    setErr("");
    loadRegions().then(setRegions).catch(() => {});
    api.get<Vendor[]>("/api/as/vendors").then(setAll).catch((e) => setErr(e.message));
  }, []);
  useEffect(load, [load]);

  const shown = useMemo(() => (all ?? []).filter((v) =>
    (!filter.regionId || String(v.regionId ?? "") === filter.regionId) &&
    (!filter.keyword.trim() || v.vendorName.includes(filter.keyword.trim())) &&
    (!ty || v.serviceTypes.includes(ty))), [all, filter, ty]);

  if (err) return <ErrorBox message={err} onRetry={load} />;
  if (!all) return <Loading />;
  const size = 10;
  const pages = Math.max(1, Math.ceil(shown.length / size));
  const cur = Math.min(page, pages);
  const vis = shown.slice((cur - 1) * size, cur * size);
  const head = ["지역", "업체명", "연락처", "담당 분야", "사업자번호", "기사 수", "최근 수정", "관리"];

  return (
    <>
      <Tiles
        tiles={[{ label: "전체 업체", value: all.length, unit: "곳", pick: "" }, ...TYPES.map((t, i) => ({
          label: AS_NAME[t], value: all.filter((v) => v.serviceTypes.includes(t)).length, unit: "곳", cls: ["c1", "c2", "c3", "c4"][i], pick: t,
        }))]}
        active={ty}
        onPick={(v) => { setTy(v); setPage(1); }}
      />
      <FilterForm onSubmit={() => { setFilter(draft); setPage(1); }} onReset={() => { setDraft(empty); setFilter(empty); setTy(""); }}>
        <FilterField id="vd-reg" label="지역">
          <select id="vd-reg" value={draft.regionId} onChange={(e) => setDraft({ ...draft, regionId: e.target.value })}>
            <option value="">전체</option>
            {regions.map((r) => <option key={r.regionId} value={r.regionId}>{r.regionName}</option>)}
          </select>
        </FilterField>
        <FilterField id="vd-q" label="업체명">
          <input id="vd-q" placeholder="업체명 입력" value={draft.keyword} onChange={(e) => setDraft({ ...draft, keyword: e.target.value })} />
        </FilterField>
      </FilterForm>
      <ListHead total={shown.length} page={cur} pages={pages}>
        <button className="btn sm sec" type="button" disabled={!shown.length}
          onClick={() => downloadCsv("업체관리", head.slice(0, -1), shown.map((v) => [v.regionName, v.vendorName, v.tel, v.serviceTypeNames.join(", "), v.bizNo, v.engineerCount, fmtDate(v.updatedAt)]))}>
          엑셀출력 <Icon name="down" />
        </button>
        {canEdit && <button className="btn sm" type="button" onClick={() => setEdit("new")}>업체 등록</button>}
      </ListHead>
      <div className="tw">
        <table className="cards" style={{ minWidth: 780 }}>
          <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>
            {vis.length ? vis.map((v) => (
              <tr key={v.vendorId}>
                <td data-label="지역">{v.regionName}</td>
                <td data-label="업체명" className="tl">{v.vendorName}</td>
                <td data-label="연락처">{v.tel ? <a href={"tel:" + v.tel}>{v.tel}</a> : "-"}</td>
                <td data-label="담당 분야">{TYPES.filter((t) => v.serviceTypes.includes(t)).map((t) => <span key={t} className="chip" style={{ marginRight: 4 }}>{AS_NAME[t]}</span>)}</td>
                <td data-label="사업자번호">{v.bizNo ?? "-"}</td>
                <td data-label="기사 수">{v.engineerCount}</td>
                <td data-label="최근 수정">{fmtDate(v.updatedAt)}</td>
                <td data-label="관리">{canEdit ? <button className="btn sm sec" type="button" onClick={() => setEdit(v)}>수정</button> : <span className="hint">조회만</span>}</td>
              </tr>
            )) : <tr><td colSpan={head.length}>조회된 업체가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager page={cur} totalPages={pages} onPage={setPage} />
      {edit && <VendorForm vendor={edit === "new" ? null : edit} regions={regions} onClose={() => setEdit(null)} onSaved={(m) => { setEdit(null); toast(m); load(); }} />}
    </>
  );
}

function VendorForm({ vendor, regions, onClose, onSaved }: { vendor: Vendor | null; regions: Region[]; onClose: () => void; onSaved: (m: string) => void }) {
  const TYPES = useAsTypes();
  const [v, setV] = useState({
    vendorName: vendor?.vendorName ?? "", regionId: vendor?.regionId ? String(vendor.regionId) : "", bizNo: vendor?.bizNo ?? "",
    tel: vendor?.tel ?? "", address: vendor?.address ?? "", serviceTypes: vendor?.serviceTypes ?? [] as string[],
  });
  const [engineers, setEngineers] = useState<Engineer[] | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(false);
  const set = (k: "vendorName" | "regionId" | "bizNo" | "tel" | "address") => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });

  useEffect(() => {
    if (vendor) api.get<Engineer[]>(`/api/as/vendors/${vendor.vendorId}/engineers`).then(setEngineers).catch(() => setEngineers([]));
  }, [vendor]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.vendorName.trim()) return setMsg("업체명을 입력해 주세요.");
    if (!v.serviceTypes.length) return setMsg("담당 분야를 하나 이상 선택해 주세요.");
    setBusy(true);
    const body = { ...v, vendorName: v.vendorName.trim(), regionId: v.regionId ? Number(v.regionId) : null, serviceTypes: v.serviceTypes.join(",") };
    try {
      if (vendor) await api.put(`/api/as/vendors/${vendor.vendorId}`, body);
      else await api.post("/api/as/vendors", body);
      onSaved(vendor ? "업체 정보를 저장했습니다." : "업체를 등록했습니다.");
    } catch (er) {
      setMsg((er as Error).message);
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await api.del(`/api/as/vendors/${vendor!.vendorId}`);
      onSaved("업체를 삭제했습니다.");
    } catch (er) {
      setMsg((er as Error).message);
      setBusy(false);
      setDel(false);
    }
  };

  return (
    <Modal title={vendor ? `업체 수정 · ${vendor.vendorName}` : "업체 등록"} wide onClose={onClose}>
      <form className="ft2" noValidate onSubmit={save}>
        <table className="ftab"><tbody>
          <FormRow label="업체명" required><input aria-label="업체명" value={v.vendorName} onChange={set("vendorName")} /></FormRow>
          <FormRow label="지역">
            <select aria-label="지역" value={v.regionId} onChange={set("regionId")}>
              <option value="">전체 (도 단위)</option>
              {regions.map((r) => <option key={r.regionId} value={r.regionId}>{r.regionName}</option>)}
            </select>
          </FormRow>
          <FormRow label="담당 분야" required>
            {TYPES.map((t) => (
              <label key={t} style={{ marginRight: 12 }}>
                <input type="checkbox" checked={v.serviceTypes.includes(t)}
                  onChange={(e) => setV({ ...v, serviceTypes: e.target.checked ? [...v.serviceTypes, t] : v.serviceTypes.filter((x) => x !== t) })} /> {AS_NAME[t]}
              </label>
            ))}
            <small className="hint"> 업체 기사는 담당 분야의 AS 메뉴만 보게 됩니다.</small>
          </FormRow>
          <FormRow label="사업자번호"><input aria-label="사업자번호" placeholder="000-00-00000" value={v.bizNo} onChange={set("bizNo")} /></FormRow>
          <FormRow label="연락처"><input aria-label="연락처" value={v.tel} onChange={set("tel")} /></FormRow>
          <FormRow label="주소"><input aria-label="주소" style={{ width: "100%" }} value={v.address} onChange={set("address")} /></FormRow>
          {vendor && (
            <FormRow label="소속 기사">
              {engineers === null ? "불러오는 중…" : engineers.length ? (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {engineers.map((x) => <li key={x.userId}>{x.userName}{x.positionName ? ` · ${x.positionName}` : ""}{x.mobile ? ` (${x.mobile})` : ""}</li>)}
                </ul>
              ) : <span className="hint">등록된 기사가 없습니다. 기사 계정은 사용자 관리에서 업체를 지정해 만듭니다.</span>}
            </FormRow>
          )}
        </tbody></table>
        <FormMsg kind={msg ? "bad" : undefined} text={msg} />
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          {vendor && <button type="button" className="btn sm sec" onClick={() => setDel(true)}>삭제</button>}
          <button type="button" className="btn sm sec" onClick={onClose}>취소</button>
          <button type="submit" className="btn sm" disabled={busy}>{busy ? "저장 중…" : "저장"}</button>
        </div>
        {del && <Confirm text={`${vendor!.vendorName}을(를) 삭제할까요? 담당 학교·AS가 연결되어 있으면 삭제되지 않습니다.`} onYes={remove} onNo={() => setDel(false)} busy={busy} />}
      </form>
    </Modal>
  );
}
