"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import SubPage from "@/components/SubPage";
import { ErrorBox, Loading } from "@/components/ui";
import { api } from "@/lib/api";
import { browserOf } from "@/lib/format";

// Phone side of QR login. The server's /qr?t={token} (the address inside the QR) redirects here.

export default function QrApprovePage() {
  return (
    <Suspense>
      <SubPage title="QR 로그인 승인" auth side={false}>
        <Approve />
      </SubPage>
    </Suspense>
  );
}

function Approve() {
  const token = useSearchParams().get("t") ?? "";
  const [info, setInfo] = useState<{ status: string; num: string; clientIp?: string } | null>(null);
  const [err, setErr] = useState("");
  const [result, setResult] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!token) return setErr("QR 정보가 없습니다. 다시 찍어 주세요.");
    api.get<{ status: string; num: string; clientIp?: string }>(`/api/auth/qr/${encodeURIComponent(token)}/info`).then(setInfo).catch((e) => setErr(e.message));
  }, [token]);

  // Three choices, one of them the number shown on the PC.
  const choices = useMemo(() => {
    if (!info) return [];
    const n = +info.num;
    return [info.num, String(((n + 37) % 90) + 10), String(((n + 61) % 90) + 10)].sort();
  }, [info]);

  if (err) return <ErrorBox message={err} />;
  if (!info) return <Loading />;
  if (result) return <div className="empty" style={{ padding: "40px 20px" }}><p>{result}</p><Link className="btn sm sec" href="/">메인으로</Link></div>;
  if (info.status !== "PENDING") return <ErrorBox message="만료되었거나 이미 처리된 QR입니다. PC에서 새 QR을 받아 다시 찍어 주세요." />;

  const pick = async (num: string) => {
    if (num !== info.num) {
      setMsg("숫자가 다릅니다. 다른 사람이 보낸 QR일 수 있으니 승인하지 마세요.");
      await api.post(`/api/auth/qr/${encodeURIComponent(token)}/reject`).catch(() => {});
      setTimeout(() => setResult("로그인 요청을 거절했습니다."), 1500);
      return;
    }
    try {
      await api.post(`/api/auth/qr/${encodeURIComponent(token)}/approve`, { num });
      setResult("승인했습니다. PC 화면에서 로그인이 완료됩니다.");
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div className="phone" style={{ maxWidth: 420, margin: "0 auto" }}>
      <p className="ph-t">이 PC에서 원클릭AS시스템에 로그인할까요?</p>
      <dl className="ph-dl">
        <div><dt>접속 IP</dt><dd>{info.clientIp ?? "-"}</dd></div>
        <div><dt>이 기기</dt><dd>{browserOf(navigator.userAgent)}</dd></div>
      </dl>
      <p className="ph-q">PC 화면에 보이는 숫자를 고르세요.</p>
      <div className="ph-nums">
        {choices.map((n) => <button key={n} type="button" className="ph-n" onClick={() => pick(n)}>{n}</button>)}
      </div>
      <p className="ph-msg" role="alert">{msg}</p>
      <button type="button" className="btn sm sec" style={{ width: "100%" }}
        onClick={() => api.post(`/api/auth/qr/${encodeURIComponent(token)}/reject`).then(() => setResult("로그인 요청을 거절했습니다.")).catch((e) => setMsg(e.message))}>
        내가 요청하지 않았어요 (거절)
      </button>
    </div>
  );
}
