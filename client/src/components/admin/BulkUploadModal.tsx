"use client";

import { useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { downloadCsv } from "@/lib/admin";
import { Modal } from "../ui";

interface Validation {
  head: string[];
  total: number;
  ok: number;
  error: number;
  rows: { rowNo: number; cells: string[]; errors: string[]; ok: boolean; warning?: string | null }[];
}
interface Committed {
  created: number;
  skipped: number;
  items: { rowNo: number; id: number; name: string; sub?: string }[];
}

const STEPS = ["양식 받기·작성", "파일 올리기", "확인", "등록 완료"];

/**
 * 엑셀 일괄 등록 (학교 · 무선망 장비 · 스쿨넷 장비): {api}/bulk/template → validate(행별 오류 · 경고) → commit.
 * 검사 규칙은 서버의 한 곳(각 등록 화면과 같은 코드)에 있다. 오류 행이 있으면 그 행을 빼고 등록할 수 있다.
 */
export default function BulkUploadModal({ title, api: base, noun, unit, notes, onClose, onDone }: {
  /** 창 제목 (예: "학교 엑셀 일괄 등록") */
  title: string;
  /** 예: "/api/as/schools" → /bulk/template · /bulk/validate · /bulk/commit */
  api: string;
  /** 결과 문구의 이름 (예: "기관", "장비") */
  noun: string;
  /** 세는 단위 (예: "곳", "대") */
  unit: string;
  notes: ReactNode;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [res, setRes] = useState<Validation | null>(null);
  const [errOnly, setErrOnly] = useState(false);
  const [done, setDone] = useState<Committed | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const pick = async (f?: File) => {
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) return setMsg("엑셀(.xlsx) 파일만 올릴 수 있습니다.");
    if (f.size > 5 * 1024 * 1024) return setMsg("5MB 이하 파일만 올릴 수 있습니다.");
    setMsg("");
    setBusy(true);
    // 검사한 그대로 등록하도록 파일 내용을 붙잡아 둔다 (그 사이 파일을 고쳐도 검사한 내용으로).
    const copy = new File([await f.arrayBuffer()], f.name, { type: f.type });
    const form = new FormData();
    form.append("file", copy);
    try {
      setRes(await api.upload<Validation>(`${base}/bulk/validate`, form));
      setFile(copy);
      setErrOnly(false);
      setStep(3);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!file || !res) return;
    setBusy(true);
    setMsg("");
    const form = new FormData();
    form.append("file", file);
    form.append("skipErrors", String(res.error > 0));
    try {
      const r = await api.upload<Committed>(`${base}/bulk/commit`, form);
      setDone(r);
      setStep(4);
      onDone(`${noun} ${r.created}${unit}을(를) 등록했습니다.`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const badCount = res ? res.rows.filter((r) => !r.ok || r.warning).length : 0;
  const warnCount = res ? res.rows.filter((r) => r.ok && r.warning).length : 0;
  const allBad = !!res && badCount === res.rows.length;
  const rows = res ? res.rows.filter((r) => !errOnly || allBad || !r.ok || r.warning) : [];
  const saveErrors = () => {
    if (!res) return;
    downloadCsv(`${title}_오류_${new Date().toISOString().slice(0, 10)}`, ["행", "결과", ...res.head],
      res.rows.filter((r) => !r.ok || r.warning).map((r) => [r.rowNo, [...r.errors, r.warning ?? ""].filter(Boolean).join(" / "), ...r.cells]));
  };

  return (
    <Modal title={title} wide onClose={onClose}>
      <ol className="bk-steps">
        {STEPS.map((t, i) => (
          <li key={t} className={i + 1 < step ? "done" : i + 1 === step ? "on" : ""} aria-current={i + 1 === step ? "step" : undefined}>{t}</li>
        ))}
      </ol>

      {step <= 2 && (
        <>
          <div className="nbox">{notes}</div>
          <p>
            <button type="button" className="btn sm" disabled={busy}
              onClick={() => { setBusy(true); api.download(`${base}/bulk/template`, undefined, `${title}_양식.xlsx`).then(() => setStep(2)).catch((e) => setMsg(e.message)).finally(() => setBusy(false)); }}>
              양식 내려받기 (.xlsx)
            </button>{" "}
            <button type="button" className="linkbtn" onClick={() => setStep(2)}>이미 양식이 있어요</button>
          </p>
          {step === 2 && (
            <label className="bk-drop" tabIndex={0} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}>
              <b>{busy ? "검사 중…" : "작성한 엑셀 파일을 끌어 놓거나 눌러서 고르세요"}</b>
              <span>.xlsx · 5MB 이하</span>
              <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
          )}
        </>
      )}

      {step === 3 && res && (
        <>
          <div className="mpcards kpis">
            <div className="mpc"><span>전체</span><b>{res.total}</b>행</div>
            <div className="mpc c1"><span>등록 가능</span><b>{res.ok}</b>행</div>
            {warnCount > 0 && <div className="mpc c2"><span>그중 경고</span><b>{warnCount}</b>행</div>}
            <div className="mpc c4"><span>오류</span><b>{res.error}</b>행</div>
          </div>
          <p style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <span className="hint">{file?.name}</span>
            <span style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              {badCount === 0 ? (
                <span className="hint">오류·경고 행이 없습니다.</span>
              ) : allBad ? (
                <span className="hint">모든 행({badCount})이 오류·경고입니다 — 사유는 &lsquo;결과&rsquo; 열을 보세요.</span>
              ) : (
                <label><input type="checkbox" checked={errOnly} onChange={(e) => setErrOnly(e.target.checked)} /> 오류·경고 행만 보기 ({badCount}행)</label>
              )}
              {badCount > 0 && <button type="button" className="linkbtn" onClick={saveErrors}>오류·경고 목록 내려받기 (.csv)</button>}
            </span>
          </p>
          <div className="tw" style={{ maxHeight: 360, overflow: "auto" }}>
            <table>
              <thead><tr><th scope="col">행</th><th scope="col" style={{ minWidth: 220 }}>결과</th>{res.head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.rowNo}>
                    <td>{r.rowNo}</td>
                    <td className="tl" style={{ minWidth: 220 }}>
                      {r.ok ? <b className="st s1">등록</b> : <b className="st s4">오류</b>}
                      {r.errors.map((e) => <div key={e}><small style={{ color: "var(--err)" }}>{e}</small></div>)}
                      {r.warning && <div><small className="hint">{r.warning}</small></div>}
                    </td>
                    {res.head.map((_, i) => <td key={i} className="tl" style={{ whiteSpace: "nowrap" }}>{r.cells[i] ?? ""}</td>)}
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={res.head.length + 2}>표시할 행이 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12 }}>
            <button type="button" className="btn sm sec" disabled={busy} onClick={() => { setStep(2); setRes(null); setFile(null); }}>다른 파일 올리기</button>
            <button type="button" className="btn sm" disabled={busy || !res.ok} onClick={commit}>
              {busy ? "등록 중…" : res.error ? `오류 ${res.error}행 빼고 ${res.ok}${unit} 등록` : `${res.ok}${unit} 등록`}
            </button>
          </div>
        </>
      )}

      {step === 4 && done && (
        <>
          <p><b>{done.created}</b>{unit}을(를) 등록했습니다.{done.skipped > 0 && <> 오류 <b>{done.skipped}</b>행은 등록하지 않았습니다.</>}</p>
          <div className="tw" style={{ maxHeight: 300, overflow: "auto" }}>
            <table>
              <thead><tr><th scope="col">행</th><th scope="col">{noun}</th><th scope="col">비고</th></tr></thead>
              <tbody>{done.items.map((x) => (
                <tr key={x.id}><td>{x.rowNo}</td><td className="tl">{x.name}</td><td className="tl"><small>{x.sub ?? ""}</small></td></tr>
              ))}</tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12 }}>
            <button type="button" className="btn sm dk" onClick={onClose}>닫기</button>
          </div>
        </>
      )}
      <p className={"msg bk-msg" + (msg ? " bad" : "")} role="status">{msg}</p>
    </Modal>
  );
}
