import Link from "next/link";
import { Activity } from "lucide-react";
import { NavLinks } from "@/components/layout/NavLinks";

export function Header() {
  return (
    <header className="border-b border-[var(--color-border-subtle)] bg-[var(--color-panel-primary)]">
      <div className="pp-container flex flex-col gap-1 py-2 sm:h-16 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:py-0">
        <Link
          href="/"
          className="flex w-fit items-center gap-2.5 rounded-md py-1.5 text-[var(--color-text-primary)]"
        >
          <span
            aria-hidden
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-accent)] text-white"
          >
            <Activity size={18} strokeWidth={2.25} />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-[15px] font-semibold tracking-tight">Playoff Pulse</span>
            <span className="text-xs text-[var(--color-text-muted)]">Live NBA forecasts</span>
          </span>
        </Link>
        <NavLinks />
      </div>
    </header>
  );
}
