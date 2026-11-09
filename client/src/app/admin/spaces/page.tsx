"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Kpis, SchoolSelect, ToolButton, useSchoolChoice } from "@/components/admin/common";
import SubPage from "@/components/SubPage";
import { ErrorBox, FormMsg, FormRow, Icon, Loading, Modal, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import type { Building } from "@/lib/admin";
import { useAuth } from "@/lib/auth";

/** 장비관리 > 건물·층 관리: 학교 → 건물 → 층. 층마다 도면을 올려 무선장비 위치(도면)에서 장비를 놓는다. */
export default function SpacesPage() {
  return (
    <SubPage perm="SPACE_MANAGE">
      <Spaces />
    </SubPage>
  );
}

type Dialog =
  | { kind: "building" }
  | { kind: "floor"; building: Building }
  | { kind: "delBuilding"; building: Building };

function Spaces() {
  const toast = useToast();
  const { can } = useAuth();
  const { schools, schoolId, setSchoolId, fixed, err: schoolErr } = useSchoolChoice();
  const [blds, setBlds] = useState<Building[] | null>(null);
  const [err, setErr] = useState("");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const plans = can("WDEVICE_MANAGE");

  const load = useCallback(() => {
    if (!schoolId) return;
    setErr("");
    api.get<Building[]>("/api/as/spaces/buildings", { schoolId }).then(setBlds).catch((e) => setErr(e.message));
  }, [schoolId]);
  useEffect(load, [load]);

  if (schoolErr) return <ErrorBox message={schoolErr} />;
  const floors = (blds ?? []).flatMap((b) => b.floors);

  return (
    <>
      <div className="pl-top">
        <SchoolSelect schools={schools} value={schoolId} fixed={fixed} onChange={setSchoolId} />
        {plans && <Link className="linkbtn" href="/admin/floorplan">무선장비 위치(도면)</Link>}
      </div>
      {err ? <ErrorBox message={err} onRetry={load} /> : !blds ? <Loading /> : (
        <>
          <Kpis items={[
            ["건물", `${blds.length}`, "동"],
            ["층", `${floors.length}`, "개"],
            ["도면이 있는 층", `${floors.filter((f) => f.planUrl).length}`, `/${floors.length}`],
          ]} />
          <div className="atool sp-tool">
            <ToolButton icon={<Icon name="school" />} label="+ 건물 추가" onClick={() => setDialog({ kind: "building" })} />
          </div>
          {!blds.length && <p className="empty">등록된 건물이 없습니다. ‘+ 건물 추가’로 시작하세요.</p>}
          {blds.map((b) => (
            <section key={b.buildingId} className="sp-b">
              <div className="sp-bh">
                <h3>{b.buildingName}</h3>
                <span className="hint">{b.floors.length ? `${b.floors.length}개 층` : "층 없음"}{b.address ? ` · ${b.address}` : ""}</span>
                <span className="sp-bt">
                  <button type="button" className="linkbtn" onClick={() => setDialog({ kind: "floor", building: b })}>층 추가</button>{" "}
                  <button type="button" className="linkbtn" onClick={() => setDialog({ kind: "delBuilding", building: b })}>건물 삭제</button>
                </span>
              </div>
              <ul className="sp-floors">
                {b.floors.map((f) => (
                  <li key={f.floorId}>
                    <b>{f.floorName}</b>
                    <span className={f.planUrl ? "ok" : "warn"}>{f.planUrl ? "도면 있음" : "도면 없음"}</span>
                    {plans && <Link className="linkbtn" href={`/admin/floorplan?building=${b.buildingId}&floor=${f.floorId}`}>{f.planUrl ? "도면 보기" : "도면 올리기"}</Link>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
      {dialog && schoolId && (
        <SpaceDialog dialog={dialog} schoolId={schoolId} onClose={() => setDialog(null)}
          onSaved={(m) => { setDialog(null); toast(m); load(); }} />
      )}
    </>
  );
}

function SpaceDialog({ dialog, schoolId, onClose, onSaved }: {
  dialog: Dialog; schoolId: number; onClose: () => void; onSaved: (m: string) => void;
}) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState({ buildingName: "", address: "", floorCount: "3", basementCount: "0", floorNo: "", floorName: "" });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });

  const run = async (f: () => Promise<string>) => {
    setBusy(true);
    setMsg("");
    try {
      onSaved(await f());
    } catch (e) {
      setMsg((e as Error).message);
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    switch (dialog.kind) {
      case "building":
        if (!v.buildingName.trim()) return setMsg("건물 이름을 입력해 주세요.");
        return run(async () => {
          await api.post("/api/as/spaces/buildings", { schoolId, buildingName: v.buildingName.trim(), address: v.address.trim() || undefined, floorCount: Number(v.floorCount) || 1, basementCount: Number(v.basementCount) || 0 });
          return "건물을 추가했습니다.";
        });
      case "floor":
        if (!v.floorNo) return setMsg("층 번호를 입력해 주세요. (지하는 -1, -2 …)");
        return run(async () => {
          await api.post(`/api/as/spaces/buildings/${dialog.building.buildingId}/floors`, { floorNo: Number(v.floorNo), floorName: v.floorName.trim() || undefined });
          return "층을 추가했습니다.";
        });
      case "delBuilding":
        return run(async () => {
          await api.del(`/api/as/spaces/buildings/${dialog.building.buildingId}`);
          return "건물을 삭제했습니다.";
        });
    }
  };

  const title = { building: "건물 추가", floor: "층 추가", delBuilding: "건물 삭제" }[dialog.kind];
  return (
    <Modal title={title} onClose={onClose}>
      <form className="ft2" noValidate onSubmit={submit}>
        {dialog.kind === "delBuilding" ? (
          <p>{dialog.building.buildingName}과(와) 그 안의 층·도면을 삭제합니다. 도면에 놓인 무선장비는 도면에서 빠지고 장비는 그대로 남습니다. 계속할까요?</p>
        ) : (
          <table className="ftab"><tbody>
            {dialog.kind === "building" && (
              <>
                <FormRow label="건물 이름" required><input aria-label="건물 이름" placeholder="예: 본관" value={v.buildingName} onChange={set("buildingName")} /></FormRow>
                <FormRow label="주소"><input aria-label="주소" placeholder="비우면 학교 주소" style={{ width: "100%" }} value={v.address} onChange={set("address")} /></FormRow>
                <FormRow label="층 수">
                  지상 <input type="number" min={1} max={30} aria-label="지상 층 수" style={{ width: 70 }} value={v.floorCount} onChange={set("floorCount")} /> 층 ·
                  지하 <input type="number" min={0} max={10} aria-label="지하 층 수" style={{ width: 70 }} value={v.basementCount} onChange={set("basementCount")} /> 층
                </FormRow>
              </>
            )}
            {dialog.kind === "floor" && (
              <>
                <FormRow label="층 번호" required><input type="number" aria-label="층 번호" style={{ width: 90 }} value={v.floorNo} onChange={set("floorNo")} /> <small className="hint">지하는 -1, -2 …</small></FormRow>
                <FormRow label="층 이름"><input aria-label="층 이름" placeholder="비우면 ‘4층’처럼 자동" value={v.floorName} onChange={set("floorName")} /></FormRow>
              </>
            )}
          </tbody></table>
        )}
        <FormMsg kind={msg ? "bad" : undefined} text={msg} />
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <button type="button" className="btn sm sec" onClick={onClose}>취소</button>
          <button type="submit" className="btn sm" disabled={busy}>{busy ? "처리 중…" : dialog.kind === "delBuilding" ? "삭제" : "저장"}</button>
        </div>
      </form>
    </Modal>
  );
}
