"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import QrQuickScan, { useCanQuickScan } from "@/components/admin/QrQuickScan";
import { AsBadge, Icon, Loading, QuickIcon, UserIcon } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { AS_LIST_HREF } from "@/lib/as";
import type { AsRow, AsSummary, Page, PostRow } from "@/lib/types";

export default function HomePage() {
  const { status } = useAuth();
  useEffect(() => {
    document.title = "충북교육청 원클릭AS시스템";
  }, []);
  if (status === "loading")
    return (
      <main id="content">
        <div className="wrap">
          <Loading />
        </div>
      </main>
    );
  return status === "authed" ? <HomeAuthed /> : <HomePublic />;
}

function HomePublic() {
  return (
    <main id="content" className="mmain">
      <div className="wrap mgrid2">
        <section className="mvis" aria-labelledby="mv-t">
          <p className="mv-k">충청남도교육청</p>
          <h2 id="mv-t">
            <span>All Service</span>
            <span>After Service</span>
          </h2>
          <p className="mv-d">
            학교 정보화기기 장애신고의 신청 · 접수 · 처리 · 결과를 <br />
            원스톱으로 처리하는 원클릭AS시스템입니다.
          </p>
          <ol className="mrail" aria-label="AS 처리절차">
            {[
              ["AS 신청", "학교"],
              ["AS 접수", "AS 기사"],
              ["처리결과 등록", "AS 기사"],
              ["만족도 평가", "학교"],
            ].map(([a, w], i) => (
              <li key={a}>
                <b>{i + 1}</b>
                <strong>{a}</strong>
                {w}
              </li>
            ))}
          </ol>
        </section>
        <section className="mbox" aria-labelledby="mb-t">
          <h2 id="mb-t" className="sr">
            로그인
          </h2>
          <Link className="mlogin" href="/login">
            <span className="ml-ic">
              <UserIcon />
            </span>
            <span className="ml-tx">
              <small>유지관리 사업자 로그인</small>
              <b>통합 로그인</b>
            </span>
            <Icon name="arrow" />
          </Link>
          <div className="minfo">
            <h3>원클릭 AS 시스템</h3>
            <p>
              통합홈페이지 및 원클릭AS시스템 회원은 함께 관리됩니다.
              통합홈페이지 회원가입된 교직원은 소통메신저를 통해 원클릭AS시스템
              사용가능합니다.
            </p>
            <p className="mtel">
              문의: 창의특수교육과 학교정보화지원팀(
              <a href="tel:043-290-2885">290-2885</a>)
            </p>
            <Link className="mlink" href="/contact">
              문의처에 대해 안내해 드립니다 <Icon name="arrow" />
            </Link>
          </div>
          <Link className="mdemo" href="/intro">
            시스템 소개 보기 <Icon name="arrow" />
          </Link>
        </section>
      </div>
    </main>
  );
}

const QUICK = [
  {
    href: "/admin/start",
    title: "우리 학교 자산",
    icon: "list",
    perm: "SPACE_MANAGE",
  },
  {
    href: "/as/wireless",
    title: "무선망 AS신청",
    icon: "wifi",
    perm: "AS_M_REQUEST",
  },
  {
    href: "/as/schoolnet",
    title: "스쿨넷 AS신청",
    icon: "net",
    perm: "AS_S_REQUEST",
  },
  {
    href: "/boards/write?code=disposal",
    title: "불용PC수거신청",
    icon: "box",
    perm: "BOARD_DISPOSAL",
  },
  {
    href: "/boards/qna",
    title: "질문 및 건의하기",
    icon: "chat",
    perm: "BOARD_QNA",
  },
] as const;

const TELS = [
  [
    "원클릭AS시스템 · 학교 정보화기기 유지관리",
    "창의특수교육과 학교정보화지원팀",
    "043-290-2885",
  ],
  ["스마트기기(이로미) 유지보수", "TGS(스마트기기)", "1566-8797"],
  ["스쿨넷 회선 장애", "LG UPLUS(스쿨넷)", "1644-3668"],
  ["학내망(무선)", "창의특수교육과", "043-290-2882"],
];

function HomeAuthed() {
  const { me, can } = useAuth();
  const canScan = useCanQuickScan();
  const [scan, setScan] = useState(false);
  const [summary, setSummary] = useState<AsSummary | null>(null);
  const [mine, setMine] = useState<AsRow[] | null>(null);
  const [notice, setNotice] = useState<PostRow[] | null>(null);
  const [qna, setQna] = useState<PostRow[] | null>(null);
  const canViewAs = [
    "AS_C_VIEW",
    "AS_M_VIEW",
    "AS_S_VIEW",
    "SMART_REQUEST",
  ].some((p) => can(p));

  useEffect(() => {
    if (canViewAs) {
      api
        .get<AsSummary>("/api/as/requests/summary")
        .then(setSummary)
        .catch(() => setSummary(null));
      api
        .get<Page<AsRow>>("/api/as/requests", { size: 5 })
        .then((p) => setMine(p.content))
        .catch(() => setMine([]));
    }
    if (can("BOARD_NOTICE"))
      api
        .get<Page<PostRow>>("/api/as/boards/NOTICE", { size: 3 })
        .then((p) => setNotice(p.content))
        .catch(() => setNotice([]));
    if (can("BOARD_QNA"))
      api
        .get<Page<PostRow>>("/api/as/boards/QNA", { size: 5 })
        .then((p) => setQna(p.content))
        .catch(() => setQna([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!me) return null;
  const org =
    me.schoolName ?? me.vendorName ?? me.regionName ?? me.orgName ?? "";

  return (
    <main id="content">
      <div className="wrap">
        <div className="hm-wrap">
          <section className="hm-hi" aria-labelledby="hm-t">
            <div>
              <p className="hm-k">All Service After Service</p>
              <h2 id="hm-t">
                <b>{me.userName}</b>님, 안녕하세요.
              </h2>
              <p className="hm-o">
                {org}
                {me.positionName ? " · " + me.positionName : ""}
              </p>
            </div>
            <div className="hm-st">
              {(
                [
                  ["신청완료", summary?.requested, "s2"],
                  ["접수완료", summary?.received, "s3"],
                  ["처리완료", summary?.completed, "s1"],
                ] as const
              ).map(([l, n, c]) => (
                <div key={l}>
                  <span>{l}</span>
                  <b className={c}>{n == null ? "-" : n.toLocaleString()}</b>
                </div>
              ))}
              <Link className="btn sm sec" href="/mypage">
                마이페이지
              </Link>
            </div>
          </section>

          <section aria-labelledby="hq-t">
            <h2 id="hq-t" className="hm-h">
              자주 쓰는 서비스
            </h2>
            <ul className="hm-q">
              {QUICK.filter((q) => can(q.perm)).map((q) => (
                <li key={q.href}>
                  <Link href={q.href}>
                    <span className="hm-qi">
                      <QuickIcon name={q.icon} />
                    </span>
                    {q.title}
                  </Link>
                </li>
              ))}
              {canScan && (
                <li>
                  <button type="button" onClick={() => setScan(true)}>
                    <span className="hm-qi">
                      <QuickIcon name="qr" />
                    </span>
                    QR 찍기
                  </button>
                </li>
              )}
            </ul>
            {scan && <QrQuickScan onClose={() => setScan(false)} />}
          </section>

          <div className="hm-grid">
            {canViewAs && (
              <section className="hm-card" aria-labelledby="ha-t">
                <div className="hm-ch">
                  <h2 id="ha-t">AS 진행 현황</h2>
                  <Link href="/mypage?tab=as">더보기 +</Link>
                </div>
                <ul className="hm-l">
                  {mine === null ? (
                    <li className="hint">불러오는 중…</li>
                  ) : mine.length ? (
                    mine.map((r) => (
                      <li key={r.asvcSn}>
                        <Link href={AS_LIST_HREF[r.rceptTy]}>
                          <span className="chip">{r.rceptTyName}</span>
                          {r.schoolName} ·{" "}
                          {r.faultTypeName ?? r.rceptTyName + " AS"}
                        </Link>
                        <AsBadge status={r.status} name={r.statusName} />
                        <time>{fmtDate(r.requestAt)}</time>
                      </li>
                    ))
                  ) : (
                    <li className="hint">AS 신청 내역이 없습니다.</li>
                  )}
                </ul>
              </section>
            )}
            {notice && (
              <section className="hm-card" aria-labelledby="hn-t">
                <div className="hm-ch">
                  <h2 id="hn-t">공지 및 자료실</h2>
                  <Link href="/boards/notice">더보기 +</Link>
                </div>
                <ul className="hm-l">
                  {notice.length ? (
                    notice.map((p) => (
                      <li key={p.postId}>
                        <Link href={`/boards/view?code=notice&id=${p.postId}`}>
                          {p.title}
                        </Link>
                        <time>{fmtDate(p.createdAt)}</time>
                      </li>
                    ))
                  ) : (
                    <li className="hint">등록된 공지가 없습니다.</li>
                  )}
                </ul>
              </section>
            )}
            {qna && (
              <section className="hm-card" aria-labelledby="hqn-t">
                <div className="hm-ch">
                  <h2 id="hqn-t">질문 및 건의하기</h2>
                  <Link href="/boards/qna">더보기 +</Link>
                </div>
                <ul className="hm-l">
                  {qna.length ? (
                    qna.map((p) => (
                      <li key={p.postId}>
                        <Link href={`/boards/view?code=qna&id=${p.postId}`}>
                          {p.fieldName && (
                            <span className="chip">{p.fieldName}</span>
                          )}
                          {p.secret ? "🔒 " : ""}
                          {p.title}
                        </Link>
                        <time>{fmtDate(p.createdAt)}</time>
                      </li>
                    ))
                  ) : (
                    <li className="hint">등록된 글이 없습니다.</li>
                  )}
                </ul>
              </section>
            )}
            <section className="hm-card hm-tel" aria-labelledby="ht-t">
              <div className="hm-ch">
                <h2 id="ht-t">문의처</h2>
                <Link href="/contact">전체보기 +</Link>
              </div>
              <ul className="hm-l">
                {TELS.map(([a, b, t]) => (
                  <li key={t}>
                    <span>
                      <small>{a}</small>
                      {b}
                    </span>
                    <a href={"tel:" + t}>{t}</a>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
