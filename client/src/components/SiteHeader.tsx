"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth, useIdleLeft } from "@/lib/auth";
import { mmss } from "@/lib/format";
import { findMenu, visibleMenu } from "@/lib/menu";
import { useScraps } from "@/lib/scraps";
import QrQuickScan, { useCanQuickScan } from "./admin/QrQuickScan";
import { Icon, Modal, useToast } from "./ui";

function toggleTheme() {
  const r = document.documentElement;
  const d = r.getAttribute("data-theme");
  const dark = d
    ? d === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  const next = dark ? "light" : "dark";
  r.setAttribute("data-theme", next);
  try {
    localStorage.setItem("bingoasm.theme", next);
  } catch {
    /* ignore */
  }
}

function ScrapPopover({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();
  const { status } = useAuth();
  const { scraps, add, remove, clear } = useScraps();
  const [msg, setMsg] = useState("");
  const cur = findMenu(pathname);

  if (status !== "authed") {
    return (
      <div id="scrap-pop" className="scr-pop">
        <div className="scr-h">
          <b>메뉴스크랩</b>
          <button
            type="button"
            className="md-x"
            onClick={onClose}
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
        <p className="scr-e">
          로그인하면 자주 쓰는 메뉴를 스크랩할 수 있습니다.
        </p>
      </div>
    );
  }
  const run = async (f: () => Promise<void>, ok: string) => {
    try {
      await f();
      setMsg(ok);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <div id="scrap-pop" className="scr-pop">
      <div className="scr-h">
        <b>메뉴스크랩</b>
        <button
          type="button"
          className="md-x"
          onClick={onClose}
          aria-label="닫기"
        >
          ✕
        </button>
      </div>
      {cur.item && cur.group ? (
        <button
          type="button"
          className="btn bl sm scr-add"
          onClick={() =>
            run(
              () => add(cur.item!.href, cur.group!.title, cur.item!.title),
              `‘${cur.item!.title}’ 메뉴를 스크랩했습니다.`,
            )
          }
        >
          ＋ 현재 메뉴 스크랩 <small>({cur.item.title})</small>
        </button>
      ) : (
        <p className="scr-e">
          메뉴 페이지에서 현재 메뉴를 스크랩할 수 있습니다.
        </p>
      )}
      <ul className="scr-l">
        {scraps.length ? (
          scraps.map((s) => (
            <li key={s.scrapId}>
              <Link href={s.menuKey} onClick={onClose}>
                <small>{s.groupName}</small>
                {s.title}
              </Link>
              <button
                type="button"
                aria-label={`${s.title} 스크랩 삭제`}
                onClick={() => run(() => remove(s.scrapId), "삭제했습니다.")}
              >
                ✕
              </button>
            </li>
          ))
        ) : (
          <li className="scr-e">스크랩한 메뉴가 없습니다.</li>
        )}
      </ul>
      {scraps.length > 0 && (
        <div style={{ textAlign: "right" }}>
          <button
            type="button"
            className="scr-clr"
            onClick={() => run(clear, "모두 삭제했습니다.")}
          >
            전체 삭제
          </button>
        </div>
      )}
      <p className="scr-msg" role="status">
        {msg}
      </p>
    </div>
  );
}

function IdleWarning() {
  const { status, extend, signOut } = useAuth();
  const idleLeft = useIdleLeft();
  if (status !== "authed" || idleLeft > 120) return null;
  return (
    <Modal title="곧 자동 로그아웃됩니다" onClose={extend}>
      <p>
        2분 동안 사용이 없으면 개인정보 보호를 위해 자동으로 로그아웃됩니다.
      </p>
      <p>
        남은 시간 <b className="sess-t">{mmss(idleLeft)}</b>
      </p>
      <div
        style={{
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
          marginTop: 14,
        }}
      >
        <button type="button" className="btn sm sec" onClick={() => signOut()}>
          지금 로그아웃
        </button>
        <button type="button" className="btn sm" onClick={extend}>
          로그인 연장
        </button>
      </div>
    </Modal>
  );
}

export default function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const { status, me, perms, extend, signOut } = useAuth();
  const idleLeft = useIdleLeft();
  const [searchOn, setSearchOn] = useState(false);
  const [q, setQ] = useState("");
  const [scrapOn, setScrapOn] = useState(false);
  const [noMega, setNoMega] = useState(false);
  const [scanOn, setScanOn] = useState(false);
  const canScan = useCanQuickScan();
  const searchInput = useRef<HTMLInputElement>(null);

  // Close the hover mega menu after navigating (the pointer is usually still over it).
  useEffect(() => {
    setNoMega(true);
    setSearchOn(false);
    setScrapOn(false);
  }, [pathname]);

  useEffect(() => {
    if (searchOn) searchInput.current?.focus();
  }, [searchOn]);

  const menu = visibleMenu(status === "authed" ? perms : null);
  const cur = findMenu(pathname);
  const curGroup = cur.group
    ? menu.findIndex((g) => g.title === cur.group!.title)
    : -1;

  const results = q.trim()
    ? menu.flatMap((g) =>
        g.items
          .filter((it) => (g.title + " " + it.title).includes(q.trim()))
          .map((it) => ({ g: g.title, it })),
      )
    : [];

  const logout = (e: React.MouseEvent) => {
    e.preventDefault();
    signOut();
    toast("로그아웃했습니다.");
    router.push("/");
  };

  return (
    <header
      className={"gw" + (noMega ? " nomega" : "")}
      onMouseLeave={() => setNoMega(false)}
    >
      <div className="util">
        <div className="wrap">
          <Link className="home" href="/">
            <Icon name="home" /> 충북교육청
          </Link>
          <span>
            {status === "authed" && me ? (
              <>
                <em className="uw">{me.userName}님 환영합니다.</em>
                <span className="sess" title="사용이 없으면 자동 로그아웃">
                  자동 로그아웃 <b className="sess-t">{mmss(idleLeft)}</b>
                  <button
                    type="button"
                    className="ub"
                    onClick={() => {
                      extend();
                      toast("로그인을 30분 연장했습니다.");
                    }}
                  >
                    연장
                  </button>
                </span>
                <a href="#" onClick={logout}>
                  로그아웃
                </a>
                <Link href="/mypage">마이페이지</Link>
              </>
            ) : (
              <Link href="/login">로그인</Link>
            )}
            <button type="button" className="ub" onClick={toggleTheme}>
              <Icon name="theme" /> 화면 모드
            </button>
            <span className="scr-w">
              <button
                type="button"
                className="ub"
                aria-expanded={scrapOn}
                onClick={() => setScrapOn((v) => !v)}
              >
                <Icon name="star" /> 메뉴스크랩
              </button>
              {scrapOn && <ScrapPopover onClose={() => setScrapOn(false)} />}
            </span>
          </span>
        </div>
      </div>
      <div className="hd2 wrap">
        <Link className="logo" href="/">
          <img className="logo-img" src="/images/충청남도교육청.png" alt="충청남도교육청" width={154} height={44} />
          <i></i>원클릭AS시스템
        </Link>
        <nav id="gnb" aria-label="메인메뉴">
          <ul>
            {menu.map((g, i) => {
              const first = g.items.find((it) => !it.sideOnly) ?? g.items[0];
              return (
                <li key={g.title}>
                  <Link
                    href={first.href}
                    className={i === curGroup ? "on" : ""}
                  >
                    {g.title}
                    {i === curGroup && <i className="dot"></i>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        {canScan && (
          <button
            className="ic qqs-btn"
            type="button"
            aria-label="QR 찍기"
            title="QR 찍기"
            onClick={() => setScanOn(true)}
          >
            <Icon name="qr" />
            <span>QR 찍기</span>
          </button>
        )}
        <button
          className="ic"
          type="button"
          aria-label="통합검색"
          aria-expanded={searchOn}
          onClick={() => setSearchOn((v) => !v)}
        >
          <Icon name="search" />
        </button>
        <Link
          className="ic bars"
          href="/sitemap"
          aria-label="전체 메뉴(누리집 지도)"
        >
          <span></span>
          <span></span>
          <span></span>
        </Link>
      </div>
      {scanOn && <QrQuickScan onClose={() => setScanOn(false)} />}
      <div className="mega">
        <div className="wrap mgrid">
          {menu.map((g, i) => (
            <div key={g.title}>
              <h3 className={i === curGroup ? "on" : ""}>{g.title}</h3>
              <ul>
                {g.items
                  .filter((it) => !it.sideOnly)
                  .map((it) => (
                    <li key={it.href}>
                      <Link href={it.href}>{it.title}</Link>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className={"sch" + (searchOn ? " on" : "")}>
        <div className="wrap">
          <form
            className="sch-f"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              if (results[0]) router.push(results[0].it.href);
            }}
          >
            <input
              ref={searchInput}
              name="q"
              placeholder="검색어를 입력해주세요"
              aria-label="검색어"
              autoComplete="off"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button type="submit" aria-label="검색">
              <Icon name="search" />
            </button>
          </form>
          <ul className="sch-r">
            {q.trim() &&
              (results.length ? (
                results.map((r) => (
                  <li key={r.it.href}>
                    <Link href={r.it.href}>
                      <small>{r.g}</small>
                      {r.it.title}
                    </Link>
                  </li>
                ))
              ) : (
                <li className="scr-e">
                  “{q.trim()}”에 대한 검색 결과가 없습니다.
                </li>
              ))}
          </ul>
        </div>
      </div>
      <IdleWarning />
    </header>
  );
}
