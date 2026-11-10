"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { downloadCsv } from "@/lib/admin";
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
  users: { rowNo: number; userId: number; loginId: string; userName: string; typeName: string; affiliation: string; tempPassword?: string | null }[];
}

const STEPS = ["양식 받기·작성", "파일 올리기", "확인", "등록 완료"];

/**
 * 사용자 엑셀 일괄 등록 (/api/users/bulk): 양식 → 검증(행별 오류) → 확정. 검증 규칙은 사용자 등록 화면과 같은 서버 코드 한 곳에 있다.
 * 초기 비밀번호를 비운 행은 서버가 임시 비밀번호를 만들어 등록 결과에서 한 번만 보여 준다.
 */
export default function UserBulkModal({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [res, setRes] = useState<Validation | null>(null);
  const [errOnly, setErrOnly] = useState(false);
  const [done, setDone] = useState<Committed | null>(null);
  const [saved, setSaved] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const temps = done?.users.filter((u) => u.tempPassword) ?? [];

  const pick = async (f?: File) => {
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) return setMsg("엑셀(.xlsx) 파일만 올릴 수 있습니다.");
    if (f.size > 5 * 1024 * 1024) return setMsg("5MB 이하 파일만 올릴 수 있습니다.");
    setMsg("");
    setBusy(true);
    // 검증한 그대로 등록하도록 파일 내용을 붙잡아 둔다.
    const copy = new File([await f.arrayBuffer()], f.name, { type: f.type });
    const form = new FormData();
    form.append("file", copy);
    try {
      setRes(await api.upload<Validation>("/api/users/bulk/validate", form));
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
      const r = await api.upload<Committed>("/api/users/bulk/commit", form);
      setDone(r);
      setStep(4);
      onDone(`사용자 ${r.created}명을 등록했습니다.`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveList = () => {
    if (!done) return;
    downloadCsv(`사용자_일괄등록_결과_${new Date().toISOString().slice(0, 10)}`, ["행", "아이디", "이름", "회원유형", "소속", "임시 비밀번호"],
      done.users.map((u) => [u.rowNo, u.loginId, u.userName, u.typeName, u.affiliation, u.tempPassword ?? "(직접 입력한 비밀번호)"]));
    setSaved(true);
  };

  const close = () => {
    if (temps.length && !saved && !window.confirm(`임시 비밀번호 ${temps.length}개는 이 창을 닫으면 다시 볼 수 없습니다. 내려받지 않고 닫을까요?`)) return;
    onClose();
  };

  const rows = res ? res.rows.filter((r) => !errOnly || !r.ok || r.warning) : [];
  return (
    <Modal title="사용자 엑셀 일괄 등록" wide onClose={close}>
      <ol className="bk-steps">
        {STEPS.map((t, i) => (
          <li key={t} className={i + 1 < step ? "done" : i + 1 === step ? "on" : ""} aria-current={i + 1 === step ? "step" : undefined}>{t}</li>
        ))}
      </ol>

      {step <= 2 && (
        <>
          <div className="nbox">
            <p>■ 양식의 1행(제목)은 바꾸지 마세요. 열 순서: 아이디 · 이름 · 회원유형 · 소속 · 직위 · 휴대폰 · 이메일 · 초기 비밀번호</p>
            <p>■ 회원유형: 학교 담당자 · AS 기사 · 업체 관리자 · 교육지원청 담당자 · 교육청 관리자. 소속은 그 유형에 맞는 학교 · 업체 · 교육지원청 이름입니다 (양식의 ‘소속 목록’ 시트).</p>
            <p>■ 초기 비밀번호를 비우면 임시 비밀번호를 만들어 등록 결과에서 <b>한 번만</b> 보여 줍니다. 최대 500행.</p>
          </div>
          <p>
            <button type="button" className="btn sm" onClick={() => api.download("/api/users/bulk/template", undefined, "사용자_일괄등록_양식.xlsx").then(() => setStep(2)).catch((e) => setMsg(e.message))}>
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
              {busy ? "등록 중…" : res.error ? `오류 ${res.error}행 빼고 ${res.ok}명 등록` : `${res.ok}명 등록`}
            </button>
          </div>
        </>
      )}

      {step === 4 && done && (
        <>
          <p><b>{done.created}</b>명을 등록했습니다.{done.skipped > 0 && <> 오류 <b>{done.skipped}</b>행은 등록하지 않았습니다.</>}</p>
          {temps.length > 0 && (
            <div className="nbox ub-warn" role="alert">
              <p>■ 임시 비밀번호 <b>{temps.length}</b>개는 지금만 볼 수 있습니다. 목록을 내려받아 각 사용자에게 따로 전달하고, 첫 로그인 뒤 마이페이지에서 바꾸게 안내하세요.</p>
              <p>■ 내려받은 파일은 전달이 끝나면 지우세요.</p>
            </div>
          )}
          <div className="tw" style={{ maxHeight: 300, overflow: "auto" }}>
            <table>
              <thead><tr><th scope="col">행</th><th scope="col">아이디</th><th scope="col">이름</th><th scope="col">회원유형</th><th scope="col">소속</th><th scope="col">임시 비밀번호</th></tr></thead>
              <tbody>{done.users.map((u) => (
                <tr key={u.userId}>
                  <td>{u.rowNo}</td><td>{u.loginId}</td><td className="tl">{u.userName}</td><td>{u.typeName}</td><td className="tl">{u.affiliation || "—"}</td>
                  <td>{u.tempPassword ? <code className="ub-pw">{u.tempPassword}</code> : <small className="hint">직접 입력</small>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12 }}>
            <button type="button" className="btn sm" onClick={saveList}>{saved ? "결과 다시 내려받기 (.csv)" : "결과 내려받기 (.csv)"}</button>
            <button type="button" className="btn sm dk" onClick={close}>닫기</button>
          </div>
        </>
      )}
      <p className={"msg bk-msg" + (msg ? " bad" : "")} role="status">{msg}</p>
    </Modal>
  );
}
