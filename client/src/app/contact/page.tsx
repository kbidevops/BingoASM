"use client";

import { useEffect, useState } from "react";
import SubPage from "@/components/SubPage";
import { ErrorBox, FormMsg, Icon, Loading, Modal, NoticeBox, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { isAdmin, isRegionAdmin, isSchoolUser, isVendorUser, useAuth } from "@/lib/auth";
import type { ContactGroup, Providers } from "@/lib/types";

/**
 * 문의처 안내 — same three tabs as cbe.go.kr:
 *  도교육청 (region null) · 교육지원청 (정보지원팀 per region) · 유지보수 사업자 (the published per-region list).
 * All three come from GET /api/as/contacts; vendors are the "유지보수 사업자" group, not the system's vendor accounts.
 * Above them, "우리 학교 담당업체" comes from the school's actual assignments (기관정보관리 → 담당업체).
 * 도교육청 관리자 edits any section; 교육지원청 담당자 edits their own district.
 */
export default function ContactPage() {
  return (
    <SubPage perm="PORTAL_CONTACT">
      <Contacts />
    </SubPage>
  );
}

type Tab = "edu" | "region" | "vendor";
const TABS: [Tab, string][] = [["edu", "도교육청"], ["region", "교육지원청"], ["vendor", "유지보수 사업자"]];
/** "청주교육지원청" → "청주" for the pills. */
const short = (name: string) => name.replace(/교육지원청$/, "");
const VENDOR_GROUP = "유지보수 사업자";

function Contacts() {
  const { me, site } = useAuth();
  const [data, setData] = useState<ContactGroup[] | null>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<Tab>("edu");
  const [region, setRegion] = useState("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<ContactGroup | null>(null);

  const load = () => {
    setErr("");
    api.get<ContactGroup[]>("/api/as/contacts").then((d) => {
      setData(d);
      // 처음에는 내 교육지원청(학교·교육지원청 계정), 없으면 첫 교육지원청.
      setRegion((r) => r || d.find((x) => x.regionName !== "도교육청" && x.regionName === me?.regionName)?.regionName
        || d.find((x) => x.regionName !== "도교육청")?.regionName || "");
    }).catch((e) => setErr(e.message));
  };
  useEffect(load, []);

  if (err) return <ErrorBox message={err} onRetry={load} />;
  if (!data) return <Loading />;

  const edu = data.find((x) => x.regionName === "도교육청");
  const districts = data.filter((x) => x.regionName !== "도교육청");
  const query = q.trim();
  const section = tab === "edu" ? edu : districts.find((d) => d.regionName === region);
  const canEdit = (g?: ContactGroup) => !!g && (isAdmin(me) || (isRegionAdmin(me) && g.regionId != null && g.regionId === me?.regionId));

  return (
    <>
      {site?.contactsSample && (
        <NoticeBox style={{ marginBottom: 14 }}>
          <p>■ 아래 문의처는 예시 데이터입니다. 실제 연락처로 교체될 예정이니 전화하기 전에 확인해 주세요.</p>
        </NoticeBox>
      )}
      {!isVendorUser(me) && <MyProviders />}

      <form className="csearch" role="search" onSubmit={(e) => e.preventDefault()}>
        <label htmlFor="cq">담당업무·부서·업체 검색</label>
        <div className="cs-in">
          <Icon name="search" />
          <input id="cq" autoComplete="off" placeholder="예: 원클릭, 스마트기기, 정보보안, 스쿨넷" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <button type="button" aria-label="검색어 지우기" onClick={() => setQ("")}>✕</button>}
        </div>
      </form>

      {query ? <SearchResults query={query} data={data} /> : (
        <>
          <div className="tabs" role="tablist" aria-label="문의처 구분">
            {TABS.map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-controls="cpanel" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
          <div id="cpanel" role="tabpanel">
            {canEdit(section) && (
              <div className="c-edit">
                <button type="button" className="btn sm sec" onClick={() => setEditing(section!)}>
                  {section!.regionName} 문의처 편집
                </button>
              </div>
            )}
            {tab !== "edu" && (
              <div className="pills" role="tablist" aria-label="지역">
                {districts.map((d) => (
                  <button key={d.regionName} type="button" role="tab" aria-selected={region === d.regionName} onClick={() => setRegion(d.regionName)}>{short(d.regionName)}</button>
                ))}
              </div>
            )}
            {tab === "edu" && (edu ? edu.groups.map((g) => <ItemTable key={g.groupName} caption={g.groupName} items={g.items} />) : <p className="empty">등록된 문의처가 없습니다.</p>)}
            {tab === "region" && <DistrictTables group={districts.find((d) => d.regionName === region)} />}
            {tab === "vendor" && <VendorTable items={vendorsOf(districts.find((d) => d.regionName === region))} caption={`${short(region)} 유지보수 사업자`} />}
          </div>
        </>
      )}
      {editing && <SectionEditor section={editing} onClose={() => setEditing(null)} onSaved={(d) => { setData(d); setEditing(null); }} />}
    </>
  );
}

/** 우리 학교 담당업체: 학교 계정은 자기 학교, 교육청·교육지원청은 학교를 골라서. */
function MyProviders() {
  const { me } = useAuth();
  const own = isSchoolUser(me);
  const [schools, setSchools] = useState<{ schoolId: number; schoolName: string }[]>([]);
  const [sid, setSid] = useState("");
  const [p, setP] = useState<Providers | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!own) api.get<{ schoolId: number; schoolName: string }[]>("/api/as/schools").then(setSchools).catch(() => {});
  }, [own]);
  useEffect(() => {
    setErr("");
    if (!own && !sid) return setP(null);
    api.get<Providers>("/api/as/contacts/providers" + (own ? "" : `?schoolId=${sid}`)).then(setP).catch((e) => setErr((e as Error).message));
  }, [own, sid]);

  if (!own && !schools.length) return null;
  return (
    <section className="cprov" aria-labelledby="cprov-t">
      <div className="cprov-h">
        <h3 id="cprov-t">{own ? `우리 학교 담당업체${p ? ` · ${p.schoolName}` : ""}` : "학교별 담당업체"}</h3>
        {!own && (
          <select aria-label="학교 선택" value={sid} onChange={(e) => setSid(e.target.value)}>
            <option value="">-- 학교 선택 --</option>
            {schools.map((s) => <option key={s.schoolId} value={s.schoolId}>{s.schoolName}</option>)}
          </select>
        )}
      </div>
      {err ? <FormMsg kind="bad" text={err} />
        : !p ? <p className="hint">학교를 고르면 서비스별 담당업체와 기사 연락처를 보여 줍니다.</p>
          : (
            <ul className="cprov-l">
              {p.items.map((it) => (
                <li key={it.rceptTy}>
                  <b>{it.rceptTyName}</b>
                  {it.vendorName ? (
                    <span className="cprov-v">
                      <span>{it.vendorName} <Tel tel={it.vendorTel} /></span>
                      {it.engineerName && <span>담당 기사 {it.engineerName} <Tel tel={it.engineerTel} /></span>}
                    </span>
                  ) : <span className="hint">지정된 업체가 없습니다. 교육지원청에 문의해 주세요.</span>}
                </li>
              ))}
            </ul>
          )}
      <small className="hint">기관정보관리에 지정된 담당업체 기준입니다.</small>
    </section>
  );
}

type Row = { groupName: string; itemName: string; tel: string; note: string; duties: string };

/** One section (도교육청 or one 교육지원청) edited as rows; saving replaces just that section. */
function SectionEditor({ section, onClose, onSaved }: { section: ContactGroup; onClose: () => void; onSaved: (d: ContactGroup[]) => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>(() => section.groups.flatMap((g) => g.items.map((it) => ({
    groupName: g.groupName, itemName: it.itemName, tel: it.tel ?? "", note: it.note ?? "", duties: (it.duties ?? []).join("\n"),
  }))));
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const district = section.regionId != null;

  const set = (i: number, k: keyof Row, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    setRows(next);
  };
  const add = (groupName: string) => setRows([...rows, { groupName, itemName: "", tel: "", note: "", duties: "" }]);

  const save = async () => {
    const bad = rows.findIndex((r) => !r.groupName.trim() || !r.itemName.trim());
    if (bad >= 0) return setMsg(`${bad + 1}번째 줄: 부서/구분과 항목 이름을 입력해 주세요.`);
    setBusy(true);
    setMsg("");
    try {
      const d = await api.put<ContactGroup[]>(`/api/as/contacts/sections/${section.regionId ?? "province"}`, rows.map((r) => ({
        groupName: r.groupName.trim(), itemName: r.itemName.trim(), tel: r.tel.trim() || null, note: r.note.trim() || null,
        duties: r.duties.split("\n").map((x) => x.trim()).filter(Boolean),
      })));
      toast(`${section.regionName} 문의처를 저장했습니다.`);
      onSaved(d);
    } catch (e) {
      setMsg((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title={`${section.regionName} 문의처 편집`} wide onClose={onClose}>
      <p className="hint" style={{ marginTop: 0 }}>
        같은 부서/구분 이름끼리 한 표로 묶입니다.{district && <> 업체 목록은 부서/구분을 <b>{VENDOR_GROUP}</b>로 적으면 유지보수 사업자 탭에 나옵니다.</>} 담당업무는 한 줄에 하나씩 적습니다.
      </p>
      <div className="tw c-ed">
        <table>
          <thead><tr><th scope="col">부서/구분</th><th scope="col">항목·직위</th><th scope="col">전화</th><th scope="col">비고</th><th scope="col">담당업무</th><th scope="col"><span className="sr">순서·삭제</span></th></tr></thead>
          <tbody>
            {rows.length ? rows.map((r, i) => (
              <tr key={i}>
                <td><input aria-label={`${i + 1}번째 부서/구분`} value={r.groupName} onChange={(e) => set(i, "groupName", e.target.value)} /></td>
                <td><input aria-label={`${i + 1}번째 항목`} value={r.itemName} onChange={(e) => set(i, "itemName", e.target.value)} /></td>
                <td><input aria-label={`${i + 1}번째 전화`} value={r.tel} onChange={(e) => set(i, "tel", e.target.value)} /></td>
                <td><input aria-label={`${i + 1}번째 비고`} value={r.note} onChange={(e) => set(i, "note", e.target.value)} /></td>
                <td><textarea aria-label={`${i + 1}번째 담당업무`} rows={1} value={r.duties} onChange={(e) => set(i, "duties", e.target.value)} /></td>
                <td className="c-ed-a">
                  <button type="button" className="btn sm sec" aria-label="위로" disabled={i === 0} onClick={() => move(i, -1)}>▲</button>
                  <button type="button" className="btn sm sec" aria-label="아래로" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>▼</button>
                  <button type="button" className="btn sm sec" aria-label="삭제" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
                </td>
              </tr>
            )) : <tr><td colSpan={6}>문의처가 없습니다. 아래에서 줄을 추가하세요.</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn sm sec" onClick={() => add(rows[rows.length - 1]?.groupName ?? (district ? `${section.regionName} 정보지원팀` : ""))}>＋ 줄 추가</button>
        {district && <button type="button" className="btn sm sec" onClick={() => add(VENDOR_GROUP)}>＋ 유지보수 사업자 추가</button>}
      </div>
      <FormMsg kind={msg ? "bad" : undefined} text={msg} />
      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        <button type="button" className="btn sm sec" onClick={onClose}>취소</button>
        <button type="button" className="btn sm" disabled={busy} onClick={save}>{busy ? "저장 중…" : "저장"}</button>
      </div>
    </Modal>
  );
}

function vendorsOf(region?: ContactGroup) {
  return (region?.groups.find((g) => g.groupName === VENDOR_GROUP)?.items ?? []).map((it) => ({ it }));
}

type Item = ContactGroup["groups"][number]["items"][number];
/** Dial the first number only: "043-290-2882, 2883" and "043-290-9781~2" both call the first. */
const Tel = ({ tel }: { tel?: string }) => (tel ? <a href={"tel:" + tel.split(/[,~]/)[0].trim()}>{tel}</a> : <>-</>);

function ItemTable({ caption, items }: { caption: string; items: Item[] }) {
  return (
    <div className="tw">
      <table>
        <caption>{caption}</caption>
        <thead><tr><th scope="col">구분</th><th scope="col">연락처</th><th scope="col">비고</th></tr></thead>
        <tbody>
          {items.map((it, i) => <tr key={i}><td className="tl">{it.itemName}</td><td><Tel tel={it.tel} /></td><td>{it.note ?? ""}</td></tr>)}
        </tbody>
      </table>
    </div>
  );
}

/** "업무<br>- 세부1<br>- 세부2" in the original is stored as "업무 - 세부1 - 세부2"; show the sub-items on their own lines. */
function Duty({ text }: { text: string }) {
  const [head, ...subs] = text.split(" - ");
  return <li>{head}{subs.map((x) => <span key={x}><br />- {x}</span>)}</li>;
}

function DistrictTables({ group }: { group?: ContactGroup }) {
  const groups = group?.groups.filter((g) => g.groupName !== VENDOR_GROUP) ?? [];
  if (!groups.length) return <p className="empty">이 교육지원청의 문의처가 아직 등록되지 않았습니다.</p>;
  return (
    <>
      {groups.map((g) => (
        <div className="tw" key={g.groupName}>
          <table>
            <caption>{g.groupName}</caption>
            <thead><tr><th scope="col">직위/직급</th><th scope="col">전화번호</th><th scope="col">담당업무</th></tr></thead>
            <tbody>
              {g.items.map((it, i) => (
                <tr key={i}>
                  <td>{it.itemName}</td>
                  <td><Tel tel={it.tel} /></td>
                  <td className="tl">{it.duties?.length ? <ul className="dash" style={{ margin: 0 }}>{it.duties.map((d) => <Duty key={d} text={d} />)}</ul> : it.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}

/** `where` (the district) is shown in 비고 for search results, which mix districts. */
function VendorTable({ items, caption }: { items: { where?: string; it: Item }[]; caption: string }) {
  return (
    <div className="tw">
      <table>
        <caption>{caption}</caption>
        <thead><tr><th scope="col">구분</th><th scope="col">연락처</th><th scope="col">비고</th></tr></thead>
        <tbody>
          {items.length ? items.map(({ where, it }, i) => (
            <tr key={i}>
              <td className="tl">{it.itemName}</td>
              <td><Tel tel={it.tel} /></td>
              <td>{where ?? it.note ?? ""}</td>
            </tr>
          )) : <tr><td colSpan={3}>조회결과가 존재하지 않습니다.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function SearchResults({ query, data }: { query: string; data: ContactGroup[] }) {
  const has = (...s: (string | string[] | undefined)[]) => s.some((x) => x && (Array.isArray(x) ? x.join(" ") : x).includes(query));
  const hits = data.flatMap((r) => r.groups.flatMap((g) => g.items
    .filter((it) => has(it.itemName, it.duties, it.note, g.groupName, g.groupName === VENDOR_GROUP ? r.regionName : undefined))
    .map((it) => ({ vendor: g.groupName === VENDOR_GROUP, where: g.groupName === VENDOR_GROUP ? short(r.regionName) : g.groupName, it }))));
  const items = hits.filter((h) => !h.vendor), vs = hits.filter((h) => h.vendor);
  if (!hits.length) return <p className="empty">“{query}”에 해당하는 문의처가 없습니다.</p>;
  return (
    <>
      {items.length > 0 && (
        <div className="tw">
          <table>
            <caption>도교육청 · 교육지원청 ({items.length})</caption>
            <thead><tr><th scope="col">부서</th><th scope="col">구분 / 직위</th><th scope="col">연락처</th><th scope="col">담당업무</th></tr></thead>
            <tbody>
              {items.map(({ where, it }, i) => (
                <tr key={i}>
                  <td className="tl">{where}</td><td>{it.itemName}</td><td><Tel tel={it.tel} /></td>
                  <td className="tl">{(it.duties ?? []).filter((d) => d.includes(query)).join(" · ") || it.note || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {vs.length > 0 && <VendorTable items={vs} caption={`유지보수 사업자 (${vs.length})`} />}
    </>
  );
}
