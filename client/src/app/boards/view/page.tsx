"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import SubPage from "@/components/SubPage";
import { ErrorBox, Loading, PostBadge, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { BOARD_PERM, boardHref, POST_STATUSES, toSlug, type BoardSlug } from "@/lib/boards";
import { fileSize, fmtDate, fmtDateTime } from "@/lib/format";
import type { PostDetail } from "@/lib/types";

export default function PostViewPage() {
  return (
    <Suspense>
      <PostView />
    </Suspense>
  );
}

function PostView() {
  const params = useSearchParams();
  const slug = toSlug(params.get("code"));
  const id = Number(params.get("id"));
  if (!slug || !id) return <SubPage title="게시글"><ErrorBox message="잘못된 주소입니다." /></SubPage>;
  return (
    <SubPage perm={BOARD_PERM[slug]} menuPath={boardHref(slug)}>
      <PostBody slug={slug} id={id} />
    </SubPage>
  );
}

function PostBody({ slug, id }: { slug: BoardSlug; id: number }) {
  const router = useRouter();
  const toast = useToast();
  const code = slug.toUpperCase();
  const [p, setP] = useState<PostDetail | null>(null);
  const [err, setErr] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [st, setSt] = useState({ status: "", visitDate: "" });

  const load = useCallback(() => {
    setErr("");
    api.get<PostDetail>(`/api/as/boards/${code}/${id}`).then((d) => {
      setP(d);
      setSt({ status: d.status ?? "WAIT", visitDate: d.visitDate ?? "" });
    }).catch((e) => setErr(e.message));
  }, [code, id]);
  useEffect(load, [load]);

  if (err) return <ErrorBox message={err} onRetry={load} />;
  if (!p) return <Loading />;

  const run = async (f: () => Promise<unknown>, ok: string, after?: () => void) => {
    setBusy(true);
    try {
      await f();
      toast(ok);
      after ? after() : load();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const chips = [p.categoryCode, p.fieldName, p.regionName].filter(Boolean);
  const meta: [string, string][] = [["작성자", p.authorName], ["등록일", fmtDate(p.createdAt)], ["조회", String(p.viewCount)]];
  if (p.schoolName) meta.push(["학교", p.schoolName]);
  if (p.visitDate) meta.push(["방문일", fmtDate(p.visitDate)]);

  return (
    <>
      <article className="pv">
        <header>
          {(chips.length > 0 || p.status) && (
            <div className="chips">
              {chips.map((c) => <span key={c} className="chip">{c}</span>)}
              {p.status && <PostBadge status={p.status} name={p.statusName} />}
            </div>
          )}
          <h3>{p.secret ? "🔒 " : ""}{p.title}</h3>
          <dl>{meta.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        </header>
        <div className="pbody" style={{ whiteSpace: "pre-wrap" }}>{p.content}</div>
        {p.attachments.length > 0 && (
          <div className="pfile">
            <b>첨부파일</b>
            <ul>
              {p.attachments.map((f) => (
                <li key={f.fileId}>
                  <button type="button" className="linkbtn" onClick={() => api.download(f.url, undefined, f.name).catch((e) => toast(e.message))}>{f.name}</button>{" "}
                  <small className="hint">({fileSize(f.size)})</small>
                </li>
              ))}
            </ul>
          </div>
        )}
      </article>

      {p.canSetStatus && (
        <form className="card" style={{ padding: 14, margin: "12px 0", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
          onSubmit={(e) => { e.preventDefault(); run(() => api.patch(`/api/as/boards/${code}/${id}/status`, { status: st.status, visitDate: st.visitDate || null }), "진행상태를 저장했습니다."); }}>
          <b>진행상태</b>
          <select aria-label="진행상태" value={st.status} onChange={(e) => setSt({ ...st, status: e.target.value })}>
            {POST_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <label>방문일 <input type="date" value={st.visitDate} onChange={(e) => setSt({ ...st, visitDate: e.target.value })} /></label>
          <button type="submit" className="btn sm" disabled={busy}>저장</button>
        </form>
      )}

      {(p.comments.length > 0 || p.canComment) && (
        <section className="card" style={{ padding: 16, margin: "12px 0" }} aria-labelledby="cm-t">
          <h4 id="cm-t" style={{ margin: "0 0 10px" }}>답변 {p.comments.length}</h4>
          {p.comments.map((c) => (
            <div key={c.commentId} style={{ borderTop: "1px solid var(--line)", padding: "10px 0" }}>
              <p style={{ margin: "0 0 4px" }}>
                <b>{c.authorName}</b> <small className="hint">{fmtDateTime(c.createdAt)}</small>
                {c.canDelete && (
                  <button type="button" className="linkbtn" style={{ marginLeft: 8 }} disabled={busy}
                    onClick={() => confirm("답변을 삭제할까요?") && run(() => api.del(`/api/as/boards/${code}/${id}/comments/${c.commentId}`), "답변을 삭제했습니다.")}>삭제</button>
                )}
              </p>
              <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{c.content}</p>
            </div>
          ))}
          {p.canComment && (
            <form style={{ marginTop: 10 }} onSubmit={(e) => {
              e.preventDefault();
              if (!comment.trim()) return toast("답변 내용을 입력해 주세요.");
              run(() => api.post(`/api/as/boards/${code}/${id}/comments`, { content: comment.trim() }), "답변을 등록했습니다.", () => { setComment(""); load(); });
            }}>
              <textarea className="ta" aria-label="답변 내용" style={{ width: "100%" }} value={comment} onChange={(e) => setComment(e.target.value)} />
              <div style={{ textAlign: "right", marginTop: 6 }}><button className="btn sm" type="submit" disabled={busy}>답변 등록</button></div>
            </form>
          )}
        </section>
      )}

      <div className="btns" style={{ justifyContent: "center", gap: 8 }}>
        {p.canEdit && (
          <>
            <Link className="btn sm sec" href={`/boards/write?code=${slug}&id=${id}`} style={{ padding: "0 24px", minHeight: 42 }}>수정</Link>
            <button type="button" className="btn sm sec" style={{ padding: "0 24px", minHeight: 42 }} disabled={busy}
              onClick={() => confirm("이 글을 삭제할까요?") && run(() => api.del(`/api/as/boards/${code}/${id}`), "삭제했습니다.", () => router.push(boardHref(slug)))}>삭제</button>
          </>
        )}
        <Link className="btn sm" href={boardHref(slug)} style={{ padding: "0 34px", minHeight: 42 }}>목록</Link>
      </div>
    </>
  );
}
