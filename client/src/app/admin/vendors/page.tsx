"use client";

import Link from "next/link";
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

/** 기관관리 > 업체 관리 (/api/as/vendors): 유지관리 업체, 담당 지역, 담당 분야(serviceTypes), 소속 기사. 문의처 안내의 유지보수 사업자와는 별개다. */
export default function VendorsPage() {
  return (
    <SubPage perm="VENDOR_MANAGE">
      <Vendors />
    </SubPage>
  );
}

function Vendors() {
  const TYPES = useAsTypes();
  // 업체 등록·수정·삭제: 도교육청은 모든 업체, 교육지원청은 관할 지역만 맡는 업체 (행의 editable, 서버도 막는다). 다른 계정은 조회만.
  // 등록 · 수정 · 삭제는 기능 권한으로 따로 끌 수 있다.
  const { me, can } = useAuth();
  const admin = isAdmin(me);
  /** 교육지원청 담당자: 관할 지역 (등록하는 업체의 담당 지역으로 고정) */
  const district = !admin && me?.roles.includes("REGION_ADMIN") && me.regionId ? { regionId: me.regionId, regionName: me.regionName ?? "" } : null;
  const manager = admin || !!district;
  const canEdit = manager && can("VENDOR_EDIT");
  const canCreate = manager && can("VENDOR_CREATE"), canDelete = manager && can("VENDOR_DELETE");
  const toast = useToast();
  const [regions, setRegions] = useState<Region[]>([]);
  const [all, setAll] = useState<Vendor[] | null>(null);
  const [err, setErr] = useState("");
  const empty = { keyword: "" };
  const [region, setRegion] = useState<number | null>(null);
  const [draft, setDraft] = useState(empty);
  const [filter, setFilter] = useState(empty);
  const [ty, setTy] = useState("");
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<Vendor | "new" | null>(null);
  const [del, setDel] = useState<Vendor | null>(null);

  const load = useCallback(() => {
    setErr("");
    loadRegions().then(setRegions).catch(() => {});
    api.get<Vendor[]>("/api/as/vendors").then(setAll).catch((e) => setErr(e.message));
  }, []);
  useEffect(load, [load]);

  const shown = useMemo(() => (all ?? []).filter((v) =>
    (region == null || covers(v, region)) &&
    (!filter.keyword.trim() || v.vendorName.includes(filter.keyword.trim())) &&
    (!ty || v.serviceTypes.includes(ty))), [all, filter, ty, region]);

  if (err) return <ErrorBox message={err} onRetry={load} />;
  if (!all) return <Loading />;
  const size = 10;
  const pages = Math.max(1, Math.ceil(shown.length / size));
  const cur = Math.min(page, pages);
  const vis = shown.slice((cur - 1) * size, cur * size);
  const head = ["담당 지역", "업체명", "연락처", "담당 분야", "기사 수", "최근 수정", "관리"];

  return (
    <>
      <Tiles
        tiles={[{ label: "전체 업체", value: all.length, unit: "곳", pick: "" }, ...TYPES.map((t, i) => ({
          label: AS_NAME[t], value: all.filter((v) => v.serviceTypes.includes(t)).length, unit: "곳", cls: ["c1", "c2", "c3", "c4"][i], pick: t,
        }))]}
        active={ty}
        onPick={(v) => { setTy(v); setPage(1); }}
      />
      <div className="pills vd-regions" role="group" aria-label="담당 지역">
        <button type="button" aria-pressed={region == null} onClick={() => { setRegion(null); setPage(1); }}>전체 <b>{all.length}</b></button>
        {regions.map((r) => {
          const n = all.filter((v) => covers(v, r.regionId)).length;
          return (
            <button key={r.regionId} type="button" className={n ? "" : "vd-none"} aria-pressed={region === r.regionId}
              title={n ? undefined : "담당 업체가 없는 지역입니다"} onClick={() => { setRegion(r.regionId); setPage(1); }}>
              {r.regionName.replace(/교육지원청$/, "")} <b>{n}</b>{!n && <span className="sr"> 담당 업체 없음</span>}
            </button>
          );
        })}
      </div>
      <FilterForm onSubmit={() => { setFilter(draft); setPage(1); }} onReset={() => { setDraft(empty); setFilter(empty); setTy(""); setRegion(null); }}>
        <FilterField id="vd-q" label="업체명">
          <input id="vd-q" placeholder="업체명 입력" value={draft.keyword} onChange={(e) => setDraft({ ...draft, keyword: e.target.value })} />
        </FilterField>
      </FilterForm>
      <ListHead total={shown.length} page={cur} pages={pages}>
        <button className="btn sm sec" type="button" disabled={!shown.length}
          onClick={() => downloadCsv("업체관리", head.slice(0, -1), shown.map((v) => [v.regionName, v.vendorName, v.tel, TYPES.filter((t) => v.serviceTypes.includes(t)).map((t) => AS_NAME[t]).join(", "), v.engineerCount, fmtDate(v.updatedAt)]))}>
          엑셀출력 <Icon name="down" />
        </button>
        {canCreate && <button className="btn sm" type="button" onClick={() => setEdit("new")}>업체 등록</button>}
      </ListHead>
      <div className="tw">
        <table className="cards" style={{ minWidth: 780 }}>
          <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>
            {vis.length ? vis.map((v) => (
              <tr key={v.vendorId}>
                <td data-label="담당 지역">{regionLabel(v)}</td>
                <td data-label="업체명" className="tl">{v.vendorName}</td>
                <td data-label="연락처">{v.tel ? <a href={"tel:" + v.tel}>{v.tel}</a> : "-"}</td>
                <td data-label="담당 분야">{TYPES.filter((t) => v.serviceTypes.includes(t)).map((t) => <span key={t} className="chip" style={{ marginRight: 4 }}>{AS_NAME[t]}</span>)}{!v.serviceTypes.length && <span className="hint">없음</span>}</td>
                <td data-label="기사 수">{v.engineerCount}</td>
                <td data-label="최근 수정">{fmtDate(v.updatedAt)}</td>
                <td data-label="관리" style={{ whiteSpace: "nowrap" }}>
                  {(canEdit || canDelete) && v.editable ? (
                    <>
                      {canEdit && <button className="btn sm sec" type="button" onClick={() => setEdit(v)}>수정</button>}{" "}
                      {canDelete && <button className="btn sm sec" type="button" onClick={() => setDel(v)}>삭제</button>}
                    </>
                  ) : <span className="hint" title={district && (canEdit || canDelete) ? "여러 지역을 맡는 업체는 도교육청이 관리합니다" : undefined}>
                    {district && (canEdit || canDelete) ? "조회만 · 여러 지역 업체" : "조회만"}</span>}
                </td>
              </tr>
            )) : <tr><td colSpan={head.length}>조회된 업체가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager page={cur} totalPages={pages} onPage={setPage} />
      {district && canCreate && <p className="hint">관할 지역({district.regionName.replace(/교육지원청$/, "")})만 맡는 업체를 등록 · 수정 · 삭제할 수 있습니다. 여러 지역을 맡는 업체는 도교육청이 관리합니다.</p>}
      {edit && <VendorForm vendor={edit === "new" ? null : edit} regions={regions} district={district} onClose={() => setEdit(null)} onSaved={(m) => { setEdit(null); toast(m); load(); }} />}
      {del && <DeleteVendor vendor={del} onClose={() => setDel(null)} onDeleted={(m) => { setDel(null); toast(m); load(); }} />}
    </>
  );
}

interface VendorUsage {
  schools: number;
  users: number;
  /** In-progress AS of services the 교육청 uses: these block the delete. */
  openRequests: number;
  openList?: { asvcSn: number; rceptTyName: string; statusName: string; schoolName?: string; requestAt?: string }[];
  /** In-progress AS of switched-off services: hidden everywhere, so they don't block it. */
  hiddenOpenRequests?: number;
  allRequests: number;
}

/**
 * Shows what deleting a vendor affects. With AS of a service in use still in progress the server refuses,
 * so the blocking requests are listed instead.
 */
function DeleteVendor({ vendor, onClose, onDeleted }: { vendor: Vendor; onClose: () => void; onDeleted: (m: string) => void }) {
  const [usage, setUsage] = useState<VendorUsage | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<NonNullable<typeof usage>>(`/api/as/vendors/${vendor.vendorId}/usage`).then(setUsage).catch((e) => setMsg((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendor.vendorId]);

  const remove = async () => {
    setBusy(true);
    setMsg("");
    try {
      await api.del(`/api/as/vendors/${vendor.vendorId}`);
      onDeleted(`${vendor.vendorName}을(를) 삭제했습니다.`);
    } catch (e) {
      setMsg((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title={`업체 삭제 · ${vendor.vendorName}`} onClose={onClose}>
      {!usage ? (msg ? <FormMsg kind="bad" text={msg} /> : <Loading />) : usage.openRequests > 0 ? (
        <>
          <FormMsg kind="bad" text={`처리 중인 AS가 ${usage.openRequests}건 있어 삭제할 수 없습니다. 아래 건을 처리하거나 장애접수관리에서 다른 업체로 배정해 주세요.`} />
          {usage.openList?.length ? (
            <div className="tw" style={{ marginTop: 8 }}>
              <table className="cards vd-open">
                <thead><tr>{["접수번호", "구분", "학교", "상태", "신청일"].map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
                <tbody>
                  {usage.openList.map((r) => (
                    <tr key={r.asvcSn}>
                      <td data-label="접수번호">AS-{r.asvcSn}</td><td data-label="구분">{r.rceptTyName}</td>
                      <td data-label="학교">{r.schoolName ?? "-"}</td><td data-label="상태">{r.statusName}</td><td data-label="신청일">{fmtDate(r.requestAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {usage.openRequests > (usage.openList?.length ?? 0) && <p className="hint">외 {usage.openRequests - (usage.openList?.length ?? 0)}건</p>}
          <div style={{ textAlign: "center", marginTop: 10 }}>
            <Link className="btn sm sec" href="/admin/requests">장애접수관리로</Link>{" "}
            <button type="button" className="btn sm sec" onClick={onClose}>닫기</button>
          </div>
        </>
      ) : (
        <>
          <ul className="dash" style={{ margin: 0 }}>
            <li>학교 배정 {usage.schools}곳이 해제됩니다. 해당 학교는 새 업체를 지정할 때까지 그 분야의 AS를 신청할 수 없습니다.</li>
            <li>소속 계정 {usage.users}개가 사용 중지됩니다.</li>
            <li>지난 AS 기록 {usage.allRequests}건은 그대로 남습니다.</li>
            {!!usage.hiddenOpenRequests && <li>사용하지 않는 AS 서비스의 처리 중 신청 {usage.hiddenOpenRequests}건은 목록에 보이지 않는 채로 남습니다. 서비스를 다시 켜면 다른 업체로 배정할 수 있습니다.</li>}
            <li>문의처 안내의 유지보수 사업자는 바뀌지 않습니다.</li>
          </ul>
          {msg && <FormMsg kind="bad" text={msg} />}
          <Confirm text={`${vendor.vendorName}을(를) 삭제할까요? 되돌리는 기능은 없습니다.`} busy={busy} onYes={remove} onNo={onClose} />
        </>
      )}
    </Modal>
  );
}

const covers = (v: Vendor, regionId: number) => v.allRegions || v.regions.some((r) => r.regionId === regionId);
const regionLabel = (v: Vendor) => v.allRegions ? "전체" : v.regions.length ? v.regions.map((r) => r.regionName.replace(/교육지원청$/, "")).join(", ") : "미지정";

function VendorForm({ vendor, regions, district, onClose, onSaved }: {
  vendor: Vendor | null; regions: Region[];
  /** 교육지원청 담당자: 담당 지역은 관할 지역으로 고정 */
  district: { regionId: number; regionName: string } | null;
  onClose: () => void; onSaved: (m: string) => void;
}) {
  const TYPES = useAsTypes();
  const [v, setV] = useState({
    vendorName: vendor?.vendorName ?? "",
    tel: vendor?.tel ?? "", address: vendor?.address ?? "", serviceTypes: vendor?.serviceTypes ?? [] as string[],
    allRegions: district ? false : vendor?.allRegions ?? false,
  });
  const [picked, setPicked] = useState<number[]>(() => district ? [district.regionId] : (vendor?.regions ?? []).map((r) => r.regionId));
  const [engineers, setEngineers] = useState<Engineer[] | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: "vendorName" | "tel" | "address") => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  const toggleRegion = (id: number, on: boolean) => setPicked((p) => (on ? [...p, id] : p.filter((x) => x !== id)));

  useEffect(() => {
    if (vendor) api.get<Engineer[]>(`/api/as/vendors/${vendor.vendorId}/engineers`).then(setEngineers).catch(() => setEngineers([]));
  }, [vendor]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.vendorName.trim()) return setMsg("업체명을 입력해 주세요.");
    if (!v.allRegions && !picked.length) return setMsg("담당 지역을 하나 이상 선택해 주세요.");
    if (!v.serviceTypes.length) return setMsg("담당 분야를 하나 이상 선택해 주세요.");
    setBusy(true);
    const body = {
      ...v, vendorName: v.vendorName.trim(), serviceTypes: v.serviceTypes.join(","),
      regions: v.allRegions ? [] : picked.map((regionId) => ({ regionId })),
    };
    try {
      if (vendor) await api.put(`/api/as/vendors/${vendor.vendorId}`, body);
      else await api.post("/api/as/vendors", body);
      onSaved(vendor ? "업체 정보를 저장했습니다." : "업체를 등록했습니다.");
    } catch (er) {
      setMsg((er as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title={vendor ? `업체 수정 · ${vendor.vendorName}` : "업체 등록"} wide onClose={onClose}>
      <form className="ft2" noValidate onSubmit={save}>
        <table className="ftab"><tbody>
          <FormRow label="업체명" required><input aria-label="업체명" value={v.vendorName} onChange={set("vendorName")} /></FormRow>
          <FormRow label="담당 지역" required>
            {district ? <span>{district.regionName} <small className="hint">· 관할 지역으로 정해집니다</small></span> : <>
            <label className="vd-all">
              <input type="checkbox" checked={v.allRegions} onChange={(e) => setV({ ...v, allRegions: e.target.checked })} /> 전체 지역
            </label>
            {!v.allRegions && (
              <div className="vd-pick">
                {regions.map((r) => (
                  <label key={r.regionId}>
                    <input type="checkbox" checked={picked.includes(r.regionId)} onChange={(e) => toggleRegion(r.regionId, e.target.checked)} /> {r.regionName.replace(/교육지원청$/, "")}
                  </label>
                ))}
              </div>
            )}
            </>}
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
          <button type="button" className="btn sm sec" onClick={onClose}>취소</button>
          <button type="submit" className="btn sm" disabled={busy}>{busy ? "저장 중…" : "저장"}</button>
        </div>
      </form>
    </Modal>
  );
}
