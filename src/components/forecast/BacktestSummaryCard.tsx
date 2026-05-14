import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function BacktestSummaryCard() {
  return (
    <div className="grid gap-4 p-4">
      <div>
        <h3 className="pp-kicker text-[var(--color-text-primary)]">
          Model Validation
        </h3>
        <div className="pp-number mt-3 text-3xl font-bold text-[var(--color-text-primary)]">
          Brier 0.193
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--color-text-muted)]">
          Beats coinflip (0.250), higher-seed-wins (0.213), and
          home-team-wins (0.215) on 150 historical series, 2016–2025.
        </p>
      </div>

      <Link
        href="/methodology"
        className="inline-flex w-fit items-center gap-2 rounded-[var(--radius-sm-retro)] border-2 border-[var(--color-accent)] bg-[var(--color-accent)] px-4 py-2 text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-accent-text)] transition hover:bg-[var(--color-accent-hover)]"
      >
        View methodology
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </div>
  );
}
