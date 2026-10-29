"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import AssetBulkModal from "@/components/admin/AssetBulkModal";
import { AssetDetailModal, AssetForm } from "@/components/admin/AssetModals";
import { FilterField, FilterForm, LabelSheet, ListHead, SchoolSelect, StatusDot, Tiles, ToolButton, usePrintSheet, useSchoolChoice } from "@/components/admin/common";
import QrScanner, { ManualEntry } from "@/components/admin/QrScanner";
import SubPage from "@/components/SubPage";
import { ErrorBox, Icon, Loading, Modal, Pager, useToast } from "@/components/ui";
import { api, type Page } from "@/lib/api";
import { ASSET_STATUSES, badgeClass, downloadCsv, label, loadCategories, type Asset, type Category, type Label, type Room } from "@/lib/admin";
import { useAuth } from "@/lib/auth";
import { fmtDate } from "@/lib/format";

/** 기관자산관리: 자산 목록 · 등록/수정 · QR 스캔 · QR 라벨 · 미등록 라벨 · 엑셀 일괄 등록. */
export default function AssetsPage() {
  return (
    <Suspense>
      <SubPage perm="ASSET_READ">
        <Assets />
      </SubPage>
    </Suspense>
  );
}

type Resolve = { type: string; state?: string; assetId?: number; assetNo?: string; roomId?: number; token?: string; message?: string; schoolId?: number };

function Assets() {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const { can } = useAuth();
  const { schools, schoolId, setSchoolId, fixed, err: schoolErr } = useSchoolChoice();
  const [allSchools, setAllSchools] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const empty = { categoryId: "", keyword: "", roomId: "" };
  const [draft, setDraft] = useState(empty);
  const [filter, setFilter] = useState(empty);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [data, setData] = useState<Page<Asset> | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [detail, setDetail] = useState<number | null>(null);
  const [form, setForm] = useState<Partial<Asset> | null>(null);
  const [scan, setScan] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [reserve, setReserve] = useState(false);
  const { print, sheet } = usePrintSheet();
  const sid = allSchools ? undefined : schoolId ?? undefined;

  useEffect(() => {
    loadCategories().then(setCategories).catch(() => {});
  }, []);
  useEffect(() => {
    if (!schoolId) return;
    api.get<Room[]>("/api/as/spaces/rooms", { schoolId }).then(setRooms).catch(() => setRooms([]));
  }, [schoolId]);

  const load = useCallback(() => {
    if (!fixed && !allSchools && !schoolId) return;
    setErr("");
    const q = { schoolId: sid, categoryId: filter.categoryId, keyword: filter.keyword.trim(), roomId: filter.roomId };
    api.get<Page<Asset>>("/api/assets", { ...q, status, page, size, sort: "assetNo" }).then(setData).catch((e) => setErr(e.message));
    // Tile counts for the same filter, one cheap query per status.
    Promise.all(["", ...ASSET_STATUSES.map((s) => s[0])].map((st) =>
      api.get<Page<Asset>>("/api/assets", { ...q, status: st, size: 1 }).then((p) => [st, p.totalElements] as const)))
      .then((list) => setCounts(Object.fromEntries(list))).catch(() => {});
  }, [sid, filter, status, page, size, fixed, allSchools, schoolId]);
  useEffect(load, [load]);

  /** A scanned or typed QR / asset number → detail, registration, or room. */
  const handleText = useCallback(async (text: string) => {
    try {
      const r = await api.post<Resolve>("/api/qr/resolve", { text });
      setScan(false);
      if (r.type === "ASSET" && r.state === "REGISTERED" && r.assetId) setDetail(r.assetId);
      else if (r.type === "ASSET") {
        if (!can("ASSET_WRITE")) return toast(r.message ?? "등록되지 않은 자산입니다.");
        toast(r.message ?? "등록되지 않은 번호입니다. 이 번호로 자산을 등록하세요.");
        setForm({ assetNo: r.assetNo, schoolId: r.schoolId ?? schoolId ?? undefined });
      } else if (r.type === "ROOM" && r.roomId) router.push(`/admin/floorplan?room=${r.roomId}`);
      else if (r.type === "LOGIN" && r.token) router.push(`/login/qr-approve?t=${encodeURIComponent(r.token)}`);
      else toast(r.message ?? "원클릭AS QR이 아닙니다.");
    } catch (e) {
      toast((e as Error).message);
    }
  }, [can, router, schoolId, toast]);

  // Label QR → /a/{no} → /admin/assets?no={no}
  const no = params.get("no");
  useEffect(() => {
    if (no) handleText(no);
  }, [no, handleText]);

  const printLabels = async (assetIds: number[]) => {
    if (!assetIds.length) return toast("라벨을 출력할 자산을 선택해 주세요.");
    try {
      const labels = await api.post<Label[]>("/api/qr/labels", { assetIds });
      if (assetIds.length > 60) toast("한 번에 60장까지 출력합니다. 앞 60건만 담았습니다.");
      print(<LabelSheet labels={labels} />);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  if (schoolErr) return <ErrorBox message={schoolErr} />;
  const roomMap = new Map(rooms.map((r) => [r.roomId, r]));
  const where = (a: Asset) => (a.roomId && roomMap.get(a.roomId)?.fullName) || [a.buildingName, a.floorName, a.locationDetail].filter(Boolean).join(" ") || "위치 미지정";
  const schoolName = (id?: number) => schools.find((s) => s.schoolId === id)?.schoolName ?? "-";
  const head = ["", "자산번호", "기관", "분류", "품명·규격", "취득일", "내용연수", "위치", "상태", "관리"];
  const allOnPage = !!data?.content.length && data.content.every((a) => sel.has(a.assetId));

  return (
    <>
      <div className="pl-top">
        <SchoolSelect schools={schools} value={schoolId} fixed={fixed} onChange={(id) => { setSchoolId(id); setAllSchools(false); setPage(1); setSel(new Set()); setFilter({ ...filter, roomId: "" }); setDraft({ ...draft, roomId: "" }); }} />
        {!fixed && <label><input type="checkbox" checked={allSchools} onChange={(e) => { setAllSchools(e.target.checked); setPage(1); }} /> 전체 기관 보기</label>}
      </div>
      <div className="atool">
        <ToolButton icon={<Icon name="search" />} label="QR 스캔" onClick={() => setScan(true)} />
        {can("ASSET_WRITE") && <ToolButton icon={<Icon name="pen" />} label="자산 등록" onClick={() => setForm({ schoolId: schoolId ?? undefined })} />}
        {can("ASSET_BULK") && <ToolButton icon={<Icon name="inbox" />} label="엑셀 일괄 등록" onClick={() => setBulk(true)} />}
        <ToolButton icon={<Icon name="print" />} label={`QR 라벨 출력${sel.size ? ` (${sel.size})` : ""}`} onClick={() => printLabels([...sel])} />
        {can("ASSET_WRITE") && <ToolButton icon={<Icon name="report" />} label="미등록 라벨 발급" onClick={() => setReserve(true)} />}
        <ToolButton icon={<Icon name="school" />} label="도면에서 위치 보기" href="/admin/floorplan" />
      </div>
      <Tiles
        tiles={[
          { label: "전체 자산", value: counts[""] ?? 0, unit: "대", pick: "" },
          ...ASSET_STATUSES.map(([c, n, cls]) => ({ label: c === "DISPOSE_PLANNED" ? "내용연수 경과(불용예정)" : n, value: counts[c] ?? 0, unit: "대", cls: cls.replace("s", "c"), pick: c })),
        ]}
        active={status}
        onPick={(v) => { setStatus(v); setPage(1); }}
      />
      <FilterForm onSubmit={() => { setFilter(draft); setPage(1); }} onReset={() => { setDraft(empty); setFilter(empty); setStatus(""); setPage(1); }}>
        <FilterField id="as-cat" label="분류">
          <select id="as-cat" value={draft.categoryId} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}>
            <option value="">전체</option>
            {categories.filter((c) => c.assetType === "HW").map((c) => <option key={c.categoryId} value={c.categoryId}>{c.categoryName}</option>)}
          </select>
        </FilterField>
        {!allSchools && (
          <FilterField id="as-room" label="위치(실)">
            <select id="as-room" value={draft.roomId} onChange={(e) => setDraft({ ...draft, roomId: e.target.value })}>
              <option value="">전체</option>
              {rooms.map((r) => <option key={r.roomId} value={r.roomId}>{r.fullName}</option>)}
            </select>
          </FilterField>
        )}
        <FilterField id="as-q" label="검색어">
          <input id="as-q" placeholder="자산번호·품명·모델·시리얼" value={draft.keyword} onChange={(e) => setDraft({ ...draft, keyword: e.target.value })} />
        </FilterField>
      </FilterForm>

      {err ? <ErrorBox message={err} onRetry={load} /> : !data ? <Loading /> : (
        <>
          <ListHead total={data.totalElements} page={data.page} pages={data.totalPages}>
            <select aria-label="페이지당 건수" value={size} onChange={(e) => { setSize(+e.target.value); setPage(1); }}>
              {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}건씩</option>)}
            </select>
            <button className="btn sm sec" type="button" disabled={!data.content.length}
              onClick={() => downloadCsv("기관자산관리", head.slice(1, -1), data.content.map((a) => [a.assetNo, schoolName(a.schoolId), a.categoryName, a.assetName, fmtDate(a.acquiredAt), a.lifeYears ? a.lifeYears + "년" : "", where(a), label(ASSET_STATUSES, a.status)]))}>
              엑셀출력 <Icon name="down" />
            </button>
          </ListHead>
          <div className="tw">
            <table className="cards" style={{ minWidth: 960 }}>
              <thead>
                <tr>
                  <th scope="col"><input type="checkbox" aria-label="이 페이지 모두 선택" checked={allOnPage}
                    onChange={(e) => setSel((s) => { const n = new Set(s); data.content.forEach((a) => (e.target.checked ? n.add(a.assetId) : n.delete(a.assetId))); return n; })} /></th>
                  {head.slice(1).map((h) => <th key={h} scope="col">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.content.length ? data.content.map((a) => (
                  <tr key={a.assetId}>
                    <td><input type="checkbox" aria-label={`${a.assetNo} 선택`} checked={sel.has(a.assetId)}
                      onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(a.assetId); else n.delete(a.assetId); return n; })} /></td>
                    <td data-label="자산번호"><button type="button" className="linkbtn" onClick={() => setDetail(a.assetId)}>{a.assetNo}</button></td>
                    <td data-label="기관">{schoolName(a.schoolId)}</td>
                    <td data-label="분류">{a.categoryName ?? "-"}</td>
                    <td data-label="품명·규격" className="tl">{a.assetName}{a.modelName && <small className="hint"> {a.modelName}</small>}</td>
                    <td data-label="취득일">{fmtDate(a.acquiredAt)}</td>
                    <td data-label="내용연수">{a.lifeYears ? `${a.lifeYears}년` : "-"}{a.lifeExceeded && <><br /><small style={{ color: "var(--err)" }}>경과</small></>}</td>
                    <td data-label="위치" className="tl"><small>{where(a)}</small></td>
                    <td data-label="상태"><StatusDot cls={badgeClass(ASSET_STATUSES, a.status)} name={label(ASSET_STATUSES, a.status)} /></td>
                    <td data-label="관리" style={{ whiteSpace: "nowrap" }}>
                      {can("ASSET_WRITE") && <button className="btn sm sec" type="button" onClick={() => setForm(a)}>수정</button>}{" "}
                      <button className="btn sm sec" type="button" onClick={() => printLabels([a.assetId])}>라벨</button>
                    </td>
                  </tr>
                )) : <tr><td colSpan={head.length}>조회된 자산이 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} totalPages={data.totalPages} onPage={setPage} />
        </>
      )}

      {detail !== null && (
        <AssetDetailModal assetId={detail} rooms={rooms} schoolName={schoolName} onClose={() => { setDetail(null); if (no) router.replace("/admin/assets"); }}
          onEdit={(a) => { setDetail(null); setForm(a); }} onPrint={(id) => printLabels([id])} />
      )}
      {form && (
        <AssetForm asset={form} schools={schools} fixedSchool={fixed} categories={categories} onClose={() => setForm(null)}
          onSaved={(m) => { setForm(null); toast(m); load(); }} />
      )}
      {scan && (
        <Modal title="자산 QR 스캔" onClose={() => setScan(false)}>
          <QrScanner onText={handleText} />
          <ManualEntry onSubmit={handleText} />
          <p className="hint scan-tip">자산 라벨의 QR을 화면 가운데에 맞추세요. 실 QR을 찍으면 도면 화면으로, 로그인 QR이면 승인 화면으로 이동합니다.</p>
        </Modal>
      )}
      {bulk && <AssetBulkModal onClose={() => setBulk(false)} onDone={(m) => { toast(m); load(); }} />}
      {reserve && (
        <ReserveModal schoolId={schoolId} onClose={() => setReserve(false)} onLabels={(labels) => { setReserve(false); print(<LabelSheet labels={labels} />); }} />
      )}
      {sheet}
    </>
  );
}

/** 미등록 라벨: reserve asset numbers, print their QR labels, register the asset later by scanning one. */
function ReserveModal({ schoolId, onClose, onLabels }: { schoolId: number | null; onClose: () => void; onLabels: (l: Label[]) => void }) {
  const [count, setCount] = useState("12");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(count);
    if (!(n >= 1 && n <= 60)) return setMsg("1~60장 사이로 입력해 주세요.");
    setBusy(true);
    try {
      onLabels(await api.post<Label[]>("/api/qr/reserve", { count: n, schoolId }));
    } catch (er) {
      setMsg((er as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal title="미등록 라벨 발급" onClose={onClose}>
      <form onSubmit={submit}>
        <p>자산번호를 미리 받아 QR 라벨을 먼저 출력합니다. 장비에 라벨을 붙인 뒤 <b>QR 스캔</b>으로 찍으면 그 번호로 자산을 등록할 수 있습니다.</p>
        <label>발급 장수 <input type="number" min={1} max={60} value={count} onChange={(e) => setCount(e.target.value)} style={{ width: 90 }} /> 장 (A4 한 장 = 24장)</label>
        <p className={"msg" + (msg ? " bad" : "")} role="status">{msg}</p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="btn sm sec" onClick={onClose}>취소</button>
          <button type="submit" className="btn sm" disabled={busy}>{busy ? "발급 중…" : "발급하고 인쇄"}</button>
        </div>
      </form>
    </Modal>
  );
}
