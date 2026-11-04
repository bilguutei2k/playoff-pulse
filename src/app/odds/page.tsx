import type { Metadata } from "next";
import Link from "next/link";
import { AbsenceList } from "@/components/live/AbsenceList";
import { HEAT_BINS } from "@/components/live/heat";
import { OddsTable } from "@/components/live/OddsTable";
import { PlayoffSeries } from "@/components/live/PlayoffSeries";
import { SectionHeading } from "@/components/live/SectionHeading";
import { TitleOddsChart } from "@/components/live/TitleOddsChart";
import { getLiveState, getSeasonGames } from "@/lib/live-data/published";
import { distinctTeamColors } from "@/lib/season/team-colors";
import type { SeasonPhase } from "@/lib/season/types";
import { formatDateTimeEt, formatShortDay } from "@/lib/utils/dates";
import { oddsRows } from "@/lib/view/odds";
import { PANEL_COLOR, teamDisplay } from "@/lib/view/teams";

export const metadata: Metadata = {
  title: "NBA playoff and title odds",
  description:
    "Playoff, conference and championship chances for all 30 NBA teams from simulated seasons, updated after games finish and as the NBA injury report changes.",
};

const PHASE_LABELS: Record<SeasonPhase, string> = {
  "regular-season": "Regular season",
  "play-in": "Play-in tournament",
  playoffs: "Playoffs",
  complete: "Season complete",
};

const CHART_TEAMS = 8;

// Re-rendered about once a minute from main's published data (src/lib/live-data/published.ts).
export const revalidate = 60;

export default async function OddsPage() {
  const [liveState, seasonGames] = await Promise.all([getLiveState(), getSeasonGames()]);
  const { forecast, history, generatedAt, seasonLabel } = liveState;
  const modeled = liveState.injury !== null;
  const rows = oddsRows(liveState, seasonGames);
  const points = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const ranked = [...forecast.teams].sort((a, b) => b.champion - a.champion);
  const top = ranked.slice(0, CHART_TEAMS).map((team) => team.teamId);
  const colors = distinctTeamColors(top, PANEL_COLOR);
  const highlighted = top.map((teamId) => ({
    teamId,
    code: teamDisplay(teamId).code,
    name: teamDisplay(teamId).shortName,
    color: colors[teamId],
  }));
  const others = ranked.slice(CHART_TEAMS).map((team) => team.teamId);

  return (
    <main className="pp-container py-8 sm:py-10">
      <SectionHeading
        as="h1"
        kicker={`${seasonLabel} · ${PHASE_LABELS[forecast.phase]}`}
        title="Playoff and title odds"
        dek={
          <>
            Every team&apos;s chances from {forecast.iterations.toLocaleString("en-US")} simulations of the rest
            of the season, last run {formatDateTimeEt(generatedAt)}.{" "}
            {modeled
              ? "They update after games finish and when the NBA injury report changes who is out."
              : "They update after games finish."}
          </>
        }
      />

      {forecast.series.length > 0 ? (
        <div className="mt-10">
          <PlayoffSeries series={forecast.series} />
        </div>
      ) : null}

      <section aria-labelledby="standings-title" className="mt-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="standings-title" className="headline text-[22px] sm:text-[26px]">
              Standings and odds
            </h2>
            <p className="mt-1 text-[14px] text-ink-2">Select a column heading to sort. Darker cells are likelier.</p>
          </div>
          <ul aria-label="Shading key" className="flex flex-wrap items-center gap-1">
            {HEAT_BINS.map((bin) => (
              <li key={bin.label}>
                <span className={`heat ${bin.className} min-w-0 border border-line px-1.5 py-0.5 text-[10.5px]`}>{bin.label}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-5">
          <OddsTable rows={rows} exact={forecast.phase !== "regular-season"} />
        </div>
        <div className="mt-4 grid gap-2 text-[13px] leading-5 text-ink-2 md:grid-cols-2 md:gap-x-10">
          <p>
            <span className="font-semibold text-ink">Rating</span> is points per game better or worse than an
            average team{modeled ? " at full strength" : ""}. {modeled ? (
              <>
                <span className="font-semibold text-ink">Now</span> takes off the points the team gives up in its
                next game to players currently out.{" "}
              </>
            ) : null}
            <span className="font-semibold text-ink">Proj. W–L</span> is the average final record, with the
            10th to 90th percentile of wins beneath. <span className="font-semibold text-ink">Seed 1–15</span> shows
            the chance of each finishing position: dark teal is a top-six seed, light teal the play-in.
          </p>
          <p>
            Early and midseason playoff odds failed their registered reliability check and are not claimed to be
            well calibrated; no skill is claimed for title odds.{" "}
            {modeled
              ? "Known absences are carried for their expected length; injuries that have not happened yet are not simulated."
              : "This forecast comes from the model without the injury term."}{" "}
            <Link href="/how-it-works#season-odds" className="pp-link">How the season is simulated</Link>
          </p>
        </div>
      </section>

      <section aria-labelledby="history-title" className="mt-14">
        <SectionHeading
          id="history-title"
          kicker="Title race"
          title="Title odds over time"
          dek={`The ${CHART_TEAMS} likeliest champions today in their team colors, everyone else in gray. Hover or use the arrow keys to read a date.`}
        />
        <div className="panel mt-5 p-4 sm:p-6">
          {points.length < 2 ? (
            <p className="notice-quiet mb-4">
              The chart adds a point each day; it starts{" "}
              {points.length > 0 ? formatShortDay(points[0].date) : "with the first published forecast"}, so there is
              not much of a line yet.
            </p>
          ) : null}
          <TitleOddsChart points={points} highlighted={highlighted} others={others} />
        </div>
      </section>

      {modeled ? (
        <div className="mt-14">
          <AbsenceList
            absences={liveState.absences}
            absencePoints={liveState.absencePoints}
            reportAt={liveState.availability.reportAt}
            slateEtDate={liveState.slateEtDate}
          />
        </div>
      ) : null}
    </main>
  );
}
