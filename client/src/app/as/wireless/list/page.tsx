"use client";

import AsList from "@/components/AsList";
import SubPage from "@/components/SubPage";
import { AS_VIEW_PERM } from "@/lib/as";

export default function Page() {
  return (
    <SubPage perm={AS_VIEW_PERM.M}>
      <AsList ty="M" />
    </SubPage>
  );
}
