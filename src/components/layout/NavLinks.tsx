"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Games", matches: ["/", "/games", "/game"] },
  { href: "/odds", label: "Odds", matches: ["/odds"] },
  { href: "/teams", label: "Teams", matches: ["/teams"] },
  { href: "/record", label: "Record", matches: ["/record"] },
  { href: "/how-it-works", label: "How it works", matches: ["/how-it-works"] },
];

function isActive(pathname: string, matches: string[]): boolean {
  return matches.some((path) =>
    path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(`${path}/`),
  );
}

export function NavLinks() {
  const pathname = usePathname() ?? "/";
  return (
    <nav aria-label="Main" className="no-scrollbar -mx-2 overflow-x-auto">
      <ul className="flex min-w-max items-center">
        {NAV_ITEMS.map(({ href, label, matches }) => {
          const active = isActive(pathname, matches);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`relative inline-flex h-11 items-center px-2.5 text-[14px] font-medium transition-colors sm:px-3 md:h-16 ${
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
  );
}
