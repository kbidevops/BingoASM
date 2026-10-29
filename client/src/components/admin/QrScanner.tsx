"use client";

import jsQR from "jsqr";
import { useCallback, useEffect, useRef, useState } from "react";

/** Typed asset number (when the label is damaged or there is no camera). */
export function ManualEntry({ onSubmit, placeholder = "자산번호 입력 (예: CB-2026-00012)" }: { onSubmit: (t: string) => void; placeholder?: string }) {
  const [v, setV] = useState("");
  return (
    <form className="scan-in" onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onSubmit(v.trim()); setV(""); } }}>
      <label htmlFor="scan-no" className="sr">자산번호</label>
      <input id="scan-no" placeholder={placeholder} autoComplete="off" value={v} onChange={(e) => setV(e.target.value)} />
      <button className="btn sm" type="submit">확인</button>
    </form>
  );
}

/** Decodes a QR from an image/video frame; tries a downscaled pass and inverted colours. */
function decode(src: CanvasImageSource, w: number, h: number, canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  for (const max of [1000, 600]) {
    const k = Math.min(1, max / Math.max(w, h));
    canvas.width = Math.max(1, Math.round(w * k));
    canvas.height = Math.max(1, Math.round(h * k));
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    const r = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: "attemptBoth" });
    if (r?.data) return r.data;
  }
  return null;
}

/**
 * Camera QR scanner (rear camera) with a photo fallback.
 * `continuous` keeps scanning after a hit (재물조사); the same text is ignored for 2.5 s.
 */
export default function QrScanner({ onText, continuous, autoStart = true }: { onText: (text: string) => void; continuous?: boolean; autoStart?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const raf = useRef(0);
  const last = useRef({ text: "", at: 0 });
  const cb = useRef(onText);
  cb.current = onText;
  const [on, setOn] = useState(false);
  const [msg, setMsg] = useState("");

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setOn(false);
  }, []);

  const hit = useCallback((text: string) => {
    const now = Date.now();
    if (text === last.current.text && now - last.current.at < 2500) return;
    last.current = { text, at: now };
    try { navigator.vibrate?.(60); } catch { /* ignore */ }
    cb.current(text);
    if (!continuous) stop();
  }, [continuous, stop]);

  const start = useCallback(async () => {
    setMsg("");
    if (!navigator.mediaDevices?.getUserMedia) return setMsg("이 브라우저는 카메라를 지원하지 않습니다. 사진으로 읽거나 번호를 입력하세요.");
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      stream.current = s;
      const v = video.current!;
      v.srcObject = s;
      await v.play();
      setOn(true);
      canvas.current ??= document.createElement("canvas");
      let lastTick = 0;
      const tick = (t: number) => {
        raf.current = requestAnimationFrame(tick);
        if (t - lastTick < 120 || v.readyState < 2 || !v.videoWidth) return;
        lastTick = t;
        const text = decode(v, v.videoWidth, v.videoHeight, canvas.current!);
        if (text) hit(text);
      };
      raf.current = requestAnimationFrame(tick);
    } catch (e) {
      setMsg((e as Error).name === "NotAllowedError"
        ? "카메라 권한이 거부되었습니다. 주소창의 카메라 아이콘에서 허용하거나 사진으로 읽으세요."
        : "카메라를 찾지 못했습니다. 사진으로 읽거나 번호를 입력하세요. (카메라는 https 또는 localhost에서만 동작합니다)");
    }
  }, [hit]);

  useEffect(() => {
    if (autoStart) start();
    return stop;
  }, [autoStart, start, stop]);

  const fromImage = (f: File | undefined) => {
    if (!f) return;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      canvas.current ??= document.createElement("canvas");
      const text = decode(img, img.naturalWidth, img.naturalHeight, canvas.current);
      URL.revokeObjectURL(url);
      if (text) { last.current = { text: "", at: 0 }; hit(text); }
      else setMsg("사진에서 QR을 찾지 못했습니다. QR이 크게 나오도록 다시 찍어 주세요.");
    };
    img.onerror = () => setMsg("이미지를 읽지 못했습니다.");
    img.src = url;
  };

  return (
    <div className="scan">
      <div className="scan-v" hidden={!on}>
        <video ref={video} playsInline muted />
        <i className="scan-f" aria-hidden="true"></i>
      </div>
      <div className="iv-ctl" style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0" }}>
        {on
          ? <button type="button" className="btn sm sec" onClick={stop}>카메라 끄기</button>
          : <button type="button" className="btn sm" onClick={start}>카메라로 스캔</button>}
        <label className="btn sm sec" style={{ cursor: "pointer" }}>
          사진으로 읽기
          <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { fromImage(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
      </div>
      {msg && <p className="scan-msg" role="alert">{msg}</p>}
    </div>
  );
}
