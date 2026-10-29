"use client";

import AsRequestForm from "@/components/AsRequestForm";
import SubPage from "@/components/SubPage";
import { AS_REQUEST_PERM } from "@/lib/as";

export default function Page() {
  return (
    <SubPage perm={AS_REQUEST_PERM.M}>
      <AsRequestForm ty="M" />
    </SubPage>
  );
}
