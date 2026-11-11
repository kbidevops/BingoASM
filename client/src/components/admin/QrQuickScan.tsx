"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import QrScanner, { ManualEntry } from "@/components/admin/QrScanner";
import { Modal, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Resolve = { type: string; deviceId?: number; found?: boolean; token?: string; message?: string };

/** 장비 라벨을 찍고 장비 정보를 볼 수 있는 권한 (서버 GET /api/qr/devices/{id}와 같다). */
const DEVICE_SCAN_PERMS = ["WDEVICE_MANAGE", "SDEVICE_MANAGE", "AS_M_REQUEST", "AS_S_REQUEST", "AS_M_VIEW", "AS_S_VIEW", "AS_PROCESS"];

/** Who gets the one-button scanner (device labels only): anyone who can open scanned devices. */
export function useCanQuickScan() {
  const { status, can } = useAuth();
  return status === "authed" && DEVICE_SCAN_PERMS.some(can);
}

/**
 * "QR 찍기": 장비 라벨(무선 · 스쿨넷) 전용 스캐너. 라벨의 QR 또는 직접 입력한 장비코드로 그 장비 화면(정보 · AS 신청)을 연다.
 * 자산 라벨은 기관자산관리의 ‘QR 스캔’에서 찍는다. 로그인 QR은 승인 화면으로 넘긴다.
 */
export default function QrQuickScan({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [msg, setMsg] = useState("");

  const go = (href: string) => { onClose(); router.push(href); };

  const handle = async (text: string) => {
    setMsg("");
    try {
      const r = await api.post<Resolve>("/api/qr/resolve", { text });
      // QR 찍기는 장비 라벨 전용. 자산 라벨은 기관자산관리의 ‘QR 스캔’에서 찍는다.
      if (r.type === "ASSET") return setMsg("자산 라벨입니다. 여기서는 장비 라벨(무선 · 스쿨넷)만 찍을 수 있습니다.");
      if (r.type === "DEVICE") {
        if (!r.found || !r.deviceId) return setMsg(r.message ?? "이 기관에 등록되지 않은 장비입니다.");
        return go(`/device?id=${r.deviceId}`);
      }
      if (r.type === "LOGIN" && r.token) return go(`/login/qr-approve?t=${encodeURIComponent(r.token)}`);
      setMsg(r.message ?? "원클릭AS QR이 아닙니다. 장비 라벨의 QR을 찍거나 장비코드를 입력해 주세요.");
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
      <p className="hint" style={{ margin: "10px 0 4px" }}>라벨이 손상됐다면 라벨에 적힌 장비코드를 입력하세요.</p>
      <ManualEntry onSubmit={handle} placeholder="장비코드 입력 (예: NET-BH-001)" />
    </Modal>
  );
}
