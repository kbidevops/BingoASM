"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { Confirm } from "@/components/admin/common";
import SubPage from "@/components/SubPage";
import { ErrorBox, FormMsg, FormRow, Loading, Modal, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import type { Vendor } from "@/lib/admin";
import { AS_NAME, useAsTypes } from "@/lib/as";
import { loadRegions } from "@/lib/boards";
import type { RceptTy, Region } from "@/lib/types";

/**
 * 계약·예산 관리: 유지보수 계약(정액)과 연간 AS 예산. AS비용 통계의 실제 지출(계약 배분 + 유상 지급)과 집행률이 이 값으로 계산된다.
 * 도교육청 관리자만.
 */
export default function CostsPage() {
  return (
    <Suspense>
      <SubPage perm="COST_MANAGE">
        <Costs />
      </SubPage>
    </Suspense>
  );
}

interface Contract {
  contractId: number;
  contractName: string;
  vendorId: number;
  vendorName: string;
  startDate: string;
  endDate: string;
  amount: number;
  serviceTypes: RceptTy[];
  serviceTypeNames: string[];
  allRegions: boolean;
  regions: Region[];
  note?: string;
}

interface Budget { regionId?: number | null; rceptTy?: RceptTy | null; amount: number; note?: string }

/** "1234567" → "1,234,567" while typing; digits only. */
const money = (s: string) => { const d = s.replace(/\D/g, "").replace(/^0+(?=\d)/, ""); return d ? Number(d).toLocaleString() : ""; };
const digits = (s: string) => Number(s.replace(/\D/g, "") || 0);
const short = (n: string) => n.replace(/교육지원청$/, "");

/** One figure in a tab's summary bar. */
function Stat({ label, value, unit, muted }: { label: string; value: React.ReactNode; unit?: string; muted?: boolean }) {
  return (
    <div className={"cst-stat" + (muted ? " muted" : "")}>
      <span>{label}</span>
      <b>{value}{unit && <small>{unit}</small>}</b>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="cst-note"><span aria-hidden="true">i</span><span>{children}</span></p>;
}

function Costs() {
  const params = useSearchParams();
  const [tab, setTab] = useState<"contract" | "budget">(params.get("tab") === "budget" ? "budget" : "contract");
  return (
    <>
      <div className="tabs" role="tablist" aria-label="계약·예산">
        {([["contract", "유지보수 계약"], ["budget", "연간 예산"]] as const).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === "contract" ? <Contracts /> : <Budgets />}
    </>
  );
}

function Contracts() {
  const toast = useToast();
  const [list, setList] = useState<Contract[] | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [err, setErr] = useState("");
  const [edit, setEdit] = useState<Contract | "new" | null>(null);
  const [del, setDel] = useState<Contract | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    setErr("");
    api.get<Contract[]>("/api/as/cost/contracts").then(setList).catch((e) => setErr(e.message));
  }, []);
  useEffect(() => {
    load();
    api.get<Vendor[]>("/api/as/vendors").then(setVendors).catch(() => {});
    loadRegions().then(setRegions).catch(() => {});
  }, [load]);

  if (err) return <ErrorBox message={err} onRetry={load} />;
  if (!list) return <Loading />;

  const today = new Date().toISOString().slice(0, 10);
  const remove = async () => {
    if (!del) return;
    setBusy(true);
    try {
      await api.del(`/api/as/cost/contracts/${del.contractId}`);
      toast("계약을 삭제했습니다.");
      setDel(null);
      load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const active = list.filter((c) => c.startDate <= today && c.endDate >= today);
  return (
    <>
      <div className="cst-bar">
        <div className="cst-stats">
          <Stat label="등록된 계약" value={list.length.toLocaleString()} unit="건" />
          <Stat label="진행 중" value={active.length.toLocaleString()} unit="건" />
          <Stat label="진행 중 계약 금액" value={active.reduce((n, c) => n + c.amount, 0).toLocaleString()} unit="원" muted={!active.length} />
        </div>
        <div className="cst-act">
          <button type="button" className="btn sm" onClick={() => setEdit("new")}>+ 계약 등록</button>
        </div>
      </div>
      <Note>
        업체와 맺은 정액 유지보수 계약을 넣습니다. 금액은 계약 기간의 일수로 나눠 <Link href="/admin/stats">AS비용 통계</Link>의 실제 지출에 배분됩니다.
      </Note>
      <FormMsg kind={msg ? "bad" : undefined} text={msg} />
      <div className="tw">
        <table className="cards">
          <thead><tr>{["계약명", "업체", "구분", "지역", "계약 기간", "계약 금액(원)", "관리"].map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>
            {list.length ? list.map((c) => {
              const state = c.endDate < today ? "종료" : c.startDate > today ? "예정" : "진행 중";
              return (
                <tr key={c.contractId}>
                  <td data-label="계약명" className="tl">{c.contractName}{c.note && <><br /><small className="hint">{c.note}</small></>}</td>
                  <td data-label="업체">{c.vendorName}</td>
                  <td data-label="구분">{c.serviceTypeNames.join(", ")}</td>
                  <td data-label="지역">{c.allRegions ? "전체" : c.regions.map((r) => short(r.regionName)).join(", ")}</td>
                  <td data-label="계약 기간">{c.startDate} ~ {c.endDate} <small className={"ct-st" + (state === "진행 중" ? " on" : "")}>{state}</small></td>
                  <td data-label="계약 금액(원)" className="num">{c.amount.toLocaleString()}</td>
                  <td data-label="관리" className="rg-act">
                    <button type="button" className="btn sm sec" onClick={() => setEdit(c)}>수정</button>
                    <button type="button" className="btn sm sec" onClick={() => { setMsg(""); setDel(c); }}>삭제</button>
                  </td>
                </tr>
              );
            }) : <tr><td colSpan={7}>등록된 계약이 없습니다. 업체와 맺은 유지보수 계약을 등록하면 AS 비용 통계에 실제 지출이 나옵니다.</td></tr>}
          </tbody>
        </table>
      </div>
      {edit && (
        <ContractForm contract={edit === "new" ? null : edit} vendors={vendors} regions={regions}
          onClose={() => setEdit(null)} onSaved={(m) => { setEdit(null); toast(m); load(); }} />
      )}
      {del && (
        <Modal title="계약 삭제" onClose={() => setDel(null)}>
          <Confirm text={`${del.contractName}을(를) 삭제할까요? AS 비용 통계의 실제 지출에서 이 계약 금액이 빠집니다.`} busy={busy} onYes={remove} onNo={() => setDel(null)} />
        </Modal>
      )}
    </>
  );
}

function ContractForm({ contract, vendors, regions, onClose, onSaved }: {
  contract: Contract | null; vendors: Vendor[]; regions: Region[]; onClose: () => void; onSaved: (m: string) => void;
}) {
  const TYPES = useAsTypes();
  const year = new Date().getFullYear();
  const [v, setV] = useState({
    vendorId: contract ? String(contract.vendorId) : "",
    contractName: contract?.contractName ?? "",
    startDate: contract?.startDate ?? `${year}-01-01`,
    endDate: contract?.endDate ?? `${year}-12-31`,
    amount: contract ? contract.amount.toLocaleString() : "",
    serviceTypes: contract?.serviceTypes ?? ([] as RceptTy[]),
    allRegions: contract?.allRegions ?? true,
    note: contract?.note ?? "",
  });
  const [picked, setPicked] = useState<number[]>(() => (contract?.regions ?? []).map((r) => r.regionId));
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const vendor = vendors.find((x) => String(x.vendorId) === v.vendorId);
  // 삭제된 업체의 지난 계약도 고칠 수 있게 목록에 넣어 둔다.
  const vendorOptions = contract && !vendors.some((x) => x.vendorId === contract.vendorId)
    ? [{ vendorId: contract.vendorId, vendorName: contract.vendorName }, ...vendors] : vendors;
  // 삭제된 지역이 들어 있던 계약은 그 지역을 보여 준다.
  const regionOptions = [...regions, ...(contract?.regions ?? []).filter((r) => !regions.some((x) => x.regionId === r.regionId))];

  const pickVendor = (id: string) => {
    const x = vendors.find((y) => String(y.vendorId) === id);
    // 새 계약은 업체의 담당 분야·지역을 기본값으로.
    if (!contract && x) {
      setV({ ...v, vendorId: id, serviceTypes: x.serviceTypes.filter((t) => TYPES.includes(t as RceptTy)) as RceptTy[], allRegions: x.allRegions });
      setPicked(x.regions.map((r) => r.regionId));
    } else setV({ ...v, vendorId: id });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.vendorId) return setMsg("업체를 선택해 주세요.");
    if (!v.contractName.trim()) return setMsg("계약명을 입력해 주세요.");
    if (!v.startDate || !v.endDate) return setMsg("계약 기간을 입력해 주세요.");
    if (v.endDate < v.startDate) return setMsg("계약 종료일이 시작일보다 빠릅니다.");
    if (!digits(v.amount)) return setMsg("계약 금액을 입력해 주세요.");
    if (!v.serviceTypes.length) return setMsg("계약에 포함된 AS 구분을 하나 이상 선택해 주세요.");
    if (!v.allRegions && !picked.length) return setMsg("계약 지역을 하나 이상 선택해 주세요.");
    setBusy(true);
    const body = { ...v, vendorId: Number(v.vendorId), contractName: v.contractName.trim(), amount: digits(v.amount), note: v.note.trim(), regionIds: v.allRegions ? [] : picked };
    try {
      if (contract) await api.put(`/api/as/cost/contracts/${contract.contractId}`, body);
      else await api.post("/api/as/cost/contracts", body);
      onSaved(contract ? "계약을 저장했습니다." : "계약을 등록했습니다.");
    } catch (er) {
      setMsg((er as Error).message);
      setBusy(false);
    }
  };

  const days = v.startDate && v.endDate && v.endDate >= v.startDate ? (Date.parse(v.endDate) - Date.parse(v.startDate)) / 86_400_000 + 1 : 0;
  return (
    <Modal title={contract ? "계약 수정" : "계약 등록"} wide onClose={onClose}>
      <form className="ft2" noValidate onSubmit={save}>
        <table className="ftab"><tbody>
          <FormRow label="업체" required>
            <select aria-label="업체" value={v.vendorId} onChange={(e) => pickVendor(e.target.value)}>
              <option value="">-- 선택 --</option>
              {vendorOptions.map((x) => <option key={x.vendorId} value={x.vendorId}>{x.vendorName}</option>)}
            </select>
            {vendor && !contract && <small className="hint"> 업체의 담당 분야·지역을 기본값으로 넣었습니다.</small>}
          </FormRow>
          <FormRow label="계약명" required><input aria-label="계약명" maxLength={200} style={{ width: "100%" }} placeholder={`예: ${year}년 무선망 유지관리 용역`} value={v.contractName} onChange={(e) => setV({ ...v, contractName: e.target.value })} /></FormRow>
          <FormRow label="계약 기간" required>
            <span className="ct-period">
              <input type="date" aria-label="계약 시작일" value={v.startDate} onChange={(e) => setV({ ...v, startDate: e.target.value })} />
              <span aria-hidden="true">~</span>
              <input type="date" aria-label="계약 종료일" value={v.endDate} onChange={(e) => setV({ ...v, endDate: e.target.value })} />
            </span>
            {days > 0 && <small className="hint"> {days.toLocaleString()}일</small>}
          </FormRow>
          <FormRow label="계약 금액" required>
            <input aria-label="계약 금액" inputMode="numeric" className="num" value={v.amount} onChange={(e) => setV({ ...v, amount: money(e.target.value) })} /> 원
            {days > 0 && digits(v.amount) > 0 && <small className="hint"> 월 평균 약 {Math.round((digits(v.amount) / days) * 30.4).toLocaleString()}원</small>}
          </FormRow>
          <FormRow label="AS 구분" required>
            {TYPES.map((t) => (
              <label key={t} style={{ marginRight: 12 }}>
                <input type="checkbox" checked={v.serviceTypes.includes(t)}
                  onChange={(e) => setV({ ...v, serviceTypes: e.target.checked ? [...v.serviceTypes, t] : v.serviceTypes.filter((x) => x !== t) })} /> {AS_NAME[t]}
              </label>
            ))}
          </FormRow>
          <FormRow label="지역" required>
            <label className="vd-all"><input type="checkbox" checked={v.allRegions} onChange={(e) => setV({ ...v, allRegions: e.target.checked })} /> 전체 지역</label>
            {!v.allRegions && (
              <div className="vd-pick">
                {regionOptions.map((r) => (
                  <label key={r.regionId}>
                    <input type="checkbox" checked={picked.includes(r.regionId)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, r.regionId] : p.filter((x) => x !== r.regionId)))} /> {short(r.regionName)}
                  </label>
                ))}
              </div>
            )}
            <small className="hint">지역별로 볼 때는 계약 금액을 맡은 지역 수로 똑같이 나눕니다.</small>
          </FormRow>
          <FormRow label="메모"><input aria-label="메모" maxLength={1000} style={{ width: "100%" }} placeholder="계약번호, 담당자 등" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></FormRow>
        </tbody></table>
        <FormMsg kind={msg ? "bad" : undefined} text={msg} />
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <button type="button" className="btn sm sec" onClick={onClose}>취소</button>
          <button type="submit" className="btn sm" disabled={busy}>{busy ? "저장 중…" : "저장"}</button>
        </div>
      </form>
    </Modal>
  );
}

interface BudgetLine { regionId: string; rceptTy: string; amount: string; note: string }

function Budgets() {
  const toast = useToast();
  const TYPES = useAsTypes();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [regions, setRegions] = useState<Region[]>([]);
  const [lines, setLines] = useState<BudgetLine[] | null>(null);
  const [saved, setSaved] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setErr("");
    setLines(null);
    api.get<(Budget & { regionName: string })[]>("/api/as/cost/budgets", { year }).then((d) => {
      // 전체 지역 → 지역 순, 같은 지역 안에서는 전체 구분 → C·M·S·T 순.
      const tyOrder = (t?: string | null) => (t ? "CMST".indexOf(t) + 1 : 0);
      d.sort((a, b) => (a.regionId == null ? -1 : a.regionId) - (b.regionId == null ? -1 : b.regionId) || tyOrder(a.rceptTy) - tyOrder(b.rceptTy));
      const l = d.map((b) => ({ regionId: b.regionId == null ? "" : String(b.regionId), rceptTy: b.rceptTy ?? "", amount: b.amount.toLocaleString(), note: b.note ?? "" }));
      setLines(l);
      setSaved(JSON.stringify(l));
      // 삭제된 지역의 예산 줄도 이름이 보이게 둔다.
      loadRegions().then((rs) => setRegions([...rs, ...d.filter((b) => b.regionId != null && !rs.some((r) => r.regionId === b.regionId)).map((b) => ({ regionId: b.regionId!, regionName: b.regionName }))])).catch(() => {});
    }).catch((e) => setErr(e.message));
  }, [year]);
  useEffect(load, [load]);

  if (err) return <ErrorBox message={err} onRetry={load} />;

  const dirty = lines != null && JSON.stringify(lines) !== saved;
  const edit = (i: number, k: keyof BudgetLine, val: string) => setLines((l) => l!.map((x, j) => (j === i ? { ...x, [k]: k === "amount" ? money(val) : val } : x)));
  const total = (lines ?? []).filter((l) => !l.regionId && !l.rceptTy).reduce((n, l) => n + digits(l.amount), 0);

  const save = async () => {
    if (!lines) return;
    const keys = lines.map((l) => l.regionId + "/" + l.rceptTy);
    if (lines.some((l) => !digits(l.amount))) return setMsg("예산 금액을 입력해 주세요.");
    if (new Set(keys).size !== keys.length) return setMsg("같은 지역·구분의 예산이 두 줄 있습니다.");
    setBusy(true);
    setMsg("");
    try {
      await api.put(`/api/as/cost/budgets?year=${year}`, lines.map((l) => ({
        regionId: l.regionId ? Number(l.regionId) : null, rceptTy: l.rceptTy || null, amount: digits(l.amount), note: l.note.trim() || null,
      })));
      toast(`${year}년 예산을 저장했습니다.`);
      load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const regionLines = (lines ?? []).filter((l) => l.regionId).length;
  return (
    <>
      <div className="cst-bar">
        <div className="cst-stats">
          <label className="cst-year" htmlFor="bg-y">
            <span>연도</span>
            <select id="bg-y" value={year} onChange={(e) => setYear(Number(e.target.value))} disabled={dirty} title={dirty ? "저장하거나 되돌린 뒤 연도를 바꿀 수 있습니다" : undefined}>
              {[1, 0, -1, -2, -3].map((i) => <option key={i} value={thisYear + i}>{thisYear + i}년</option>)}
            </select>
          </label>
          <Stat label="전체 예산" value={total ? total.toLocaleString() : "미설정"} unit={total ? "원" : undefined} muted={!total} />
          <Stat label="예산 줄" value={(lines?.length ?? 0).toLocaleString()} unit={`줄 · 지역별 ${regionLines}`} />
        </div>
        <div className="cst-act">
          {dirty && <span className="cst-dirty" role="status">저장하지 않은 변경</span>}
          {dirty && <button type="button" className="btn sm sec" disabled={busy} onClick={() => { setLines(JSON.parse(saved)); setMsg(""); }}>되돌리기</button>}
          <button type="button" className="btn sm sec" disabled={!lines} onClick={() => setLines([...(lines ?? []), { regionId: "", rceptTy: "", amount: "", note: "" }])}>+ 예산 줄 추가</button>
          <button type="button" className="btn sm" disabled={!dirty || busy} onClick={save}>{busy ? "저장 중…" : "저장"}</button>
        </div>
      </div>
      <Note>
        지역·구분을 비우면 전체입니다. 집행액은 그 지역·구분의 계약 배분액과 유상 지급 완료액의 합이며, <Link href="/admin/stats">AS비용 통계</Link>에서 집행률로 보입니다.
      </Note>
      <FormMsg kind={msg ? "bad" : undefined} text={msg} />
      {!lines ? <Loading /> : (
        <div className="tw">
          <table className="cards bg-tb">
            <colgroup><col className="c-rg" /><col className="c-ty" /><col className="c-amt" /><col /><col className="c-x" /></colgroup>
            <thead><tr>{["지역", "구분", "예산(원)", "메모", ""].map((h, i) => <th key={i} scope="col">{h || <span className="sr">삭제</span>}</th>)}</tr></thead>
            <tbody>
              {lines.length ? lines.map((l, i) => (
                <tr key={i}>
                  <td data-label="지역">
                    <select aria-label={`${i + 1}번 지역`} value={l.regionId} onChange={(e) => edit(i, "regionId", e.target.value)}>
                      <option value="">전체 지역</option>
                      {regions.map((r) => <option key={r.regionId} value={r.regionId}>{r.regionName}</option>)}
                    </select>
                  </td>
                  <td data-label="구분">
                    <select aria-label={`${i + 1}번 구분`} value={l.rceptTy} onChange={(e) => edit(i, "rceptTy", e.target.value)}>
                      <option value="">전체</option>
                      {TYPES.map((t) => <option key={t} value={t}>{AS_NAME[t]}</option>)}
                    </select>
                  </td>
                  <td data-label="예산(원)">
                    <span className="cst-won"><input aria-label={`${i + 1}번 예산`} inputMode="numeric" className="num" placeholder="0" value={l.amount} onChange={(e) => edit(i, "amount", e.target.value)} /><span aria-hidden="true">원</span></span>
                  </td>
                  <td data-label="메모"><input aria-label={`${i + 1}번 메모`} maxLength={200} placeholder="예: 본예산, 추경" value={l.note} onChange={(e) => edit(i, "note", e.target.value)} /></td>
                  <td data-label="삭제" className="c-x"><button type="button" className="cst-x" aria-label={`${i + 1}번 줄 삭제`} title="줄 삭제" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button></td>
                </tr>
              )) : (
                <tr><td colSpan={5} className="cst-empty">
                  <b>{year}년 예산이 없습니다.</b>
                  <span>[+ 예산 줄 추가]로 전체 지역·전체 구분 예산부터 넣어 보세요.</span>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
