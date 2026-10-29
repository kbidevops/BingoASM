"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, AUTH_EXPIRED_EVENT, tokens, type Tokens } from "./api";
import type { Me, RceptTy, SiteInfo } from "./types";

/** Signed-in users are logged out after 30 idle minutes, with a warning 2 minutes before. */
export const IDLE_SECONDS = 30 * 60;
const WARN_SECONDS = 120;

type Status = "loading" | "anon" | "authed";

interface AuthState {
  status: Status;
  me: Me | null;
  perms: Set<string> | null;
  can: (perm?: string) => boolean;
  /** AS 서비스 the 교육청 uses: the signed-in user's, else the site's. */
  asTypes: RceptTy[];
  /** Menu permissions switched off for the whole 교육청 (unused AS services). */
  offPerms: Set<string>;
  site: SiteInfo | null;
  /** Store tokens from login / OTP / QR and the `me` that came with them. */
  signIn: (t: Tokens, me: Me) => void;
  signOut: (message?: string) => void;
  setMe: (me: Me) => void;
  extend: () => void;
  /** Message to show on the login screen after an automatic sign-out. */
  notice: string;
  clearNotice: () => void;
}

const AuthContext = createContext<AuthState | null>(null);
/** Seconds until idle logout. Its own context because it changes every second; only the header reads it. */
const IdleContext = createContext(IDLE_SECONDS);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [me, setMeState] = useState<Me | null>(null);
  const [notice, setNotice] = useState("");
  const [site, setSite] = useState<SiteInfo | null>(null);
  const [idleLeft, setIdleLeft] = useState(IDLE_SECONDS);
  const lastActive = useRef(Date.now());
  const warned = useRef(false);

  const signOut = useCallback((message?: string) => {
    tokens.clear();
    setMeState(null);
    setStatus("anon");
    setNotice(message ?? "");
  }, []);

  const signIn = useCallback((t: Tokens, m: Me) => {
    tokens.set(t);
    lastActive.current = Date.now();
    warned.current = false;
    setMeState(m);
    setStatus("authed");
    setNotice("");
  }, []);

  useEffect(() => {
    api.get<SiteInfo>("/api/site").then(setSite).catch(() => {});
  }, []);

  // Restore the session from sessionStorage on first load.
  useEffect(() => {
    if (!tokens.get()) {
      setStatus("anon");
      return;
    }
    api
      .get<Me>("/api/auth/me")
      .then((m) => {
        setMeState(m);
        setStatus("authed");
      })
      .catch(() => signOut());
  }, [signOut]);

  useEffect(() => {
    const onExpired = () => signOut("로그인이 만료되었습니다. 다시 로그인해 주세요.");
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, [signOut]);

  // Idle tracking. Activity after the warning appears does not count; the user must press 연장.
  useEffect(() => {
    if (status !== "authed") return;
    const touch = () => {
      if (!warned.current) lastActive.current = Date.now();
    };
    const evs = ["click", "keydown", "scroll", "touchstart"] as const;
    evs.forEach((e) => document.addEventListener(e, touch, { passive: true }));
    const timer = setInterval(() => {
      const left = IDLE_SECONDS - (Date.now() - lastActive.current) / 1000;
      setIdleLeft(left);
      if (left <= WARN_SECONDS) warned.current = true;
      if (left <= 0) signOut("30분 동안 사용이 없어 자동으로 로그아웃했습니다.");
    }, 1000);
    return () => {
      evs.forEach((e) => document.removeEventListener(e, touch));
      clearInterval(timer);
    };
  }, [status, signOut]);

  const extend = useCallback(() => {
    lastActive.current = Date.now();
    warned.current = false;
    setIdleLeft(IDLE_SECONDS);
  }, []);

  const value = useMemo<AuthState>(() => {
    const perms = me ? new Set(me.permissions) : null;
    return {
      status,
      me,
      perms,
      can: (perm) => !perm || !!perms?.has(perm),
      asTypes: me?.asTypes ?? site?.asTypes ?? [],
      offPerms: new Set(site?.disabledPerms ?? []),
      site,
      signIn,
      signOut,
      setMe: setMeState,
      extend,
      notice,
      clearNotice: () => setNotice(""),
    };
  }, [status, me, site, signIn, signOut, extend, notice]);

  return (
    <AuthContext.Provider value={value}>
      <IdleContext.Provider value={idleLeft}>{children}</IdleContext.Provider>
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function useIdleLeft() {
  return useContext(IdleContext);
}

export function isSchoolUser(me: Me | null) {
  return !!me?.roles.includes("SCHOOL_USER");
}

/** 교육지원청 담당자: 관할 교육지원청 학교만 다룸 (도교육청 관리자를 겸하면 아님). */
export function isRegionAdmin(me: Me | null) {
  return !!me?.roles.includes("REGION_ADMIN") && !isAdmin(me);
}

/** 학교 등록·삭제, 계약·담당업체 지정을 할 수 있는가 (도교육청·교육지원청 — 서버 Scope.schoolAdmin). */
export function isSchoolAdmin(me: Me | null) {
  return isAdmin(me) || !!me?.roles.includes("REGION_ADMIN");
}

/** 업체 계정 (기사·업체 관리자): 학교 단위 데이터는 담당으로 배정된 학교만. */
export function isVendorUser(me: Me | null) {
  return !isSchoolAdmin(me) && !isSchoolUser(me) && !!me && (me.roles.includes("AS_ENGINEER") || me.roles.includes("VENDOR_ADMIN"));
}

export function isAdmin(me: Me | null) {
  return !!me && (me.roles.includes("EDU_ADMIN") || me.roles.includes("SYS_ADMIN"));
}
