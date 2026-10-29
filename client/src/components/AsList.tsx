"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, type Page } from "@/lib/api";
import { AS_NAME, AS_REQUEST_HREF, AS_REQUEST_PERM, useAsTypes } from "@/lib/as";
import { useAuth } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import type { AsRow, AsStatus, RceptTy } from "@/lib/types";
import AsDetailModal from "./AsDetailModal";
import { AsBadge, ErrorBox, Icon, Loading, NoticeBox, Pager, useToast } from "./ui";

const STATUSES: [AsStatus | "", string][] = [["", "전체"], ["A", "신청완료"], ["R", "접수완료"], ["C", "처리완료"], ["X", "반려"]];
const PAGE_SIZE = 10;

interface Filter {
  rceptTy: string;
  searchType: string;
  keyword: string;
  fromDate: string;
  toDate: string;
  status: string;
  unassigned: boolean;
}

/**
 * AS 결과조회 (GET /api/as/requests). With `ty` it lists one type (school/engineer menus);
 * without it (장애접수관리) it lists every type with a type filter.
 */
export default function AsList({ ty }: { ty?: RceptTy }) {
  const toast = useToast();
  const { can } = useAuth();
  const asTypes = useAsTypes();
  const empty: Filter = { rceptTy: ty ?? "", searchType: "", keyword: "", fromDate: "", toDate: "", status: "", unassigned: false };
  const [draft, setDraft] = useState<Filter>(empty);
  const [filter, setFilter] = useState<Filter>(empty);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<AsRow> | null>(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<number | null>(null);

  const query = useCallback(
    (f: Filter) => ({
      rceptTy: f.rceptTy, status: f.status, keyword: f.keyword.trim(), searchType: f.keyword.trim() ? f.searchType : "",
      fromDate: f.fromDate, toDate: f.toDate, unassigned: f.unassigned || undefined,
    }),
    [],
  );

  const load = useCallback(() => {
    setErr("");
    api.get<Page<AsRow>>("/api/as/requests", { ...query(filter), page, size: PAGE_SIZE }).then(setData).catch((e) => setErr(e.message));
  }, [filter, page, query]);
  useEffect(load, [load]);

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    if (draft.fromDate && draft.toDate && draft.fromDate > draft.toDate) return toast("신청일자 시작이 끝보다 늦습니다.");
    setFilter(draft);
    setPage(1);
  };

  const excel = () =>
    api.download("/api/as/requests/excel", query(filter), `AS결과조회_${ty ? AS_NAME[ty] : "전체"}.xlsx`).catch((e) => toast(e.message));

  const sn = ty === "S";
  const head = sn
    ? ["번호", "학교명", "대상장비", "신청일자", "신청자", "방문요청일", "상태", "보고서"]
    : ["번호", ...(ty ? [] : ["구분"]), "학교명", "신청자", "신청일자", "처리일자", "업체", "상태", "보고서"];

  return (
    <>
      {ty === "C" && (
        <NoticeBox>
          <p>■ 2026학년도 학교 정보화기기 유지관리 표준 계약 체결 학교만 사용이 가능합니다.</p>
          <p>※ 표준계약 미체결 학교는 계약 정보 미등록으로 AS신청 및 문자전송 불가</p>
          <p>■ 원클릭AS시스템에서 발송되는 문자번호: ☎041-640-7114 (충청남도교육청)</p>
          <p className="hl">• 신청하신 유지관리 서비스에 대한 사항은 [신청문자]내의 신청자 연락처, [접수문자]내의 유지관리요원 연락처로 연락하시기 바랍니다.</p>
        </NoticeBox>
      )}
      <form className="lsf" role="search" onSubmit={search}>
        <table className="ftb">
          <tbody>
            <tr>
              {!ty && (
                <>
                  <th scope="row">구분</th>
                  <td>
                    <select aria-label="구분" value={draft.rceptTy} onChange={(e) => setDraft({ ...draft, rceptTy: e.target.value })}>
                      <option value="">전체</option>
                      {asTypes.map((t) => <option key={t} value={t}>{AS_NAME[t]}</option>)}
                    </select>
                  </td>
                </>
              )}
              <th scope="row">검색조건</th>
              <td>
                <select aria-label="검색조건" value={draft.searchType} onChange={(e) => setDraft({ ...draft, searchType: e.target.value })}>
                  <option value="">선택</option><option value="school">학교명</option><option value="applicant">신청자</option><option value="region">지역</option>
                </select>{" "}
                <input aria-label="검색어" value={draft.keyword} onChange={(e) => setDraft({ ...draft, keyword: e.target.value })} />
              </td>
              <th scope="row">신청일자</th>
              <td>
                <input type="date" aria-label="신청일자 시작" value={draft.fromDate} onChange={(e) => setDraft({ ...draft, fromDate: e.target.value })} /> ~{" "}
                <input type="date" aria-label="신청일자 끝" value={draft.toDate} onChange={(e) => setDraft({ ...draft, toDate: e.target.value })} />
              </td>
              <th scope="row">처리상태</th>
              <td>
                <select aria-label="처리상태" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                  {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                {!ty && (
                  <label style={{ marginLeft: 8 }}><input type="checkbox" checked={draft.unassigned} onChange={(e) => setDraft({ ...draft, unassigned: e.target.checked })} /> 미배정만</label>
                )}
              </td>
            </tr>
          </tbody>
        </table>
        <div className="btns">
          <button className="btn dk sm" type="submit">검색</button>{" "}
          <button className="btn sky sm" type="button" onClick={excel} disabled={!data?.totalElements}>엑셀출력 <Icon name="down" /></button>
        </div>
      </form>

      {err ? <ErrorBox message={err} onRetry={load} /> : !data ? <Loading /> : (
        <>
          <p className="tot" role="status">
            <span>Total {data.totalElements.toLocaleString()}건</span>
            <span>페이지 {data.page} / {Math.max(1, data.totalPages)}</span>
          </p>
          <div className="tw">
            <table className="cards" style={{ minWidth: 680 }}>
              <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
              <tbody>
                {data.content.length ? data.content.map((r, i) => {
                  const no = data.totalElements - (data.page - 1) * data.size - i;
                  const cells: React.ReactNode[] = sn
                    ? [no, r.schoolName, r.deviceName ?? "-", fmtDate(r.requestAt), r.applicantName, fmtDate(r.visitRequestAt)]
                    : [no, ...(ty ? [] : [r.rceptTyName]), r.schoolName, r.applicantName, fmtDate(r.requestAt), r.status === "C" ? fmtDate(r.completedAt) : "-", r.vendorName ?? "-"];
                  return (
                    <tr key={r.asvcSn}>
                      {cells.map((c, j) => <td key={j} data-label={head[j]}>{c ?? "-"}</td>)}
                      <td data-label="상태"><AsBadge status={r.status} name={r.statusName} /></td>
                      <td data-label="보고서"><button className="btn bl sm" type="button" onClick={() => setOpen(r.asvcSn)}>{r.hasReport ? "보고서 확인" : "상세 보기"}</button></td>
                    </tr>
                  );
                }) : (
                  <tr><td colSpan={head.length}>조회된 내용이 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="btns">
            {ty && can(AS_REQUEST_PERM[ty]) && <Link className="btn bl sm" href={AS_REQUEST_HREF[ty]}>AS 신청</Link>}
          </div>
          <Pager page={data.page} totalPages={data.totalPages} onPage={setPage} />
        </>
      )}
      {open !== null && <AsDetailModal sn={open} onClose={() => setOpen(null)} onChanged={load} />}
    </>
  );
}
