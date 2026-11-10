"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import AsDetailModal from "@/components/AsDetailModal";
import SubPage from "@/components/SubPage";
import OtpSetupPanel from "@/components/OtpSetupPanel";
import { AsBadge, ErrorBox, FormMsg, FormRow, Loading, Modal, NoticeBox, SubmitBar, TelInput, telValid, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { AS_LIST_HREF } from "@/lib/as";
import { useAuth } from "@/lib/auth";
import { browserOf, fmtDate, fmtDateTime, LOGIN_METHOD } from "@/lib/format";
import { pwLevel, pwRules } from "@/lib/password";
import { useScraps } from "@/lib/scraps";
import type { AsRow, AsSummary, LoginLog, Me, OtpSetup, Page } from "@/lib/types";

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
  const [v, setV] = useState({ userName: me.userName, positionName: me.positionName ?? "", mobile: me.mobile ?? "010--", email: me.email ?? "" });
  const [otpDlg, setOtpDlg] = useState<"on" | "off" | null>(null);
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
            <span className="otp-state">
              {me.otpEnabled && me.otpRegistered ? <b className="st s1">사용 중 · 인증 앱 등록됨</b>
                : me.otpEnabled ? <b className="st s2">사용 · 인증 앱 미등록</b> : <b className="st s3">사용 안 함</b>}
              {me.otpEnabled && me.otpRegistered ? (
                <>
                  <button type="button" className="btn sm sec" onClick={() => setOtpDlg("on")}>휴대폰 바꾸기</button>
                  <button type="button" className="btn sm sec" onClick={() => setOtpDlg("off")}>끄기</button>
                </>
              ) : <button type="button" className="btn sm" onClick={() => setOtpDlg("on")}>{me.otpEnabled ? "인증 앱 등록" : "인증 앱 등록하고 켜기"}</button>}
            </span>
            <small className="hint" style={{ display: "block", marginTop: 6 }}>
              켜면 로그인할 때 비밀번호 다음에 휴대폰 인증 앱(Google OTP 등)의 6자리 번호를 입력합니다. 문자·인터넷 없이 동작하고 무료입니다.
            </small>
          </FormRow>
          <FormRow label="가입일 / 최근 로그인">{fmtDate(me.createdAt)} &nbsp;/&nbsp; {fmtDateTime(me.lastLoginAt)}</FormRow>
        </tbody></table>
        <FormMsg kind={msg.kind} text={msg.text} />
        <SubmitBar label="회원정보 저장" busy={busy} />
      </form>
      {otpDlg === "on" && <OtpEnableDialog onClose={() => setOtpDlg(null)} onDone={(m) => { setOtpDlg(null); setMe(m); toast("2단계 인증을 켰습니다. 다음 로그인부터 인증 앱 번호를 입력합니다."); }} />}
      {otpDlg === "off" && <OtpDisableDialog onClose={() => setOtpDlg(null)} onDone={(m) => { setOtpDlg(null); setMe(m); toast("2단계 인증을 껐습니다. 인증 앱의 원클릭AS 항목은 지워도 됩니다."); }} />}
    </>
  );
}

/** 2단계 인증 켜기(또는 휴대폰 바꾸기): QR로 인증 앱을 등록하고 첫 번호로 확인. */
function OtpEnableDialog({ onClose, onDone }: { onClose: () => void; onDone: (m: Me) => void }) {
  const [setup, setSetup] = useState<OtpSetup | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.post<OtpSetup>("/api/auth/me/otp/setup", {}).then(setSetup).catch((e) => setMsg((e as Error).message));
  }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) return setMsg("인증 앱에 보이는 6자리 숫자를 입력해 주세요.");
    setBusy(true);
    try {
      onDone(await api.post<Me>("/api/auth/me/otp/enable", { otpToken: setup!.otpToken, code }));
    } catch (er) {
      setMsg((er as Error).message);
      setCode("");
      setBusy(false);
    }
  };
  return (
    <Modal title={setup?.replaces ? "인증 앱 다시 등록 (휴대폰 바꾸기)" : "2단계 인증 켜기"} onClose={onClose}>
      {!setup ? (msg ? <FormMsg kind="bad" text={msg} /> : <Loading />) : (
        <form className="otp-dlg" noValidate onSubmit={submit}>
          {setup.replaces && <p className="hint" style={{ marginTop: 0 }}>새 휴대폰으로 등록하면 이전 휴대폰의 번호는 더 이상 쓸 수 없습니다.</p>}
          <OtpSetupPanel setup={setup} />
          <label htmlFor="otp-new">인증 앱 번호 6자리</label>
          <input id="otp-new" className="otp-in" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          <FormMsg kind={msg ? "bad" : undefined} text={msg} />
          <div className="otp-dlg-f">
            <button type="button" className="btn sm sec" onClick={onClose}>취소</button>
            <button type="submit" className="btn sm" disabled={busy}>{busy ? "확인 중…" : "확인하고 켜기"}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** 2단계 인증 끄기: 지금 인증 앱 번호로 본인 확인. */
function OtpDisableDialog({ onClose, onDone }: { onClose: () => void; onDone: (m: Me) => void }) {
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) return setMsg("인증 앱에 보이는 6자리 숫자를 입력해 주세요.");
    setBusy(true);
    try {
      onDone(await api.post<Me>("/api/auth/me/otp/disable", { code }));
    } catch (er) {
      setMsg((er as Error).message);
      setCode("");
      setBusy(false);
    }
  };
  return (
    <Modal title="2단계 인증 끄기" onClose={onClose}>
      <form className="otp-dlg" noValidate onSubmit={submit}>
        <p className="hint" style={{ marginTop: 0 }}>본인 확인을 위해 인증 앱의 지금 번호를 입력하세요. 끄면 비밀번호만으로 로그인합니다.</p>
        <label htmlFor="otp-off">인증 앱 번호 6자리</label>
        <input id="otp-off" className="otp-in" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
        <FormMsg kind={msg ? "bad" : undefined} text={msg} />
        <div className="otp-dlg-f">
          <button type="button" className="btn sm sec" onClick={onClose}>취소</button>
          <button type="submit" className="btn sm danger" disabled={busy}>{busy ? "확인 중…" : "끄기"}</button>
        </div>
      </form>
    </Modal>
  );
}

function PasswordTab({ me }: { me: Me }) {
  const { setMe } = useAuth();
  const [v, setV] = useState({ cur: "", next: "", again: "" });
  const [msg, setMsg] = useState<{ kind?: "ok" | "bad"; text: string }>({ text: "" });
  const [busy, setBusy] = useState(false);
  const r = pwRules(v.next, me);
  const level = pwLevel(v.next, r);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.cur || !v.next || !v.again) return setMsg({ kind: "bad", text: "모든 항목을 입력해 주세요." });
    if (!Object.values(r).every(Boolean)) return setMsg({ kind: "bad", text: "새 비밀번호가 규칙에 맞지 않습니다." });
    if (v.next !== v.again) return setMsg({ kind: "bad", text: "새 비밀번호가 일치하지 않습니다." });
    setBusy(true);
    try {
      const res = await api.put<{ passwordChangedAt: string }>("/api/auth/password", { currentPassword: v.cur, newPassword: v.next });
      setMe({ ...me, passwordChangedAt: res.passwordChangedAt, mustChangePassword: false });
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
      <p className="mpo">최근 로그인 기록 5건입니다. 본인이 아닌 기록이 있으면 비밀번호를 바꾸고 충청남도교육청(<a href="tel:041-640-7114">041-640-7114</a>)에 알려 주세요.</p>
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
