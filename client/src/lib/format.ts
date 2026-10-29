// Display helpers. The server sends local (Asia/Seoul) times as ISO strings without a zone.

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-10-28T09:05:00" → "2026.10.28." */
export function fmtDate(iso?: string | null) {
  if (!iso) return "-";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}.${m[2]}.${m[3]}.` : iso;
}

/** "2026-10-28T09:05:00" → "2026.10.28. 09:05" */
export function fmtDateTime(iso?: string | null) {
  if (!iso) return "-";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? `${m[1]}.${m[2]}.${m[3]}. ${m[4]}:${m[5]}` : fmtDate(iso);
}

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function mmss(sec: number) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

export function won(n?: number | null) {
  return n == null ? "-" : n.toLocaleString() + "원";
}

/** "010-1234-5678" → ["010","1234","5678"] */
export function splitTel(tel?: string | null): [string, string, string] {
  const p = (tel ?? "").split("-");
  return [p[0] || "010", p[1] ?? "", p[2] ?? ""];
}

export function fileSize(n: number) {
  return n >= 1048576 ? (n / 1048576).toFixed(1) + "MB" : Math.max(1, Math.round(n / 1024)) + "KB";
}

export const LOGIN_METHOD: Record<string, string> = { PASSWORD: "아이디", OTP: "아이디 + 인증번호", QR: "QR" };

export function browserOf(ua?: string) {
  if (!ua) return "-";
  if (/Edg\//.test(ua)) return "Edge";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  return "웹 브라우저";
}
