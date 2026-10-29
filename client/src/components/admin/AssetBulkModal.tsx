"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "../ui";

interface Validation {
  head: string[];
  total: number;
  ok: number;
  error: number;
  rows: { rowNo: number; cells: string[]; errors: string[]; ok: boolean; warning?: string }[];
}
interface Committed {
  created: number;
  skipped: number;
  assets: { rowNo: number; assetId: number; assetNo: string; assetName: string }[];
}

const STEPS = ["양식 받기·작성", "파일 올리기", "확인", "등록 완료"];

/** 자산 엑셀 일괄 등록 (/api/assets/bulk): 양식 → 검증(행별 오류) → 확정. 검증 규칙은 서버 한 곳에만 있습니다. */
export default function AssetBulkModal({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
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
    // Keep the bytes so the commit sends exactly what was validated.
    const copy = new File([await f.arrayBuffer()], f.name, { type: f.type });
    const form = new FormData();
    form.append("file", copy);
    try {
      setRes(await api.upload<Validation>("/api/assets/bulk/validate", form));
      setFile(copy);
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
      const r = await api.upload<Committed>("/api/assets/bulk/commit", form);
      setDone(r);
      setStep(4);
      onDone(`자산 ${r.created}건을 등록했습니다.`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const rows = res ? res.rows.filter((r) => !errOnly || !r.ok || r.warning) : [];
  return (
    <Modal title="자산 엑셀 일괄 등록" wide onClose={onClose}>
      <ol className="bk-steps">
        {STEPS.map((t, i) => (
          <li key={t} className={i + 1 < step ? "done" : i + 1 === step ? "on" : ""} aria-current={i + 1 === step ? "step" : undefined}>{t}</li>
        ))}
      </ol>

      {step <= 2 && (
        <>
          <div className="nbox">
            <p>■ 양식의 1행(제목)은 바꾸지 마세요. 열 순서: 기관명 · 분류 · 품명·규격 · 취득일(YYYY-MM-DD) · 내용연수(년) · 위치 · 상태</p>
            <p>■ 위치는 <b>공간(실) 관리</b>에 등록된 실 이름·호실과 맞춥니다. 없는 실은 위치 미지정으로 등록되고 비고에 남습니다.</p>
            <p>■ 최대 2,000행. 자산번호는 자동으로 붙습니다.</p>
          </div>
          <p>
            <button type="button" className="btn sm" onClick={() => api.download("/api/assets/bulk/template", undefined, "자산_일괄등록_양식.xlsx").then(() => setStep(2)).catch((e) => setMsg(e.message))}>
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
            <div className="mpc c4"><span>오류</span><b>{res.error}</b>행</div>
          </div>
          <p style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <span className="hint">{file?.name}</span>
            <label><input type="checkbox" checked={errOnly} onChange={(e) => setErrOnly(e.target.checked)} /> 오류·경고 행만 보기</label>
          </p>
          <div className="tw" style={{ maxHeight: 360, overflow: "auto" }}>
            <table>
              <thead><tr><th scope="col">행</th>{res.head.map((h) => <th key={h} scope="col">{h}</th>)}<th scope="col">결과</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.rowNo}>
                    <td>{r.rowNo}</td>
                    {res.head.map((_, i) => <td key={i} className="tl">{r.cells[i] ?? ""}</td>)}
                    <td className="tl">
                      {r.ok ? <b className="st s1">등록</b> : <b className="st s4">오류</b>}
                      {r.errors.map((e) => <div key={e}><small style={{ color: "var(--err)" }}>{e}</small></div>)}
                      {r.warning && <div><small className="hint">{r.warning}</small></div>}
                    </td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={res.head.length + 2}>표시할 행이 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12 }}>
            <button type="button" className="btn sm sec" onClick={() => { setStep(2); setRes(null); setFile(null); }}>다른 파일 올리기</button>
            <button type="button" className="btn sm" disabled={busy || !res.ok} onClick={commit}>
              {busy ? "등록 중…" : res.error ? `오류 ${res.error}행 빼고 ${res.ok}건 등록` : `${res.ok}건 등록`}
            </button>
          </div>
        </>
      )}

      {step === 4 && done && (
        <>
          <p><b>{done.created}</b>건을 등록했습니다.{done.skipped > 0 && <> 오류 <b>{done.skipped}</b>행은 등록하지 않았습니다.</>}</p>
          <div className="tw" style={{ maxHeight: 300, overflow: "auto" }}>
            <table>
              <thead><tr><th scope="col">행</th><th scope="col">자산번호</th><th scope="col">품명</th></tr></thead>
              <tbody>{done.assets.map((a) => <tr key={a.assetId}><td>{a.rowNo}</td><td>{a.assetNo}</td><td className="tl">{a.assetName}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="hint">등록한 자산의 QR 라벨은 목록에서 선택한 뒤 ‘QR 라벨 출력’으로 인쇄하세요.</p>
          <div style={{ textAlign: "center" }}><button type="button" className="btn sm dk" onClick={onClose}>닫기</button></div>
        </>
      )}
      <p className={"msg bk-msg" + (msg ? " bad" : "")} role="status">{msg}</p>
    </Modal>
  );
}
