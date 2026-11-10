"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

const NAV_ITEMS = [
  { href: "/", label: "Games", matches: ["/", "/games", "/game"] },
  { href: "/odds", label: "Odds", matches: ["/odds"] },
  { href: "/injuries", label: "Injuries", matches: ["/injuries"] },
  { href: "/players", label: "Players", matches: ["/players"] },
  { href: "/teams", label: "Teams", matches: ["/teams"] },
  { href: "/record", label: "Record", matches: ["/record"] },
  { href: "/how-it-works", label: "How it works", matches: ["/how-it-works"] },
];

function isActive(pathname: string, matches: string[]): boolean {
  return matches.some((path) =>
    path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(`${path}/`),
  );
}

/** The masthead's nav from 1024 px: white links, the current one underlined. */
export function NavLinks() {
  const pathname = usePathname() ?? "/";
  return (
    <nav aria-label="Main">
      <ul className="flex items-center gap-5 xl:gap-[30px]">
        {NAV_ITEMS.map(({ href, label, matches }) => {
          const active = isActive(pathname, matches);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex h-11 items-center whitespace-nowrap text-[15px] font-semibold text-white decoration-2 underline-offset-[9px] ${
                  active ? "underline" : "hover:underline hover:decoration-white/50"
                }`}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Below 1024 px: "Menu" opens the same links in a black sheet under the masthead, over a
 * dimmed backdrop. While open the page behind does not scroll, focus starts on the first
 * link and Tab stays inside the sheet and its Close button. It closes on navigation, on a
 * link to the page already shown, Escape, a tap on the backdrop, a second tap on the
 * button, or the window widening past 1024 px; focus then returns to the button.
 */
export function MobileMenu() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const [shownFor, setShownFor] = useState(pathname);
  const panelId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Navigating closes the sheet.
  if (shownFor !== pathname) {
    setShownFor(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const trigger = button.current;
    const sheet = panel.current;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    sheet?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const close = () => setOpen(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !sheet || !trigger) return;
      const items = [trigger, ...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = active !== null && items.includes(active);
      if (event.shiftKey && (active === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    };
    const wide = window.matchMedia("(min-width: 1024px)");
    const onWide = () => {
      if (wide.matches) close();
    };
    document.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWide);
    return () => {
      root.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWide);
      // Back to the button, unless navigation or the reader has already moved focus on.
      const active = document.activeElement;
      if (trigger && (active === null || active === document.body || sheet?.contains(active))) trigger.focus();
    };
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="-mr-2 inline-flex h-11 min-w-11 items-center justify-center px-2 text-[15px] font-semibold text-white"
      >
        {open ? "Close" : "Menu"}
      </button>
      {open ? (
        <div
          aria-hidden
          className="fixed inset-x-0 bottom-0 top-[var(--mast)] bg-black/50"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <div
        id={panelId}
        ref={panel}
        hidden={!open}
        className="absolute inset-x-0 top-full max-h-[calc(100dvh-var(--mast))] overflow-y-auto overscroll-contain border-t border-white/15 bg-masthead pb-5 shadow-[0_12px_24px_-12px_rgba(0,0,0,0.5)]"
      >
        <nav aria-label="Main" className="pp-container">
          <ul className="grid">
            {NAV_ITEMS.map(({ href, label, matches }) => {
              const active = isActive(pathname, matches);
              return (
                <li key={href} className="border-b border-white/10">
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={`flex h-12 items-center text-[17px] font-semibold text-white ${active ? "underline decoration-2 underline-offset-[6px]" : ""}`}
                  >
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="mt-3">
            <Link href="/about" onClick={() => setOpen(false)} className="inline-flex h-11 items-center text-[14px] text-masthead-2 hover:text-white hover:underline hover:underline-offset-4">
              About 548
            </Link>
          </p>
        </nav>
      </div>
    </>
  );
}
