import { TeamLogo } from "@/components/live/TeamLogo";
import { teamById } from "@/lib/season/teams";
import type { PlayoffRound, SeriesForecast } from "@/lib/season/types";
import { formatPercent } from "@/lib/utils/format";

const ROUNDS: Array<{ round: PlayoffRound; label: string }> = [
  { round: "finals", label: "NBA Finals" },
  { round: "conference-final", label: "Conference finals" },
  { round: "conference-semifinal", label: "Conference semifinals" },
  { round: "first-round", label: "First round" },
];

function SeriesRow({ series }: { series: SeriesForecast }) {
  const homeCourt = teamById(series.homeCourtId);
  const other = teamById(series.otherId);
  const finished = series.homeCourtWins >= 4 || series.otherWins >= 4;
  const homeCourtLeads = series.homeCourtSeriesProbability >= 0.5;
  const favorite = homeCourtLeads ? homeCourt : other;
  const favoriteChance = homeCourtLeads
    ? series.homeCourtSeriesProbability
    : 1 - series.homeCourtSeriesProbability;
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-[var(--color-border-subtle)] py-2 text-sm">
      <span className="flex items-center gap-1.5 text-[var(--color-text-secondary)]">
        <TeamLogo teamId={series.homeCourtId} />
        {homeCourt.abbreviation}
        <span className="pp-number font-bold text-[var(--color-text-primary)]">
          {series.homeCourtWins}-{series.otherWins}
        </span>
        <TeamLogo teamId={series.otherId} />
        {other.abbreviation}
      </span>
      <span className="pp-number text-xs text-[var(--color-text-muted)]">
        {finished
          ? `${favorite.abbreviation} won the series`
          : `${favorite.abbreviation} ${formatPercent(favoriteChance)} to win the series`}
      </span>
    </li>
  );
}

export function PlayoffSeries({ series }: { series: SeriesForecast[] }) {
  return (
    <section aria-labelledby="series-title">
      <div className="pp-kicker">Playoffs</div>
      <h2 id="series-title" className="mt-1 mb-3 text-xl font-bold text-[var(--color-text-primary)]">
        Series
      </h2>
      <div className="grid gap-3 md:grid-cols-2">
        {ROUNDS.map(({ round, label }) => {
          const rows = series.filter((row) => row.round === round);
          if (rows.length === 0) return null;
          return (
            <div key={round} className="pp-card">
              <div className="pp-section-head">
                <h3 className="text-sm font-bold text-[var(--color-text-primary)]">{label}</h3>
              </div>
              <ul className="px-4 pb-2">
                {rows.map((row) => (
                  <SeriesRow key={row.id} series={row} />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
