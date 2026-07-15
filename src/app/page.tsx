import {
  dataLastUpdated,
  dataLastUpdatedTimestamp,
  dataSnapshotLabel,
  liveApiStatus,
  playoffConfig,
} from "@/lib/data/playoff-config";
import { ForecastDashboard } from "@/components/forecast/ForecastDashboard";
import Link from "next/link";

function formatDataLastUpdated(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export default function Home() {
  const activeSeriesCount = playoffConfig.series.filter(
    (series) => series.winsA < 4 && series.winsB < 4,
  ).length;

  return (
    <main className="min-h-screen bg-[var(--color-bg-primary)]">
      <div className="mx-auto flex max-w-7xl flex-col gap-[18px] px-3 py-3 md:px-[18px] md:py-[18px]">
        <section className="pp-card">
          <div className="grid gap-0 divide-y divide-[var(--color-border-subtle)] xl:grid-cols-[1.4fr_1fr] xl:divide-x xl:divide-y-0">
            <div className="p-4">
              <div className="pp-kicker text-[var(--color-accent)]">Dashboard</div>
              <h1 className="mt-3 text-2xl font-bold tracking-normal text-[var(--color-text-primary)] md:text-3xl">
                Playoff Pulse
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--color-text-muted)]">
                Transparent NBA playoff forecasting built from manual ratings,
                player availability, exact series paths, and uncertainty-aware bracket simulation.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/lab" className="border-2 border-[var(--color-accent)] bg-[var(--overlay-accent-soft)] px-3 py-2 text-xs font-bold uppercase tracking-[0.08em]">Open preserved scenario lab</Link>
                <Link href="/evidence" className="border-2 border-[var(--color-border-strong)] px-3 py-2 text-xs font-bold uppercase tracking-[0.08em]">Browse historical evidence</Link>
              </div>
            </div>

            <div className="grid gap-0 divide-y divide-[var(--color-border-subtle)] sm:grid-cols-3 sm:divide-x sm:divide-y-0 xl:grid-cols-1 xl:divide-x-0 xl:divide-y">
              <div className="p-4">
                <div className="pp-kicker">{dataSnapshotLabel}</div>
                <div className="pp-number mt-2 text-sm font-bold">
                  Last updated: {dataLastUpdatedTimestamp}
                </div>
                <p className="mt-2 text-xs leading-5 text-[var(--color-text-muted)]">
                  Injury statuses and ratings are manually maintained estimates.
                  Snapshot date: {formatDataLastUpdated(dataLastUpdated)}.
                </p>
              </div>
              <div className="p-4">
                <div className="pp-kicker">{liveApiStatus}</div>
                <div className="pp-number mt-2 text-xl font-bold">
                  {playoffConfig.teams.length} teams / {activeSeriesCount} active
                </div>
                <p className="mt-2 text-xs leading-5 text-[var(--color-text-muted)]">
                  Forecast inputs stay manual; live scores are displayed as a
                  separate read-only feed.
                </p>
              </div>
              <div className="p-4">
                <div className="pp-kicker">Probabilities are model estimates</div>
                <div className="pp-number mt-2 text-sm font-bold text-[var(--color-warning)]">
                  Rolling evidence published
                </div>
                <p className="mt-2 text-xs leading-5 text-[var(--color-text-muted)]">
                  No odds feed or betting recommendation is active.
                </p>
              </div>
            </div>
          </div>
        </section>

        <ForecastDashboard />
      </div>
    </main>
  );
}
