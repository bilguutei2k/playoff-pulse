import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function MethodologyNote() {
  const limits = [
    ["Live injuries", "Manual entry"],
    ["Rest / travel", "Not modeled"],
    ["Market odds", "Planned"],
    ["Calibration", "Future work"],
  ];

  return (
    <div className="grid gap-4 p-4">
      <div>
        <h3 className="pp-kicker text-[var(--color-text-primary)]">
          What the model can't see
        </h3>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--color-text-muted)]">
          Playoff Pulse converts assumed player availability, projected minutes,
          net rating, Elo, manual adjustments, and home court into game-level win
          probabilities. Remaining games are simulated as a best-of-seven series.
        </p>
      </div>

      <div className="grid gap-2">
        {limits.map(([label, status]) => (
          <div
            key={label}
            className="flex items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] pb-2"
          >
            <span className="pp-kicker text-[var(--color-text-secondary)]">{label}</span>
            <span className="pp-kicker text-[var(--color-accent)]">{status}</span>
          </div>
        ))}
      </div>

      <Link
        href="/methodology"
        className="inline-flex w-fit items-center gap-2 rounded-[var(--radius-sm-retro)] border-2 border-[var(--color-accent)] bg-[var(--color-accent)] px-4 py-2 text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-accent-text)] transition hover:bg-[var(--color-accent-hover)]"
      >
        Open methodology
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </div>
  );
}
