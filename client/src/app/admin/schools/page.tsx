"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Confirm, FilterField, FilterForm, ListHead } from "@/components/admin/common";
import SubPage from "@/components/SubPage";
import { ErrorBox, FormMsg, FormRow, Icon, Loading, Modal, Pager, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { AS_NAME, useAsTypes } from "@/lib/as";
import { downloadCsv, loadSchools, SCHOOL_TYPES, type Engineer, type SchoolFull, type Vendor } from "@/lib/admin";
import { isAdmin, isRegionAdmin, isSchoolAdmin, isVendorUser, useAuth } from "@/lib/auth";
import { loadRegions } from "@/lib/boards";
import type { RceptTy, Region } from "@/lib/types";

/** 기관관리 > 학교 관리: schools and their 담당 업체·기사 per AS type, plus regions. */
export default function SchoolsPage() {
  return (
    <SubPage perm="SCHOOL_MANAGE">
      <Schools />
    </SubPage>
  );
}

function Schools() {
  const asTypes = useAsTypes();
  const toast = useToast();
  const { me, can } = useAuth();
  const district = isRegionAdmin(me);
  // 등록·삭제·지역·담당업체는 도교육청·교육지원청만. 학교는 자기 학교 기본정보만, 업체는 조회만 (서버도 막는다).
  const manage = isSchoolAdmin(me);
  const readOnly = isVendorUser(me);
  const [regions, setRegions] = useState<Region[]>([]);
  const [all, setAll] = useState<SchoolFull[] | null>(null);
  const [err, setErr] = useState("");
  const empty = { regionId: "", schoolType: "", keyword: "" };
  const [draft, setDraft] = useState(empty);
  const [filter, setFilter] = useState(empty);
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<SchoolFull | "new" | null>(null);

  const load = useCallback(() => {
    setErr("");
    loadRegions().then(setRegions).catch(() => {});
    loadSchools(true).then(setAll).catch((e) => setErr(e.message));
  }, []);
  useEffect(load, [load]);

  const shown = useMemo(() => (all ?? []).filter((s) =>
    (!filter.regionId || String(s.regionId) === filter.regionId) &&
    (!filter.schoolType || s.schoolType === filter.schoolType) &&
    (!filter.keyword.trim() || s.schoolName.includes(filter.keyword.trim()) || (s.schoolCode ?? "").includes(filter.keyword.trim()))), [all, filter]);

  if (err) return <ErrorBox message={err} onRetry={load} />;
  if (!all) return <Loading />;
  const size = 10;
  const pages = Math.max(1, Math.ceil(shown.length / size));
  const cur = Math.min(page, pages);
  const vis = shown.slice((cur - 1) * size, cur * size);
  const vendorsOf = (s: SchoolFull) => (s.vendors ?? []).filter((v) => v.vendorName && asTypes.includes(v.rceptTy as RceptTy)).map((v) => `${v.rceptTyName} ${v.vendorName}`).join(", ") || "-";
  const head = ["기관명", "지역", "학교급", "학급 수", "담당업체", "자산", "관리"];

  return (
    <>
      <FilterForm onSubmit={() => { setFilter(draft); setPage(1); }} onReset={() => { setDraft(empty); setFilter(empty); }}>
        <FilterField id="sc-reg" label="지역">
          <select id="sc-reg" value={draft.regionId} onChange={(e) => setDraft({ ...draft, regionId: e.target.value })}>
            <option value="">전체</option>
            {regions.map((r) => <option key={r.regionId} value={r.regionId}>{r.regionName}</option>)}
          </select>
        </FilterField>
        <FilterField id="sc-type" label="학교급">
          <select id="sc-type" value={draft.schoolType} onChange={(e) => setDraft({ ...draft, schoolType: e.target.value })}>
            <option value="">전체</option>
            {SCHOOL_TYPES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
        </FilterField>
        <FilterField id="sc-q" label="기관명">
          <input id="sc-q" placeholder="기관명 또는 기관코드" value={draft.keyword} onChange={(e) => setDraft({ ...draft, keyword: e.target.value })} />
        </FilterField>
      </FilterForm>
      <ListHead total={shown.length} page={cur} pages={pages}>
        {isAdmin(me) && <Link className="btn sm sec" href="/admin/regions">지역 관리</Link>}
        <button className="btn sm sec" type="button" disabled={!shown.length}
          onClick={() => downloadCsv("학교관리", head.slice(0, -1), shown.map((s) => [s.schoolName, s.regionName, s.schoolTypeName, s.classCount, vendorsOf(s), s.assetCount]))}>
          엑셀출력 <Icon name="down" />
        </button>
        {manage && can("SCHOOL_CREATE") && <button className="btn sm" type="button" onClick={() => setEdit("new")}>기관 등록</button>}
      </ListHead>
      <div className="tw">
        <table className="cards" style={{ minWidth: 780 }}>
          <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>
            {vis.length ? vis.map((s) => (
              <tr key={s.schoolId}>
                <td data-label="기관명" className="tl">{s.schoolName}{s.schoolCode && <small className="hint"> ({s.schoolCode})</small>}</td>
                <td data-label="지역">{s.regionName ?? "-"}</td>
                <td data-label="학교급">{s.schoolTypeName ?? "-"}</td>
                <td data-label="학급 수">{s.classCount ?? "-"}</td>
                <td data-label="담당업체" className="tl"><small>{vendorsOf(s)}</small></td>
                <td data-label="자산">{(s.assetCount ?? 0).toLocaleString()}</td>
                <td data-label="관리">{readOnly || !(can("SCHOOL_EDIT") || (manage && can("SCHOOL_VENDOR"))) ? <span className="hint">조회만</span> : <button className="btn sm sec" type="button" onClick={() => setEdit(s)}>수정</button>}</td>
              </tr>
            )) : <tr><td colSpan={head.length}>조회된 기관이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager page={cur} totalPages={pages} onPage={setPage} />
      {edit && <SchoolForm school={edit === "new" ? null : edit} regions={regions} manage={manage} onClose={() => setEdit(null)} onSaved={(m) => { setEdit(null); toast(m); load(); }} />}
    </>
  );
}

// 저장은 네 유형 모두 보낸다 (쓰지 않는 서비스의 담당이 지워지지 않도록). 화면에는 교육청이 쓰는 서비스만.
const TYPES: RceptTy[] = ["C", "M", "S", "T"];

/** manage = 도교육청·교육지원청. 아니면(학교 담당자) 기본정보만 고칠 수 있고 지역·담당업체는 보기만. */
function SchoolForm({ school, regions, manage, onClose, onSaved }: { school: SchoolFull | null; regions: Region[]; manage: boolean; onClose: () => void; onSaved: (m: string) => void }) {
  const asTypes = useAsTypes();
  // 기능 권한: 기본정보(등록 · 수정) · 담당업체 지정 · 삭제를 따로 끌 수 있다.
  const { can } = useAuth();
  const infoEdit = school ? can("SCHOOL_EDIT") : can("SCHOOL_CREATE");
  const vendorEdit = manage && can("SCHOOL_VENDOR");
  const canDel = !!school && manage && can("SCHOOL_DELETE");
  const [v, setV] = useState({
    schoolName: school?.schoolName ?? "", schoolCode: school?.schoolCode ?? "", schoolType: school?.schoolType ?? "ELEM",
    regionId: school?.regionId ? String(school.regionId) : regions.length === 1 ? String(regions[0].regionId) : "", address: school?.address ?? "", tel: school?.tel ?? "",
    classCount: school?.classCount != null ? String(school.classCount) : "", memo: school?.memo ?? "",
  });
  // 담당 업체·기사 per AS type.
  const [map, setMap] = useState<Record<string, { vendorId: string; engineerUserId: string }>>(() =>
    Object.fromEntries(TYPES.map((t) => {
      const sv = school?.vendors?.find((x) => x.rceptTy === t);
      return [t, { vendorId: sv?.vendorId ? String(sv.vendorId) : "", engineerUserId: sv?.engineerUserId ? String(sv.engineerUserId) : "" }];
    })));
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [engineers, setEngineers] = useState<Record<string, Engineer[]>>({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });

  /** Vendors that can serve this type in the region: 담당 분야 matches and the vendor covers the region or 전체. */
  const candidates = (list: Vendor[], t: RceptTy, regionId: string) => !regionId ? [] : list.filter((x) =>
    x.serviceTypes.includes(t) && (x.allRegions || x.regions.some((r) => String(r.regionId) === regionId)));
  /** Keeps a choice that still fits the region; otherwise picks the only candidate, or nothing when there are several. */
  const autoPick = (prev: typeof map, list: Vendor[], regionId: string) => {
    const next = { ...prev };
    for (const t of asTypes) {
      const c = candidates(list, t, regionId);
      if (c.some((x) => String(x.vendorId) === prev[t].vendorId)) continue;
      next[t] = { vendorId: c.length === 1 ? String(c[0].vendorId) : "", engineerUserId: "" };
    }
    return next;
  };

  useEffect(() => {
    api.get<Vendor[]>("/api/as/vendors").then((list) => {
      setVendors(list);
      // An existing school keeps its assignments until someone changes its region.
      if (!school && manage) setMap((m) => autoPick(m, list, v.regionId));
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const changeRegion = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setV({ ...v, regionId: e.target.value });
    setMap(autoPick(map, vendors, e.target.value));
  };
  const vendorIds = Object.values(map).map((m) => m.vendorId).filter(Boolean).join(",");
  useEffect(() => {
    for (const id of new Set(vendorIds.split(",").filter(Boolean))) {
      if (engineers[id]) continue;
      api.get<Engineer[]>(`/api/as/vendors/${id}/engineers`).then((list) => setEngineers((e) => ({ ...e, [id]: list }))).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorIds]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.schoolName.trim()) return setMsg("기관명을 입력해 주세요.");
    if (!v.regionId) return setMsg("지역을 선택해 주세요.");
    setBusy(true);
    setMsg("");
    try {
      const body = { ...v, schoolName: v.schoolName.trim(), regionId: v.regionId ? Number(v.regionId) : null, classCount: v.classCount ? Number(v.classCount) : null };
      const saved = !infoEdit ? school! : school ? await api.put<SchoolFull>(`/api/as/schools/${school.schoolId}`, body) : await api.post<SchoolFull>("/api/as/schools", body);
      if (vendorEdit) await api.put(`/api/as/schools/${saved.schoolId}/vendors`, TYPES.map((t) => ({
        rceptTy: t, vendorId: map[t].vendorId ? Number(map[t].vendorId) : null, engineerUserId: map[t].engineerUserId ? Number(map[t].engineerUserId) : null,
      })));
      onSaved(school ? "기관 정보를 저장했습니다." : "기관을 등록했습니다.");
    } catch (er) {
      setMsg((er as Error).message);
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await api.del(`/api/as/schools/${school!.schoolId}`);
      onSaved("기관을 삭제했습니다.");
    } catch (er) {
      setMsg((er as Error).message);
      setBusy(false);
      setDel(false);
    }
  };

  return (
    <Modal title={school ? `기관 수정 · ${school.schoolName}` : "기관 등록"} wide onClose={onClose}>
      <form className="ft2" noValidate onSubmit={save}>
        <table className="ftab"><tbody>
          <FormRow label="기관명" required><input aria-label="기관명" disabled={!infoEdit} value={v.schoolName} onChange={set("schoolName")} /></FormRow>
          <FormRow label="기관코드"><input aria-label="기관코드" disabled={!infoEdit} value={v.schoolCode} onChange={set("schoolCode")} /></FormRow>
          <FormRow label="학교급 / 지역" required>
            <select aria-label="학교급" disabled={!infoEdit} value={v.schoolType} onChange={set("schoolType")}>{SCHOOL_TYPES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>{" "}
            <select aria-label="지역" value={v.regionId} onChange={changeRegion} disabled={!manage || !infoEdit}>
              <option value="">-- 지역 --</option>
              {regions.map((r) => <option key={r.regionId} value={r.regionId}>{r.regionName}</option>)}
            </select>
            {!manage && <small className="hint"> 지역·담당업체는 교육청·교육지원청에서 지정합니다.</small>}
          </FormRow>
          <FormRow label="주소"><input aria-label="주소" style={{ width: "100%" }} disabled={!infoEdit} value={v.address} onChange={set("address")} /></FormRow>
          <FormRow label="전화 / 학급 수">
            <input aria-label="전화" disabled={!infoEdit} value={v.tel} onChange={set("tel")} />{" "}
            <input aria-label="학급 수" type="number" min={0} style={{ width: 90 }} disabled={!infoEdit} value={v.classCount} onChange={set("classCount")} /> 학급
          </FormRow>
          {asTypes.map((t) => {
            const options = candidates(vendors, t, v.regionId);
            // An assignment made before regions applied stays visible until someone changes it.
            const outside = vendors.find((x) => String(x.vendorId) === map[t].vendorId && !options.includes(x));
            const engs = map[t].vendorId ? engineers[map[t].vendorId] ?? [] : [];
            return (
              <FormRow key={t} label={`${AS_NAME[t]} 담당`}>
                <select aria-label={`${AS_NAME[t]} 담당 업체`} value={map[t].vendorId} disabled={!vendorEdit}
                  onChange={(e) => setMap({ ...map, [t]: { vendorId: e.target.value, engineerUserId: "" } })}>
                  <option value="">-- 업체 없음 --</option>
                  {outside && <option value={outside.vendorId}>{outside.vendorName} (다른 지역)</option>}
                  {options.map((x) => <option key={x.vendorId} value={x.vendorId}>{x.vendorName}</option>)}
                </select>{" "}
                <select aria-label={`${AS_NAME[t]} 담당 기사`} value={map[t].engineerUserId} disabled={!vendorEdit || !map[t].vendorId}
                  onChange={(e) => setMap({ ...map, [t]: { ...map[t], engineerUserId: e.target.value } })}>
                  <option value="">-- 기사 자동 --</option>
                  {engs.map((x) => <option key={x.userId} value={x.userId}>{x.userName}{x.mobile ? ` (${x.mobile})` : ""}</option>)}
                </select>
                {vendorEdit && !map[t].vendorId && (
                  <small className="hint sv-hint">
                    {!v.regionId ? "지역을 고르면 담당 업체가 정해집니다." : options.length ? "이 지역의 담당 업체가 여러 곳입니다. 선택해 주세요." : "이 지역에 담당 업체가 없습니다. 업체 관리에서 지정해 주세요."}
                  </small>
                )}
              </FormRow>
            );
          })}
          <FormRow label="메모"><textarea className="ta" aria-label="메모" disabled={!infoEdit} value={v.memo} onChange={set("memo")} /></FormRow>
        </tbody></table>
        <FormMsg kind={msg ? "bad" : undefined} text={msg} />
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          {canDel && <button type="button" className="btn sm sec" onClick={() => setDel(true)}>삭제</button>}
          <button type="button" className="btn sm sec" onClick={onClose}>취소</button>
          {(infoEdit || vendorEdit) && <button type="submit" className="btn sm" disabled={busy}>{busy ? "저장 중…" : "저장"}</button>}
        </div>
        {del && <Confirm text={`${school!.schoolName}을(를) 삭제할까요? 연결된 자산·AS 기록이 있으면 삭제되지 않습니다.`} onYes={remove} onNo={() => setDel(false)} busy={busy} />}
      </form>
    </Modal>
  );
}
