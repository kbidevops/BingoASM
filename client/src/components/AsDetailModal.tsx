"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, uploadFiles } from "@/lib/api";
import { ACTION_LABEL, AS_NAME, loadCodes, useAsTypes } from "@/lib/as";
import { useAuth } from "@/lib/auth";
import { fileSize, fmtDate, fmtDateTime, won } from "@/lib/format";
import type { AsCodes, AsDetail, CostItem, FileInfo, RceptTy } from "@/lib/types";
import { AsBadge, DateTimeInput, ErrorBox, FilePicker, Loading, Modal, useToast } from "./ui";

const SCORE = ["", "매우불만족", "불만족", "보통", "만족", "매우만족"];
/** 처리 보고서 첨부 개수. 한 번 업로드에 5개까지라(FileService) 새 파일도 그 안에 들어간다. */
const REPORT_FILES_MAX = 5;
/** Actions this screen offers (서버 allowedActions 중). `update`(신청 수정)는 신청 화면에서 한다. */
const SHOWN = ["receive", "assign", "visit", "report", "return", "return-cancel", "transfer", "evaluate", "cancel", "delete"];
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
                {d.rceptTy === "S" && d.deviceId && wide("대상장비", d.deviceName ?? "-")}
                {d.deviceCurrentPlace && d.deviceCurrentPlace !== (d.installPlace ?? "").trim() &&
                  wide("장비 현재 위치", <>{d.deviceCurrentPlace} <small className="muted">(설치장소·대상장비는 신청 당시 기준)</small></>)}
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
                    {r("처리유형", d.report.processTypeName ?? "-", "처리 비용", d.report.processAmount ? won(d.report.processAmount) : "-")}
                    {d.report.costItems?.length ? wide("처리 비용 내역", <CostTable items={d.report.costItems} />) : null}
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
  const asTypes = useAsTypes();
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
    vendorId: d.vendorId ? String(d.vendorId) : "",
    engineerUserId: d.engineerUserId ? String(d.engineerUserId) : "",
  });
  // 업체 배정: 이 AS 유형을 맡는 업체 (학교 지역을 맡는 업체가 먼저) · 고른 업체의 기사
  const [vendors, setVendors] = useState<{ vendorId: number; vendorName: string; allRegions?: boolean; regions?: { regionId: number }[] }[]>([]);
  const [engineers, setEngineers] = useState<{ userId: number; userName: string; mobile?: string }[]>([]);
  useEffect(() => {
    if (action !== "assign") return;
    api.get<typeof vendors>("/api/as/vendors", { rceptTy: d.rceptTy }).then((list) => {
      const serves = (x: (typeof list)[number]) => !!x.allRegions || !!x.regions?.some((g) => g.regionId === d.regionId);
      setVendors([...list.filter(serves), ...list.filter((x) => !serves(x))]);
    }).catch(() => setVendors([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);
  useEffect(() => {
    if (action !== "assign" || !v.vendorId) { setEngineers([]); return; }
    api.get<typeof engineers>(`/api/as/vendors/${v.vendorId}/engineers`).then(setEngineers).catch(() => setEngineers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, v.vendorId]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((p) => ({ ...p, [k]: e.target.value }));
  // 비용 항목. 예전 보고서의 단일 금액은 "기타" 한 줄로 보여 준다.
  const [lines, setLines] = useState<CostLine[]>(() =>
    d.report?.costItems?.length ? d.report.costItems.map((c) => ({ costType: c.costType, itemName: c.itemName, quantity: String(c.quantity), unitPrice: String(c.unitPrice) }))
      : d.report?.processAmount ? [{ costType: "ETC", itemName: "처리비용", quantity: "1", unitPrice: String(d.report.processAmount) }] : []);
  // 보고서 첨부(현장 사진·점검표 등): 이미 올린 파일 중 남길 것 + 새 파일
  const [repKeep, setRepKeep] = useState<FileInfo[]>(d.report?.files ?? []);
  const [repFiles, setRepFiles] = useState<File[]>([]);

  useEffect(() => {
    if (action === "report") loadCodes().then(setCodes).catch(() => {});
  }, [action]);
  // The form opens under the report; bring it into view (the dialog body is the scroller).
  const box = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    box.current?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }, [action]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    let body: Record<string, unknown> = {};
    let check = "";
    let costs: CostLine[] = [];
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
        // 처리 비용은 선택: 품목·단가 모두 비운 줄은 없는 것으로 본다.
        costs = lines.filter((l) => l.itemName.trim() || l.unitPrice);
        if (!v.processContent.trim()) check = "처리내용을 입력해 주세요.";
        else if (costs.some((l) => !l.unitPrice || Number(l.unitPrice) < 0 || !(Number(l.quantity) >= 1))) check = "처리 비용의 수량과 단가를 확인해 주세요.";
        body = {
          engineerName: v.engineerName.trim(), visitAt: v.visitAt, visitEndAt: v.visitEndAt,
          troubleSymptom: v.troubleSymptom.trim(), inspectContent: v.inspectContent.trim(),
          processTypeCode: v.processTypeCode || undefined, processContent: v.processContent.trim(),
          costItems: costs.map((l) => ({ costType: l.costType, itemName: l.itemName.trim(), quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) })),
        };
        break;
      case "evaluate":
        if (!v.score) check = "만족도를 선택해 주세요.";
        body = { score: Number(v.score), opinion: v.opinion.trim() };
        break;
      case "assign":
        if (!v.vendorId) check = "배정할 업체를 선택해 주세요.";
        body = { vendorId: Number(v.vendorId), engineerUserId: v.engineerUserId ? Number(v.engineerUserId) : null };
        break;
    }
    if (check) return setMsg(check);
    setBusy(true);
    setMsg("");
    try {
      if (action === "report") body = { ...body, fileIds: [...repKeep.map((f) => f.fileId), ...(await uploadFiles(repFiles))] };
      await api.post(`/api/as/requests/${d.asvcSn}/${action}`, body);
      toast(`${ACTION_LABEL[action]} 처리했습니다.`);
      onDone(action === "delete" || action === "transfer");
    } catch (err) {
      setMsg((err as Error).message);
      setBusy(false);
    }
  };

  const confirmOnly = action === "cancel" || action === "return-cancel" || action === "delete";
  const confirmText: Record<string, string> = {
    delete: "이 AS 신청을 삭제합니다. 삭제한 내용은 되돌릴 수 없습니다.",
    cancel: "이 AS 신청을 취소합니다.",
    "return-cancel": "반려를 취소하고 신청완료 상태로 되돌립니다.",
  };

  return (
    <form ref={box} className="as-act" onSubmit={send} noValidate aria-labelledby="as-act-t">
      <div className="as-act-h">
        <h5 id="as-act-t">{ACTION_LABEL[action]}</h5>
        {d.status === "C" && action === "report" && <small>처리 완료 건의 보고서를 수정합니다 · 처리일 {fmtDate(d.completedAt)}</small>}
      </div>
      <div className="as-act-b">
      {confirmOnly && (
        <p className="as-act-q">
          {confirmText[action]} 계속하시겠습니까?
        </p>
      )}
      {!confirmOnly && <table className="ftab"><tbody>
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
                {asTypes.filter((t) => t !== "T" && t !== d.rceptTy).map((t) => <option key={t} value={t}>{AS_NAME[t]}</option>)}
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
            <tr><th scope="row">처리 비용 <small className="opt">(선택)</small></th><td>
              <CostEditor lines={lines} setLines={setLines} costTypes={codes?.costTypes} />
            </td></tr>
            <tr><th scope="row">첨부파일</th><td>
              {repKeep.length > 0 && (
                <ul className="att-keep">
                  {repKeep.map((f) => (
                    <li key={f.fileId}>
                      {f.name} <small className="hint">({fileSize(f.size)})</small>{" "}
                      <button type="button" className="linkbtn" aria-label={`${f.name} 첨부 삭제`} onClick={() => setRepKeep(repKeep.filter((x) => x.fileId !== f.fileId))}>삭제</button>
                    </li>
                  ))}
                </ul>
              )}
              {repKeep.length < REPORT_FILES_MAX
                ? <FilePicker files={repFiles} onChange={setRepFiles} max={REPORT_FILES_MAX - repKeep.length} />
                : <p className="hint" style={{ margin: 0 }}>최대 {REPORT_FILES_MAX}개까지 첨부할 수 있습니다. 바꾸려면 기존 파일을 삭제하세요.</p>}
              <small className="hint">현장 사진, 점검표, 교체 부품 사진 등 (파일당 20MB 이하)</small>
            </td></tr>
          </>
        )}
        {action === "assign" && (
          <>
            <tr><th scope="row"><i>*</i>업체</th><td>
              <select aria-label="배정할 업체" value={v.vendorId} onChange={(e) => setV((p) => ({ ...p, vendorId: e.target.value, engineerUserId: "" }))}>
                <option value="">-- 선택 --</option>
                {vendors.map((x) => {
                  const serves = !!x.allRegions || !!x.regions?.some((g) => g.regionId === d.regionId);
                  return <option key={x.vendorId} value={x.vendorId}>{x.vendorName}{serves ? "" : " (다른 지역 담당)"}</option>;
                })}
              </select>{" "}
              <small className="hint">{AS_NAME[d.rceptTy]} 유지관리 업체만 보입니다.</small>
            </td></tr>
            <tr><th scope="row">담당 기사</th><td>
              <select aria-label="담당 기사" value={v.engineerUserId} disabled={!v.vendorId} onChange={set("engineerUserId")}>
                <option value="">-- 기사 지정 안 함 --</option>
                {engineers.map((x) => <option key={x.userId} value={x.userId}>{x.userName}{x.mobile ? ` (${x.mobile})` : ""}</option>)}
              </select>
            </td></tr>
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
      </tbody></table>}
      {msg && <p className="msg bad" role="alert" ref={(el) => el?.scrollIntoView({ block: "nearest" })}>{msg}</p>}
      </div>
      <div className="as-act-f">
        <button type="button" className="btn sm sec" onClick={onCancel}>취소</button>
        <button type="submit" className={"btn sm" + (action === "delete" ? " danger" : "")} disabled={busy}>{busy ? "처리 중…" : ACTION_LABEL[action] + (confirmOnly ? "" : " 저장")}</button>
      </div>
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
      {!lines.length && <p className="hint" style={{ margin: "6px 0 0" }}>부품·공임·출장비 등 비용이 든 경우에만 적습니다. 없으면 비워 두세요.</p>}
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
