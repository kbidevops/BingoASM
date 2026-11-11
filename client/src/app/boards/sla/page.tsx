"use client";

import SlaDashboard from "@/components/SlaDashboard";
import SubPage from "@/components/SubPage";
import { BOARD_PERM } from "@/lib/boards";

/** 스쿨넷 SLA 공유: 스쿨넷 AS로 계산한 SLA 현황 (기준 · 충족률 · 회선 가용률 · 위반 내역 · 월간 보고서). */
export default function Page() {
  return (
    <SubPage perm={BOARD_PERM.sla}>
      <SlaDashboard />
    </SubPage>
  );
}
