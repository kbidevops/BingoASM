"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { visibleMenu } from "@/lib/menu";

export default function SitemapPage() {
  const { status, perms } = useAuth();
  const menu = visibleMenu(status === "authed" ? perms : null);
  useEffect(() => {
    document.title = "누리집 지도 | 충북교육청 원클릭AS시스템";
  }, []);
  return (
    <main id="content">
      <div className="wrap">
        <div className="smw">
          <h2 className="smt">누리집 지도</h2>
          <div className="smgrid">
            {menu.map((g) => (
              <section key={g.title} className="smg">
                <h3><Link href={g.items[0].href}>{g.title}</Link></h3>
                <ul className="dash">
                  {g.items.map((it) => <li key={it.href}><Link href={it.href}>{it.title}</Link></li>)}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
