"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import AsDetailModal from "@/components/AsDetailModal";
import SubPage from "@/components/SubPage";
import { AsBadge, ErrorBox, FormMsg, FormRow, Loading, NoticeBox, SubmitBar, TelInput, telValid, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { AS_LIST_HREF } from "@/lib/as";
import { useAuth } from "@/lib/auth";
import { browserOf, fmtDate, fmtDateTime, LOGIN_METHOD } from "@/lib/format";
import { useScraps } from "@/lib/scraps";
import type { AsRow, AsSummary, LoginLog, Me, Page } from "@/lib/types";

const TABS = [["info", "회원정보"], ["pw", "비밀번호 변경"], ["as", "나의 AS 신청내역"], ["scrap", "스크랩한 메뉴"], ["log", "로그인 기록"]] as const;
type Tab = (typeof TABS)[number][0];

export default function MyPage() {
  return (
    <Suspense>
      <SubPage title="마이페이지" auth side={false}>
        <MyPageBody />
      </SubPage>
    </Suspense>
  );
}

function MyPageBody() {
  const params = useSearchParams();
  const router = useRouter();
  const { me } = useAuth();
  const t = params.get("tab");
  const tab: Tab = TABS.some(([k]) => k === t) ? (t as Tab) : "info";
  if (!me) return null;
  const org = me.schoolName ?? me.vendorName ?? me.regionName ?? me.orgName ?? "";
  return (
    <>
      <div className="mph">
        <div className="mpa" aria-hidden="true">{me.userName.slice(0, 1)}</div>
        <div><b>{me.userName}</b>님 <small>({me.loginId})</small><br /><span>{org}{me.positionName ? " · " + me.positionName : ""}</span></div>
      </div>
      <div className="tabs" role="tablist" aria-label="마이페이지 메뉴">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-controls="mppanel" aria-selected={tab === k} onClick={() => router.replace("/mypage?tab=" + k)}>{l}</button>
        ))}
      </div>
      <div id="mppanel" role="tabpanel">
        {tab === "info" && <InfoTab me={me} />}
        {tab === "pw" && <PasswordTab me={me} />}
        {tab === "as" && <AsTab org={org} />}
        {tab === "scrap" && <ScrapTab />}
        {tab === "log" && <LogTab />}
      </div>
    </>
  );
}

function InfoTab({ me }: { me: Me }) {
  const { setMe } = useAuth();
  const toast = useToast();
  const [v, setV] = useState({ userName: me.userName, positionName: me.positionName ?? "", mobile: me.mobile ?? "010--", email: me.email ?? "", otpEnabled: me.otpEnabled });
  const [err, setErr] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ kind?: "ok" | "bad"; text: string }>({ text: "" });
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const er: Record<string, string> = {};
    if (!v.userName.trim()) er.userName = "이름을 입력해 주세요.";
    if (!telValid(v.mobile)) er.mobile = "연락처 형식을 확인해 주세요. (예: 010-1234-5678)";
    if (v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) er.email = "이메일 형식을 확인해 주세요.";
    setErr(er);
    if (Object.keys(er).length) return setMsg({ kind: "bad", text: `입력하지 않았거나 잘못 입력한 항목이 ${Object.keys(er).length}개 있습니다.` });
    setBusy(true);
    try {
      const m = await api.put<Me>("/api/auth/me", { ...v, userName: v.userName.trim(), positionName: v.positionName.trim(), email: v.email.trim() });
      setMe(m);
      setMsg({ kind: "ok", text: "저장했습니다." });
      toast("회원정보를 저장했습니다.");
    } catch (er2) {
      setMsg({ kind: "bad", text: (er2 as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <NoticeBox>
        <p>■ 회원정보는 통합홈페이지와 함께 관리됩니다.</p>
        <p>■ 소속기관이 바뀐 경우 학교정보화지원팀에 요청해 주세요. 휴대전화·이메일은 암호화해 저장합니다.</p>
      </NoticeBox>
      <form className="ft2 mpf" noValidate onSubmit={submit}>
        <table className="ftab"><tbody>
          <FormRow label="아이디"><b>{me.loginId}</b></FormRow>
          <FormRow label="이름" required error={err.userName}><input aria-label="이름" value={v.userName} onChange={(e) => setV({ ...v, userName: e.target.value })} /></FormRow>
          <FormRow label="소속기관"><input className="instt-in" readOnly aria-label="소속기관" value={me.schoolName ?? me.vendorName ?? me.regionName ?? me.orgName ?? ""} /></FormRow>
          <FormRow label="직위/담당"><input aria-label="직위/담당" value={v.positionName} onChange={(e) => setV({ ...v, positionName: e.target.value })} /></FormRow>
          <FormRow label="휴대전화" required error={err.mobile}><TelInput value={v.mobile} onChange={(x) => setV({ ...v, mobile: x })} /></FormRow>
          <FormRow label="이메일" error={err.email}><input type="email" aria-label="이메일" value={v.email} style={{ width: 260, maxWidth: "100%" }} onChange={(e) => setV({ ...v, email: e.target.value })} /></FormRow>
          <FormRow label="2단계 인증">
            <label><input type="radio" name="otp" checked={v.otpEnabled} onChange={() => setV({ ...v, otpEnabled: true })} /> 사용</label>{" "}
            <label><input type="radio" name="otp" checked={!v.otpEnabled} onChange={() => setV({ ...v, otpEnabled: false })} /> 사용 안 함</label>{" "}
            <small className="hint">로그인할 때 비밀번호 다음에 6자리 인증번호를 한 번 더 입력합니다.</small>
          </FormRow>
          <FormRow label="가입일 / 최근 로그인">{fmtDate(me.createdAt)} &nbsp;/&nbsp; {fmtDateTime(me.lastLoginAt)}</FormRow>
        </tbody></table>
        <FormMsg kind={msg.kind} text={msg.text} />
        <SubmitBar label="회원정보 저장" busy={busy} />
      </form>
    </>
  );
}

/** Mirrors the server's PasswordPolicy: 9~20 chars, letters+digits+symbols, no id/phone, no 4× repeat, no spaces. */
function pwRules(v: string, me: Me) {
  const tel = (me.mobile ?? "").replace(/\D/g, "");
  return {
    len: v.length >= 9 && v.length <= 20 && !/\s/.test(v),
    kinds: /[A-Za-z]/.test(v) && /\d/.test(v) && /[^A-Za-z\d]/.test(v),
    id: !!v && !(me.loginId.length >= 3 && v.toLowerCase().includes(me.loginId.toLowerCase())) && !(tel.length >= 4 && v.includes(tel.slice(-4))),
    rep: !!v && !/(.)\1{3,}/.test(v),
  };
}

function PasswordTab({ me }: { me: Me }) {
  const { setMe } = useAuth();
  const [v, setV] = useState({ cur: "", next: "", again: "" });
  const [msg, setMsg] = useState<{ kind?: "ok" | "bad"; text: string }>({ text: "" });
  const [busy, setBusy] = useState(false);
  const r = pwRules(v.next, me);
  const score = Object.values(r).filter(Boolean).length + (v.next.length >= 14 ? 1 : 0);
  const level = !v.next ? ["-", 0, ""] : score <= 2 ? ["약함", 25, "w"] : score <= 3 ? ["보통", 55, "m"] : score <= 4 ? ["강함", 80, "s"] : ["매우 강함", 100, "s"];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.cur || !v.next || !v.again) return setMsg({ kind: "bad", text: "모든 항목을 입력해 주세요." });
    if (!Object.values(r).every(Boolean)) return setMsg({ kind: "bad", text: "새 비밀번호가 규칙에 맞지 않습니다." });
    if (v.next !== v.again) return setMsg({ kind: "bad", text: "새 비밀번호가 일치하지 않습니다." });
    setBusy(true);
    try {
      const res = await api.put<{ passwordChangedAt: string }>("/api/auth/password", { currentPassword: v.cur, newPassword: v.next });
      setMe({ ...me, passwordChangedAt: res.passwordChangedAt });
      setV({ cur: "", next: "", again: "" });
      setMsg({ kind: "ok", text: "비밀번호를 변경했습니다." });
    } catch (err) {
      setMsg({ kind: "bad", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const days = me.passwordChangedAt ? Math.floor((Date.now() - new Date(me.passwordChangedAt).getTime()) / 86400000) : null;
  return (
    <>
      <NoticeBox>
        {days !== null && <p>■ 마지막 변경 {fmtDate(me.passwordChangedAt)} (<b>{days}일 경과</b>){days >= 90 ? " — 90일이 지나 변경을 권장합니다." : ""}</p>}
        <p>■ 개인정보 보호를 위해 비밀번호를 주기적으로(3개월) 변경해 주세요.</p>
        <p>■ 아이디, 생일, 전화번호 등 추측하기 쉬운 비밀번호는 사용할 수 없습니다.</p>
      </NoticeBox>
      <form className="ft2 pwf" noValidate onSubmit={submit}>
        <table className="ftab"><tbody>
          <FormRow label="현재 비밀번호" required><input type="password" aria-label="현재 비밀번호" autoComplete="current-password" value={v.cur} onChange={(e) => setV({ ...v, cur: e.target.value })} /></FormRow>
          <FormRow label="새 비밀번호" required>
            <input type="password" aria-label="새 비밀번호" autoComplete="new-password" value={v.next} onChange={(e) => setV({ ...v, next: e.target.value })} />
            <div className="pwm" aria-live="polite">
              <div className={"pwm-bar " + level[2]}><i style={{ width: level[1] + "%" }}></i></div>
              <span className="pwm-l">강도: {level[0]}</span>
              <ul className="pwr">
                <li className={r.len ? "ok" : ""}>9~20자 (공백 없음)</li>
                <li className={r.kinds ? "ok" : ""}>영문·숫자·특수문자 모두 포함</li>
                <li className={r.id ? "ok" : ""}>아이디·전화번호 미포함</li>
                <li className={r.rep ? "ok" : ""}>같은 문자 4번 이상 반복 금지</li>
              </ul>
            </div>
          </FormRow>
          <FormRow label="새 비밀번호 확인" required error={v.again && v.again !== v.next ? "새 비밀번호가 일치하지 않습니다." : undefined}>
            <input type="password" aria-label="새 비밀번호 확인" autoComplete="new-password" value={v.again} onChange={(e) => setV({ ...v, again: e.target.value })} />
          </FormRow>
        </tbody></table>
        <FormMsg kind={msg.kind} text={msg.text} />
        <SubmitBar label="비밀번호 변경" busy={busy} />
      </form>
    </>
  );
}

function AsTab({ org }: { org: string }) {
  const [summary, setSummary] = useState<AsSummary | null>(null);
  const [list, setList] = useState<AsRow[] | null>(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const load = () => {
    setErr("");
    api.get<AsSummary>("/api/as/requests/summary").then(setSummary).catch((e) => setErr(e.message));
    api.get<Page<AsRow>>("/api/as/requests", { size: 10 }).then((p) => setList(p.content)).catch((e) => setErr(e.message));
  };
  useEffect(load, []);
  if (err) return <ErrorBox message={err} onRetry={load} />;
  if (!summary || !list) return <Loading />;
  const total = summary.requested + summary.received + summary.completed + summary.returned;
  const card = (l: string, n: number, c: string) => <div className={"mpc " + c}><span>{l}</span><b>{n.toLocaleString()}</b>건</div>;
  return (
    <>
      <p className="mpo"><b>{org}</b>의 AS 현황입니다.{summary.waitingEval > 0 && <> 만족도 평가를 기다리는 건이 <b>{summary.waitingEval}</b>건 있습니다.</>}</p>
      <div className="mpcards">{card("전체", total, "")}{card("신청완료", summary.requested, "c2")}{card("접수완료", summary.received, "c3")}{card("처리완료", summary.completed, "c1")}</div>
      <div className="tw">
        <table className="cards">
          <caption>최근 신청 10건</caption>
          <thead><tr><th scope="col">구분</th><th scope="col">학교명</th><th scope="col">신청일자</th><th scope="col">상태</th><th scope="col">보고서</th></tr></thead>
          <tbody>
            {list.length ? list.map((r) => (
              <tr key={r.asvcSn}>
                <td data-label="구분"><Link href={AS_LIST_HREF[r.rceptTy]}>{r.rceptTyName}</Link></td>
                <td data-label="학교명">{r.schoolName}</td>
                <td data-label="신청일자">{fmtDate(r.requestAt)}</td>
                <td data-label="상태"><AsBadge status={r.status} name={r.statusName} /></td>
                <td data-label="보고서"><button className="btn bl sm" type="button" onClick={() => setOpen(r.asvcSn)}>보고서 확인</button></td>
              </tr>
            )) : <tr><td colSpan={5}>신청한 내역이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      {open !== null && <AsDetailModal sn={open} onClose={() => setOpen(null)} onChanged={load} />}
    </>
  );
}

function ScrapTab() {
  const { scraps, remove } = useScraps();
  return (
    <>
      <p className="mpo">상단의 <b>메뉴스크랩</b>으로 저장한 메뉴입니다.</p>
      {scraps.length ? (
        <ul className="mpsl">
          {scraps.map((s) => (
            <li key={s.scrapId}>
              <Link href={s.menuKey}><small>{s.groupName}</small>{s.title}</Link>
              <button type="button" className="btn sm sec" onClick={() => remove(s.scrapId)}>삭제</button>
            </li>
          ))}
        </ul>
      ) : <p className="empty">스크랩한 메뉴가 없습니다. 자주 쓰는 메뉴 페이지에서 상단의 ‘메뉴스크랩’을 눌러 추가해 보세요.</p>}
    </>
  );
}

function LogTab() {
  const [logs, setLogs] = useState<LoginLog[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api.get<LoginLog[]>("/api/auth/me/logins").then(setLogs).catch((e) => setErr(e.message));
  }, []);
  if (err) return <ErrorBox message={err} />;
  if (!logs) return <Loading />;
  return (
    <>
      <p className="mpo">최근 로그인 기록 5건입니다. 본인이 아닌 기록이 있으면 비밀번호를 바꾸고 학교정보화지원팀(<a href="tel:043-290-2885">043-290-2885</a>)에 알려 주세요.</p>
      <div className="tw">
        <table className="cards">
          <thead><tr><th scope="col">일시</th><th scope="col">브라우저</th><th scope="col">IP</th><th scope="col">방식</th><th scope="col">결과</th></tr></thead>
          <tbody>
            {logs.length ? logs.map((l, i) => (
              <tr key={i}>
                <td data-label="일시">{fmtDateTime(l.loginAt)}</td>
                <td data-label="브라우저">{browserOf(l.userAgent)}</td>
                <td data-label="IP">{l.ip ?? "-"}</td>
                <td data-label="방식">{LOGIN_METHOD[l.method] ?? l.method}</td>
                <td data-label="결과">{l.success ? <b className="st s1">성공</b> : <b className="st s4">실패</b>}</td>
              </tr>
            )) : <tr><td colSpan={5}>로그인 기록이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
