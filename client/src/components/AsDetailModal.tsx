"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, uploadFiles } from "@/lib/api";
import { ACTION_LABEL, AS_NAME, loadCodes, useAsTypes } from "@/lib/as";
import { useAuth } from "@/lib/auth";
import { fileSize, fmtDate, fmtDateTime, won } from "@/lib/format";
import type { AsCodes, AsDetail, CostItem, FileInfo, RceptTy } from "@/lib/types";
import { AsBadge, DateTimeInput, ErrorBox, FilePicker, HoldBadge, Loading, Modal, useToast, SlaBadge } from "./ui";

const SCORE = ["", "매우불만족", "불만족", "보통", "만족", "매우만족"];
/** 처리 보고서 첨부 개수. 한 번 업로드에 5개까지라(FileService) 새 파일도 그 안에 들어간다. */
const REPORT_FILES_MAX = 5;
/** Actions this screen offers (서버 allowedActions 중). `update`(신청 수정)는 신청 화면에서 한다. */
const SHOWN = ["receive", "handler", "assign", "device", "engineer", "hold", "resume", "outage", "visit", "arrive", "report", "return", "return-cancel", "transfer", "evaluate", "cancel", "delete"];
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

export default function AsDetailModal({ sn, onClose, onChanged, initialAction }: {
  sn: number; onClose: () => void; onChanged: () => void;
  /** 열자마자 펼칠 처리 (예: 장비 라벨 QR의 "처리 보고서 작성" → report). 할 수 없는 처리면 무시한다. */
  initialAction?: string | null;
}) {
  const [d, setD] = useState<AsDetail | null>(null);
  const [err, setErr] = useState("");
  const [action, setAction] = useState<string | null>(null);
  const [first, setFirst] = useState(true);

  const load = useCallback(() => {
    setErr("");
    api.get<AsDetail>(`/api/as/requests/${sn}`).then(setD).catch((e) => setErr(e.message));
  }, [sn]);
  if (first && d) {
    setFirst(false);
    if (initialAction && d.allowedActions?.includes(initialAction)) setAction(initialAction);
  }
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
                {d.handlerType && d.handlerType !== "VENDOR"
                  ? r("처리 담당", d.handlerName ?? "-", "담당자", d.engineerName ?? "미지정 (담당 모두)")
                  : r("처리업체", d.vendorName ?? "미배정", "담당 기사", `${d.engineerName ?? "-"}${d.engineerTel ? ` (${d.engineerTel})` : ""}`)}
                {r("접수일시", fmtDateTime(d.receivedAt), "방문예정일시", fmtDateTime(d.visitPlannedAt))}
                {d.sla && wide("SLA 기한", <SlaBadge sla={d.sla} />)}
                {d.onHold && wide("보류", <><HoldBadge row={d} /> {d.holdReason} <small className="hint">({fmtDateTime(d.holdAt)}부터 · 지연 알림 · SLA 기한이 멈춰 있습니다)</small></>)}
                {!d.onHold && !!d.holdMinutes && wide("보류한 시간", <small className="hint">모두 {d.holdMinutes < 60 ? `${d.holdMinutes}분` : `${Math.floor(d.holdMinutes / 60)}시간 ${d.holdMinutes % 60}분`} — 지연 · SLA 기한에서 뺐습니다</small>)}
                {(d.outageStartAt || d.outageEndAt) && wide("장애 시각 (실제)", `${d.outageStartAt ? fmtDateTime(d.outageStartAt) : "신청 시각"} ~ ${d.outageEndAt ? fmtDateTime(d.outageEndAt) : d.status === "C" ? "처리완료 시각" : "진행 중"}`)}
                {/* 기사가 도착을 기록했고 보고서는 아직 (보고서가 있으면 아래 보고서의 방문일시) */}
                {d.visitAt && !d.report && wide("현장 도착", fmtDateTime(d.visitAt))}
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
    // 도착 기록이 있으면 그 시각, 없으면 방문예정일시
    visitAt: d.report?.visitAt?.slice(0, 16) ?? d.visitAt?.slice(0, 16) ?? d.visitPlannedAt?.slice(0, 16) ?? nowLocal(),
    visitEndAt: d.report?.visitEndAt?.slice(0, 16) ?? nowLocal(),
    troubleSymptom: d.report?.troubleSymptom ?? "",
    inspectContent: d.report?.inspectContent ?? "",
    processTypeCode: d.report?.processTypeCode ?? "",
    processContent: d.report?.processContent ?? "",
    // 스쿨넷 실제 장애 시각 (비우면 신청 · 처리완료 시각으로 계산)
    outageStartAt: d.outageStartAt?.slice(0, 16) ?? "",
    outageEndAt: d.outageEndAt?.slice(0, 16) ?? "",
    holdReason: "",
    holdUntil: "",
    score: "",
    opinion: "",
    vendorId: d.vendorId ? String(d.vendorId) : "",
    // 기사 배정: 아직 기사가 없으면 학교의 기본 담당 기사를 먼저 골라 둔다 (추천)
    engineerUserId: d.engineerUserId ? String(d.engineerUserId) : action === "engineer" && d.suggestedEngineerUserId ? String(d.suggestedEngineerUserId) : "",
    deviceId: d.deviceId ? String(d.deviceId) : "",
    // 처리 담당 지정 (스쿨넷): 지금 담당이 교육지원청이면 기본은 '통신사에 넘김'
    handlerType: d.handlerOptions?.current.handlerType === "VENDOR" ? "REGION" : "VENDOR",
    handlerVendorId: d.handlerOptions?.suggestedVendorId ? String(d.handlerOptions.suggestedVendorId) : "",
    handlerUserId: "",
  });
  // 대상 장비 지정: 이 학교의 무선장비(무선망 AS) · 스쿨넷 장비(스쿨넷 AS)
  const [devices, setDevices] = useState<{ deviceId: number; deviceCode: string; deviceName: string; location?: string }[] | null>(null);
  useEffect(() => {
    if (action !== "device" || !d.schoolId) return;
    api.get<{ content?: NonNullable<typeof devices> } | NonNullable<typeof devices>>(d.rceptTy === "S" ? "/api/as/schoolnet-devices" : "/api/as/wireless-devices", { schoolId: d.schoolId, size: 200 })
      .then((x) => setDevices(Array.isArray(x) ? x : x.content ?? []))
      .catch(() => setDevices([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);
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
  // 기사 목록: 업체 배정은 고른 업체, 기사 배정은 이 신청의 업체
  const engVendor = action === "engineer" ? (d.vendorId ? String(d.vendorId) : "") : v.vendorId;
  useEffect(() => {
    if ((action !== "assign" && action !== "engineer") || !engVendor) { setEngineers([]); return; }
    api.get<typeof engineers>(`/api/as/vendors/${engVendor}/engineers`).then(setEngineers).catch(() => setEngineers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, engVendor]);
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
          ...(d.rceptTy === "S" ? { outageStartAt: v.outageStartAt || null, outageEndAt: v.outageEndAt || null } : {}),
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
      case "device":
        body = { deviceId: v.deviceId ? Number(v.deviceId) : null };
        break;
      case "hold":
        if (!v.holdReason.trim()) check = "보류 사유를 입력해 주세요.";
        body = { reason: v.holdReason.trim(), holdUntil: v.holdUntil || null };
        break;
      case "outage":
        body = { outageStartAt: v.outageStartAt || null, outageEndAt: v.outageEndAt || null };
        break;
      case "handler":
        if (v.handlerType === "VENDOR" && !v.handlerVendorId) check = "넘길 통신사(업체)를 선택해 주세요.";
        if (v.handlerType === "PROVINCE" && !v.handlerUserId) check = "교육청 담당자를 선택해 주세요.";
        body = { handlerType: v.handlerType, vendorId: v.handlerType === "VENDOR" ? Number(v.handlerVendorId) : null,
          userId: v.handlerType !== "VENDOR" && v.handlerUserId ? Number(v.handlerUserId) : null };
        break;
      case "engineer":
        if (!v.engineerUserId) check = "담당 기사를 선택해 주세요.";
        body = { engineerUserId: Number(v.engineerUserId) };
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

  const confirmOnly = action === "cancel" || action === "return-cancel" || action === "delete" || action === "arrive" || action === "resume";
  const confirmText: Record<string, string> = {
    delete: "이 AS 신청을 삭제합니다. 삭제한 내용은 되돌릴 수 없습니다.",
    cancel: "이 AS 신청을 취소합니다.",
    "return-cancel": "반려를 취소하고 신청완료 상태로 되돌립니다.",
    arrive: "지금 시각을 현장 도착으로 기록합니다 (학교에 알림이 갑니다).",
    resume: "보류를 풀고 처리를 다시 시작합니다. 보류한 시간만큼 지연 · SLA 기한이 늦춰집니다 (학교에 알림이 갑니다).",
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
            {d.rceptTy === "S" && <OutageRows v={v} setV={setV} />}
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
        {action === "handler" && d.handlerOptions && (() => {
          const o = d.handlerOptions;
          const people = v.handlerType === "REGION" ? o.regionUsers : o.provinceUsers;
          return (
            <>
              <tr><th scope="row"><i>*</i>처리 담당</th><td>
                <span className="hd-pick" role="radiogroup" aria-label="처리 담당">
                  {([["VENDOR", "통신사에 넘김", "회선 · 통신사 장비 문제"], ["REGION", "교육지원청 직접 처리", "학교 쪽 · 설정 문제 (원격 조치 등)"], ["PROVINCE", "교육청으로 올림", "여러 학교 동시 장애 등 큰 장애"]] as const).map(([k, l, h]) => (
                    <label key={k} className={v.handlerType === k ? "on" : ""}>
                      <input type="radio" name="handlerType" value={k} checked={v.handlerType === k} onChange={() => setV((p) => ({ ...p, handlerType: k, handlerUserId: "" }))} />
                      <b>{l}</b><small>{h}</small>
                    </label>
                  ))}
                </span>
              </td></tr>
              {v.handlerType === "VENDOR" ? (
                <tr><th scope="row"><i>*</i>통신사</th><td>
                  <select aria-label="통신사" value={v.handlerVendorId} onChange={set("handlerVendorId")}>
                    <option value="">-- 선택 --</option>
                    {o.vendors.map((x) => <option key={x.vendorId} value={x.vendorId}>{x.vendorName}{x.vendorId === o.suggestedVendorId ? " — 이 학교 · 회선 업체" : ""}</option>)}
                  </select>{" "}
                  <small className="hint">업체 관리자가 기사를 정합니다.</small>
                </td></tr>
              ) : (
                <tr><th scope="row">{v.handlerType === "PROVINCE" && <i>*</i>}담당자</th><td>
                  <select aria-label="담당자" value={v.handlerUserId} onChange={set("handlerUserId")}>
                    <option value="">{v.handlerType === "REGION" ? "-- 지정 안 함 (스쿨넷 담당 모두) --" : "-- 선택 --"}</option>
                    {people.map((x) => <option key={x.userId} value={x.userId}>{x.userName}{x.positionName ? ` · ${x.positionName}` : ""}{v.handlerType === "REGION" && x.covers ? " (스쿨넷 담당)" : ""}</option>)}
                  </select>{" "}
                  <small className="hint">{v.handlerType === "REGION" ? "담당자가 접수하면 그 사람이 맡습니다." : "교육청 담당자에게 알림이 갑니다."}</small>
                </td></tr>
              )}
            </>
          );
        })()}
        {action === "outage" && <OutageRows v={v} setV={setV} />}
        {action === "hold" && (
          <>
            <tr><th scope="row"><i>*</i>보류 사유</th><td>
              <textarea className="ta" aria-label="보류 사유" maxLength={500} placeholder="예: 교체 부품 입고 대기 (11/20 예정), 통신사 회선 공사 대기, 학교 출입 불가 (방학)" value={v.holdReason} onChange={set("holdReason")} />
            </td></tr>
            <tr><th scope="row">재개 예정일</th><td>
              <input type="date" aria-label="재개 예정일" value={v.holdUntil} onChange={set("holdUntil")} />{" "}
              <small className="hint">선택. 보류 중에는 지연 알림 · SLA 기한이 멈추고, 풀면 보류한 시간만큼 늦춰집니다.</small>
            </td></tr>
          </>
        )}
        {action === "device" && (
          <tr><th scope="row">대상 장비</th><td>
            <select aria-label="대상 장비" value={v.deviceId} onChange={set("deviceId")} disabled={devices === null}>
              <option value="">{devices === null ? "불러오는 중…" : devices.length ? "-- 지정 안 함 --" : `이 학교에 등록된 ${d.rceptTy === "S" ? "스쿨넷 장비" : "무선장비"}가 없습니다`}</option>
              {(devices ?? []).map((x) => <option key={x.deviceId} value={x.deviceId}>{x.deviceCode} {x.deviceName}{x.location ? ` (${x.location})` : ""}</option>)}
            </select>{" "}
            <small className="hint">{d.rceptTy === "S" ? "스쿨넷은 선택입니다 — 연결하면 회선 가용률에 들어갑니다." : "학교가 신고한 증상 · 장소를 보고 장애 장비를 연결합니다. 장비의 유지보수 업체가 이 AS를 맡게 됩니다."}</small>
          </td></tr>
        )}
        {action === "engineer" && (
          <tr><th scope="row"><i>*</i>담당 기사</th><td>
            <select aria-label="담당 기사" value={v.engineerUserId} onChange={set("engineerUserId")}>
              <option value="">-- 선택 --</option>
              {engineers.map((x) => <option key={x.userId} value={x.userId}>{x.userName}{x.mobile ? ` (${x.mobile})` : ""}{x.userId === d.suggestedEngineerUserId ? " — 학교 기본 담당" : ""}</option>)}
            </select>{" "}
            <small className="hint">배정된 기사만 이 신청을 보고 처리합니다.{d.suggestedEngineerName && !d.engineerUserId ? ` 학교 기본 담당 기사(${d.suggestedEngineerName})를 먼저 골라 두었습니다.` : ""}</small>
          </td></tr>
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

/** 스쿨넷 실제 장애 시각 입력 (보고서 · 장애 시각 수정). 비우면 신청 · 처리완료 시각으로 계산한다. */
function OutageRows({ v, setV }: { v: Record<string, string>; setV: React.Dispatch<React.SetStateAction<Record<string, string>>> }) {
  const row = (k: "outageStartAt" | "outageEndAt", label: string, empty: string) => (
    <tr><th scope="row">{label}</th><td>
      {v[k] ? <><DateTimeInput label={label} value={v[k]} onChange={(x) => setV((p) => ({ ...p, [k]: x }))} />{" "}
        <button type="button" className="btn sm sec" onClick={() => setV((p) => ({ ...p, [k]: "" }))}>비우기</button></>
        : <button type="button" className="btn sm sec" onClick={() => setV((p) => ({ ...p, [k]: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) }))}>입력</button>}
      {" "}<small className="hint">{v[k] ? "NMS 등으로 확인한 실제 시각" : empty}</small>
    </td></tr>
  );
  return (
    <>
      {row("outageStartAt", "장애 발생 시각", "비우면 신청 시각으로 계산합니다.")}
      {row("outageEndAt", "복구 시각", "비우면 처리완료 시각으로 계산합니다.")}
    </>
  );
}
