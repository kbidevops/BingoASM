"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import SubPage from "@/components/SubPage";
import { ErrorBox, FormMsg, Loading, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { EDITS, MENU } from "@/lib/menu";
import type { Me } from "@/lib/types";

/**
 * 관리자 메뉴 → 역할 권한 관리 (/api/org/role-perms).
 * 역할을 하나 고르고, 그 역할의 메뉴 · 메뉴 안의 기능 · AS 처리 기능을 메뉴 묶음별로 켜고 끈다 (사용자 메뉴 권한과 같은 모양).
 * 여러 역할을 한 번에 비교하려면 ‘역할 비교’(읽기 전용 표). 바꾼 값은 그 역할의 모든 사용자에게 바로 적용된다.
 */
export default function Page() {
  return (
    <SubPage perm="ORG_WRITE">
      <RolePerms />
    </SubPage>
  );
}

interface RoleRow {
  role: string;
  name: string;
  /** 역할 기본값 전체 (조정할 수 없는 권한 포함) */
  defaults: string[];
  granted: string[];
  denied: string[];
  /** 업체 역할: 소속 업체의 담당 유형일 때만 열리는 신청·조회 메뉴 */
  vendorTyped: string[];
  /** 이 역할(계정 종류)에는 줄 수 없는 권한 — 보이되 잠긴다 */
  blocked?: string[];
  /** perm → 잠긴 이유 */
  lockedReasons?: Record<string, string>;
  /** perm → 켜도 소속 범위 때문에 일부만 되는 것 */
  limits: Record<string, string>;
  userCount: number;
}
interface Feature { code: string; parent: string; label: string }
interface RolePermsData {
  roles: RoleRow[];
  menuPerms: string[];
  actionPerms: string[];
  /** 처리 기능 중 역할에 없어도 켤 수 있는 것 (만족도 평가) */
  grantableActions?: string[];
  editPerms?: string[];
  features?: Feature[];
  /** 이 교육청이 쓰지 않는 AS 서비스의 메뉴 (모두에게 꺼짐) */
  disabled: string[];
}
type Adjust = Record<string, { granted: Set<string>; denied: Set<string> }>;

/** 역할마다 다루는 데이터 범위 (Scope) — 역할 카드에 한 줄로 */
const ROLE_SCOPE: Record<string, string> = {
  SCHOOL_USER: "자기 학교", AS_ENGINEER: "소속 업체에 배정된 AS · 학교", VENDOR_ADMIN: "소속 업체 전체",
  EDU_ADMIN: "교육청 전체", REGION_ADMIN: "관할 교육지원청 학교", SYS_ADMIN: "시스템 전체",
};
const ACTIONS: [string, string][] = [
  ["AS_RECEIVE", "접수"], ["AS_ASSIGN", "업체 배정"], ["AS_VISIT", "방문일 변경"], ["AS_REPORT", "처리 보고서 작성 · 수정"],
  ["AS_RETURN", "반려 · 반려 취소"], ["AS_TRANSFER", "이관"], ["AS_CANCEL", "신청 취소"], ["AS_DELETE", "삭제"],
  ["AS_EVALUATE", "만족도 평가"],
];
const FIXED_NOTE: Record<string, string> = { ORG_WRITE: "통합 관리자 계정만" };
/** "무선장비 등록" → "등록" (메뉴 이름 밑에 붙으니 앞말은 뺀다) */
const shortLabel = (l: string) => l.replace(/^(무선장비|스쿨넷장비|학교|업체|사용자)\s+/, "");

const toAdjust = (d: RolePermsData): Adjust =>
  Object.fromEntries(d.roles.map((r) => [r.role, { granted: new Set(r.granted), denied: new Set(r.denied) }]));

function RolePerms() {
  const toast = useToast();
  const { me, setMe } = useAuth();
  const [data, setData] = useState<RolePermsData | null>(null);
  const [adj, setAdj] = useState<Adjust>({});
  const [sel, setSel] = useState<string>("");
  const [view, setView] = useState<"edit" | "compare">("edit");
  const [onlyCustom, setOnlyCustom] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const apply = (d: RolePermsData) => {
    setData(d);
    setAdj(toAdjust(d));
    setSel((s) => s || d.roles[0]?.role || "");
  };
  const load = useCallback(() => {
    setErr("");
    api.get<RolePermsData>("/api/org/role-perms").then(apply).catch((e) => setErr((e as Error).message));
  }, []);
  useEffect(load, [load]);

  // 메뉴 묶음 → 메뉴 줄 (같은 권한을 쓰는 메뉴는 한 줄). 쓰지 않는 AS 서비스의 메뉴는 뺀다.
  const groups = useMemo(() => {
    if (!data) return [];
    const menuPerms = new Set(data.menuPerms);
    const off = new Set(data.disabled);
    return MENU.filter((g) => !g.hidden).map((g) => {
      const rows: { perm: string; titles: string[]; fixed: boolean }[] = [];
      for (const i of g.items) {
        if (!i.perm || off.has(i.perm)) continue;
        const row = rows.find((r) => r.perm === i.perm);
        if (row) row.titles.push(i.title);
        else rows.push({ perm: i.perm, titles: [i.title], fixed: !menuPerms.has(i.perm) });
      }
      return { title: g.title, rows };
    }).filter((g) => g.rows.length);
  }, [data]);

  const changed = useMemo(() => {
    if (!data) return [] as string[];
    const same = (a: Set<string>, b: string[]) => a.size === b.length && b.every((x) => a.has(x));
    return data.roles.filter((r) => adj[r.role] && !(same(adj[r.role].granted, r.granted) && same(adj[r.role].denied, r.denied))).map((r) => r.role);
  }, [data, adj]);

  useEffect(() => {
    if (!changed.length) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changed.length]);

  if (err) return <ErrorBox message={err} onRetry={load} />;
  if (!data || !sel) return <Loading />;

  const disabled = new Set(data.disabled);
  const saved = toAdjust(data);
  const roleOf = (role: string) => data.roles.find((r) => r.role === role)!;
  const features = data.features ?? [];
  const featuresOf = (perm: string) => features.filter((f) => f.parent === perm);
  const baseHas = (r: RoleRow, p: string) => r.defaults.includes(p) || r.vendorTyped.includes(p);
  const isOn = (r: RoleRow, p: string, a: Adjust = adj) =>
    !disabled.has(p) && !r.blocked?.includes(p) && (baseHas(r, p) || !!a[r.role]?.granted.has(p)) && !a[r.role]?.denied.has(p);
  const menuOn = (r: RoleRow, perm: string, fixed: boolean, a: Adjust = adj) => (fixed ? r.defaults.includes(perm) : isOn(r, perm, a));
  const featOn = (r: RoleRow, code: string, a: Adjust = adj) => !a[r.role]?.denied.has(code);
  const customCount = (role: string) => (adj[role]?.granted.size ?? 0) + (adj[role]?.denied.size ?? 0);
  const totalCustom = data.roles.reduce((n, r) => n + customCount(r.role), 0);

  const setPerm = (role: string, p: string, on: boolean) => {
    const r = roleOf(role);
    const g = new Set(adj[role].granted), d = new Set(adj[role].denied);
    if (on) { d.delete(p); if (!baseHas(r, p)) g.add(p); }
    else { g.delete(p); if (baseHas(r, p)) d.add(p); }
    setAdj({ ...adj, [role]: { granted: g, denied: d } });
    setMsg("");
  };
  const setFeat = (role: string, code: string, on: boolean) => {
    const d = new Set(adj[role].denied);
    if (on) d.delete(code); else d.add(code);
    setAdj({ ...adj, [role]: { granted: adj[role].granted, denied: d } });
    setMsg("");
  };
  const resetRole = (role: string) => {
    setAdj({ ...adj, [role]: { granted: new Set(), denied: new Set() } });
    setMsg("");
  };

  const save = async () => {
    setBusy(true);
    setMsg("");
    try {
      const roles = Object.fromEntries(changed.map((r) => [r, { granted: [...adj[r].granted], denied: [...adj[r].denied] }]));
      const d = await api.put<RolePermsData>("/api/org/role-perms", { roles });
      apply(d);
      toast(`역할 ${changed.length}개의 권한을 저장했습니다.`);
      if (me && me.roles.some((r) => changed.includes(r))) api.get<Me>("/api/auth/me").then(setMe).catch(() => {});
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const r = roleOf(sel);
  const editableMenus = groups.flatMap((g) => g.rows).filter((x) => !x.fixed && !r.blocked?.includes(x.perm));
  const menusOn = editableMenus.filter((x) => isOn(r, x.perm)).length;
  const featsOff = features.filter((f) => adj[sel].denied.has(f.code) && menuOn(r, f.parent, !data.menuPerms.includes(f.parent))).length;
  // 모든 처리 기능 · 편집 기능을 보여 주고, 이 역할(계정 종류)에 잠긴 것만 이유와 함께 잠근다.
  const lockedWhy = (p: string) => r.lockedReasons?.[p] ?? (r.blocked?.includes(p) ? "이 역할에는 줄 수 없습니다" : undefined);
  const roleActions = ACTIONS.filter(([p]) => data.actionPerms.includes(p));
  const roleEdits = EDITS.filter(([p]) => (data.editPerms ?? []).includes(p));

  // AS 처리 기능 카드: 장애접수관리(통합관리) 바로 밑에 둔다.
  const showAs = !onlyCustom || roleActions.some(([p]) => adj[sel].denied.has(p) || adj[sel].granted.has(p));
  const asCard = showAs ? (

              <section className="um-card" aria-label="AS 처리 기능">
                <div className="um-card-h"><div><b>AS 처리 기능</b><small>장애접수관리 · AS결과조회의 처리 버튼 · {roleActions.length ? `${roleActions.filter(([p]) => isOn(r, p)).length}/${roleActions.length} 켜짐` : "이 역할에는 처리 기능이 없습니다"}</small></div></div>
                {roleActions.length > 0 && (
                  <div className="rp2-feats wide" role="group" aria-label="AS 처리 기능">
                    {roleActions.map(([p, label]) => {
                      const on = isOn(r, p);
                      const why = lockedWhy(p);
                      return (
                        <label key={p} title={why} className={"rp2-chip" + (on ? " on" : "") + (why ? " locked" : "") + (on !== isOn(r, p, saved) ? " dirty" : "")}>
                          <input type="checkbox" checked={on} disabled={!!why} aria-label={`${r.name} · ${label}${why ? " (잠김: " + why + ")" : ""}`} onChange={(e) => setPerm(sel, p, e.target.checked)} />{label}
                        </label>
                      );
                    })}
                  </div>
                )}
                <p className="um-card-f">모든 처리 기능을 켜고 끌 수 있습니다. 흐린 것은 이 역할에 줄 수 없는 기능입니다(마우스를 올리면 이유). 켜도 다루는 범위는 그대로이고, 신청 상태가 맞을 때만 버튼이 보입니다.</p>
              </section>
  ) : null;

  /** 이 메뉴(또는 기능)가 기본값과 다른가 — ‘바꾼 것만 보기’용 */
  const rowCustom = (perm: string) => adj[sel].granted.has(perm) || adj[sel].denied.has(perm) || featuresOf(perm).some((f) => adj[sel].denied.has(f.code));

  return (
    <div className="rp2">
      <p className="um-note">
        역할을 고른 뒤 메뉴 · 기능 · AS 처리 기능을 켜고 끄세요. 다루는 범위는 역할이 정합니다 — 학교는 자기 학교, 업체 · 교육지원청은 지역, 교육청은 전체.
        흐린 항목은 그 역할에 줄 수 없는 것입니다(이유 표시).
        저장하면 그 역할의 모든 사용자에게 바로 적용됩니다. 한 사람만 다르게 하려면 <Link href="/admin/user-menus">사용자 메뉴 권한</Link>을 쓰세요.
      </p>

      <div className="rp2-top">
        <div className="rp2-roles" role="tablist" aria-label="역할">
          {data.roles.map((x) => {
            const n = customCount(x.role);
            return (
              <button key={x.role} type="button" role="tab" aria-selected={view === "edit" && sel === x.role}
                className={"rp2-role" + (view === "edit" && sel === x.role ? " on" : "")}
                onClick={() => { setSel(x.role); setView("edit"); }}>
                <b>{x.name}{changed.includes(x.role) && <i className="rp2-dot" title="저장하지 않은 변경" aria-label="저장하지 않음" />}</b>
                <small>{ROLE_SCOPE[x.role]}</small>
                <span className="rp2-role-f">
                  <span>{x.userCount}명</span>
                  {n > 0 ? <span className="um-pill warn">조정 {n}</span> : <span className="um-pill none">기본값</span>}
                </span>
              </button>
            );
          })}
        </div>
        <div className="fpv-seg rp2-view" role="group" aria-label="보기">
          <button type="button" aria-pressed={view === "edit"} onClick={() => setView("edit")}>역할별 설정</button>
          <button type="button" aria-pressed={view === "compare"} onClick={() => setView("compare")}>역할 비교</button>
        </div>
      </div>

      {view === "compare" ? (
        <Compare data={data} groups={groups} isOn={isOn} menuOn={menuOn} featuresOf={featuresOf} featOn={featOn}
          onPick={(role) => { setSel(role); setView("edit"); }} />
      ) : (
        <section className="rp2-panel" aria-label={`${r.name} 권한`}>
          <header className="rp2-head">
            <div>
              <h3>{r.name} <small>{r.userCount}명 · {ROLE_SCOPE[r.role]}</small></h3>
              <p className="hint">켜도 데이터는 {ROLE_SCOPE[r.role]} 범위만 다룹니다.</p>
            </div>
            <dl className="um-stats">
              <div><dt>켜진 메뉴</dt><dd>{menusOn}<small>/{editableMenus.length}</small></dd></div>
              <div><dt>꺼진 기능</dt><dd className={featsOff ? "off" : ""}>{featsOff}</dd></div>
              <div><dt>기본값과 다름</dt><dd className={customCount(sel) ? "add" : ""}>{customCount(sel)}</dd></div>
            </dl>
          </header>
          <div className="rp2-tools">
            <label><input type="checkbox" checked={onlyCustom} onChange={(e) => setOnlyCustom(e.target.checked)} /> 기본값과 다른 것만 보기</label>
            <button type="button" className="btn sm sec" disabled={!customCount(sel)} onClick={() => resetRole(sel)}>{r.name} 기본값으로</button>
          </div>

          <div className="um-groups">
            {groups.map((g) => {
              const rows = g.rows.filter((x) => !onlyCustom || rowCustom(x.perm));
              const after = g.title === "통합관리" ? asCard : null;
              if (!rows.length) return after ? <Fragment key={g.title}>{after}</Fragment> : null;
              const ed = g.rows.filter((x) => !x.fixed && !r.blocked?.includes(x.perm));
              const onCount = ed.filter((x) => isOn(r, x.perm)).length;
              return (
                <Fragment key={g.title}>
                <section className="um-card" aria-label={g.title}>
                  <div className="um-card-h">
                    <div><b>{g.title}</b><small>{ed.length ? `${onCount}/${ed.length} 켜짐` : "고정 메뉴"}</small></div>
                  </div>
                  <ul className="um-items">
                    {rows.map((x) => {
                      const label = x.titles.join(" · ");
                      const blocked = !!r.blocked?.includes(x.perm);
                      const on = menuOn(r, x.perm, x.fixed);
                      const dirty = !x.fixed && on !== menuOn(r, x.perm, false, saved);
                      const fs = featuresOf(x.perm);
                      const typed = r.vendorTyped.includes(x.perm);
                      const limit = on ? r.limits[x.perm] : undefined;
                      return (
                        <li key={x.perm} className={"rp2-item" + (x.fixed || blocked ? " fixed" : "") + (dirty ? " dirty" : "")}>
                          <div className="rp2-row">
                            <div className="um-item-t">
                              <span>{label}</span>
                              {typed && on && <small>소속 업체가 담당하는 AS 유형일 때만 보입니다</small>}
                              {limit && <small className="um-limit">범위 제한 · {limit}</small>}
                              {blocked && <small className="um-limit">{lockedWhy(x.perm)}</small>}
                            </div>
                            {x.fixed ? <span className="um-pill none">{FIXED_NOTE[x.perm] ?? (on ? "역할에 고정 (있음)" : "역할에 고정 (없음)")}</span>
                              : blocked ? <span className="um-pill none">잠김</span>
                                : adj[sel].denied.has(x.perm) ? <span className="um-pill off">끔</span>
                                  : adj[sel].granted.has(x.perm) ? <span className="um-pill add">켬</span> : null}
                            <input type="checkbox" role="switch" className="um-sw" aria-label={`${r.name} · ${label}`} checked={on}
                              disabled={x.fixed || blocked} onChange={(e) => setPerm(sel, x.perm, e.target.checked)} />
                          </div>
                          {fs.length > 0 && !blocked && (
                            <div className={"rp2-feats" + (on ? "" : " off")} role="group" aria-label={`${label} 기능`}>
                              <span className="rp2-feats-l">기능</span>
                              {fs.map((f) => {
                                const why = lockedWhy(f.code);
                                const fon = on && !why && featOn(r, f.code);
                                const fdirty = !why && featOn(r, f.code) !== featOn(r, f.code, saved);
                                return (
                                  <label key={f.code} title={why ?? (on ? undefined : "메뉴를 켜면 고를 수 있습니다")}
                                    className={"rp2-chip" + (fon ? " on" : "") + (why ? " locked" : "") + (fdirty ? " dirty" : "")}>
                                    <input type="checkbox" checked={fon} disabled={!on || !!why} aria-label={`${r.name} · ${f.label}${why ? " (잠김: " + why + ")" : ""}`} onChange={(e) => setFeat(sel, f.code, e.target.checked)} />
                                    {shortLabel(f.label)}
                                  </label>
                                );
                              })}
                              {!on && <small className="rp2-feats-off">메뉴를 켜면 고를 수 있습니다</small>}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
                {after}
                </Fragment>
              );
            })}
            {!groups.some((g) => g.title === "통합관리") && asCard}


            {roleEdits.length > 0 && (!onlyCustom || roleEdits.some(([p]) => adj[sel].denied.has(p) || adj[sel].granted.has(p))) && (
              <section className="um-card" aria-label="편집 기능">
                <div className="um-card-h"><div><b>편집 기능</b><small>화면은 보이고 고치기만 켜고 끕니다</small></div></div>
                <div className="rp2-feats wide" role="group" aria-label="편집 기능">
                  {roleEdits.map(([p, label]) => {
                    const on = isOn(r, p);
                    const why = lockedWhy(p);
                    return (
                      <label key={p} title={why} className={"rp2-chip" + (on ? " on" : "") + (why ? " locked" : "") + (on !== isOn(r, p, saved) ? " dirty" : "")}>
                        <input type="checkbox" checked={on} disabled={!!why} aria-label={`${r.name} · ${label}${why ? " (잠김: " + why + ")" : ""}`} onChange={(e) => setPerm(sel, p, e.target.checked)} />{label}
                      </label>
                    );
                  })}
                </div>
              </section>
            )}
            {onlyCustom && !customCount(sel) && <p className="empty">{r.name} 역할은 모두 기본값입니다.</p>}
          </div>
        </section>
      )}

      <FormMsg kind={msg ? "bad" : undefined} text={msg} />
      <div className={"um-bar" + (changed.length ? " dirty" : "")} role="region" aria-label="저장">
        <span className="um-bar-t" aria-live="polite">
          {changed.length ? `저장하지 않은 역할 ${changed.length}개 (${changed.map((x) => roleOf(x).name).join(", ")})` : totalCustom ? `모든 변경이 저장되었습니다 · 기본값과 다른 설정 ${totalCustom}개` : "모든 역할이 기본값입니다"}
        </span>
        <button type="button" className="btn sm sec" disabled={busy || !changed.length} onClick={() => { setAdj(saved); setMsg(""); }}>되돌리기</button>
        <button type="button" className="btn sm" disabled={busy || !changed.length} onClick={save}>{busy ? "저장 중…" : "저장"}</button>
      </div>
    </div>
  );
}

/** 역할 비교 (읽기 전용): 메뉴마다 역할별로 켜짐 · 일부 기능 꺼짐 · 없음. 칸을 누르면 그 역할 설정으로 간다. */
function Compare({ data, groups, isOn, menuOn, featuresOf, featOn, onPick }: {
  data: RolePermsData;
  groups: { title: string; rows: { perm: string; titles: string[]; fixed: boolean }[] }[];
  isOn: (r: RoleRow, p: string) => boolean;
  menuOn: (r: RoleRow, p: string, fixed: boolean) => boolean;
  featuresOf: (p: string) => Feature[];
  featOn: (r: RoleRow, code: string) => boolean;
  onPick: (role: string) => void;
}) {
  const mark = (r: RoleRow, perm: string, fixed: boolean) => {
    if (!menuOn(r, perm, fixed)) return <span className="rp2-m no" aria-label="없음">–</span>;
    const fs = featuresOf(perm);
    const offN = fs.filter((f) => !featOn(r, f.code)).length;
    return offN ? <span className="rp2-m part" title={`기능 ${offN}개 꺼짐`} aria-label={`켜짐, 기능 ${offN}개 꺼짐`}>◐</span>
      : <span className="rp2-m yes" aria-label="켜짐">●</span>;
  };
  return (
    <section className="rp2-cmp" aria-label="역할 비교">
      <div className="rp-wrap" tabIndex={0} role="region" aria-label="역할 비교 표">
        <table className="rp-t">
          <thead>
            <tr>
              <th scope="col" className="rp-h0">메뉴</th>
              {data.roles.map((r) => <th key={r.role} scope="col" className="rp-h"><button type="button" className="linkbtn" onClick={() => onPick(r.role)}>{r.name}</button></th>)}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => [
              <tr key={g.title} className="rp-g"><th scope="rowgroup" colSpan={data.roles.length + 1}>{g.title}</th></tr>,
              ...g.rows.map((x) => (
                <tr key={x.perm}>
                  <th scope="row" className="rp-n"><span>{x.titles.join(" · ")}</span></th>
                  {data.roles.map((r) => <td key={r.role} className="rp-c">{mark(r, x.perm, x.fixed)}</td>)}
                </tr>
              )),
            ])}
            <tr className="rp-g"><th scope="rowgroup" colSpan={data.roles.length + 1}>AS 처리 기능</th></tr>
            {ACTIONS.filter(([p]) => data.actionPerms.includes(p)).map(([p, label]) => (
              <tr key={p}>
                <th scope="row" className="rp-n"><span>{label}</span></th>
                {data.roles.map((r) => <td key={r.role} className="rp-c">{isOn(r, p) ? <span className="rp2-m yes" aria-label="켜짐">●</span> : <span className="rp2-m no" aria-label="없음">–</span>}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="rp-legend" aria-label="표 읽는 법">
        <li><span className="rp2-m yes">●</span>켜짐</li>
        <li><span className="rp2-m part">◐</span>켜짐 · 일부 기능 꺼짐</li>
        <li><span className="rp2-m no">–</span>없음</li>
        <li>역할 이름을 누르면 그 역할 설정으로 갑니다.</li>
      </ul>
    </section>
  );
}
