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
  const stats: Stat[] = [
    {
      label: "Games scored",
      value: String(record.scored),
      note:
        record.noFinalSeal === null
          ? "Finished games with a sealed forecast."
          : "Finished games, each scored once: on its final seal, or its morning seal if it had no final one.",
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
      label: "Games sealed",
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
      note: "Games that tipped with no seal at all. Counted here, never backfilled.",
    },
  ];
  if (record.noFinalSeal !== null) {
    stats.push({
      label: "No final seal",
      value: String(record.noFinalSeal),
      note: "Scored games that got no seal in the hour before tip, so their morning seal was scored.",
    });
  }
  stats.push({
    label: "Sealed before a result was in",
    value: String(record.incomplete),
    note: "Sealed on time while an earlier game was unfinished, so its ratings miss that result. Still scored.",
  });
  return stats;
}

function SmallSample({ record }: { record: RecordSummary }) {
  if (!record.smallSample) return null;
  return (
    <p className="rounded-xl border border-[#fedf89] bg-[var(--color-warning-bg)] px-4 py-3 text-sm text-[var(--color-text-secondary)]">
      <span className="font-semibold text-[var(--color-warning)]">Small sample.</span>{" "}
      {record.scored} scored {record.scored === 1 ? "game" : "games"} so far. These numbers say little
      until at least {MEANINGFUL_GAMES} games.
    </p>
  );
}

function StatGrid({ stats, compact = false }: { stats: Stat[]; compact?: boolean }) {
  // Nine stats fill three columns; eight fill four. An odd last cell spans the two-column row.
  const columns = stats.length % 4 === 0 ? "lg:grid-cols-4" : "lg:grid-cols-3";
  return (
    <dl
      className={`grid gap-px overflow-hidden rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-border-subtle)] sm:grid-cols-2 ${columns} [&>div]:bg-[var(--color-panel-primary)]`}
    >
      {stats.map((stat, index) => (
        <div
          key={stat.label}
          className={`flex flex-col gap-1 ${compact ? "p-3" : "p-4"} ${
            stats.length % 2 === 1 && index === stats.length - 1 ? "sm:col-span-2 lg:col-span-1" : ""
          }`}
        >
          <dt className="text-sm font-medium text-[var(--color-text-secondary)]">{stat.label}</dt>
          <dd
            className={`font-semibold tracking-tight text-[var(--color-text-primary)] ${
              compact ? "text-lg" : "text-2xl"
            }`}
          >
            {stat.value}
          </dd>
          {compact ? null : (
            <dd className="text-xs leading-5 text-[var(--color-text-muted)]">{stat.note}</dd>
          )}
        </div>
      ))}
    </dl>
  );
}

export function TrackRecord({
  records,
  modelVersion,
  referenceModelVersion,
}: {
  records: Record<string, RecordSummary>;
  modelVersion: string;
  referenceModelVersion: string;
}) {
  const record = records[modelVersion];
  const reference =
    referenceModelVersion !== modelVersion ? (records[referenceModelVersion] ?? null) : null;
  if (!record) return null;
  const headToHead =
    record.referenceBrier !== null && record.brier !== null
      ? `On the same ${record.scored} ${record.scored === 1 ? "game" : "games"}, ${
          record.referenceModelVersion ?? referenceModelVersion
        }'s number stored with each seal scores ${brier(record.referenceBrier)}${
          record.morningBrier !== null ? `, and the morning seals alone ${brier(record.morningBrier)}` : ""
        }.`
      : null;
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
            Every sealed forecast this season, model {modelVersion}
            {record.noFinalSeal !== null ? ", with injuries" : ""}. Provisional numbers are never
            scored.
          </p>
        </div>
        <Link href="/how-it-works#track-record" className="pp-link text-sm">
          How the record is kept
        </Link>
      </div>
      <SmallSample record={record} />
      <StatGrid stats={trackRecordStats(record)} />
      {headToHead ? (
        <p className="text-xs leading-5 text-[var(--color-text-muted)]">{headToHead}</p>
      ) : null}

      {reference ? (
        <div className="mt-2 flex flex-col gap-3">
          <div>
            <h3 className="text-base font-semibold text-[var(--color-text-primary)]">
              Previous model, {referenceModelVersion}
            </h3>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              It does not account for injuries. It still seals every game each morning, so its record
              continues on the same games and is shown here in full.
              {reference.smallSample
                ? ` Small sample: ${reference.scored} scored ${reference.scored === 1 ? "game" : "games"}.`
                : ""}
            </p>
          </div>
          <StatGrid stats={trackRecordStats(reference)} compact />
        </div>
      ) : null}
    </section>
  );
}
