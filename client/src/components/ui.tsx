"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { AsStatus } from "@/lib/types";

/* ---------- icons (same strokes as the clone's ICO set) ---------- */

const PATHS = {
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  home: <><path d="M3 11 12 3l9 8" /><path d="M5 10v10h14V10" /></>,
  theme: <><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" /></>,
  star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z" />,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  notice: <><path d="M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1z" /><path d="M17 9a4 4 0 0 1 0 6" /></>,
  down: <><path d="M12 4v11" /><path d="m7 10 5 5 5-5" /><path d="M5 20h14" /></>,
  arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
  school: <><path d="M3 21h18" /><path d="M5 21V10l7-5 7 5v11" /><path d="M10 21v-5h4v5" /><path d="M9 11h.01M15 11h.01" /></>,
  inbox: <><path d="M4 13h4l2 3h4l2-3h4" /><path d="M5 5h14l1 8v6H4v-6z" /></>,
  report: <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /><path d="M10 17v-3M13 17v-5M16 17v-2" /></>,
  pen: <><path d="m4 20 4-1 11-11-3-3L5 16z" /><path d="m14 7 3 3" /></>,
  share: <><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4" /></>,
  print: <><path d="M7 8V3h10v5" /><rect x="3" y="8" width="18" height="9" rx="1.5" /><path d="M7 14h10v7H7z" /></>,
  qr: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" /></>,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="i" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

const QUICK = {
  pc: <><rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M8 20h8M12 16v4" /></>,
  wifi: <><path d="M2 9a15 15 0 0 1 20 0" /><path d="M5.5 12.5a10 10 0 0 1 13 0" /><path d="M9 16a5 5 0 0 1 6 0" /><circle cx="12" cy="19" r="1" fill="currentColor" /></>,
  net: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
  box: <><path d="M3 7l9-4 9 4v10l-9 4-9-4z" /><path d="M3 7l9 4 9-4M12 11v10" /></>,
  tab: <><rect x="5" y="2" width="14" height="20" rx="2" /><path d="M11 18h2" /></>,
  chat: <><path d="M4 5h16v11H9l-5 4z" /><path d="M8 9h8M8 12h5" /></>,
  qr: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" /></>,
  list: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="m3.5 6 1.5 1.5L7.5 5M3.5 12l1.5 1.5L7.5 11M3.5 18l1.5 1.5L7.5 17" /></>,
} as const;

export function QuickIcon({ name }: { name: keyof typeof QUICK }) {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {QUICK[name]}
    </svg>
  );
}

export function UserIcon() {
  return (
    <svg viewBox="0 0 48 48" width="44" height="44" fill="none" stroke="currentColor" strokeWidth={2.4}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="24" cy="16" r="8" /><path d="M8 42c1.5-8.5 8-13 16-13s14.5 4.5 16 13" /><path d="M33 33l3 3 6-6" />
    </svg>
  );
}

/* ---------- toast ---------- */

const ToastContext = createContext<(msg: string) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState("");
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((m: string) => {
    setMsg(m);
    setOn(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOn(false), 2600);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className={"toast" + (on ? " on" : "")} role="status">{msg}</div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/* ---------- modal ---------- */

export function Modal({ title, wide, onClose, children }: { title: string; wide?: boolean; onClose: () => void; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  // Callers usually pass an inline arrow, so onClose changes on every parent render. Keep it in a ref and run the
  // open/close effect once: re-running it would move focus back to the first control and close an open <select>.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const last = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    box.current?.querySelector<HTMLElement>("input,select,textarea,button:not(.md-x)")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
      if (e.key !== "Tab" || !box.current) return;
      // Keep focus inside the dialog.
      const fs = [...box.current.querySelectorAll<HTMLElement>("button:not([disabled]),input,select,textarea,a[href]")].filter((x) => x.offsetParent !== null);
      if (!fs.length) return;
      const [a, z] = [fs[0], fs[fs.length - 1]];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      last?.focus?.();
    };
  }, []);
  return (
    <div className="md">
      <div className="md-bg" onClick={() => close.current()} />
      <div ref={box} className={"md-box" + (wide ? " wide" : "")} role="dialog" aria-modal="true" aria-labelledby="md-t">
        <div className="md-h">
          <h4 id="md-t">{title}</h4>
          <button type="button" className="md-x" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <div className="md-c">{children}</div>
      </div>
    </div>
  );
}

/* ---------- small pieces ---------- */

const ST_CLASS: Record<AsStatus, string> = { A: "s2", R: "s3", C: "s1", X: "s4" };

export function AsBadge({ status, name }: { status: AsStatus; name: string }) {
  return <b className={"st " + ST_CLASS[status]}>{name}</b>;
}

export function PostBadge({ status, name }: { status?: string; name?: string }) {
  if (!status) return <>-</>;
  return <b className={"st " + (status === "DONE" ? "s1" : status === "RECEIVED" ? "s2" : "s3")}>{name}</b>;
}

/** Pagination in blocks of 10, like the clone. */
export function Pager({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  if (totalPages < 1) return null;
  const a = Math.floor((page - 1) / 10) * 10 + 1;
  const e = Math.min(a + 9, totalPages);
  const nums = [];
  for (let k = a; k <= e; k++) nums.push(k);
  return (
    <div className="pg">
      <button type="button" disabled={a === 1} aria-label="이전 10페이지" onClick={() => onPage(Math.max(1, a - 10))}>«</button>
      {nums.map((k) => (
        <button key={k} type="button" className={k === page ? "on" : ""} aria-current={k === page ? "page" : undefined} onClick={() => onPage(k)}>{k}</button>
      ))}
      <button type="button" disabled={e >= totalPages} aria-label="다음 10페이지" onClick={() => onPage(e + 1)}>»</button>
    </div>
  );
}

export function NoticeBox({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div className="nbox" style={style}>{children}</div>;
}

/** A row of the clone's `.ftab` form table. `error` shows under the field like the clone's validator. */
export function FormRow({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <tr>
      <th scope="row">{required && <i>*</i>}{label}</th>
      <td>
        {children}
        {error && <p className="err" role="alert">{error}</p>}
      </td>
    </tr>
  );
}

export function FormMsg({ kind, text }: { kind?: "ok" | "bad"; text: string }) {
  return (
    <p className={"msg" + (kind ? " " + kind : "")} role="status" style={{ textAlign: "center", fontSize: ".875rem", color: "var(--muted)" }}>{text}</p>
  );
}

export function SubmitBar({ label, busy, children }: { label: string; busy?: boolean; children?: React.ReactNode }) {
  return (
    <div style={{ textAlign: "center", display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
      <button className="btn dk sm" type="submit" disabled={busy} style={{ padding: "0 44px", minHeight: 42 }}>{busy ? "처리 중…" : label}</button>
      {children}
    </div>
  );
}

export function Loading({ text = "불러오는 중입니다…" }: { text?: string }) {
  return <p className="empty" role="status" style={{ padding: "30px 0" }}>{text}</p>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="empty" role="alert" style={{ padding: "30px 0" }}>
      <p style={{ margin: "0 0 10px", color: "var(--err)" }}>{message}</p>
      {onRetry && <button type="button" className="btn sm sec" onClick={onRetry}>다시 시도</button>}
    </div>
  );
}

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));
const MINUTES = ["00", "10", "20", "30", "40", "50"];

/** Date + hour + minute pickers, as on cbe.go.kr. Value is "YYYY-MM-DDTHH:mm". */
export function DateTimeInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const [d, t = "09:00"] = value.split("T");
  const [h, m] = t.split(":");
  return (
    <>
      <input type="date" aria-label={label + " 날짜"} value={d} onChange={(e) => onChange(`${e.target.value}T${h}:${m}`)} />{" "}
      <select aria-label="시" value={h} onChange={(e) => onChange(`${d}T${e.target.value}:${m}`)}>
        {HOURS.map((x) => <option key={x}>{x}</option>)}
      </select>{" : "}
      <select aria-label="분" value={m} onChange={(e) => onChange(`${d}T${h}:${e.target.value}`)}>
        {MINUTES.map((x) => <option key={x}>{x}</option>)}
      </select>
    </>
  );
}

/** Phone number in three boxes. Value is "010-1234-5678". */
export function TelInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const p = value.split("-");
  const set = (i: number, v: string) => {
    const n = [p[0] || "010", p[1] ?? "", p[2] ?? ""];
    n[i] = v.replace(/\D/g, "");
    onChange(n.join("-"));
  };
  return (
    <>
      <select aria-label="앞자리" value={p[0] || "010"} onChange={(e) => set(0, e.target.value)}>
        {["010", "011", "016", "017", "019", "041"].map((x) => <option key={x}>{x}</option>)}
      </select>{" - "}
      <input size={5} aria-label="가운데" inputMode="numeric" maxLength={4} value={p[1] ?? ""} onChange={(e) => set(1, e.target.value)} />{" - "}
      <input size={5} aria-label="끝자리" inputMode="numeric" maxLength={4} value={p[2] ?? ""} onChange={(e) => set(2, e.target.value)} />
    </>
  );
}

export function telValid(v: string) {
  return /^\d{2,3}-\d{3,4}-\d{4}$/.test(v);
}

/** File picker with the clone's drop zone look. */
export function FilePicker({ files, onChange, max = 2 }: { files: File[]; onChange: (f: File[]) => void; max?: number }) {
  const input = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState("");
  // Copy the bytes right away: once the input is cleared (so the same file can be picked again) the browser may
  // refuse to read the original File at upload time (net::ERR_ACCESS_DENIED), and the file could change on disk.
  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    const picked = Array.from(list);
    try {
      const copies = await Promise.all(picked.map(async (f) => new File([await f.arrayBuffer()], f.name, { type: f.type, lastModified: f.lastModified })));
      setErr("");
      onChange([...files, ...copies].slice(0, max));
    } catch {
      setErr("파일을 읽지 못했습니다. 다시 선택해 주세요.");
    }
  };
  return (
    <div className="drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files); }}>
      파일을 여기에 끌어 놓거나 [파일선택]을 누르세요. (최대 {max}개){" "}
      <button className="btn sm dk" type="button" onClick={() => input.current?.click()}>파일선택</button>
      <input ref={input} type="file" multiple hidden onChange={(e) => { const el = e.target; add(el.files).finally(() => { el.value = ""; }); }} />
      {err && <p className="err" role="alert">{err}</p>}
      {files.length > 0 && (
        <ul style={{ margin: "8px 0 0", paddingLeft: 18, textAlign: "left" }}>
          {files.map((f, i) => (
            <li key={i}>
              {f.name}{" "}
              <button type="button" className="linkbtn" onClick={() => onChange(files.filter((_, j) => j !== i))}>삭제</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
