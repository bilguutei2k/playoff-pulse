"use client";

import { ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";

/** Only pages taller than this many screens get the control. */
const TALL_SCREENS = 5;
/**
 * It shows once the reader is this many screens down. One screen, so that at any depth
 * a way back up is within one screen: either the top of the page or this control.
 */
const SHOW_AFTER_SCREENS = 1;

/**
 * "Back to top", mounted once in the root layout: a 44 px square at the bottom right,
 * shown on pages taller than five screens once the reader is a screen down. It jumps
 * (instantly under prefers-reduced-motion, smoothly otherwise) and moves focus to the
 * page's <main>, so the next Tab starts from the top of the content, not the footer.
 *
 * Server and client first paint render the same hidden button; whether it shows is
 * decided after hydration by a scroll and resize listener (one measurement per frame).
 * While hidden it is `visibility: hidden` (shared.css, `.to-top`), so it takes no tab
 * stop and no click. It makes no request.
 */
export function BackToTop() {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const screen = window.innerHeight;
      const tall = document.documentElement.scrollHeight > TALL_SCREENS * screen;
      setShown(tall && window.scrollY > SHOW_AFTER_SCREENS * screen);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  const toTop = () => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "instant" : "smooth" });
    const target = document.querySelector<HTMLElement>("main") ?? document.getElementById("main");
    if (!target) return;
    if (!target.hasAttribute("tabindex")) {
      // Focusable for this move only; dropped again when focus leaves it.
      target.setAttribute("tabindex", "-1");
      target.setAttribute("data-focus-target", "");
      target.addEventListener(
        "blur",
        () => {
          target.removeAttribute("tabindex");
          target.removeAttribute("data-focus-target");
        },
        { once: true },
      );
    }
    target.focus({ preventScroll: true });
  };

  return (
    <button
      type="button"
      className="to-top"
      data-shown={shown ? "" : undefined}
      aria-label="Back to top"
      title="Back to top"
      onClick={toTop}
    >
      <ArrowUp aria-hidden className="h-5 w-5" strokeWidth={2.25} />
    </button>
  );
}
