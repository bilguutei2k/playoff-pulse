import type { Metadata } from "next";
import Link from "next/link";
import { LiveDashboard } from "@/components/live/LiveDashboard";
import { SeasonTable } from "@/components/live/SeasonTable";
import { loadSlateView } from "@/lib/live-data/live-slate";
import { liveState } from "@/lib/season/published";
import { teamById } from "@/lib/season/teams";
import { formatPercent } from "@/lib/utils/format";

export const metadata: Metadata = {
  title: "Live NBA forecasts | Playoff Pulse",
  description:
    "Win probabilities for every NBA game today, plus playoff and championship odds for all 30 teams. Each pregame forecast is sealed before tip and scored afterward.",
};

// Re-rendered about once a minute; the client also polls for live scores.
export const revalidate = 60;

function formatStamp(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: "America/New_York",
  }).format(new Date(iso));
}

function RecordPanel() {
  const { record } = liveState;
  const rows: Array<[string, string]> = [
    ["Forecasts sealed", String(record.sealed)],
    ["Scored", String(record.scored)],
    ["Awaiting result", String(record.pending)],
    ["Sealed with incomplete inputs", String(record.incomplete)],
    ["Missed seals (tipped unsealed)", String(record.missed)],
    ["Brier score", record.brier === null ? "n/a" : record.brier.toFixed(3)],
    [
      "Always picking the home-win rate",
      record.baselineBrier === null ? "n/a" : record.baselineBrier.toFixed(3),
    ],
    ["Favorite won", record.accuracy === null ? "n/a" : formatPercent(record.accuracy)],
  ];
  return (
    <section aria-labelledby="record-title" className="pp-card">
      <div className="pp-section-head">
        <div className="pp-kicker">The public record</div>
        <h2 id="record-title" className="mt-1 text-sm font-bold text-[var(--color-text-primary)]">
          Sealed forecasts this season
        </h2>
      </div>
      <dl className="grid gap-x-8 gap-y-1 p-4 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex justify-between gap-4 border-b border-[var(--color-border-subtle)] py-1.5"
          >
            <dt className="text-[var(--color-text-muted)]">{label}</dt>
            <dd className="pp-number text-[var(--color-text-primary)]">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="px-4 pb-4 text-xs leading-5 text-[var(--color-text-muted)]">
        {record.smallSample
          ? `Small sample: ${record.scored} scored games so far. These numbers are not meaningful until at least 500 games. `
          : ""}
        Lower Brier is better. Provisional numbers are never scored, and a game that tips without a
        seal stays out of the score and is counted above.
      </p>
    </section>
  );
}

export default async function LivePage() {
  const initial = await loadSlateView();
  const favorite = [...liveState.forecast.teams].sort((a, b) => b.champion - a.champion)[0];
  return (
    <main className="min-h-screen bg-[var(--color-bg-primary)]">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-3 py-4 md:px-[18px] md:py-6">
        <header>
          <div className="pp-kicker">{liveState.seasonLabel} season</div>
          <h1 className="mt-2 text-2xl font-bold text-[var(--color-text-primary)]">
            Live NBA forecasts
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-text-muted)]">
            A chance of winning for every game today, plus playoff and title odds for all 30 teams.
            Each pregame number is sealed before tip and scored afterward. The current title
            favorite is the {teamById(favorite.teamId).name} at {formatPercent(favorite.champion)}.
          </p>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-text-muted)]">
            <strong className="text-[var(--color-text-secondary)]">
              The model does not account for injuries,
            </strong>{" "}
            so a game with a star out can be mispriced. Reported injuries are listed for context.
            This is not a betting product, and the data comes from ESPN&apos;s unofficial public
            feeds. See{" "}
            <Link
              href="/live/methodology"
              className="underline decoration-2 underline-offset-2"
            >
              how it works and how well it has tested
            </Link>
            .
          </p>
        </header>

        <LiveDashboard initial={initial} />

        <section aria-labelledby="season-title">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="pp-kicker">Season forecast</div>
              <h2
                id="season-title"
                className="mt-1 text-xl font-bold text-[var(--color-text-primary)]"
              >
                Playoff and title odds
              </h2>
            </div>
            <p className="pp-number text-xs text-[var(--color-text-muted)]">
              Updated {formatStamp(liveState.generatedAt)} ·{" "}
              {liveState.forecast.iterations.toLocaleString("en-US")} simulated seasons
            </p>
          </div>
          <p className="mb-3 max-w-3xl text-xs leading-5 text-[var(--color-text-muted)]">
            Season odds update after games finish, typically within a few hours of the final. Live
            scores update about once a minute. Early and midseason playoff odds are not claimed to
            be well calibrated, and no title-odds skill is claimed.
          </p>
          <SeasonTable teams={liveState.forecast.teams} />
        </section>

        <RecordPanel />
      </div>
    </main>
  );
}
