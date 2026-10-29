"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { findMenu, visibleMenu } from "@/lib/menu";
import { Icon, Loading } from "./ui";

/**
 * Sub page frame: banner + breadcrumb + page tools, side menu of the current group, content, survey.
 * `perm` guards the page: signed-out users go to /login (and come back), users without the permission see a notice.
 * `menuPath` makes pages outside the menu (post view/write) highlight their board.
 */
export default function SubPage({ title, perm, auth, menuPath, side = true, children }: {
  title?: string;
  perm?: string;
  /** Requires sign-in even without a specific permission. */
  auth?: boolean;
  menuPath?: string;
  side?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { status, perms, can } = useAuth();
  const [font, setFont] = useState(16);
  const [share, setShare] = useState(false);
  const cur = findMenu(menuPath ?? pathname);
  const heading = title ?? cur.title;
  const needLogin = !!(perm || auth);

  useEffect(() => {
    document.documentElement.style.fontSize = font + "px";
  }, [font]);

  useEffect(() => {
    document.title = heading ? `${heading} | 충청남도교육청 원클릭AS시스템` : "충청남도교육청 원클릭AS시스템";
  }, [heading]);

  useEffect(() => {
    if (needLogin && status === "anon") {
      router.replace("/login?next=" + encodeURIComponent(location.pathname + location.search));
    }
  }, [needLogin, status, router]);

  // The side menu shows the current group as this user may see it.
  const group = cur.group && visibleMenu(status === "authed" ? perms : null).find((g) => g.title === cur.group!.title);
  const showSide = side && !!group;
  const here = (menuPath ?? pathname).replace(/\/$/, "");

  let body: React.ReactNode = children;
  if (needLogin && status !== "authed") body = <Loading text={status === "loading" ? "불러오는 중입니다…" : "로그인 화면으로 이동합니다…"} />;
  else if (perm && !can(perm)) {
    body = (
      <div className="empty" style={{ padding: "40px 20px" }}>
        <p style={{ margin: "0 0 14px" }}>이 메뉴를 사용할 권한이 없습니다. 권한이 필요하면 충청남도교육청(041-640-7114)에 문의해 주세요.</p>
        <Link className="btn sm sec" href="/">메인으로</Link>
      </div>
    );
  }

  return (
    <main id="content">
      <div className="ban crumb">
        <div>
          <h2>{heading}</h2>
          <div className="path">
            <span className="hm"><Icon name="home" /></span> {cur.group ? `${cur.group.title} › ` : ""}{heading}
          </div>
        </div>
        <div>
          <div className="tools">
            <button type="button" aria-label="공유" onClick={() => setShare((v) => !v)}><Icon name="share" /></button>
            <button type="button" aria-label="인쇄" onClick={() => window.print()}><Icon name="print" /></button>
            <button type="button" aria-label="확대" onClick={() => setFont((f) => Math.min(22, f + 1))}>+</button>
            <button type="button" aria-label="축소" onClick={() => setFont((f) => Math.max(12, f - 1))}>−</button>
          </div>
          <div className={"share" + (share ? " open" : "")} style={{ marginTop: 6 }}>
            <button type="button" onClick={() => navigator.clipboard?.writeText(location.href)}>주소 복사</button>
          </div>
        </div>
      </div>
      <div className={"wrap" + (showSide ? " lay" : "")}>
        {showSide && (
          <aside className="side">
            <b>{group!.title}</b>
            {group!.items.map((it) => (
              <Link key={it.href} href={it.href} className={it.href === here ? "on" : ""} aria-current={it.href === here ? "page" : undefined}>{it.title}</Link>
            ))}
          </aside>
        )}
        <div>
          {body}
          <Survey />
        </div>
      </div>
    </main>
  );
}

const SURVEY = ["매우만족", "만족", "보통", "불만족", "매우불만족"];

function Survey() {
  const [v, setV] = useState("");
  const [msg, setMsg] = useState("");
  return (
    <section className="sv" aria-label="콘텐츠 만족도 조사">
      <div className="svh">페이지에서 제공하는 정보에 대하여 만족하셨습니까?</div>
      <div className="svb">
        {SURVEY.map((t) => (
          <label key={t}><input type="radio" name="sv" value={t} checked={v === t} onChange={() => setV(t)} /> {t}</label>
        ))}
        <button className="btn ghost sm" type="button" style={{ color: "var(--brand)" }}
          onClick={() => setMsg(v ? `‘${v}’로 등록되었습니다. 감사합니다.` : "만족도를 선택해 주세요.")}>평가하기</button>
        <span role="status" style={{ fontSize: ".8125rem", color: "var(--muted)" }}>{msg}</span>
      </div>
    </section>
  );
}
