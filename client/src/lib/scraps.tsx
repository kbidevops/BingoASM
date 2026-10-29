"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import type { Scrap } from "./types";

// 메뉴스크랩 (favourite menus), stored per user on the server: /api/auth/me/scraps.

interface ScrapState {
  scraps: Scrap[];
  add: (menuKey: string, groupName: string, title: string) => Promise<void>;
  remove: (scrapId: number) => Promise<void>;
  clear: () => Promise<void>;
}

const ScrapContext = createContext<ScrapState | null>(null);

export function ScrapProvider({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const [scraps, setScraps] = useState<Scrap[]>([]);

  const load = useCallback(() => api.get<Scrap[]>("/api/auth/me/scraps").then(setScraps).catch(() => setScraps([])), []);

  useEffect(() => {
    if (status === "authed") load();
    else setScraps([]);
  }, [status, load]);

  const value: ScrapState = {
    scraps,
    add: async (menuKey, groupName, title) => {
      await api.post("/api/auth/me/scraps", { menuKey, groupName, title });
      await load();
    },
    remove: async (id) => {
      await api.del(`/api/auth/me/scraps/${id}`);
      setScraps((s) => s.filter((x) => x.scrapId !== id));
    },
    clear: async () => {
      await Promise.all(scraps.map((s) => api.del(`/api/auth/me/scraps/${s.scrapId}`)));
      setScraps([]);
    },
  };
  return <ScrapContext.Provider value={value}>{children}</ScrapContext.Provider>;
}

export function useScraps() {
  const ctx = useContext(ScrapContext);
  if (!ctx) throw new Error("useScraps must be used inside <ScrapProvider>");
  return ctx;
}
