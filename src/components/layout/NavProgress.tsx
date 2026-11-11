"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * A thin white bar across the top of the masthead while an internal navigation is
 * under way (NAV-16), instead of `loading.tsx` boundaries, which would turn a real 404
 * into a soft one. Mounted once in the root layout, first inside <body>. Decorative:
 * Next's route announcer tells screen readers about the new page.
 *
 * It starts on a plain left click on a same-origin link that leads to another URL
 * (another path or query; never a hash-only jump, the URL already shown, a modified or
 * middle click, `target`, `download`, or another origin), and on the `pp:navstart`
 * event (the finder's Enter, which navigates through the router). It ends when the
 * router commits any history entry (`pushState` / `replaceState`, also for a 404 or a
 * redirect back to the same URL), on Back and Forward, when the path changes, when the
 * page is restored from the back-forward cache, and, whatever happens, after 12 seconds,
 * so it can never stay on screen. It shows only if the navigation takes over 120 ms.
 */

const NAV_START_EVENT = "pp:navstart";
const HISTORY_EVENT = "pp:history";
const SHOW_DELAY_MS = 120;
const FAILSAFE_MS = 12_000;

/** Lets the finder (and anything else that calls router.push) start the bar. */
export function signalNavigationStart() {
  window.dispatchEvent(new Event(NAV_START_EVENT));
}

type HistoryPatched = History & { __pp548Patched?: boolean };

/** Wraps pushState / replaceState once per page so a commit can end the bar. */
function patchHistory() {
  const history = window.history as HistoryPatched;
  if (history.__pp548Patched) return;
  history.__pp548Patched = true;
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method];
    history[method] = function patched(this: History, ...args: Parameters<History["pushState"]>) {
      const result = original.apply(this, args);
      window.dispatchEvent(new Event(HISTORY_EVENT));
      return result;
    };
  }
}

/** The link a click would follow to another page of this site, or null. */
function internalTarget(event: MouseEvent): URL | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor = (event.target as Element | null)?.closest?.("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  const target = anchor.getAttribute("target");
  if ((target && target !== "_self") || anchor.hasAttribute("download")) return null;
  let url: URL;
  try {
    url = new URL(anchor.href, window.location.href);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  if (url.pathname === window.location.pathname && url.search === window.location.search) return null;
  return url;
}

export function NavProgress() {
  const pathname = usePathname();
  const bar = useRef<HTMLDivElement>(null);
  const control = useRef<{ start: () => void; done: () => void } | null>(null);

  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    patchHistory();
    let running = false;
    let showTimer: number | undefined;
    let failsafe: number | undefined;
    let hideTimer: number | undefined;
    let frame: number | undefined;

    const clear = () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(failsafe);
      window.clearTimeout(hideTimer);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };

    const reset = () => {
      el.dataset.state = "idle";
    };

    const start = () => {
      clear();
      running = true;
      reset();
      showTimer = window.setTimeout(() => {
        el.dataset.state = "start";
        // Next frame: let the 'start' width apply, then ease toward 90%.
        frame = window.requestAnimationFrame(() => {
          frame = window.requestAnimationFrame(() => {
            if (running) el.dataset.state = "loading";
          });
        });
      }, SHOW_DELAY_MS);
      failsafe = window.setTimeout(done, FAILSAFE_MS);
    };

    function done() {
      if (!running) return;
      running = false;
      const shown = el!.dataset.state !== "idle";
      clear();
      if (!shown) return;
      el!.dataset.state = "done";
      hideTimer = window.setTimeout(reset, 450);
    }

    const onClick = (event: MouseEvent) => {
      if (internalTarget(event)) start();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        running = false;
        clear();
        reset();
      }
    };

    control.current = { start, done };
    // Capture phase: before next/link's own handler calls preventDefault.
    document.addEventListener("click", onClick, true);
    window.addEventListener(NAV_START_EVENT, start);
    window.addEventListener(HISTORY_EVENT, done);
    window.addEventListener("popstate", done);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      clear();
      control.current = null;
      document.removeEventListener("click", onClick, true);
      window.removeEventListener(NAV_START_EVENT, start);
      window.removeEventListener(HISTORY_EVENT, done);
      window.removeEventListener("popstate", done);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  // A changed path always ends it (backstop for the history signal).
  useEffect(() => {
    control.current?.done();
  }, [pathname]);

  return <div ref={bar} className="nav-progress" data-state="idle" aria-hidden="true" />;
}
