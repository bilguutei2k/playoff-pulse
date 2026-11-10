import type { Metadata } from "next";
import Link from "next/link";
import { TitleRace } from "@/components/live/HomePanels";
import { OddsTable } from "@/components/live/OddsTable";
import { PlayoffSeries } from "@/components/live/PlayoffSeries";
import { Ticker } from "@/components/live/Ticker";
import { TitleOddsChart } from "@/components/live/TitleOddsChart";
import { WhoIsOut } from "@/components/live/WhoIsOut";
import { getLiveState, getSeasonGames } from "@/lib/live-data/published";
import type { SeasonPhase } from "@/lib/season/types";
import { formatDateTimeEt, formatShortDay } from "@/lib/utils/dates";
import { oddsRows, teamAbsences } from "@/lib/view/odds";
import { PANEL_COLOR, teamDisplay } from "@/lib/view/teams";
import { titleChartStyles } from "./chart-colors";

export const metadata: Metadata = {
  title: "NBA playoff and title odds",
  description:
    "Playoff, conference and championship chances for all 30 NBA teams from simulated seasons, updated after games finish and as the NBA injury report changes.",
  alternates: { canonical: "/odds" },
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
  const { forecast, history, generatedAt } = liveState;
  const modeled = liveState.injury !== null;
  const rows = oddsRows(liveState, seasonGames);
  const points = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const ranked = [...forecast.teams].sort((a, b) => b.champion - a.champion);
  const top = ranked.slice(0, CHART_TEAMS).map((team) => team.teamId);
  const styles = titleChartStyles(top, PANEL_COLOR);
  const highlighted = top.map((teamId) => ({
    teamId,
    code: teamDisplay(teamId).code,
    name: teamDisplay(teamId).shortName,
    color: styles[teamId].color,
    dash: styles[teamId].dash,
  }));
  const others = ranked.slice(CHART_TEAMS).map((team) => team.teamId);

  return (
    <>
      <Ticker />
      <main className="pp-container pb-4 pt-8 sm:pt-11">
        <h1 className="headline text-32 sm:text-46">Playoff and title odds</h1>
        <p className="mt-2.5 text-[15px] text-ink-2 sm:text-[16px]">
          {PHASE_LABELS[forecast.phase]} · {forecast.iterations.toLocaleString("en-US")} simulations · run{" "}
          {formatDateTimeEt(generatedAt)}
        </p>
        <p className="mt-2 max-w-3xl text-[14px] text-ink-2">
          Every team&apos;s chances from simulations of the rest of the season.{" "}
          {modeled
            ? "They update after games finish and when the NBA injury report changes who is out."
            : "They update after games finish."}
        </p>

        {forecast.series.length > 0 ? (
          <div className="mt-12">
            <PlayoffSeries series={forecast.series} />
          </div>
        ) : null}

        <section aria-labelledby="standings-title" className="mt-7">
          <h2 id="standings-title" className="sr-only">
            Standings and odds
          </h2>
          <OddsTable rows={rows} exact={forecast.phase !== "regular-season"} />
          <p className="mt-3.5 text-[13px] leading-5 text-ink-2">
            Rating: points per game against an average team{modeled ? ", adjusted for who missed past games to approximate full strength" : ""}.
            {modeled ? " Now: after the points lost to players currently out, for the next game." : ""} Bars: wins in 8
            of 10 simulations, black tick at the average. Column headings sort the table.
          </p>
          <p className="mt-1.5 text-[13px] leading-5">
            Not claimed calibrated midseason. No skill claimed for title odds.{" "}
            <span className="text-ink-2">
              {modeled
                ? "Known absences are carried for the games a return table expects them to last, except that one still running when the regular season ends currently costs every playoff game (a known issue); injuries that have not happened yet are not simulated."
                : "This forecast comes from the model without the injury term."}{" "}
            </span>
            <Link href="/how-it-works#season-odds" className="pp-link">
              How the season is simulated
            </Link>
          </p>
        </section>

        <div className="mt-14 grid gap-x-20 gap-y-14 sm:mt-[72px] lg:grid-cols-2">
          {modeled ? (
            <WhoIsOut
              teams={teamAbsences(liveState)}
              reportAt={liveState.availability.reportAt}
              slateEtDate={liveState.slateEtDate}
            />
          ) : null}
          <TitleRace state={liveState} />
        </div>

        <section aria-labelledby="history-title" className="mt-14 sm:mt-[72px]">
          <div className="sh">
            <h2 id="history-title">Title odds over time</h2>
            <span>
              Top {CHART_TEAMS} today in team colors{highlighted.some((team) => team.dash) ? ", dashed where colors are close" : ""}, others grey
            </span>
          </div>
          {points.length < 2 ? (
            <p className="notice-quiet mb-4">
              The chart adds a point each day; it starts{" "}
              {points.length > 0 ? formatShortDay(points[0].date) : "with the first published forecast"}, so there is
              not much of a line yet.
            </p>
          ) : null}
          <TitleOddsChart points={points} highlighted={highlighted} others={others} />
        </section>
      </main>
    </>
  );
}
