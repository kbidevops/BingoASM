"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "../ui";

/** Longest side of the uploaded plan. Big enough to read room names when zoomed, small enough to load fast. */
const MAX_SIDE = 2400;

type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage>; destroy: () => Promise<void> };
type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
};

/** pdf.js is large; load it only when someone actually picks a PDF. Worker is copied to /public by scripts/copy-pdf-worker.mjs. */
async function openPdf(file: File): Promise<PdfDoc> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.js";
  return (await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, enableXfa: false }).promise) as unknown as PdfDoc;
}

function fit(w: number, h: number) {
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  return [Math.round(w * k), Math.round(h * k)];
}

/**
 * 도면 올리기: 이미지 · PDF(건축 도면) · 휴대폰 사진(피난안내도) → 회전 → 업로드.
 * Everything happens in the browser; the server only ever receives a PNG/JPEG.
 */
export default function PlanUploadModal({ title, onClose, onUpload }: { title: string; onClose: () => void; onUpload: (f: File) => Promise<void> }) {
  const [src, setSrc] = useState<HTMLCanvasElement | null>(null);
  const [kind, setKind] = useState<"pdf" | "photo">("photo");
  const [name, setName] = useState("plan");
  const [pdf, setPdf] = useState<PdfDoc | null>(null);
  const [page, setPage] = useState(1);
  const [rot, setRot] = useState(0);
  const [preview, setPreview] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const out = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => () => { pdf?.destroy().catch(() => {}); }, [pdf]);

  const renderPdfPage = async (doc: PdfDoc, n: number) => {
    setBusy(true);
    try {
      const pg = await doc.getPage(n);
      const v1 = pg.getViewport({ scale: 1 });
      const scale = Math.min(4, MAX_SIDE / Math.max(v1.width, v1.height));
      const vp = pg.getViewport({ scale });
      const c = document.createElement("canvas");
      c.width = Math.round(vp.width);
      c.height = Math.round(vp.height);
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      setSrc(c);
      setRot(0);
    } catch {
      setMsg("PDF 페이지를 그리지 못했습니다. 다른 페이지를 고르거나 이미지로 저장해 올려 주세요.");
    } finally {
      setBusy(false);
    }
  };

  const pick = async (f?: File) => {
    if (!f) return;
    setMsg("");
    setName(f.name.replace(/\.[^.]+$/, "") || "plan");
    if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
      if (f.size > 50 * 1024 * 1024) return setMsg("PDF는 50MB 이하만 열 수 있습니다.");
      setBusy(true);
      try {
        const doc = await openPdf(f);
        setPdf(doc);
        setKind("pdf");
        setPage(1);
        await renderPdfPage(doc, 1);
      } catch {
        setMsg("PDF를 열지 못했습니다. 암호가 걸린 파일이면 해제한 뒤 올려 주세요.");
        setBusy(false);
      }
      return;
    }
    if (!f.type.startsWith("image/")) return setMsg("이미지(PNG·JPG) 또는 PDF 파일을 골라 주세요.");
    setBusy(true);
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      // Browsers apply the photo's EXIF orientation when drawing, so phone photos come out upright.
      const [w, h] = fit(img.naturalWidth, img.naturalHeight);
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      setPdf(null);
      setKind("photo");
      setSrc(c);
      setRot(0);
      setBusy(false);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setMsg("이미지를 읽지 못했습니다. (HEIC 사진은 휴대폰 설정에서 ‘호환성 우선’으로 찍거나 JPG로 바꿔 주세요.)");
      setBusy(false);
    };
    img.src = url;
  };

  // Apply rotation into the output canvas and refresh the preview.
  useEffect(() => {
    if (!src) return;
    const c = (out.current ??= document.createElement("canvas"));
    const turn = rot % 180 !== 0;
    c.width = turn ? src.height : src.width;
    c.height = turn ? src.width : src.height;
    const ctx = c.getContext("2d")!;
    ctx.save();
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.drawImage(src, -src.width / 2, -src.height / 2);
    ctx.restore();
    setPreview(c.toDataURL("image/jpeg", 0.7));
  }, [src, rot]);

  const upload = async () => {
    const c = out.current;
    if (!c) return;
    setBusy(true);
    setMsg("");
    // Line drawings (PDF) stay sharp as PNG; photos are much smaller as JPEG.
    const type = kind === "pdf" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, type, 0.88));
    if (!blob) {
      setBusy(false);
      return setMsg("이미지를 만들지 못했습니다.");
    }
    try {
      await onUpload(new File([blob], `${name}.${kind === "pdf" ? "png" : "jpg"}`, { type }));
    } catch (e) {
      setMsg((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title={`${title} 도면 올리기`} wide onClose={onClose}>
      {!src ? (
        <>
          <label className="bk-drop" tabIndex={0} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}>
            <b>{busy ? "여는 중…" : "도면 파일을 끌어 놓거나 눌러서 고르세요"}</b>
            <span>이미지(PNG·JPG) 또는 PDF</span>
            <input type="file" accept="image/*,application/pdf,.pdf" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          <p style={{ textAlign: "center", margin: "10px 0" }}>
            <label className="btn sm sec" style={{ cursor: "pointer" }}>
              📷 휴대폰 카메라로 찍기
              <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
          </p>
          <ul className="fx-tips">
            <li><b>건축 도면(PDF)</b> — 행정실 시설 담당에게 받은 PDF를 그대로 고르세요. 여러 쪽이면 해당 층의 쪽을 고를 수 있습니다.</li>
            <li><b>피난안내도</b> — 층 복도에 붙은 안내도를 정면에서, 안내도가 화면을 꽉 채우게 찍으세요. 빛 반사가 없도록 비스듬히 비추는 조명을 피하면 좋습니다.</li>
            <li>도면은 실 위치를 표시하는 바탕일 뿐이라 정확한 축척이 필요 없습니다.</li>
          </ul>
        </>
      ) : (
        <>
          <div className="up-tools">
            <button type="button" className="btn sm sec" onClick={() => setRot((r) => (r + 270) % 360)}>⟲ 왼쪽으로 회전</button>
            <button type="button" className="btn sm sec" onClick={() => setRot((r) => (r + 90) % 360)}>⟳ 오른쪽으로 회전</button>
            <button type="button" className="btn sm sec" onClick={() => { setSrc(null); setPdf(null); setPreview(""); }}>다른 파일</button>
            {pdf && pdf.numPages > 1 && (
              <span className="up-pg">
                쪽
                <select aria-label="PDF 쪽" value={page} disabled={busy} onChange={(e) => { const n = +e.target.value; setPage(n); renderPdfPage(pdf, n); }}>
                  {Array.from({ length: pdf.numPages }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
                </select>
                / {pdf.numPages}
              </span>
            )}
          </div>
          <div className="up-stage">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {preview && <img src={preview} alt="올릴 도면 미리보기" />}
          </div>
          <p className="hint">방향이 맞는지 확인하세요. 위쪽이 도면의 위쪽이 되게 돌리면 실을 표시하기 쉽습니다. ({out.current?.width}×{out.current?.height}px)</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn sm sec" onClick={onClose}>취소</button>
            <button type="button" className="btn sm" disabled={busy} onClick={upload}>{busy ? "처리 중…" : "이 도면으로 저장"}</button>
          </div>
        </>
      )}
      <p className={"msg bk-msg" + (msg ? " bad" : "")} role="status">{msg}</p>
    </Modal>
  );
}
