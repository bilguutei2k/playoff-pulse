"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Games", short: "Games", matches: ["/"] },
  { href: "/odds", label: "Season odds", short: "Odds", matches: ["/odds"] },
  { href: "/how-it-works", label: "How it works", short: "How it works", matches: ["/how-it-works"] },
  {
    href: "/retrospective",
    label: "2026 archive",
    short: "Archive",
    matches: ["/retrospective", "/snapshot", "/evidence", "/methodology", "/lab"],
  },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max items-center gap-1">
        {NAV_ITEMS.map(({ href, label, short, matches }) => {
          const active = matches.some((path) =>
            path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(`${path}/`),
          );
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-9 items-center rounded-md px-3 text-sm font-medium transition-colors ${
                  active
                    ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                    : "text-[var(--color-text-secondary)] hover:bg-[var(--color-panel-secondary)] hover:text-[var(--color-text-primary)]"
                }`}
              >
                <span className="sm:hidden">{short}</span>
                <span className="hidden sm:inline">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
