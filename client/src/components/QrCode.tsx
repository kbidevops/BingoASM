"use client";

import qrcode from "qrcode-generator";

/** Renders text as an SVG QR code (same output as the clone's qrSvg). */
export default function QrCode({ text, label = "QR 코드", margin = 2 }: { text: string; label?: string; margin?: number }) {
  const q = qrcode(0, "M");
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
  const size = n + 2 * margin;
  return (
    <svg className="qr" viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" role="img" aria-label={label}>
      <rect width="100%" height="100%" fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
