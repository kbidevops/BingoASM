"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { isSchoolUser, useAuth } from "@/lib/auth";
import { loadSchools, type Label, type SchoolFull } from "@/lib/admin";
import QrCode from "../QrCode";

/* Building blocks shared by the 통합관리 screens (markup follows the clone's gl() list: tiles · .glf · .glh). */

export interface Tile {
  label: string;
  value: number;
  unit?: string;
  cls?: string;
  /** Filter value this tile applies; undefined = not clickable. "" = clear. */
  pick?: string;
}

export function Tiles({ tiles, active, onPick }: { tiles: Tile[]; active?: string; onPick?: (v: string) => void }) {
  return (
    <div className="mpcards gtiles">
      {tiles.map((t) => (
        <button key={t.label} type="button" className={"mpc " + (t.cls ?? "")} aria-pressed={t.pick !== undefined ? active === t.pick : undefined}
          disabled={t.pick === undefined || !onPick} onClick={() => t.pick !== undefined && onPick?.(t.pick)}>
          <span>{t.label}</span><b>{t.value.toLocaleString()}</b>{t.unit ?? "건"}
        </button>
      ))}
    </div>
  );
}

export function Kpis({ items }: { items: [string, React.ReactNode, string?, React.ReactNode?][] }) {
  return (
    <div className="mpcards kpis">
      {items.map(([l, v, unit, sub]) => (
        <div key={l} className="mpc"><span>{l}</span><b>{v}</b>{unit}{sub && <small className="dlt">{sub}</small>}</div>
      ))}
    </div>
  );
}

/** Filter form: children are <FilterField>s; buttons for 검색 / 초기화. */
export function FilterForm({ onSubmit, onReset, children, submitLabel = "검색" }: { onSubmit: () => void; onReset?: () => void; children: React.ReactNode; submitLabel?: string }) {
  return (
    <form className="glf" role="search" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      {children}
      <div className="glb">
        <button className="btn sm" type="submit">{submitLabel}</button>
        {onReset && <button className="btn sm sec" type="button" onClick={onReset}>초기화</button>}
      </div>
    </form>
  );
}

export function FilterField({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return <label htmlFor={id}><span>{label}</span>{children}</label>;
}

export function ListHead({ total, page, pages, children }: { total: number; page?: number; pages?: number; children?: React.ReactNode }) {
  return (
    <div className="glh">
      <span>전체 <b>{total.toLocaleString()}</b>건{page ? ` · 페이지 ${page}/${Math.max(1, pages ?? 1)}` : ""}</span>
      <span className="glr">{children}</span>
    </div>
  );
}

export function StatusDot({ cls, name }: { cls: string; name: string }) {
  return <b className={"st " + cls}><span className="dot" aria-hidden="true"></span>{name}</b>;
}

/**
 * School the screen works on. School users are fixed to their own school;
 * admins pick from the list (first school by default, or `initial`).
 */
export function useSchoolChoice(initial?: number | null) {
  const { me } = useAuth();
  const fixed = isSchoolUser(me);
  const [schools, setSchools] = useState<SchoolFull[]>([]);
  const [schoolId, setSchoolId] = useState<number | null>(fixed ? me?.schoolId ?? null : initial ?? null);
  const [err, setErr] = useState("");
  useEffect(() => {
    loadSchools().then((s) => {
      setSchools(s);
      setSchoolId((cur) => cur ?? s[0]?.schoolId ?? null);
    }).catch((e) => setErr(e.message));
  }, []);
  return { schools, schoolId, setSchoolId, fixed, err, school: schools.find((s) => s.schoolId === schoolId) };
}

export function SchoolSelect({ schools, value, onChange, fixed, id = "sch-sel" }: {
  schools: SchoolFull[]; value: number | null; onChange: (id: number) => void; fixed: boolean; id?: string;
}) {
  return (
    <label htmlFor={id}>
      <span>기관</span>
      <select id={id} value={value ?? ""} disabled={fixed} onChange={(e) => onChange(Number(e.target.value))}>
        {schools.map((s) => <option key={s.schoolId} value={s.schoolId}>{s.schoolName}</option>)}
      </select>
    </label>
  );
}

/** Small toolbar button (clone's .atool .at). */
export function ToolButton({ icon, label, onClick, href }: { icon: React.ReactNode; label: string; onClick?: () => void; href?: string }) {
  if (href) return <a className="at" href={href}>{icon}<span>{label}</span></a>;
  return <button type="button" className="at" onClick={onClick}>{icon}<span>{label}</span></button>;
}

/** Label sheet (3 columns, A4) — same markup as the clone's labelsHtml. */
export function LabelSheet({ labels }: { labels: Label[] }) {
  return (
    <div className="lsheet">
      {labels.map((l, i) => (
        <div className="lbl" key={l.assetNo + i}>
          <QrCode text={l.qrText} label={l.assetNo + " QR"} margin={1} />
          <div className="lbl-t"><small>충청남도교육청 원클릭AS</small><b>{l.assetNo}</b><span>{l.title}</span><em>{l.sub}</em></div>
        </div>
      ))}
    </div>
  );
}

/**
 * Prints only the given content: renders it into #printsheet and toggles body.plabels,
 * which the clone's print CSS uses to hide everything else.
 */
export function usePrintSheet() {
  const [content, setContent] = useState<React.ReactNode>(null);
  useEffect(() => {
    if (!content) return;
    document.body.classList.add("plabels");
    const t = setTimeout(() => window.print(), 300);
    const after = () => {
      document.body.classList.remove("plabels");
      setContent(null);
    };
    window.addEventListener("afterprint", after, { once: true });
    return () => {
      clearTimeout(t);
      window.removeEventListener("afterprint", after);
      document.body.classList.remove("plabels");
    };
  }, [content]);
  const sheet = content ? createPortal(<div id="printsheet" aria-hidden="true">{content}</div>, document.body) : null;
  return { print: setContent, sheet };
}

export function Confirm({ text, onYes, onNo, busy }: { text: string; onYes: () => void; onNo: () => void; busy?: boolean }) {
  return (
    <div className="card" style={{ padding: 14, marginTop: 12 }}>
      <p style={{ margin: "0 0 10px" }}>{text}</p>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" className="btn sm sec" onClick={onNo}>취소</button>
        <button type="button" className="btn sm" onClick={onYes} disabled={busy}>{busy ? "처리 중…" : "확인"}</button>
      </div>
    </div>
  );
}
