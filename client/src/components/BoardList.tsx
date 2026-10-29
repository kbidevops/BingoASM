"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, type Page } from "@/lib/api";
import { FIELDS, loadBoards, loadRegions, POST_STATUSES, type BoardSlug } from "@/lib/boards";
import { fmtDate } from "@/lib/format";
import type { BoardInfo, PostRow, Region } from "@/lib/types";
import { ErrorBox, Icon, Loading, Pager, PostBadge } from "./ui";

interface Filter {
  searchType: string;
  keyword: string;
  categoryCode: string;
  fieldCode: string;
  regionId: string;
  status: string;
}

/** 게시판 목록 (GET /api/as/boards/{code}). Columns follow the board's options. */
export default function BoardList({ slug }: { slug: BoardSlug }) {
  const code = slug.toUpperCase();
  const [board, setBoard] = useState<BoardInfo | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const empty: Filter = { searchType: "title", keyword: "", categoryCode: "", fieldCode: "", regionId: "", status: "" };
  const [draft, setDraft] = useState(empty);
  const [filter, setFilter] = useState(empty);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [data, setData] = useState<Page<PostRow> | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    loadBoards().then((bs) => setBoard(bs.find((b) => b.code === code) ?? null)).catch((e) => setErr(e.message));
  }, [code]);
  useEffect(() => {
    if (board?.hasRegion) loadRegions().then(setRegions).catch(() => {});
  }, [board]);

  const load = useCallback(() => {
    setErr("");
    api.get<Page<PostRow>>(`/api/as/boards/${code}`, { ...filter, keyword: filter.keyword.trim(), page, size }).then(setData).catch((e) => setErr(e.message));
  }, [code, filter, page, size]);
  useEffect(load, [load]);

  if (err) return <ErrorBox message={err} onRetry={load} />;
  if (!board || !data) return <Loading />;

  const cols = ["번호", "제목", "작성자", "등록일", "조회수"];
  if (board.categories.length) cols.push("분류");
  if (board.hasField) cols.push("분야");
  if (board.hasRegion) cols.push("지역");
  if (board.hasStatus) cols.push("상태");

  return (
    <>
      <div className="bar">
        <label>페이징 옵션{" "}
          <select value={size} onChange={(e) => { setSize(+e.target.value); setPage(1); }}>
            {[10, 20, 30, 50, 100].map((n) => <option key={n} value={n}>{n} 건</option>)}
          </select>
        </label>
        <form role="search" onSubmit={(e) => { e.preventDefault(); setFilter(draft); setPage(1); }}>
          {board.categories.length > 0 && (
            <select aria-label="분류" value={draft.categoryCode} onChange={(e) => setDraft({ ...draft, categoryCode: e.target.value })}>
              <option value="">분류 전체</option>
              {board.categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}{" "}
          {board.hasField && (
            <select aria-label="분야" value={draft.fieldCode} onChange={(e) => setDraft({ ...draft, fieldCode: e.target.value })}>
              <option value="">분야 전체</option>
              {FIELDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          )}{" "}
          {board.hasRegion && (
            <select aria-label="지역" value={draft.regionId} onChange={(e) => setDraft({ ...draft, regionId: e.target.value })}>
              <option value="">지역 전체</option>
              {regions.map((r) => <option key={r.regionId} value={r.regionId}>{r.regionName}</option>)}
            </select>
          )}{" "}
          {board.hasStatus && (
            <select aria-label="상태" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
              <option value="">상태 전체</option>
              {POST_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          )}{" "}
          <select aria-label="검색 항목" value={draft.searchType} onChange={(e) => setDraft({ ...draft, searchType: e.target.value })}>
            <option value="title">제목</option><option value="content">내용</option><option value="author">작성자</option>
          </select>{" "}
          <input aria-label="검색어" placeholder="검색어 입력" value={draft.keyword} onChange={(e) => setDraft({ ...draft, keyword: e.target.value })} />{" "}
          <button className="btn ghost" type="submit">검색</button>
        </form>
      </div>
      <p style={{ margin: "6px 0" }}>전체 <b>{data.totalElements.toLocaleString()}</b> 건 · 페이지 <b>{data.page}</b>/{Math.max(1, data.totalPages)}</p>
      <div className="tw">
        <table className="cards" style={{ minWidth: 640 }}>
          <thead><tr>{cols.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
          <tbody>
            {data.content.length ? data.content.map((p, i) => (
              <tr key={p.postId}>
                <td data-label="번호">{data.totalElements - (data.page - 1) * data.size - i}</td>
                <td data-label="제목" className="tl">
                  <Link className="bt" href={`/boards/view?code=${slug}&id=${p.postId}`}>
                    {p.secret && <Icon name="lock" />} {p.title}
                  </Link>
                  {p.commentCount > 0 && <small className="hint"> [{p.commentCount}]</small>}
                  {p.hasAttach && <small className="hint"> 📎</small>}
                  {p.isNew && <b className="new" style={{ color: "var(--err)", fontSize: ".75rem", marginLeft: 4 }}>N</b>}
                </td>
                <td data-label="작성자">{p.authorName}</td>
                <td data-label="등록일">{fmtDate(p.createdAt)}</td>
                <td data-label="조회수">{p.viewCount}</td>
                {board.categories.length > 0 && <td data-label="분류">{p.categoryCode ?? "-"}</td>}
                {board.hasField && <td data-label="분야">{p.fieldName ?? "-"}</td>}
                {board.hasRegion && <td data-label="지역">{p.regionName ?? "-"}</td>}
                {board.hasStatus && <td data-label="상태"><PostBadge status={p.status} name={p.statusName} /></td>}
              </tr>
            )) : <tr><td colSpan={cols.length}>{filter.keyword ? "검색 조건에 맞는 글이 없습니다." : "등록된 글이 없습니다."}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="btns">{board.canWrite && <Link className="btn sm" href={`/boards/write?code=${slug}`}>글쓰기</Link>}</div>
      <Pager page={data.page} totalPages={data.totalPages} onPage={setPage} />
    </>
  );
}
