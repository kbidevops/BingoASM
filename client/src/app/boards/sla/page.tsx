"use client";

import SlaReports from "@/components/SlaReports";
import SubPage from "@/components/SubPage";
import { BOARD_PERM } from "@/lib/boards";

/** 스쿨넷 SLA 결과 업로드: 통신사가 월별 SLA 결과 파일(한글 · 엑셀)을 올리고 교육청이 승인한다. */
export default function Page() {
  return (
    <SubPage perm={BOARD_PERM.sla}>
      <SlaReports />
    </SubPage>
  );
}
