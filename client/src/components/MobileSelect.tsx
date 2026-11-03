"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const MOBILE = "(max-width: 760px)";

interface Sheet {
  el: HTMLSelectElement;
  title: string;
  options: { text: string; disabled: boolean }[];
  selected: number;
}

function selectTitle(el: HTMLSelectElement) {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria;
  const label = el.labels?.[0];
  if (!label) return "선택";
  // A label can wrap the select, and its text then includes every option.
  const copy = label.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("select").forEach((s) => s.remove());
  return copy.textContent?.trim() || "선택";
}

/**
 * On mobile widths, every native <select> opens this bottom sheet instead of the browser's popup, which can't be sized
 * and sticks out past the screen. It only listens at the document level, so pages keep using a plain <select>:
 * picking an option sets the select's value and fires a real change event, so their onChange runs as usual.
 */
export default function MobileSelect() {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.("select");
      return el && !el.disabled && !el.multiple && el.size <= 1 && window.matchMedia(MOBILE).matches ? el : null;
    };
    const open = (el: HTMLSelectElement) => setSheet({
      el,
      title: selectTitle(el),
      options: [...el.options].map((o) => ({ text: o.text, disabled: o.disabled })),
      selected: el.selectedIndex,
    });

    // Touch: open on touchend, and only for a tap, so a scroll that starts on a select still scrolls the page.
    let touch: { el: HTMLSelectElement; x: number; y: number } | null = null;
    const onTouchStart = (e: TouchEvent) => {
      const el = target(e);
      touch = el ? { el, x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
    };
    const onTouchEnd = (e: TouchEvent) => {
      const t = touch;
      touch = null;
      if (!t) return;
      const p = e.changedTouches[0];
      if (Math.abs(p.clientX - t.x) > 10 || Math.abs(p.clientY - t.y) > 10) return;
      e.preventDefault();
      open(t.el);
    };
    const onMouseDown = (e: MouseEvent) => {
      const el = target(e);
      if (!el) return;
      e.preventDefault();
      open(el);
    };
    document.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    document.addEventListener("touchend", onTouchEnd, { capture: true, passive: false });
    document.addEventListener("mousedown", onMouseDown, true);
    return () => {
      document.removeEventListener("touchstart", onTouchStart, true);
      document.removeEventListener("touchend", onTouchEnd, true);
      document.removeEventListener("mousedown", onMouseDown, true);
    };
  }, []);

  useEffect(() => {
    if (!sheet) return;
    const buttons = () => [...(box.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? [])];
    (box.current?.querySelector<HTMLButtonElement>("button.on:not([disabled])") ?? buttons()[0])?.focus();
    // Capture, ahead of Modal's document listener: Esc here closes only the sheet, and Tab stays in it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setSheet(null);
        sheet.el.focus();
      } else if (e.key === "Tab") {
        e.stopPropagation();
        e.preventDefault();
        const bs = buttons();
        if (!bs.length) return;
        const i = bs.indexOf(document.activeElement as HTMLButtonElement);
        bs[(i + (e.shiftKey ? -1 : 1) + bs.length) % bs.length].focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [sheet]);

  if (!sheet) return null;

  const close = () => {
    setSheet(null);
    sheet.el.focus();
  };
  const pick = (i: number) => {
    if (i !== sheet.el.selectedIndex) {
      sheet.el.selectedIndex = i;
      sheet.el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    close();
  };

  return createPortal(
    <div className="msel">
      <div className="msel-bg" onClick={close} />
      <div ref={box} className="msel-box" role="dialog" aria-modal="true" aria-label={sheet.title}>
        <div className="msel-h">
          <b>{sheet.title}</b>
          <button type="button" className="msel-x" aria-label="닫기" onClick={close}>✕</button>
        </div>
        <ul className="msel-list">
          {sheet.options.map((o, i) => (
            <li key={i}>
              <button type="button" className={i === sheet.selected ? "on" : ""} aria-current={i === sheet.selected ? "true" : undefined} disabled={o.disabled} onClick={() => pick(i)}>
                {o.text}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
