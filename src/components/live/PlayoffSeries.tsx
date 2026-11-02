import { TeamLogo } from "@/components/live/TeamLogo";
import { TeamProbabilityBar } from "@/components/live/TeamProbabilityBar";
import { teamById } from "@/lib/season/teams";
import type { PlayoffRound, SeriesForecast } from "@/lib/season/types";
import { formatChance } from "@/lib/utils/format";

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
  const winner = series.homeCourtWins >= 4 ? homeCourt : other;
  return (
    <li className="flex flex-col gap-2 border-b border-[var(--color-border-subtle)] py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
        <span className="flex items-center gap-2 font-medium text-[var(--color-text-primary)]">
          <TeamLogo teamId={series.homeCourtId} size={20} />
          {homeCourt.abbreviation}
          <span className="tabular rounded-md bg-[var(--color-panel-secondary)] px-1.5 py-0.5 font-semibold">
            {series.homeCourtWins}-{series.otherWins}
          </span>
          {other.abbreviation}
          <TeamLogo teamId={series.otherId} size={20} />
        </span>
        <span className="tabular text-xs text-[var(--color-text-muted)]">
          {finished
            ? `${winner.abbreviation} won the series`
            : `${favorite.abbreviation} ${formatChance(favoriteChance, { exact: true })} to win the series`}
        </span>
      </div>
      <TeamProbabilityBar
        leftId={series.homeCourtId}
        rightId={series.otherId}
        leftProbability={series.homeCourtSeriesProbability}
        label="Chance of winning the series"
        exact
      />
    </li>
  );
}

export function PlayoffSeries({ series }: { series: SeriesForecast[] }) {
  return (
    <section aria-labelledby="series-title" className="flex flex-col gap-4">
      <div>
        <h2
          id="series-title"
          className="text-xl font-semibold tracking-tight text-[var(--color-text-primary)]"
        >
          Playoff series
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Each series from its current score. The team listed first has home court.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {ROUNDS.map(({ round, label }) => {
          const rows = series.filter((row) => row.round === round);
          if (rows.length === 0) return null;
          return (
            <div
              key={round}
              className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-panel-primary)] px-4 pt-3 pb-1"
            >
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{label}</h3>
              <ul>
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
