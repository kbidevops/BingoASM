"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Confirm, FilterField, FilterForm, ListHead } from "@/components/admin/common";
import SubPage from "@/components/SubPage";
import { ErrorBox, FormMsg, FormRow, Loading, Modal, Pager, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { fetchAll, loadSchools, type SchoolFull, type Vendor } from "@/lib/admin";
import { useAuth } from "@/lib/auth";
import { clearRegionCache, loadRegions } from "@/lib/boards";
import { fmtDate } from "@/lib/format";
import type { Region } from "@/lib/types";

/** 사용자 관리 (/api/users): `admin`과 도교육청이 계정을 등록·조회·수정·삭제한다. 삭제는 사용 중지다. */
export default function UsersPage() {
  return (
    <SubPage perm="USER_WRITE">
      <Users />
    </SubPage>
  );
}

interface UserRow {
  userId: number;
  loginId: string;
  userName: string;
  positionName?: string;
  email?: string;
  mobile?: string;
  status: "ACTIVE" | "LOCKED" | "DISABLED";
  locked: boolean;
  otpEnabled?: boolean;
  otpRegistered?: boolean;
  roles: string[];
  memberType: string;
  affiliation?: string;
  schoolId?: number;
  vendorId?: number;
  regionId?: number;
  lastLoginAt?: string;
}

type Affiliation = "school" | "vendor" | "region" | null;
const KINDS: { role: string; label: string; aff: Affiliation; topOnly?: boolean }[] = [
  { role: "SCHOOL_USER", label: "학교 담당자", aff: "school" },
  { role: "AS_ENGINEER", label: "AS 기사", aff: "vendor" },
  { role: "VENDOR_ADMIN", label: "업체 관리자", aff: "vendor" },
  { role: "REGION_ADMIN", label: "교육지원청 담당자", aff: "region" },
  { role: "EDU_ADMIN", label: "도교육청 관리자", aff: null },
  { role: "SYS_ADMIN", label: "시스템 관리자", aff: null, topOnly: true },
];
const TOP_ROLES = ["SYS_ADMIN", "SUPER_ADMIN"];
const kindOf = (u: UserRow) => KINDS.find((k) => u.roles.includes(k.role))?.role ?? "";

function Users() {
  const toast = useToast();
  const { me } = useAuth();
  const isTop = !!me?.roles.includes("SUPER_ADMIN");
  const [all, setAll] = useState<UserRow[] | null>(null);
  const [err, setErr] = useState("");
  const [kind, setKind] = useState("");
  const empty = { keyword: "" };
  const [draft, setDraft] = useState(empty);
  const [filter, setFilter] = useState(empty);
  const [showOff, setShowOff] = useState(false);
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<UserRow | "new" | null>(null);
  const [del, setDel] = useState<UserRow | null>(null);
  const [otpReset, setOtpReset] = useState<UserRow | null>(null);
  const [otpBusy, setOtpBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    setErr("");
    fetchAll<UserRow>("/api/users").then(setAll).catch((e) => setErr((e as Error).message));
  }, []);
  useEffect(load, [load]);

  const visible = useMemo(() => (all ?? []).filter((u) => showOff || u.status !== "DISABLED"), [all, showOff]);
  const shown = useMemo(() => {
    const q = filter.keyword.trim().toLowerCase();
    return visible.filter((u) =>
      (!kind || (kind === "ETC" ? !kindOf(u) : kindOf(u) === kind)) &&
      (!q || [u.loginId, u.userName, u.affiliation].some((x) => x?.toLowerCase().includes(q))));
  }, [visible, kind, filter]);

  if (err) return <ErrorBox message={err} onRetry={load} />;
  if (!all) return <Loading />;

  const size = 15;
  const pages = Math.max(1, Math.ceil(shown.length / size));
  const cur = Math.min(page, pages);
  const vis = shown.slice((cur - 1) * size, cur * size);
  const count = (role: string) => visible.filter((u) => (role === "ETC" ? !kindOf(u) : kindOf(u) === role)).length;
  const canTouch = (u: UserRow) => isTop || !u.roles.some((r) => TOP_ROLES.includes(r));

  const resetOtp = async (u: UserRow) => {
    setOtpBusy(true);
    try {
      await api.post(`/api/users/${u.userId}/otp-reset`, {});
      toast(`${u.userName}의 인증 앱 등록을 초기화했습니다. 다음 로그인 때 새로 등록합니다.`);
      setOtpReset(null);
      load();
    } catch (e) {
      setMsg((e as Error).message);
      setOtpReset(null);
    } finally {
      setOtpBusy(false);
    }
  };

  const unlock = async (u: UserRow) => {
    setMsg("");
    try {
      await api.post(`/api/users/${u.userId}/unlock`, {});
      toast(`${u.userName} 계정의 잠금을 풀었습니다.`);
      load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <>
      <div className="pills vd-regions" role="group" aria-label="구분">
        <button type="button" aria-pressed={!kind} onClick={() => { setKind(""); setPage(1); }}>전체 <b>{visible.length}</b></button>
        {KINDS.map((k) => (
          <button key={k.role} type="button" aria-pressed={kind === k.role} onClick={() => { setKind(k.role); setPage(1); }}>{k.label} <b>{count(k.role)}</b></button>
        ))}
        {count("ETC") > 0 && <button type="button" aria-pressed={kind === "ETC"} onClick={() => { setKind("ETC"); setPage(1); }}>기타 <b>{count("ETC")}</b></button>}
      </div>
      <FilterForm onSubmit={() => { setFilter(draft); setPage(1); }} onReset={() => { setDraft(empty); setFilter(empty); setKind(""); setShowOff(false); setPage(1); }}>
        <FilterField id="us-q" label="아이디·이름·소속">
          <input id="us-q" placeholder="검색어 입력" value={draft.keyword} onChange={(e) => setDraft({ keyword: e.target.value })} />
        </FilterField>
      </FilterForm>
      <FormMsg kind={msg ? "bad" : undefined} text={msg} />
      <ListHead total={shown.length} page={cur} pages={pages}>
        <label className="us-off"><input type="checkbox" checked={showOff} onChange={(e) => { setShowOff(e.target.checked); setPage(1); }} /> 삭제된 계정 표시</label>
        <button className="btn sm" type="button" onClick={() => setEdit("new")}>사용자 등록</button>
      </ListHead>
      <div className="tw">
        <table className="cards" style={{ minWidth: 780 }}>
          <thead><tr>{["아이디", "이름", "구분", "소속", "상태", "최근 로그인", "관리"].map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>
            {vis.length ? vis.map((u) => {
              const self = u.userId === me?.userId;
              const editable = canTouch(u);
              return (
                <tr key={u.userId}>
                  <td data-label="아이디">{u.loginId}</td>
                  <td data-label="이름" className="tl">{u.userName}{self && <span className="hint"> (나)</span>}</td>
                  <td data-label="구분">{u.memberType}</td>
                  <td data-label="소속" className="tl">{u.affiliation ?? "-"}</td>
                  <td data-label="상태">
                    {u.status === "DISABLED" ? <span className="hint">삭제됨</span> : u.locked ? <b className="st s4">잠김</b> : <b className="st s1">정상</b>}
                    {u.otpEnabled && <small className="hint" style={{ display: "block" }}>{u.otpRegistered ? "2단계 인증" : "2단계 인증 · 앱 미등록"}</small>}
                  </td>
                  <td data-label="최근 로그인">{u.lastLoginAt ? fmtDate(u.lastLoginAt) : "-"}</td>
                  <td data-label="관리" style={{ whiteSpace: "nowrap" }}>
                    {editable ? (
                      <>
                        {u.locked && <><button className="btn sm sec" type="button" onClick={() => unlock(u)}>잠금 해제</button>{" "}</>}
                        {u.otpRegistered && <><button className="btn sm sec" type="button" onClick={() => setOtpReset(u)}>OTP 초기화</button>{" "}</>}
                        <button className="btn sm sec" type="button" onClick={() => setEdit(u)}>수정</button>
                        {!self && u.status !== "DISABLED" && <>{" "}<button className="btn sm sec" type="button" onClick={() => setDel(u)}>삭제</button></>}
                      </>
                    ) : <span className="hint">통합 관리자만</span>}
                  </td>
                </tr>
              );
            }) : <tr><td colSpan={7}>조회된 사용자가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager page={cur} totalPages={pages} onPage={setPage} />
      {edit && (
        <UserForm user={edit === "new" ? null : edit} isTop={isTop} self={edit !== "new" && edit.userId === me?.userId} onClose={() => setEdit(null)}
          onSaved={(m) => { setEdit(null); toast(m); load(); }} />
      )}
      {del && <DeleteUser user={del} onClose={() => setDel(null)} onDeleted={(m) => { setDel(null); toast(m); load(); }} />}
      {otpReset && (
        <Modal title="OTP 초기화" onClose={() => setOtpReset(null)}>
          <Confirm text={`${otpReset.userName}(${otpReset.loginId})의 인증 앱 등록을 지울까요? 휴대폰을 잃어버렸거나 바꾼 경우에 씁니다. 2단계 인증은 계속 켜져 있어, 다음 로그인 때 새 휴대폰으로 다시 등록합니다.`}
            busy={otpBusy} onNo={() => setOtpReset(null)} onYes={() => resetOtp(otpReset)} />
        </Modal>
      )}
    </>
  );
}

function DeleteUser({ user, onClose, onDeleted }: { user: UserRow; onClose: () => void; onDeleted: (m: string) => void }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    setMsg("");
    try {
      await api.del(`/api/users/${user.userId}`);
      onDeleted(`${user.userName} 계정을 삭제했습니다.`);
    } catch (e) {
      setMsg((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal title={`사용자 삭제 · ${user.userName}`} onClose={onClose}>
      <ul className="dash" style={{ margin: 0 }}>
        <li>이 계정으로 더 이상 로그인할 수 없습니다.</li>
        <li>학교의 기본 담당 기사로 지정되어 있으면 해제됩니다.</li>
        <li>지난 AS와 이력의 이름은 그대로 남습니다.</li>
      </ul>
      {msg && <FormMsg kind="bad" text={msg} />}
      <Confirm text={`${user.loginId} 계정을 삭제할까요? ‘삭제된 계정 표시’에서 찾아 다시 사용하게 할 수 있습니다.`} busy={busy} onYes={remove} onNo={onClose} />
    </Modal>
  );
}

function UserForm({ user, isTop, self, onClose, onSaved }: { user: UserRow | null; isTop: boolean; self: boolean; onClose: () => void; onSaved: (m: string) => void }) {
  const initialKind = user ? kindOf(user) : "SCHOOL_USER";
  const [v, setV] = useState({
    loginId: user?.loginId ?? "", userName: user?.userName ?? "", positionName: user?.positionName ?? "", email: user?.email ?? "", mobile: user?.mobile ?? "",
    kind: initialKind, schoolId: user?.schoolId ? String(user.schoolId) : "", vendorId: user?.vendorId ? String(user.vendorId) : "", regionId: user?.regionId ? String(user.regionId) : "",
    status: user?.status === "DISABLED" ? "DISABLED" : "ACTIVE", password: "",
  });
  const [schools, setSchools] = useState<SchoolFull[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });

  useEffect(() => {
    loadSchools().then(setSchools).catch(() => {});
    api.get<Vendor[]>("/api/as/vendors").then(setVendors).catch(() => {});
    clearRegionCache();
    loadRegions().then(setRegions).catch(() => {});
  }, []);

  // 기타 = 예전 자산관리 역할 등 이 화면의 구분에 없는 계정. 역할과 소속을 그대로 둔다.
  const aff = KINDS.find((k) => k.role === v.kind)?.aff ?? null;
  const keepsRole = !v.kind;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user && !v.loginId.trim()) return setMsg("아이디를 입력해 주세요.");
    if (!v.userName.trim()) return setMsg("이름을 입력해 주세요.");
    if (!user && !v.password) return setMsg("임시 비밀번호를 입력해 주세요.");
    if (aff === "school" && !v.schoolId) return setMsg("소속 학교를 선택해 주세요.");
    if (aff === "vendor" && !v.vendorId) return setMsg("소속 업체를 선택해 주세요.");
    if (aff === "region" && !v.regionId) return setMsg("소속 교육지원청을 선택해 주세요.");
    setBusy(true);
    setMsg("");
    const body: Record<string, unknown> = {
      userName: v.userName.trim(), positionName: v.positionName.trim() || null, email: v.email.trim() || null, mobile: v.mobile.trim() || null,
    };
    if (!keepsRole) {
      body.schoolId = aff === "school" ? Number(v.schoolId) : null;
      body.vendorId = aff === "vendor" ? Number(v.vendorId) : null;
      body.regionId = aff === "region" ? Number(v.regionId) : null;
    }
    // 역할은 바꿀 때만 보낸다: 통합 관리자(SYS_ADMIN+SUPER_ADMIN)처럼 함께 가진 역할을 잃지 않도록.
    if (!user || v.kind !== initialKind) body.roles = [v.kind];
    if (v.password) body.password = v.password;
    try {
      if (user) {
        if (!self) body.status = v.status;
        await api.put(`/api/users/${user.userId}`, body);
      } else {
        await api.post("/api/users", { ...body, loginId: v.loginId.trim() });
      }
      onSaved(user ? "사용자 정보를 저장했습니다." : "사용자를 등록했습니다.");
    } catch (er) {
      setMsg((er as Error).message);
      setBusy(false);
    }
  };

  const activeVendors = vendors;
  return (
    <Modal title={user ? `사용자 수정 · ${user.loginId}` : "사용자 등록"} wide onClose={onClose}>
      <form className="ft2" noValidate onSubmit={save}>
        <table className="ftab"><tbody>
          <FormRow label="아이디" required={!user}>
            {user ? <b>{user.loginId}</b> : <input aria-label="아이디" autoComplete="off" value={v.loginId} onChange={set("loginId")} />}
          </FormRow>
          <FormRow label="이름" required><input aria-label="이름" value={v.userName} onChange={set("userName")} /></FormRow>
          <FormRow label="구분" required>
            <select aria-label="구분" value={v.kind} disabled={self} onChange={set("kind")}>
              {!initialKind && <option value="">기타 ({user?.memberType})</option>}
              {KINDS.filter((k) => !k.topOnly || isTop || initialKind === k.role).map((k) => <option key={k.role} value={k.role}>{k.label}</option>)}
            </select>
            {self && <small className="hint"> 본인의 구분은 바꿀 수 없습니다.</small>}
          </FormRow>
          {aff === "school" && (
            <FormRow label="소속 학교" required>
              <select aria-label="소속 학교" value={v.schoolId} onChange={set("schoolId")}>
                <option value="">-- 선택 --</option>
                {schools.map((s) => <option key={s.schoolId} value={s.schoolId}>{s.schoolName}</option>)}
              </select>
            </FormRow>
          )}
          {aff === "vendor" && (
            <FormRow label="소속 업체" required>
              <select aria-label="소속 업체" value={v.vendorId} onChange={set("vendorId")}>
                <option value="">-- 선택 --</option>
                {activeVendors.map((x) => <option key={x.vendorId} value={x.vendorId}>{x.vendorName}</option>)}
              </select>
            </FormRow>
          )}
          {aff === "region" && (
            <FormRow label="소속 교육지원청" required>
              <select aria-label="소속 교육지원청" value={v.regionId} onChange={set("regionId")}>
                <option value="">-- 선택 --</option>
                {regions.map((r) => <option key={r.regionId} value={r.regionId}>{r.regionName}</option>)}
              </select>
            </FormRow>
          )}
          <FormRow label="직위"><input aria-label="직위" value={v.positionName} onChange={set("positionName")} /></FormRow>
          <FormRow label="이메일"><input aria-label="이메일" type="email" autoComplete="off" value={v.email} onChange={set("email")} /></FormRow>
          <FormRow label="휴대전화"><input aria-label="휴대전화" inputMode="tel" placeholder="010-0000-0000" value={v.mobile} onChange={set("mobile")} /></FormRow>
          <FormRow label={user ? "새 비밀번호" : "임시 비밀번호"} required={!user}>
            <input aria-label={user ? "새 비밀번호" : "임시 비밀번호"} type="password" autoComplete="new-password" value={v.password} onChange={set("password")} />
            <small className="hint"> {user ? "바꿀 때만 입력합니다. " : ""}사용자에게 따로 알려 주세요.</small>
          </FormRow>
          {user && !self && (
            <FormRow label="계정 상태">
              <select aria-label="계정 상태" value={v.status} onChange={set("status")}>
                <option value="ACTIVE">사용</option>
                <option value="DISABLED">삭제됨 (로그인 불가)</option>
              </select>
            </FormRow>
          )}
        </tbody></table>
        <FormMsg kind={msg ? "bad" : undefined} text={msg} />
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <button type="button" className="btn sm sec" onClick={onClose}>취소</button>
          <button type="submit" className="btn sm" disabled={busy}>{busy ? "저장 중…" : "저장"}</button>
        </div>
      </form>
    </Modal>
  );
}
