"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import SubPage from "@/components/SubPage";
import { ErrorBox, FormMsg, Loading, useToast } from "@/components/ui";
import { api, rows, type Page } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { MENU, type MenuItem } from "@/lib/menu";
import type { Me } from "@/lib/types";

/**
 * 사용자 메뉴 권한 (/api/users/{id}/menu-perms): 사용자별로 메뉴·하위메뉴와 AS 처리 기능을 켜고 끈다.
 * 메뉴는 권한 코드로 열리므로, 숨긴 메뉴는 그 기능(API)도 함께 막힌다.
 */
export default function UserMenusPage() {
  return (
    <SubPage perm="ROLE_GRANT">
      <UserMenus />
    </SubPage>
  );
}

interface UserRow {
  userId: number;
  loginId: string;
  userName: string;
  roles: string[];
  status: string;
  permOverrides?: number;
}

interface MenuPerms {
  userId: number;
  loginId: string;
  userName: string;
  roles: string[];
  menuPerms: string[];
  actionPerms: string[];
  base: string[];
  granted: string[];
  denied: string[];
  effective: string[];
  /** Menus of AS services the user's 교육청 does not use — off for everyone, not adjustable here. */
  disabled?: string[];
}

const ROLE_NAME: Record<string, string> = {
  SUPER_ADMIN: "통합 관리자", SYS_ADMIN: "시스템 관리자", EDU_ADMIN: "교육청 관리자", REGION_ADMIN: "교육지원청 담당자",
  VENDOR_ADMIN: "업체 관리자", AS_ENGINEER: "AS 기사", SCHOOL_USER: "학교 담당자",
  REQUESTER: "요청자", RECEIVER: "접수자", PROCESSOR: "처리자",
};
const roleNames = (roles: string[]) => roles.map((r) => ROLE_NAME[r] ?? r);

/** 목록 필터: 역할 묶음 + 조정된 사용자. */
const FILTERS: [string, string, (u: UserRow) => boolean][] = [
  ["all", "전체", () => true],
  ["admin", "관리자", (u) => u.roles.some((r) => ["SUPER_ADMIN", "SYS_ADMIN", "EDU_ADMIN", "REGION_ADMIN"].includes(r))],
  ["school", "학교", (u) => u.roles.includes("SCHOOL_USER")],
  ["vendor", "업체", (u) => u.roles.some((r) => r === "AS_ENGINEER" || r === "VENDOR_ADMIN")],
  ["custom", "조정됨", (u) => !!u.permOverrides],
];

/** AS 처리 기능 (Roles.ACTION_PERMS). 역할에 있는 것만 끌 수 있다 — 상태·소속 조건은 서버가 그대로 본다. */
const ACTIONS: [string, string, string][] = [
  ["AS_RECEIVE", "접수", "신청 건을 접수하고 방문 일정을 잡습니다."],
  ["AS_RETURN", "반려 · 반려 취소", "신청 건을 반려하거나 반려를 되돌립니다."],
  ["AS_TRANSFER", "이관", "다른 AS 유형(업체)으로 넘깁니다."],
  ["AS_CANCEL", "신청 취소", "신청완료·반려 상태의 신청을 취소합니다."],
  ["AS_DELETE", "삭제", "AS 기록을 영구 삭제합니다."],
];

/** perm → menu titles that open with it (several items can share one permission). */
const PERM_TITLES = MENU.flatMap((g) => g.items).reduce<Record<string, string[]>>((m, i) => {
  if (i.perm) (m[i.perm] ??= []).push(i.title);
  return m;
}, {});

function UserMenus() {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [err, setErr] = useState("");
  const [keyword, setKeyword] = useState("");
  const [filter, setFilter] = useState("all");
  const [sel, setSel] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(() => {
    setErr("");
    api.get<Page<UserRow>>("/api/users", { size: 500 }).then((p) => setUsers(rows(p))).catch((e) => setErr(e.message));
  }, []);
  useEffect(load, [load]);

  const shown = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const pick = FILTERS.find(([k]) => k === filter)![2];
    return (users ?? []).filter((u) => pick(u) && (!kw || u.loginId.toLowerCase().includes(kw) || u.userName.toLowerCase().includes(kw)));
  }, [users, keyword, filter]);

  const choose = (id: number) => {
    if (id === sel) return;
    if (dirty && !window.confirm("저장하지 않은 변경이 있습니다. 다른 사용자로 이동할까요?")) return;
    setDirty(false);
    setSel(id);
  };

  if (err) return <ErrorBox message={err} onRetry={load} />;
  if (!users) return <Loading />;

  return (
    <div className="um">
      <aside className="um-side" aria-label="사용자 목록">
        <div className="um-side-h">
          <b>사용자</b>
          <span className="um-count">{shown.length}명</span>
        </div>
        <label className="um-search">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" /><path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          <input aria-label="사용자 검색" placeholder="아이디·이름 검색" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        </label>
        <div className="um-filters" role="group" aria-label="역할로 거르기">
          {FILTERS.map(([k, label, pick]) => (
            <button key={k} type="button" className="chipb" aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {label} <span className="um-fc">{users.filter(pick).length}</span>
            </button>
          ))}
        </div>
        <ul className="um-users">
          {shown.length ? shown.map((u) => (
            <li key={u.userId}>
              <button type="button" className="um-user" aria-current={sel === u.userId ? "true" : undefined} onClick={() => choose(u.userId)}>
                <span className="um-av" aria-hidden="true">{u.userName.slice(0, 1)}</span>
                <span className="um-who">
                  <b>{u.userName} <small>{u.loginId}</small></b>
                  <small>{roleNames(u.roles).join(" · ")}</small>
                </span>
                {!!u.permOverrides && <span className="um-dot" title={`조정 ${u.permOverrides}건`}>{u.permOverrides}</span>}
                {u.status !== "ACTIVE" && <span className="um-off">{u.status === "LOCKED" ? "잠김" : "중지"}</span>}
              </button>
            </li>
          )) : <li className="um-empty">조건에 맞는 사용자가 없습니다.</li>}
        </ul>
      </aside>
      <section className="um-main" aria-label="메뉴 권한">
        {sel === null ? (
          <div className="um-blank">
            <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            <b>사용자를 선택하세요</b>
            <p>왼쪽 목록에서 사용자를 고르면 메뉴와 AS 처리 기능을 하나씩 켜고 끌 수 있습니다.</p>
          </div>
        ) : (
          <Editor key={sel} userId={sel} onDirty={setDirty} onSaved={(id, n) => setUsers((us) => us && us.map((u) => (u.userId === id ? { ...u, permOverrides: n } : u)))} />
        )}
      </section>
    </div>
  );
}

function Editor({ userId, onDirty, onSaved }: { userId: number; onDirty: (d: boolean) => void; onSaved: (id: number, overrides: number) => void }) {
  const toast = useToast();
  const { me, setMe } = useAuth();
  const [data, setData] = useState<MenuPerms | null>(null);
  const [granted, setGranted] = useState<Set<string>>(new Set());
  const [denied, setDenied] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const apply = (d: MenuPerms) => {
    setData(d);
    setGranted(new Set(d.granted));
    setDenied(new Set(d.denied));
  };
  useEffect(() => {
    api.get<MenuPerms>(`/api/users/${userId}/menu-perms`).then(apply).catch((e) => setMsg(e.message));
  }, [userId]);

  // 저장된 값과 달라진 권한 수
  const changes = useMemo(() => {
    if (!data) return 0;
    const diff = (a: Set<string>, b: string[]) => [...a].filter((x) => !b.includes(x)).length + b.filter((x) => !a.has(x)).length;
    return diff(granted, data.granted) + diff(denied, data.denied);
  }, [data, granted, denied]);
  useEffect(() => onDirty(changes > 0), [changes, onDirty]);

  if (!data) return msg ? <FormMsg kind="bad" text={msg} /> : <Loading />;
  const base = new Set(data.base);
  const menuPerms = new Set(data.menuPerms);
  const disabled = new Set(data.disabled ?? []);
  const isOn = (p: string) => !disabled.has(p) && (base.has(p) || granted.has(p)) && !denied.has(p);
  const editable = (i: MenuItem) => !!i.perm && menuPerms.has(i.perm) && !disabled.has(i.perm);

  const toggle = (perms: string[], on: boolean) => {
    const g = new Set(granted), d = new Set(denied);
    for (const p of perms) {
      if (on) { d.delete(p); if (!base.has(p)) g.add(p); }
      else { g.delete(p); if (base.has(p)) d.add(p); }
    }
    setGranted(g);
    setDenied(d);
    setMsg("");
  };

  const save = async () => {
    setBusy(true);
    try {
      const d = await api.put<MenuPerms>(`/api/users/${userId}/menu-perms`, { granted: [...granted], denied: [...denied] });
      apply(d);
      onSaved(userId, d.granted.length + d.denied.length);
      toast(`${d.userName}님의 권한을 저장했습니다.`);
      // 내 계정을 바꿨으면 메뉴가 바로 바뀌도록 권한을 다시 읽는다.
      if (me?.userId === userId) api.get<Me>("/api/auth/me").then(setMe).catch(() => {});
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const menuItemPerms = [...new Set(MENU.flatMap((g) => g.items).filter(editable).map((i) => i.perm!))];
  const visible = menuItemPerms.filter(isOn).length;

  const status = (p: string) =>
    denied.has(p) ? <span className="um-pill off">숨김</span>
      : granted.has(p) ? <span className="um-pill add">추가</span>
        : base.has(p) ? <span className="um-pill">역할 기본</span> : <span className="um-pill none">권한 없음</span>;

  return (
    <>
      <header className="um-head">
        <span className="um-av lg" aria-hidden="true">{data.userName.slice(0, 1)}</span>
        <div className="um-head-t">
          <h3>{data.userName} <small>{data.loginId}</small></h3>
          <div className="um-roles">{roleNames(data.roles).map((r) => <span key={r} className="um-role">{r}</span>)}</div>
        </div>
        <dl className="um-stats">
          <div><dt>보이는 메뉴</dt><dd>{visible}<small>/{menuItemPerms.length}</small></dd></div>
          <div><dt>숨김</dt><dd className={denied.size ? "off" : ""}>{denied.size}</dd></div>
          <div><dt>추가</dt><dd className={granted.size ? "add" : ""}>{granted.size}</dd></div>
        </dl>
      </header>

      <p className="um-note">
        켠 메뉴만 보입니다. 끈 메뉴는 화면과 기능(API)이 함께 막히고, 같은 권한을 쓰는 메뉴는 함께 바뀝니다.
      </p>

      <h4 className="um-sec">메뉴</h4>
      <div className="um-groups">
        {MENU.map((g) => {
          const perms = [...new Set(g.items.filter(editable).map((i) => i.perm!))];
          const onCount = perms.filter(isOn).length;
          const unused = g.items.every((i) => i.perm && disabled.has(i.perm));
          return (
            <section key={g.title} className={"um-card" + (g.hidden || unused ? " muted" : "")} aria-label={g.title}>
              <div className="um-card-h">
                <div>
                  <b>{g.title}</b>
                  <small>{perms.length ? `${onCount}/${perms.length} 켜짐` : "조정할 메뉴 없음"}</small>
                  {g.hidden && <span className="um-pill warn">사이트 전체에서 숨김</span>}
                  {unused && <span className="um-pill warn">교육청에서 쓰지 않는 서비스</span>}
                </div>
                <Switch label={`${g.title} 전체`} disabled={!perms.length} checked={perms.length > 0 && onCount === perms.length}
                  mixed={onCount > 0 && onCount < perms.length} onChange={(on) => toggle(perms, on)} />
              </div>
              <ul className="um-items">
                {g.items.map((i) => {
                  const shared = i.perm ? PERM_TITLES[i.perm].filter((t) => t !== i.title) : [];
                  return (
                    <li key={i.href} className={editable(i) ? "" : "fixed"}>
                      <div className="um-item-t">
                        <span>{i.title}</span>
                        {shared.length > 0 && <small>함께 바뀜: {shared.join(", ")}</small>}
                      </div>
                      {!i.perm ? <span className="um-pill none">공개</span>
                        : disabled.has(i.perm) ? <span className="um-pill none">서비스 미사용</span>
                          : editable(i) ? status(i.perm) : <span className="um-pill none">관리자 전용</span>}
                      <Switch label={i.title} disabled={!editable(i)} checked={!i.perm || isOn(i.perm)} onChange={(on) => toggle([i.perm!], on)} />
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <h4 className="um-sec">AS 처리 기능</h4>
      {(() => {
        const perms = ACTIONS.map(([p]) => p).filter((p) => data.actionPerms.includes(p) && base.has(p));
        const onCount = perms.filter(isOn).length;
        return (
          <section className="um-card" aria-label="AS 처리 기능">
            <div className="um-card-h">
              <div>
                <b>처리 버튼</b>
                <small>{perms.length ? `${onCount}/${perms.length} 켜짐` : "이 역할에는 처리 기능이 없습니다"}</small>
              </div>
              <Switch label="AS 처리 기능 전체" disabled={!perms.length} checked={perms.length > 0 && onCount === perms.length}
                mixed={onCount > 0 && onCount < perms.length} onChange={(on) => toggle(perms, on)} />
            </div>
            <ul className="um-items">
              {ACTIONS.map(([p, label, desc]) => (
                <li key={p} className={base.has(p) ? "" : "fixed"}>
                  <div className="um-item-t">
                    <span>{label}</span>
                    <small>{desc}</small>
                  </div>
                  {base.has(p) ? (denied.has(p) ? <span className="um-pill off">꺼짐</span> : <span className="um-pill">역할 기본</span>) : <span className="um-pill none">역할에 없음</span>}
                  <Switch label={label} disabled={!base.has(p)} checked={isOn(p)} onChange={(on) => toggle([p], on)} />
                </li>
              ))}
            </ul>
            <p className="um-card-f">끄면 해당 버튼이 사라지고 서버에서도 막힙니다. 역할에 없는 기능은 켤 수 없습니다.</p>
          </section>
        );
      })()}

      <FormMsg kind={msg ? "bad" : undefined} text={msg} />
      <div className={"um-bar" + (changes ? " dirty" : "")} role="region" aria-label="저장">
        <span className="um-bar-t" aria-live="polite">{changes ? `저장하지 않은 변경 ${changes}건` : "모든 변경이 저장되었습니다"}</span>
        <button type="button" className="btn sm sec" disabled={busy || (!granted.size && !denied.size)}
          onClick={() => { setGranted(new Set()); setDenied(new Set()); }}>역할 기본값으로</button>
        <button type="button" className="btn sm sec" disabled={busy || !changes} onClick={() => apply(data)}>되돌리기</button>
        <button type="button" className="btn sm" disabled={busy || !changes} onClick={save}>{busy ? "저장 중…" : "저장"}</button>
      </div>
    </>
  );
}

/** Native checkbox styled as a switch (keyboard and screen readers work as a checkbox). */
function Switch({ label, checked, mixed, disabled, onChange }: { label: string; checked: boolean; mixed?: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <input type="checkbox" role="switch" className={"um-sw" + (mixed ? " mixed" : "")} aria-label={label} aria-checked={mixed ? "mixed" : checked}
      checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
  );
}
