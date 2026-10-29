import type { Metadata, Viewport } from "next";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import { ToastProvider } from "@/components/ui";
import { AuthProvider } from "@/lib/auth";
import { ScrapProvider } from "@/lib/scraps";
import "./globals.css";

export const metadata: Metadata = {
  title: "충북교육청 원클릭AS시스템",
  description: "학교 정보화기기 장애신고의 신청 · 접수 · 처리 · 결과를 원스톱으로 처리하는 원클릭AS시스템",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

// Applies the saved light/dark choice before first paint.
const THEME_SCRIPT = `try{var t=localStorage.getItem("bingoasm.theme");if(t)document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap" />
      </head>
      <body>
        <a className="skip" href="#content">본문으로 바로가기</a>
        <a className="skip" href="#gnb">메인메뉴 바로가기</a>
        <AuthProvider>
          <ScrapProvider>
            <ToastProvider>
              <SiteHeader />
              {children}
              <footer className="ft">
                <div className="wrap">
                  <p><b><a href="https://www.cbe.go.kr/cbe/itp/policy/policyInfo.do?mi=11759" target="_blank" rel="noopener">개인정보처리방침</a></b></p>
                  <p>(28635) 충북 청주시 서원구 청남로 1929 (산남동 4-11)</p>
                  <p>TEL: 043)290-2000, (당직실 2500), 2669, 2670 FAX: 043)290-2741 <Link href="/contact">[문의처 안내]</Link></p>
                  <p>Copyright © Chungcheongbuk-do Office Of Education. All Rights Reserved.</p>
                </div>
              </footer>
            </ToastProvider>
          </ScrapProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
