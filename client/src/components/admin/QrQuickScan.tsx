"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import QrScanner, { ManualEntry } from "@/components/admin/QrScanner";
import { Modal, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Resolve = { type: string; state?: string; assetNo?: string; roomId?: number; deviceId?: number; found?: boolean; schoolId?: number; token?: string; message?: string; location?: { path?: string } };

/** Who gets the one-button scanner: anyone who can open assets (school users, 교육지원청, 도교육청). */
export function useCanQuickScan() {
  const { status, can } = useAuth();
  return status === "authed" && can("ASSET_READ");
}

/**
 * "QR 찍기": one scanner for every label. What was read decides where it goes —
 * an asset label opens that asset (or registration for a new label), a room label opens that room's asset list.
 */
export default function QrQuickScan({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const { can } = useAuth();
  const [msg, setMsg] = useState("");

  const go = (href: string) => { onClose(); router.push(href); };

  const handle = async (text: string) => {
    setMsg("");
    try {
      const r = await api.post<Resolve>("/api/qr/resolve", { text });
      if (r.type === "ASSET" && r.state === "OUT_OF_SCOPE") return setMsg(r.message ?? "담당 범위 밖 학교의 자산입니다.");
      if (r.type === "ASSET" && r.assetNo) {
        // 찍자마자 어디 있는 자산인지 알려 주고, 상세(위치 카드)로 간다.
        if (r.location?.path) toast(`${r.assetNo} · ${r.location.path}`);
        return go(`/admin/assets?no=${encodeURIComponent(r.assetNo)}`);
      }
      if (r.type === "DEVICE" && r.deviceId) {
        if (!r.found) return setMsg("이 기관에 등록되지 않은 장비 QR입니다.");
        return go(`/device?id=${r.deviceId}`);
      }
      if (r.type === "LOGIN" && r.token) return go(`/login/qr-approve?t=${encodeURIComponent(r.token)}`);
      setMsg(r.message ?? "원클릭AS QR이 아닙니다. 자산이나 장비 라벨의 QR을 찍어 주세요.");
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <Modal title="QR 찍기" onClose={onClose}>
      <ul className="qqs-help">
        <li><b>장비 라벨</b> (무선·스쿨넷) → 장비 정보 · AS 신청</li>
      </ul>
      <QrScanner onText={handle} />
      {msg && <p className="scan-msg" role="alert">{msg}</p>}
      <p className="hint" style={{ margin: "10px 0 4px" }}>라벨이 손상됐다면 번호를 입력하세요.</p>
      <ManualEntry onSubmit={handle} />
    </Modal>
  );
}
