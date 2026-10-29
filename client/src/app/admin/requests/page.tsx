"use client";

import AsList from "@/components/AsList";
import SubPage from "@/components/SubPage";

/** 장애접수관리: every AS type in one list (관리자는 전체, 업체 관리자는 자기 업체 건). */
export default function Page() {
  return (
    <SubPage perm="AS_MANAGE">
      <AsList />
    </SubPage>
  );
}
