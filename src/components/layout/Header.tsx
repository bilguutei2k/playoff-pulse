import Link from "next/link";
import { FileText } from "lucide-react";

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
            <span className="pp-kicker text-[var(--color-text-muted)]">Forecasting Engine</span>
          </span>
        </Link>

        <div className="flex items-center px-4 py-3">
          <div className="text-xs uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
            2026 NBA Playoffs / manual inputs / model estimates
          </div>
        </div>

        <nav className="flex items-center justify-between gap-3 px-4 py-3 sm:justify-end">
          <span className="pp-pill border-[rgba(201,150,31,0.45)] text-[var(--color-accent)]">
            Static refresh
          </span>
          <Link
            href="/methodology"
            className="inline-flex items-center gap-2 rounded-[var(--radius-sm-retro)] border-2 border-[var(--color-border-strong)] px-3 py-2 text-xs uppercase tracking-[0.08em] text-[var(--color-text-secondary)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-text-primary)]"
          >
            <FileText className="h-4 w-4" aria-hidden />
            Methodology
          </Link>
        </nav>
      </div>
    </header>
  );
}
