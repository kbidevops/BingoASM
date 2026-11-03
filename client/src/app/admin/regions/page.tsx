"use client";

import { useCallback, useEffect, useState } from "react";
import { Confirm } from "@/components/admin/common";
import SubPage from "@/components/SubPage";
import { ErrorBox, FormMsg, Loading, Modal, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { clearRegionCache } from "@/lib/boards";
import type { Region } from "@/lib/types";

/** 지역 관리: 도교육청 산하 교육지원청 등록·조회·수정·삭제와 순서. `admin`과 도교육청 관리자만. */
export default function RegionsPage() {
  return (
    <SubPage perm="REGION_MANAGE">
      <Regions />
    </SubPage>
  );
}

interface RegionUsage extends Region {
  schools: number;
  users: number;
  vendors: number;
}

function Regions() {
  const toast = useToast();
  const [list, setList] = useState<RegionUsage[] | null>(null);
  const [names, setNames] = useState<Record<number, string>>({});
  const [add, setAdd] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState<RegionUsage | null>(null);

  const load = useCallback(() => {
    setErr("");
    return api.get<RegionUsage[]>("/api/as/regions/usage").then((d) => {
      setList(d);
      setNames(Object.fromEntries(d.map((r) => [r.regionId, r.regionName])));
    }).catch((e) => setErr((e as Error).message));
  }, []);
  useEffect(() => { load(); }, [load]);

  /** Runs a change, then refreshes this list and the region list other screens share. */
  const run = async (f: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setMsg("");
    try {
      await f();
      clearRegionCache();
      toast(ok);
      await load();
      return true;
    } catch (e) {
      setMsg((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (err) return <ErrorBox message={err} onRetry={load} />;
  if (!list) return <Loading />;

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = add.trim();
    if (!name) return setMsg("지역명을 입력해 주세요.");
    if (await run(() => api.post("/api/as/regions", { regionName: name }), `${name}을(를) 추가했습니다.`)) setAdd("");
  };
  const move = (i: number, d: number) => {
    const ids = list.map((r) => r.regionId);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    run(() => api.put("/api/as/regions/order", ids), "순서를 바꿨습니다.");
  };
  const askDelete = (r: RegionUsage) => {
    if (r.schools || r.users) {
      setDel(null);
      return setMsg(`${r.regionName}: 소속 기관 ${r.schools}곳, 담당자 ${r.users}명을 다른 지역으로 옮긴 뒤 삭제할 수 있습니다.`);
    }
    setMsg("");
    setDel(r);
  };

  return (
    <>
      <p className="hint rg-note">지역 순서는 문의처 안내, 업체관리 등 모든 화면의 지역 목록에 그대로 쓰입니다.</p>
      <form className="rg-add" onSubmit={create}>
        <input aria-label="새 지역명" placeholder="새 지역명 (예: 천안교육지원청)" value={add} onChange={(e) => setAdd(e.target.value)} />
        <button type="submit" className="btn sm" disabled={busy}>지역 추가</button>
      </form>
      <FormMsg kind={msg ? "bad" : undefined} text={msg} />
      <div className="tw">
        <table className="cards rg-tb">
          <thead><tr>{["순서", "지역명", "기관", "담당자", "담당 업체", "관리"].map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>
            {list.length ? list.map((r, i) => {
              const changed = names[r.regionId]?.trim() && names[r.regionId].trim() !== r.regionName;
              return (
                <tr key={r.regionId}>
                  <td data-label="순서" className="rg-move">
                    <button type="button" className="btn sm sec" aria-label={`${r.regionName} 위로`} disabled={busy || i === 0} onClick={() => move(i, -1)}>▲</button>
                    <button type="button" className="btn sm sec" aria-label={`${r.regionName} 아래로`} disabled={busy || i === list.length - 1} onClick={() => move(i, 1)}>▼</button>
                  </td>
                  <td data-label="지역명"><input aria-label={`${r.regionName} 지역명`} value={names[r.regionId] ?? ""} onChange={(e) => setNames({ ...names, [r.regionId]: e.target.value })} /></td>
                  <td data-label="기관">{r.schools}</td>
                  <td data-label="담당자">{r.users}</td>
                  <td data-label="담당 업체">{r.vendors}</td>
                  <td data-label="관리" className="rg-act">
                    <button type="button" className="btn sm sec" disabled={busy || !changed}
                      onClick={() => run(() => api.put(`/api/as/regions/${r.regionId}`, { regionName: names[r.regionId].trim() }), "지역명을 저장했습니다.")}>저장</button>
                    <button type="button" className="btn sm sec" disabled={busy} onClick={() => askDelete(r)}>삭제</button>
                  </td>
                </tr>
              );
            }) : <tr><td colSpan={6}>등록된 지역이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      {del && (
        <Modal title="지역 삭제" onClose={() => setDel(null)}>
          <Confirm
            text={`${del.regionName}을(를) 삭제할까요?${del.vendors ? ` 업체 ${del.vendors}곳의 담당 지역에서 빠집니다.` : ""} 문의처 안내의 내용은 그대로 남습니다.`}
            busy={busy}
            onNo={() => setDel(null)}
            onYes={async () => {
              const d = del;
              if (await run(() => api.del(`/api/as/regions/${d.regionId}`), `${d.regionName}을(를) 삭제했습니다.`)) setDel(null);
              else setDel(null);
            }}
          />
        </Modal>
      )}
    </>
  );
}
