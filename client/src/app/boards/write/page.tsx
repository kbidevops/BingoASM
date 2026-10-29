"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import SubPage from "@/components/SubPage";
import { ErrorBox, FilePicker, FormMsg, FormRow, Loading, SubmitBar, useToast } from "@/components/ui";
import { api, uploadFiles } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { BOARD_PERM, boardHref, FIELDS, loadBoards, loadRegions, toSlug, type BoardSlug } from "@/lib/boards";
import type { BoardInfo, PostDetail, Region } from "@/lib/types";

export default function PostWritePage() {
  return (
    <Suspense>
      <PostWrite />
    </Suspense>
  );
}

function PostWrite() {
  const params = useSearchParams();
  const slug = toSlug(params.get("code"));
  const id = Number(params.get("id")) || null;
  if (!slug) return <SubPage title="글쓰기"><ErrorBox message="잘못된 주소입니다." /></SubPage>;
  return (
    <SubPage perm={BOARD_PERM[slug]} menuPath={boardHref(slug)}>
      <WriteForm slug={slug} id={id} />
    </SubPage>
  );
}

function WriteForm({ slug, id }: { slug: BoardSlug; id: number | null }) {
  const router = useRouter();
  const toast = useToast();
  const { me } = useAuth();
  const code = slug.toUpperCase();
  const [board, setBoard] = useState<BoardInfo | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [err, setErr] = useState("");
  const [v, setV] = useState({ title: "", content: "", categoryCode: "", fieldCode: "", regionId: "", secret: false });
  const [keepFiles, setKeepFiles] = useState<{ fileId: number; name: string }[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [msg, setMsg] = useState<{ kind?: "ok" | "bad"; text: string }>({ text: "" });
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(!id);
  /** A school's post always files under the school's 교육지원청 (the server enforces it); only posts without a school pick a region. */
  const [schoolRegion, setSchoolRegion] = useState<string | null>(!id && me?.schoolId ? me.regionName ?? "소속 학교의 교육지원청" : null);

  useEffect(() => {
    loadBoards().then((bs) => setBoard(bs.find((b) => b.code === code) ?? null)).catch((e) => setErr(e.message));
    if (id) {
      api.get<PostDetail>(`/api/as/boards/${code}/${id}`).then((p) => {
        if (!p.canEdit) return setErr("이 글을 수정할 권한이 없습니다.");
        setV({ title: p.title, content: p.content, categoryCode: p.categoryCode ?? "", fieldCode: p.fieldCode ?? "", regionId: p.regionId ? String(p.regionId) : "", secret: p.secret });
        setKeepFiles(p.attachments.map((f) => ({ fileId: f.fileId, name: f.name })));
        setSchoolRegion(p.schoolName ? p.regionName ?? "소속 학교의 교육지원청" : null);
        setReady(true);
      }).catch((e) => setErr(e.message));
    }
  }, [code, id]);
  useEffect(() => {
    if (board?.hasRegion) loadRegions().then(setRegions).catch(() => {});
  }, [board]);

  if (err) return <ErrorBox message={err} />;
  if (!board || !ready) return <Loading />;
  if (!board.canWrite) return <ErrorBox message="이 게시판에 글을 쓸 권한이 없습니다." />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.title.trim()) return setMsg({ kind: "bad", text: "제목을 입력해 주세요." });
    if (!v.content.trim()) return setMsg({ kind: "bad", text: "내용을 입력해 주세요." });
    setBusy(true);
    try {
      const uploaded = await uploadFiles(files);
      const body = {
        title: v.title.trim(),
        content: v.content.trim(),
        categoryCode: board.categories.length ? v.categoryCode || board.categories[0] : undefined,
        fieldCode: board.hasField ? v.fieldCode || undefined : undefined,
        regionId: board.hasRegion && !schoolRegion && v.regionId ? Number(v.regionId) : undefined,
        secret: board.allowSecret ? v.secret : undefined,
        attachFileIds: [...keepFiles.map((f) => f.fileId), ...uploaded],
      };
      const res = id ? await api.put<{ postId?: number }>(`/api/as/boards/${code}/${id}`, body) : await api.post<{ postId?: number }>(`/api/as/boards/${code}`, body);
      toast(id ? "수정했습니다." : "등록했습니다.");
      const pid = id ?? res?.postId;
      router.push(pid ? `/boards/view?code=${slug}&id=${pid}` : boardHref(slug));
    } catch (er) {
      setMsg({ kind: "bad", text: (er as Error).message });
      setBusy(false);
    }
  };

  return (
    <>
      <h3 style={{ margin: "0 0 12px", fontSize: "1.125rem" }}>{board.name} {id ? "수정" : "글쓰기"}</h3>
      <form className="ft2" noValidate onSubmit={submit}>
        <table className="ftab"><tbody>
          <FormRow label="제목" required><input aria-label="제목" style={{ width: "100%" }} maxLength={200} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></FormRow>
          <FormRow label="작성자"><b>{me?.userName}</b> <small className="hint">({me?.schoolName ?? me?.vendorName ?? me?.regionName ?? me?.orgName})</small></FormRow>
          {board.categories.length > 0 && (
            <FormRow label="분류" required>
              <select aria-label="분류" value={v.categoryCode || board.categories[0]} onChange={(e) => setV({ ...v, categoryCode: e.target.value })}>
                {board.categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </FormRow>
          )}
          {board.hasField && (
            <FormRow label="분야">
              <select aria-label="분야" value={v.fieldCode} onChange={(e) => setV({ ...v, fieldCode: e.target.value })}>
                <option value="">-- 선택 --</option>
                {FIELDS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
              </select>
            </FormRow>
          )}
          {board.hasRegion && schoolRegion && (
            <FormRow label="지역"><b>{schoolRegion}</b> <small className="hint">학교 글은 학교가 속한 교육지원청으로 접수됩니다.</small></FormRow>
          )}
          {board.hasRegion && !schoolRegion && (
            <FormRow label="지역">
              <select aria-label="지역" value={v.regionId} onChange={(e) => setV({ ...v, regionId: e.target.value })}>
                <option value="">-- 선택 (비우면 내 소속 지역) --</option>
                {regions.map((r) => <option key={r.regionId} value={r.regionId}>{r.regionName}</option>)}
              </select>
            </FormRow>
          )}
          {board.allowSecret && (
            <FormRow label="공개 설정">
              <label><input type="checkbox" checked={v.secret} onChange={(e) => setV({ ...v, secret: e.target.checked })} /> 비밀글 (작성자와 관리자만 볼 수 있습니다)</label>
            </FormRow>
          )}
          <FormRow label="내용" required><textarea className="ta" aria-label="내용" style={{ width: "100%", minHeight: 220 }} value={v.content} onChange={(e) => setV({ ...v, content: e.target.value })} /></FormRow>
          <FormRow label="첨부파일">
            {keepFiles.length > 0 && (
              <ul style={{ margin: "0 0 8px", paddingLeft: 18 }}>
                {keepFiles.map((f) => (
                  <li key={f.fileId}>{f.name} <button type="button" className="linkbtn" onClick={() => setKeepFiles(keepFiles.filter((x) => x.fileId !== f.fileId))}>삭제</button></li>
                ))}
              </ul>
            )}
            <FilePicker files={files} onChange={setFiles} max={Math.max(0, 5 - keepFiles.length)} />
          </FormRow>
        </tbody></table>
        <FormMsg kind={msg.kind} text={msg.text} />
        <SubmitBar label={id ? "수정" : "등록"} busy={busy}>
          <Link className="btn sm sec" href={id ? `/boards/view?code=${slug}&id=${id}` : boardHref(slug)} style={{ padding: "0 32px", minHeight: 42 }}>취소</Link>
        </SubmitBar>
      </form>
    </>
  );
}
