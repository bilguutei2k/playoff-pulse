import Link from "next/link";
import type { RecordSummary } from "@/lib/season/types";
import { formatChance } from "@/lib/utils/format";

/** Below this many scored games the record is labeled a small sample. */
const MEANINGFUL_GAMES = 500;

type Stat = { label: string; value: string; note: string };

function brier(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(3);
}

export function trackRecordStats(record: RecordSummary): Stat[] {
  return [
    {
      label: "Games scored",
      value: String(record.scored),
      note: "Finished games with a sealed forecast.",
    },
    {
      label: "Model Brier score",
      value: brier(record.brier),
      note: "Average squared error of the forecasts. Lower is better; always saying 50% scores 0.250.",
    },
    {
      label: "Home-rate baseline",
      value: brier(record.baselineBrier),
      note: "The Brier score for giving every home team the usual home win rate, on the same games.",
    },
    {
      label: "Favorite won",
      value: record.accuracy === null ? "n/a" : formatChance(record.accuracy, { exact: true }),
      note: "How often the team the model favored went on to win.",
    },
    {
      label: "Forecasts sealed",
      value: String(record.sealed),
      note: "Fixed before tip and added to the public ledger.",
    },
    {
      label: "Awaiting result",
      value: String(record.pending),
      note: "Sealed, but the game has not finished yet.",
    },
    {
      label: "Missed",
      value: String(record.missed),
      note: "Games that tipped before a forecast was sealed. Counted here, never backfilled.",
    },
    {
      label: "Sealed before a result was in",
      value: String(record.incomplete),
      note: "Sealed on time while an earlier game was unfinished, so its ratings miss that result. Still scored.",
    },
  ];
}

export function TrackRecord({ record }: { record: RecordSummary }) {
  const stats = trackRecordStats(record);
  return (
    <section aria-labelledby="record-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            id="record-title"
            className="text-xl font-semibold tracking-tight text-[var(--color-text-primary)]"
          >
            Track record
          </h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Every sealed forecast this season{record.modelVersion ? `, model ${record.modelVersion}` : ""}.
            Provisional numbers are never scored.
          </p>
        </div>
        <Link href="/how-it-works#track-record" className="pp-link text-sm">
          How the record is kept
        </Link>
      </div>
      {record.smallSample ? (
        <p className="rounded-xl border border-[#fedf89] bg-[var(--color-warning-bg)] px-4 py-3 text-sm text-[var(--color-text-secondary)]">
          <span className="font-semibold text-[var(--color-warning)]">Small sample.</span>{" "}
          {record.scored} scored {record.scored === 1 ? "game" : "games"} so far. These numbers say
          little until at least {MEANINGFUL_GAMES} games.
        </p>
      ) : null}
      <dl className="grid gap-px overflow-hidden rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-border-subtle)] sm:grid-cols-2 lg:grid-cols-4 [&>div]:bg-[var(--color-panel-primary)]">
        {stats.map((stat) => (
          <div key={stat.label} className="flex flex-col gap-1 p-4">
            <dt className="text-sm font-medium text-[var(--color-text-secondary)]">{stat.label}</dt>
            <dd className="text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">
              {stat.value}
            </dd>
            <dd className="text-xs leading-5 text-[var(--color-text-muted)]">{stat.note}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
