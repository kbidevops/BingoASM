"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { pwLevel, pwRules } from "@/lib/password";
import { FormMsg, Modal, useToast } from "./ui";

/**
 * 임시 비밀번호(관리자가 정한 비밀번호, Me.mustChangePassword)로 로그인하면 새 비밀번호를 정할 때까지 이 창이 떠 있다.
 * 닫을 수 없고, 바꾸거나 로그아웃만 할 수 있다. 바꾸면 서버가 표시를 지운다 (PUT /api/auth/password).
 */
export default function PasswordChangeGate() {
  const { me, setMe, signOut } = useAuth();
  const toast = useToast();
  const [v, setV] = useState({ cur: "", next: "", again: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  if (!me?.mustChangePassword) return null;

  const r = pwRules(v.next, me);
  const level = pwLevel(v.next, r);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.cur || !v.next || !v.again) return setMsg("모든 항목을 입력해 주세요.");
    if (!Object.values(r).every(Boolean)) return setMsg("새 비밀번호가 규칙에 맞지 않습니다.");
    if (v.next !== v.again) return setMsg("새 비밀번호가 일치하지 않습니다.");
    setBusy(true);
    setMsg("");
    try {
      const res = await api.put<{ passwordChangedAt: string }>("/api/auth/password", { currentPassword: v.cur, newPassword: v.next });
      setMe({ ...me, mustChangePassword: false, passwordChangedAt: res.passwordChangedAt });
      toast("새 비밀번호로 변경했습니다.");
    } catch (err) {
      setMsg((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title="비밀번호를 변경해 주세요" closable={false} onClose={() => {}}>
      <form className="pwg" noValidate onSubmit={submit}>
        <p className="pwg-lead">
          <b>{me.userName}</b>님은 관리자가 정한 <b>임시 비밀번호</b>로 로그인했습니다. 계속 쓰려면 본인만 아는 새 비밀번호로 바꿔 주세요.
        </p>
        <label className="pwg-f">
          <span>임시 비밀번호</span>
          <input type="password" autoComplete="current-password" value={v.cur} onChange={(e) => setV({ ...v, cur: e.target.value })} />
        </label>
        <label className="pwg-f">
          <span>새 비밀번호</span>
          <input type="password" autoComplete="new-password" value={v.next} onChange={(e) => setV({ ...v, next: e.target.value })} />
        </label>
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
        <label className="pwg-f">
          <span>새 비밀번호 확인</span>
          <input type="password" autoComplete="new-password" value={v.again} onChange={(e) => setV({ ...v, again: e.target.value })}
            aria-invalid={!!v.again && v.again !== v.next} />
          {v.again && v.again !== v.next && <small className="pwg-err">새 비밀번호가 일치하지 않습니다.</small>}
        </label>
        <FormMsg kind={msg ? "bad" : undefined} text={msg} />
        <div className="pwg-act">
          <button type="button" className="btn sm sec" onClick={() => signOut()}>로그아웃</button>
          <button type="submit" className="btn sm" disabled={busy}>{busy ? "변경 중…" : "비밀번호 변경"}</button>
        </div>
      </form>
    </Modal>
  );
}
