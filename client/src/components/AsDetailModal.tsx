"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ACTION_LABEL, ACTIVE_TYPES, AS_NAME, loadCodes } from "@/lib/as";
import { useAuth } from "@/lib/auth";
import { fileSize, fmtDate, fmtDateTime, won } from "@/lib/format";
import type { AsCodes, AsDetail, CostItem, FileInfo, RceptTy } from "@/lib/types";
import { AsBadge, DateTimeInput, ErrorBox, Loading, Modal, useToast } from "./ui";

const SCORE = ["", "매우불만족", "불만족", "보통", "만족", "매우만족"];
/** Actions this screen offers. `update` (edit request) and `assign` (admin re-assign) are not built yet. */
const SHOWN = ["receive", "visit", "report", "return", "return-cancel", "transfer", "evaluate", "cancel", "delete"];

function nowLocal() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${String(Math.floor(d.getMinutes() / 10) * 10).padStart(2, "0")}`;
}

function Files({ files }: { files?: FileInfo[] }) {
  if (!files?.length) return <>-</>;
  return (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      {files.map((f) => (
        <li key={f.fileId}>
          <button type="button" className="linkbtn" onClick={() => api.download(f.url, undefined, f.name)}>{f.name}</button> <small className="hint">({fileSize(f.size)})</small>
        </li>
      ))}
    </ul>
  );
}

export default function AsDetailModal({ sn, onClose, onChanged }: { sn: number; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<AsDetail | null>(null);
  const [err, setErr] = useState("");
  const [action, setAction] = useState<string | null>(null);

  const load = useCallback(() => {
    setErr("");
    api.get<AsDetail>(`/api/as/requests/${sn}`).then(setD).catch((e) => setErr(e.message));
  }, [sn]);
  useEffect(load, [load]);

  const done = (closeAfter: boolean) => {
    setAction(null);
    onChanged();
    if (closeAfter) onClose();
    else load();
  };

  const r = (a: string, b: React.ReactNode, c?: string, e?: React.ReactNode) => (
    <tr>
      <th scope="row">{a}</th><td>{b}</td>
      {c ? <><th scope="row">{c}</th><td>{e}</td></> : <td colSpan={2}></td>}
    </tr>
  );
  const wide = (a: string, b: React.ReactNode) => (
    <tr><th scope="row">{a}</th><td colSpan={3} className="tl" style={{ whiteSpace: "pre-wrap" }}>{b}</td></tr>
  );

  return (
    <Modal title="AS 신청 상세 · 보고서" wide onClose={onClose}>
      {err ? <ErrorBox message={err} onRetry={load} /> : !d ? <Loading /> : (
        <>
          <div className="rp">
            <h5>{AS_NAME[d.rceptTy]} AS 처리 결과 보고서</h5>
            <table className="ftab rpt">
              <tbody>
                {r("접수번호", `AS-${d.asvcSn}`, "처리상태", <AsBadge status={d.status} name={d.statusName} />)}
                {r("학교명", d.schoolName ?? "-", "신청자", `${d.applicantName ?? "-"}${d.contactTel ? ` (${d.contactTel})` : ""}`)}
                {r("신청일시", fmtDateTime(d.requestAt), "방문요청일시", fmtDateTime(d.visitRequestAt))}
                {r("장애유형", d.faultTypeName ?? "-", d.rceptTy === "M" ? "요청내용" : "설치장소", d.rceptTy === "M" ? d.requestTypeName ?? "-" : d.installPlace ?? "-")}
                {d.rceptTy === "M" && r("설치장소", d.installPlace ?? "-", "대상장비", d.deviceName ?? "-")}
                {(d.equipmentName || d.modelName) && r("장비", d.equipmentName ?? "-", "모델 / 수량", `${d.modelName ?? "-"} / ${d.quantity ?? "-"}`)}
                {wide(d.rceptTy === "S" ? "신청내용" : "장애증상", d.symptom ?? "-")}
                {d.attachments?.length ? wide("첨부파일", <Files files={d.attachments} />) : null}
                {r("처리업체", d.vendorName ?? "미배정", "담당 기사", `${d.engineerName ?? "-"}${d.engineerTel ? ` (${d.engineerTel})` : ""}`)}
                {r("접수일시", fmtDateTime(d.receivedAt), "방문예정일시", fmtDateTime(d.visitPlannedAt))}
                {d.status === "X" && wide("반려사유", d.returnReason ?? "-")}
                {d.transferFromTy && wide("이관", `${AS_NAME[d.transferFromTy as RceptTy] ?? d.transferFromTy}에서 이관 — ${d.transferContent ?? ""}`)}
                {d.report && (
                  <>
                    {r("방문일시", fmtDateTime(d.report.visitAt), "처리완료일시", fmtDateTime(d.report.visitEndAt ?? d.completedAt))}
                    {r("처리유형", d.report.processTypeName ?? "-", "처리비용", `${won(d.report.processAmount)}${d.report.chargeTypeName ? ` · ${d.report.chargeTypeName}` : ""}`)}
                    {d.report.costItems?.length ? wide("비용 내역", <CostTable items={d.report.costItems} />) : null}
                    {d.report.troubleSymptom && wide("장애증상(현장)", d.report.troubleSymptom)}
                    {d.report.inspectContent && wide("점검내용", d.report.inspectContent)}
                    {wide("처리내용", d.report.processContent ?? "-")}
                    {d.report.files?.length ? wide("보고서 첨부", <Files files={d.report.files} />) : null}
                  </>
                )}
                {wide("만족도", d.evaluation ? `${SCORE[d.evaluation.score]} (${d.evaluation.score}점)${d.evaluation.opinion ? " — " + d.evaluation.opinion : ""}` : d.status === "C" ? "평가 대기" : "-")}
                <tr><th scope="row">확인</th><td colSpan={3}><div className="sig"><span>AS 기사 (인)</span><span>학교 담당자 (인)</span></div></td></tr>
              </tbody>
            </table>
          </div>

          {d.histories && d.histories.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>처리 이력 ({d.histories.length})</summary>
              <div className="tw" style={{ marginTop: 8 }}>
                <table>
                  <thead><tr><th scope="col">일시</th><th scope="col">처리</th><th scope="col">상태</th><th scope="col">처리자</th><th scope="col">내용</th></tr></thead>
                  <tbody>
                    {d.histories.map((h) => (
                      <tr key={h.historyId}>
                        <td>{fmtDateTime(h.createdAt)}</td><td>{ACTION_LABEL[h.action] ?? h.action}</td><td>{h.statusName ?? "-"}</td>
                        <td>{h.workerName ?? "-"}</td><td className="tl">{h.content ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          {action && <ActionForm d={d} action={action} onCancel={() => setAction(null)} onDone={done} />}

          <div style={{ textAlign: "center", marginTop: 14, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            {!action && d.allowedActions.filter((a) => SHOWN.includes(a)).map((a) => (
              <button key={a} type="button" className={"btn sm " + (a === "delete" || a === "return" || a === "cancel" ? "sec" : "")} onClick={() => setAction(a)}>
                {ACTION_LABEL[a]}
              </button>
            ))}
            <button type="button" className="btn bl sm" onClick={() => window.print()}>인쇄</button>
            <button type="button" className="btn dk sm" onClick={onClose}>닫기</button>
          </div>
        </>
      )}
    </Modal>
  );
}

/** Input for one processing action → POST /api/as/requests/{sn}/{action}. */
function ActionForm({ d, action, onCancel, onDone }: { d: AsDetail; action: string; onCancel: () => void; onDone: (closeAfter: boolean) => void }) {
  const toast = useToast();
  const { me } = useAuth();
  const [codes, setCodes] = useState<AsCodes | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [v, setV] = useState<Record<string, string>>({
    visitPlannedAt: d.visitPlannedAt?.slice(0, 16) ?? d.visitRequestAt?.slice(0, 16) ?? nowLocal(),
    reason: "",
    rceptTy: "",
    content: "",
    engineerName: d.report?.engineerName ?? d.engineerName ?? me?.userName ?? "",
    visitAt: d.report?.visitAt?.slice(0, 16) ?? d.visitPlannedAt?.slice(0, 16) ?? nowLocal(),
    visitEndAt: d.report?.visitEndAt?.slice(0, 16) ?? nowLocal(),
    troubleSymptom: d.report?.troubleSymptom ?? "",
    inspectContent: d.report?.inspectContent ?? "",
    processTypeCode: d.report?.processTypeCode ?? "",
    processContent: d.report?.processContent ?? "",
    score: "",
    opinion: "",
  });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((p) => ({ ...p, [k]: e.target.value }));
  // 비용 항목. 예전 보고서의 단일 금액은 "기타" 한 줄로 보여 준다.
  const [lines, setLines] = useState<CostLine[]>(() =>
    d.report?.costItems?.length ? d.report.costItems.map((c) => ({ costType: c.costType, itemName: c.itemName, quantity: String(c.quantity), unitPrice: String(c.unitPrice) }))
      : d.report?.processAmount ? [{ costType: "ETC", itemName: "처리비용", quantity: "1", unitPrice: String(d.report.processAmount) }] : []);
  // 유상·무상: 계약 학교의 정보기기 AS와 스쿨넷은 기본 무상.
  const [charge, setCharge] = useState<"FREE" | "PAID">(d.report?.chargeType
    ?? ((d.rceptTy === "C" && d.school?.contractStatus === "CONTRACTED") || d.rceptTy === "S" ? "FREE" : "PAID"));

  useEffect(() => {
    if (action === "report") loadCodes().then(setCodes).catch(() => {});
  }, [action]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    let body: Record<string, unknown> = {};
    let check = "";
    switch (action) {
      case "receive":
      case "visit":
        body = { visitPlannedAt: v.visitPlannedAt };
        break;
      case "return":
        if (!v.reason.trim()) check = "반려 사유를 입력해 주세요.";
        body = { reason: v.reason.trim() };
        break;
      case "transfer":
        if (!v.rceptTy) check = "이관할 AS 구분을 선택해 주세요.";
        body = { rceptTy: v.rceptTy, content: v.content.trim() };
        break;
      case "report":
        if (!v.processContent.trim()) check = "처리내용을 입력해 주세요.";
        else if (lines.some((l) => !l.unitPrice || Number(l.unitPrice) < 0 || !(Number(l.quantity) >= 1))) check = "비용 항목의 수량과 단가를 확인해 주세요.";
        body = {
          engineerName: v.engineerName.trim(), visitAt: v.visitAt, visitEndAt: v.visitEndAt,
          troubleSymptom: v.troubleSymptom.trim(), inspectContent: v.inspectContent.trim(),
          processTypeCode: v.processTypeCode || undefined, processContent: v.processContent.trim(),
          costItems: lines.map((l) => ({ costType: l.costType, itemName: l.itemName.trim(), quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) })),
          chargeType: charge,
        };
        break;
      case "evaluate":
        if (!v.score) check = "만족도를 선택해 주세요.";
        body = { score: Number(v.score), opinion: v.opinion.trim() };
        break;
    }
    if (check) return setMsg(check);
    setBusy(true);
    setMsg("");
    try {
      await api.post(`/api/as/requests/${d.asvcSn}/${action}`, body);
      toast(`${ACTION_LABEL[action]} 처리했습니다.`);
      onDone(action === "delete" || action === "transfer");
    } catch (err) {
      setMsg((err as Error).message);
      setBusy(false);
    }
  };

  const confirmOnly = action === "cancel" || action === "return-cancel" || action === "delete";

  return (
    <form className="card" style={{ marginTop: 14, padding: 16 }} onSubmit={send} noValidate>
      <h5 style={{ margin: "0 0 10px", fontSize: "1rem" }}>{ACTION_LABEL[action]}</h5>
      {confirmOnly && (
        <p style={{ margin: 0 }}>
          {action === "delete" ? "이 AS 신청을 삭제합니다. 삭제한 내용은 되돌릴 수 없습니다." : action === "cancel" ? "이 AS 신청을 취소합니다." : "반려를 취소하고 신청완료 상태로 되돌립니다."} 계속하시겠습니까?
        </p>
      )}
      <table className="ftab"><tbody>
        {(action === "receive" || action === "visit") && (
          <tr><th scope="row"><i>*</i>방문예정일시</th><td><DateTimeInput label="방문예정일시" value={v.visitPlannedAt} onChange={(x) => setV((p) => ({ ...p, visitPlannedAt: x }))} /></td></tr>
        )}
        {action === "return" && (
          <tr><th scope="row"><i>*</i>반려 사유</th><td><textarea className="ta" aria-label="반려 사유" value={v.reason} onChange={set("reason")} /></td></tr>
        )}
        {action === "transfer" && (
          <>
            <tr><th scope="row"><i>*</i>이관 대상</th><td>
              <select aria-label="이관 대상" value={v.rceptTy} onChange={set("rceptTy")}>
                <option value="">-- 선택 --</option>
                {ACTIVE_TYPES.filter((t) => t !== "T" && t !== d.rceptTy).map((t) => <option key={t} value={t}>{AS_NAME[t]}</option>)}
              </select> <small className="hint">대상 유형의 담당 업체로 다시 배정됩니다.</small>
            </td></tr>
            <tr><th scope="row">이관 내용</th><td><textarea className="ta" aria-label="이관 내용" value={v.content} onChange={set("content")} /></td></tr>
          </>
        )}
        {action === "report" && (
          <>
            <tr><th scope="row">처리 기사</th><td><input aria-label="처리 기사" value={v.engineerName} onChange={set("engineerName")} /></td></tr>
            <tr><th scope="row">방문일시</th><td><DateTimeInput label="방문일시" value={v.visitAt} onChange={(x) => setV((p) => ({ ...p, visitAt: x }))} /></td></tr>
            <tr><th scope="row">처리완료일시</th><td><DateTimeInput label="처리완료일시" value={v.visitEndAt} onChange={(x) => setV((p) => ({ ...p, visitEndAt: x }))} /></td></tr>
            <tr><th scope="row">장애증상</th><td><textarea className="ta" aria-label="장애증상" value={v.troubleSymptom} onChange={set("troubleSymptom")} /></td></tr>
            <tr><th scope="row">점검내용</th><td><textarea className="ta" aria-label="점검내용" value={v.inspectContent} onChange={set("inspectContent")} /></td></tr>
            <tr><th scope="row">처리유형</th><td>
              <select aria-label="처리유형" value={v.processTypeCode} onChange={set("processTypeCode")}>
                <option value="">-- 선택 --</option>
                {codes && Object.entries(codes.processTypes).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
              </select>
            </td></tr>
            <tr><th scope="row"><i>*</i>처리내용</th><td><textarea className="ta" aria-label="처리내용" value={v.processContent} onChange={set("processContent")} /></td></tr>
            <tr><th scope="row">비용 구분</th><td>
              {(["FREE", "PAID"] as const).map((c) => (
                <label key={c} style={{ marginRight: 12 }}><input type="radio" name="charge" checked={charge === c} onChange={() => setCharge(c)} /> {codes?.chargeTypes[c] ?? (c === "FREE" ? "무상(계약 포함)" : "유상(별도 청구)")}</label>
              ))}
              <small className="hint">무상: 유지관리 계약·SLA에 포함되어 학교에 청구하지 않음</small>
            </td></tr>
            <tr><th scope="row">비용 항목</th><td><CostEditor lines={lines} setLines={setLines} costTypes={codes?.costTypes} /></td></tr>
          </>
        )}
        {action === "evaluate" && (
          <>
            <tr><th scope="row"><i>*</i>만족도</th><td>
              {[5, 4, 3, 2, 1].map((s) => (
                <label key={s} style={{ marginRight: 12 }}><input type="radio" name="score" value={s} checked={v.score === String(s)} onChange={set("score")} /> {SCORE[s]}</label>
              ))}
            </td></tr>
            <tr><th scope="row">의견</th><td><textarea className="ta" aria-label="의견" value={v.opinion} onChange={set("opinion")} /></td></tr>
          </>
        )}
      </tbody></table>
      <p className={"msg" + (msg ? " bad" : "")} role="status" style={{ textAlign: "center", fontSize: ".875rem" }}>{msg}</p>
      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        <button type="button" className="btn sm sec" onClick={onCancel}>취소</button>
        <button type="submit" className="btn sm" disabled={busy}>{busy ? "처리 중…" : ACTION_LABEL[action] + (confirmOnly ? "" : " 저장")}</button>
      </div>
      {d.status === "C" && action === "report" && <p className="hint" style={{ margin: "8px 0 0", textAlign: "center" }}>처리 완료 건의 보고서를 수정합니다. 처리일시: {fmtDate(d.completedAt)}</p>}
    </form>
  );
}

interface CostLine { costType: string; itemName: string; quantity: string; unitPrice: string }
const COST_TYPES: Record<string, string> = { PART: "부품", LABOR: "공임", TRAVEL: "출장", ETC: "기타" };
const lineAmount = (l: CostLine) => (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0);

/** 보고서 비용 항목 입력: 구분·품목·수량·단가, 금액과 합계는 자동 계산. */
function CostEditor({ lines, setLines, costTypes = COST_TYPES }: { lines: CostLine[]; setLines: (l: CostLine[]) => void; costTypes?: Record<string, string> }) {
  const edit = (i: number, k: keyof CostLine, val: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: val } : l)));
  const total = lines.reduce((n, l) => n + lineAmount(l), 0);
  return (
    <div className="cost-ed">
      {lines.length > 0 && (
        <table>
          <thead><tr><th scope="col">구분</th><th scope="col">품목</th><th scope="col">수량</th><th scope="col">단가(원)</th><th scope="col">금액(원)</th><th scope="col"><span className="sr">삭제</span></th></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td><select aria-label={`${i + 1}번 구분`} value={l.costType} onChange={(e) => edit(i, "costType", e.target.value)}>
                  {Object.entries(costTypes).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
                </select></td>
                <td><input aria-label={`${i + 1}번 품목`} maxLength={100} placeholder={costTypes[l.costType]} value={l.itemName} onChange={(e) => edit(i, "itemName", e.target.value)} /></td>
                <td><input aria-label={`${i + 1}번 수량`} type="number" min={1} max={999} value={l.quantity} onChange={(e) => edit(i, "quantity", e.target.value)} /></td>
                <td><input aria-label={`${i + 1}번 단가`} type="number" min={0} step={100} value={l.unitPrice} onChange={(e) => edit(i, "unitPrice", e.target.value)} /></td>
                <td className="num">{lineAmount(l).toLocaleString()}</td>
                <td><button type="button" className="cost-x" aria-label={`${i + 1}번 항목 삭제`} onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="cost-foot">
        <button type="button" className="btn sm sec" disabled={lines.length >= 20}
          onClick={() => setLines([...lines, { costType: lines.length ? "LABOR" : "PART", itemName: "", quantity: "1", unitPrice: "" }])}>+ 항목 추가</button>
        <span>합계 <b>{total.toLocaleString()}</b>원</span>
      </div>
      {!lines.length && <p className="hint" style={{ margin: "6px 0 0" }}>비용이 없으면 비워 두세요.</p>}
    </div>
  );
}

function CostTable({ items }: { items: CostItem[] }) {
  return (
    <table className="cost-tb">
      <thead><tr><th scope="col">구분</th><th scope="col">품목</th><th scope="col">수량</th><th scope="col">단가</th><th scope="col">금액</th></tr></thead>
      <tbody>
        {items.map((c, i) => (
          <tr key={i}><td>{c.costTypeName ?? c.costType}</td><td className="tl">{c.itemName}</td><td className="num">{c.quantity}</td>
            <td className="num">{c.unitPrice.toLocaleString()}</td><td className="num">{(c.amount ?? c.unitPrice * c.quantity).toLocaleString()}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
