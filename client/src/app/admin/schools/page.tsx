"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Confirm, FilterField, FilterForm, ListHead, Tiles } from "@/components/admin/common";
import SubPage from "@/components/SubPage";
import { ErrorBox, FormMsg, FormRow, Icon, Loading, Modal, Pager, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { AS_NAME, useAsTypes } from "@/lib/as";
import { downloadCsv, loadSchools, SCHOOL_TYPES, type Engineer, type SchoolFull, type Vendor } from "@/lib/admin";
import { isRegionAdmin, useAuth } from "@/lib/auth";
import { loadRegions } from "@/lib/boards";
import type { RceptTy, Region } from "@/lib/types";

/** 기관정보관리: schools, their maintenance contract and 담당 업체·기사 per AS type, plus regions. */
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
  const { me } = useAuth();
  const district = isRegionAdmin(me);
  const [regions, setRegions] = useState<Region[]>([]);
  const [all, setAll] = useState<SchoolFull[] | null>(null);
  const [err, setErr] = useState("");
  const empty = { regionId: "", schoolType: "", keyword: "" };
  const [draft, setDraft] = useState(empty);
  const [filter, setFilter] = useState(empty);
  const [contract, setContract] = useState("");
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<SchoolFull | "new" | null>(null);
  const [regionsOpen, setRegionsOpen] = useState(false);

  const load = useCallback(() => {
    setErr("");
    loadRegions().then(setRegions).catch(() => {});
    loadSchools(true).then(setAll).catch((e) => setErr(e.message));
  }, []);
  useEffect(load, [load]);

  const shown = useMemo(() => (all ?? []).filter((s) =>
    (!filter.regionId || String(s.regionId) === filter.regionId) &&
    (!filter.schoolType || s.schoolType === filter.schoolType) &&
    (!filter.keyword.trim() || s.schoolName.includes(filter.keyword.trim()) || (s.schoolCode ?? "").includes(filter.keyword.trim())) &&
    (!contract || s.contractStatus === contract)), [all, filter, contract]);

  if (err) return <ErrorBox message={err} onRetry={load} />;
  if (!all) return <Loading />;
  const size = 10;
  const pages = Math.max(1, Math.ceil(shown.length / size));
  const cur = Math.min(page, pages);
  const vis = shown.slice((cur - 1) * size, cur * size);
  const vendorsOf = (s: SchoolFull) => (s.vendors ?? []).filter((v) => v.vendorName && asTypes.includes(v.rceptTy as RceptTy)).map((v) => `${v.rceptTyName} ${v.vendorName}`).join(", ") || "-";
  const head = ["기관명", "지역", "학교급", "학급 수", "유지관리 계약", "담당업체", "자산", "관리"];

  return (
    <>
      <Tiles
        tiles={[
          { label: "전체 기관", value: all.length, unit: "곳", pick: "" },
          { label: "유지관리 계약 체결", value: all.filter((s) => s.contractStatus === "CONTRACTED").length, unit: "곳", cls: "c1", pick: "CONTRACTED" },
          { label: "미체결", value: all.filter((s) => s.contractStatus !== "CONTRACTED").length, unit: "곳", cls: "c2", pick: "NONE" },
        ]}
        active={contract}
        onPick={(v) => { setContract(v); setPage(1); }}
      />
      <FilterForm onSubmit={() => { setFilter(draft); setPage(1); }} onReset={() => { setDraft(empty); setFilter(empty); setContract(""); }}>
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
        {!district && <button className="btn sm sec" type="button" onClick={() => setRegionsOpen(true)}>지역 관리</button>}
        <button className="btn sm sec" type="button" disabled={!shown.length}
          onClick={() => downloadCsv("기관정보관리", head.slice(0, -1), shown.map((s) => [s.schoolName, s.regionName, s.schoolTypeName, s.classCount, s.contractStatusName, vendorsOf(s), s.assetCount]))}>
          엑셀출력 <Icon name="down" />
        </button>
        <button className="btn sm" type="button" onClick={() => setEdit("new")}>기관 등록</button>
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
                <td data-label="유지관리 계약"><b className={"st " + (s.contractStatus === "CONTRACTED" ? "s1" : "s3")}>{s.contractStatusName}</b></td>
                <td data-label="담당업체" className="tl"><small>{vendorsOf(s)}</small></td>
                <td data-label="자산">{(s.assetCount ?? 0).toLocaleString()}</td>
                <td data-label="관리"><button className="btn sm sec" type="button" onClick={() => setEdit(s)}>수정</button></td>
              </tr>
            )) : <tr><td colSpan={head.length}>조회된 기관이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager page={cur} totalPages={pages} onPage={setPage} />
      {edit && <SchoolForm school={edit === "new" ? null : edit} regions={regions} onClose={() => setEdit(null)} onSaved={(m) => { setEdit(null); toast(m); load(); }} />}
      {regionsOpen && <RegionManager regions={regions} onClose={() => { setRegionsOpen(false); load(); }} />}
    </>
  );
}

// 저장은 네 유형 모두 보낸다 (쓰지 않는 서비스의 담당이 지워지지 않도록). 화면에는 교육청이 쓰는 서비스만.
const TYPES: RceptTy[] = ["C", "M", "S", "T"];

function SchoolForm({ school, regions, onClose, onSaved }: { school: SchoolFull | null; regions: Region[]; onClose: () => void; onSaved: (m: string) => void }) {
  const asTypes = useAsTypes();
  const [v, setV] = useState({
    schoolName: school?.schoolName ?? "", schoolCode: school?.schoolCode ?? "", schoolType: school?.schoolType ?? "ELEM",
    regionId: school?.regionId ? String(school.regionId) : regions.length === 1 ? String(regions[0].regionId) : "", address: school?.address ?? "", tel: school?.tel ?? "",
    classCount: school?.classCount != null ? String(school.classCount) : "", contractStatus: school?.contractStatus ?? "NONE", memo: school?.memo ?? "",
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

  useEffect(() => {
    api.get<Vendor[]>("/api/as/vendors").then(setVendors).catch(() => {});
  }, []);
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
    if (!v.regionId) return setMsg("지역(교육지원청)을 선택해 주세요.");
    setBusy(true);
    setMsg("");
    try {
      const body = { ...v, schoolName: v.schoolName.trim(), regionId: v.regionId ? Number(v.regionId) : null, classCount: v.classCount ? Number(v.classCount) : null };
      const saved = school ? await api.put<SchoolFull>(`/api/as/schools/${school.schoolId}`, body) : await api.post<SchoolFull>("/api/as/schools", body);
      await api.put(`/api/as/schools/${saved.schoolId}/vendors`, TYPES.map((t) => ({
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
          <FormRow label="기관명" required><input aria-label="기관명" value={v.schoolName} onChange={set("schoolName")} /></FormRow>
          <FormRow label="기관코드"><input aria-label="기관코드" value={v.schoolCode} onChange={set("schoolCode")} /></FormRow>
          <FormRow label="학교급 / 지역" required>
            <select aria-label="학교급" value={v.schoolType} onChange={set("schoolType")}>{SCHOOL_TYPES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>{" "}
            <select aria-label="지역" value={v.regionId} onChange={set("regionId")}>
              <option value="">-- 지역 --</option>
              {regions.map((r) => <option key={r.regionId} value={r.regionId}>{r.regionName}</option>)}
            </select>
          </FormRow>
          <FormRow label="주소"><input aria-label="주소" style={{ width: "100%" }} value={v.address} onChange={set("address")} /></FormRow>
          <FormRow label="전화 / 학급 수">
            <input aria-label="전화" value={v.tel} onChange={set("tel")} />{" "}
            <input aria-label="학급 수" type="number" min={0} style={{ width: 90 }} value={v.classCount} onChange={set("classCount")} /> 학급
          </FormRow>
          <FormRow label="유지관리 계약">
            <label style={{ marginRight: 12 }}><input type="radio" name="ct" checked={v.contractStatus === "CONTRACTED"} onChange={() => setV({ ...v, contractStatus: "CONTRACTED" })} /> 체결</label>
            <label><input type="radio" name="ct" checked={v.contractStatus !== "CONTRACTED"} onChange={() => setV({ ...v, contractStatus: "NONE" })} /> 미체결</label>
          </FormRow>
          {asTypes.map((t) => {
            const options = vendors.filter((x) => x.serviceTypes.includes(t));
            const engs = map[t].vendorId ? engineers[map[t].vendorId] ?? [] : [];
            return (
              <FormRow key={t} label={`${AS_NAME[t]} 담당`}>
                <select aria-label={`${AS_NAME[t]} 담당 업체`} value={map[t].vendorId}
                  onChange={(e) => setMap({ ...map, [t]: { vendorId: e.target.value, engineerUserId: "" } })}>
                  <option value="">-- 업체 없음 --</option>
                  {options.map((x) => <option key={x.vendorId} value={x.vendorId}>{x.vendorName} ({x.regionName})</option>)}
                </select>{" "}
                <select aria-label={`${AS_NAME[t]} 담당 기사`} value={map[t].engineerUserId} disabled={!map[t].vendorId}
                  onChange={(e) => setMap({ ...map, [t]: { ...map[t], engineerUserId: e.target.value } })}>
                  <option value="">-- 기사 자동 --</option>
                  {engs.map((x) => <option key={x.userId} value={x.userId}>{x.userName}{x.mobile ? ` (${x.mobile})` : ""}</option>)}
                </select>
              </FormRow>
            );
          })}
          <FormRow label="메모"><textarea className="ta" aria-label="메모" value={v.memo} onChange={set("memo")} /></FormRow>
        </tbody></table>
        <FormMsg kind={msg ? "bad" : undefined} text={msg} />
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          {school && <button type="button" className="btn sm sec" onClick={() => setDel(true)}>삭제</button>}
          <button type="button" className="btn sm sec" onClick={onClose}>취소</button>
          <button type="submit" className="btn sm" disabled={busy}>{busy ? "저장 중…" : "저장"}</button>
        </div>
        {del && <Confirm text={`${school!.schoolName}을(를) 삭제할까요? 연결된 자산·AS 기록이 있으면 삭제되지 않습니다.`} onYes={remove} onNo={() => setDel(false)} busy={busy} />}
      </form>
    </Modal>
  );
}

function RegionManager({ regions: initial, onClose }: { regions: Region[]; onClose: () => void }) {
  const toast = useToast();
  const [regions, setRegions] = useState(initial);
  const [names, setNames] = useState<Record<number, string>>(() => Object.fromEntries(initial.map((r) => [r.regionId, r.regionName])));
  const [add, setAdd] = useState("");
  const [msg, setMsg] = useState("");
  const reload = () => api.get<Region[]>("/api/as/regions").then((r) => { setRegions(r); setNames(Object.fromEntries(r.map((x) => [x.regionId, x.regionName]))); });
  const run = async (f: () => Promise<unknown>, ok: string) => {
    setMsg("");
    try {
      await f();
      toast(ok);
      await reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <Modal title="지역(교육지원청) 관리" onClose={onClose}>
      <div className="tw">
        <table>
          <thead><tr><th scope="col">지역명</th><th scope="col">관리</th></tr></thead>
          <tbody>
            {regions.map((r) => (
              <tr key={r.regionId}>
                <td><input aria-label="지역명" value={names[r.regionId] ?? ""} onChange={(e) => setNames({ ...names, [r.regionId]: e.target.value })} /></td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button type="button" className="btn sm sec" disabled={!names[r.regionId]?.trim() || names[r.regionId] === r.regionName}
                    onClick={() => run(() => api.put(`/api/as/regions/${r.regionId}`, { regionName: names[r.regionId].trim() }), "저장했습니다.")}>저장</button>{" "}
                  <button type="button" className="btn sm sec" onClick={() => confirm(`${r.regionName}을(를) 삭제할까요?`) && run(() => api.del(`/api/as/regions/${r.regionId}`), "삭제했습니다.")}>삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form style={{ display: "flex", gap: 8, marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); if (add.trim()) run(() => api.post("/api/as/regions", { regionName: add.trim() }), "추가했습니다.").then(() => setAdd("")); }}>
        <input aria-label="새 지역명" placeholder="새 지역명 (예: 청주교육지원청)" value={add} onChange={(e) => setAdd(e.target.value)} style={{ flex: 1 }} />
        <button type="submit" className="btn sm">추가</button>
      </form>
      <p className={"msg" + (msg ? " bad" : "")} role="status">{msg}</p>
    </Modal>
  );
}
