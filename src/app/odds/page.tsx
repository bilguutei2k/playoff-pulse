import type { Metadata } from "next";
import Link from "next/link";
import { AbsenceList } from "@/components/live/AbsenceList";
import { PlayoffSeries } from "@/components/live/PlayoffSeries";
import { HEAT_BINS } from "@/components/live/heat";
import { SeasonTable } from "@/components/live/SeasonTable";
import { TitleOddsChart } from "@/components/live/TitleOddsChart";
import { UpdatedAgo } from "@/components/live/UpdatedAgo";
import { titleOddsChange } from "@/lib/season/history";
import { liveState } from "@/lib/season/published";
import { distinctTeamColors } from "@/lib/season/team-colors";
import type { SeasonPhase } from "@/lib/season/types";
import { formatShortDay, formatStampEt } from "@/lib/utils/dates";

export const metadata: Metadata = {
  title: "NBA playoff and title odds",
  description:
    "Playoff, conference and championship chances for all 30 NBA teams from 20,000 simulated seasons that carry current injuries, updated after games finish and as the NBA injury report changes.",
};

const PHASE_LABELS: Record<SeasonPhase, string> = {
  "regular-season": "Regular season",
  "play-in": "Play-in tournament",
  playoffs: "Playoffs",
  complete: "Season complete",
};

/** How many teams the history chart draws. */
const CHART_TEAMS = 8;

export default function OddsPage() {
  const { forecast, history, generatedAt, seasonLabel } = liveState;
  const modeled = liveState.injury !== null;
  const oddsChange = titleOddsChange(history);
  const changeSince = oddsChange ? formatShortDay(oddsChange.since) : null;
  const points = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const chartTeams = [...forecast.teams]
    .sort((a, b) => b.champion - a.champion)
    .slice(0, CHART_TEAMS)
    .map((team) => team.teamId);
  const colors = distinctTeamColors(chartTeams, "#ffffff");
  const series = chartTeams.map((teamId) => ({ teamId, color: colors[teamId] }));
  const showSeries = forecast.series.length > 0;

  return (
    <main className="pp-container flex flex-col gap-12 py-6 sm:py-10">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-[var(--color-text-muted)]">
            {seasonLabel} · {PHASE_LABELS[forecast.phase]}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--color-text-primary)] sm:text-3xl">
            Season odds
          </h1>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">
            Playoff and title chances for all 30 teams, from{" "}
            {forecast.iterations.toLocaleString("en-US")} simulated seasons.{" "}
            {modeled
              ? "Season odds update after games finish and when the NBA injury report changes who is out."
              : "Season odds update after games finish."}
          </p>
        </div>
        <p className="tabular text-xs text-[var(--color-text-muted)]">
          <UpdatedAgo iso={generatedAt} stamp={formatStampEt(generatedAt)} />
        </p>
      </header>

      {showSeries ? <PlayoffSeries series={forecast.series} /> : null}

      <section aria-labelledby="history-title" className="flex flex-col gap-4">
        <div>
          <h2
            id="history-title"
            className="text-xl font-semibold tracking-tight text-[var(--color-text-primary)]"
          >
            Title odds over time
          </h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            The {CHART_TEAMS} likeliest champions today. Hover, tap or use the arrow keys to read a
            date; select a team to highlight its line.
          </p>
        </div>
        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-panel-primary)] p-4 sm:p-5">
          {points.length < 4 ? (
            <p className="mb-3 text-xs text-[var(--color-text-muted)]">
              History starts {points.length > 0 ? formatShortDay(points[0].date) : "at launch"} and
              adds a point each day; {points.length} {points.length === 1 ? "day" : "days"} so far.
            </p>
          ) : null}
          <TitleOddsChart points={points} series={series} />
        </div>
      </section>

      <section aria-labelledby="table-title" className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2
              id="table-title"
              className="text-xl font-semibold tracking-tight text-[var(--color-text-primary)]"
            >
              Every team
            </h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Select a column heading to sort. Darker cells are likelier.
            </p>
          </div>
          <ul aria-label="Shading key" className="flex flex-wrap items-center gap-1.5 text-xs">
            {HEAT_BINS.map((bin) => (
              <li key={bin.label}>
                <span
                  className={`pp-heat ${bin.className} min-w-0 border border-[var(--color-border-subtle)]`}
                >
                  {bin.label}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <SeasonTable
          teams={forecast.teams}
          phase={forecast.phase}
          change={oddsChange?.change ?? null}
          changeSince={changeSince}
          currentRatings={modeled ? liveState.currentRatings : null}
        />
        <div className="grid gap-2 text-xs leading-5 text-[var(--color-text-muted)]">
          <p>
            <span className="font-semibold text-[var(--color-text-secondary)]">Rating</span> is
            points per game better or worse than an average team
            {modeled ? " at full strength" : ""}, with one standard deviation of uncertainty.{" "}
            {modeled ? (
              <>
                <span className="font-semibold text-[var(--color-text-secondary)]">Now</span> is that
                rating minus the points the team gives up in its next game to players currently out.{" "}
              </>
            ) : null}
            <span className="font-semibold text-[var(--color-text-secondary)]">Proj. wins</span>{" "}
            is the average final win total, with the 10th to 90th percentile range.{" "}
            {changeSince ? (
              <>
                <span className="font-semibold text-[var(--color-text-secondary)]">Title change</span>{" "}
                is in percentage points of title odds since {changeSince}, the last day the odds
                moved.
              </>
            ) : null}
          </p>
          <p>
            Early and midseason playoff odds are not claimed to be well calibrated, and no skill is
            claimed for title odds.{" "}
            {modeled
              ? "Known absences are carried for their expected length; injuries that have not happened yet are not simulated."
              : "This published state comes from the previous model, which does not account for injuries."}{" "}
            <Link href="/how-it-works#season-odds" className="pp-link">
              How the season is simulated
            </Link>
            .
          </p>
        </div>
      </section>

      {modeled ? (
        <AbsenceList
          absences={liveState.absences}
          absencePoints={liveState.absencePoints}
          reportAt={liveState.availability.reportAt}
        />
      ) : null}
    </main>
  );
}
