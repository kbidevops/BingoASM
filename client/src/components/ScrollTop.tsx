"use client";

import { useEffect, useState } from "react";

/** Distance scrolled before the button appears. */
const SHOW_AFTER = 400;

/** 맨 위로: a floating button that appears after scrolling down and takes the page back to the top. */
export default function ScrollTop() {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const update = () => setShown(window.scrollY > SHOW_AFTER);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  const toTop = (e: React.MouseEvent) => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    // Keyboard users (detail 0) continue from the top of the page, not from the button.
    if (e.detail === 0) document.querySelector<HTMLElement>(".skip")?.focus({ preventScroll: true });
  };

  return (
    <button type="button" className={"to-top" + (shown ? " on" : "")} onClick={toTop} aria-label="맨 위로" title="맨 위로" tabIndex={shown ? 0 : -1} aria-hidden={!shown}>
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
