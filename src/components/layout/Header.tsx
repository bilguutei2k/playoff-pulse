import Link from "next/link";
import { Camera, ChartNoAxesCombined, FileText, FlaskConical, ScrollText } from "lucide-react";

const navItems = [
  { href: "/", label: "Retrospective", Icon: ScrollText },
  { href: "/evidence", label: "Evidence", Icon: ChartNoAxesCombined },
  { href: "/methodology", label: "Methodology", Icon: FileText },
  { href: "/lab", label: "Lab", Icon: FlaskConical },
  { href: "/snapshot", label: "Snapshot", Icon: Camera },
];

export function Header() {
  return (
    <header className="relative border-b-2 border-[var(--color-border-strong)] bg-[var(--color-bg-primary)] pp-scan-lite">
      <div className="mx-auto grid max-w-7xl grid-cols-1 divide-y divide-[var(--color-border-subtle)] sm:grid-cols-[auto_1fr_auto] sm:divide-x sm:divide-y-0">
        <Link
          href="/"
          className="flex items-center gap-3 px-4 py-3 transition hover:bg-[var(--overlay-row-hover)]"
        >
          <span
            className="rounded-[var(--radius-sm-retro)] bg-[var(--color-text-primary)] px-3 py-2 text-sm leading-none tracking-[0.08em] text-[var(--color-bg-primary)]"
            style={{ fontFamily: "var(--font-pixel)" }}
          >
            548
          </span>
          <span className="grid gap-1">
            <span className="pp-kicker text-[var(--color-text-primary)]">Playoff Pulse</span>
            <span className="pp-kicker text-[var(--color-text-muted)]">Forecasting Retrospective</span>
          </span>
        </Link>

        <div className="flex items-center px-4 py-3">
          <div className="text-xs uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
            2026 season complete / manual inputs / reconstructed evaluation
          </div>
        </div>

        <nav className="flex flex-wrap items-center justify-center gap-2 px-3 py-3 sm:justify-end sm:gap-3 sm:px-4">
          {navItems.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              className="inline-flex items-center gap-2 rounded-[var(--radius-sm-retro)] border-2 border-[var(--color-border-strong)] px-3 py-2 text-xs uppercase tracking-[0.08em] text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-text-primary)]"
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
