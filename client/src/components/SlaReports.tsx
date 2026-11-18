"use client";

import { useCallback, useEffect, useState } from "react";
import { ErrorBox, FilePicker, FormMsg, Loading, Modal, useToast } from "./ui";
import { api, uploadFiles } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/format";

interface FileInfo { fileId: number; name: string; size: number; url: string }
type Status = "SUBMITTED" | "APPROVED" | "REJECTED";
interface Report {
  reportId: number; vendorId: number; vendorName: string; title: string; periodFrom?: string; periodTo?: string; note?: string;
  status: Status; rejectReason?: string;
  submittedAt: string; submittedByName?: string; reviewedAt?: string; reviewedByName?: string; files: FileInfo[];
  canEdit: boolean; canReview: boolean;
}
interface Data {
  rows: Report[]; counts: { all: number; SUBMITTED: number; APPROVED: number; REJECTED: number };
  canUpload: boolean; canReview: boolean; myVendorId?: number;
  vendors: { vendorId: number; vendorName: string }[]; allowedExt: string[]; maxFiles: number;
}

const STATUS: Record<Status, [string, string]> = { SUBMITTED: ["승인 대기", "s2"], APPROVED: ["승인", "s3"], REJECTED: ["반려", "s4"] };
const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`);
const period = (r: { periodFrom?: string; periodTo?: string }) =>
  r.periodFrom || r.periodTo ? `${r.periodFrom ? fmtDate(r.periodFrom) : ""} ~ ${r.periodTo ? fmtDate(r.periodTo) : ""}` : "";

/**
 * 스쿨넷 SLA 결과 업로드 (/api/as/sla-reports): 스쿨넷 서비스 제공 업체(통신사)가 SLA 결과 파일(한글 · 엑셀)을 올리고,
 * 교육청(또는 그 업체가 맡은 지역의 교육지원청)이 승인 · 반려한다. 학교는 승인된 결과만 본다.
 */
export default function SlaReports() {
  const toast = useToast();
  const [status, setStatus] = useState<"" | Status>("");
  const [vendor, setVendor] = useState("");
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [upload, setUpload] = useState<Report | "new" | null>(null);
  const [reject, setReject] = useState<Report | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "approve" | "delete"; r: Report } | null>(null);

  const load = useCallback(() => {
    setErr("");
    api.get<Data>("/api/as/sla-reports", { vendorId: vendor || undefined, status: status || undefined }).then(setD).catch((e) => setErr((e as Error).message));
  }, [vendor, status]);
  useEffect(load, [load]);

  if (err) return <ErrorBox message={err} onRetry={load} />;
  if (!d) return <Loading />;


  return (
    <div className="slr">
      <div className="slr-info">
        <p><b>업체(통신사)</b>가 SLA 결과 파일을 올리면 <b>교육청 · 교육지원청</b>이 확인해 승인합니다. 승인된 결과는 학교도 봅니다.</p>
        <p className="slr-info-f">
          한글({d.allowedExt.filter((x) => x.startsWith("hw")).map((x) => "." + x).join(" · ")}) · 엑셀({d.allowedExt.filter((x) => x.startsWith("xl")).map((x) => "." + x).join(" · ")})
          <span aria-hidden="true"> · </span>한 번에 {d.maxFiles}개 · 각 20MB 이하<span aria-hidden="true"> · </span>반려되면 고쳐서 다시 올립니다
        </p>
      </div>

      {d.canReview && d.counts.SUBMITTED > 0 && status !== "SUBMITTED" && (
        <button type="button" className="slr-todo" onClick={() => setStatus("SUBMITTED")}>
          <span className="slr-todo-n">{d.counts.SUBMITTED}</span>
          <span><b>승인을 기다리는 결과가 {d.counts.SUBMITTED}건 있습니다.</b><small>파일을 확인하고 승인하거나 사유와 함께 반려하세요.</small></span>
          <span className="slr-todo-go" aria-hidden="true">보기 →</span>
        </button>
      )}

      <div className="slr-bar">
        <div className="my-chips slr-chips" role="group" aria-label="상태">
          <button type="button" className={!status ? "on" : ""} aria-pressed={!status} onClick={() => setStatus("")}>전체 <b>{d.counts.all}</b></button>
          {(["SUBMITTED", "APPROVED", "REJECTED"] as Status[]).map((s) => (
            <button key={s} type="button" className={status === s ? "on" : ""} aria-pressed={status === s} onClick={() => setStatus(s)}>{STATUS[s][0]} <b>{d.counts[s]}</b></button>
          ))}
        </div>
        <div className="slr-bar-r">
          {d.vendors.length > 1 && (
            <select aria-label="통신사" value={vendor} onChange={(e) => setVendor(e.target.value)}>
              <option value="">통신사 전체</option>
              {d.vendors.map((v) => <option key={v.vendorId} value={String(v.vendorId)}>{v.vendorName}</option>)}
            </select>
          )}
          {d.canUpload && <button type="button" className="btn sm" onClick={() => setUpload("new")}>＋ SLA 결과 올리기</button>}
        </div>
      </div>

      {d.rows.length ? (
        <ul className="slr-list">
          {d.rows.map((r) => {
            const wait = r.status === "SUBMITTED" && r.canReview;
            return (
              <li key={r.reportId} className={`slr-card st-${r.status.toLowerCase()}${wait ? " wait" : ""}`}>
                <div className="slr-main">
                  <div className="slr-head">
                    <h3>{r.title}</h3>
                    <b className={"st " + STATUS[r.status][1]}>{STATUS[r.status][0]}</b>
                  </div>
                  <p className="slr-meta">
                    <span className="slr-vendor">{r.vendorName}</span>
                    {period(r) && <span>대상 기간 {period(r)}</span>}
                    <span>{r.submittedByName ?? "-"} · {fmtDateTime(r.submittedAt)} 올림</span>
                  </p>
                  <ul className="slr-chipfiles" aria-label="첨부 파일">
                    {r.files.map((f) => {
                      const hwp = /\.hwpx?$/i.test(f.name);
                      return (
                        <li key={f.fileId}>
                          <button type="button" title={`${f.name} 내려받기`} onClick={() => api.download(f.url, undefined, f.name).catch((e) => toast((e as Error).message))}>
                            <span className={"slr-ext " + (hwp ? "hwp" : "xls")} aria-hidden="true">{hwp ? "한글" : "엑셀"}</span>
                            <span className="slr-fn">{f.name}</span>
                            <small>{kb(f.size)}</small>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {r.note && <p className="slr-memo">{r.note}</p>}
                  {r.status === "REJECTED" && r.rejectReason && <p className="slr-reason"><b>반려 사유</b> {r.rejectReason}</p>}
                  {r.reviewedAt && <small className="slr-rev">{r.status === "APPROVED" ? "승인" : "반려"} · {r.reviewedByName ?? ""} · {fmtDateTime(r.reviewedAt)}</small>}
                </div>
                {(r.canReview || r.canEdit) && (
                  <div className="slr-acts">
                    {r.canReview && (
                      <>
                        <button type="button" className="btn sm" onClick={() => setConfirm({ kind: "approve", r })}>승인</button>
                        <button type="button" className="btn sm sec" onClick={() => setReject(r)}>반려</button>
                      </>
                    )}
                    {r.canEdit && (
                      <>
                        <button type="button" className="btn sm sec" onClick={() => setUpload(r)}>고쳐 올리기</button>
                        <button type="button" className="btn sm sec slr-del" onClick={() => setConfirm({ kind: "delete", r })}>지우기</button>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="slr-empty">
          <span className="slr-empty-i" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></svg></span>
          <p>{d.counts.all ? "고른 조건에 맞는 결과가 없습니다." : d.canUpload ? "올린 SLA 결과가 없습니다." : "아직 올라온 SLA 결과가 없습니다."}</p>
          {!d.counts.all && d.canUpload && <button type="button" className="btn sm" onClick={() => setUpload("new")}>＋ SLA 결과 올리기</button>}
        </div>
      )}

      {upload && <UploadForm d={d} edit={upload === "new" ? null : upload} onClose={() => setUpload(null)} onDone={() => { setUpload(null); toast("올렸습니다. 교육청 · 교육지원청이 확인하면 알림이 갑니다."); load(); }} />}
      {reject && <RejectForm r={reject} onClose={() => setReject(null)} onDone={() => { setReject(null); toast("반려했습니다."); load(); }} />}
      {confirm && <ConfirmDialog kind={confirm.kind} r={confirm.r} onClose={() => setConfirm(null)}
        onDone={() => { toast(confirm.kind === "approve" ? `승인했습니다. ${confirm.r.vendorName}에 알림이 갑니다.` : "지웠습니다."); setConfirm(null); load(); }}
        onReject={() => { setReject(confirm.r); setConfirm(null); }} />}
    </div>
  );
}

function UploadForm({ d, edit, onClose, onDone }: { d: Data; edit: Report | null; onClose: () => void; onDone: () => void }) {
  const myVendor = d.vendors.find((v) => v.vendorId === d.myVendorId)?.vendorName;
  const [title, setTitle] = useState(edit?.title ?? `${myVendor ? myVendor + " " : ""}스쿨넷 SLA 결과`);
  const [from, setFrom] = useState(edit?.periodFrom ?? "");
  const [to, setTo] = useState(edit?.periodTo ?? "");
  const [note, setNote] = useState(edit?.note ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const accept = d.allowedExt.map((x) => "." + x);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setMsg("제목을 입력해 주세요.");
    if (from && to && to < from) return setMsg("대상 기간의 끝이 시작보다 이릅니다.");
    if (!files.length) return setMsg("SLA 결과 파일(한글 · 엑셀)을 선택해 주세요.");
    setBusy(true); setMsg("");
    try {
      const fileIds = await uploadFiles(files);
      await api.post("/api/as/sla-reports", { reportId: edit?.reportId, title: title.trim(), periodFrom: from || null, periodTo: to || null, note: note.trim() || null, fileIds });
      onDone();
    } catch (er) {
      setMsg((er as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title={edit ? "SLA 결과 고쳐 올리기" : "스쿨넷 SLA 결과 올리기"} onClose={onClose}>
      <form className="slr-form" noValidate onSubmit={save}>
        {edit?.status === "REJECTED" && <p className="slr-exist rejected">반려되었습니다{edit.rejectReason ? ` (사유: ${edit.rejectReason})` : ""}. 고쳐 올리면 승인 대기로 돌아갑니다.</p>}
        <label><span>제목 <i>*</i></span><input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="예) 2026년 상반기 스쿨넷 SLA 결과" /></label>
        <div><span className="slr-fl">대상 기간 (선택)</span>
          <span className="slr-period">
            <input type="date" aria-label="대상 기간 시작" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span aria-hidden="true">~</span>
            <input type="date" aria-label="대상 기간 끝" value={to} onChange={(e) => setTo(e.target.value)} />
          </span>
        </div>
        <div><span className="slr-fl">SLA 결과 파일 <i>*</i></span>
          <FilePicker files={files} onChange={setFiles} max={d.maxFiles} accept={accept} />
          <small className="hint">한글 · 엑셀 파일만, 최대 {d.maxFiles}개{edit ? " — 고쳐 올리면 파일을 새로 바꿉니다" : ""}</small>
        </div>
        <label><span>메모 (선택)</span><textarea rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="예) 가용률 99.93%, 장애 2건 — 세부는 첨부 파일 참고" /></label>
        <FormMsg kind={msg ? "bad" : undefined} text={msg} />
        <div className="slr-form-act">
          <button type="button" className="btn sm sec" onClick={onClose}>취소</button>
          <button type="submit" className="btn sm" disabled={busy}>{busy ? "올리는 중…" : edit ? "고쳐 올리기" : "올리기"}</button>
        </div>
      </form>
    </Modal>
  );
}

/** 승인 · 지우기 확인 창: 무엇을 하는지 · 그 뒤에 어떻게 되는지 보여 주고, 결과는 창 안에서 알린다. */
function ConfirmDialog({ kind, r, onClose, onDone, onReject }: { kind: "approve" | "delete"; r: Report; onClose: () => void; onDone: () => void; onReject: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const approve = kind === "approve";
  const go = async () => {
    setBusy(true); setMsg("");
    try {
      if (approve) await api.post(`/api/as/sla-reports/${r.reportId}/approve`, {});
      else await api.del(`/api/as/sla-reports/${r.reportId}`);
      onDone();
    } catch (e) { setMsg((e as Error).message); setBusy(false); }
  };
  return (
    <Modal title={approve ? "SLA 결과 승인" : "SLA 결과 지우기"} onClose={onClose}>
      <div className="slr-cf">
        <dl className="slr-cf-sum">
          <div><dt>통신사</dt><dd><b>{r.vendorName}</b></dd></div>
          <div><dt>제목</dt><dd>{r.title}</dd></div>
          {period(r) && <div><dt>대상 기간</dt><dd>{period(r)}</dd></div>}
          <div><dt>파일</dt><dd>
            <ul className="slr-files">
              {r.files.map((f) => (
                <li key={f.fileId}>
                  <span className={"slr-ext " + (/\.hwpx?$/i.test(f.name) ? "hwp" : "xls")} aria-hidden="true">{/\.hwpx?$/i.test(f.name) ? "한글" : "엑셀"}</span>
                  <button type="button" className="linkbtn" onClick={() => api.download(f.url, undefined, f.name).catch((e) => setMsg((e as Error).message))}>{f.name}</button>
                </li>
              ))}
            </ul>
          </dd></div>
          <div><dt>올림</dt><dd>{r.submittedByName ?? "-"} · {fmtDateTime(r.submittedAt)}</dd></div>
          {r.note && <div><dt>메모</dt><dd className="slr-note">{r.note}</dd></div>}
        </dl>
        {approve ? (
          <ul className="slr-cf-what">
            <li>승인하면 <b>교육지원청 · 학교</b>도 이 결과를 볼 수 있습니다.</li>
            <li>{r.vendorName}은(는) 이 결과를 <b>더 고치거나 지울 수 없습니다.</b></li>
            <li>{r.vendorName}의 업체 관리자 · 기사에게 승인 알림이 갑니다.</li>
          </ul>
        ) : (
          <p className="slr-cf-warn">이 결과와 첨부 파일을 지웁니다. 지운 뒤에는 되돌릴 수 없습니다.</p>
        )}
        {approve && <p className="hint" style={{ margin: 0 }}>파일을 먼저 열어 확인하세요. 고칠 곳이 있으면 [반려하기]로 사유를 보내면 업체가 고쳐 다시 올립니다.</p>}
        <FormMsg kind={msg ? "bad" : undefined} text={msg} />
        <div className="slr-form-act">
          <button type="button" className="btn sm sec" onClick={onClose} disabled={busy}>취소</button>
          {approve && <button type="button" className="btn sm sec" onClick={onReject} disabled={busy}>반려하기</button>}
          <button type="button" className={"btn sm" + (approve ? "" : " danger")} onClick={go} disabled={busy} autoFocus>
            {busy ? "처리 중…" : approve ? "승인" : "지우기"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function RejectForm({ r, onClose, onDone }: { r: Report; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return setMsg("반려 사유를 입력해 주세요.");
    setBusy(true);
    try { await api.post(`/api/as/sla-reports/${r.reportId}/reject`, { reason: reason.trim() }); onDone(); }
    catch (er) { setMsg((er as Error).message); setBusy(false); }
  };
  return (
    <Modal title={`SLA 결과 반려 — ${r.vendorName}`} onClose={onClose}>
      <form className="slr-form" noValidate onSubmit={save}>
        <p className="hint" style={{ margin: 0 }}>{r.title}</p>
        <label><span>반려 사유 <i>*</i></span><textarea rows={4} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="업체가 고쳐서 다시 올릴 수 있도록 구체적으로 적어 주세요." /></label>
        <FormMsg kind={msg ? "bad" : undefined} text={msg} />
        <div className="slr-form-act">
          <button type="button" className="btn sm sec" onClick={onClose}>취소</button>
          <button type="submit" className="btn sm" disabled={busy}>{busy ? "처리 중…" : "반려"}</button>
        </div>
      </form>
    </Modal>
  );
}
