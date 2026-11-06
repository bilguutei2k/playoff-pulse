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
  { href: "/how-it-works", label: "Method", matches: ["/how-it-works"] },
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
      <ul className="flex items-center gap-[30px]">
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

/**
 * Below 1024 px: "Menu" opens the same links in a black sheet under the masthead,
 * with the freshness line. It closes on navigation, Escape, or a second tap.
 */
export function MobileMenu({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const [shownFor, setShownFor] = useState(pathname);
  const panelId = useId();
  const button = useRef<HTMLButtonElement>(null);

  // Navigating closes the sheet.
  if (shownFor !== pathname) {
    setShownFor(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="-mr-2 inline-flex h-11 items-center px-2 text-[15px] font-semibold text-white"
      >
        {open ? "Close" : "Menu"}
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute inset-x-0 top-full border-t border-white/15 bg-masthead pb-5 shadow-[0_12px_24px_-12px_rgba(0,0,0,0.5)]"
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
                    className={`flex h-12 items-center text-[17px] font-semibold text-white ${active ? "underline decoration-2 underline-offset-[6px]" : ""}`}
                  >
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mt-4">{children}</div>
        </nav>
      </div>
    </>
  );
}
