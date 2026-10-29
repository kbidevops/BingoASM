"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import QrCode from "@/components/QrCode";
import SubPage from "@/components/SubPage";
import { useToast } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDateTime, LOGIN_METHOD, mmss } from "@/lib/format";
import type { LoginLog, LoginResult, Me } from "@/lib/types";

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}

/** Only same-site paths are allowed as the post-login destination. */
function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

function Login() {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const { status, signIn, notice, clearNotice } = useAuth();
  const [tab, setTab] = useState<"id" | "qr">("id");
  const next = safeNext(params.get("next"));

  useEffect(() => {
    if (status === "authed") router.replace(next);
  }, [status, next, router]);

  const done = useCallback(
    (res: LoginResult) => {
      signIn({ accessToken: res.accessToken!, refreshToken: res.refreshToken! }, res.me as Me);
      // Show the previous successful login so the user can spot someone else's.
      api.get<LoginLog[]>("/api/auth/me/logins")
        .then((logs) => {
          const prev = logs.filter((l) => l.success)[1];
          toast("로그인했습니다. 마지막 로그인: " + (prev ? `${fmtDateTime(prev.loginAt)} · ${LOGIN_METHOD[prev.method]}` : "없음"));
        })
        .catch(() => toast("로그인했습니다."));
      clearNotice();
    },
    [signIn, toast, clearNotice],
  );

  return (
    <SubPage title="통합 로그인" side={false}>
      <div className="lg-wrap">
        <section className="card lg-card">
          <div className="tabs lg-tabs" role="tablist" aria-label="로그인 방식">
            <button type="button" role="tab" aria-selected={tab === "id"} onClick={() => setTab("id")}>아이디 로그인</button>
            <button type="button" role="tab" aria-selected={tab === "qr"} onClick={() => setTab("qr")}>QR 로그인</button>
          </div>
          <div id="lgbody">{tab === "id" ? <IdLogin notice={notice} onDone={done} /> : <QrLogin onDone={done} />}</div>
        </section>
        <aside className="lg-side">
          <h3>안전한 로그인 안내</h3>
          <ul className="dash">
            <li>비밀번호를 5회 연속 틀리면 30분 동안 잠깁니다.</li>
            <li>2단계 인증을 켠 계정은 비밀번호 확인 후 소통메신저로 받은 6자리 인증번호를 한 번 더 입력합니다.</li>
            <li>30분 동안 사용이 없으면 자동으로 로그아웃됩니다.</li>
            <li>공용 PC에서는 사용 후 반드시 로그아웃해 주세요.</li>
          </ul>
          {process.env.NODE_ENV === "development" && (
            <p className="lg-demo">
              <b>개발용 데모 계정</b> (README 5절)<br />
              학교 <code>school01</code> · 기사 <code>netengineer</code> · 교육청 <code>eduadmin</code>(OTP) · 교육지원청 <code>regionadmin</code><br />
              비밀번호 <code>user1234!</code> · 관리자 <code>admin</code> / <code>admin1234!</code>
            </p>
          )}
        </aside>
      </div>
    </SubPage>
  );
}

function IdLogin({ notice, onDone }: { notice: string; onDone: (r: LoginResult) => void }) {
  const [loginId, setLoginId] = useState("");
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [msg, setMsg] = useState(notice);
  const [busy, setBusy] = useState(false);
  const [otp, setOtp] = useState<{ token: string; exp: number; devCode?: string } | null>(null);
  const pwRef = useRef<HTMLInputElement>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginId.trim() || !pw) return setMsg("아이디와 비밀번호를 모두 입력하세요.");
    setBusy(true);
    setMsg("");
    try {
      const res = await api.post<LoginResult>("/api/auth/login", { loginId: loginId.trim(), password: pw });
      if (res.step === "otp") {
        setOtp({ token: res.otpToken!, exp: Date.now() + 5 * 60_000, devCode: res.devCode });
        setPw("");
      } else onDone(res);
    } catch (err) {
      setMsg((err as Error).message);
      pwRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  if (otp) return <OtpForm otp={otp} setOtp={setOtp} onDone={onDone} onCancel={() => setOtp(null)} />;

  return (
    <>
      <form className="login-form sec-login" noValidate onSubmit={submit}>
        <label htmlFor="id">아이디</label>
        <input id="id" name="id" autoComplete="username" required value={loginId} onChange={(e) => setLoginId(e.target.value)} autoFocus />
        <label htmlFor="pw">비밀번호</label>
        <div className="pwbox">
          <input id="pw" ref={pwRef} name="pw" type={show ? "text" : "password"} autoComplete="current-password" required value={pw}
            onChange={(e) => setPw(e.target.value)} onKeyUp={(e) => setCaps(e.getModifierState("CapsLock"))} />
          <button type="button" className="pwtog" aria-label={show ? "비밀번호 숨기기" : "비밀번호 보기"} aria-pressed={show} onClick={() => setShow((v) => !v)}>
            {show ? "숨기기" : "보기"}
          </button>
        </div>
        <p className="caps" role="status" hidden={!caps}>Caps Lock이 켜져 있습니다.</p>
        <p className="lg-msg" role="alert">{msg}</p>
        <button className="btn" type="submit" disabled={busy}>{busy ? "확인 중…" : "로그인"}</button>
      </form>
      <div className="links">
        <span className="hint">아이디 찾기 · 비밀번호 재설정은 학교정보화지원팀(043-290-2885)에 문의해 주세요.</span>
      </div>
    </>
  );
}

function OtpForm({ otp, setOtp, onDone, onCancel }: {
  otp: { token: string; exp: number; devCode?: string };
  setOtp: (o: { token: string; exp: number; devCode?: string }) => void;
  onDone: (r: LoginResult) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState((otp.exp - Date.now()) / 1000);

  useEffect(() => {
    const t = setInterval(() => setLeft((otp.exp - Date.now()) / 1000), 1000);
    return () => clearInterval(t);
  }, [otp.exp]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (left <= 0) return setMsg("인증번호 유효시간이 지났습니다. 다시 받아 주세요.");
    if (!/^\d{6}$/.test(code)) return setMsg("6자리 숫자를 입력해 주세요.");
    setBusy(true);
    try {
      onDone(await api.post<LoginResult>("/api/auth/otp/verify", { otpToken: otp.token, code }));
    } catch (err) {
      setMsg((err as Error).message);
      setBusy(false);
    }
  };

  const resend = async () => {
    try {
      const res = await api.post<LoginResult>("/api/auth/otp/resend", { otpToken: otp.token });
      setOtp({ token: res.otpToken!, exp: Date.now() + 5 * 60_000, devCode: res.devCode });
      setCode("");
      setMsg("새 인증번호를 보냈습니다. 이전 번호는 더 이상 쓸 수 없습니다.");
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  return (
    <form className="login-form" noValidate onSubmit={submit}>
      <h3 className="lg-h">2단계 인증</h3>
      <p className="hint" style={{ margin: "0 0 6px" }}>소통메신저로 보낸 6자리 인증번호를 입력하세요. <b className="otp-t">{mmss(left)}</b> 남음</p>
      <label htmlFor="otp">인증번호 6자리</label>
      <input id="otp" name="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="otp-in" required autoFocus
        value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
      <p className="lg-msg" role="alert">{msg}</p>
      <button className="btn" type="submit" disabled={busy}>{busy ? "확인 중…" : "확인"}</button>
      <div className="otp-row">
        <button type="button" className="linkbtn" onClick={resend}>인증번호 다시 받기</button>
        <button type="button" className="linkbtn" onClick={onCancel}>처음으로</button>
      </div>
      {otp.devCode && (
        <p className="lg-demo" style={{ marginTop: 12 }}><small>개발 모드(OTP_DEV_ECHO): 메신저 대신 여기 표시 → 인증번호 <b>{otp.devCode}</b></small></p>
      )}
    </form>
  );
}

interface QrSession {
  token: string;
  num: string;
  qrText: string;
  exp: number;
}

/** PC side: show the QR, poll every 2 s until a signed-in phone approves it (3-minute session). */
function QrLogin({ onDone }: { onDone: (r: LoginResult) => void }) {
  const [qr, setQr] = useState<QrSession | null>(null);
  const [state, setState] = useState<"pending" | "expired" | "rejected" | "error">("pending");
  const [msg, setMsg] = useState("");
  const [left, setLeft] = useState(180);

  const start = useCallback(async () => {
    setState("pending");
    setMsg("");
    try {
      const res = await api.post<{ token: string; num: string; qrText: string }>("/api/auth/qr/start");
      setQr({ ...res, exp: Date.now() + 180_000 });
    } catch (err) {
      setState("error");
      setMsg((err as Error).message);
    }
  }, []);
  useEffect(() => {
    start();
  }, [start]);

  useEffect(() => {
    if (!qr || state !== "pending") return;
    const tick = setInterval(() => {
      const l = (qr.exp - Date.now()) / 1000;
      setLeft(l);
      if (l <= 0) setState("expired");
    }, 1000);
    const poll = setInterval(async () => {
      try {
        const res = await api.get<LoginResult & { status: string }>(`/api/auth/qr/${qr.token}`);
        if (res.status === "APPROVED" && res.accessToken) onDone(res);
        else if (res.status === "EXPIRED" || res.status === "CONSUMED") setState("expired");
        else if (res.status === "REJECTED") setState("rejected");
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) setState("expired");
      }
    }, 2000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [qr, state, onDone]);

  if (state === "error") return <p className="lg-msg" role="alert">{msg} <button type="button" className="linkbtn" onClick={start}>다시 시도</button></p>;
  if (!qr) return <p className="hint">QR을 만드는 중입니다…</p>;
  const over = state !== "pending";
  return (
    <div className="qrl">
      <div className={"qrl-code" + (over ? " exp" : "")}>
        <QrCode text={qr.qrText} label="QR 로그인 코드" />
        {over && (
          <div className="qrl-ov">
            <p>{state === "rejected" ? "휴대폰에서 로그인을 거절했습니다." : "QR이 만료되었습니다."}</p>
            <button className="btn sm" type="button" onClick={start}>새 QR 받기</button>
          </div>
        )}
      </div>
      <p className="qrl-t" role="timer">{over ? "만료됨" : <><b className="qr-t">{mmss(left)}</b> 후 만료</>}</p>
      <ol className="qrl-steps">
        <li>이미 로그인한 휴대폰의 카메라(또는 소통메신저 QR 스캔)로 이 코드를 찍습니다.</li>
        <li>휴대폰에 열린 화면에서 이 숫자 <b className="qrl-n">{qr.num}</b>를 고르고 승인합니다.</li>
        <li>승인하면 이 PC에서 자동으로 로그인됩니다.</li>
      </ol>
    </div>
  );
}
