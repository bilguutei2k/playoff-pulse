"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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

/**
 * The main navigation. When the row is wider than the screen (phones) it scrolls
 * sideways: the current page is scrolled into view, and a fade at either edge shows
 * that more links sit beyond it.
 */
export function NavLinks() {
  const pathname = usePathname() ?? "/";
  const scroller = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const update = () =>
      setEdges({
        left: element.scrollLeft > 4,
        right: element.scrollLeft + element.clientWidth < element.scrollWidth - 4,
      });
    const active = element.querySelector<HTMLElement>('[aria-current="page"]');
    if (active && element.scrollWidth > element.clientWidth) {
      const start = active.offsetLeft - 16;
      const end = active.offsetLeft + active.offsetWidth + 16 - element.clientWidth;
      if (element.scrollLeft > start) element.scrollLeft = Math.max(0, start);
      else if (element.scrollLeft < end) element.scrollLeft = end;
    }
    update();
    element.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      element.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [pathname]);

  return (
    <div className="relative">
      <nav ref={scroller} aria-label="Main" className="no-scrollbar -mx-2 overflow-x-auto">
        <ul className="flex min-w-max items-center">
          {NAV_ITEMS.map(({ href, label, matches }) => {
            const active = isActive(pathname, matches);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`relative inline-flex h-11 items-center px-2.5 text-[14px] font-medium transition-colors sm:px-3 lg:h-16 ${
                    active ? "text-ink" : "text-ink-2 hover:text-ink"
                  }`}
                >
                  {label}
                  {active ? (
                    <span aria-hidden className="absolute inset-x-2.5 bottom-0 h-[3px] rounded-t-sm bg-pulse sm:inset-x-3" />
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {edges.left ? (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 -left-2 w-8 bg-gradient-to-r from-panel to-transparent" />
      ) : null}
      {edges.right ? (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 -right-2 w-10 bg-gradient-to-l from-panel to-transparent" />
      ) : null}
    </div>
  );
}
