"use client";

import { useEffect, useState } from "react";
import SubPage from "@/components/SubPage";
import { ErrorBox, Icon, Loading } from "@/components/ui";
import { api } from "@/lib/api";
import type { ContactGroup } from "@/lib/types";

/**
 * 문의처 안내 — same three tabs as cbe.go.kr:
 *  도교육청 (region null) · 교육지원청 (정보지원팀 per region) · 유지보수 사업자 (the published per-region list).
 * All three come from GET /api/as/contacts; vendors are the "유지보수 사업자" group, not the system's vendor accounts.
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
  const [data, setData] = useState<ContactGroup[] | null>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<Tab>("edu");
  const [region, setRegion] = useState("");
  const [q, setQ] = useState("");

  const load = () => {
    setErr("");
    api.get<ContactGroup[]>("/api/as/contacts").then((d) => {
      setData(d);
      setRegion((r) => r || d.find((x) => x.regionName !== "도교육청")?.regionName || "");
    }).catch((e) => setErr(e.message));
  };
  useEffect(load, []);

  if (err) return <ErrorBox message={err} onRetry={load} />;
  if (!data) return <Loading />;

  const edu = data.find((x) => x.regionName === "도교육청");
  const districts = data.filter((x) => x.regionName !== "도교육청");
  const query = q.trim();

  return (
    <>
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
    </>
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
