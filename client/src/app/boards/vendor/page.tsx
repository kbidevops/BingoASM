"use client";

import BoardList from "@/components/BoardList";
import SubPage from "@/components/SubPage";
import { BOARD_PERM } from "@/lib/boards";

export default function Page() {
  return (
    <SubPage perm={BOARD_PERM.vendor}>
      <BoardList slug="vendor" />
    </SubPage>
  );
}
