"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import QrScanner, { ManualEntry } from "@/components/admin/QrScanner";
import { Modal, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Resolve = { type: string; state?: string; assetNo?: string; roomId?: number; found?: boolean; schoolId?: number; token?: string; message?: string };

/** Who gets the one-button scanner: anyone who can open assets (school users, 교육지원청, 도교육청). */
export function useCanQuickScan() {
  const { status, can } = useAuth();
  return status === "authed" && can("ASSET_READ");
}

/**
 * "QR 찍기": one scanner for every label. What was read decides where it goes —
 * an asset label opens that asset (or registration for a new label), a room label opens that room's
 * 재물조사 when one is running for the school, otherwise the room on the floor plan.
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
      if (r.type === "ASSET" && r.assetNo) return go(`/admin/assets?no=${encodeURIComponent(r.assetNo)}`);
      if (r.type === "ROOM" && r.roomId) {
        if (!r.found) return setMsg("이 기관에 등록되지 않은 교실 QR입니다.");
        if (can("INVENTORY") && r.schoolId) {
          const running = await api.get<{ status: string }[]>("/api/as/inventory", { schoolId: r.schoolId }).catch(() => []);
          if (running.some((s) => s.status === "OPEN")) return go(`/admin/inventory?room=${r.roomId}`);
        }
        return go(`/admin/floorplan?room=${r.roomId}`);
      }
      if (r.type === "LOGIN" && r.token) return go(`/login/qr-approve?t=${encodeURIComponent(r.token)}`);
      setMsg(r.message ?? "원클릭AS QR이 아닙니다. 자산 라벨이나 교실 문의 QR을 찍어 주세요.");
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <Modal title="QR 찍기" onClose={onClose}>
      <ul className="qqs-help">
        <li><b>자산 라벨</b> → 그 자산 정보 (미등록 라벨이면 등록 화면)</li>
        <li><b>교실 문 QR</b> → 그 교실의 자산 (재물조사 중이면 바로 조사)</li>
      </ul>
      <QrScanner onText={handle} />
      {msg && <p className="scan-msg" role="alert">{msg}</p>}
      <p className="hint" style={{ margin: "10px 0 4px" }}>라벨이 손상됐다면 번호를 입력하세요.</p>
      <ManualEntry onSubmit={handle} />
    </Modal>
  );
}
