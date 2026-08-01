import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function MethodologyNote() {
  const limits = [
    ["Finals rosters", "Manual recheck"],
    ["Live injuries", "Manual / TBD"],
    ["Live scores", "Read-only"],
    ["Rest / travel", "Not modeled"],
    ["Calibration", "Future work"],
  ];

  return (
    <div className="grid gap-4 p-4">
      <div>
        <h3 className="pp-kicker text-[var(--color-text-primary)]">
          What the model can&apos;t see
        </h3>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--color-text-muted)]">
          Published probabilities use the rating-only baseline. Player
          availability, projected minutes, injuries, and manual adjustments are
          isolated in an unvalidated scenario overlay that must be read beside
          the baseline and its delta.
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
        className="pp-button pp-button-primary w-fit"
      >
        Open methodology
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </div>
  );
}
